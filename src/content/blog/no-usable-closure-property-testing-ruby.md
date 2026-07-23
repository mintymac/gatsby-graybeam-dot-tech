---
title: "No Usable Closure: Why Ruby Needs Properties, Not More Examples"
category: "Engineering"
author: McHughson Chambers
date: 2026-07-23
---

A test suite can be green for years and still tell us nothing about the next input.

That sounds pessimistic. It is actually a useful design constraint.

Stephen Wolfram's essay, [“Towards a Theory of Bugs: The Ruliology of the Unexpected”](https://writings.stephenwolfram.com/2026/07/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected/), studies how tiny computational rules can produce behavior that stays simple for a long time and then becomes surprising. JD Redding compressed the engineering problem into two words in [a response on X](https://x.com/JDRedding/status/2080079395981873268):

> No closure.

Redding's point was not that testing is useless. It was that a finite run of correct outputs does not, by itself, create a frontier beyond which correctness is guaranteed. A program can agree with its specification for every case we have tried and disagree on the next one.

For Ruby teams, the practical response is not to run the same style of test a million more times. It is to change what we ask tests to establish.

Instead of specifying only examples of correct answers, we specify the **shape of every acceptable answer**.

## The important nuance: no *usable* closure

There is a mathematical subtlety worth preserving.

If we strictly fix a Turing machine's description size, alphabet, and other details, only finitely many such machines exist. In that abstract setting, a largest first counterexample can exist. But finding that bound is generally not computable, and the bound can grow beyond anything we could execute. As the program grows, the proposed frontier moves with it.

So the engineering claim is more precise than “no finite bound can ever exist”:

> Passing every test up to some practical boundary does not give us a usable certificate of correctness beyond that boundary.

We do not know whether the next failure waits at input 10,001, after a peculiar sequence of state transitions, under one thread interleaving, or behind a date rollover in 2042.

This is computational irreducibility translated into an operating posture: some behavior can only be discovered by letting the system evolve.

## Example tests describe points

A familiar RSpec test identifies one point in the input space:

```ruby
RSpec.describe Price do
  it "applies a 20 percent discount" do
    price = Price.new(cents: 10_00)

    expect(price.discount(20).cents).to eq(8_00)
  end
end
```

This is valuable. It records a concrete business example in a form another developer can read.

But what has it established?

- It says nothing about a zero price.
- It says nothing about a 0% or 100% discount.
- It says nothing about very large values.
- It says nothing about invalid percentages.
- It says nothing about rounding at values that do not divide cleanly.

We can add examples for all five. There will still be another dimension we did not name.

The weakness is not RSpec. The weakness is the proposition. We asked whether one input produces one output.

## Properties describe regions

For a valid discount, we can state stronger claims:

1. The result is never negative.
2. The result is never greater than the original price.
3. Increasing the discount never increases the result.
4. A 0% discount is an identity operation.
5. A 100% discount produces zero.

These are invariants and metamorphic relations. They do not require us to know the exact answer for every generated price. They define a safe region the answer must occupy and relationships that must survive transformations of the input.

That is the shift:

```text
example test:  input A must produce output B
property test: every valid input must produce an output inside region R
```

The property is not a proof. It is a better searchlight.

## Property testing in Ruby

