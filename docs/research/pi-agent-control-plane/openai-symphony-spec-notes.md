# OpenAI Symphony spec notes

Source: <https://raw.githubusercontent.com/openai/symphony/main/SPEC.md>
Retrieved: 2026-06-05

## Why it matters here

The Symphony spec is useful less as a product UI reference and more as a **systems architecture reference**. It gives a good public model for how a small orchestration system should be decomposed.

## Parts of the spec that matter most

### 1. Single authoritative orchestrator state

Symphony keeps a single authoritative runtime state for:

- running work
- retries
- reconciliation
- claims
- concurrency

Implication for Pi control plane:

- we should also keep a single authoritative cross-process registry
- the orchestrator Pi session must not become the only place where state “lives”

### 2. Clear component boundaries

Symphony separates:

- workflow loader
- config layer
- tracker client
- orchestrator
- workspace manager
- agent runner
- optional status surface
- logging

Implication for Pi control plane:

A similar decomposition fits well:

- publisher extension
- control-plane daemon
- cockpit client
- orchestrator tools/session
- optional worktree manager

### 3. Rich UI is explicitly non-core

The spec says rich web UI is not the main goal.

Implication:

- status surfaces are clients of the control plane
- our popup cockpit should also be treated as a client, not as the whole architecture

### 4. Workspaces / isolation matter

Symphony assumes per-issue isolated workspaces.

Implication:

- if we want trustworthy per-session review/diff later, we should push toward worktrees or dedicated checkouts
- without isolation, diff mode must be caveated

### 5. Reconciliation and liveness are first-class

The spec includes:

- heartbeats / activity tracking
- retry state
- cancellation / release
- startup recovery / cleanup
- stop active runs when they become ineligible

Implication:

- our MVP can start lighter, but the data model should leave room for heartbeats, staleness, blocked state, and cleanup

## Product translation into the Pi project

### Symphony concept -> Pi control-plane equivalent

- issue -> workgroup / run / task cluster
- worker workspace -> session worktree or tmux-backed worker
- status surface -> popup cockpit / review mode / orchestrator session
- scheduler state -> local TS control-plane registry

## Direct implications for Pi control plane

1. Separate authority from UI.
2. Design for heartbeats and reconciliation from the start.
3. Model workgroups/runs, not just panes.
4. Treat worktree-backed isolation as the long-term answer for trustworthy diffs.
