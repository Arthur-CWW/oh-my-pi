# Codex app features notes

Source: <https://developers.openai.com/codex/app/features>
Retrieved: 2026-06-05

## Why it matters here

The Codex app is not our implementation target, but it is a useful product reference for what a human-friendly multi-agent surface looks like.

## Most relevant product patterns

### 1. Projects and threads are separate concepts

The app distinguishes:

- project = codebase / working scope
- thread = one agent conversation / run

Implication for Pi control plane:

- use something like `project/workspace` as one axis
- use `session/run` as another axis
- don’t flatten everything into one-dimensional tab numbers

### 2. Worktrees enable safe parallelism

The app strongly leans on Git worktrees for isolated parallel tasks.

Implication:

- if we want real review mode for Pi sessions, worktrees are likely the right long-term substrate

### 3. Built-in diff/review surface matters

The app includes diff/review features directly in the product.

Implication:

- a “dual view” or human review mode in the cockpit is not pointless
- but it should only claim strong per-session diff semantics when backed by isolation/provenance

### 4. Parallel threads need a command center

The app is designed for multiple active threads/projects and includes a top-level management surface.

Implication:

- our popup cockpit is not just a nice-to-have; it is the real UI counterpart to the control plane

### 5. Terminal remains important

The app still keeps a scoped terminal available for each thread/worktree.

Implication:

- a tmux-first local product is not inherently wrong
- terminal-native supervision can still be good if the control-plane layer is strong enough

## Direct implications for Pi control plane

1. Model `project/workspace` and `session/run` separately.
2. Plan for worktree-backed sessions.
3. Include a real review surface, not just navigation.
4. Keep terminal-native speed while adding GUI-like legibility.
