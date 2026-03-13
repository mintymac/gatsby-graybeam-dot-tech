---
title: "20,000x Faster: How We Replaced SQL Queries With BEAM Process State"
category: "Engineering"
author: McHughson Chambers
date: 2026-03-13
---

Our stats page took 2.8 seconds to load. Now the data fetch takes 0.14 milliseconds. Here's the full story of how we got there, and why the "obvious" fix (caching) was actually hiding the real problem.

## The Setup

Bouncer analyzes YouTube videos for covert influence techniques. The stats dashboard aggregates results across thousands of analyses — distributions, leaderboards, technique frequencies, dimension averages, extremes. Fifteen separate queries, all hitting the same table.

Every one of those queries extracted data from a JSONB column using Postgres functions like `result->>'primary_technique'` and `jsonb_array_elements_text(result->'categories')`. Postgres had to parse the JSON blob on every row, for every query, on every page load.

Cold load: **~2.8 seconds.** For a dashboard.

## The Wrong Fix

The first instinct was caching. We built an ETS cache with a 60-second TTL. Problem solved, right?

**Measured "warm" cache: 2.4 seconds.**

That number should have been suspicious. A cache hit should be sub-millisecond, not 2.4 seconds. But the measurement looked like an improvement (2.8 → 2.4), so it shipped.

The bug was subtle: when the TTL expired, the cache recomputed *inline in the calling process*. The LiveView that was trying to render the stats page would block for 2.8 seconds while it re-ran all fifteen queries. The "warm" measurement was just a second cold computation that happened to be slightly faster due to Postgres query plan caching.

Every user who hit the page after the 60-second window got a 2.8-second wait. The cache was decorative.

## The Real Fix: Three Layers

### Layer 1: BEAM-Native Stats Server

Instead of caching query results, we hold the precomputed stats in a GenServer's process state. A `GenServer.call(:get_overview)` returns the state — that's a message send and a reply. No computation, no database hit, no parsing.

```elixir
def handle_call(:get_overview, _from, %{overview: overview} = state) do
  {:reply, overview, state}
end
```

The server subscribes to PubSub and recomputes when new analyses complete. The computation happens in the server process, not in the LiveView that's trying to render the page. Reads are always instant.

We also replaced the LiveView's 60-second polling timer with a PubSub subscription. When the server recomputes, it broadcasts the new state, and any connected LiveView updates immediately. Real-time instead of polling.

### Layer 2: JSONB Column Extraction

The fifteen queries were slow because Postgres was parsing JSON on every row. We extracted the hot fields into real columns:

- Five scalar columns on the analysis table (`transparency_score`, `overall_intensity`, `primary_technique`, etc.)
- Four join tables (`analysis_dimensions`, `analysis_categories`, `analysis_formats`, `analysis_topics`) with proper btree indexes

`WHERE a.primary_technique = 'anchoring'` on an indexed column is dramatically faster than `WHERE result->>'primary_technique' = 'anchoring'` which requires a full table scan plus JSON parsing.

The JSONB blob stays as an audit trail. New analyses write to both paths. A backfill task migrated existing data.

### Layer 3: O(1) Incremental Updates

Even with faster SQL, re-running fifteen queries on every new analysis is wasteful when most stats can be updated arithmetically. A new analysis comes in — you don't need to re-query the database to know the count went up by one.

We built a set of pure functions that update stats in-process:

- **Counters**: increment total, today, this_week
- **Distributions**: increment the matching bucket
- **Frequency maps**: bump the technique/category/format count, re-sort top 10
- **Running averages**: `new_avg = old_avg + (new_val - old_avg) / count`
- **Extremes**: compare against current records, swap if exceeded
- **Recent list**: prepend, drop tail

Each update is O(1) — constant time regardless of how many analyses exist. A full SQL recompute still runs periodically (every 10 analyses or 5 minutes) to refresh complex aggregations like channel leaderboards that can't be incrementally maintained. But this happens in the background. It never blocks a page load.

## The Numbers

| Metric | Before | After | Factor |
|---|---|---|---|
| Data fetch (JSONB queries) | 2,800 ms | — | — |
| Data fetch (column queries) | 92 ms | — | — |
| Data fetch (process state) | — | 0.14 ms | **20,000x vs JSONB** |
| Page TTFB | ~2.8 s | ~190 ms | **14x** |
| Update model | 60s poll | PubSub push | Real-time |

The remaining 190ms is network latency, TLS, LiveView mount, and HTML rendering. The data layer contributes essentially nothing.

## Why This Works on BEAM

This architecture is natural on the BEAM VM in a way that would be awkward elsewhere. A few things that make it work:

**GenServers are cheap.** A GenServer holding a map in memory is not a "service" — it's a lightweight process. You don't need Redis or Memcached. The process *is* the cache, and it's supervised, so it restarts cleanly if anything goes wrong.

**PubSub is built in.** Phoenix PubSub over the local node is just message passing between processes. No external message broker, no serialization overhead. When an analysis completes, the worker broadcasts a message, the stats server receives it and updates its state, and connected LiveViews get pushed the new data. Three processes, zero network hops.

**Parallel queries are trivial.** The full recompute spawns fifteen `Task.async` calls under a `TaskSupervisor` and awaits them all with `Task.await_many`. Wall-clock time is the slowest single query, not the sum. This brought the recompute from 92ms sequential to about 35ms parallel.

**Incremental math is safe.** Because GenServer processes handle one message at a time, there are no race conditions on the running averages or frequency maps. No locks, no compare-and-swap — just sequential message processing by design.

## The Gotcha

During deployment, we hit a binary UUID encoding bug worth sharing. When you use `Repo.insert_all("table_name", rows)` with a raw table name string instead of a schema module, Ecto skips type casting. Our join table rows used `Ecto.UUID.generate()` for IDs, which returns a human-readable string like `"550e8400-e29b-..."`. But Postgrex expects 16-byte binary for `binary_id` columns when there's no schema to cast through.

The fix: `Ecto.UUID.bingenerate()` for new IDs, `Ecto.UUID.dump(id)` for foreign keys referencing existing records. A small thing, but it silently produced encoding errors that only showed up in production.

## The Lesson

The cache wasn't the right abstraction. We were trying to make slow queries faster by not running them as often. But the real question was: *do we need to run these queries at all on page load?*

The answer is no. The stats change when analyses complete, not when someone views the page. Precompute on write, serve from memory on read. The BEAM makes this easy because processes holding state, receiving messages, and doing math is exactly what it was designed for.

The page went from blocking on fifteen database queries to reading a map from a process mailbox. Twenty thousand times faster — and simpler code.
