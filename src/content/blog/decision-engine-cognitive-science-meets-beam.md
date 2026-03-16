---
title: "Why Decision Tools Fail: What Cognitive Science Taught Us About Building a Real One"
category: "Product"
author: McHughson Chambers
date: 2026-03-16
---

We set out to build a decision engine and discovered that almost every decision tool in existence is solving the wrong problem.

The charts are beautiful. The comparison matrices are thorough. The weighted scoring models are mathematically sound. And people still stare at the output thinking "okay, but what do I actually *do*?"

This is the story of what we found when we stopped engineering and started reading — and how it completely changed what we built.

## The Uncomfortable Discovery

We did something unusual for a software team: before writing any code, we spent a full day in the research. Not skimming blog posts — actually reading Gary Klein, Daniel Kahneman, Dave Snowden, Chip Heath. We wanted to understand how humans make decisions in the real world, not how textbooks say they should.

The findings were uncomfortable.

**87% of expert decisions don't involve comparing options at all.** Klein studied fireground commanders, ICU nurses, and military officers making high-stakes decisions under time pressure. They didn't weigh pros and cons. They recognized the situation as familiar, mentally simulated one course of action, and went with it — unless the simulation revealed a problem.

This is called the Recognition-Primed Decision model, and it demolishes the assumption behind every comparison matrix ever built: that people decide by evaluating options side by side.

**Most decision failures happen before the choosing begins.** Endsley's situation awareness research showed that when decisions go wrong, it's usually because the person misunderstood the situation — not because they picked the wrong option from a correctly understood set. They solved the wrong problem competently.

**The number-one predictor of decision quality isn't analytical rigor.** It's whether the person considered more than one way to frame the problem. Heath's research across hundreds of organizational decisions: framing a decision as "should I do X?" fails 52% of the time. Considering at least two frames drops the failure rate to 32%.

That twenty-point gap isn't about better analysis. It's about better *understanding*.

## Where the Thinking Actually Happens

The textbooks say: define the problem, generate options, evaluate, choose. That's not what people do. Synthesizing across NDM research, macrocognition, and field studies, we found five actual stages:

**Stage 1: "Something's off."** Problem detection. Often subconscious — a nurse walks into a patient's room and feels something is wrong before she can say what.

**Stage 2: "What's really going on?"** Sensemaking. Constructing a coherent story about the situation. **This is where the overwhelming majority of cognitive effort goes.** Not choosing — understanding.

**Stage 3: "If I do X, what happens?"** Mental simulation. People can only run these forward about three causal steps before the model degrades. They test one option at a time, not all of them in parallel.

**Stage 4: "I'm going with this."** Commitment. It's not a dramatic choice — it's a confidence threshold. If the simulation didn't reveal a showstopper, you're in.

**Stage 5: "That didn't go exactly as planned."** Adaptation. Continuous monitoring and adjustment. Decisions don't end when you choose.

Every decision tool we've ever used lives in Stage 4. But Stages 2 and 3 are where people are actually stuck. And almost nothing helps them there.

## The Failure Mode Nobody Talks About

Klein identifies premature closure as the single most common decision failure across every domain studied. In diagnostic medicine, it was present in 74% of diagnostic errors.

Here's how it works: you encounter a situation, your brain pattern-matches to something familiar, a frame snaps into place, and you shift from "figuring out" mode to "executing" mode. It feels good — the ambiguity resolves, you have a plan. But the frame might be wrong.

The insidious part: once a frame locks in, new information gets bent to fit it rather than used to question it. You don't notice you're doing this. You're not being lazy or careless — it's how pattern recognition works.

Gathering more data doesn't fix this. If your frame is wrong, you just accumulate more evidence that confirms a bad interpretation. You need something that challenges the frame itself.

## What a Decision Tool Should Actually Do

The research pointed us toward a very different kind of tool:

**Help people frame before they choose.** The most valuable intervention isn't better analysis of options — it's ensuring the person understands what kind of problem they're facing. Is this a crisis that needs immediate action? A trade-off that needs careful weighing? A complex situation that requires experimentation? A social dynamic with competing stakeholders?

The answer changes everything about how you approach it. And most people never explicitly ask the question.

**Surface hidden assumptions.** Every decision rests on assumptions that feel so obvious they go unstated. "Of course demand will stay constant." "Obviously our team can handle the operational complexity." These invisible assumptions are where decisions silently go wrong.

We found that asking someone "what if price were different?" produces shallow adjustments. But asking "what are you assuming about demand, and what happens if you're wrong?" produces genuine reconsideration.

**Extend mental simulation beyond three steps.** People can mentally walk through about three causal steps — "if I do A, then B happens, then C follows." After that, the model falls apart. A decision tool should be able to say: "you're thinking three steps ahead, but here's what happens at step five."

This isn't AI making the decision. It's AI extending the human's own reasoning further than they can go unaided.

**Run the pre-mortem.** Klein developed a technique where you imagine the decision has already failed spectacularly, then explain why. Research shows this increases risk identification by 30% compared to asking "what might go wrong?"

