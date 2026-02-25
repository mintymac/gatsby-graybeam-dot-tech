---
title: "Brand Studio: What Happens When AI Generates Your Brand Identity"
category: "Product"
author: McHughson Chambers
date: 2026-02-22
---

Maria owns a bakery called Sweet Rise. She makes sourdough, cinnamon rolls, and the kind of almond croissant that makes people drive twenty minutes out of their way on a Tuesday. Her brand identity is a logo her cousin made in Canva four years ago and a color palette that happened because she liked the shade of her kitchen wall.

She knows she needs better branding. She's talked to three agencies. The cheapest quoted $8,000 and six weeks. The most expensive wanted a "brand discovery workshop" that sounded like it involved trust falls.

We built something different.

## The Problem with Brand Design

Traditional brand design follows a broken workflow: client fills out a questionnaire, designer disappears for two weeks, comes back with three options that may or may not reflect what the client actually wanted, client picks the least wrong one, designer refines, repeat until budget runs out or patience does.

The fundamental issue is translation loss. Maria knows exactly how her bakery should feel — warm, handcrafted, Saturday-morning-ish. But she can't articulate that in design language. She says "warm" and the designer hears "orange." She says "artisan" and gets a logo that looks like every other hipster coffee shop in Brooklyn.

What if instead of describing what she wants, Maria could just... point at it?

## What We Built

Brand Studio is an AI-powered visual exploration tool. Instead of translating feelings into design briefs, it generates visual options and lets you react to them. The methodology has three roles:

**The AI** generates brand assets — mood boards, logos, color palettes, typography systems, component sheets. It doesn't guess once. It generates batches, learns from your reactions, and generates again.

**The Practitioner** (that's us) tunes the generation — adjusting prompts, adding constraints, curating what the client sees.

**The Client** (that's Maria) does the only thing she needs to do: pick the ones that feel right.

## Maria's Session

Here's what actually happened when we ran Maria through the system.

### Intake: A Conversation, Not a Form

Maria didn't fill out a questionnaire. She had a conversation. Brand Studio's intake is a chat interface that asks questions one at a time, in plain language:

*"What does your business do?"*

"I run a bakery. We do sourdough, pastries, cinnamon rolls. Everything from scratch."

*"When a customer walks in, what do you want them to feel?"*

"Like they're walking into someone's kitchen. Warm. Like everything was made that morning because it was."

The system asked about her customers, her competitors, what she explicitly didn't want (corporate, sterile, chain-bakery vibes). When it hit a contrast pair — "Bold & Electric vs. Warm & Approachable" — Maria tapped "Warm & Approachable" and it immediately moved on. No extra clicks. The interface got out of her way.

Behind the scenes, Claude extracted a brand narrative from the conversation:

> *Your brand is the warm kitchen where somebody's already made something for you — not because they had to, but because they noticed you were coming. There's real skill behind what you do, but you wear it lightly, like an inside joke only you and your customers share.*

Maria read that and said, "That's exactly it." No rounds of revision. No "close but not quite." The AI nailed the vibe because Maria had expressed it in her own words, not through a structured form that lost the nuance.

### Mood Boards: Show, Don't Tell

This is where it gets interesting. Brand Studio generated a batch of mood boards — collages of textures, colors, photography styles, and typographic treatments that represent different visual directions for Sweet Rise.

Three boards appeared simultaneously. One leaned editorial and minimal — black and white photography, clean sans-serif type. Another went full rustic — burlap textures, hand-drawn type, earth tones verging on cliche. The third hit a middle ground: warm natural light on real pastries, handcrafted feel without the Pinterest-farmhouse aesthetic, typography that felt personal but not sloppy.

Maria starred the third one. Her rationale: *"This one feels like walking into my bakery on a Saturday morning — warm, inviting, real."*

That's the entire decision. No design vocabulary required. No back-and-forth about whether "warm" means amber or terracotta. She pointed at the thing that felt right, said why in her own words, and the system locked it in.

### What Happens Next

The mood board winner becomes the foundation for everything that follows. The color phase extracts and explores palettes derived from the winning mood. The logo phase generates mark systems that live in that visual world. Typography. Component design. Each phase feeds forward — the AI doesn't start from scratch, it builds on accumulated decisions.

By the end, Maria has a complete brand identity: logo system, color palette, type hierarchy, component library, and a brand book — all generated from her reactions to visual options, not from her ability to brief a designer.

## The Technical Bit

Brand Studio runs on Elixir and Phoenix LiveView. Image generation happens through Gemini's multimodal API via background Oban jobs — you see placeholders that fill in as images arrive, no page refresh, no waiting on a spinner. The real-time collaboration layer means Maria and her business partner could both be looking at the same mood boards, starring their favorites independently, and the system tracks who liked what.

Every interaction is an event in a session timeline. Generate, star, reject, annotate, select — it's all recorded. The practitioner can see the full decision archaeology: which options were considered, which were rejected, and why. This matters when the brand needs to evolve later. Instead of "the designer who did our branding left and nobody remembers why we picked this shade of blue," you have a complete record of every decision and the reasoning behind it.

Prompt engineering is hidden from the client entirely. Maria never sees a prompt. She sees options and makes choices. The practitioner layer handles the translation between "warm and Saturday-morning-ish" and the specific generation parameters that produce images matching that description.

## What This Changes

The traditional brand design process optimizes for designer expression. The client provides input, the designer interprets it, and the output reflects the designer's skill at translation.

Brand Studio optimizes for client recognition. The AI generates breadth — many options, quickly, cheaply. The client's job is pattern recognition, not articulation. Humans are remarkably good at knowing what feels right when they see it, even when they can't describe it in advance.

This doesn't replace designers. It replaces the expensive, lossy translation step. A skilled practitioner using Brand Studio can explore more visual territory in an afternoon than a traditional process covers in a month. The client gets to react to real artifacts instead of imagining what a mood board description might look like.

Maria's brand exploration took one session. The AI generation cost was under a dollar. She walked away with a mood direction that felt authentically hers — not because she designed it, but because she recognized it.

That's the difference between generation and translation. You don't need to speak design to know what feels like home.

## Try It

Brand Studio is live at [brandstudio.graybeam.tech](https://brandstudio.graybeam.tech). We're running early client explorations now — if you have a brand that needs finding, not just designing, reach out.
