---
title: "34,000 Lines of TypeScript to 4,000 Lines of Elixir: Porting a Music Analysis App to the BEAM"
category: "Engineering"
author: "Gray Beam Technology"
date: 2026-03-18
draft: false
---

We had a React + FastAPI + Python app that analyzed music for BPM detection. It worked. It was also 34,000 lines of TypeScript, a Python microservice running a dead ML library from 2017, Docker containers, Redis, nginx reverse proxy, blue-green deployment scripts, and a monitoring service written in Node.js. Keeping it alive was a full-time job.

We rewrote it in Elixir on the BEAM VM. Two sessions. 4,069 lines. Everything works better.

This isn't a "rewrite it in Rust" story. This is about what happens when you pick a runtime that was actually designed for the problem you're solving.

## The Old Stack

The original app was typical of modern web development — which is to say, it was a lot of moving parts pretending to be one thing:

- **Frontend**: React 18 + Redux + TanStack Query + 30 custom hooks + Radix/shadcn components
- **Backend**: Supabase (Postgres + Auth + Edge Functions)
- **BPM Service**: FastAPI + Python + madmom 0.16.1 (last updated 2017)
- **Infrastructure**: Docker, nginx blue-green deployment, GitHub Actions CI/CD
- **Monitoring**: A separate Node.js process sending Telegram alerts

The BPM service was the anchor. madmom required NumPy < 1.24, which blocked every other Python dependency from updating. The library was abandoned. We were stuck on a dead ecosystem.

## What the BEAM Gives You for Free

The pitch for Elixir isn't performance or syntax — it's that the runtime solves infrastructure problems that other languages push to external services.

### Problem: Background job processing

**Before**: We needed a task queue. In Python that means Celery + Redis + a broker + worker processes + monitoring. Or in Node.js: Bull + Redis. Either way, two more services to deploy and keep alive.

**After**: Oban. It's an Elixir library that uses your existing Postgres database as the job queue. No Redis. No broker. No separate worker process. Jobs are rows in a table. They survive server restarts. They retry on failure. They respect concurrency limits. You add it to your supervision tree and it works.

```elixir
# That's it. Jobs are now persistent, retryable, and queue-managed.
children = [
  {Oban, queues: [analysis: 3]}
]
```

Three concurrent analysis jobs, max. If one crashes, it retries. If the server restarts, pending jobs resume. This replaced Docker containers + Redis + a custom retry system.

### Problem: Real-time UI updates

**Before**: React + WebSocket + Redux + TanStack Query. The client polls or subscribes, manages its own state, reconciles with the server, and re-renders. About 4,000 lines of code just to keep the UI in sync with the backend.

**After**: Phoenix LiveView + PubSub. The server renders HTML. When state changes, the server pushes a diff over WebSocket. No client state management. No API layer. No serialization.

When a background job progresses through stages (downloading → analyzing → complete), it broadcasts via PubSub. Every connected LiveView page that subscribed to that topic receives the update and re-renders — automatically. The user sees a progress bar move in real-time without any client-side JavaScript.

```elixir
# Background worker broadcasts progress
Phoenix.PubSub.broadcast(PubSub, "tracks", {:analyzing, track_id})

# LiveView receives it and re-renders
def handle_info({:analyzing, track_id}, socket) do
  {:noreply, assign(socket, :status, :analyzing)}
end
```

This replaced Redux, TanStack Query, 30 custom hooks, and a WebSocket management layer.

### Problem: ML model serving

**Before**: The Python BPM service loaded the ML model on every request. Cold starts were slow. Running multiple instances meant multiple copies of the model in memory. We needed to think about model caching, warm pools, and request routing.

**After**: A GenServer. The model loads once when the application starts and lives in a supervised process. Every analysis request calls into the same process. If it crashes, the supervisor restarts it and reloads the model.

```elixir
# Model loaded once, shared across all requests
defmodule Analysis.Serving do
  use GenServer

  def init(:ok) do
    model = Ortex.load("priv/models/model.onnx")
    {:ok, %{model: model}}
  end

  def handle_call({:predict, input}, _from, %{model: model} = state) do
    result = run_inference(model, input)
    {:reply, result, state}
  end
end
```

This is a fundamental capability of the BEAM — long-lived processes with state, supervised by the runtime. In Python or Node.js, this requires external infrastructure (model servers, GPU pools, load balancers). On the BEAM, it's a module.

### Problem: The monitoring service

**Before**: A separate Node.js process running on the production server, polling health endpoints every 30 seconds, sending Telegram alerts when things went down. Its own .env file, its own process management, its own failure modes.

