---
title: "Mechanical Sympathy in Ruby and Rails, from First Principles"
category: "Engineering"
author: McHughson Chambers
date: 2026-07-18
---

Ruby lets us work a long way above the machine. That is one of its strengths. We can talk about users, invoices, and jobs while the runtime handles pointers, memory, and instruction dispatch.

But abstraction does not make the machine disappear. It changes where we meet it.

In C, mechanical sympathy might mean arranging bytes so a loop walks through contiguous memory. In Ruby, we rarely control layout that directly. We *do* control how many objects we create, how many times we walk a collection, how much data we ask the database to return, and how often we cross a network boundary. Those decisions become allocation, garbage collection, cache misses, method dispatch, and I/O.

That is mechanical sympathy in Ruby: understanding what our convenient code asks the runtime and the rest of the system to do.

## Start with the machine

A processor can execute instructions much faster than main memory can supply arbitrary data. It avoids waiting by keeping recently used data in small, fast caches. Sequential, compact data is easier to fetch and predict. A trail of pointers through unrelated heap objects is harder.

The exact timings vary by processor, but the shape of the hierarchy is stable:

```text
CPU register       a few cycles
CPU cache          a few to tens of cycles
Main memory        tens to hundreds of nanoseconds
Local storage      microseconds or more
Network service    hundreds of microseconds to seconds
```

This gives us our first principle:

> The fastest operation is usually the one we arrange not to perform.

Saving one Ruby method call will not rescue a request that makes 200 database queries. Improving cache locality will not rescue an endpoint that returns ten megabytes the caller never uses. Work from the largest cost inward.

## What one line of Ruby really means

Consider a familiar expression:

```ruby
labels = users.select(&:active?).map { |user| "#{user.name} <#{user.email}>" }
```

It is clear, and clarity matters. It also asks Ruby to:

1. Walk `users` once for `select`.
2. Allocate an intermediate array for the active users.
3. Walk that array again for `map`.
4. Call methods dynamically for each user.
5. Allocate a string for each label.
6. Grow and populate the result array.

None of that is automatically a problem. For 30 users in a controller action, it is probably the right code. For 30 million records in an import, the intermediate array and second traversal may dominate the job.

The mechanically sympathetic version is not necessarily clever. It simply makes one pass and allocates only the result we need:

```ruby
labels = users.each_with_object([]) do |user, result|
  result << "#{user.name} <#{user.email}>" if user.active?
end
```

The point is not to replace every `select.map`. The point is to see the work represented by the expression and make an informed trade when that expression is hot.

## Allocation has a downstream cost

Most Ruby values are represented by objects managed by the runtime. Creating a short-lived object is intentionally cheap, but it is not free. Ruby must reserve space for it, and the garbage collector must eventually account for that space.

Small integers, symbols, `nil`, `true`, and `false` can be encoded directly in Ruby's internal `VALUE` representation rather than living as ordinary heap objects. Most strings, arrays, hashes, and application objects live on the heap. Large integers also require heap storage. Ruby has called all integers `Integer` since Ruby 2.4; `Fixnum` and `Bignum` are historical implementation names, not classes application code should design around.

Temporary objects are often the real issue:

```ruby
# Builds a new string for every iteration, then abandons the old one.
body = +""
rows.each do |row|
  body = body + render_row(row)
end
```

If the final string is length `n`, repeatedly copying the growing prefix can turn roughly linear work into quadratic work. Mutating one buffer avoids those copies:

```ruby
body = +""
rows.each do |row|
  body << render_row(row)
end
```

For output that can be streamed, avoiding the large final buffer is better still:

```ruby
rows.each do |row|
  response.stream.write(render_row(row))
end
```

This leads to a second principle:

> Count retained data, temporary data, and copies, not just lines of code.

### Reuse with care

Object pools are not a general Ruby performance technique. They introduce mutable state, reset bugs, and often keep memory alive longer than necessary. Reuse is valuable when an object is genuinely expensive to construct or is naturally a buffer:

```ruby
encoder = JsonEncoder.new(schema)

records.each_slice(1_000) do |batch|
  encoder.write(batch, output)
end
```

Let ordinary short-lived value objects remain ordinary until measurement shows they are a problem.

## Choose a shape that matches access

An array is a dense sequence of references. A hash maintains a lookup structure so a key can find a value. That extra machinery is worthwhile when we need keyed access, but wasteful when our keys are just `0, 1, 2, 3`.

```ruby
temperatures = [71.2, 72.0, 70.8]       # Dense, ordered data
limits = { warning: 80, critical: 90 }   # Named lookup
```

The same question applies to application objects. If a report only needs two columns, loading a full Active Record object graph means allocating and retaining data the report never reads:

```ruby
# Instantiates User objects with every selected column.
User.active.map { |user| [user.id, user.email] }

# Returns the two values the report actually consumes.
User.active.pluck(:id, :email)
```

