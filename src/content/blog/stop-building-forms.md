---
title: "Stop Building Forms: Why AI Products Still Feel Like 2014"
category: "Product"
author: "McHughson Chambers"
date: 2026-02-25
draft: false
---

I just caught myself building a form. Not a useful form — a *redundant* form. Inside a product whose entire thesis is that AI should do the heavy lifting, I built a second intake form because the page needed data and my instinct was to ask the user for it. Again.

Let me tell you how this happened, because the failure mode is instructive.

## The crime

We're building [Brand Studio](https://brandstudio.graybeam.tech), an AI-powered brand exploration tool. The workflow has an intake phase — a conversational interface where you tell the AI about your brand. Personality, aspirations, competitors, visual inspirations. It synthesizes a brand narrative. That part works.

Then we built an "Explore" phase — the part where the AI generates holistic brand concepts (logo + color + vibe + typography all at once) and you react to them. Star the ones that resonate. Say "show me more" or "this is my brand." The AI tracks which dimensions of your brand are settling and which are still in flux.

Beautiful architecture. Pure functional core. Parallel dimension settlement modeled as a colored Petri net. I'm proud of the FSM.

And the first thing the user sees when they click "Explore"? A form. Brand name (which we already have). Description (which we already have). Vibe words (which we could infer). Extra context (which they already provided in intake).

A goddamned form. In the age of AI.

## Screen-thinking vs. story-thinking

Here's the root cause: we've been thinking in screens. "What does the explore page look like?" is a screen question. It leads to wireframes, which lead to "what data does this screen need?", which leads to input fields. Screen-thinking produces functional software that nobody loves.

The right question is: **what does the user experience when they click "Explore"?**

They should experience *momentum*. They told the AI everything it needs to know. They click Explore and the AI is already working. Concepts start appearing. The room is already set up. The lights are on. The AI knows you.

That's story-thinking. The user's action — clicking the button — is the inciting incident. Everything after that should feel like consequence, not setup. You don't pause a movie to fill out a questionnaire about what kind of movie you want to watch.

## Filmmaking, not engineering

We need to think like filmmakers, not engineers. Not because engineering doesn't matter — the architecture underneath Brand Studio is genuinely elegant, and it needs to be, because the real-time collaboration and parallel settlement tracking are hard problems. But the architecture is *scaffolding*. The user never sees scaffolding. They see the building.

Filmmakers think about:
- **The cut.** What's the transition between this moment and the next? A form is a hard cut to a static frame. Concepts appearing as you land is a match cut — momentum carries through.
- **The reveal.** Information appears when it's emotionally relevant, not when it's structurally convenient. Showing all four dimensions (vibe, logo, color, type) in a settlement bar before the user understands what dimensions are? That's exposition dump. Let the concept images speak first.
- **The rhythm.** Generate, react, refine. Generate, react, refine. That's a beat structure. Interrupting it with "please fill in your brand name" breaks rhythm.
- **Point of view.** The practitioner's view is dense, data-rich, analytical. The customer's view is warm, spacious, decisional. Same story, different camera angles. Different font stacks, even (we already had this insight — monospace for practitioners, variable-width for customers). But we weren't applying it to flow, only to rendering.

## The form is a symptom

Every unnecessary form in an AI product is a confession: *we didn't trust our own system to use what it already knows.*

It's also a failure of imagination. When you can't picture what the AI should do with the context it has, you default to asking the user for more context. It feels productive. It's actually cowardice.

The fix for Brand Studio's explore page is simple: pull the brand story from the project (it's already there from intake), have the AI infer the vibe words from the narrative (it's a text model — this is trivial), and start generating concepts the moment the user lands. Zero forms. Zero friction. The button IS the intent.

## Toward a story-driven stack

This is bigger than one form on one page. We're building a methodology at [GrayBeam](https://graybeam.tech) that we call the functional core / imperative shell pattern — borrowed from Gary Bernhardt's architecture, applied to product design. The functional core is pure logic. The imperative shell handles side effects. Clean separation. Testable. Beautiful.

But there's a missing layer. Between the functional core (what the system *knows*) and the imperative shell (what the system *does*), there should be a **narrative layer** — what the system *tells*. How does it communicate state? Not with toast notifications and loading spinners, but with story beats. The AI is thinking. The concepts are forming. Your brand is taking shape. Here's what's settling. Here's what's still in flux.

Eventually — and this is the part that gets me out of bed — this narrative layer won't be hardcoded. It'll be adaptive. We're building a cognitive profiling system called [Bump](https://bump.graybeam.tech) that maps how individuals process information. Some people are visual-spatial. Some are verbal-sequential. Some need the big picture first; others need the details.

The same brand exploration, the same functional core, rendered through different narrative structures depending on who's looking at it. A visual thinker sees a constellation of concepts with spatial relationships. A verbal thinker sees a structured brief with rationale. A kinesthetic thinker gets an interactive sandbox.

Same story. Different telling. All generated by an AI translation layer that knows the user's cognitive profile.

## The rant, in summary

1. **Stop asking users for data you already have.** If your AI product has a form that collects information a previous step already captured, you failed.
2. **Think in journeys, not screens.** Every wireframe is a lie — it shows a frozen moment without the transitions that give it meaning.
3. **Design like a filmmaker.** Cuts, reveals, rhythm, point of view. These aren't metaphors. They're design tools.
4. **The narrative layer is the missing abstraction.** Between "what the system knows" and "what the system does" is "how the system tells." Build that layer.
5. **Adaptive storytelling is the endgame.** One functional core. Many narrative renderings. Personalized to the human on the other end.

We caught the form. We'll kill it. But the larger lesson is that screen-thinking is the default mode for everyone building software right now — including people building AI software. The AI revolution won't feel revolutionary until we stop building forms and start building stories.

---

*Brand Studio is an open exploration of what happens when AI generates your brand identity. We're building in public at [GrayBeam](https://graybeam.tech).*