**After**: Doesn't exist. Health checking is a library added to the supervision tree. Telegram alerting is another library. They run inside the same BEAM VM as the application. No separate process. No separate deployment. No separate monitoring of the monitoring.

## The ML Migration: Python to Nx

The scariest part of the rewrite was BPM detection. We were running a Python ML library (madmom) that hadn't been updated since 2017. The replacement needed to be:

1. More accurate than madmom
2. Fast enough for production
3. Running inside the BEAM — no Python sidecar

We found Beat This!, a 2024 ISMIR paper from the same lab that created madmom. It's transformer-based, state-of-the-art for beat tracking, and — crucially — has an ONNX model export.

Elixir's Nx ecosystem made this possible:

- **Nx**: Tensor operations (the NumPy of Elixir)
- **EXLA**: Google's XLA compiler as a backend — JIT compiles tensor operations to native code
- **Ortex**: ONNX Runtime as a Rust NIF — loads any ONNX model

We had to implement a mel spectrogram computation from scratch in Nx (there's no `torchaudio` equivalent yet). FFT, Hann windowing, Slaney mel filterbank, log scaling — all matching the exact parameters from the original Python preprocessing.

The result: 1.2% average BPM error across 18 test tracks. 600 milliseconds per track with EXLA. No Python anywhere in the stack.

The spectrogram was the bottleneck. Without EXLA (pure Elixir), it took 45 seconds. With EXLA, 500 milliseconds. Same code — just a config line:

```elixir
config :nx, default_backend: EXLA.Backend
```

A 90x speedup from changing one line. That's what a JIT-compiling tensor backend gives you.

## What We Lost

Honestly? Very little.

- **npm ecosystem**: We don't need it. No bundler config, no node_modules, no package-lock.json conflicts.
- **Component libraries**: Phoenix LiveView ships with a component library. It's not shadcn, but it renders on the server and we never think about hydration.
- **Type safety**: Elixir is dynamically typed. We miss TypeScript's type checking occasionally. Pattern matching and the "let it crash" philosophy compensate, but it's a real tradeoff.
- **Hiring pool**: More people know React than Phoenix. This matters if you're scaling a team.

## What We Gained

- **88% less code** (34,000 → 4,069 lines) for the same functionality plus features that didn't exist before
- **Single deployment target** — one BEAM VM replaces Docker + nginx + Redis + Node.js monitoring
- **ML inference in-process** — no Python sidecar, no model server, no cold starts
- **Real-time by default** — every page is live, every state change pushes to the client
- **Fault tolerance** — supervisors restart crashed processes, Oban retries failed jobs
- **Background processing** — Oban jobs in Postgres, no Redis, survives restarts
- **Sub-second analysis** — 600ms per track with EXLA, down from variable seconds with Python

## The Numbers

| Metric | React + Python | Elixir/BEAM |
|--------|---------------|-------------|
| Lines of code | ~34,000 | 4,069 |
| Languages | TypeScript, Python, SQL, YAML, Dockerfile | Elixir |
| Services to deploy | 5 (frontend, API, BPM service, Redis, monitoring) | 1 |
| ML inference | Python subprocess, loaded per request | GenServer, loaded once |
| Background jobs | None (synchronous) | Oban (persistent, retryable) |
| Real-time updates | Redux + WebSocket + polling | PubSub + LiveView |
| BPM accuracy | ~92-94% (madmom 2017) | ~98.8% (Beat This! 2024) |
| Analysis speed | Variable | 600ms |
| Recovery from crash | Manual restart | Automatic (supervisor) |

## Should You Do This?

If you have a React + Python/Node app that's mostly CRUD with some real-time features and background processing — yes. The BEAM was designed for exactly this workload. You'll write dramatically less code, deploy dramatically fewer services, and spend dramatically less time on infrastructure.

If you have a complex frontend with rich client-side interactions (drag-and-drop, canvas, animations) — LiveView can do some of this with JS hooks, but you might miss the React ecosystem.

If you need ML inference — the Nx ecosystem is real and production-ready. ONNX model loading via Ortex means anything trained in PyTorch or TensorFlow can run on the BEAM. The spectrogram computation we had to write by hand will eventually be a library. The infrastructure for serving models (Nx.Serving, GenServer) is already better than what most Python shops set up.

The BEAM isn't trendy. It's been running telecom switches since the 1980s. But for the class of problems that most web applications actually are — request handling, background processing, real-time updates, fault tolerance — it's the most boring, reliable, productive choice available.

We just proved it with a music app. Your app is probably simpler.
