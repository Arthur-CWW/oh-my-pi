> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T03-31-32-592Z_019f4a14-9c70-7000-abd0-20957c2aad05/local/cold-fork-eval-contract.md

# Cold Transcript Fork and Evaluation Contract

Status: implementation-ready contract  
Owner: transcript fork and evaluation architecture  
Dependencies: routing doctrine; v7 route/lifecycle event ledger; stable agent IDs; session JSONL + leaf replay; restart re-adoption; spawn verification contract

## Summary

Build a bounded cold-fork primitive that flushes one persisted source session, resolves one concrete JSONL tree entry, snapshots that exact root-to-leaf transcript once, and starts each lane/effort/advisor arm as a fresh session under a fresh stable agent ID. Every arm consumes the same content-addressed work packet and acceptance rubric, gets an independently resolved route, and is governed by declared per-arm and fork-set budgets. Outcomes become ordinary local evaluation runs and measurements in the existing evidence ledger; they are not a second run store. A blind reviewer sees only randomized arm aliases, outputs, the immutable packet, and the immutable acceptance rubric. Pareto results may support a separately reviewed promotion recommendation, but neither ingestion, frontier computation, recommendation approval, nor cancellation changes configuration or defaults automatically. The design reconstructs context from JSONL and artifacts only; provider prompt-cache keys and KV-cache reuse are optional runtime optimizations and never correctness assumptions.

## Requirements and assumptions

### Fixed requirements

1. A fork arm always receives a new stable agent ID and a new session ID/file. It never reuses the source agent ID, source session ID, provider session ID, queued hotswap state, advisor runtime, async-job ownership, or KV cache.
2. All arms share byte-identical packet, acceptance, transcript snapshot, tool profile, context profile, workspace base, evaluator, and declared budget semantics. Only declared axes may differ; uncontrolled differences are recorded.
3. The source transcript remains unchanged. The fork copies the selected branch into new JSONL files and adds typed lineage metadata to each child.
4. Existing truths remain authoritative: session JSONL owns transcript/lineage source facts; agent timeline owns lifecycle; route resolutions own actual lane/account/effort/advisor decisions; artifacts own immutable packet/rubric/raw outputs; evaluation runs/participants/measurements own outcomes; routing observations and lane state own reviewed routing knowledge/current posture.
5. A frontier is descriptive and complete-case. It neither computes a weighted super-score nor promotes a lane.
6. A recommendation is a reviewable record, not a config mutation. Even an approved recommendation requires a separate, explicit policy/config action outside this feature.

### Assumptions resolved by this contract

- External callers may request an ordinal `atTurn`, but the orchestrator must resolve it once to a concrete session entry ID before creating the fork set. Durable identity is `sourceLeafEntryId`, never a mutable ordinal.
- The source must be persisted and idle at snapshot time. The orchestrator calls `ensureOnDisk()` and `flush()`, rechecks the leaf, then hashes the resulting bytes. A changing leaf or file hash during capture is a typed conflict, not a best-effort fork.
- For code-writing comparisons, every arm must use existing isolated-worktree support. A packet may opt out only when it is declared read-only. Transcript copying does not imply workspace sharing is safe.
- Reviewer blindness is mandatory for outcome judgment unless the fork-set declaration records `blindReview: "impossible"` with a reason. Such a run may be retained as evidence but is ineligible for a promotion recommendation.
- The spawn verification pod owns `SpawnVerificationSpec` and `VerificationRunReport`. Its frozen reviewer phase literal is `"reviewer-rerun"`, with `ownerSource: { agentId, reportPath }`. Fork evaluation references those records and does not duplicate check execution or report schemas.

## Changes

### 1. Immutable fork-set declaration

Add the following Effect Schema boundary types in a new control-plane module and mirror only the JSONL lineage subset in OMP:

```ts
type ForkAxis = "lane" | "effort" | "advisor"
type ForkSetState =
  | "declared" | "materializing" | "running" | "cancelling"
  | "review_pending" | "under_review" | "recommendation_pending"
  | "decided" | "cancelled" | "failed"

type ForkArmTerminalStatus =
  | "accepted" | "failed_acceptance" | "provider_error" | "quota_error"
  | "auth_error" | "refused" | "timeout" | "invalid_output"
  | "reviewer_rejected" | "cancelled_operator" | "cancelled_budget"

type BudgetDimension = "requests" | "tokens" | "cost_usd" | "quota_units" | "wall_clock_ms" | "tool_calls"

interface ForkBudgetV1 {
  readonly requests: number | null
  readonly tokens: number | null
  readonly costUsd: number | null
  readonly quotaUnits: number | null
  readonly wallClockMs: number | null
  readonly toolCalls: number | null
}

interface ForkRouteRequestV1 {
  readonly lane: string
  readonly modelSelector: string | null
  readonly effort: string
  readonly advisors: readonly {
    readonly purpose: string
    readonly modelSelector: string
    readonly effort: string
    readonly independenceRequired: boolean
  }[]
}

interface ColdForkArmSpecV1 {
  readonly armKey: string
  readonly agentId: string
  readonly declaredAxes: readonly ForkAxis[]
  readonly axisValues: { readonly lane: string; readonly effort: string; readonly advisor: string }
  readonly route: ForkRouteRequestV1
  readonly budget: ForkBudgetV1
}

interface ColdForkSetV1 {
  readonly version: 1
  readonly id: string
  readonly packetId: string
  readonly packetArtifactId: string
  readonly packetSha256: string
  readonly acceptanceArtifactId: string
  readonly acceptanceSha256: string
  readonly transcriptArtifactId: string
  readonly transcriptSha256: string
  readonly sourceSessionId: string
  readonly sourceSessionFile: string
  readonly sourceLeafEntryId: string | null
  readonly sourceAgentId: string
  readonly workClass: string
  readonly taskModality: string
  readonly hypothesis: string
  readonly comparisonAxes: readonly ForkAxis[]
  readonly harnessProfile: string
  readonly toolProfile: string
  readonly contextProfile: string
  readonly workspaceMode: "read_only_shared" | "isolated_apfs"
  readonly budget: ForkBudgetV1
  readonly stoppingRule: string
  readonly decisionOwner: string
  readonly blindReview: "required" | "impossible"
  readonly blindReviewExceptionReason: string | null
  readonly arms: readonly ColdForkArmSpecV1[]
  readonly createdAt: number
}
```

