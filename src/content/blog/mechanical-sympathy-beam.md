---
title: "Mechanical Sympathy in the BEAM: Coding for the Hardware That's Actually There"
category: "Engineering"
author: McHughson Chambers
date: 2026-07-18
---

Martin Thompson, the engineer behind the LMAX Disruptor, stood in front of a room of high-frequency trading engineers and told them their entire understanding of performance was folklore. The machine isn't slow, he said. You just never learned how it actually works.

Now I'm applying those same principles to the BEAM VM — and the results are both surprising and essential for anyone writing hot paths in Erlang or Elixir.

## The Hidden Tax: Tagged Terms

Every BEAM term is a 64-bit word with embedded type tags:

```
┌─────────────────────────────────────────────────────────────┐
│  Type Tag (3-5 bits) │ Value (23-61 bits) │ Padding/Next │
└─────────────────────────────────────────────────────────────┘
```

A small integer that "fits in 31 bits" still occupies a full 64-bit word. Compare the density:

```
Native C int array [1, 2, 3, 4]:     4 words × 4 bytes = 16 bytes → 1 value/cache line
BEAM small int list [1, 2, 3, 4]:    4 words × 8 bytes = 32 bytes → 1 value/cache line (tag overhead)
```

**The consequence:** BEAM gets roughly half the data density per cache line compared to native C. Every access pays the tag extraction cost.

## The BEAM Memory Hierarchy

Each BEAM process has its own heap, which creates a unique cache behavior:

```
┌──────────────────────────────────────────────────────┐
│  CPU Registers                                     │
│    └─ Program counter, accumulator, function args  │
├──────────────────────────────────────────────────────┤
│  L1/L2 Cache (in-process)                          │
│    └─ Currently executing BEAM process's heap      │
│    └─ Process stack (last N function frames)       │
├──────────────────────────────────────────────────────┤
│  L3 Cache (shared)                                 │
│    └─ Other BEAM processes' heaps (if nearby)      │
│    └─ ETS tables (if loaded)                       │
├──────────────────────────────────────────────────────┤
│  RAM (process heap)                                │
│    └─ Young generation: ~1KB-10KB per process      │
│    └─ Old generation: unbounded                    │
│    └─ ETS tables                                   │
└──────────────────────────────────────────────────────┘
```

**Key insight:** Context switching between BEAM processes invalidates the previous process's entire working set. Hot loops that stay in one process stay cache-warmed. Process switching = cache cold start.

## BEAM-Specific Data Layout Patterns

### Small Ints vs Boxed Terms

```erlang
% GOOD: Small integers stay unboxed (inline in 64-bit word)
Count = 42,
Result = Count + 1,
% Count is a "small int" — no heap allocation, no GC pressure

% BAD: Large integers get boxed (heap allocation)
BigCount = 2000000000000,
Result = BigCount + 1,
% This is now a boxed term — heap allocation, GC pressure, cache miss
```

**Threshold:** On 64-bit BEAM, integers ≤ 2²⁸ (268,435,456) are small ints. Above that, boxed.

### Tuples: The Fixed-Size King

```erlang
% GOOD: Small tuple, all inlined
Point = {x, 1.0, 2.0, 3.0},
% Fits in 1-2 cache lines, no pointer chasing

% BAD: Large tuple, boxed
Data = {a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p},
% Boxed — pointer to heap, cache miss to dereference
```

**Rule of thumb:** Tuples ≤ 7 elements are unboxed (inline). Above that, boxed.

### Maps vs Proplists

| Access Pattern | Map | Proplist | Tuple |
|---------------|-----|----------|-------|
| Fixed structure, named fields | ✅ | ❌ | ✅ Best |
| Sparse data, dynamic keys | ✅ Best | ⚠️ | ❌ |
| Small, unordered pairs | ⚠️ | ✅ | ❌ |
| Frequent access, hot path | ✅ Best | ❌ | ⚠️ |

```erlang
% GOOD: Compact map for structured data
Config = maps:from_list([{timeout, 5000}, {retries, 3}]),
maps:get(timeout, Config),  % O(1) access

% GOOD: Compact maps when keys are stable
Compacted = maps:compact(Config),
% Compacted maps use less memory and access faster

% AVOID: Proplists for frequent access
Config2 = [{timeout, 5000}, {retries, 3}],
lists:keyfind(timeout, 1, Config2),  % O(n) traversal
```

