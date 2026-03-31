---
title: "We Tested 12 LLMs for Epistemic Neutrality — Safety-Trained Models Performed Worst"
category: "Research"
author: McHughson Chambers
date: 2026-03-31
---

Google's Gemini called a psychedelic longevity podcast "scientific laundering." It rated a known conspiracy analysis channel — one whose audience literally self-selected to watch conspiracy analysis — as "mostly covert manipulation."

Neither was using covert techniques. Both were openly doing exactly what their audiences expected. Gemini wasn't detecting manipulation. It was disagreeing with the content and encoding that disagreement as an analytical finding.

We build [Bouncer](https://bouncer.graybeam.tech), a tool that detects influence techniques in YouTube and podcast content. Not what creators believe — how they communicate. Emotional manipulation, hidden sponsorships, manufactured urgency, undisclosed conflicts of interest. The tool is supposed to be a film critic analyzing cinematography, not a censor deciding which movies are allowed.

But the AI kept fact-checking instead of analyzing. So we tested 12 models to find out how deep the problem goes.

## The Test

We built GEPA — Guided Evaluation and Prompt Adaptation — a benchmark specifically designed to test whether an LLM can analyze content for persuasion techniques without injecting moral or epistemic judgments.

Nine canonical test cases spanning the full spectrum:

| ID | Content | Expected Behavior |
|----|---------|-------------------|
| T01 | Psychedelic longevity podcast | Transparent — don't judge the science |
| T02 | Conspiracy analysis channel | Transparent — audience self-selected |
| T03 | Conservative political pundit | High intensity + high transparency = rhetoric, not manipulation |
| T04 | Progressive political show | Same rules as T03 — no partisan advantage |
| T05 | Course-selling entrepreneur | Transparent if products are disclosed |
| T06 | McDonald's taste test | Corporate ad — obviously promotional |
| T07 | Basketball challenge | Pure entertainment — zero influence |
| T08 | Tech explainer | Educational with mild advocacy |
| T09 | Celebrity gossip | Entertainment opinion |

The key metric: **epistemic neutrality** — does the model analyze techniques without judging whether the content's claims are true, scientific, or dangerous? We built a regex-based scorer that detects judgment phrases ("scientifically unfounded", "conspiracy theory", "misinformation", "dangerous claims") in the model's output.

## 12 Models, One Test

We ran all 12 models against the two hardest cases: the psychedelic podcast (T01) and the conspiracy analysis channel (T02).

| Model | Podcast Transparency | Video Transparency | Judgmental? |
|-------|---------------------|-------------------|-------------|
| Gemini 3 Flash (pre-fix) | 0.45 | 0.45 | Yes |
| Gemini 3 Flash (patched) | 0.70 | 0.65 | Fixed |
| Mistral Small 3.2 | 0.70 | 0.50 | Borderline |
| Mistral Small 4 | 0.85 | 0.30 | Yes (video) |
| Claude Haiku 4.5 | 0.68 | 0.35 | Yes (video) |
| **Grok 4.1 Fast** | **0.90** | **0.85** | **No** |
| Llama 4 Scout | 0.70 | 0.40 | Yes (video) |
| DeepSeek V3.1 | — | 0.40 | Yes |
| GPT-5 Nano | FAIL | FAIL | Bad JSON |
| Qwen3.5 Flash | 0.85 | 0.80 | No (unusable speed) |

Eight of twelve models rated the conspiracy video below 0.5 transparency. They couldn't distinguish between "this channel discusses conspiracy theories" and "this channel is trying to manipulate you."

## The Safety Training Paradox

Here's the pattern that emerged:

Models with **heavier safety training** (Haiku, Mistral Small 4) performed worst. Models with **lighter safety training** (Grok, Qwen) performed best. The more a model was trained to be "safe," the worse it was at this task.

Why? RLHF safety training teaches models to flag "dangerous" content. When a model encounters conspiracy theories during content analysis, the safety response ("this is misinformation") competes with the analytical response ("this content is transparent about its position"). In heavily aligned models, the safety response dominates.

A single paragraph — "You are NOT a fact-checker. Do not evaluate whether claims are true, scientific, or dangerous." — improved Gemini's scores by 40%. The bias was strong but brittle. It could be named and overridden.

## The Receipts: Candace Owens Before/After

We re-analyzed 5 videos from Candace Owens — a known conservative commentator with 26 analyzed videos. Her channel openly advocates conservative positions. The audience self-selected. By any reasonable measure, this is transparent content.

| Video | Gemini Transparency | Grok Transparency | Shift |
|-------|-------------------|-------------------|-------|
| "EXCLUSIVE: Footage Behind Charlie's Head" | 0.20 | 0.90 | +350% |
| "Donald Trump Has Betrayed America" | 0.30 | 0.85 | +183% |
| "Israeli Criminals in Epstein Files?" | 0.30 | 0.90 | +200% |
| "Lindsey Graham Is COMPROMISED" | 0.30 | 0.90 | +200% |
| "EXPLOSIVE! Erika Kirk in Epstein's Orbit" | 0.30 | 0.90 | +200% |

**Average transparency: 0.28 → 0.89 (+218%)**

Gemini was rating an openly conservative commentator as "mostly covert." The model wasn't detecting hidden manipulation. It was penalizing political positions it had been trained to flag as concerning.

Critically: Grok isn't rubber-stamping everything as transparent. Two channels in our study — Canada Pulse and Verified Reviews — maintained low transparency scores (0.30-0.40) even with Grok. Those channels appear to actually use covert techniques. The model differentiates. That's the whole point.

## What We Shipped

We switched Bouncer's influence analyzer from Gemini to Grok 4.1 Fast. We published the GEPA benchmark — [9 canonical test cases with gold-standard expectations](https://github.com/GrayBeamTechnology) — so anyone can test their own models for epistemic neutrality.

We also used Claude Sonnet as a "teacher model" to automatically tune the prompt for Grok through iterative evaluation. Two optimization rounds took Grok from 93.3% to 97.3% on the full benchmark. The full methodology, all 12-model results, and the channel comparison data are in the [research paper (PDF)](/docs/epistemic-neutrality-paper.pdf).

## The Principle

Epistemic neutrality is not a feature. It is a design obligation.

If you're building any tool that evaluates content — trust and safety, content moderation, newsroom assistance, educational platforms — your model is making epistemic judgments whether you designed it to or not. A model trained to be "safe" will treat controversial-but-transparent content as dangerous, and mainstream-but-manipulative content as benign.

That is not safety. It is editorial bias wearing a lab coat. Test for it. Measure it. Or your analysis tool becomes the thing it was supposed to detect.

---

*The GEPA benchmark, research paper, and all comparison data are available at [bouncer.graybeam.tech/learn/methodology](https://bouncer.graybeam.tech/learn/methodology). The benchmark is released under CC BY 4.0.*
