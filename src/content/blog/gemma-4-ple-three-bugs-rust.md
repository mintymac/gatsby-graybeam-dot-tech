---
title: "Three Bugs Between You and Working Gemma 4 in Rust"
category: "Engineering"
author: McHughson Chambers
date: 2026-04-10
---

We're building a BEAM-native LLM inference engine in Elixir and Rust. Not a wrapper around vLLM — a ground-up implementation where OTP handles scheduling and Rust NIFs handle the GPU. When Google released Gemma 4 under Apache 2.0, we pointed it at the E4B model (4.5 billion effective parameters, runs on a single GPU) and got garbage.

Not "slightly wrong" garbage. Multilingual word salad. `gotta gotta gotta gotta`. Every token was wrong.

Here's what was actually broken, how we found it, and what it took to fix it.

## The Architecture

The stack: Elixir GenServer owns the model lifecycle. Rustler NIF bridges to Rust. We forked HuggingFace's [candle](https://github.com/huggingface/candle) ML framework's Gemma 4 module (~750 lines) and added the missing pieces. CUDA runs on an RTX A6000.

Candle has a `gemma4` module that handles the standard transformer layers — attention, MLP, RoPE, KV cache. It compiles, loads weights, runs forward passes. But Gemma 4's E2B and E4B models use an architecture feature called **PLE (Per-Layer Embeddings)** that candle doesn't implement. Without it, every layer gets wrong conditioning signals, and the output is incoherent.

## What PLE Actually Does

PLE is simpler than it sounds. It's a parallel pathway that gives each decoder layer its own small embedding vector per token:

1. **Before the layer loop**: Look up a per-layer embedding table (one entry per token, sliced into 42 layers x 256 dimensions). Project the main hidden state through a linear layer. Combine them.
2. **Inside each layer**: After attention and MLP, gate the hidden state down to 256 dims, multiply by the PLE vector for this layer, project back up, add as residual.
3. **Layer scalar**: Multiply each layer's output by a learned scalar.

About 100 lines of new Rust code. The embedding table is large (~5.6GB for E4B) but the per-layer computation is lightweight.

We implemented all of this. The model loaded. Tokens came out. They were still garbage.

## Bug 1: RmsNorm Offset (Inherited From Candle)

Gemma 1, 2, and 3 use an RmsNorm that adds 1.0 to the weight before multiplying: `normalized * (weight + 1.0)`. The weights are initialized to zeros and trained to small offsets around zero.

Gemma 4 dropped this. Its `Gemma4RMSNorm` uses plain `normalized * weight`. The weights are initialized to ones and trained to values like 10.0. We checked the actual checkpoint values:

```
input_layernorm.weight — mean: 10.13, range: [3.94, 92.0]
```

These are clearly not offsets around zero. Candle's forked code still had the `+ 1.0`. Every hidden state at every layer was being scaled by `(weight + 1.0)` instead of just `weight` — a ~10% error that compounds through 42 layers.

**Fix**: One line. Remove the `+ 1.0`.

## Bug 2: Attention Scaling

Standard transformers scale attention logits by `1/sqrt(head_dim)` before softmax. Gemma 4 doesn't — it uses a scaling factor of 1.0. The Q and K norms handle magnitude control, so the traditional scaling would flatten the attention distribution.

For E4B with `head_dim=256`, the wrong scaling was `1/sqrt(256) = 0.0625` — reducing all attention logits by 16x. The attention pattern becomes nearly uniform, so every token attends to everything equally.

**Fix**: Set the scale to 1.0.

## Bug 3: KV Sharing (The One That Mattered)

After fixing bugs 1 and 2, the output changed from `gotta gotta gotta` to different garbage — mixed scripts, nonsense fragments. Better, but still wrong.

This is where we wasted time. We tried fixing the chat template, adjusting BOS tokens, checking GELU variants, auditing weight paths. None of it mattered because **we were debugging by reading code instead of measuring outputs**.

When we finally added numerical tracing — printing the mean, min, and max of the hidden state after each layer and comparing against HuggingFace transformers running the same prompt — the bug was immediately obvious:

| Layer | Python (reference) | Rust (ours) | Match? |
|-------|-------------------|-------------|--------|
| 0 | mean=-0.011734 | mean=-0.011659 | Yes |
| 1 | mean=0.050869 | mean=0.050885 | Yes |
| 22 | mean=-0.006110 | mean=-0.006253 | Yes |
| 23 | mean=-0.002362 | mean=-0.002141 | Yes |
| **24** | **mean=0.016268** | **mean=-0.009115** | **No** |
| 25 | mean=0.009702 | mean=0.005483 | Diverging |

Layers 0-23: identical. Layer 24: sign flip. Everything after: increasingly wrong.

Layer 24 is the first **KV-shared layer**. Gemma 4 E4B has `num_kv_shared_layers: 18`, meaning layers 24-41 don't compute their own key/value projections. They reuse K/V states from the last non-shared layer of the same type (sliding or global attention). It's a parameter efficiency trick — 18 layers skip K/V computation entirely.

Our code didn't know about this. It loaded and used the K/V projection weights for every layer. Those weights exist in the safetensors file (probably leftover from conversion), but the reference implementation ignores them for shared layers. Using them instead of the donor K/V gives completely different attention patterns.

**Fix**: Track which layers are donors, store their post-cache K/V, and pass it to shared layers instead of computing fresh K/V. About 80 lines of Rust — a `HashMap<usize, (Tensor, Tensor)>` that maps donor layer indices to their K/V states.

## The Debugging Lesson

Bug 3 took the longest not because it was hard to fix, but because we found it last. We could have found it first if we'd started with numerical tracing instead of code reading.

The pattern: when model output is wrong, don't read the code and theorize about what *might* be broken. Instead, pick checkpoints through the forward pass, print the actual numbers, compare against a known-good reference. Binary search the computation.

Our subagent analysis found 9 "potential bugs" by reading code and ranked them by severity. The actual root cause was ranked #8 — "LOW" priority. The ranking was based on reasoning about what *should* matter. The numerical trace found it in one run.

## Current State

Gemma 4 E4B produces coherent output through our Elixir/Rust stack:

```
Prompt: "What is the capital of France?"
Response: "The capital of France is **Paris**."
```

The full implementation — PLE, KV sharing, Gemma 4 RmsNorm, correct attention scaling — is about 750 lines of Rust in a forked candle module. It runs on a single GPU (needs ~20GB for E4B at BF16) alongside Elixir's OTP supervision tree.

If you're implementing Gemma 4 inference from scratch in any framework, the three things to check:

1. **RmsNorm**: No `+1` offset. Weights are ~10.0, not ~0.0.
2. **Attention scaling**: 1.0, not `1/sqrt(head_dim)`. QK norms handle it.
3. **KV sharing**: Layers after `num_hidden_layers - num_kv_shared_layers` reuse K/V from donor layers. Don't compute fresh K/V for them.

Get those three right and the model works. Miss any one and you get word salad.
