# Model picker overflow QA

## Initial scope
- Target code: `packages/coding-agent/src/modes/components/model-selector.ts`.
- Existing model-selector test coverage found: `packages/coding-agent/test/model-selector-role-badge-thinking.test.ts`.
- Requested behavior: context-window overflow must become selectable with a warning; genuine disable reasons remain disabled.

## Before behavior
- `packages/coding-agent/src/modes/components/model-selector.ts:701-708`: context overflow was computed by `#isModelOverContextLimit()` and returned directly from `#isItemDisabled()`, making overflow the only picker-level disabled reason in this component.
- `packages/coding-agent/src/modes/components/model-selector.ts:731-759,1051,1195,1218,1277`: disabled items were skipped during index coercion/navigation, menu opening, Enter handling, menu input, and final selection.
- `packages/coding-agent/src/modes/components/model-selector.ts:710-715,1017-1024`: overflow rendered as `context>limit` / selected-row limit text because it was treated as disabled.
- `/model <selector>` evidence: `packages/coding-agent/src/slash-commands/builtin-registry.ts:408-428` resolves the requested model and calls `runtime.session.setModel(match)` with no context-size pre-check; `packages/coding-agent/src/session/agent-session.ts:6286-6311` checks configured auth only before switching.
- Model-cycle evidence: `packages/coding-agent/src/modes/controllers/input-controller.ts:1416-1443` delegates to `session.cycleRoleModels()`; `packages/coding-agent/src/session/agent-session.ts:6431-6444` applies the role model via `applyRoleModel()`/`setModel()` with no context-size pre-check.
- Existing overflow machinery evidence: `packages/coding-agent/src/session/agent-session.ts:7508-7535` handles context-overflow responses in the session compaction path; no picker/session compaction changes planned.

## After behavior
- `packages/coding-agent/src/modes/components/model-selector.ts:70-92`: added `classifyModelSelectorItem()`, which classifies context overflow as `disabled: false` with `contextWarning`, while preserving explicit disable reasons via `disabledReason`.
- `packages/coding-agent/src/modes/components/model-selector.ts:725-746`: `#isItemDisabled()` no longer treats context overflow as disabled; overflow warning suffix renders as dim `⚠ context <used> > <limit> — will compact on switch`.
- `packages/coding-agent/src/modes/components/model-selector.ts:963-1010`: model rows append the overflow warning while remaining selectable/navigable; existing disabled styling remains tied only to `#isItemDisabled()`.
- `packages/coding-agent/src/modes/components/model-selector.ts:1048-1052`: selected model detail uses the overflow predicate for warning text instead of the disabled predicate.
- No session or compaction logic changed. `/model <selector>` and model-cycle paths had no independent context-size rejection gate in the inspected call paths.

## Tests
- Updated `packages/coding-agent/test/model-selector-role-badge-thinking.test.ts`.
- Test names covering this change:
  - `classifies context overflow as selectable warning without masking real disable reasons`
  - `warns and allows selecting models below the current context size`
  - `opens the model menu when the only candidate overflows context`
- Targeted command for parent validation: `bun test packages/coding-agent/test/model-selector-role-badge-thinking.test.ts`
- Run output: not executed by this bounded subagent per orchestration rule; no sandbox `EPERM` observed.