Validation invariants:

- IDs, hashes, artifact handles, hypothesis, stopping rule, owner, profiles, and arm keys are non-empty; timestamps and budgets are finite non-negative integers/numbers.
- At least two arms; unique `armKey` and `agentId`; no arm agent ID equals the source or reviewer ID.
- Every arm declares only axes listed by the set. Values outside declared axes must be equal across arms. Route resolution may expose an uncontrolled difference (for example serving account rotation), but it must be recorded in the run notes and review evidence.
- Packet/rubric/transcript artifacts are content-addressed and decoded before any child is created. Hash mismatch fails the entire set.
- `blindReview === "impossible"` requires a non-empty reason and prevents recommendation creation.
- Fork-set budget must be at least as restrictive as the sum of explicitly allocated arm caps where a dimension is present. Null means “not capped by this fork,” never zero or unknown usage.

Canonical artifact payloads:

- `packetArtifactId`: canonical JSON containing assignment, role, owner paths, excluded paths, constraints, non-goals, workspace mode, tool/context profile, and verification spec references. The mutable `packets` row remains coordination state; `fork_sets.packetId` and `fork_sets.packetArtifactId` provide the exact join without changing or overloading the packet row.
- `acceptanceArtifactId`: canonical JSON containing versioned rubric definitions, behavioral gates, required scenarios/checks, reviewer instructions, and measurement keys/directions/units.
- `transcriptArtifactId`: the exact selected root-to-leaf JSONL entries plus source header identity and selected entry ID. It excludes `leaf_change` selector entries and entries not on the selected branch; it does not rewrite message IDs.

### 2. JSONL fork lineage and materialization API

Extend `SubagentSessionMetadata` in `vendor/oh-my-pi/packages/coding-agent/src/session/session-entries.ts:113-147` with an optional closed block:

```ts
interface ColdForkOriginV1 {
  readonly version: 1
  readonly forkSetId: string
  readonly armKey: string
  readonly packetId: string
  readonly packetArtifactId: string
  readonly acceptanceArtifactId: string
  readonly transcriptArtifactId: string
  readonly sourceSessionId: string
  readonly sourceSessionFile: string
  readonly sourceLeafEntryId: string | null
  readonly transcriptSha256: string
}
```

Add a narrow session API beside `createBranchedSession` and `forkFrom` in `session-manager.ts:1429-1590`:

```ts
interface MaterializeColdForkOptions {
  readonly sourcePath: string
  readonly sourceSessionId: string
  readonly sourceLeafEntryId: string | null
  readonly expectedTranscriptSha256: string
  readonly destinationFile: string
  readonly cwd: string
  readonly origin: ColdForkOriginV1
}

static materializeColdFork(options: MaterializeColdForkOptions): Promise<SessionManager>
```

The method loads and migrates the source JSONL, replays `leaf_change`, verifies the requested entry exists, computes the exact root-to-entry branch with current `buildSessionContext` semantics, verifies the snapshot hash, mints a new UUIDv7 session ID, writes one new header with source lineage, writes the selected branch unchanged, and atomically writes the destination. It never calls `branch()` on the source manager and never passes `providerPromptCacheKey` or a source provider session ID as a correctness mechanism.

The fork orchestrator then appends one `session_init` carrying the immutable packet text and `coldForkOrigin`. Re-adoption uses the existing direct-child metadata, so a controller restart can recover the fork arm as parked under the same new arm agent ID. It does not restart a cancelled arm or claim an interrupted turn continued.

### 3. Fork-set events and state machine

Add one known outbox envelope kind, `forkEvaluation`, version 1. It is source-first and append-only:

```ts
type ForkEvaluationEventKind =
  | "declared" | "materializing" | "arm_materialized" | "started"
  | "cancel_requested" | "budget_exhausted" | "review_opened"
  | "review_submitted" | "recommendation_proposed"
  | "recommendation_reviewed" | "completed" | "cancelled" | "failed"

interface ForkEvaluationPayloadV1 {
  readonly payloadVersion: 1
  readonly eventId: string
  readonly forkSetId: string
  readonly forkSeq: number
  readonly occurredAt: number
  readonly kind: ForkEvaluationEventKind
  readonly state: ForkSetState
  readonly armKey: string | null
  readonly agentId: string | null
  readonly evaluationRunId: string | null
  readonly reviewerAgentId: string | null
  readonly recommendationId: string | null
  readonly budgetDimension: BudgetDimension | null
  readonly reason: string | null
  readonly detail: JsonObject
  readonly artifacts: readonly ArtifactHandle[]
}
```

