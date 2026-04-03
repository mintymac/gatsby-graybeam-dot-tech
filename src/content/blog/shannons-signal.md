---
title: "Shannon's Signal: Why We Stopped Organizing and Started Measuring Surprise"
category: "Innovation"
author: McHughson Chambers
date: 2026-04-03
---

We had 155 clips in our vault. AI conversations, YouTube transcripts, voice notes, Telegram forwards. A health insight about your visual cortex burning 44% of your brain's energy budget sat next to a SpinCulture bug report sat next to an Andrej Karpathy interview about code agents.

The natural instinct was to organize them. PARA method — Projects, Areas, Resources, Archives. File things into folders. Build a taxonomy. Auto-classify on capture.

So we asked Claude Shannon what he thought.

Not literally. We built a subagent with Shannon's thinking — information theory first principles, applied to the problem of personal knowledge management. His answer was blunt: **PARA is the wrong codebook.**

## The Problem with Categories

PARA is a fixed-length code applied to a variable-entropy source. Every clip gets the same structural overhead — a category, a folder, a filing decision. But clips have wildly different information content.

A SpinCulture bug report has near-zero surprise. You already know what SpinCulture is, you know it has bugs, and the bug report confirms what you expect. Filing it under "Projects > SpinCulture" costs you a decision and tells you nothing new.

"Your visual cortex burns 44% of your brain's energy budget" — that's high entropy relative to your current model of the world. It connects to health, to UI design, to cognitive load theory, to why turning off the lights in the shower resets your mental state. Filing it under "Areas > Health" *buries the surprise*. The interesting thing about this clip isn't that it's about health. It's that it's about health *and* it connects to engineering.

Shannon's insight: the most valuable clips are the ones that don't fit your existing categories. A strict taxonomy suppresses exactly the cross-domain connections that make a personal knowledge system worth having.

## Three Instruments Instead of Filing Cabinets

Shannon proposed three capabilities, each grounded in information theory:

### 1. The Information Gain Scorer

For every incoming clip, compute: how surprising is this relative to everything I already know?

We do this with embedding vectors. Every clip gets a 1024-dimensional vector from Qwen3-Embedding-0.6B (running on a local GPU). We compute the vault centroid — the average direction of all existing clip embeddings — and measure the cosine distance of each new clip from that centroid.

| Metric | What it means |
|--------|--------------|
| Gain ≈ 0.0 | Redundant — you already know this |
| Gain ≈ 0.3 | Moderate surprise — related to existing knowledge |
| Gain ≈ 0.5 | Orthogonal — completely new domain |
| Gain ≈ 1.0 | Opposite to everything you know |

The math: `information_gain = (1.0 - cosine_similarity(clip, centroid)) / 2.0`

Our first real run surfaced "Cell phone radiofrequencies make mice live longer" (gain: 0.33) as the most surprising clip. That's a clip about biology and electromagnetic fields — nothing in our vault of AI conversations and software engineering talks is anywhere near it. A PARA system would file it under "Resources > Health" and forget about it. The gain scorer flags it as *the most interesting thing you captured this month*.

### 2. The Confidence Router

When a clip *does* clearly belong somewhere, route it automatically. But instead of mapping to PARA categories, route to your actual projects and areas — the ones with embedding vectors of their own.

The key metric is **confidence**: the gap between the best match and the second-best match. A large gap means the clip clearly belongs to one place. A small gap means it's ambiguous.

High confidence → auto-route (Channel A). This is mechanical. A commit message about SpinCulture routes to SpinCulture. No human decision needed.

Low confidence → daily digest (Channel B). These are the clips the system *can't classify*. They're ambiguous, cross-domain, or genuinely novel. **These are your most valuable clips.** They go into a human-reviewed digest, not a folder.

The boundary between channels is the classifier's own uncertainty, not a taxonomy you imposed.

### 3. The Collision Detector

This is the one Shannon would have loved.

