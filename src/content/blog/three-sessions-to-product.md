---
title: "Three Sessions, 26 Commits, One Product: Building an AI Music Analysis Platform on the BEAM"
category: "Engineering"
author: "Gray Beam Technology"
date: 2026-03-19
draft: false
cover: "blog-three-sessions.jpg"
---

We built a full-stack music analysis and class design platform in three coding sessions. Not a prototype. Not a demo. A working application with ML-powered BPM detection, musical structure analysis, auto-generated choreography, real-time playback tracking, and a class builder with instructor-validated quality warnings.

Here are the numbers.

## By the Numbers

| Metric | Value |
|--------|-------|
| Coding sessions | 3 |
| Calendar days | 2 |
| Commits | 26 |
| Elixir source files | 41 |
| Lines of Elixir | 5,833 |
| Lines replaced from original app | 34,000 (TypeScript + Python) |
| Code reduction | 83% |
| Database migrations | 5 |
| LiveView components | 6 |
| Graybeam ecosystem modules used | 8 |
| Tracks analyzed | 29 |
| BPM accuracy (avg error) | 1.2% |
| Analysis time per track | 600ms |
| ML model | Beat This! ONNX (83MB, 2024 SOTA) |

## What Was Built

### Session 1: Foundation

Started with the question "can we run a state-of-the-art beat detection model inside the BEAM VM?" The answer turned out to be yes — and fast.

- Validated that Beat This! (ISMIR 2024) loads via Ortex and runs inference in Elixir
- Built a custom mel spectrogram computation in Nx matching the exact parameters from the original PyTorch preprocessing
- Discovered EXLA provides a 40x speedup (45 seconds → 600 milliseconds)
- Proved Deezer's free API returns BPM and ISRC for 100% of test tracks
- Scaffolded a Phoenix 1.8 application with 8 ecosystem library dependencies

By the end of session 1: audio in → BPM out, entirely on the BEAM.

### Session 2: Musical Intelligence

The BPM number is just the start. The real value is understanding a song's *structure*.

- **Rhythm Maps**: Broke each song into 10-second windows showing local BPM and energy density. Automatically classified stability (rock solid, moderate, variable) and detected zones (intro, buildup, peak, sustain, breakdown, outro).

- **Choreography Engine**: Used Beat This! downbeat data to derive measure boundaries and phrase structure. Built a pattern library (9 movement types) with progressive build sequences that ramp intensity within each zone.

- **Playback Integration**: Embedded YouTube player with bidirectional control — click any rhythm map bar or choreography phrase to seek the video. JavaScript cursor tracking at 4fps highlights the current position across all visualizations.

- **Position Data**: Each choreography phrase includes seat position (seated/standing), hand position (1st/2nd/3rd), ride timing (half/single/double time), and computed RPM clamped to configurable instructor limits.

### Session 3: Application Architecture

Transformed from a song analysis tool into a class design platform.

- **App Shell**: Persistent sidebar showing the full song library (sortable, filterable) with a contextual main panel. Desktop-first layout that uses the full screen.

- **Context-Aware UI**: The sidebar's behavior changes based on what you're doing. Browsing? Click navigates. Building a class? Click adds the song. Songs already in the class show a checkmark and are grayed out.

- **Class Builder**: 45-minute ride planner with drag-to-reorder, energy arc visualization, and a stats dashboard showing duration, BPM range, average RPE, and intensity distribution.

- **Class Analyzer**: A pure function module that computes warnings, phase suggestions, and quality metrics. Twelve automated checks validate class structure against instructor-validated rules (no warmup, no recovery, consecutive high-intensity songs, jarring BPM transitions, flat energy, anticlimactic peaks).

- **Template System**: Pre-built RPE patterns (Standard, Intervals, Climb, Sprint) that stretch to fit any number of songs. One click applies a professional class structure.

## The Architecture That Made It Possible

Three design decisions enabled this velocity:

**1. Ecosystem Libraries as Infrastructure**

Eight pre-built modules handled auth, billing, analytics, metering, health monitoring, YouTube integration, Telegram alerts, and LLM orchestration. None of these were written during the three sessions. They were pulled in as path dependencies and configured.

This isn't a framework — it's a collection of focused libraries that share conventions but have no coupling. Each one solves one infrastructure problem and does nothing else.

**2. OTP as Application Architecture**

The BEAM VM's supervision tree replaced what would normally be 3-4 external services:

- A **GenServer** holds the ML model in memory, loaded once at startup, shared across all requests. No model server. No GPU pool. No cold starts.
- **Oban** (backed by Postgres) handles persistent job queuing with retries and concurrency limits. No Redis. No Celery. No separate worker process.
- **PubSub** broadcasts pipeline progress to all connected LiveView clients. No WebSocket management code. No event bus service.

When a user triggers BPM analysis, an Oban job is inserted into Postgres. The job downloads audio, calls the GenServer for inference, saves results, and broadcasts completion. The user can close their browser, navigate away, even restart the server — the job survives. Any connected page receives the update via PubSub and re-renders.

This is infrastructure that typically requires Redis + Celery + a message broker + custom WebSocket handling. On the BEAM, it's a supervision tree.

**3. Pure Function Modules for AI Integration**

Every analytical function — class structure analysis, phase suggestion, template application, warning computation — is a pure function. No socket dependencies, no side effects, no UI coupling.

```elixir
# The UI calls this:
analysis = Analyzer.analyze(class)

# The LLM agent will call the same thing:
analysis = Analyzer.analyze(class)
```

The class analyzer doesn't know or care whether it's being called by a LiveView component or an AI agent. It takes data in, returns analysis out. When we add conversational class building ("build me a 45-minute interval class with EDM"), the agent wraps these same functions as tools. No adapter layer, no API translation — the agent speaks Elixir.

## What We Learned

**The BEAM is underestimated for ML workloads.** The Nx ecosystem (Nx, EXLA, Ortex) is production-ready. Loading an ONNX model, computing spectrograms, and running neural network inference — all inside the same VM that serves web requests and manages WebSocket connections. The 40x EXLA speedup from a single config line was the moment it became clear this wasn't a toy.

**Musical structure is more valuable than BPM.** A single BPM number tells you almost nothing about how to use a song. A rhythm map showing where energy rises and falls, where breakdowns create natural recovery windows, where the beat density doubles for a sprint section — that's actionable information. No other tool provides this.

**Instructor domain knowledge is irreplaceable.** We spawned an AI agent to think like a 10-year spin instructor and asked it to define class structure rules. The result — phase timing, RPE targets, BPM transition thresholds, 12 warning types, 4 class templates — couldn't have been derived from code alone. Domain expertise expressed as data structures is the foundation of useful software.

**Three sessions is enough if the infrastructure exists.** We didn't build auth, billing, analytics, health monitoring, job queuing, or real-time messaging during these sessions. We configured them. The actual development time was spent on the domain: music analysis, choreography, class design. That's how it should be.

## The Trajectory

Twenty commits ago, this was "let's look at an old React project." Now it's a working platform that analyzes songs, maps their energy architecture, generates choreography, tracks playback position, builds structured classes, and validates them against professional standards.

The next session adds the AI agent — conversational class design where an instructor describes what they want and the system builds it. The pure function modules are ready. The ecosystem's LLM orchestration library has tool calling, fallback chains, and conversation memory. The pieces are all BEAM processes waiting to be connected.

That's the thing about building on the right foundation. You don't spend three sessions fighting infrastructure. You spend them building the product.
