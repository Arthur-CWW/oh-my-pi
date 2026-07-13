> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-07T00-00-51-895Z_019f39e0-a6b7-7000-a848-f3e75d966101/local/hotswap-fixes.md

# Hotswap revive-path fixes (post-review packet)

Review findings from HotswapReviewer, both in the park→revive restore path. Fix both; owner paths: `vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts`, `src/task/executor.ts`, `test/task/hotswap.test.ts`. Excluded: everything else (session/* stays untouched — public APIs only).

## P1 — explicit thinking level lost across park→revive

Mechanism: `session.setModel(model, "hotswap")` appends bare `provider/id` (no `:thinking` suffix) to JSONL; `applyHotswap` persists thinking via `session.setThinkingLevel(...)` which writes a `thinking_change`-style entry. On revive, `resolveRestorableSessionModel` finds no explicit suffix → `RestorableSessionModel.thinkingLevel` undefined → executor's `modelOverride?.thinkingLevel ?? effectiveThinkingLevel` forces the SPAWN-time thinking level, clobbering the persisted one. Additionally, a same-model thinking-only hotswap returns `undefined` from `resolveRestorableSessionModel` (model equals spawn model) so nothing is restored at all.

Required behavior:
1. When the last model_change role is `"hotswap"`, produce an override even when the restored model equals the spawn model.
2. When the override carries no explicit thinking suffix, the revived session must end up with the thinking level the child had at park time — NOT the spawn-time `effectiveThinkingLevel`.
   - First verify what `createAgentSession` does when `options.thinkingLevel` is `undefined` on a reopened session: does it restore the last persisted thinking entry from the JSONL (mirror of the model-restore logic in sdk.ts:1235-1245)? If yes: change `RestorableSessionModel` semantics so "override present" passes its `thinkingLevel` through verbatim (including undefined) instead of `??`-falling back in executor.ts:1951 — distinguish "no override object" (spawn path, byte-identical) from "override with undefined thinking" (defer to JSONL restore).
   - If createAgentSession does NOT restore thinking from JSONL when undefined: read the last persisted thinking level from the reopened SessionManager inside `resolveRestorableSessionModel` and set it explicitly on the override.
   - Do not assume either branch — verify in source and note which one holds in the QA report.
3. Default-role path (no hotswap ever happened) must remain byte-identical to current behavior: `resolveRestorableSessionModel` still returns `undefined` and the spawn model/thinking pass through unchanged.

## P2 — revive pins unauthenticated model

Mechanism: `resolveRestorableSessionModel` (hotswap.ts:107-110) checks only that the selector resolves; unlike the SDK restore path it never checks configured auth. A subagent hot-swapped to model X whose credentials are later removed revives pinned to X and fails at prompt time.

Required behavior: iterate `getRestorableSessionModels(...)` candidates in order; accept the first that BOTH resolves AND has configured auth (`modelRegistry.hasConfiguredAuth(...)` — match how the SDK/`resolveModelOverrideWithAuthFallback` checks auth); if none qualify, return `undefined` (spawn-model fallback). Log at warn when an unauthenticated hotswap model is skipped.

## Tests (extend test/task/hotswap.test.ts)

- Park→revive with `:high` explicit-thinking hotswap → revived options carry the swapped model AND high thinking (whichever mechanism you verified).
- Same-model thinking-only hotswap → restored across revive.
- No-hotswap default path → override is `undefined`, spawn model + spawn thinking unchanged (regression guard).
- Restored hotswap model without configured auth → override falls back (undefined or next candidate), never the unauthenticated model.

## Report

Append a "Post-review fixes" section to `docs/qa/hotswap-subagent-model-20260707.md`: which createAgentSession thinking-restore branch held (with file:line), what changed, test names. Do not run package-wide gates; targeted `bun test test/task/hotswap.test.ts` only if the sandbox permits.
