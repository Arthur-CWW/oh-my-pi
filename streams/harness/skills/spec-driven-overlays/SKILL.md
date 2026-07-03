---
name: spec-driven-overlays
description: Use when maintaining local behavior on top of upstream tools without carrying a long-lived fork. Prefer extensions/plugins first, then deterministic patches, then spec-driven agent repair only for surfaces with no extension seam.
---

# Spec-driven overlays

Use this pattern when local behavior must survive upstream updates but a full fork would be heavier than the change.

## Rule

Prefer extension/plugin/skill/tool code whenever OMP exposes a seam. Patch upstream source only when no extension seam can implement the behavior.

Escalation order:

1. **Extension/plugin** — own the code in this repo and load it through OMP config. This is the default.
2. **Dependency patch** — patch a third-party dependency when the behavior lives below OMP and cannot be intercepted by an extension.
3. **Source patch** — last resort for OMP internals with no extension API, especially TUI scoped key handlers or private component behavior.
4. **Spec-driven repair** — keep a short behavioral spec next to every non-extension overlay so an agent can re-implement it after upstream changes.

## Required files for an overlay

- `README.md` inventory: why this is not an extension, current status, retirement condition.
- `<overlay>.md` behavior spec: user-visible contract, target files, verification.
- Optional `<overlay>.patch`: deterministic fast path when a normal patch applies cleanly.
- `doctor` check: detects present/missing/upstreamed behavior and prints the repair command.

## Maintenance flow

1. Update upstream normally.
2. Run deterministic self-heal patches.
3. Run the doctor task.
4. If a behavior is missing and no extension seam exists, run the explicit agent-heal task with the spec.
5. If upstream now satisfies the spec, delete the patch and update the inventory.

## Do not

- Keep a stale fork only to carry one small behavior.
- Patch source when an extension can implement the same contract.
- Let an agent repair code without a behavior spec and verification command.
- Auto-run LLM repair during update; it must be an explicit command.
