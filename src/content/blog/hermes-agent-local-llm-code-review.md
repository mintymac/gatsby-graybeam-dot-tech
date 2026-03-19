---
title: "From 5 False Positives to Zero: Making a Local LLM Agent Actually Useful for Code Review"
category: "Engineering"
author: McHughson Chambers
date: 2026-03-18
---

We spent a day getting NousResearch's Hermes Agent running on a local GPU with Qwen3.5, pointed it at our Elixir codebases, and watched it confidently report syntax errors that didn't exist. Then we fixed it. Here's what we learned about making local LLM agents useful for real work.

## The Setup

Two GPUs on our NixOS dev server (thor): an RTX 3090 (24GB) and an RTX A6000 (48GB). The goal was simple: run an autonomous coding agent locally, no API costs, reviewing our Elixir libraries and making fixes.

We chose Hermes Agent (v0.4.0) for the agent runtime and Qwen3.5-35B-A3B-GPTQ-Int4 via vLLM for inference. The model runs on the A6000 with 262K context and FP8 KV cache quantization. Tool calling uses vLLM's `qwen3_xml` parser.

Getting vLLM running on NixOS required one non-obvious fix: running `ldconfig` inside the container entrypoint before starting vLLM. NixOS mounts NVIDIA libraries into Docker containers but doesn't update the linker cache, so vLLM's subprocess for model architecture inspection can't find `libcuda.so`.

```bash
--entrypoint /bin/bash \
vllm/vllm-openai:cu130-nightly \
-c 'ldconfig 2>/dev/null; exec python3 -m vllm.entrypoints.openai.api_server ...'
```

## The First Review: Five Hallucinated Syntax Errors

We pointed Hermes at `graybeam_core`, a 35-file Elixir library that provides LLM proxying, circuit breakers, API key management, and request tracing.

The review came back with five "CRITICAL" syntax errors, all claiming the code wouldn't compile. Every single one was fake.

What happened: Hermes's `read_file` tool truncates lines longer than 2000 characters, adding `... [truncated]` mid-line. A perfectly valid Elixir expression like:

```elixir
tokens_in = usage["prompt_tokens"] || usage["input_tokens"] || 0
```

...gets displayed to the model as `tokens_in = usage[...ns"]`. The model sees broken syntax and confidently reports a compilation error.

It also claimed "no tests exist." There were 23 test files.

## The Three Fixes

### Fix 1: Disable Secret Redaction

Hermes applies regex-based redaction to tool output, replacing strings that look like API keys with `***`. Source code like `api_key = Vault.get_key(name)` becomes `api_key = ***`, which the model interprets as corrupted code.

One environment variable fixes it:

```bash
export HERMES_REDACT_SECRETS=false
```

Redaction belongs on *output* (logs, session dumps), not *input* (file reads). The agent needs to see the actual code.

### Fix 2: Project Context Files (AGENTS.md)

Hermes supports `AGENTS.md` files in project directories, equivalent to Claude Code's `CLAUDE.md`. We created one for each project with:

- What the project does and its architecture
- Valid Elixir patterns that should NOT be flagged (`||` chains, `rescue _ -> :ok`, dot access on structs)
- Known issues (so the agent doesn't re-discover them)
- The tool limitations warning (truncation artifacts are not syntax errors)

This alone eliminated the "no tests" false positive and improved severity ratings.

### Fix 3: A Verification Skill

Hermes has a skills system -- reusable instruction sets loaded into context. We wrote an `elixir-code-review` skill that includes a critical rule:

> If you see `...` in the middle of a line from read_file, it is a DISPLAY ARTIFACT, not a syntax error. To verify suspicious code, use terminal instead: `sed -n '340,345p' /path/to/file.ex`

The skill also mandates: before reporting any syntax error, verify with `sed` via terminal. Read test files before claiming they don't exist. Use a severity guide that distinguishes between "won't compile" and "improvement opportunity."

## The Results

Three runs on the same codebase with progressive fixes:

| Run | Config | False Syntax Errors | Context Used |
|-----|--------|--------------------:|-------------:|
| 1 | 32K context, no context files | 5 | 81% |
| 2 | 262K, AGENTS.md + SOUL.md + skill | 5 (tool artifacts) | 47% |
| 3 | 262K + no redaction + skill v2 | **0** | 36% |

Run 3 produced a genuinely useful review. It correctly identified that the codebase was well-structured, found a real issue (hardcoded token pricing that should delegate to a shared module), and accurately rated everything LOW or MEDIUM. No hallucinated critical bugs.

## Scaling Up

We then ran the optimized setup across four Elixir projects:

**graybeam-ui** (14 CSS/JS files): Found 6 real issues -- missing brand in manifest, missing dark mode blocks, incomplete Tailwind theme bridge. Fixed all 6.

**graybeam_core** (35 Elixir files): Found 2 real issues + 2 partial -- missing telemetry on eval harness, hardcoded cost calculation. Fixed all.

**graybeam_llm** (20 Elixir files): Found 5 real issues -- Groq provider missing all telemetry, SGLang missing usage tracking, inconsistent 429 handling across providers. Fixed all 4 provider files.

**graypress** (78-file Phoenix app): Found 4 real issues -- duplicate function definition, `File.write!` crash risk in a `restart: :temporary` GenServer path. Fixed both critical bugs.

Total: 15 files fixed across 4 projects in one session. Zero false positive syntax errors after the optimization.

## Context Window Is Everything

The single biggest improvement was context. At 8K tokens (where we started), Hermes couldn't even fit its own system prompt plus 30 tool definitions. At 32K, it could read files but kept looping -- compressing and re-reading, losing earlier analysis. At 262K, it read all 78 files of graypress in four parallel batches (10 files each), held them all in memory, cross-referenced them, and produced the report at 35% capacity.

Qwen3.5-35B-A3B at GPTQ-Int4 on an A6000 with FP8 KV cache gives us 262K tokens. The model weights are ~17GB, KV cache uses ~12GB, total ~29GB of the 48GB available. Native max is 262K; the model claims 1M via RoPE scaling, but that needs two A6000s we don't have.

## The Honest Assessment

A local 35B model doing code review is **useful for discovery, not trust.** It finds the right areas to look at. It correctly identifies architectural patterns, cross-references files, and spots genuine gaps in test coverage or telemetry. But it overstates severity, hallucinates specifics, and needs human verification on every finding.

The accuracy across our four projects: about 55-60% of findings were real issues. The rest were false positives from misreading tool output, overstating severity, or inventing problems that didn't exist. Not great for autonomous fixing, but genuinely useful for directing human attention.

The key insight: **the agent's tool chain matters more than the model.** Every false positive we eliminated came from fixing a tool behavior (truncation, redaction) or adding context (AGENTS.md, skills), not from changing the model. A perfect model reading corrupted input still produces garbage.

## What We're Building Next

These lessons feed directly into our BEAM/OTP reimplementation of the agent runtime. The tool design principles:

1. **Faithful output** -- tools return exactly what's on disk. No truncation, no redaction.
2. **Structured errors** -- `{:error, :file_too_large, %{size: 125_000}}` not silent truncation.
3. **Verification tools** -- auto-verify assertions before reporting them.
4. **Progressive loading** -- tool schemas loaded on-demand, not all 30 in every prompt.

An Elixir GenServer per agent session. A Task.Supervisor for tool dispatch. OTP supervision trees for fault isolation. The BEAM gives us the runtime we need; the lessons from running Hermes on real code tell us what the tools need to get right.
