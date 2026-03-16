---
title: "Building a CMS on the BEAM: No Redis, No Message Broker, No Problem"
category: "Engineering"
author: McHughson Chambers
date: 2026-03-15
---

Every CMS eventually builds the same stack: application server, database, Redis for caching, a message broker for events, a job queue for background work. Five moving parts, five things that can fail independently, five things to monitor and scale.

We're building GrayPress — a self-hosted, AI-powered communication hub — entirely on the BEAM VM. One process tree. No Redis. No RabbitMQ. No external cache. Here's why that works, and what the architecture actually looks like.

## The Typical CMS Architecture

WordPress serves a page by querying MySQL, maybe hitting a Redis cache, rendering PHP, and returning HTML. If you want real-time updates, you bolt on a WebSocket server. If you want background jobs, you add a queue. Each layer is a separate service with its own failure modes.

| Layer | WordPress/Rails | GrayPress (BEAM) |
|-------|----------------|-----------------|
| Page cache | Redis | GenServer per page |
| Event bus | Redis Pub/Sub or RabbitMQ | Phoenix PubSub (in-process) |
| Background jobs | Sidekiq / Celery | Oban (Postgres-backed) |
| Real-time | Action Cable / Socket.io | LiveView (WebSocket-native) |
| Process management | Systemd + Kubernetes | OTP Supervisor tree |

The BEAM column isn't simpler because we're cutting corners. It's simpler because the VM provides these primitives natively.

## GenServer Per Page: The Cache IS the Process

When someone visits `/about`, GrayPress doesn't query the database. It calls a GenServer.

```elixir
case PageCache.get("about") do
  {:ok, page} -> render(page)
  {:error, :not_found} -> redirect("/")
end
```

Behind that `PageCache.get/1` call, a `DynamicSupervisor` starts a `PageServer` process on first request. The process loads the page from Postgres once, holds it in memory, and serves subsequent reads from process state — a `GenServer.call` and a map lookup. Sub-millisecond.

```elixir
def handle_call(:get, _from, state) do
  {:reply, {:ok, state.page}, state, @idle_timeout}
end
```

Each page is its own process. If the "about" page somehow crashes, the "services" page is unaffected. The supervisor restarts the crashed process, it reloads from the database, and the next request succeeds. No global cache invalidation, no stale data across all pages.

### Hibernation: Memory Without the Memory

A GenServer holding a page weighs about 2.5KB. Not much — until you have thousands of pages, most of which nobody is viewing. After 5 minutes of idle time, the process hibernates:

```elixir
def handle_info(:timeout, state) do
  {:noreply, state, :hibernate}
end
```

Hibernation triggers a garbage collection and compacts the process heap. Memory drops from ~2.5KB to ~400 bytes. The process stays alive in the supervisor tree, but it's essentially free. When the next request arrives, it wakes up and serves from memory.

This is the BEAM's equivalent of an LRU cache, except there's no eviction policy to tune. Hot pages stay warm. Cold pages hibernate. The VM handles it.

## PubSub: Events Without a Broker

When an admin updates a page — through the admin chat, the MCP endpoint, or any tool — the Sites context broadcasts:

```elixir
def update_page(page, attrs) do
  with {:ok, updated} <- page |> Page.changeset(attrs) |> Repo.update() do
    Events.broadcast_updated(updated)
    {:ok, updated}
  end
end
```

Three things happen simultaneously:

1. **The PageServer** for that slug receives the event and updates its in-memory state. The next read gets fresh data. No cache TTL, no invalidation race conditions.

2. **Every connected LiveView** showing that page receives the event and re-renders. If someone is viewing `/about` in a browser and you edit it via MCP, their page updates live. No polling, no refresh.

3. **Analytics** (when wired) records the event for tracking.

This is Phoenix PubSub — Erlang message passing between processes on the same node. No serialization, no network hop, no external broker. The "event bus" is just processes sending each other tuples.

## Registry + DynamicSupervisor: The Pattern

The core of BEAM-native architecture is a pair: a `Registry` for lookup and a `DynamicSupervisor` for lifecycle.

```
GrayPress.Application
├── {Registry, name: GrayPress.PageRegistry}
├── {DynamicSupervisor, name: GrayPress.PageSupervisor}
```

The Registry maps a page slug to a process PID. The DynamicSupervisor manages the process lifecycle — starting pages on demand, restarting them on crash, cleaning up on shutdown.

```elixir
def start_link(slug) do
  GenServer.start_link(__MODULE__, slug,
    name: {:via, Registry, {GrayPress.PageRegistry, slug}})
end
```

This pattern scales to every domain. Channels? GenServer per room, same pattern. Voice calls? GenServer per call. Plugins? GenServer per active plugin. The supervision tree grows, but the pattern is always the same: Registry for lookup, DynamicSupervisor for lifecycle, PubSub for events.

## MCP + AI: Same Tools, Different Transport

GrayPress exposes page management tools over MCP (Model Context Protocol). Claude, Gemini, or any MCP-compatible agent can connect to `/mcp` and call `create_page`, `update_page`, `publish_page`.

The same tools power the admin chat — a LiveView where the owner talks to an LLM that has tool access to the entire site. The tools are canonical. The transport (MCP vs LiveView vs future API) is interchangeable.

When an agent calls `create_page` via MCP, it goes through the same Sites context, triggers the same PubSub broadcast, starts the same PageServer. No special code path for "API-created" vs "human-created" pages.

## What We Don't Need

| Thing | Why Not |
|-------|---------|
| **Redis** | GenServer state is the cache. PubSub is the event bus. |
| **RabbitMQ / Kafka** | Phoenix PubSub for real-time. Oban for durable jobs. |
| **Nginx / Varnish** | BEAM handles 10K+ concurrent connections natively. |
| **Separate WebSocket server** | LiveView is WebSocket-native. Same process tree. |
| **Cache invalidation logic** | PubSub handles it. Update → broadcast → processes update themselves. |
| **Health check sidecar** | OTP supervisors restart crashed processes automatically. |

This isn't minimalism for minimalism's sake. Each eliminated component is a thing that can't fail, can't get out of sync, can't cause a 3am page. The BEAM's process model means the application server, cache, event bus, and real-time layer are all the same program.

## The Constraint That Enables This

None of this would work if the BEAM weren't designed for it. Three properties make this architecture viable:

**Lightweight processes.** A BEAM process is ~1.2KB at birth. You can run millions of them. "A process per page" isn't extravagant — it's the idiomatic approach.

**Preemptive scheduling.** The BEAM schedules processes across all CPU cores with preemptive reduction counting. One runaway process can't starve others. This is why "a process per page" doesn't risk one slow page affecting the rest.

**Let it crash.** Supervisors restart failed processes with clean state. The PageServer doesn't need defensive error handling for every edge case — if something goes wrong, it crashes, restarts, reloads from Postgres, and continues. The database is the source of truth. Process state is a projection.

## What's Next

This is the foundation. The same Registry + DynamicSupervisor + PubSub pattern extends to:

- **Channels**: GenServer per chat room, real-time messaging via PubSub
- **AI screening**: Task.Supervisor for bounded-concurrency LLM calls
- **Plugins**: DynamicSupervisor with max_children, crash isolation per plugin
- **Voice**: GenServer per call for WebRTC signaling

One process tree. One deploy. Every communication mode. That's the bet.
