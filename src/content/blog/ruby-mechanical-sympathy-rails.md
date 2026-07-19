---
title: "Mechanical Sympathy in Ruby: Coding for the Hardware That's Actually There"
category: "Engineering"
author: McHughson Chambers
date: 2026-07-18
---

The same principles that make Martin Thompson's Disruptor fly at microsecond latencies apply to Ruby and Rails — but the patterns look completely different because Ruby's runtime manages memory in its own way.

## The Hidden Tax: Ruby's Garbage Collection

Ruby isn't like C where you control memory layout. It's a garbage-collected language with a mark-and-sweep GC. But that doesn't mean you can ignore hardware realities.

**The consequence:** Ruby objects are heap-allocated with overhead. Every `String`, `Array`, `Hash`, or custom object carries GC metadata. Hot paths that create thousands of temporary objects trigger frequent GC pauses.

### Object Allocation Patterns

```ruby
# BAD: Creating new objects in hot loops
def process_items(items)
  items.map do |item|
    result = ItemConverter.new(item).convert  # New object every iteration
    save_to_database(result)
  end
end

# GOOD: Reuse objects where possible
def process_items(items)
  converter = ItemConverter.new
  items.each do |item|
    result = converter.convert(item)  # Reuse the converter
    save_to_database(result)
  end
end
```

**Why:** Each allocation is a heap bump. When the heap fills up, Ruby's GC kicks in and pauses all threads. Hot loops should minimize allocations to stay cache-warmed.

## Ruby's Memory Hierarchy

```
┌──────────────────────────────────────────────────────┐
│  CPU Registers                                     │
│    └─ Stack pointer, method arguments              │
├──────────────────────────────────────────────────────┤
│  L1/L2 Cache (in-process)                          │
│    └─ Currently executing method's stack frames    │
│    └─ Small/inline objects (Fixnum, Symbol)        │
├──────────────────────────────────────────────────────┤
│  L3 Cache (shared)                                 │
│    └─ Heap-allocated objects                         │
│    └─ Loaded gems and libraries                    │
├──────────────────────────────────────────────────────┤
│  Heap (GC-managed)                                 │
│    └─ Large objects (String, Array, custom classes)│
│    └─ GC metadata (mark bits, sweep pointers)      │
└──────────────────────────────────────────────────────┘
```

**Key insight:** Ruby's GC runs on all threads. When it triggers, your entire application pauses. The fewer allocations in hot paths, the fewer GC pauses.

## Ruby-Specific Data Layout Patterns

### Fixnums vs Objects

```ruby
# GOOD: Fixnums are immediate values (no heap allocation)
count = 42
result = count + 1
# Fixnums up to 2³⁰ (on 64-bit) are immediate — no GC overhead

# BAD: Large integers get boxed
big_number = 2000000000000
result = big_number + 1
# This is now a Bignum — heap allocation, GC overhead
```

### Symbols vs Strings

```ruby
# GOOD: Symbols are interned (single copy in memory)
:status  # One symbol object, shared everywhere
# No GC pressure, fast comparison

# BAD: Strings create new objects
"status" # New string object every time
# GC pressure, slower comparison
```

**Rule of thumb:** Use symbols for repeated keys, strings for user input.

### Arrays vs Hashes

| Access Pattern | Array | Hash |
|---------------|-------|------|
| Sequential access | ✅ Best | ⚠️ |
| Random access by index | ✅ Best | ❌ |
| Sparse data, dynamic keys | ⚠️ | ✅ Best |
| Frequent access, hot path | ✅ Best | ⚠️ |

```ruby
# GOOD: Array for dense, sequential data
data = [1, 2, 3, 4, 5]
data[0]  # O(1) access, cache-friendly

# GOOD: Hash for sparse, keyed data
config = {timeout: 5000, retries: 3}
config[:timeout]  # O(1) access

# BAD: Using hash for dense, sequential data
config = {0 => 1, 1 => 2, 2 => 3, 3 => 4}
config[0]  # O(1) but more overhead than array
```

### String Interpolation vs Concatenation

