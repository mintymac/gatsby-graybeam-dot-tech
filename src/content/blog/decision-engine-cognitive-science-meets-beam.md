---
title: "Building a Decision Engine: When Cognitive Science Meets the BEAM"
category: "Engineering"
author: McHughson Chambers
date: 2026-03-16
---

Most decision tools get the problem wrong. They show you a chart, a matrix, a comparison table — and leave you staring at it thinking "okay, but what do I actually *do*?"

We built a decision engine that doesn't just classify problems. It thinks with you. It challenges your assumptions, simulates counterfactual scenarios through causal graphs, and tells you exactly how your decision could fail. And it runs on the BEAM, as a process-per-session architecture that any app in our ecosystem can call without leaving the VM.

Here's what we learned building it, and why the cognitive science mattered more than the code.

## The Research That Changed Everything

Before writing a single line of Elixir, we ran four parallel research agents across the academic literature. Not a literature review for fun — we needed to know how people actually solve problems, because the answer determines the architecture.

**The headline finding:** People don't struggle with choosing between options. They struggle with understanding what they're dealing with.

Gary Klein's Recognition-Primed Decision model studied fireground commanders, ICU nurses, and military officers. Of 134 decision points observed, 87% used pattern recognition — not comparison. Experts don't weigh options side by side. They recognize the situation, mentally simulate one action, and go with it unless they find a flaw.

This means the most valuable thing a decision tool can do isn't build a comparison matrix. It's help the user *frame the problem correctly*.

Mica Endsley's situation awareness research confirmed it: most decision failures happen at the understanding stage, not the choosing stage. Chip and Dan Heath's research quantified it: decisions framed as "should I do X?" fail 52% of the time. Decisions comparing at least two frames fail only 32%.

**The five stages of how people actually decide (not the textbook version):**

| Stage | What happens | Where tools usually help |
|-------|-------------|------------------------|
| "Something's off" | Problem detection | Nowhere |
| "What's really going on?" | Sensemaking — **most cognitive effort here** | Nowhere |
| "If I do X, what happens?" | Mental simulation (~3 steps max unaided) | Some tools |
| "I'm going with this" | Commitment | What most tools focus on |
| "That didn't go as planned" | Adaptation | Nowhere |

Most decision tools live in Stage 4 — the choosing. But that's where the least cognitive effort goes. The engine we built covers Stages 2 and 3, where people actually need help.

## Architecture: Process-Per-Session on the BEAM

The decision engine runs as a GenServer per session. Each decision gets its own process with its own state, its own causal graph, and its own conversation history.

```elixir
# Engine.Server — one per decision session
defmodule DecisionForge.Engine.Server do
  use GenServer

  def init({session_id, opts}) do
    Process.flag(:trap_exit, true)

    {:ok,
     %{
       session_id: session_id,
       session: %Session{},
       causal_graph: nil,    # Built lazily from morph payload
       causal_model: nil     # Equation registry name
     }, @idle_timeout}
  end
end
```

The session struct uses a pure `reduce/2` function — all state transitions go through it, and it returns `{new_session, [effects]}` without executing them. The GenServer handles the effects (spawning classification streams, broadcasting via PubSub, persisting to SQLite).

```
Engine.Supervisor (DynamicSupervisor)
  ├── Engine.Server "session_abc" ← owns session + causal graph
  ├── Engine.Server "session_def"
  └── Engine.Server "session_ghi"
```

Three access paths to the same engine:

| Path | For | Overhead |
|------|-----|----------|
| LiveView | Web users | WebSocket |
| REST API | Hub, Bouncer, external apps | HTTP + Bearer token |
| GraybeamCore.Tool | Any BEAM app in ecosystem | Zero — direct GenServer call |

The BEAM-native path is the interesting one. We registered the engine as tools with `GraybeamCore.Tool.Registry`, which means any Elixir app that depends on `graybeam_core` can call `classify_decision`, `get_decision`, or `update_decision` without HTTP serialization. Hub can ask the engine to analyze Bouncer's growth strategy. GrayPress can ask it to evaluate a content publishing decision. All on the same VM.

## The Sensemaking Layer

This is the part the research demanded. When a user submits a query, the classifier identifies the cognitive domain (trade-off analysis, crisis triage, temporal planning, or stakeholder dynamics) and produces a structured payload. But that payload is just the *frame*.

The sensemaking layer examines the frame itself:

**Assumptions** — what the user is implicitly assuming, and what happens if they're wrong:

```json
{
  "assumption": "A full-time DevOps engineer would primarily work on infrastructure",
  "risk": "At a 3-person startup, any hire wears multiple hats. You might actually be
           comparing 'hire a backend engineer who can also handle DevOps' vs 'managed
           platform' — making the cost comparison misleading.",
  "test": "List actual weekly tasks for your team over the past month. How many hours
           went to infrastructure vs product?"
}
```

**Reframes** — alternative ways to see the problem:

> "Frame this as a 'time-to-learning' rather than 'time-to-production' decision. Your biggest risk isn't infrastructure cost — it's building the wrong thing slowly. Render lets you ship experiments in days. A DevOps hire might give you more control, but if that control slows your learning loop from 2 weeks to 6 weeks, you've optimized the wrong variable."

**Pre-mortem** — Klein's technique, which research shows increases risk identification by 30%. We tell the LLM: "It's 6 months later and this decision has failed spectacularly. Write the post-mortem."

The result includes a failure narrative, root causes, early warning signals, and *tripwires* — specific conditions that should trigger reconsideration:

