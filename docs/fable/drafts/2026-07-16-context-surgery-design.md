# Classifier-recovery context surgery (HR-153)

_Status: design-only. Decision: ship a manual, operator-approved first slice; never silently rewrite history or auto-apply surgery._

## Summary

Add a typed Anthropic classifier-intervention signal, a host-only `:medic` workflow that asks an explicitly cross-lane model for a bounded structured plan, and an append-only `context_surgery` journal transformation. The provider context may omit or replace selected complete journal ranges, but the original entries remain immutable; a receipt is visible both to the patient model and in its transcript, while ErrorInbox and doctor expose the same incident to Arthur. V1 offers surgery after two corroborated typed interventions but never invokes or applies it automatically.

## Assumptions

- “Classifier intervention” includes Anthropic `refusal`/`sensitive` stop reasons and explicitly recognized provider filter error types; ordinary refusal prose is only a heuristic.
- “Patient” is the affected session/agent; “operator” is the local interactive host. Child agents cannot authorize surgery.
- Recovery preserves the task’s legitimate intent. It is not a mechanism for hiding history or defeating a justified safety refusal.

## Changes

### 1. Detection

**Current manifestation.**

- Anthropic wire types include terminal `refusal` and `sensitive`; `message_delta` can include open-ended `stop_details`, while `message_start` can also carry a stop reason (`vendor/oh-my-pi/packages/ai/src/providers/anthropic-wire.ts:184-192,216-250`).
- The adapter maps `refusal`/`sensitive` to generic `stopReason: "error"`, retains `stopDetails`, and turns refusal detail into `errorMessage`; unknown future stop reasons degrade to normal stop (`packages/ai/src/providers/anthropic.ts:2093-2123,3785-3812`).
- Its catch path retains content, `stopDetails`, HTTP status, and rendered message, but no stable cause (`packages/ai/src/providers/anthropic.ts:2283-2304`; `packages/ai/src/types.ts:493-525`).
- HTTP failures retain status/request ID but stringify the body instead of filling `ProviderHttpError.code`; connection and timeout have separate classes (`packages/ai/src/providers/anthropic-client.ts:75-122,232-267`; `packages/ai/src/errors.ts:24-55`). SSE error types are likewise stringified (`packages/ai/src/providers/anthropic.ts:1328-1368`).
- Coding-agent already recognizes typed `stopDetails.type === "refusal"`, but HTTP filter detection is regex-only and retry classification reconstructs cause from message/status (`packages/coding-agent/src/session/agent-session.ts:11729-11806,12178-12188`). The refusal reroute then applies heuristic request allow/deny regexes (`packages/coding-agent/src/session/refusal-reroute-policy.ts:1-56`).

**Decision.**

- Extend `RequestFailureCause` with `classifier-intervention`; structured causes already outrank message heuristics (`packages/ai/src/utils/network-error.ts:6-15,50-89`). Add the same optional cause to `AssistantMessage` beside `errorStatus` and teach ErrorInbox’s strict decoder the new member (`packages/coding-agent/src/modes/utils/error-inbox.ts:129-205`).
- Populate the cause before stop-reason normalization for typed `refusal`/`sensitive`. Parse Anthropic HTTP/SSE `error.type` into structured code and mark the cause only for an explicit provider filter type—not for every `invalid_request_error`.
- Persist a classifier incident keyed by session, request fingerprint, source entry IDs, route attempt, provider/model, evidence channel, confidence (`typed|structured|heuristic`), observed content classes, and disposition. Do not copy raw context into ErrorInbox (`packages/coding-agent/src/session/error-inbox-ledger.ts:1-69`).
- Reliable: typed stop reason/details, parsed provider error type, stable entry/request/route IDs. Heuristic: refusal prose, quoted policy text, repeated “cannot help,” and allow/deny regexes. Heuristics may create an operator-visible candidate but never authorize a medic or surgery.
- Define N = 2 typed/structured incidents with the same session + request fingerprint and no successful assistant turn between them. At N, show one cooldown-bounded offer for `:medic <incident-id>`; V1 does not auto-spawn. One typed incident remains manually selectable. A later feature may auto-generate a plan at N, never auto-apply it.

### 2. Medic invocation