Event IDs are `${forkSetId}:event:${forkSeq}`; `forkSeq` starts at 1 and is strictly monotonic. The ledger materializes `fork_sets` only from `declared` and appends all envelopes to `fork_set_events`. Duplicate canonical payloads are ignored; conflicting IDs or sequences fail ingestion atomically.

Allowed transitions:

- `declared -> materializing -> running` after every arm is materialized and each arm has emitted existing `agentTimeline(spawn_scheduled/spawn_resolved/spawn_started)` events.
- `running -> review_pending -> under_review -> recommendation_pending -> decided`.
- Any non-terminal execution/review state may enter `cancelling`; `cancelling -> cancelled` only after every non-terminal arm has emitted existing `agentTimeline(cancel)` or a terminal lifecycle event.
- `materializing` or `running` may become `failed` when no arm is evaluable. Individual arm failures do not fail the set if at least two comparable arms remain; they are typed terminal outcomes and the review records reduced comparability.
- `decided`, `cancelled`, and `failed` are terminal. No event reopens them.

Do not add fork-arm lifecycle rows. Each arm is joined by its stable `agentId`, `packetId`, and initial `routeResolutionId` to the existing agent timeline and route tables. `arm_materialized` records the new session/file lineage boundary only.

The additive SQLite v8 layout is frozen as follows. JSON columns contain canonical JSON encoded from the closed Effect schemas above; they never contain artifact bodies:

```sql
CREATE TABLE fork_sets (
  id TEXT PRIMARY KEY,
  packetId TEXT NOT NULL,
  packetArtifactId TEXT NOT NULL,
  packetSha256 TEXT NOT NULL,
  acceptanceArtifactId TEXT NOT NULL,
  acceptanceSha256 TEXT NOT NULL,
  transcriptArtifactId TEXT NOT NULL,
  transcriptSha256 TEXT NOT NULL,
  sourceSessionId TEXT NOT NULL,
  sourceSessionFile TEXT NOT NULL,
  sourceLeafEntryId TEXT,
  sourceAgentId TEXT NOT NULL,
  workClass TEXT NOT NULL,
  taskModality TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  comparisonAxes TEXT NOT NULL,
  harnessProfile TEXT NOT NULL,
  toolProfile TEXT NOT NULL,
  contextProfile TEXT NOT NULL,
  workspaceMode TEXT NOT NULL,
  budget TEXT NOT NULL,
  stoppingRule TEXT NOT NULL,
  decisionOwner TEXT NOT NULL,
  blindReview TEXT NOT NULL,
  blindReviewExceptionReason TEXT,
  arms TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX fork_sets_packet_idx ON fork_sets(packetId, createdAt);
CREATE INDEX fork_sets_source_idx ON fork_sets(sourceSessionId, sourceLeafEntryId);

CREATE TABLE fork_set_events (
  id TEXT PRIMARY KEY,
  forkSetId TEXT NOT NULL,
  forkSeq INTEGER NOT NULL,
  occurredAt INTEGER NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  armKey TEXT,
  agentId TEXT,
  evaluationRunId TEXT,
  reviewerAgentId TEXT,
  recommendationId TEXT,
  budgetDimension TEXT,
  reason TEXT,
  detail TEXT NOT NULL,
  artifacts TEXT NOT NULL,
  payloadVersion INTEGER NOT NULL,
  UNIQUE(forkSetId, forkSeq)
);
CREATE INDEX fork_set_events_state_idx ON fork_set_events(state, occurredAt);
CREATE INDEX fork_set_events_agent_idx ON fork_set_events(agentId, occurredAt);
CREATE INDEX fork_set_events_run_idx ON fork_set_events(evaluationRunId);

CREATE TABLE promotion_recommendations (
  id TEXT PRIMARY KEY,
  forkSetId TEXT NOT NULL,
  action TEXT NOT NULL,
  lane TEXT NOT NULL,
  workClass TEXT NOT NULL,
  scope TEXT NOT NULL,
  candidateIdentity TEXT NOT NULL,
  frontierArtifactId TEXT NOT NULL,
  blindReviewArtifactId TEXT NOT NULL,
  rationaleArtifactId TEXT NOT NULL,
  proposedBy TEXT NOT NULL,
  proposedAt INTEGER NOT NULL,
  status TEXT NOT NULL,
  reviewedBy TEXT,
  reviewedAt INTEGER,
  reviewArtifactId TEXT,
  supersedesId TEXT
);
CREATE INDEX promotion_recommendations_status_idx
  ON promotion_recommendations(status, proposedAt);
CREATE INDEX promotion_recommendations_lane_work_idx
  ON promotion_recommendations(lane, workClass, proposedAt);
CREATE INDEX promotion_recommendations_fork_idx
  ON promotion_recommendations(forkSetId, proposedAt);
```

`fork_sets` is immutable declaration data. Current state is the latest `fork_set_events` row ordered by `forkSeq`; timestamps never decide order. `promotion_recommendations.status` is a low-rate projection updated only in the same transaction that appends the corresponding `recommendation_reviewed` fork event. The event preserves transition history; the recommendation row provides the queryable current record. Foreign-key-like references are validated in the service transaction because the existing ledger does not enable partial cascading ownership.

### 4. Existing evidence ledger extensions, not a parallel run store

Add `fork_sets` and `fork_set_events`, but do not add `fork_arms` or fork-specific measurement tables. Extend `evaluation_runs` in `packages/control-plane/src/schema.ts:354-386` and `EvaluationRunV1Schema` in `evidence.ts:160-188` with optional fields:

