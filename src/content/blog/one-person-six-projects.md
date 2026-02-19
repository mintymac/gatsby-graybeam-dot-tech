---
title: "One Person, Six Projects, Two Days: What AI-Augmented Solo Development Actually Looks Like"
category: "Innovation"
author: McHughson Chambers
date: 2026-02-18
---

There's a version of the "AI makes you productive" story that goes like this: developer uses Copilot, writes code faster, ships feature, done. That version is boring and mostly true and not very interesting.

Here's a different version. Over two days — Monday and Tuesday — I shipped 40 commits across 6 production projects. Not prototypes. Not demos. Tested, linted, deployed production code with real users. The projects ranged from a brand exploration studio to a sports league platform to a medical credentialing system.

I want to talk about what that actually looks like in practice, because the interesting part isn't the volume. It's the *coherence*.

## The Numbers

**Monday, February 17:**

| Project | Commits | What shipped |
|---------|---------|-------------|
| AI Brand Studio | 10 | 7 features built from a Sunday demo wishlist: aversion constraints, chooser links, crossover mixing, presence indicators, copy generation, vector exports, prompt layer archaeology |
| GridPlay | 7 | Timestamp reliability sprint, nightly Telegram digest, in-app browser detection |
| Credential Vault | 7 | Three phases of product build: NPI lookup, CAQH profile import, auth hardening. Plus landing page and deploy migration |
| AI App Forge | 2 | Methodology docs: hardening patterns, common deploy failures |
| Graybeam LLM | 1 | Prompt hashing for dedup and telemetry |
| Trimtab | 1 | Production readiness audit checks |

**Tuesday, February 18:**

| Project | Commits | What shipped |
|---------|---------|-------------|
| AI Brand Studio | 12 | Entire color phase pipeline (schema, ramp generator, palette editor, hero color flow, swatch preview), curated client selection, admin metrics, provider failover, then guided brand revelation (coaching content, narrative synthesis, contextual guidance) |

28 commits on Monday. 12 on Tuesday. 244 tests passing. Zero Credo warnings. Every change deployed same-day.

## Why Volume Isn't the Point

Forty commits in two days is a vanity metric. You can inflate commit counts by splitting work into tiny pieces. You can ship fast by skipping tests. You can touch many projects by doing shallow work in all of them.

What's harder to fake is **cross-project coherence** — the thing where changes in one project feed directly into another, where a library improvement in the morning becomes a product feature by afternoon, where lessons learned debugging in one codebase get encoded as prevention in all the others.

Here's what that looked like concretely:

**Monday morning:** I added prompt hashing to `graybeam_llm` (my shared LLM library). **Monday afternoon:** Brand Studio used that prompt hash for generation telemetry — tracking which prompts produce which results, detecting duplicates.

**Monday:** Brand Studio's form inputs were getting wiped on LiveView re-renders — a subtle bug where `phx-change` wasn't tracking textarea state. I fixed it, then added the lesson to the global `CLAUDE.md` that governs all projects: *"Track ALL user-editable inputs via phx-change."* **Tuesday:** When building the color phase palette editor (a component-heavy LiveView with many interactive inputs), the agent already knew this pattern and got it right the first time.

**Monday:** I updated the `ai-app-forge` methodology with hardening patterns. **Tuesday:** Brand Studio's guided revelation feature implemented that methodology — the coaching content came directly from the principle that *"It's the difference between 'here's a form to fill in' and 'here's how a brand actually gets built.'"*

None of these connections were planned. They emerged from a system that maintains context across projects.

## The System, Not the Speed

The infrastructure that enables this isn't AI code generation. It's four things:

### 1. Living instruction files

Every project has a `CLAUDE.md` — a document the AI reads at the start of every session. It contains architectural decisions, known pitfalls, coding patterns, and accumulated lessons from past mistakes. Mine is 250+ lines and growing. It includes entries like:

> *"Silent LiveView crashes show nothing — when handle_event crashes, the user sees zero feedback. Always check server logs when an interaction 'does nothing.'"*

This isn't documentation for humans. It's **institutional memory for human-AI collaboration.** Each rule was a bug that cost time once. Now it costs nothing.

### 2. Cross-project memory

Beyond per-project instructions, I maintain global patterns that apply everywhere:

> *"Broadcast ALL terminal states via PubSub — if you broadcast :generating and :complete, you MUST also broadcast :failed. Missing failure broadcasts leave the UI stuck in loading state forever."*