Symbols are useful for a fixed vocabulary such as option keys and states. Strings are appropriate for text and external input. Do not turn arbitrary user input into symbols merely in pursuit of speed; it changes the meaning of the data and interns a vocabulary the application does not control.

## Rails performance begins at the boundary

A database round trip is vastly more expensive than an in-process Ruby operation. That is why N+1 queries matter so much: they multiply the most expensive part of the request.

```ruby
# One query for users, then potentially one profile query per user.
users = User.limit(100)
users.each { |user| puts user.profile.bio }

# Load the association in a bounded number of queries.
users = User.includes(:profile).limit(100)
users.each { |user| puts user.profile.bio }
```

Eager loading is not magic. Loading three large associations "just in case" can consume more time and memory than a small number of targeted queries. The first-principles question is: what data will this request touch, and how few bounded trips can fetch it?

### Batch the boundary

This loop pays for a lookup, a transaction, and an update for every item:

```ruby
updates.each do |attributes|
  Product.find(attributes.fetch(:id)).update!(attributes)
end
```

When callbacks and per-record validation are not required, Rails can send a batch:

```ruby
rows = updates.map do |attributes|
  attributes.slice(:id, :price).merge(updated_at: Time.current)
end

Product.upsert_all(rows, unique_by: :id)
```

That changes semantics: `upsert_all` does not instantiate models or run model callbacks. Mechanical sympathy does not mean ignoring that contract. It means choosing the cheaper contract when it is the contract we actually need.

### Keep volume bounded

`Model.all.each` can retain a large result set and its model objects. Rails' batch APIs put an upper bound on the working set:

```ruby
User.active.find_each(batch_size: 1_000) do |user|
  BackfillUser.call(user)
end
```

Batching helps at several layers at once: fewer database round trips than one-row queries, less memory than loading the whole table, and a smaller live object set for the garbage collector.

## What not to optimize

Ruby method calls have overhead. Reaching into an object with `instance_variable_get` is not a sensible shortcut around that overhead. It still performs a method call, breaks encapsulation, and can defeat optimizations the VM makes for normal accessors.

Likewise, replacing readable local variables with `tap` or `then` does not avoid object allocation. A local variable is a reference held in a stack frame; naming a value does not clone it.

String interpolation is readable, but it is not a universal cure for allocation. Use interpolation to construct a small string once. Use `String#<<`, an array of fragments plus `join`, or streaming when building incrementally. The access pattern determines the right tool.

These examples point to a third principle:

> Optimize a measured cost, not a visual feature of the source code.

## Measure the layer you suspect

Start with production-shaped observations: request traces, query counts, job duration, allocations, and memory growth. Then narrow the experiment.

For a small allocation benchmark, Ruby's standard library is enough:

```ruby
require "benchmark"

rows = Array.new(10_000) { |index| "row-#{index}" }

GC.start
before = GC.stat(:total_allocated_objects)
elapsed = Benchmark.realtime { rows.join("\n") }
allocated = GC.stat(:total_allocated_objects) - before

puts "#{elapsed.round(4)}s, #{allocated} objects"
```

Use `benchmark-ips` when comparing small alternatives, StackProf or Vernier to find CPU-heavy Ruby methods, and `memory_profiler` or allocation tracing to understand object churn. On Rails requests, query logs and application traces usually reveal more than a microbenchmark.

A useful experiment has:

- representative input sizes;
- a warmup for VM and cache effects;
- multiple runs;
- both time and allocation measurements;
- a check that the alternatives return the same result.

## What static analysis can and cannot know

RuboCop's performance extensions can catch local patterns with well-understood replacements. Rails-aware tooling can flag suspicious query usage. A custom check can point out `acc + [item]` inside a reduction or a database call inside an obvious loop.

But a linter cannot know whether code is hot, whether an Active Record relation is already loaded, or whether a callback is part of the required behavior. Mechanical-sympathy rules should therefore be advisory and suppressible. Their job is to start a useful review conversation, not to turn every allocation into a build failure.

The accompanying Graybeam tooling applies that same rule model to Ruby, Elixir, Erlang, and Gleam. The syntax differs, but the expensive shapes recur:

- repeatedly copying a growing accumulator;
- making remote or database calls one item at a time;
- materializing several intermediate collections;
- processing an unbounded working set.

## A practical order of operations

When Ruby or Rails code is slow, work down the cost hierarchy:

1. Remove unnecessary network and database round trips.
2. Fetch only the rows and columns the operation needs.
3. Bound the working set with batches or streams.
4. Remove repeated traversal and copying in hot collection code.
5. Reduce temporary allocation where profiles show pressure.
6. Consider lower-level data layout or native code only after the larger costs are under control.

Mechanical sympathy is not a bag of tricks, and it is not an argument for writing C in Ruby. It is the habit of asking what work an abstraction creates, where that work runs, and whether the result justifies the cost.

Ruby remains expressive. Rails remains productive. We simply stop treating their abstractions as weightless.
