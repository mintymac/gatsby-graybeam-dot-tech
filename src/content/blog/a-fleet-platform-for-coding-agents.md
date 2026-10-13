---
title: "300 Developers, a Fleet of Macs, and No Idle Machines: Building the Coding-Agent Platform Simon Støvring Asked For"
category: "Engineering"
author: McHughson Chambers
date: 2026-10-13
---

Simon B. Støvring — [@simonbs on X](https://x.com/simonbs), the iOS developer behind Scriptable, Runestone, Jayson, and Data Jar — recently posted the clearest requirements list I have seen for a team coding-agent platform, then sharpened it in follow-up replies. This article is inspired by that thread and answers it directly: here is how we would build it, what to take from OpenClaw and Hermes, where cmux and Tern's Multica fit, and what none of them give you off the shelf.

His wishlist, condensed from the original post and replies:

- Teammates can steer and join the same conversation, see each other's sessions, and pick up one another's work.
- Self-hosted, with automatic scheduling across a fleet. Machines — especially Macs — must not be permanently tied to a handful of repos while other hardware sits idle. Any available Mac should be usable, including Mac runners and VMs for iOS work.
- Bring your own Codex and Claude subscriptions.
- Built directly on the native harnesses — the Codex and Claude Code CLIs or their official SDKs — not a custom layer that ditches the official tooling.
- A comprehensible, usable UI, including adding projects from the web UI.
- Scale: roughly 300 developers across several hundred projects.
- Granular per-project access control, role-based visibility of sessions, workspaces, and agents, non-admins able to create their own agents, and identity that ideally follows GitHub login.
- A preference for an existing industry tool over building one, if something fits.

That last point matters. Simon already has the solo version working. In ["Put Your Coding Agents in Your Pocket"](https://simonbs.dev/posts/put-your-coding-agents-in-your-pocket) he describes Tailscale plus tmux plus an SSH client plus push notifications: start an agent on his Mac, walk away, get pinged, rejoin the same raw CLI session from his phone. The team platform he is asking for is that exact feeling — raw native harness, resumable session, reachable from anywhere — multiplied by 300 people, several hundred repos, and a pool of shared Macs. Everything hard in this problem lives in that multiplication.

## The Verdict Up Front

Do not build another agent. Do not pick OpenClaw *or* Hermes as the platform. Neither is a multi-tenant fleet scheduler, and forcing either into that shape is how you end up with a fork you maintain forever.

Build — or adopt — a thin **fleet control plane** and keep the agents boring:

1. **Control plane (the product):** GitHub-derived identity and per-project authorization, a project registry, a capability-based scheduler, a shared-session broker, and an audit log. This is the missing layer in every tool Simon tried.
2. **Node daemon (one per machine):** registers the machine's capabilities, provisions an isolated workspace, runs the native harness, streams events back. Outbound-only connections, no inbound ports on any Mac.
3. **Worker runtime (commodity):** the native `codex` and `claude` CLIs first, with [Hermes Agent](https://github.com/NousResearch/hermes-agent) profiles where you want memory, skills, cron, or a Kanban work queue. [OpenClaw](https://docs.openclaw.ai/concepts/architecture) as an optional personal/channel edge — Slack, Telegram, phone nodes steering into the same session — not as the org-wide source of truth.
4. **Operator surface (commodity):** web UI as source of truth; [cmux](https://github.com/manaflow-ai/cmux) on Macs and tmux on headless boxes as the raw-terminal escape hatch Simon's pocket setup proves developers want.
5. **Pilot before building:** [Tern's Multica](https://multica.ai) is the closest existing control-plane-shaped tool we found. Run the proof of concept on it first. Build your own control plane only for the gaps the pilot actually exposes.

The rest of this article defends that split, maps every requirement to a component, and ends with a phased build plan and a PoC spec with kill criteria.

## What OpenClaw and Hermes Actually Are

Both are excellent. Neither is shaped like Simon's problem, and the mismatch is structural, not a missing feature flag.

**OpenClaw is a gateway.** One long-lived Gateway process per host owns the messaging surfaces, sessions, credentials, and cron; control clients and device nodes connect to it over WebSocket, and nodes declare explicit capabilities and commands after device pairing and approval. That is a superb trust model for *one operator's* assistant reaching their own phone, Mac, and chat apps. It is also a per-host trust boundary. Independent comparisons of its documented model put it plainly: channel access controls operate inside one Gateway's trust boundary, and mutually untrusted users need separate Gateways. At 300 developers, "a Gateway per trust domain" becomes "a Gateway per team, minimum" — with no fleet-wide scheduler, no GitHub-derived project ACL, and no shared view across those Gateways. You would build the control plane anyway, above a fleet of Gateways.

**Hermes Agent is a worker and orchestrator.** Nous Research's Hermes gives you profiles, persistent memory, self-written skills, scheduled jobs, messaging gateways, multiple terminal backends (local, SSH, container, serverless), and a durable Kanban board that dispatches work to profile workers and recovers stuck ones. We run Hermes ourselves and wrote about [making it actually useful for code review](/hermes-agent-local-llm-code-review/) — it can also spawn Claude Code and Codex for heavy coding and bring results back into its own memory. But a profile is not a tenant, a Kanban board is not a bin-packing scheduler across a Mac fleet, and gateway allowlists are not per-repo authorization synced from GitHub. Hermes is the strongest *node-side* runtime of the two. It is still not the control plane.

| Simon's requirement | OpenClaw | Hermes | Control plane must add |
| --- | --- | --- | --- |
| Shared, steerable session | Partial: one Gateway's users | Partial: gateway/profile users | Session as shared object, turn queue, authorship |
| Fleet scheduling, no repo pinning | No: nodes are paired devices | No: backends are per-config | Capability labels, placement scoring, warm caches |
| BYO Codex/Claude subscription | Per-Gateway credentials | Per-profile/provider keys | Per-user credential binding, no pooling |
| Native harness baseline | Drives external coding agents | Spawns Claude Code/Codex | Thin adapter over CLI/SDK, PTY fallback |
| Per-project RBAC @ 300 devs | No: one trust boundary | No: allowlists/profiles | GitHub App sync, deny-by-default policy |
| Non-admin creates agent | Config-level | Profile-level | Scoped agent templates with quotas |
| Mac/iOS fleet | macOS node + app | macOS host/backend | Xcode/simulator capability model, VM lifecycle |
| Web UI, add project | Control UI per Gateway | Web UI/dashboard per instance | One registry across all nodes and repos |

Read the last column top to bottom. That is the platform. Rows one through eight are why "just self-host OpenClaw" and "just self-host Hermes" both fail Simon's replies even though both satisfy his original five bullet points for a single user.

## The Architecture We Would Build

```
Developer / teammate / phone
        │  GitHub OIDC login
        ▼
┌─────────────────────────────────────────────────────┐
│ CONTROL PLANE (self-hosted, stateless API + DB)     │
│ project registry · GitHub App ACL sync · scheduler  │
│ shared-session broker · audit log · web UI          │
└──────────────┬──────────────────────────────────────┘
               │ outbound WSS/mTLS only (no inbound ports)
   ┌───────────┼─────────────┬──────────────┐
   ▼           ▼             ▼              ▼
 Mac mini    Mac mini     Linux box      Dev laptop
 node daemon node daemon  node daemon    node daemon
 caps: Xcode caps: Xcode  caps: docker   caps: local
   │           │             │              │
   └─ workspace provisioner: clone cache + worktree
      (APFS clone / Tart or OrbStack VM snapshot on Mac,
       container or worktree on Linux)
               │
               ▼
   native harness: codex · claude · hermes -p <profile>
   (official SDK/app-server where available, tmux PTY
    as the universal fallback; cmux workspace on Macs)
```

### 1. Sessions are shared objects, not terminal tabs

The core data model is a session: `{project, repo@sha, worktree, harness, credential binding, participants, append-only log}`. Steering is an API call that appends a message with a named human author. A single-writer turn queue serializes input — a *steer* lands after the current tool batch, a *follow-up* lands after the agent goes idle — so two teammates steering at once produce an ordered, attributable transcript instead of interleaved terminal garbage. Anyone with project access can observe live, join, fork the session onto another node, or take over when the owner goes home. The terminal still exists, as a view onto the session, never as the session itself. This one decision is what makes "pick up one another's work" real instead of screen-sharing a tmux pane.

### 2. Schedule on capabilities, never on repo assignment

Each node daemon advertises versioned capabilities — OS, Xcode versions, installed simulators, Docker, GPU, harness CLIs and versions, free slots, disk — and heartbeats load. The scheduler is a pure decision: filter to eligible nodes (required capabilities, project policy, a node where the *requesting user's* credential can run), then score by warm clone-cache locality, current load, and queue depth. A warm cache is a tie-breaker, never an assignment. That distinction is the whole answer to Simon's idle-Mac complaint: yesterday's iOS repo leaves a cache that makes one Mac slightly preferable today, but any eligible Mac can take the job, cold-cloning from a shared mirror if it must. On Macs, provision into an APFS-cloned worktree for speed, or an ephemeral Tart/OrbStack VM restored from snapshot when a session needs a clean Xcode or isolation from the host — respecting Apple's macOS virtualization licensing on Apple hardware. Node death mid-session marks the session resumable and reschedules from the last checkpointed worktree state, because at fleet scale machines *will* disappear mid-run.

### 3. Authorization follows GitHub, or it will rot

Login is GitHub OIDC. A GitHub App — not personal access tokens — syncs org, team, and per-repo permissions into the control plane, and repo `read`/`write`/`admin` maps directly onto session observe/steer/administer for that project. Adding a project in the web UI means picking from repos the App can already see and you already admin; there is no step where an operator hand-maintains a parallel ACL spreadsheet for several hundred projects, because that spreadsheet is wrong by Friday. Roles stay small: org admin, project admin, member, viewer. A non-admin creating an agent creates a *template* — harness, model, skills, tool limits, budget — usable only on projects where they already have access, so agent creation can never become a privilege-escalation path. Deny by default, every cross-project read included: a user without repo access gets a 404 for its sessions, not a redacted list that leaks the project's existence.

### 4. Bring-your-own subscription means *yours*, audited

This requirement has teeth. Personal Claude and Codex subscriptions are per-person; a platform that pools one person's OAuth token across teammates is building a terms-of-service violation with a nice UI. So a credential binding is per-user, sealed at rest, injected only into sessions that user started or co-steers under their binding, and executed node-side under an isolated per-session home (Keychain on macOS, a `0600` secret mount on Linux) that is wiped at session end. Usage is attributed to the binding owner in the audit log. Shared service credentials, where a provider offers a team/API plan that permits it, are a separate, explicitly-labeled binding type. If a provider's terms do not permit your intended sharing model, the correct platform behavior is to make that configuration impossible, not merely undocumented.

### 5. Native harness first, PTY as the universal adapter

The node runner is a thin adapter with five verbs — `start`, `steer`, `interrupt`, `resume`, `collect` (diff, artifacts, usage). Implement it against each harness's official SDK, app-server, or agent protocol where one exists, because structured events beat scraping terminal output. Keep a tmux PTY adapter as the fallback that works with *any* CLI on day one, including the harness released next month. Do not reimplement an agent loop, a tool runtime, or a permission model that the official CLI already ships; Hermes earns its place node-side precisely where its loop adds something the CLIs lack — cross-session memory, learned skills, cron-driven work, Kanban fan-out to sub-workers. OpenClaw earns its place at the edge: its channel and device-node fabric is a ready-made way for a developer to steer their fleet sessions from Slack, Telegram, or a paired phone, calling the control plane's API rather than owning the session.

### 6. cmux is the cockpit, Multica is the shape to pilot

[cmux](https://cmux.com) — the Ghostty-based macOS terminal from Manaflow — solves the *one operator, many concurrent agents* problem properly: vertical tabs carrying git branch, linked PR, working directory, and latest notification per workspace; notification rings when an agent needs input; an in-app scriptable browser; SSH workspaces; and a CLI/socket API to create workspaces, split panes, and send keystrokes, plus `cmux notify` for agent hooks. In this architecture the node daemon (or the developer's own Mac) opens one cmux workspace per attached session via that socket API, and cmux notifications feed the platform inbox. But cmux's own authors call it "a primitive, not a solution" — it has no multi-user identity, no scheduler, no ACL — so it must never become the source of truth. Headless nodes expose the same contract over tmux, which is also what makes Simon's phone-and-SSH workflow keep working unchanged.

[Tern's Multica](https://multica.ai) is the closest off-the-shelf match to the control-plane shape itself: self-hostable (Docker Compose or Helm), workspaces that separate agents and settings per team, `owner`/`admin`/`member` roles with per-agent access scopes, daemon *runtimes* that register a laptop or server as an execution machine, and support for driving 23 already-installed, already-authenticated agent CLIs rather than shipping its own model. That is Simon's "prefer an existing tool" clause made concrete. The open questions a pilot must answer are equally concrete: does placement spread work across *any* eligible Mac or bind agents to runtimes, can teammates steer one live run together, and can project access be derived from GitHub rather than maintained inside the tool? Adopt and extend upstream where the answer is close; build your own thin control plane only where it is not.

## Phased Build Plan

**Phase 0 — Pilot the existing tool.** Self-host Multica, register three Macs and one Linux box as runtimes, onboard one iOS repo and one non-iOS repo, and run it with a real team for two weeks. Exit criterion: a written gap list against the acceptance tests below, not an opinion. If the gaps are configuration and small upstream patches, you are done building platforms — contribute the patches and move on. This phase exists because Simon's preference for an existing tool is correct, and because every control plane looks easy until its first Xcode upgrade weekend.

**Phase 1 — Node daemon and scheduler MVP.** Outbound-only daemon with capability advertisement and heartbeats, clone cache plus worktree provisioning, the five-verb harness adapter (Codex and Claude Code via PTY first), capability-filtered placement with cache-locality scoring, and session logs streamed to the control plane. One team, admins only, no polish. Exit criterion: an iOS build-and-test session lands on whichever eligible Mac is free, twice in a row on different machines, with no repo ever assigned to a machine by hand.

**Phase 2 — Shared sessions and GitHub authorization.** GitHub OIDC and App-based ACL sync, the shared-session broker with steer/follow-up queue and per-author attribution, per-user credential bindings, agent templates for non-admins, and the web UI: project registry, live session view, fleet view, inbox. Add Hermes as an optional node profile for teams that want memory, skills, and scheduled work, and the OpenClaw channel bridge for phone/chat steering into control-plane sessions. Exit criterion: the full acceptance suite below passes with two teams who cannot see each other.

**Phase 3 — Fleet hardening at 300 developers.** Ephemeral Mac VM snapshots and pre-warmed simulator pools, queueing with per-project quotas and fairness so one team's fan-out cannot starve the fleet, node drain/upgrade orchestration for Xcode and macOS releases, cost and usage attribution per user/project/agent, and audit export. Exit criterion: a node can be pulled from the fleet mid-day — for an OS upgrade, say — with sessions drained or rescheduled and zero work lost silently. Every terminal state is visible: queued, provisioning, running, waiting-on-human, failed, rescheduled, complete. A session that vanishes without a state is a bug with a timestamp.

## Proof-of-Concept Spec

Scope it small enough to finish and mean something: 3 Mac minis, 1 Linux node, 2 repos (one iOS app requiring a pinned Xcode, one anything else), 10 developers in 2 GitHub teams, Codex and Claude Code harnesses, one Hermes profile node. Run Multica as the candidate control plane; where it cannot express a test, record that as a finding rather than working around it by hand.

Acceptance tests, each traceable to Simon's thread:

1. **No idle iron.** Submit four iOS sessions in a burst. They spread across all eligible Macs with free slots; none waits behind a busy Mac while an eligible one idles, and no repo is pinned to a machine anywhere in config.
2. **Shared steering.** Developer A starts a session; developer B (same project) joins live, steers mid-run, and the transcript attributes each instruction to its author. A goes offline; B takes the session to a finished diff.
3. **Invisible without access.** Developer C (other team, no repo permission) cannot list, open, or guess-URL into the session — 404, and nothing in search, inbox, or fleet views leaks its existence.
4. **GitHub is the ACL.** Grant C read access to the repo on GitHub. Within one sync interval C can observe (not steer). Revoke it; access disappears without anyone touching the platform.
5. **BYO subscription, honestly.** A's session runs under A's credential binding on a node A has never logged into; usage is attributed to A; B steering does not silently switch the billing identity; no token is readable by another session on the same node.
6. **Non-admin agent.** A non-admin creates an agent template scoped to their project and runs it. The same template cannot be pointed at a project they cannot access.
7. **Native harness, raw escape hatch.** The session transcript is the actual Codex/Claude Code session, resumable from the node's tmux/cmux workspace over SSH/Tailscale exactly as in Simon's pocket setup.
8. **Node death.** Power off a Mac mid-session. The session enters a visible failed/reschedulable state with its worktree state preserved or its loss explicitly reported — never a silent hang.
9. **Add a project in the UI.** A project admin adds a new repo from the web UI and runs a first session without editing node config or filing an ops ticket.

Kill criteria, decided before the pilot starts: if the candidate tool binds agents to fixed runtimes with no eligible-pool placement (test 1), cannot keep mutually distrusting teams apart without separate installs per team (test 3), or requires pooling personal credentials (test 5), it is not the platform — take the gap list into Phase 1 and build the thin control plane. If it passes, the build plan collapses into upstream contributions, a GitHub-ACL bridge, and fleet operations. Either outcome is a success; the only failure is another quarter of evaluating screenshots.

## The Risks Nobody Puts in the Vendor Deck

Provider terms are the big one, already covered: design so the non-compliant configuration is unrepresentable. Second, Xcode and macOS release churn will consume more fleet-ops time than the scheduler ever will — budget a drain-and-upgrade ritual from day one. Third, an agent with shell access on a shared node is a confused-deputy machine: per-session homes, egress policy, secret redaction on *output* logs (never on the code the agent must read — [we learned that one the hard way](/hermes-agent-local-llm-code-review/)), and a human review gate before anything lands on a protected branch. Fourth, cost attribution: at 300 developers, "the platform spent it" is not an answer finance accepts twice.

Here's the thing: Simon's list reads like a product wishlist, but it is actually an architecture statement. The agent is already a commodity — Codex and Claude Code see to that, and Hermes and OpenClaw already wrap them well for individuals and small trusted groups. The missing product is the layer that knows *who may run what, where it should run, and who else is in the room while it runs*. Build that layer thin, put GitHub in charge of identity, let any honest Mac take the next job, and keep the raw terminal one SSH hop away — from a desk, a teammate's desk, or, as Simon puts it, considerably less dignified places.

*Inspired by Simon B. Støvring ([@simonbs on X](https://x.com/simonbs)), whose requirements thread frames the problem this article tries to answer. Tool references: [OpenClaw architecture](https://docs.openclaw.ai/concepts/architecture), [Hermes Agent](https://github.com/NousResearch/hermes-agent), [cmux](https://github.com/manaflow-ai/cmux), [Multica](https://multica.ai).*

