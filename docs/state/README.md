# State Docs

State docs are living memory for project preferences, taste, operating assumptions, and decisions that should survive across sessions.

## Rule for agents

When Arthur states a new durable preference, creative direction, risk constraint, machine/tool fact, or workflow decision, update the relevant state doc in the same session unless he says not to.

Do not let state docs become stale:

- add new preferences in a dated care log / decision log
- reconcile contradictions instead of appending blindly
- keep the canonical summary near the top current
- preserve idiosyncratic wording when it encodes taste/vibe
- distinguish durable preferences from one-off task instructions
- do not memorialize every aside; only update state when it is likely to matter across many future sessions
- if a detail feels low-signal, transient, or merely explanatory, leave it in chat or ask before storing it

## Current state docs

- `docs/state/video-creative-direction.md` — durable taste ledger / creative north-star for video, AI UGC, brainrot, asset graph, and pipeline direction.
- `docs/state/slotok-design-language.md` — durable UI/design language for Slotok; current primary visual north star is Codex's light workbench UI, not the dark/orange dashboard shell.
- `docs/state/ugc-studio-style-direction.md` — durable product/style direction for the UGC Studio workspace; current visual north star is Chorus/Conductor-like native agent workbench UI.
- `docs/state/ugc-studio-design-system.md` — implementation-level design system contract for UGC Studio: shadcn-style primitives, Tailwind variants, workbench components, and migration rules away from screen-specific CSS.
- `docs/state/symphony-lite-direction.md` — durable direction for the meta-agent orchestration harness: forked agents, reviewer personas, constrained tool sets, workflow DAGs, monitoring, and synthesis.
- `docs/state/agent-voice.md` — durable preference for agents to avoid HR/compliance/audit-log voice and talk like a competent friend.
- `docs/state/agent-tooling-preferences.md` — durable preferences for local agent tooling, browser automation, CuaDriver, CDP, and background computer use.
- `docs/state/agent-iteration-lessons.md` — durable lessons about decomposing agent work, keeping iteration loops fast, caching validated layers, and using parallel agents when scopes are disjoint.
- `TASKS.md` — top-level task index for active/next/blocked/done repo work.

## Where things belong

- `docs/state/` — durable preferences and operating memory that should affect many future sessions.
- `TASKS.md` — top-level task tracker for multi-step work and next actions.
- `docs/plans/` — active workstreams, runbooks, implementation plans, and current lane coordination.
- `docs/research/` — market/vendor research, GPT-Pro outputs, source digests, price tables, and other useful evidence. Expensive/important research artifacts should be tracked in git when safe.
- `docs/drafts/` — one-off creative concepts, scripts, prompts, and exploratory writeups.
- `data/` — runtime artifacts, generated outputs, captures, logs, local databases, and coordination status files. For large/sensitive artifacts in `data/`, commit a small manifest or summary under `docs/research/` if the result matters.

## Update trigger examples

Update state docs when Arthur says things like:

- “I care more about X than Y”
- “Don’t do X again”
- “The end goal is actually...”
- “This vibe should be more...”
- “Use this machine/tool for...”
- “This workflow should be separable/editable/reusable”
- “This is a hard rule / important lesson”
- “Talk to me more like...” / “Stop sounding like...”