```ruby
# GOOD: Interpolation (compiled to efficient bytecode)
result = "#{name}: #{value}"

# BAD: Concatenation (creates new string each time)
result = name + ": " + value.to_s
# Each + creates a new string — GC pressure
```

## Hot Path Optimization Techniques

### Avoid Unnecessary Object Creation in Loops

```ruby
# BAD: Creating new objects per iteration
def process_items(items)
  items.map do |item|
    Result.new(item.id, item.name, item.value)
  end
end

# GOOD: Pre-allocate if possible
def process_items(items)
  results = Array.new(items.size)
  items.each_with_index do |item, i|
    results[i] = Result.new(item.id, item.name, item.value)
  end
  results
end
```

### Method Calls vs Instance Variable Access

```ruby
# BAD: Method calls in tight loops
def process(items)
  items.each do |item|
    name = item.name  # Method call overhead
    value = item.value
  end
end

# GOOD: Cache method results if they don't change
def process(items)
  items.each do |item|
    name = item.instance_variable_get(:@name)  # Direct access
    value = item.instance_variable_get(:@value)
  end
end
```

**Warning:** This breaks encapsulation. Only do this if profiling shows it's necessary.

### Reduce GC Pressure with Object Pooling

```ruby
# BAD: New objects in hot loop
def process_batch(items)
  items.each do |item|
    processor = ItemProcessor.new
    processor.process(item)
  end
end

# GOOD: Reuse objects
def process_batch(items)
  processor = ItemProcessor.new
  items.each do |item|
    processor.reset  # Reset state if needed
    processor.process(item)
  end
end
```

### Use `tap` and `then` to Avoid Temporary Variables

```ruby
# BAD: Intermediate variables
result = compute_something
result = transform(result)
result = validate(result)
result

# GOOD: Pipeline without temporaries
compute_something.tap { |r| transform(r) }.then { |r| validate(r) }
```

## Ruby on Rails Specific Patterns

### N+1 Queries: The Silent Killer

```ruby
# BAD: N+1 query problem
users.each do |user|
  puts user.profile.bio  # One query per user!
end

# GOOD: Eager loading
users = User.includes(:profile).limit(100)
users.each do |user|
  puts user.profile.bio  # Single query
end
```

**Why it matters:** Each query is a context switch to the database. N+1 queries multiply this cost.

### ActiveRecord Object Creation

```ruby
# BAD: Creating objects in loops
def update_prices(items)
  items.each do |item|
    ActiveRecord::Base.transaction do
      product = Product.find(item.product_id)
      product.update(price: item.new_price)
    end
  end
end

# GOOD: Batch operations
def update_prices(items)
  Product.where(id: items.pluck(:product_id)).update_all(
    price: items.each_with_object({}) { |item, hash| hash[item.product_id] = item.new_price }
  )
end
```

### String Building in Views

```erb
<!-- BAD: String concatenation in view -->
<% users.each do |user| %>
  <div><%= user.name + " (" + user.email + ")" %></div>
<% end %>

<!-- GOOD: ERB interpolation -->
<% users.each do |user| %>
  <div><%= "#{user.name} (#{user.email})" %></div>
<% end %>
```

## Profiling & Cache Analysis

### Ruby Profiling Tools

**`ruby-prof` for method-level profiling:**
```bash
gem install ruby-prof
```

```ruby
require 'ruby-prof'

RubyProf.start
# Your code here
result = RubyProf.stop

printer = RubyProf::GraphHtmlPrinter.new(result)
printer.print(path: 'profile_output')
```

**`benchmark/ips` for micro-benchmarks:**
```ruby
require 'benchmark/ips'

Benchmark.ips do |x|
  x.config(time: 5, warmup: 2)
  
  x.report('array') do
    arr = [1, 2, 3, 4, 5]
    arr.each { |i| i * 2 }
  end
  
  x.report('map') do
    arr = [1, 2, 3, 4, 5]
    arr.map { |i| i * 2 }
  end
  
  x.compare!
end
```

**`stackprof` for CPU profiling:**
```bash
gem install stackprof
```

```ruby
require 'stackprof'

StackProf.start(mode: :cpu, raw: true)
# Your code here
result = StackProf.results

# Save to file for analysis
File.write('stackprof.dump', Marshal.dump(result))
```

