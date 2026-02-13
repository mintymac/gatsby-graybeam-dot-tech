---
title: "Allostatic Flow: What Neuroscience Taught Me About Working With AI"
category: "Innovation"
author: McHughson Chambers
date: 2026-02-12
---

Your body doesn't have a thermostat. It has something better — a system that *predicts what temperature you'll need next* and starts adjusting before you get there. That system is called allostasis, and it turns out it's also the best framework I've found for working with AI agents all day without burning out.

## The Problem Nobody Talks About

There's a gap in the AI-assisted development conversation. Everyone is benchmarking models, comparing token costs, arguing about agents vs copilots. Almost nobody is talking about the human side: **what happens to your cognitive performance when you spend 8-10 hours a day collaborating with an AI that can context-switch infinitely while you cannot?**

I noticed it in myself first. After a productive morning spinning up parallel research agents, implementing a memory architecture in Elixir, adding pricing for a new model provider, and designing a behavioral regression system — all across different projects in a single session — I'd feel a specific kind of tired. Not physically tired. Not bored. Something more like... my pattern-matching had gone fuzzy. I could still write code, but I'd stopped seeing connections between things.

That's when I started reading about allostasis.

## Stability Through Change

In 1988, Peter Sterling and Joseph Eyer coined the term "allostasis" to describe something the homeostasis model couldn't explain: your body doesn't defend fixed set points. It *anticipates demands and adjusts proactively* ([Sterling & Eyer, 1988](https://www.scirp.org/reference/ReferencesPapers?ReferenceID=846297)). Your blood pressure before a meeting isn't the same as your blood pressure while sleeping — and that's not a bug, it's the system working correctly.

Bruce McEwen at Rockefeller University took this further with "allostatic load" — the cumulative wear-and-tear when your adaptive systems run hot for too long. The short version: stress hormones protect you in bursts but damage you chronically ([McEwen, 1998, *NEJM*](https://pubmed.ncbi.nlm.nih.gov/9428819/)). And critically, a 2020 meta-analysis confirmed that high allostatic load is significantly associated with degraded executive function and global cognition ([D'Amico et al., 2020, *Psychoneuroendocrinology*](https://pubmed.ncbi.nlm.nih.gov/32892066/)).

Executive function. That's exactly the thing you need most when you're the architect in a human-AI collaboration — the ability to see patterns, hold context across systems, make judgment calls about what matters.

## What This Means for AI-Assisted Development

Here's the connection I keep coming back to: **every context switch is an allostatic event.** When you jump from reading Elixir GenServer code to evaluating a new model's deployment requirements to reviewing a cartridge system's behavioral architecture, your brain is doing Sterling's anticipatory regulation — ramping up the neural resources for a new cognitive demand before the old one has fully discharged.

Do that all day with no structure, and you accumulate allostatic load. Your pattern-matching degrades. You stop seeing the connections between the morning's research and the afternoon's implementation. You lose flow.

But here's what's interesting: **the structure doesn't have to come from you.** It can come from your collaboration patterns with the AI.

## Teaching the AI to Reduce Your Load

I work with Claude Code daily across a portfolio of Elixir projects — family communication platforms, sports league management, AI agent architectures, deploy tooling. The collaboration lives in a file called `CLAUDE.md` — a set of instructions that Claude reads at the start of every session.

Over months, this file has evolved from "here's how to run the tests" into something more like a **shared nervous system regulation protocol.** A few things I've learned:

**1. The AI should explore before mapping.**

When I bring external research into a session — say, a digest of new AI models and papers — my first instinct is to ask "what's useful for my projects?" The AI's first instinct is to guess based on project names, then validate later. That produces speculative connections that waste cognitive effort evaluating low-relevance ideas.

Better: the AI reads the actual project files first, *then* maps relevance. This costs an extra minute of compute but saves me from having to mentally filter noise. I added this to my instructions:

> *"When asked to assess relevance of external information to projects, read the project files first, then map. Don't guess from project names."*

**2. Session reviews should be artifact-grounded, not conversation-grounded.**

At the end of a session, "how did we do?" should trigger the AI to scan the filesystem for files modified today, check git commits across repos, cross-reference planned vs shipped work. Not summarize from memory. The filesystem is ground truth — conversation memory drifts.

This gives me what I actually need: coherence patterns. Are today's changes moving in a unified direction? Are there loose threads connecting across projects? Where did momentum stall?

**3. The AI should push back to protect your flow.**

This is the counterintuitive one. When I ask the AI to research six items, and two of them are clearly low-relevance to active work, I *want* it to say "these two aren't worth your attention right now." Not because I can't figure that out myself, but because **evaluating relevance is itself an allostatic event.** Every "is this useful?" decision burns a small amount of executive function.

A collaborator that pre-filters reduces your load. A collaborator that presents everything equally increases it.

## Living Documents, Not Static Prompts

The `CLAUDE.md` file that governs my AI collaboration isn't a configuration — it's a living document that accumulates lessons from past sessions. When a collaboration pattern causes friction (the AI guesses instead of exploring, or sketches a design when I wanted working code), the pattern gets corrected *in the file*, not just in conversation.

This means the next session starts with better defaults. Over time, the file becomes a kind of distilled collaboration intelligence — not my preferences written down, but **the resolution of every tension between how I think and how the AI operates.**

There's a concept from Josh Waitzkin that captures this: "numbers to leave numbers." You start with explicit rules, practiced repetitively, until they become internalized character. The map becomes territory. A good `CLAUDE.md` works the same way — each rule was once a friction point that someone had to think about consciously. Now it's just how we work.

## The Shape of Allostatic Flow

I'm calling this "allostatic flow" — and I know that's not a term you'll find in the literature. But it names something real: **the state where your adaptive systems are engaged but not overloaded, where context-switching costs are absorbed by your collaboration infrastructure rather than your prefrontal cortex.**

It's not homeostatic flow (maintaining a fixed state — impossible in multi-project work). It's not just regular flow (which assumes a single sustained task). It's the dynamic version: moving between codebases, models, architectural levels, and research domains while maintaining coherent forward motion.

The practical requirements, as far as I can tell:

- **Predictable collaboration patterns** that don't require managing the AI
- **Artifact-grounded reviews** that show you the shape of your day
- **Proactive filtering** that reduces evaluation load
- **Living instruction files** that accumulate lessons rather than repeating mistakes
- **The AI asks the right clarifying questions** before you realize you need to ask them

None of this is about making the AI smarter. It's about making the collaboration *smoother* — reducing the allostatic cost of each interaction until the human can sustain creative output across a full working day without the pattern-matching going fuzzy by 3pm.

## What's Next

I'm continuing to iterate on this. Today's session produced a new memory architecture for a family AI assistant, integrated a new model provider, and designed a behavioral regression system for a UI framework — all guided by a curated research digest that got triaged through relevance filters before I had to evaluate anything myself.

The `CLAUDE.md` got two new sections today. By next month it'll have more. Each one is a small reduction in allostatic load, a small increase in sustainable flow.

I think this matters more than most people realize. The bottleneck in AI-assisted development isn't the AI's capability. It's the human's ability to stay coherent while leveraging that capability across complex, multi-project work. Allostasis gives us a framework for thinking about that problem — and more importantly, for designing collaboration patterns that solve it.

---

*Exploring adaptive collaboration patterns at Gray Beam Technology. Built with Elixir, Claude Code, and too many open browser tabs.*

**Version**: 1.0
**Classification**: Public
**Timestamp**: 2026-02-12T22:00:00Z
