---
title: "Mechanical Sympathy on the BEAM, from First Principles"
category: "Engineering"
author: McHughson Chambers
date: 2026-07-18
---

The BEAM gives Erlang, Elixir, and Gleam an unusual bargain. We give up direct control over memory and threads. In return, the runtime gives us isolated processes, preemptive scheduling, local garbage collection, fault containment, and a concurrency model that remains understandable under load.

Mechanical sympathy on the BEAM is not an attempt to claw that abstraction back. It is learning what the bargain costs so we can use it well.

## Start below the language

A CPU is fast when the data it needs is nearby and predictable. Main memory is much slower than a register or cache, and a network round trip is slower again. Every runtime sits on top of that hierarchy.

The BEAM cannot repeal it. Instead, it organizes memory and execution around a different goal than a native numeric loop: keep many independent activities responsive, even when some are slow or fail.

That changes what good performance looks like. A C program might optimize the layout of a million numbers. A BEAM service is more likely to win by keeping process state small, messages bounded, data copying deliberate, and expensive work batched.

The first principle is simple:

> Optimize for the work the BEAM is designed to do, then move unsuitable work across a clear boundary.

## One runtime, three languages

Erlang, Elixir, and Gleam have different syntax and libraries, but ordinary code in all three compiles to BEAM instructions and uses the same term representation, process model, scheduler, and garbage collector.

These three functions therefore create the same broad data shape:

```erlang
% Erlang
prepend(Item, Items) -> [Item | Items].
```

```elixir
# Elixir
def prepend(item, items), do: [item | items]
```

```gleam
// Gleam
pub fn prepend(item, items) {
  [item, ..items]
}
```

Language-level libraries can still make different choices, and compilers can optimize particular expressions. But when reasoning about allocation, messages, lists, tuples, maps, and binaries, the shared VM is the right starting point.

## Terms are not flat bytes

The BEAM uses tagged machine words to distinguish integers, atoms, list pointers, boxed values, and other terms. Some values, including sufficiently small integers and atoms, fit directly in a word. Other values point to data on a heap.

The exact tag layout and immediate-integer range are VM implementation details. Application code should not organize its domain around a magic integer cutoff. The useful first-principles distinction is whether a structure is compact and immediate or requires additional heap words and pointer traversal.

A list makes that distinction visible. A BEAM list is a chain of cons cells. Each non-empty cell stores a head and a pointer to the tail:

```text
[a, b, c]

+---+---+    +---+---+    +---+---+
| a | o----->| b | o----->| c | []|
+---+---+    +---+---+    +---+---+
```

Prepending is constant time because it creates one new cell:

```elixir
[item | items]
```

Appending must find the end and rebuild the left spine because lists are immutable:

```elixir
items ++ [item]
```

Doing that once may be harmless. Doing it for every element in an accumulator repeatedly walks an ever-growing prefix, which produces quadratic work.

Build backward and reverse once:

```elixir
items
|> Enum.reduce([], fn item, acc -> [transform(item) | acc] end)
|> Enum.reverse()
```

The same principle appears as `[Item | Acc]` plus `lists:reverse/1` in Erlang, and prepending plus `list.reverse` in Gleam.

## Immutability moves the cost to construction

BEAM data is immutable. There is no general `do_transform_in_place` operation for a tuple, list, or map. An update creates a new value, often sharing unchanged structure where the representation permits it.

That is excellent for concurrency: another process never observes half an update. It also means construction strategy matters.

Consider an eager Elixir pipeline:

```elixir
orders
|> Enum.filter(&paid?/1)
|> Enum.map(&to_receipt/1)
|> Enum.reject(&internal?/1)
```

It may allocate an intermediate list at each stage. For a modest collection, the readable pipeline is probably the right choice. For millions of items in a measured hot path, a single reduction or lazy stream can keep the working set smaller.

```elixir
Enum.reduce(orders, [], fn order, receipts ->
  if paid?(order) do
    receipt = to_receipt(order)
    if internal?(receipt), do: receipts, else: [receipt | receipts]
  else
    receipts
  end
end)
|> Enum.reverse()
```

The fused version is more complex. That complexity has a maintenance cost. Mechanical sympathy means seeing both costs, not automatically preferring the lower-level expression.

## Per-process heaps change garbage collection

Most BEAM processes allocate on their own heaps. This gives the runtime one of its defining performance properties: garbage collection is usually local to the process being collected. A process with a small live set can collect quickly without tracing every object in the node.

This suggests a practical design rule:

> Keep long-lived process state small, and keep temporary bulk data short-lived.

A server process that accumulates every event it has ever seen grows its live set. Each collection has more state to preserve, restarts become more expensive, and operational inspection becomes harder. Persist history outside the process and retain only the state needed for the next message.

Many small processes are not inherently a cache disaster, and a scheduler migration does not literally invalidate an entire heap. The scheduler is allowed to move runnable processes to balance work. Trying to pin ordinary application processes to cores is rarely the right lever. Reduce the amount of work and state first; let the scheduler do its job.

## Messages copy ownership