### Binaries: The Hidden Superpower

Binary pattern matching is the BEAM's superpower — the compiler optimizes it into efficient byte-level operations.

```erlang
% GOOD: Binary pattern matching (zero-copy when possible)
<<Version:8, Code:8, Payload/binary>> = Data,
% Version and Code are inline, Payload is a reference

% BAD: Binary concatenation in hot paths
NewData = OldData <> <<NewByte>>,
% Each <> creates a new binary — O(n) copy each time!

% GOOD: Binary construction (compile-time, not runtime)
Encoded = <<<<B:8>> || B <<Bytes/binary>>>,
% Single allocation, no intermediate copies
```

## Hot Path Optimization Techniques

### Avoid Unnecessary Allocation in Hot Loops

```erlang
% BAD: Allocation per iteration
process_items(Items) ->
    lists:map(fun(Item) ->
        NewItem = do_transform(Item),  % Creates new term each call
        persist(NewItem)
    end, Items).

% GOOD: Minimize allocation
process_items(Items) ->
    lists:map(fun(Item) ->
        do_transform_in_place(Item)  % If possible, modify in place
    end, Items).
```

Each allocation is a heap bump, which may exceed L1 cache. Hot loops should stay cache-warmed.

### Message Passing: The Mailbox Problem

```erlang
% BAD: Large messages in mailbox
handle_info({large_data, BigBinary}, State) ->
    % BigBinary copied into process heap on receive
    % If BigBinary > L2 cache, this is a cache miss factory

% GOOD: Pass minimal references
handle_info({data_ref, Ref}, State) ->
    Data = ets:lookup(ref_table, Ref),
    % Fetch from shared ETS only when needed
    % Avoids copying large data into process heap
```

Mailbox traversal cost: Each `receive` clause pattern-matches against the mailbox head. Unwanted messages cause cache misses as the BEAM scans the linked list.

### Selective Receive

```erlang
% GOOD: Pattern-match early to skip unwanted messages
loop(State) ->
    receive
        {specific_type, Data} ->
            handle_specific(Data, State);
        % Other patterns handled similarly
    end,
    loop(NewState).

% BAD: Late filtering (processes all messages)
loop(State) ->
    Msg = receive _ -> Msg end,  % Read ANY message
    case Msg of
        {specific_type, Data} -> handle_specific(Data, State);
        _ -> loop(State)
    end.
```

### Process Migration and Cache

```erlang
% BEAM's work-stealing scheduler can move processes between CPU cores
% This invalidates the process's heap from the previous core's cache

% GOOD: Keep hot processes on the same core
spawn_opt(fun() -> hot_loop() end, [lightweight, {scheduler_binding, 0}]),
% Bind to specific scheduler to maintain cache locality

% AVOID: Migrating hot processes across cores
% The BEAM scheduler does this automatically, but you can influence it
```

## BEAM-Specific Performance Patterns

### List Comprehensions vs Map/Filter

```erlang
% GOOD: List comprehensions (compiled to efficient BEAM code)
Result = [X * 2 || X <- List, X > 0],

% GOOD: Enum in Elixir (well-optimized)
result = Enum.map(Enum.filter(list, &(&1 > 0)), &(&1 * 2))

% AVOID: Manual recursion for simple transformations
% The compiler optimizes comprehensions better than manual recursion
```

### Tail Recursion: The One True Loop

```erlang
% GOOD: Tail-recursive loop (no stack growth)
loop([], Acc) -> Acc;
loop([H|T], Acc) -> loop(T, combine(Acc, H)).

% BAD: Non-tail recursion (stack growth)
process([H|T]) ->
    Result = process_item(H),
    process(T) ++ [Result].
% Each call creates a new stack frame → more heap pressure
```

### ETS Tables for Shared Data

```erlang
% GOOD: ETS for read-heavy shared data
-define(TABLE, my_data).
ets:insert(?TABLE, {key, Value}),
Value = ets:lookup_element(?TABLE, Key, 2).

% GOOD: Set ETS for O(1) access
ets:new(?TABLE, [set, named_table, public]),

% AVOID: Process dictionary for shared state
put(key, Value),  % Per-process, not shared
```

**ETS advantage:** ETS data lives in the BEAM's shared memory, not per-process heaps. Multiple processes can read without copying.