- Add host-only, child-view-local `:medic <incident-id>`, `:medic apply <plan-id>`, and `:medic dismiss <plan-id>` beside `:errors`; colon commands already support `viewLocal`, `hostOnly`, focused-session context, completion, and dispatch (`packages/coding-agent/src/modes/command-registry.ts:35-50,65-89,115-177,330-388`).
- `:medic` consents only to diagnosis. It resolves exactly one incident for the focused patient, previews the selected cross-provider route, runs the medic, validates the plan, and displays it. `apply` is a second explicit consent boundary.
- Invoke an internal `medic` AgentDefinition through existing spawn routing with an explicit non-Anthropic selector (Codex or Kimi); explicit spawn selection wins and the route receipt records the resolved lane (`packages/coding-agent/src/task/types.ts:70-180,245-300`; `packages/coding-agent/src/task/spawn-route.ts:69-173`; `packages/coding-agent/src/task/route-resolution.ts:378-410,624-651`). Do not expose an LLM-callable task action as the consent seam.
- Give the medic only the incident, exact implicated entries, at most two complete neighboring turns, role/timestamp/entry ID/content digest, and route provenance. Cap the envelope at 8,000 model tokens and 32 KiB serialized; redact secrets, omit images/binary/hidden system material, and reject rather than split a tool-call/result transaction.
- The medic has no filesystem, network, task, session-control, or patient-write tools and returns only a schema-validated plan. Existing restricted task agents automatically receive IRC, so v1 needs an internal no-IRC execution option or purpose-built constrained runner; prompt instructions are not isolation (`packages/coding-agent/src/task/executor.ts:2047-2140,2350-2420`).
- Plan schema: `{planId, incidentId, baseLeafId, evidenceRanges[{firstEntryId,lastEntryId,sourceDigest}], operations[{kind,range,replacement}], diagnosis, confidence, patientNotice, limitations}`. V1 accepts only whole-range `omit` or `replace_with_summary`; arbitrary substring rewriting is a follow-up.
- Reject session-control as the first seam: it is a versioned, epoch-fenced remote operational protocol with a closed action union, so adding semantic context mutation would expand authority and consent scope (`packages/coding-agent/src/session/session-control.ts:20-180,199-255,376-573`).

### 3. Surgery contract

- Add a strict `ContextSurgeryReceipt` and `ContextSurgeryEntry` to the closed session-entry union (`packages/coding-agent/src/session/session-entries.ts:376-407,500-556`). Append it through an `appendContextSurgery` peer of `appendCompaction`; the journal hot path appends JSONL without mutating prior entries (`packages/coding-agent/src/session/session-manager.ts:668-788,899-908,1795-1820`). Do not use mutable rollout-journal state.
- Receipt fields: version, surgery/plan/incident IDs, action (`apply|rollback`), reason category, evidence channel/confidence, sorted ranges with entry/message counts, classes and source digest, operation/replacement digest, medic provider/model/route receipt, manual operator mode, timestamp, active-transform digest, and optional `rollbackOf`. Never embed triggering source text.
- Add a pure surgery projection in `buildSessionContext` after active-path resolution and before latest-compaction selection (`packages/coding-agent/src/session/session-context.ts:128-179,214-229,297-401`). Provider replay replaces active ranges with the medic summary plus a neutral patient receipt; transcript replay preserves every original entry and renders the surgery inline.
- Range validation is deterministic: IDs exist on the active path; base leaf and digests are current; ranges are sorted, disjoint, complete turns/tool transactions, and exclude control entries. V1 may target only materialized provider-context units (retained raw entries or the current compaction summary), not hidden pre-compaction history.
- Compaction is the precedent, not the storage format: it appends a receipt-bearing entry, provider replay selects summary + kept range, and transcript replay keeps originals (`packages/coding-agent/src/session/compaction-receipt.ts:5-105`; `packages/coding-agent/src/session/session-context.ts:297-401`; `packages/coding-agent/test/compaction.test.ts:872-963`). Its dropped ranges are audit-only, so surgery must not reuse them as executable ranges.
- Make manual and automatic compaction prepare from the surgery-projected logical context, not the raw branch (`packages/coding-agent/src/session/agent-session.ts:9338-9564,11194-11203,11439-11470`). Add optional active-transform digest/surgery IDs to new compaction receipts; legacy receipts mean the empty transform set.
- Rollback appends another `context_surgery` entry referencing the apply receipt. Folding the path deactivates that transform and restores originals. Any descendant compaction made under the rolled-back digest is incompatible: skip it and replay from the newest compatible compaction or raw history. Warn about token expansion and require approval before another provider call; never auto-resend.

### 4. Consent and visibility

- Detection is observational and may append an ErrorInbox incident; it never changes context. `:medic` authorizes bounded cross-provider analysis; only `:medic apply` authorizes an append-only transformation.
- Post-op transparency is mandatory: the patient’s next context and transcript card state the surgery ID, affected ID ranges/counts, operation, reason category, medic model, uncertainty, originals-preserved guarantee, and rollback command. A plain custom ledger entry is insufficient because it does not enter model context; provider-visible messages do (`packages/coding-agent/src/session/session-entries.ts:417-424,518-537`; `packages/coding-agent/src/session/session-context.ts:300-365`).
- Arthur sees classifier cause/state and surgery/plan IDs in `:errors`; its existing detail view already exposes category, cause, disposition, patient/session, provider/model, fingerprint and resolution (`packages/coding-agent/src/modes/components/error-selector.ts:15-100`). Resolve the incident only after the surgery entry is durably appended.
- `omp doctor` remains read-only and adds findings for malformed/orphan surgery receipts, stale source digests, missing patient-visible notice, and compaction-transform mismatch. Its finding union and bounded 256-journal scan are at `packages/coding-agent/src/commands/doctor.ts:1-43,414-583`.
- Fail closed on uncertain patient, stale leaf/hash, partial tool range, redaction failure, medic/schema failure, changed route, or receipt persistence failure. No failed path mutates patient context.