```ts
readonly forkSetId?: string | null
readonly armKey?: string | null
readonly agentId?: string | null
readonly routeResolutionId?: string | null
readonly terminalStatus?: ForkArmTerminalStatus | null
readonly cancellationReason?: string | null
readonly budgetExhausted?: boolean | null
readonly blindReviewerId?: string | null
readonly blindReviewArtifactId?: string | null
readonly verificationReportArtifactId?: string | null
```

Rules:

- A local cold-fork arm is exactly one `evaluation_runs` row with `evidenceKind: "local_evaluation"`, shared `packetId`, shared profiles, distinct `sessionId/agentId/armKey`, and a non-null `forkSetId`.
- `evaluation_run_participants` ordinal 0 is the primary resolved route; advisor routes from `route_advisors` become ordered `role: "advisor"` participants. Provider/model/account/effort values come from the actual initial/effective route resolution, never the requested selector.
- `terminalStatus` is required for fork arms. `budgetExhausted` is true only with `terminalStatus: "cancelled_budget"` and a non-empty cancellation reason. Other cancellation reasons use `cancelled_operator`.
- A promotion-eligible run requires a blind review artifact and reviewer ID, a verification report reference, a route resolution, and all rubric-required measurements. Incomplete runs remain ingestible and appear as `incomplete` in frontier queries.
- Evidence ingestion stays atomic/idempotent. It validates fork-set existence, unique `(forkSetId, armKey)`, agent/session/route linkage, shared artifact hashes, reviewer independence, and participant equality with the stored route resolution.

Version local metric definitions under `definitionKind: "local_outcome"`. The acceptance artifact chooses the applicable subset, but standard keys are:

| Metric | Unit | Direction | Source |
|---|---|---|---|
| `acceptance.pass` | ratio (0 or 1) | maximize | behavioral gates |
| `review.quality` | score (0-100) | maximize | blind reviewer |
| `review.correctness` | score (0-100) | maximize | blind reviewer |
| `review.taste` | score (0-100) | maximize | blind reviewer when applicable |
| `reliability.success` | ratio (0 or 1) | maximize | terminal status + verification |
| `retry.count` | count | minimize | route/model-call ledger |
| `human.interventions` | count | minimize | timeline/review record |
| `duration.ms` | ms | minimize | fork start to terminal event |
| `tokens.input`, `tokens.output` | tokens | minimize | model calls |
| `cost.usd` | USD | minimize | observed API billing only |
| `cost.credits` | credits | minimize | observed subscription/credit usage only |

Unknown subscription economics are null/missing, never fabricated as zero dollars. Frontier queries use existing `queryFrontier` complete-case behavior and ordered participant identity, already preserving advisor/account/effort composition in `frontier.ts:19-105`.

### 5. Blind review API

Expose an Effect service, not a workflow template:

```ts
interface BlindReviewBundleV1 {
  readonly forkSetId: string
  readonly packetArtifactId: string
  readonly acceptanceArtifactId: string
  readonly aliases: readonly {
    readonly alias: string
    readonly outputArtifactId: string
    readonly verificationReportArtifactId: string
  }[]
}

interface BlindReviewSubmissionV1 {
  readonly forkSetId: string
  readonly reviewerAgentId: string
  readonly reviewerSessionId: string
  readonly aliasOrder: readonly string[]
  readonly judgments: readonly {
    readonly alias: string
    readonly gateResults: readonly { readonly key: string; readonly passed: boolean; readonly evidence: string }[]
    readonly measurements: readonly EvaluationMeasurementV1[]
    readonly findingArtifactIds: readonly string[]
    readonly rank: number | null
  }[]
  readonly reviewArtifactId: string
  readonly submittedAt: number
}

interface ForkEvaluationStoreShape {
  declareForkSet(spec: ColdForkSetV1): Effect.Effect<void, ForkEvaluationError>
  appendEvent(event: ForkEvaluationPayloadV1): Effect.Effect<void, ForkEvaluationError>
  getForkSet(id: string): Effect.Effect<ColdForkSetView | null, ForkEvaluationError>
  listForkSets(filters: ForkSetFilters): Effect.Effect<readonly ColdForkSetView[], ForkEvaluationError>
  createBlindReviewBundle(forkSetId: string, reviewerAgentId: string): Effect.Effect<BlindReviewBundleV1, ForkEvaluationError>
  submitBlindReview(submission: BlindReviewSubmissionV1): Effect.Effect<void, ForkEvaluationError>
  buildEvidenceBundle(forkSetId: string): Effect.Effect<EvidenceBundleV1, ForkEvaluationError>
  cancelForkSet(forkSetId: string, reason: string): Effect.Effect<void, ForkEvaluationError>
}
```

`createBlindReviewBundle` uses a cryptographically random per-review alias map stored in the ledger event detail/artifact. The returned bundle excludes arm key, agent/session IDs, provider/model/account/effort, advisor identity, route resolution, transcript path, timing/cost/token data, and source ordering. It randomizes presentation order. The reviewer receives only packet, rubric, outputs, and verification reports. `submitBlindReview` verifies every issued alias exactly once, persists the review artifact, seals the mapping, then joins judgments to runs. Route and efficiency data are revealed only after submission. A reviewer cannot be the source agent, any arm agent, or an advisor agent and cannot submit twice.

### 6. Cancellation and budget enforcement

The fork orchestrator owns a single `AbortController` per set and one child controller per arm. It consumes observed executor progress plus publisher model-call totals; it does not infer quality from usage.