### External Binary References

```erlang
% GOOD: External binary reference (no copy)
{Ref, Binary} = make_ref(),
ets:insert(ref_table, {Ref, Binary}),
% When you retrieve Ref, you get a reference, not a copy

% BAD: Copying large binaries
LargeBinary = ets:lookup(ref_table, Ref),
% This copies the binary into the process heap
```

## Profiling & Cache Analysis

### erlang:system_profile

```erlang
% Profile a specific process
erlang:system_profile(Pid, [{duration, 5000}, {output, file}]),

% Profile all processes
erlang:system_profile(all, [{duration, 10000}, {output, file}]),
```

### recon Library

```erlang
% Find hot functions
recon:fun_calls(10000),
recon:fun_calls_time(10000),

% Monitor memory usage
recon:alloc_sampler(1000),
recon:proc_alloc(5000),
```

### Observer (GUI)

```erlang
observer:start(),
% Visual process tree, memory usage, GC info
% Look for processes with high memory or frequent GC
```

### etop (Real-time)

```bash
etop --sort time --interval 5
# Shows per-process CPU time and memory
```

## The Mechanical Sympathy Checklist

- [ ] **Use small integers** when possible (≤ 2²⁸ on 64-bit)
- [ ] **Keep tuples small** (≤ 7 elements to stay unboxed)
- [ ] **Prefer maps** over proplists for frequent access
- [ ] **Use binary pattern matching** for structured data
- [ ] **Avoid binary concatenation** (`<>`) in hot paths
- [ ] **Pass minimal data in messages** (references, not copies)
- [ ] **Use selective receive** to avoid scanning unwanted messages
- [ ] **Keep hot processes on same core** when possible
- [ ] **Use tail recursion** for loops (no stack growth)
- [ ] **Use ETS** for shared read-heavy data
- [ ] **Profile before optimizing** (`erlang:system_profile`, `recon`)
- [ ] **Avoid large allocations in hot loops**

## The AI/ML Connection to BEAM

### Why BEAM Isn't Ideal for Raw ML Inference

| Issue | BEAM Reality |
|-------|-------------|
| Tag overhead | Every float is a boxed term (8 bytes for a 4-byte value) |
| No SIMD | BEAM has no vectorized operations on lists/arrays |
| Per-process heaps | Can't share large model weights efficiently |
| GC pauses | May cause latency spikes in real-time inference |

### Where BEAM Excels for AI Systems

| Use Case | Why BEAM Wins |
|----------|--------------|
| ML pipeline orchestration | Actor model, fault tolerance, hot code reload |
| Real-time feature engineering | Low-latency message passing, process isolation |
| Model serving coordination | ETS for shared state, process supervision |
| A/B testing infrastructure | Dynamic code loading, process migration |

**The insight:** BEAM isn't for the matrix multiplication — it's for the system that orchestrates the matrix multiplications, handles failures, scales horizontally, and recovers automatically.

## Resources

| Resource | Author | Why Read |
|----------|--------|----------|
| [The BEAM Book](https://leanpub.com/thebeambook) | Fred Hebert | Comprehensive BEAM internals |
| [Erlang Efficiency](https://www.erlang.org/doc/info/efficiency_guide) | Erlang docs | Official efficiency guide |
| [Optimizing Erlang Programs](http://www.ferd.ca/optimizing-erlang-programs.html) | Fred Hebert | Practical optimization |
| [BEAM VM Internals](https://github.com/beam-community/beam-book) | Community | Deep dive into VM internals |
| [recon](https://github.com/ferd/recon) | Fred Hebert | Essential profiling library |
| [Observer](https://www.erlang.org/doc/apps/observer/observer.html) | Erlang docs | Visual profiling tool |

---

The mechanical sympathy principles from Thompson and Meyers absolutely apply to BEAM code — but the specific techniques are different. Tag overhead is the hidden tax. Per-process heaps mean context switching equals cache cold start. Binary pattern matching is the BEAM's superpower. Small integers and small tuples stay unboxed. ETS tables for shared data avoid per-process heap copying. Selective receive avoids scanning unwanted messages.

When you write hot paths in Erlang or Elixir, loop over data, or design systems that trade in microseconds — come back here. You'll code like the machine is actually there.

*Gray Beam Technology is building in public. More mechanical sympathy content coming soon.*