### 5. Slice plan

**Smallest honest v1.**

1. AI layer: typed cause + structured Anthropic stop/HTTP/SSE propagation; no prose auto-classification.
2. Coding-agent detection: durable classifier incident, N=2 offer, ErrorInbox rendering.
3. Manual `:medic`: focused host command, bounded/redacted envelope, explicit non-Anthropic constrained runner, schema-validated preview, separate apply.
4. Journal: typed apply/rollback entry, deterministic range validator, surgery-aware context projection and compaction digest, patient card/notice.
5. Operator integrity: `:errors` receipt linkage and read-only doctor findings. No automatic apply, retry, or patient turn.

**Follow-ups.** Auto-generate plans after N typed incidents; a configurable `core.routing.medic` role; richer preview/diff UI; safe per-block rephrase/redaction; remote session-control only after a capability/consent design; aggregate effectiveness telemetry containing IDs/counts, never content.

**Open questions / ethics.** Decide whether `sensitive` may only record an incident or may offer surgery; choose Codex vs Kimi and cross-provider retention terms; define retention for unused plans. Surgery must never impersonate the user, hide the fact of a refusal, expose secrets or hidden prompts, claim certainty, or turn classifier recovery into safeguard evasion. Deny known harmful/bypass intent and preserve an attributable path to exact rollback.

## Sequence

1. Land provider cause propagation and incident schema first; every later object references stable incident/evidence IDs.
2. Land immutable receipt/range validation and pure projection before any apply command.
3. Make compaction consume the same projection and prove digest compatibility/rollback.
4. Add constrained medic invocation and plan validation, then wire `:medic` preview/apply.
5. Add patient/operator rendering and doctor integrity checks; only then consider threshold-driven offers.

## Edge Cases

- Missing trailing delta, a stop reason only on `message_start`, future stop types, localized gateways, or prose-only refusal: preserve as structured/heuristic uncertainty, never silently upgrade.
- Refusal after partial text/thinking/tool output: do not retry or cut partial transactions; require a whole-turn proposal and explicit approval.
- Branch changes or plan staleness: invalidate the plan; never rebase semantic edits silently.
- Overlapping surgeries: canonicalize by journal order, reject overlapping active ranges in v1, and include the active-set digest in every plan.
- Rollback may restore the original classifier trigger or overflow context; show impact and wait for an explicit next turn/compaction.
- Medic output may itself trigger a classifier or distort meaning: validate bounds/schema, attribute it as medic-authored, preserve uncertainty, and permit rollback.

## Verification

- Provider tests: typed refusal/sensitive, `message_start`-only stop, recognized HTTP/SSE filter type, unrecognized error, prose refusal, and structured cause survival.
- Journal tests: strict receipt decode; unknown/stale/overlap/tool-split rejection; apply projection; full transcript preservation; patient receipt; idempotent rollback; incompatible descendant compaction fallback; no source content in receipt.
- Command/integration test: isolated HOME + IRC DB + `OMP_SESSION_CONTROL_DB`; real cross-lane constrained medic; bounded envelope; route receipt; preview without mutation; explicit apply; reload; `:errors`/doctor linkage. No mocks (`docs/fable/spawn-guide.md:1-11`).
- Run focused new/modified tests and `bun --cwd=packages/coding-agent run check:types`. The design task itself ran no gates and changed no files.

## Critical Files

- `packages/ai/src/providers/anthropic-wire.ts:184-250`; `anthropic.ts:1328-1368,2093-2123,2283-2304,3785-3812`; `anthropic-client.ts:75-122`
- `packages/ai/src/types.ts:493-525`; `packages/ai/src/errors.ts:3-55`; `packages/ai/src/utils/network-error.ts:6-89`
- `packages/coding-agent/src/session/agent-session.ts:9338-9564,11194-11203,11439-11470,11729-11806`
- `packages/coding-agent/src/session/session-context.ts:128-179,214-229,297-401`; `session-entries.ts:376-407,417-540`; `session-manager.ts:668-788,1795-1935`
- `packages/coding-agent/src/session/compaction-receipt.ts:5-163`; `packages/coding-agent/test/compaction.test.ts:872-963`; `test/compaction-receipt.test.ts:65-150`
- `packages/coding-agent/src/modes/command-registry.ts:35-50,65-89,115-177`; `modes/utils/error-inbox.ts:129-251,320-510`; `modes/components/error-selector.ts:15-100`
- `packages/coding-agent/src/task/types.ts:70-180,245-300`; `task/spawn-route.ts:69-173`; `task/executor.ts:2047-2140,2350-2420`
- `packages/coding-agent/src/commands/doctor.ts:1-43,414-583`; `docs/fable/harness-request-register.md:106`