### ActiveRecord Query Analysis

**Enable query logging:**
```ruby
# config/environments/development.rb
config.active_record.verbose_query_logs = true
config.active_record.logger = Logger.new(STDOUT)
```

**Use `explain` to analyze queries:**
```ruby
User.includes(:posts).explain
# Shows query plan, helps identify N+1 and missing indexes
```

## The Mechanical Sympathy Checklist for Ruby

- [ ] **Use Fixnums** when possible (no GC overhead)
- [ ] **Use Symbols** for repeated keys (interned, fast comparison)
- [ ] **Use Arrays** for dense, sequential data
- [ ] **Use Hashes** for sparse, keyed data
- [ ] **Use string interpolation** over concatenation
- [ ] **Reuse objects** in hot loops (object pooling)
- [ ] **Avoid N+1 queries** (use `includes`, `joins`, `eager_load`)
- [ ] **Use batch operations** for bulk updates
- [ ] **Profile before optimizing** (`ruby-prof`, `stackprof`, `benchmark/ips`)
- [ ] **Minimize allocations** in hot paths

## Integration with Static Analysis

### Credo for Elixir (BEAM)

```yaml
# .credo.yml
checks:
  - { check: Credo.Check.Performance.LargeTuple, params: [max_size: 100] }
  - { check: Credo.Check.Performance.BinaryConcat }
  - { check: Credo.Check.Performance.ProplistLookup }
  # Add custom rules here
```

### RuboCop for Ruby

```yaml
# .rubocop.yml
Performance/Count:
  Enabled: true

Performance/FlatMap:
  Enabled: true

# Add custom cops for cache-conscious patterns
Style/For:
  EnforcedStyle: each

# Custom rule example
Lint/LoopAllocation:
  Enabled: true
  Message: "Avoid object allocation in loops. Consider pre-allocating or reusing objects."
```

## The AI/ML Connection to Ruby

### Why Ruby Isn't Ideal for Raw ML Inference

| Issue | Ruby Reality |
|-------|-------------|
| GC overhead | Every float is a Ruby object with GC metadata |
| No SIMD | Ruby has no vectorized operations |
| Dynamic typing | Method dispatch overhead per call |
| Single-threaded | GIL-like behavior with MRI |

### Where Ruby Excels for AI Systems

| Use Case | Why Ruby Wins |
|----------|--------------|
| ML pipeline orchestration | Expressive syntax, fast development |
| Feature engineering | Data manipulation libraries |
| Model serving coordination | Web frameworks, API layer |
| Monitoring and alerting | Observability gems, alerting |

**The insight:** Ruby isn't for the matrix multiplication — it's for the system that orchestrates the matrix multiplications, handles failures, scales horizontally, and provides a great developer experience.

## Resources

| Resource | Author | Why Read |
|----------|--------|----------|
| [Optimizing Ruby](https://www.oreilly.com/library/view/optimize-ruby/9781491929381/) | Avdi Grimm | Ruby performance patterns |
| [Ruby Under a Microscope](https://www.manning.com/books/ruby-under-a-microscope) | Pat Shaughnessy | Ruby internals deep dive |
| [Performance Ruby](https://pragmaticengineer.com/performance-ruby/) | Pragmatic Studio | Practical optimization |
| [StackProf](https://github.com/tmm1/stackprof) | Todd Miller | CPU profiling tool |
| [ruby-prof](https://github.com/ruby-prof/ruby-prof) | Sven Strittmatter | Method-level profiling |
| [benchmark/ips](https://ruby-doc.org/stdlib/libdoc/benchmark/rdoc/Benchmark/IPS.html) | Ruby stdlib | Micro-benchmarks |

---

The mechanical sympathy principles from Thompson and Meyers absolutely apply to Ruby — but the specific techniques are different. Fixnums and symbols avoid GC pressure. Arrays and hashes have different cache behaviors. N+1 queries multiply context switch costs. Object pooling reduces GC pauses.

When you write hot paths in Ruby or Rails, loop over data, or design systems that trade in milliseconds — come back here. You'll code like the machine is actually there.

*Gray Beam Technology is building in public. More mechanical sympathy content coming soon.*