```json
{
  "condition": "If non-DevOps team members can't independently deploy a code change
                within 2 weeks of DevOps hire start date",
  "action": "Mandate that all infrastructure must be reproducible via documented
             runbooks that any developer can execute"
}
```

This isn't generic advice. Every output references the actual data in the decision payload — the specific criteria weights, the options being compared, the scores. The LLM acts as a thinking partner, not an oracle.

## Counterfactual Simulation via Pearl's SCM

Here's where it gets technical. When a user asks "what if I changed this assumption?", we don't just re-run the LLM. We have a real causal inference engine.

We extracted our Pearl Structural Causal Model implementation from an earlier project and rebuilt it on a new foundation. The storage layer uses `GraybeamGraph` — ETS-backed public tables with concurrent reads, no GenServer bottleneck for traversals. On top of that, `GraybeamCausal` implements:

- **Equation behaviour** — `V := f(PA, U)`, pure deterministic functions
- **EquationRegistry** — ETS-backed mapping of graph nodes to equation modules
- **InterventionEngine** — Pearl's do-operator via graphical surgery (creates ephemeral twin networks)
- **CounterfactualQuery** — the full 3-step process: abduction, action, prediction

When a morph payload arrives, `CausalModeler` converts it into a causal graph. For a COMPARATOR morph, criteria become input nodes, options become computed nodes with weighted score equations, and the verdict becomes the root. For a SIMULATOR morph, parameters become input nodes with model-typed curves (linear, diminishing returns, threshold, saturation).

```elixir
# Pearl's do-operator: "What if price were 15 instead of 10?"
{:ok, twin} = InterventionEngine.intervene(graph,
  interventions: %{"price" => 15.0}
)

# Propagate through twin network in topological order
{:ok, sorted} = CausalGraph.topological_sort(twin)
# For each node: compute from equation or use observed value
# Intervened nodes use fixed value; others recompute from parents
```

The `CausalGraph` extension we built for `GraybeamGraph` adds acyclicity enforcement (DFS reachability check on every edge insertion), Kahn's algorithm for topological sort, and ancestor/descendant traversal — all as pure functions over the public ETS tables.

The equations themselves are generated dynamically at runtime via `Module.create/3`. Each morph payload produces unique equation modules that capture the specific weights, scores, and relationships from the LLM's classification. No hardcoded domain logic — the LLM decides the structure, the SCM engine decides the math.

## What We Got Wrong (and Fixed)

**Model ID routing.** `GraybeamCore.Agent` uses a fallback chain across providers (Anthropic, OpenRouter, Gemini). We configured the default model as `"anthropic/claude-sonnet-4"` — an OpenRouter-style model ID — but Anthropic was first in the chain. Anthropic's API rejected it: "model: Input should be a valid string." The fix: resolve the model from the same config as the classifier, per provider. Lesson: when you have a multi-provider abstraction, model IDs are not portable.

**GenServer call timeouts.** The sensemaking LLM calls can take 30-60 seconds for complex prompts with full decision context. The default GenServer call timeout is 5 seconds; we set it to 30, which still wasn't enough. Bumped to 120 seconds. For production, these should be async with SSE streaming — but for the API, synchronous-with-long-timeout works.

**Enum.with_index for side effects.** Credo flagged unused return values from `Enum.with_index/2` where we were using it to iterate with an index but didn't need the result. The fix: pipe through `Enum.with_index() |> Enum.each()`. Small, but Credo strict catches it.

## The Cognitive Science Design Principles

Six principles emerged from the research that directly shaped the architecture:

1. **Structure is the product.** The morph classification doesn't just display data — it restructures how the user thinks. Changing the representation changes the cognitive task (Larkin & Simon, 1987).

2. **Interaction is cognition.** When users adjust weight sliders, they're not configuring a tool — they're thinking. The generation effect (Slamecka & Graf, 1978): people understand better when they generate rather than receive.

3. **Force articulation before showing results.** The rubber duck effect is real. Forming the query itself improves the user's understanding. Cognitive forcing functions (Bucinca et al., 2021) reduce overreliance on AI recommendations.

4. **Reframe, don't just recommend.** "This is actually a trade-off problem" is more valuable than "choose option B." Counterfactual explanations outperform feature importance for decision quality (Wachter et al., 2017).

5. **Guard against premature closure.** The #1 failure mode across all domains. The sensemaking layer explicitly challenges the first frame.

6. **Match the intervention to the domain.** Snowden's Cynefin framework maps directly to our morph system: chaotic situations need triage (act first), complicated ones need analysis (COMPARATOR), complex ones need probes (SIMULATOR/ROUND_TABLE).

## What's Next

The engine is live and tested. The next pieces:

- **Actionable guidance layer** — concrete next steps with owners, timelines, and tripwires. Not just "here's the analysis" but "here's what to do Monday morning."
- **Hub integration** — GraybeamHub already collects operational data (analytics, LLM costs, health telemetry) for every app in our fleet. Wiring it to the decision engine means strategic decisions about products like Bouncer get informed by real data, not guesses.
- **Self-hosted packaging** — the engine as a standalone BEAM release. Bring your own API keys, run it on your own hardware.

The decision engine isn't a chatbot with a pretty UI. It's a cognitive scaffold backed by real causal inference. And because it's on the BEAM, it's a process, not a service — every app in the ecosystem can think with it.

All the code is Elixir. All the tests pass. The LLM is the thinking partner. The BEAM is the runtime. And the cognitive science is the architecture.
