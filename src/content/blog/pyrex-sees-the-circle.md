---
title: "Pyrex Sees the Circle: Multimodal Vision in a BEAM-Native Inference Engine"
category: "Engineering"
author: McHughson Chambers
date: 2026-04-13
---

I asked our ground-up Rust/Elixir inference engine to describe an image of a red circle on a white background. It said "a collection of stones with various colors." HuggingFace's reference implementation, same model weights, same image, said "I see a circle that is red."

Same weights. Same architecture. Completely different output. Finding out why took a 3-phase bisection across 16 vision encoder layers, 35 decoder layers, and one very specific ordering bug that no amount of staring at code would have caught.

After the fix: "This is a simple image of a solid red circle on a white background." Word-for-word match with HuggingFace.

## What Pyrex is

Pyrex is a BEAM-native LLM inference engine — Elixir/OTP control plane, Rust NIF data plane, NVIDIA GPUs via candle. Not a wrapper around vLLM or llama.cpp. Ground-up implementation with OTP supervision trees managing GPU scheduling, continuous batching, and per-request process isolation.

The multimodal work adds Gemma 4 E2B's vision tower: a 16-layer SigLIP-style ViT with quantization-aware ClippedLinear layers, a spatial pooler, and Per-Layer Embeddings (PLE) that give each decoder layer its own view of the input.

The text model worked from day one. Vision took three bugs to get right.

## The bisection methodology

When the output is wrong but the embedding magnitudes look healthy, you can't guess — you have to measure. We built a diagnostic pipeline that dumps intermediate tensors from both Pyrex and HuggingFace at matching checkpoints, then compares them with cosine similarity.

The checkpoint hierarchy:

| Phase | Granularity | What it finds |
|-------|------------|---------------|
| A | Pipeline stage (patch embed → layer 0/7/15 → pooler → embedder) | Which stage diverges |
| B | Sub-operation within a layer (norm → Q/K/V proj → RoPE → attention → MLP) | Which operation |
| C | Root cause (weight values, dtype, computation order) | The fix |

Phase A immediately localized the problem: `patch_embed_out` matched perfectly (cosine 0.99999), but `layer_0_out` dropped to 0.81. One layer. Catastrophic divergence from correct inputs.

## Bug 1: The RmsNorm offset

Phase B narrowed it to `input_layernorm` — the very first RmsNorm in the encoder. The output values were systematically wrong by a non-constant factor.

The cause: Gemma 3's RmsNorm stores weights as residuals from 1.0, so the implementation does `x * (weight + 1.0)`. Gemma 4 changed this — weights are now absolute scale factors (mean=2.97, ranging from -2.7 to 21.75). The `+1.0` was turning a weight of 0.05 into 1.05 — a 21x scale error on that dimension.

One-line fix. Cosine jumped from 0.21 to 0.998. The model went from hallucinating text ("a long string of words") to recognizing visual content ("colored stones") — but still not accurately.

## Bug 2: F32 precision

The remaining 0.2% drift came from two sources: RmsNorm weight multiplication in BF16 (HF does it in F32), and BF16 softmax (HF upcasts to F32 for numerical stability). We also upcast the entire vision tower to F32 at load time — 344MB extra for 86M parameters, eliminating all BF16 matmul accumulation drift through 16 layers.

This improved early-layer matching but didn't change the output. The vision embeddings were 99.8% correct. Something downstream was breaking.

## Bug 3: PLE ordering

This was the hard one.

Gemma 4's Per-Layer Embeddings have two components: a token identity (embedding lookup) and a context projection (linear projection of the hidden states). The context projection lets each decoder layer's PLE signal carry information about what the model is actually processing at each position.

HuggingFace computes these in two phases:
1. Token identity from input_ids (before vision injection)
2. Context projection from embeddings **after** vision features replace the image tokens

Pyrex computed both phases before vision injection. The context projection at 256 image positions saw PAD token embeddings — near-zero, uninformative vectors — instead of the rich vision features from the vision tower. Every decoder layer's per-layer gating signal at image positions was effectively dead.

The model could tell *something* was there (the vision embeddings were correct), but the per-layer routing signals had no idea what it was seeing. Like having perfect eyes but a scrambled optic nerve.

Split the PLE into `token_identity()` and `project_context()`. Call the first before injection, the second after. Output: "I see a circle that is red."

## What this means

Three things made this debugging tractable:

**Binary dump comparison.** Raw F32 little-endian tensors from both sides, compared with numpy. No text round-tripping, no eyeballing log output. Cosine similarity with clear thresholds: >0.9999 is match, <0.99 is suspicious, <0.9 is catastrophic.

**Coarse-to-fine bisection.** Don't check every layer — check layers 0, 7, 15. Find the divergent range, binary search within it. We found the bug layer in 3 checkpoints, the bug operation in 2 more.

**Treating the reference as ground truth.** Every intermediate tensor has a known-correct value from HuggingFace. The question is never "is this right?" — it's "does this match?" That's a much easier question.

The OTP architecture gave us something we didn't expect to use for debugging: process isolation means each inference request gets its own state. No shared mutable GPU state to worry about, no "is this a race condition?" No — each request is a GenServer with its own lifecycle. When the vision tower output was wrong, we knew it was the vision tower, not a scheduling artifact.

## Current state

Pyrex correctly handles Gemma 4 E2B multimodal inference — image understanding that matches HuggingFace output. The vision tower runs in F32 for precision, the text model in BF16 for efficiency, with an OpenAI-compatible API serving SSE-streamed responses.

Tested with the synthetic circle and with real photographs. The model produces detailed, coherent scene descriptions: spatial relationships, materials, lighting conditions, color palettes. Same quality as the reference implementation, running on OTP supervision with Rust NIF compute.

Next: PagedAttention with a real block allocator (Phase 5), and CogView4 image generation (Phase 4B). The BEAM doesn't just schedule Erlang processes well — it schedules GPU work well too.