Process isolation works because one process cannot mutate another process's heap. Sending an ordinary heap term therefore generally involves copying it into the receiver's memory domain. That makes message size part of the API contract.

```elixir
# The worker receives exactly the fields it needs.
send(worker, {:resize, image_id, width, height})
```

Large reference-counted binaries are an important exception: processes can share the underlying binary data while passing small references. This makes binaries effective for network payloads and media, but it creates another trap. A tiny sub-binary can keep a very large parent binary alive.

If long-lived state needs only a small slice of a large payload, copy that slice deliberately:

```elixir
header = binary_part(payload, 0, 64) |> :binary.copy()
```

Copying here is not a failure. It releases ownership of the much larger backing binary. The right question is not "do copies happen?" but "which lifetime should own these bytes?"

## Build binaries once

Repeatedly concatenating a growing binary has the same shape as repeatedly appending to a list: old content may be copied again and again.

Erlang and Elixir support iodata, a tree of binaries and byte values that many I/O APIs can consume directly:

```elixir
body = Enum.map(rows, fn row -> [row.id, ?:, row.value, ?\n] end)
File.write!(path, body)
```

When an API truly requires one contiguous binary, flatten once at the boundary:

```elixir
binary = IO.iodata_to_binary(body)
```

Binary pattern matching is similarly valuable because it lets the VM describe protocol parsing in terms of offsets and sizes rather than hand-written byte extraction:

```elixir
<<version::8, flags::8, length::16, payload::binary-size(length), rest::binary>> = packet
```

It is not automatically zero-copy in every context, but it gives the compiler and runtime a precise structure to optimize.

## Mailboxes are queues, not free storage

Every process has a mailbox. Sending is cheap enough to use pervasively, but an unbounded producer can still outrun a consumer. Latency then grows as messages wait, memory grows with the queue, and selective receive may have to inspect messages that do not match yet.

The cure is usually protocol design:

- apply backpressure or demand;
- bound concurrency;
- batch related work;
- avoid mixing unrelated traffic in one hot mailbox;
- expose queue length and processing latency as metrics.

OTP abstractions help with correctness, but they cannot choose a capacity policy for the application. A GenServer that accepts unlimited casts is still an unbounded queue.

## ETS trades copying for shared access

ETS stores terms outside ordinary process heaps and allows many processes to access a table. It is useful for shared, read-heavy state, indexes, counters, and caches.

It is not shared mutable memory in the C sense. Inserts and lookups still have representation and copying costs for ordinary terms, and a single hot key or write-heavy table can become contention. Table type and concurrency options should follow the access pattern.

Use ETS when ownership is genuinely shared. Do not move private state out of a process merely to avoid its local garbage collector.

## Put numeric work where it belongs

Lists of boxed or tagged terms are a poor representation for dense matrix arithmetic. The BEAM also does not turn an ordinary list loop into a SIMD kernel. That does not make the platform slow; it means dense numeric work is not the job its core representation was designed for.

Keep orchestration, supervision, distribution, and failure handling on the BEAM. Put dense numeric kernels in a library designed for contiguous arrays and accelerator execution, such as Nx with an appropriate backend, or behind a carefully designed native or service boundary.

This is mechanical sympathy at the architectural level: assign work according to the strengths of each runtime.

## Measure VM behavior

Measure the layer suggested by the symptom:

- `:observer` and `:etop` for process activity and memory;
- `recon` for production-oriented process and allocation inspection;
- `:erlang.process_info/2` for queue length, memory, reductions, and garbage-collection information;
- Erlang's `:eprof`, `:fprof`, and `:cprof` for different profiling questions;
- Benchee for controlled Elixir benchmarks;
- Telemetry and request traces for real system boundaries.

A useful comparison includes realistic message sizes, process counts, scheduler load, and warmup. A microbenchmark in one process cannot establish how a supervised service behaves under backpressure.

## Static analysis is a prompt, not a profiler

Credo can identify Elixir source patterns. Erlang's compiler, Xref, and Dialyzer cover warnings, calls, and contracts. Gleam's compiler provides type and exhaustiveness guarantees. The Graybeam mechanical-sympathy scanner adds the shared cost shapes: append-based accumulation, repeated binary growth, and eager multi-pass pipelines.

No static tool knows whether a collection contains ten elements or ten million. These findings should remain advisory until a team has compared them with real workloads. A bounded exception deserves an inline reason, not a mysterious global disable.

## A practical order of operations

When a BEAM system struggles, work from system behavior inward:

1. Find overloaded boundaries: databases, services, disks, and external APIs.
2. Inspect mailbox growth, backpressure, and unbounded concurrency.
3. Keep process state and messages small enough for their lifetimes.
4. Remove repeated list or binary copying in measured hot paths.
5. Reduce unnecessary intermediate collections and full data scans.
6. Move dense numeric kernels to a representation built for them.

Mechanical sympathy on the BEAM is not about writing Erlang-shaped C. It is understanding why the runtime makes isolation, recovery, and concurrency cheap, then arranging our data and protocols so those strengths remain cheap under load.