- Check all hard caps before materializing each arm, immediately before spawn, after every assistant/model-call/tool completion, and before a retry/fallback.
- Emit one `budget_exhausted` event for the first exhausted dimension, then `cancel_requested`. Abort all non-terminal arms through the existing job/task cancellation path. Each arm emits the existing `agentTimeline(cancel)` with reason `fork_budget_exhausted:<dimension>`.
- Operator cancellation follows the same fan-out with reason `fork_operator_cancel:<reason>`.
- Cancellation is idempotent. Repeated requests return the current state and never create duplicate arm cancels.
- Preserve partial transcripts, outputs, verification reports, model calls, and route events. Insert terminal evaluation runs with `cancelled_budget` or `cancelled_operator`; do not label them accepted or discard them.
- A completed arm is never retroactively cancelled. Remaining budget is not silently redistributed and cancelled arms are not automatically retried.
- Current `task.softRequestBudget` guards remain an arm-local safety net. Fork-set budgets are an additional explicit cap and may be stricter; the stricter cap wins visibly.

### 7. Reviewed promotion recommendations

Add a queryable `promotion_recommendations` record; it references evidence rather than copying it:

```ts
type PromotionAction = "promote" | "constrain" | "retire" | "no_change"
type RecommendationStatus = "proposed" | "approved" | "rejected" | "withdrawn" | "superseded"

interface PromotionRecommendationV1 {
  readonly id: string
  readonly forkSetId: string
  readonly action: PromotionAction
  readonly lane: string
  readonly workClass: string
  readonly scope: string
  readonly candidateIdentity: FrontierCandidateIdentity
  readonly frontierArtifactId: string
  readonly blindReviewArtifactId: string
  readonly rationaleArtifactId: string
  readonly proposedBy: string
  readonly proposedAt: number
  readonly status: RecommendationStatus
  readonly reviewedBy: string | null
  readonly reviewedAt: number | null
  readonly reviewArtifactId: string | null
  readonly supersedesId: string | null
}

interface PromotionRecommendationStoreShape {
  propose(input: PromotionRecommendationV1): Effect.Effect<void, RecommendationError>
  review(id: string, decision: "approve" | "reject", reviewer: string, reviewArtifactId: string): Effect.Effect<void, RecommendationError>
  withdraw(id: string, actor: string, reasonArtifactId: string): Effect.Effect<void, RecommendationError>
  get(id: string): Effect.Effect<PromotionRecommendationV1 | null, RecommendationError>
  list(filters: RecommendationFilters): Effect.Effect<readonly PromotionRecommendationV1[], RecommendationError>
}
```

A proposal requires: terminal reviewed fork set; at least two comparable arms; a blind review; required acceptance metrics; a saved frontier result; no unresolved uncontrolled difference; and a scoped action. Recommendation review must be performed by someone other than the proposer and all arm/advisor/reviewer agents. Approval may atomically append one dated `routing_observations` row whose `evidence` points to the recommendation and review artifacts. It must not call `setLaneState`, edit YAML, change `defaultFor`, or issue a route/config command. Policy/default changes remain a separately authorized action under routing doctrine.

### 8. Public command surface

Implement one OMP primitive after the spawn-verification and v7 producer pods land:

```ts
interface StartColdForkEvaluationArgs {
  readonly fromTranscript: string
  readonly atTurn: number
  readonly packetId: string
  readonly packet: JsonObject
  readonly acceptance: JsonObject
  readonly hypothesis: string
  readonly comparisonAxes: readonly ForkAxis[]
  readonly arms: readonly [
    Omit<ColdForkArmSpecV1, "agentId">,
    Omit<ColdForkArmSpecV1, "agentId">,
    ...Omit<ColdForkArmSpecV1, "agentId">[],
  ]
  readonly budget: ForkBudgetV1
  readonly stoppingRule: string
  readonly reviewer: { readonly agentType: string; readonly model: string | null; readonly effort: string; readonly blind: true }
  readonly workspaceMode: "read_only_shared" | "isolated_apfs"
}

interface StartColdForkEvaluationResult {
  readonly forkSetId: string
  readonly sourceLeafEntryId: string | null
  readonly packetArtifactId: string
  readonly acceptanceArtifactId: string
  readonly transcriptArtifactId: string
  readonly arms: readonly { readonly armKey: string; readonly agentId: string; readonly sessionFile: string }[]
  readonly state: "running"
}

startColdForkEvaluation(args: StartColdForkEvaluationArgs): Promise<StartColdForkEvaluationResult>
cancelColdForkEvaluation(forkSetId: string, reason: string): Promise<ForkSetState>
```

The user/tool input never supplies stable arm IDs; the orchestrator allocates all IDs before any materialization and persists them in the declaration. If any file/ID/artifact allocation fails, cleanup removes only newly created unregistered arm files and records `failed`; it never mutates the source transcript. The existing read-only HTTP control API/SSE may project fork-set rows/events after ingestion, but mutation endpoints are deferred until the semantic command/approval protocol exists.

Boundary failures use Effect `Schema.TaggedErrorClass` and remain distinct:

```ts
class SourceTranscriptChanged extends Schema.TaggedErrorClass<SourceTranscriptChanged>()(
  "SourceTranscriptChanged", { sourceSessionId: Schema.String, expectedSha256: Schema.String, observedSha256: Schema.String },
) {}
class ForkLineageInvalid extends Schema.TaggedErrorClass<ForkLineageInvalid>()(
  "ForkLineageInvalid", { forkSetId: Schema.String, armKey: Schema.NullOr(Schema.String), reason: Schema.String },
) {}
class ForkBudgetExceeded extends Schema.TaggedErrorClass<ForkBudgetExceeded>()(
  "ForkBudgetExceeded", { forkSetId: Schema.String, dimension: BudgetDimensionSchema, observed: Schema.Number, limit: Schema.Number },
) {}
class ForkStateConflict extends Schema.TaggedErrorClass<ForkStateConflict>()(
  "ForkStateConflict", { forkSetId: Schema.String, expected: ForkSetStateSchema, observed: ForkSetStateSchema },
) {}
class BlindReviewInvalid extends Schema.TaggedErrorClass<BlindReviewInvalid>()(
  "BlindReviewInvalid", { forkSetId: Schema.String, reason: Schema.String },
) {}
class ReviewIndependenceViolation extends Schema.TaggedErrorClass<ReviewIndependenceViolation>()(
  "ReviewIndependenceViolation", { forkSetId: Schema.String, reviewerAgentId: Schema.String, conflictingRole: Schema.String },
) {}
class RecommendationIneligible extends Schema.TaggedErrorClass<RecommendationIneligible>()(
  "RecommendationIneligible", { forkSetId: Schema.String, reason: Schema.String },
) {}
```

Filesystem, SQLite, and artifact failures retain the package’s existing `StorageError`/`ArtifactError`; they are wrapped with fork/arm context, not collapsed into a generic evaluation failure.

## Implementation slices and ownership

Each feature pod owns runtime plus focused tests. Slices are deliberately 3–5 files and do not overlap; shared-file work is sequenced.

### Slice A — transcript snapshot and cold materialization

Owns exactly:

1. `vendor/oh-my-pi/packages/coding-agent/src/session/session-entries.ts`
2. `vendor/oh-my-pi/packages/coding-agent/src/session/session-manager.ts`
3. `vendor/oh-my-pi/packages/coding-agent/src/task/cold-fork.ts` (new)
4. `vendor/oh-my-pi/packages/coding-agent/test/session-manager/cold-fork.test.ts` (new)

Delivers branch resolution, immutable snapshot hashing, new session/agent lineage metadata, and no-cache reconstruction. Depends on restart re-adoption/session ownership landing. It does not spawn agents or edit publisher/evidence files.

### Slice B — fork orchestration, budgets, cancellation

Begins only after the spawn-verification pod hands off `task/types.ts`, `task/index.ts`, and `task/executor.ts`, and after v7 route producer hooks land. Owns exactly:

1. `vendor/oh-my-pi/packages/coding-agent/src/task/fork-evaluation.ts` (new)
2. `vendor/oh-my-pi/packages/coding-agent/src/task/types.ts`
3. `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts`
4. `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts`
5. `vendor/oh-my-pi/packages/coding-agent/test/task/fork-evaluation.test.ts` (new)

Delivers typed start/cancel APIs, stable ID preallocation, isolated workspace enforcement, budget governor, and references to `SpawnVerificationSpec`/`VerificationRunReport`. It consumes Slice A and emits source events but owns no ledger schema.

### Slice C — fork ledger schema and evidence type extension

Owns exactly:

1. `packages/control-plane/src/schema.ts`
2. `packages/control-plane/src/migrate.ts`
3. `packages/control-plane/src/evidence.ts`
4. `packages/control-plane/src/fork-evaluation.ts` (new schemas/store/query contracts)
5. `packages/control-plane/test/fork-evaluation-migration.test.ts` (new)

Delivers `fork_sets`, `fork_set_events`, `promotion_recommendations`, additive evaluation-run columns, closed schemas, indexes, and migrations. It does not edit ingest/publisher/routing behavior.

Required indexes/constraints: unique `fork_set_events(forkSetId,forkSeq)`; unique `evaluation_runs(forkSetId,armKey)` where both are non-null; index `evaluation_runs(agentId)`; index `evaluation_runs(routeResolutionId)`; indexes on recommendation status/workClass/lane; primary keys on all IDs.

### Slice D — outbox publisher and atomic ingestion

Starts after Slices B and C. Owns exactly:

1. `packages/control-plane/src/outbox.ts`
2. `packages/control-plane/src/omp-events.ts`
3. `packages/control-plane/src/omp-publisher.ts`
4. `packages/control-plane/src/ingest.ts`
5. `packages/control-plane/test/fork-publisher-ingest.test.ts` (new)

Delivers `forkEvaluation` envelope decoding, source sequence preservation, atomic materialization, artifact linkage, generic fallback for future versions, and restart-safe next `forkSeq`. It must preserve all v7 route/lifecycle ordering and never infer fork events from transcripts after the fact.

### Slice E — blind review and local evidence adapter

Starts after C/D and after arm completion/result publisher facts exist. Owns exactly:

1. `packages/control-plane/src/fork-review.ts` (new)
2. `packages/control-plane/src/evidence-ingest.ts`
3. `packages/control-plane/src/frontier.ts`
4. `packages/control-plane/test/fork-review.test.ts` (new)
5. `packages/control-plane/test/fork-frontier.test.ts` (new)

Delivers blind alias bundle/submission, reviewer independence checks, terminal arm-to-evidence mapping, participant reconciliation with route resolutions, incomplete-run behavior, and Pareto queries over shared packet/profile cohorts. It does not create recommendations or mutate routing state.

### Slice F — reviewed recommendation store

Starts after E. Owns exactly:

1. `packages/control-plane/src/promotion-recommendation.ts` (new)
2. `packages/control-plane/src/routing.ts`
3. `packages/control-plane/src/index.ts`
4. `packages/control-plane/test/promotion-recommendation.test.ts` (new)

Delivers proposal/review/withdraw/query APIs and the optional explicit routing-observation write on approval. It never calls `setLaneState` or changes defaults.

### Slice G — independent end-to-end proof

Starts after A–F. Owns exactly:

1. `packages/control-plane/test/cold-fork-e2e.test.ts` (new)
2. `packages/control-plane/fixtures/cold-fork/source-session.jsonl` (new)
3. `packages/control-plane/fixtures/cold-fork/packet.json` (new)
4. `packages/control-plane/fixtures/cold-fork/acceptance.json` (new)
5. `packages/control-plane/fixtures/cold-fork/review.json` (new)

This pod does not edit implementation files. It reports defects to owning slices.

## Sequence

1. Land/verify current prerequisites: v7 route/lifecycle schema + producer hooks, stable agent IDs, restart re-adoption/session ownership, daemon ingestion, and spawn verification report types.
2. Freeze Slice C’s schemas and migration first; publish the exact Effect types to A/B/D/E/F.
3. Run A and the schema-only portion of C in parallel. A establishes deterministic transcript selection; C establishes durable joins.
4. Run B after A and the spawn/route producer handoffs. Smoke-test materialization, start, cancellation, and per-arm route linkage before cleanup work.
5. Run D after B/C so emitted envelopes are understood before production enablement. If a newer producer lands first, unknown/future envelopes remain generic and must not be claimed as projected.
6. Run E after terminal task-result/verification facts can be joined. Validate blind bundle contents before evaluating scoring or frontier output.
7. Run F only after blind evidence and a saved frontier are available. Approval remains evidence-only.
8. Run G against the integrated package. The coordinator then runs the final package gate once across the union.

## Edge Cases

- **Source moves during capture:** leaf or hash changes between flush and snapshot; fail `SourceTranscriptChanged`, create no arms.
- **Dangling/unknown leaf:** follow existing `leaf_change` replay rule for opening a session, but an explicitly requested missing fork entry is an error, never fallback to current leaf.
- **Root fork:** allow a declared root sentinel resolved to null; snapshot contains header and no conversation nodes, but still records exact source identity.
- **Compaction/blob references:** resolve using existing migration/blob paths; all arms receive the same resolved snapshot hash. Missing blobs fail the set.
- **Mixed historical `parentSession` semantics:** never infer fork lineage from the header alone; use `ColdForkOriginV1`.
- **Stable ID collision:** allocate all IDs before files, recheck registry and durable lineage immediately before registration, and fail the set rather than suffixing silently.
- **Partial materialization:** remove only new unregistered arm files/artifact dirs; preserve declaration and a typed failure event.
- **Provider/account fallback:** actual route may differ from request. Preserve the new complete route resolution and mark it as an uncontrolled difference; do not relabel the arm.
- **Queued hotswap/restart:** neither is inherited. A post-start hotswap makes the arm non-comparable unless the rubric explicitly allows it; record all route transitions. The evidence participant at ordinal 0 remains the initial `spawn_resolved` route; later route resolutions stay joined through the arm timeline and are listed as uncontrolled differences, never flattened into the participant identity. Any such arm is ineligible for promotion in v1.
- **Arm failure:** retain output and measurements. Review can proceed only with at least two comparable arms; otherwise set fails without recommendation.
- **Budget races:** atomically latch the first exhausted dimension. Concurrent observations may be recorded in detail, but only one cancellation fan-out occurs.
- **Cancellation during review:** seal any submitted review; cancel unsubmitted review work, retain arm evidence, terminal state `cancelled`, no recommendation.
- **Reviewer leakage:** any bundle field, artifact metadata, filename, ordering, transcript excerpt, or verification text that reveals lane identity is a failure. Create sanitized reviewer artifacts rather than exposing raw paths.
- **Ties/incomplete Pareto axes:** ties remain frontier peers; missing required axes produce `incomplete`, never dominance or promotion.
- **Cost ambiguity:** subscription allowance and API dollars remain distinct metrics/cost bases; no unit conversion without a versioned derivation.
- **Recommendation conflicts:** a newer recommendation may supersede an older one explicitly; old evidence/history remains. Approval is rejected if review identity is not independent.
- **Restart:** re-adopt eligible running/interrupted arms parked under the same arm IDs, emit `interrupted_by_restart/adopt`, and require explicit revive. Fork-set budget counters rebuild from ledger model calls/events; in-memory counters never win.

## Verification

### Slice A focused tests

1. Materialize two arms from one source leaf; assert distinct session/agent IDs, byte-identical branch entries, identical snapshot hashes, unchanged source bytes, and typed origin metadata.
2. Select an older branch through persisted `leaf_change`; assert only the root-to-selected-entry path is copied and selector entries are excluded.
3. Reject missing entry, hash drift, missing blob, destination collision, and source mutation during capture without partial registered agents.
4. Reopen a fork with no provider cache state and assert `buildSessionContext` equals the source branch context.

### Slice B focused tests

1. Lane-only, effort-only, and advisor-only sets preallocate new stable IDs and preserve all non-declared fields.
2. One arm’s resolved selector/account differs from request; route event contains the actual decision and the arm is marked uncontrolled/non-promotable.
3. Per-arm cap cancels only that arm; set cap cancels all remaining arms exactly once; partial outputs survive with correct terminal status.
4. Operator cancellation races completion; completed arm stays completed, active arms receive one cancel, repeated cancel is idempotent.
5. Restart rebuilds counters from durable events and cannot resurrect queued hotswap/advisor/job state.

