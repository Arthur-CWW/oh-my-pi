# HR-222 / HR-225 audit before and after

## Before: retained provenance

The 2026-07-19 baseline in [`docs/fable/tui-view-audit.md`](../../../docs/fable/tui-view-audit.md) contains 31 interactive surfaces. It recorded divergent movement/filter/back/action semantics, private status words, and bespoke list, selector, tree, modal, and popup ownership. Those rows remain intact as historical observations.

## After: executed convergence

| Slice | Result | Authority |
|---|---|---|
| 1. Shared selector grammar | EXECUTED | `src/modes/mvu/selector.ts`, `keymap-registry.ts`, `components/selector-adapter.ts` |
| 2. Shared table + preview | EXECUTED | `components/table-preview.ts`, `mvu/renderer-adapter.ts` |
| 3. Session/error/bookmark projection | EXECUTED | `mvu/status.ts`, domain route adapters |
| 4. Hub attention mode | EXECUTED | `components/agent-hub.ts` MVU message/update/attention commands |
| 5. Tree/preview convergence | EXECUTED | `mvu/tree.ts`, `mvu/keyed-view.ts` |
| 6. Settings/plugin/modal shell | EXECUTED | `mvu/modal.ts`, settings/plugin/model/plan route models |
| 7. Setup and auxiliary pickers | EXECUTED | `setup-wizard/wizard-overlay.ts`, setup scene reducers, OAuth/account adapters |
| 8. Remove one-off ownership | EXECUTED | `mvu/route-host.ts`, `mvu/input-lease.ts`, `mvu/form-input.ts` |

All source anchors are relative to `vendor/oh-my-pi/packages/coding-agent/src/modes/`.

## Active residual audit

A residual is a surface that still owns a bespoke keymap or private status vocabulary instead of an MVU route/domain projection.

| Residual surface | Bespoke ownership | Required action |
|---|---|---|

**Residual rows: 0.** The former conflict and converge lists are retired execution history, not active defects.

## Proof linkage

- Exact observed gates and Bun crash caveat: [`test-results.txt`](test-results.txt)
- Rerunnable real PTY driver: [`pty-smoke.py`](pty-smoke.py)
- Captured real `dist/omp` result: [`pty-smoke-transcript.txt`](pty-smoke-transcript.txt)