This was a Brand Studio bug that got promoted to a global rule. Now every Elixir project I work on — current and future — inherits the fix before writing a line of code.

### 3. Quality infrastructure that runs automatically

Every Elixir project has a `mix precommit` alias that runs compilation with warnings-as-errors, dependency checks, formatting, Credo (static analysis), and the full test suite. A git pre-commit hook enforces it. The AI can't commit broken code even if it wanted to.

This matters because **speed without quality is just technical debt on a payment plan.** The 40 commits all passed the same quality bar a human reviewer would enforce.

### 4. Deploy pipelines that make shipping boring

Each project deploys with a single command. Brand Studio: `graybeam deploy --skip-build --force`. GridPlay: same tool. The deploy runs in 28 seconds, does an atomic symlink switch, health-checks the endpoint, and rolls back automatically on failure.

When deploying is boring, you deploy more often. When you deploy more often, the distance between "idea" and "user feedback" shrinks. That's where the real productivity gain lives — not in writing code faster, but in *learning faster*.

## What the AI Actually Does

Here's what people get wrong about AI-augmented development: it's not about the AI writing code for you. It's about the AI **maintaining context you can't hold.**

I can't keep the architectural patterns of 6 projects in my head simultaneously. I can't remember that Credential Vault uses port 5433 while Brand Studio uses 5435. I can't recall that three months ago I learned that `Ecto.Changeset.timestamps()` produces `NaiveDateTime`, not `DateTime`, and that this matters when you call `DateTime.to_unix/2`.

The AI can. It reads the instruction files, the memory files, the codebase patterns. It carries forward lessons from previous sessions. It knows that when I add a new assign to a LiveView component, it needs to use bracket access (`assigns[:key]`) instead of dot access (`@key`) to avoid crashing existing user sessions during hot deploys.

That's not code generation. That's **cognitive load distribution.** The human stays in the architectural/creative zone. The AI handles the accumulated institutional knowledge that would otherwise require either a team with shared documentation or a single developer with an impossibly good memory.

## The Honest Caveats

This isn't a productivity hack. It's a way of working that has real tradeoffs:

**Breadth vs. depth.** Touching 6 projects in a day means none of them got the kind of deep, sustained focus that produces breakthrough architecture. The color phase pipeline I built on Tuesday works, is tested, and is deployed — but it was designed in hours, not weeks. Some decisions will need revisiting.

**Volume vs. validation.** Shipping 7 features from a demo wishlist in one day means none of them got real user testing before the next one started. The guided revelation feature is live in production, but I don't yet know if users actually find the coaching helpful. Fast shipping only pays off if you close the feedback loop equally fast.

**AI leverage vs. AI dependency.** The system works because the instruction files, memory files, and quality infrastructure create a flywheel. But if I lost access to the AI tomorrow, those 6 projects would each need a developer who could ramp up independently. The institutional knowledge is encoded in files the AI reads, not in a team's shared understanding.

These are real concerns. I mention them because the productivity story is only useful if it's honest.

## What I'd Tell Someone Starting This

**Start with the instruction file, not the code.** Your `CLAUDE.md` or equivalent is the highest-leverage artifact in your entire workflow. Every hour spent refining it saves days of repeated mistakes.

**Build quality gates before you build features.** Pre-commit hooks, linters, test suites. Make it impossible to ship broken code before you start shipping fast. Speed without quality is just a more exciting way to create problems.

**Record lessons at the point of pain.** When a bug costs you 30 minutes, don't just fix it — write down why it happened and how to prevent it. Put it in the instruction file. The AI reads it next session. You never pay that cost again.

**Deploy infrastructure is a multiplier.** If deploying takes 20 minutes and manual steps, you'll deploy once a day. If it takes 28 seconds and one command, you'll deploy after every meaningful change. The difference compounds.

**The AI is a context bridge, not a code monkey.** The value isn't "write this function for me." It's "remember that this project uses port 4004, that the production server needs `include_erts: false`, that the Telegram bot requires `/setdomain` on BotFather, and that the last time we added a new LiveView assign it crashed existing sessions."

---

Two days, six projects, forty commits. Not because the AI writes code fast — because the system maintains coherence across a scope that would normally require a team. The bottleneck was never typing speed. It was always context.

---

*Built with Elixir, Phoenix LiveView, Claude Code, and a `CLAUDE.md` file that keeps getting longer.*

**Version**: 1.0
**Classification**: Public
**Timestamp**: 2026-02-18T21:00:00Z