When two clips from *different domains* land near each other in embedding space, that's a collision. "Visual cortex energy budget" near "GPU power optimization" — health meets engineering. "Polyvagal theory" near "OTP supervision trees" — nervous system regulation meets fault-tolerant systems.

These collisions are invisible in a PARA system. Health clips live in the Health folder. Engineering clips live in the Engineering folder. They never meet. The collision detector specifically looks for cross-domain proximity — things that *shouldn't* be near each other but are.

We implement this as a nearest-neighbor query filtered by domain. If the embedding similarity is above 0.75 and the domains differ, it's a collision worth surfacing.

## How We'll Know It's Working

This is the honest part. We shipped the Signal module with 25 tests and real embeddings flowing. But measuring whether an *information-theoretic knowledge system* actually works is harder than measuring whether a CRUD app works.

Here's our scorecard:

**Leading indicators (measurable now):**

| Metric | Target | How we measure |
|--------|--------|----------------|
| Clips with embeddings | 100% of clips | `SELECT count(*) WHERE embedding_status = 'completed'` |
| Information gain distribution | Bell curve, not flat | Histogram of gain scores — flat means the metric isn't discriminating |
| Routing confidence > 0.5 | 60%+ of clips | High confidence = the router is useful, not just guessing |
| Collisions surfaced per week | 2-5 | Too few = threshold too high. Too many = noise. |

**Lagging indicators (weeks to measure):**

| Metric | Target | How we measure |
|--------|--------|----------------|
| Daily digest review rate | Mac reviews 80%+ of digests | If the digest is useful, you read it. If it's noise, you ignore it. |
| Collision-to-insight conversion | 1 in 5 collisions leads to a connection Mac acts on | Track which collisions get clicked, starred, or referenced in work |
| Heartbeat briefing quality | Briefings reference surprising clips | Does the morning briefing mention the visual cortex clip when talking about UI work? |
| Search-before-classify ratio | Declining over time | If you're searching less because the system surfaces things proactively, it's working |

**The kill metric:** If after 30 days, the daily digest has a lower open rate than the heartbeat briefing, the Signal layer isn't earning its keep. We rip it out and go back to full-text search.

## The Architecture

The whole system is self-hosted. Three roles, split by workload:

```
Vault Node                   LLM Node                     Embedding Node
┌──────────────────┐         ┌─────────────────────┐       ┌──────────────────┐
│ Clip capture     │         │ Qwen3.5-35B          │       │ Qwen3-Embedding  │
│ Signal scoring   │ ──────> │ Heartbeat agent      │       │ 0.6B             │
│ Collision detect │         │ inference            │       │ 1024-dim vectors │
│ Daily digest     │         │                      │       │                  │
│ Phoenix LiveView │         └─────────────────────┘       └──────────────────┘
└──────────────────┘                                              │
        │                                                         │
        └──── embedding requests ─────────────────────────────────┘
```

The vault node runs the application and tools where the data lives. LLM inference runs on a GPU node for heartbeat generation. Embedding inference runs on a separate GPU node. Everything connects over BEAM distribution on a private network. Zero data leaves your infrastructure.

The Signal module is 167 lines of pure functional core (cosine similarity, information gain, centroid, routing, collision detection) and 225 lines of imperative shell (DB queries, pgvector operations). No external dependencies beyond pgvector and the embedding API.

## The Deeper Point

Shannon proved in 1948 that reliable communication over a noisy channel is possible — you just need the right encoding. The noisy channel here is your daily information stream. Tweets, conversations, articles, videos, voice notes. Most of it is noise. Some of it changes how you think.

The filing cabinet approach (PARA, tags, folders) treats all information as equally worth organizing. Shannon's approach treats organization as a compression problem: what's the minimum structure that preserves the signal?

The answer isn't categories. It's three numbers: how surprising is this, how confidently can I route it, and what else is it unexpectedly close to.

We'll find out in 30 days whether that's enough.