[PropCheck](https://github.com/Qqwy/ruby-prop_check) brings QuickCheck-style property testing and shrinking to Ruby. It generates many inputs from a description, runs the property for each one, and simplifies a failure toward a small counterexample.

Add it to the test group:

```ruby
group :test do
  gem "prop_check"
end
```

Then describe the input domain and the invariant:

```ruby
RSpec.describe Price do
  G = PropCheck::Generators

  it "keeps valid discounts inside the price boundary" do
    PropCheck.forall(
      cents: G.choose(0..10_000_000),
      percent: G.choose(0..100)
    ) do |cents:, percent:|
      original = Price.new(cents:)
      discounted = original.discount(percent)

      expect(discounted.cents).to be_between(0, cents)
    end
  end

  it "is monotonic as the discount increases" do
    PropCheck.forall(
      cents: G.choose(0..10_000_000),
      first: G.choose(0..100),
      second: G.choose(0..100)
    ) do |cents:, first:, second:|
      low, high = [first, second].minmax
      price = Price.new(cents:)

      expect(price.discount(high).cents)
        .to be <= price.discount(low).cents
    end
  end
end
```

The ranges matter. A generator is part of the specification. If negative prices or discounts above 100 are invalid, we should test that boundary separately and assert a deliberate rejection rather than mixing invalid data into a property about valid behavior.

### Why shrinking matters

Random data alone often finds a failure wrapped in noise:

```text
price: 8,392,417
discount: 73
```

A shrinker repeatedly simplifies that input while preserving the failure. The useful result might be:

```text
price: 1
discount: 50
```

Now the problem is legible: the rounding rule for half of one cent was never specified.

Generation explores. Shrinking explains.

## Five property shapes we can reuse

Most useful properties are not invented from scratch. They recur across domains.

### 1. Round trips

Encoding followed by decoding should recover the original value:

```ruby
PropCheck.forall(payload: payload_generator) do |payload:|
  encoded = EventSerializer.dump(payload)
  decoded = EventSerializer.load(encoded)

  expect(decoded).to eq(payload)
end
```

This applies to JSON adapters, signed tokens, database serialization, API translation, import/export pipelines, and AST transforms.

The difficult part is defining equality. If serialization intentionally normalizes time zones or key order, the property should compare canonical forms rather than demand byte-for-byte identity.

### 2. Idempotence

Repeating a normalization should not keep changing the value:

```ruby
PropCheck.forall(text: G.printable_ascii_string) do |text:|
  once = Slug.normalize(text)
  twice = Slug.normalize(once)

  expect(twice).to eq(once)
end
```

Idempotence is a powerful property for retries. Webhooks, background jobs, migrations, and reconciliation processes often need a stronger version: applying the same command twice must leave persistent state equivalent to applying it once.

### 3. Conservation

Systems that distribute money, capacity, votes, inventory, or time should not create or destroy the quantity accidentally:

```ruby
PropCheck.forall(
  cents: G.choose(0..10_000_000),
  recipients: G.choose(1..100)
) do |cents:, recipients:|
  allocations = Allocator.split(cents, recipients)

  expect(allocations.length).to eq(recipients)
  expect(allocations.sum).to eq(cents)
  expect(allocations.max - allocations.min).to be <= 1
end
```

This checks three shapes at once: cardinality, conservation, and fairness within the indivisible unit.

### 4. Monotonicity

Adding evidence should not reduce a cumulative count. Increasing a discount should not increase a price. Extending a permission set should not remove an already permitted operation unless the domain explicitly supports deny precedence.

Monotonicity properties are especially good at exposing reversed comparisons and boundary errors.

### 5. Model agreement

When optimized code is difficult to reason about, compare it with a small, obviously correct model:

```ruby
PropCheck.forall(events: event_sequence_generator) do |events:|
  expected = ReferenceLedger.apply(events)
  actual = ProductionLedger.apply(events)

  expect(actual.balance).to eq(expected.balance)
end
```

The model can be slow. It only needs to be clear and independent enough that it is unlikely to reproduce the same bug.

This is often more effective than predicting a final answer by hand for hundreds of generated command sequences.

## Rails changes the cost model, not the principle

Property tests are fastest and easiest to shrink when domain rules are pure Ruby. That is an architectural signal.

If pricing, authorization, allocation, scheduling, and state-transition rules can run without a database, we can generate thousands of cases cheaply. Rails remains the delivery and persistence layer around a testable domain core.

Database-backed properties still have a place:

- a retry does not create a second payment;
- a transaction preserves the total balance;
- an authorization scope never returns another tenant's rows;
- creating then deleting a record restores the observable state;
- two equivalent request orders converge to the same result.

But every generated example must begin from isolated state. Transactional tests, explicit cleanup, and deterministic clocks are not optional. Otherwise the generator explores contamination from previous cases instead of the behavior we intended to test.

Concurrency needs a model too. Random thread sleeps are poor generators because they produce failures we cannot replay. Generate command sequences and scheduling decisions explicitly, record the seed, and compare externally visible results with a reference model.

## A property can be wrong

Property testing moves effort from selecting examples to writing claims. It does not make those claims true.

The most dangerous property is a tautology:

```ruby
expect(result).to eq(subject.calculate(input))
```

The oracle is just the implementation called a second time.

Other common mistakes include:

- generating only values the implementation already handles comfortably;
- discarding so many invalid cases that almost nothing is tested;
- asserting a weak type or “does not crash” when the domain requires more;
- duplicating the production algorithm inside the test;
- hiding nondeterminism instead of controlling it;
- treating 10,000 passing generated examples as proof.

Properties should come from the domain contract, not from reading the current implementation and describing what it happens to do.

## Tests are only one layer of the boundary

No pre-deployment suite can enumerate an open world. The acceptable-shape idea should continue into production.

For a payment system:

- balances never become negative without an explicit credit contract;
- every external request has an idempotency key;
- ledger entries balance;
- duplicate callbacks do not duplicate effects;
- reconciliation reports divergence instead of silently correcting it.

For an AI system:

- tool calls must conform to a schema;
- proposed actions must remain within authorization and budget;
- untrusted output never becomes executable input without validation;
- irreversible actions require a separate policy decision;
- uncertainty and provenance remain observable.

Some of these belong in types. Some belong in database constraints. Some belong in runtime validation, telemetry, circuit breakers, or human approval. A property test is one way to search for exits from the safe region. A production invariant is how we detect or prevent an exit when the world finds one first.

## How we will apply this across Gray Beam projects

We do not need to property-test every method. We should start where a small statement covers a large state space.

The first candidates are:

1. **Money and allocation:** conservation, bounds, rounding, and idempotency.
2. **State machines and workflows:** only legal transitions, terminal states remain terminal, retries preserve effects.
3. **Serialization boundaries:** round trips, canonicalization, backwards compatibility.
4. **Multi-tenant systems:** generated identities never cross authorization boundaries.
5. **Scheduling and time:** ordering, window containment, monotonic clocks, rollover behavior.
6. **LLM tool pipelines:** schema validity, capability limits, budget ceilings, and safe failure.

Ruby can use PropCheck alongside RSpec or Minitest. Our Elixir systems can express the same ideas with StreamData, Erlang systems with PropEr, and Gleam systems with qcheck. The syntax changes. The properties do not.

Every project should begin with a short invariant ledger:

```text
Property
Why it matters
Valid input generator
Independent oracle or relation
Runtime enforcement
Failure telemetry
```

That ledger is more valuable than a target such as “add 200 tests.” Test count measures artifacts. Invariants describe the system we are trying to preserve.

## Confidence without pretending to have proof

“No usable closure” is not a reason to give up on correctness. It is a reason to stop confusing a long sequence of green checks with a theorem.

Example tests remain excellent executable stories. Property tests explore families of behavior. Types eliminate invalid constructions. Database constraints protect persistent facts. Runtime guards enforce safety boundaries. Observability shows us behavior we did not predict.

None closes the computational universe.

Together, they give us something more useful: systems that state what must remain true, search aggressively for counterexamples, fail inside bounded regions, and tell us when reality has exceeded the model.

We cannot know that the next input is safe because every previous input passed.

We can know what shape safety must have.