The mechanism is fascinating: people who are told "this plan succeeded, explain why" produce bland confirmations. People told "this plan failed, explain why" produce specific, actionable risks they were previously suppressing to maintain group optimism.

## The Anti-Patterns We're Trying to Avoid

The research on AI-assisted decision-making had warnings too.

**Automation bias is real and unique to AI.** A 2024 meta-analysis from MIT found that human-AI teams on average failed to outperform AI-only systems — because humans introduced errors, bias, and delays when overriding correct AI answers. People over-rely on AI in ways they don't over-rely on human advisors.

**Alert fatigue destroys everything.** Clinical decision support systems that generated too many alerts saw 96% override rates. When everything is highlighted as important, nothing is.

**False precision causes anxiety, not clarity.** "Decision Clarity: 67.3%" sounds scientific but means nothing. Our persona testing caught this early — a non-technical user said the percentage "makes me nervous without telling me what to do about it."

**The most dangerous anti-pattern: making users feel informed without actually helping them think.** A polished dashboard with beautiful charts can feel productive while leaving the user no better equipped to decide. The feeling of understanding is not understanding.

## What We Actually Built

We built an engine that takes a decision query and does four things:

**First, it identifies what kind of problem you're dealing with.** Not as a label — as a cognitive scaffold. A crisis needs a different thinking structure than a trade-off. A planning problem over time needs different tools than a stakeholder negotiation. The classification determines the entire decision framework that follows.

**Second, it challenges your framing.** The sensemaking layer doesn't just present analysis — it examines the analysis itself. What are you assuming? What would a completely different interpretation look like? What's missing that you haven't considered?

When we tested this with a real query — "should we hire a DevOps engineer or use a managed platform for our 3-person startup?" — the engine came back with: "At 3 people, this is really a survival/focus problem disguised as an infrastructure decision. The meta-question — should we be making this decision at all right now? — might matter more than the answer itself."

That reframe is worth more than any weighted matrix.

**Third, it simulates consequences.** Not by asking the LLM "what happens if..." — that's just generating plausible text. We built an actual causal inference engine based on Judea Pearl's Structural Causal Model framework. The LLM's analysis gets converted into a causal graph where nodes are factors and edges are causal relationships. When you change an assumption, the change propagates through the graph mathematically.

This means "what if cost doubles?" isn't an opinion — it's a computation that respects the causal structure the LLM identified.

**Fourth, it tells you how this could fail.** The pre-mortem doesn't just list risks. It produces a vivid failure narrative: "It's 6 months later. Here's exactly what went wrong." Root causes. Early warning signs you should watch for. And tripwires — specific conditions that should make you reconsider.

One of the tripwires from our test: "If non-DevOps team members can't independently deploy a code change within 2 weeks of the DevOps hire start date, mandate that all infrastructure must be reproducible via documented runbooks." That's not generic advice. That's specific, testable, and actionable.

## Why It Matters Beyond the Tool

We built this for ourselves first — we needed a way to make strategic decisions about our own products using live operational data. But the deeper discovery is that the methodology matters more than the tool.

**Every business makes decisions, and almost none of them have a process for it.** They have processes for writing code, deploying software, hiring people, and tracking finances. But "how do we decide things?" is left to whoever is loudest in the meeting.

The cognitive science gives us a framework that works regardless of the tool:

1. **Name the problem type before analyzing it.** "Is this a crisis, a trade-off, a planning problem, or a people problem?" Just asking the question out loud changes the conversation.

2. **Surface assumptions explicitly.** "What are we assuming is true that we haven't verified?" Write them down. Most decisions fail on unstated assumptions.

3. **Try a different frame.** "What if this isn't actually a cost problem but a timing problem?" One reframe often reveals what the whole analysis missed.

4. **Run the pre-mortem.** "It's a year from now and this decision was a disaster. What happened?" You'll be surprised what your team says when given permission to imagine failure.

5. **Set tripwires.** "If X happens, we'll reconsider." Decisions shouldn't be permanent commitments — they should be hypotheses with exit criteria.

These five steps don't require an AI, an engine, or a subscription. They require the discipline to think before you choose.

We just built a system that makes the discipline automatic.

## What's Next

The engine runs on the BEAM — Erlang's virtual machine — which means every decision gets its own lightweight process with its own state, its own causal model, and its own conversation history. Any application in our ecosystem can ask the engine a question without leaving the VM.

Next, we're wiring it into our operational hub so strategic decisions get informed by real data — actual analytics, actual costs, actual user behavior — not hypothetical projections.

And we're packaging it to run on your own hardware, with your own API keys. Because if the decision engine is going to challenge your assumptions and surface your blind spots, it probably shouldn't be sending your strategic thinking to someone else's server.

The code is Elixir. The tests pass. The cognitive science is the architecture. And the LLM isn't the decision-maker — it's the thinking partner that helps you see what you're missing.

That's the part the charts never gave you.
