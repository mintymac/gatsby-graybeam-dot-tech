---
title: "Score Tensors: How We Stopped an LLM From Breaking Its Own Fixes"
category: "Engineering"
author: McHughson Chambers
date: 2026-04-15
draft: true
---

We built a pipeline where an LLM generates HTML from a design target image, an automated checker scores it, and the LLM iterates on the violations. The first fix iteration improved the score from 60% to 87%. Every iteration after that made things worse.

The debugging session that followed uncovered three things we should have known from the start: a token budget trap in Gemini 3 Flash's thinking mode, an information-theoretic limit on full-document regeneration, and a surprisingly simple architecture that a world-class frontend designer would have suggested in the first five minutes.

## The setup

Loom's Display subsystem gives agents structured access to visual output. Part of that is design verification: given a design target (a screenshot of what the UI should look like), can an agent implement it in HTML and CSS, then verify its work against a spec?

The SpecChecker extracts a structured spec from the design target using a VLM — bounding boxes, colors, typography, layout constraints — then evaluates the generated HTML against it. Each constraint either passes or fails. A violation says: "the hero heading's x-position should be 140px, but it's 169px." A pass says: "the footer's font-size tier is correct."

The iteration loop is simple: generate HTML, check violations, feed violations back to the LLM, get improved HTML, check again. Repeat until the score is high enough or you've exhausted your iteration budget.

## The first bug: thinking tokens eat the output budget

The first runs were bizarre. The LLM (Gemini 3 Flash Preview) would improve the score dramatically on iteration 1, then produce truncated HTML on iteration 2 — cutting off mid-CSS, no `<body>` tag, just the first 650 tokens of a `<style>` block.

We added forensic logging: raw response sizes, token counts, and — critically — the `finish_reason` from the Gemini API, which we'd been discarding at the provider level.

The data:

| Call | Completion Tokens | finish_reason | Result |
|------|------------------|---------------|--------|
| Initial generation | 1702 | STOP | Complete |
| Fix iteration 1 | 1804 | STOP | Complete |
| Fix iteration 2 | **654** | **MAX_TOKENS** | Truncated |
| Fix iteration 3 | **651** | **MAX_TOKENS** | Truncated |

We were sending `maxOutputTokens: 16384`. The model was hitting MAX_TOKENS at 654. Those numbers don't add up — unless you know that Gemini 3 Flash's thinking tokens share the `maxOutputTokens` budget.

The total token counts told the story: `prompt=3920, completion=654, total=20300`. The gap — about 15,700 tokens — was the model *thinking*. For a complex code-editing task, Flash used ~15K thinking tokens, leaving 16384 - 15728 = **656 tokens for actual output**. Exactly what we measured.

The fix was setting `maxOutputTokens: 65536`. The model still thinks for 10-15K tokens on code tasks, but now there's plenty of room for the ~2K token HTML output. Call times stayed under 60 seconds.

The lesson: **always surface `finish_reason` from your LLM provider.** We flew blind for hours because the provider normalized the Gemini response into an OpenAI-compatible format that discarded the one field that would have diagnosed the problem immediately.

## The second bug: the regression paradox

With the token budget fixed, we got a clean five-iteration run:

| Iteration | Score | Violations | Passes |
|-----------|-------|-----------|--------|
| 0 | 59.7% | 30 | 54 |
| 1 | **86.5%** | 12 | 77 |
| 2 | 69.8% | 26 | 60 |
| 3 | 64.1% | 26 | 58 |
| 4 | 53.7% | 35 | 48 |

Iteration 1 fixed 18 violations and broke nothing. Iteration 2 received *fewer* violations (12 vs 30) and *regressed* by 16.7 percentage points. More information about what's wrong produced a better result. Less information produced a worse one.

We ran this through three independent analyses: an information-theoretic decomposition (Shannon-style channel analysis), a design systems architect, and a world-class frontend designer.

They all converged on the same root cause: **98.7% of the LLM's output bandwidth is spent reproducing HTML that must not change.**

The fix prompt sends the full 6KB HTML document and asks the LLM to return a modified version. Even when only 12 CSS values need changing (~48 tokens), the model regenerates all ~1800 tokens. At temperature 0.2, each regenerated token has a small probability of mutation. Over 1800 tokens, that's 3-5 accidental CSS changes per iteration — enough to introduce new violations faster than old ones are fixed.

The Shannon analysis quantified it: the channel's signal-to-output ratio is 1.3%. The noise floor from reproduction is ~5 new violations per iteration. The system literally cannot converge below ~94% because the output format creates more errors than the fix logic resolves.

## The designer's correction

Before we built anything clever, we asked how a senior frontend designer actually works.

The answer was humbling. They don't fix everything at once. They don't even think about the page as a single artifact. Their actual build sequence:

1. **Typography inventory.** Count the distinct text styles — not pixel values, just how many *levels* exist. This becomes the type scale.
2. **Color inventory.** How many colors? Which is dominant? Which is accent?
3. **Spacing rhythm.** Two or three gap sizes that repeat throughout the design.
4. **CSS custom properties.** Define the design vocabulary *before any layout code.*
5. **Rough layout, all sections.** Get the full page approximately right before perfecting anything.
6. **Refinement pass, section by section.** Now match exact values, top to bottom.

And when fixing violations? They batch by type, not by element:

1. Colors and backgrounds first (zero layout risk)
2. Font properties second (minimal reflow)
3. Font sizes third (can cause reflow — fix before measuring spacing)
4. Section-level layout fourth
5. Element-level spacing last (highest coupling)

This ordering isn't arbitrary. It follows the CSS cascade's actual coupling structure. Changing a color can't break a bounding box. Changing a font size can. So you fix colors before you measure spacing, or your spacing measurements are against text that's about to change size.

The designer also said something that reframed the whole architecture: "Stop optimizing for the last 3%. Getting from 97% to 100% requires visual judgment that no constraint checker can provide."

## From flat scores to score tensors

The breakthrough came from looking at the SpecChecker's output differently. Instead of a single score (87%), we decomposed it into a matrix: **section x metric type**.

| Section | Layout | Color | Typography | Structure | Section % |
|---------|--------|-------|------------|-----------|-----------|
| navbar | 67% | **0%** | 100% | 100% | 77% |
| hero | 89% | **33%** | 100% | 67% | 79% |
| stats | 100% | — | — | 100% | 100% |
| features | 100% | — | **0%** | 100% | 77% |
| footer | 100% | 100% | 100% | — | 100% |

Now the weak cells jump out. `features/typography: 0%` is three identical font_size_tier violations — a deterministic fix that doesn't need an LLM at all. `navbar/color: 0%` is a single color mismatch — a 10-token CSS variable override. `hero/color: 33%` is two color violations with zero layout risk.

The flat 87% score hid the fact that most of the page was already perfect. The failures were concentrated in a few cells, each with a different optimal fix strategy.

Stack these matrices across iterations, and you have a tensor: `[iterations, sections, metric_types]`. The delta tensor (difference between consecutive iterations) shows exactly what improved, what regressed, and — critically — what's **coupled**. If fixing `hero/layout` consistently causes `features/layout` to regress, those sections share a CSS dependency. The tensor exposes it.

## Strategy routing from the tensor

Different cells want different fix strategies:

| Cell Score | Best Strategy | Tokens | Time | Risk |
|------------|--------------|--------|------|------|
| Color at 0-50% | CSS variable override | ~100 | ~5s | Near zero |
| Typography at 0% | Deterministic (from spec) | **0** | ~0s | **Zero** |
| Layout at 50-80% | Section-scoped CSS patch | ~500 | ~15s | Low |
| Structure at 0% | Full section rewrite | ~1800 | ~50s | Medium |
| Anything >90% | Leave it alone | 0 | 0 | None |

The iteration loop becomes:

1. Score the page. Build the section x type matrix. Append to tensor.
2. Compute the delta from the previous iteration.
3. Check for unexpected regressions (non-targeted cells changed).
4. Find the weakest cell.
5. Check the coupling tensor — is this cell correlated with others?
6. Select the cheapest safe strategy for that cell type.
7. Apply the fix. Go to 1.

The expensive full-document rewrite — the one that causes regression — only fires when nothing else works. For most cells, the fix is a surgical CSS override that can't break anything because it doesn't touch layout.

## Why we didn't use @layer or Shadow DOM

We evaluated three CSS isolation strategies: Shadow DOM (strong isolation but breaks layout extraction), CSS `@layer` (additive overrides, no rewriting), and flat section-scoped selectors with CSS custom properties.

The designer's verdict was blunt: `@layer` solves a specificity coordination problem that doesn't exist when a single author controls all the CSS. Shadow DOM requires rewriting the layout walker and has font-face bugs dating to 2014. CSS containment (`contain: style`) doesn't actually scope styles — it only scopes CSS counters.

The winning approach is the simplest: CSS custom properties for all constrained values, flat section-scoped selectors, corrections appended after base styles (later in source order wins at equal specificity). No layers. No shadow roots. Just CSS doing what CSS already does.

## What's next

The tensor architecture is designed but not yet implemented. The plan is to run competing strategies at each iteration — all four approaches generate a candidate fix, the SpecChecker scores them all, and whichever one advances the weakest cell without regressing others becomes the base for the next iteration.

Over time, this builds an empirical routing table: at what score levels and metric types does each strategy dominate? The tensor provides the data. The strategies compete. The best one wins at each step.

The goal isn't 100% match — the designer was right about that. The goal is a system where the agent can reliably get from a design target to a verified implementation without human intervention, converging monotonically instead of oscillating.

The SpecChecker scores the HTML. The tensor maps the scores to a multi-dimensional view. The router picks the strategy. The strategies compete. And `finish_reason` is never discarded again.

---

*Loom is a BEAM-native agent runtime. The Display subsystem, SpecChecker, and score tensor architecture are being built in the open at [GrayBeam](https://graybeam.tech).*