### Slice C/D focused tests

1. Migrate v7 database additively; old evidence bundles and outbox kinds still decode/ingest.
2. Ingest every valid state transition; reject skips, regressions, conflicting `forkSeq`, wrong event ID, unknown arm, bad artifact hash, and illegal terminal reopen.
3. Unknown kind/version remains a byte-identical generic event; no partial fork projection.
4. Duplicate canonical event is ignored; same key/different content fails the batch.
5. Join arm agent/session/route/packet lineage and reject cross-set contamination.

### Slice E focused tests

1. Blind bundle order is randomized and contains no arm/model/provider/account/effort/advisor/session/route/timing/cost identity, including artifact filenames and metadata.
2. Reviewer cannot be source/arm/advisor; alias omission, duplication, unknown alias, or second submission fails atomically.
3. Review measurements join the correct run only after submission; raw alias map remains unavailable to reviewer APIs.
4. Evidence bundle maps primary/advisor participants from actual route rows and preserves account/effort.
5. Complete-case frontier returns frontier/dominated/incomplete candidates, ties, dominance evidence IDs, and no weighted score.

### Slice F focused tests

1. Reject proposals without blind review, required gates, comparable arms, saved frontier, or with uncontrolled differences.
2. Reject self-review and participant/reviewer conflicts.
3. Approve/reject/withdraw/supersede transitions are append-only and idempotent.
4. Approval writes at most one evidence-linked routing observation and leaves `lane_state`, `defaultFor`, YAML/config, and subsequent route resolution unchanged.

### End-to-end proof

From one fixture session with two branches, create three arms varying lane, effort, and advisor composition; materialize and run them with fixture-safe deterministic outputs; ingest route/lifecycle/fork events; cancel one arm by budget; create a blind bundle for the remaining outputs; submit reviewer evidence; ingest local runs/participants/measurements; query the Pareto frontier; propose and independently approve a scoped recommendation. Assert source JSONL unchanged, every arm has a new stable ID, all shared artifact hashes match, cancelled evidence remains visible, the recommendation references observed evidence, and no default/config/lane-state row changes.

## Critical Files

- `docs/fable/routing-doctrine.md:1-162` — stable ontology, comparable forks, outcome rubric, failure/fallback, reviewed promotion.
- `docs/fable/agent-system-overview.md:1-160` — current in-process lifecycle, durable/source boundaries, hotswap/restart truth table, learning-loop constraints.
- `docs/plans/pi-agent-control-plane.md:399-516` — M4 cold fork contract and explicit no-KV-cache dependency.
- `docs/plans/harness-control-primitives.md:1-42` — current fork/eval tracker and existing primitive boundary.
- `local/resolved-route-events-contract.md:280-680` — frozen v7 linkage, route/advisor/account/effort schemas, ordering, query surface, non-goals.
- `local/session-ownership-contract.md:1-263` — lease fencing, restart/re-adoption, no in-flight continuation.
- `vendor/oh-my-pi/packages/coding-agent/src/session/session-entries.ts:1-183` — session header, tree entries, leaf selector, durable subagent metadata.
- `vendor/oh-my-pi/packages/coding-agent/src/session/session-manager.ts:1420-1610` — branch pruning, current fork implementation, new session minting.
- `vendor/oh-my-pi/packages/coding-agent/src/session/session-context.ts:60-95` — `leaf_change` replay and context construction.
- `vendor/oh-my-pi/packages/coding-agent/src/modes/controllers/tan-command-controller.ts:31-190` — closest shipped cold-copy behavior and its unsafe-for-contract provider cache hints.
- `vendor/oh-my-pi/packages/coding-agent/src/task/re-adopt.ts:1-215` — durable direct-child recovery and collision/error behavior.
- `vendor/oh-my-pi/packages/coding-agent/src/task/types.ts:94-303` — stable task IDs and spawn verification handoff surface.
- `vendor/oh-my-pi/packages/coding-agent/test/task/task-guards.test.ts:1-243` — current request-budget and abort/partial-output behavior.
- `packages/control-plane/src/schema.ts:3-238,339-458` — packet/routing/route/evidence tables and exact additive seams.
- `packages/control-plane/src/evidence.ts:64-244` — existing evidence/run/participant/measurement bundle contract.
- `packages/control-plane/src/evidence-ingest.ts` — atomic/idempotent evidence validation and physical metric rules.
- `packages/control-plane/src/frontier.ts:14-118` — participant identity and complete-case Pareto semantics.
- `packages/control-plane/src/routing.ts:13-138` — reviewed observations/lane state boundary; recommendation must not auto-call `setLaneState`.

## Explicit deferrals

- Warm/provider KV-cache forks, cache-slot transfer, and cache-hit guarantees.
- Automatic default, config, lane-state, fallback-order, promotion, constraint, retirement, or policy changes.
- Composite quality/cost scores or inferred quality from throughput/tokens/edits.
- HTTP mutation endpoints until the semantic command approval/authentication contract exists; the current v7 HTTP API remains read-only except client-error reporting.
- Multi-machine/libSQL execution and remote workspace cloning.
- A second messaging bus, lifecycle store, transcript store, task ledger, or evidence store.
- Workflow templates, mandatory role hierarchies, automatic retries, and automatic experiment scheduling.
- Workspace cloning beyond existing isolated/APFS support; if safe isolation is unavailable for a mutating packet, the fork fails explicitly.
