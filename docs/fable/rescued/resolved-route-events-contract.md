> Rescued 2026-07-13 from /Users/arthur/agents/local/resolved-route-events-contract.md

# Resolved Route and Agent Lifecycle Events Contract

Status: frozen for additive ledger schema v7 implementation  
Scope: durable, queryable per-agent route and lifecycle timelines  
Policy authority: `docs/fable/routing-doctrine.md`  
Current-system boundary: `docs/fable/agent-system-overview.md`

## 1. Version boundary and invariants

“v7” means `LEDGER_SCHEMA_VERSION = 7`. It does **not** change the outbox envelope wire version. New records use the existing envelope shape with `v: 1`, a per-source-session `seq`, `ts`, `sessionId`, and `payload`. Their two additive known envelope kinds are exactly `agentTimeline` and `routeResolution`; each payload has `payloadVersion: 1`.

The following are fixed invariants:

1. `agentId` is the stable operator handle. Adoption and revival never allocate a replacement id.
2. The route recorded by `routeResolution` is a complete resolved snapshot, not a delta. A consumer never has to reconstruct provider, model, account, effort, advisor composition, or provenance from model calls.
3. A route change and its timeline marker are one ingest unit: ingesting one `routeResolution` envelope inserts the route projection, candidates, advisors, artifact links, and one `agent_timeline_events` row in one transaction.
4. Outbox `seq` is the append order within `sourceSessionId`; `agentSeq` is the durable logical order for one `agentId`. Both start at zero and increase by exactly one. Timestamp is not an ordering key.
5. The producer obtains `agentSeq` from the durable agent/session journal. It appends the durable source record before notifying the publisher. An in-memory-only counter is prohibited because restart would reuse or skip values.
6. The canonical idempotency key is `(sourceSessionId, sourceSeq)` at the transport boundary and `(agentId, agentSeq)` at the logical timeline boundary. Reingesting the same record is ignored. Either key colliding with different content is a hard ingest error, not last-write-wins.
7. A route resolution id is `${agentId}:route:${agentSeq}`. A lifecycle event id is `${agentId}:event:${agentSeq}`. The synthetic timeline event produced from a route envelope is `${agentId}:event:${agentSeq}` and references the resolution id.
8. Replacement startup may recover history and a parked control handle, never an in-flight turn. It emits `interrupted_by_restart` for unfinished work and then `adopt`; it never emits `revive`, `running`, or `completed` on the basis of pre-restart work.
9. Every override, fallback, revert, serving account, and advisor is explicit. No telemetry row updates config or policy. There is no outcome super-score.
10. Existing outbox bytes are immutable. The publisher only appends new lines; migration and ingest never rewrite, normalize, or reserialize old lines.
11. Unknown future envelope kinds and every envelope with `v !== 1` continue through the existing `genericEvent` path: `events.kind` is the envelope kind and `events.payload` is the complete original JSON line byte-for-byte. Adding the two known kinds must not change that fallback.

## 2. Controlled values and null semantics

Application decoders reject unlisted v1 values. SQLite stores them as `TEXT` so a later payload version can add values without rebuilding tables.

### Timeline kinds

`spawn_scheduled | spawn_resolved | spawn_started | model_change | thinking_change | account_change | hotswap | fallback | revert | advisor_change | interrupt | cancel | idle | park | adopt | revive | interrupted_by_restart | completed | failed`

`spawn_resolved`, `model_change`, `thinking_change`, `account_change`, `hotswap`, `fallback`, `revert`, and `advisor_change` are produced only by a `routeResolution` envelope. All other kinds are produced only by an `agentTimeline` envelope.

### Agent states

`scheduled | resolved | running | interrupted | cancelled | idle | parked | completed | failed`

State transitions are facts, not commands:

| kind | fromState | toState | required follow-on |
|---|---|---|---|
| `spawn_scheduled` | null | `scheduled` | `spawn_resolved` or `failed` |
| `spawn_resolved` | `scheduled` | `resolved` | `spawn_started` or `failed` |
| `spawn_started` | `resolved` | `running` | — |
| route change other than `spawn_resolved` | null | null | — |
| `interrupt` | `running` | `interrupted` | `idle`, `park`, `failed`, or `interrupted_by_restart` |
| `cancel` | any nonterminal state | `cancelled` | none |
| `idle` | `running`, `interrupted`, `completed`, or `failed` | `idle` | — |
| `park` | `idle` | `parked` | — |
| `interrupted_by_restart` | `running` or `interrupted` | `parked` | `adopt` when eligible |
| `adopt` | `parked` | `parked` | — |
| `revive` | `parked` | actual rebuilt state: `idle` or `running` | — |
| `completed` | `running` | `completed` | `idle` or `park` when the retained handle remains usable |
| `failed` | any nonterminal state | `failed` | `idle` or `park` only when the retained handle remains usable |

`adopt` is an audit transition whose logical before/after state is parked; `detail.replacementSessionId` and `detail.recoveredJournalEntryId` are required. `interrupted_by_restart.detail.turnId` and `detail.restartId` are required. `cancel`, `completed`, and terminal `failed` do not imply that the agent is revivable.

### Route change kinds

`spawn_resolved | model_change | thinking_change | account_change | hotswap | fallback | revert | advisor_change`

A change that affects several fields uses the initiating cause. For example, a quota fallback that changes provider, account, model, and effort is `fallback`, not four events.

### Policy layers

`hard_constraint | spawn_explicit | session_strategy | workspace_policy | global_policy`

The order above is precedence order. `winningLayer` is the highest-precedence source that supplied the selected value after hard-constraint eligibility. A route may have different winners per field; `winningLayer` is the winner for lane selection, while `consultedSources[].values` and `overriddenValues[]` preserve field-level resolution.

### Account representation

`accountKind` is `configured | ambient | none`.

- `configured`: `accountRef` is required and is an opaque stable config-slot/account label, never a secret.
- `ambient`: `accountRef` is nullable because the harness cannot safely identify the credential; `accountProvenance` must identify the resolver/provider credential source.
- `none`: `accountRef` is null and `accountProvenance` explains why an account is not applicable.

A producer must not write the string `unknown` in any resolved-route field. If account identity is genuinely unavailable, it uses `ambient` with explicit provenance.

`effort` is exact and non-null: `none | low | medium | high | high_plus | provider_defined:<literal>`. Provider literals are preserved after the prefix.

## 3. Additive SQLite schema v7

All timestamps are Unix epoch milliseconds. JSON columns contain canonical compact JSON: object keys sorted recursively, arrays retained in semantic order, no insignificant whitespace. Nullable means SQL `NULL`; empty string is never a substitute for missing data.

No v7 table is a policy table. Foreign-key enforcement is intentionally not introduced into the existing ledger migration; ingest validates references transactionally.

### 3.1 `agent_timeline_events`

| column | SQLite type | null | meaning |
|---|---|---:|---|
| `id` | TEXT PRIMARY KEY | no | `${agentId}:event:${agentSeq}` |
| `ts` | INTEGER | no | fact occurrence time |
| `sourceSessionId` | TEXT | no | outbox envelope `sessionId` |
| `sourceSeq` | INTEGER | no | outbox envelope `seq` |
| `agentId` | TEXT | no | stable operator handle |
| `agentSeq` | INTEGER | no | durable per-agent sequence |
| `agentSessionId` | TEXT | yes | child transcript/session id; null before allocation |
| `parentSessionId` | TEXT | yes | owning parent session |
| `parentAgentId` | TEXT | yes | parent stable agent id; null only for root |
| `taskId` | TEXT | yes | task/job execution id |
| `packetId` | TEXT | yes | work packet id |
| `branchId` | TEXT | yes | execution branch |
| `turnId` | TEXT | yes | affected turn |
| `kind` | TEXT | no | controlled timeline kind |
| `fromState` | TEXT | yes | controlled agent state |
| `toState` | TEXT | yes | controlled agent state |
| `routeResolutionId` | TEXT | yes | required for route-derived timeline kinds, otherwise null |
| `reason` | TEXT | yes | human/operator/resolver reason; required for explicit changes, fallback, revert, interrupt, cancel, and failed |
| `errorClass` | TEXT | yes | typed failure class; required for `failed`, otherwise null |
| `detail` | TEXT | no | canonical JSON object; event-specific facts only |
| `payloadVersion` | INTEGER | no | `1` |

Indexes, with exact names:

```sql
CREATE UNIQUE INDEX agent_timeline_source_unique_idx
  ON agent_timeline_events (sourceSessionId, sourceSeq);
CREATE UNIQUE INDEX agent_timeline_agent_seq_unique_idx
  ON agent_timeline_events (agentId, agentSeq);
CREATE INDEX agent_timeline_agent_ts_idx
  ON agent_timeline_events (agentId, ts);
CREATE INDEX agent_timeline_parent_agent_seq_idx
  ON agent_timeline_events (parentAgentId, agentSeq);
CREATE INDEX agent_timeline_task_idx
  ON agent_timeline_events (taskId);
CREATE INDEX agent_timeline_packet_idx
  ON agent_timeline_events (packetId);
CREATE INDEX agent_timeline_kind_ts_idx
  ON agent_timeline_events (kind, ts);
CREATE INDEX agent_timeline_route_idx
  ON agent_timeline_events (routeResolutionId);
```

### 3.2 `route_resolutions`

| column | SQLite type | null | meaning |
|---|---|---:|---|
| `id` | TEXT PRIMARY KEY | no | `${agentId}:route:${agentSeq}` |
| `ts` | INTEGER | no | resolution/change effective time |
| `sourceSessionId` | TEXT | no | envelope session |
| `sourceSeq` | INTEGER | no | envelope sequence |
| `agentId` | TEXT | no | stable operator handle |
| `agentSeq` | INTEGER | no | same logical sequence as synthetic timeline row |
| `agentSessionId` | TEXT | yes | child session; null for pre-allocation scheduling |
| `parentSessionId` | TEXT | yes | owning parent session |
| `parentAgentId` | TEXT | yes | parent agent |
| `taskId` | TEXT | yes | task/job execution |
| `packetId` | TEXT | yes | work packet |
| `branchId` | TEXT | yes | active branch |
| `turnId` | TEXT | yes | turn boundary where route became effective |
| `changeKind` | TEXT | no | controlled route change kind |
| `reason` | TEXT | yes | required except mechanically resolved initial spawn with no explicit exception |
| `lane` | TEXT | no | concrete resolved lane key |
| `provider` | TEXT | no | serving provider |
| `upstreamProvider` | TEXT | yes | upstream provider when different/known |
| `model` | TEXT | no | exact model id |
| `accountKind` | TEXT | no | controlled account kind |
| `accountRef` | TEXT | yes | opaque account/config-slot reference |
| `accountProvenance` | TEXT | no | canonical JSON object describing account resolver and capacity/cost source refs |
| `effort` | TEXT | no | exact effort value |
| `winningLayer` | TEXT | no | lane-selection winning policy layer |
| `constraints` | TEXT | no | canonical JSON array of `RouteConstraint` |
| `consultedSources` | TEXT | no | canonical JSON array of `ConsultedSource` in precedence order |
| `overriddenValues` | TEXT | no | canonical JSON array of `OverriddenValue` |
| `fallbackFromResolutionId` | TEXT | yes | required for `fallback`; immediate prior attempted route |
| `revertedFromResolutionId` | TEXT | yes | required for `revert`; route being undone |
| `advisorMode` | TEXT | no | `none` or `composed` |
| `rawDecisionArtifactId` | TEXT | yes | full resolver trace/context manifest when retained |
| `payloadVersion` | INTEGER | no | `1` |

Indexes:

```sql
CREATE UNIQUE INDEX route_resolutions_source_unique_idx
  ON route_resolutions (sourceSessionId, sourceSeq);
CREATE UNIQUE INDEX route_resolutions_agent_seq_unique_idx
  ON route_resolutions (agentId, agentSeq);
CREATE INDEX route_resolutions_agent_ts_idx
  ON route_resolutions (agentId, ts);
CREATE INDEX route_resolutions_packet_ts_idx
  ON route_resolutions (packetId, ts);
CREATE INDEX route_resolutions_lane_ts_idx
  ON route_resolutions (provider, model, accountRef, effort, ts);
CREATE INDEX route_resolutions_change_kind_ts_idx
  ON route_resolutions (changeKind, ts);
CREATE INDEX route_resolutions_fallback_from_idx
  ON route_resolutions (fallbackFromResolutionId);
```

### 3.3 `route_candidates`

One row per considered concrete lane. Candidate order is resolver order, not score order.

| column | SQLite type | null | meaning |
|---|---|---:|---|
| `routeResolutionId` | TEXT | no | owning resolution |
| `ordinal` | INTEGER | no | zero-based candidate order |
| `lane` | TEXT | no | concrete lane key |
| `provider` | TEXT | no | candidate provider |
| `model` | TEXT | no | candidate model |
| `accountKind` | TEXT | no | candidate account kind |
| `accountRef` | TEXT | yes | candidate account reference |
| `effort` | TEXT | no | candidate effort |
| `disposition` | TEXT | no | `selected | rejected | fallback` |
| `fallbackOrdinal` | INTEGER | yes | zero-based declared fallback order; only for `fallback` |
| `rejectionCode` | TEXT | yes | machine-stable exclusion code; required for `rejected` |
| `rejectionReason` | TEXT | yes | concise explanation; required for `rejected` |
| `failedConstraintIds` | TEXT | no | canonical JSON string array, empty when none |

Primary key and indexes:

```sql
PRIMARY KEY (routeResolutionId, ordinal)
CREATE INDEX route_candidates_disposition_idx
  ON route_candidates (routeResolutionId, disposition, fallbackOrdinal);
CREATE INDEX route_candidates_lane_idx
  ON route_candidates (provider, model, accountRef, effort);
```

Exactly one row has `disposition = 'selected'`, and it must exactly match the owning resolution’s lane/provider/model/account/effort. `fallbackOrdinal` values are unique and contiguous from zero within a resolution. A later activated fallback is a new resolution whose `fallbackFromResolutionId` points to the immediately failed resolution; history is never updated in place.

### 3.4 `route_advisors`

One row per advisor in the resolved composition.

| column | SQLite type | null | meaning |
|---|---|---:|---|
| `routeResolutionId` | TEXT | no | owning worker route |
| `ordinal` | INTEGER | no | zero-based composition order |
| `advisorAgentId` | TEXT | yes | stable advisor agent id once allocated |
| `purpose` | TEXT | no | declared advisory responsibility |
| `lane` | TEXT | no | advisor lane |
| `provider` | TEXT | no | advisor provider |
| `model` | TEXT | no | advisor model |
| `accountKind` | TEXT | no | advisor account kind |
| `accountRef` | TEXT | yes | advisor account reference |
| `accountProvenance` | TEXT | no | canonical account provenance object |
| `effort` | TEXT | no | advisor effort |
| `winningLayer` | TEXT | no | source that selected this advisor |
| `independenceRequired` | INTEGER | no | boolean `0` or `1` |
| `rawAdviceArtifactId` | TEXT | yes | durable advice/output handle |

Primary key and index:

```sql
PRIMARY KEY (routeResolutionId, ordinal)
CREATE INDEX route_advisors_agent_idx
  ON route_advisors (advisorAgentId);
CREATE INDEX route_advisors_lane_idx
  ON route_advisors (provider, model, accountRef, effort);
```

`advisorMode = 'none'` requires zero rows; `advisorMode = 'composed'` requires at least one. Advisors are composition facts, never silently folded into persona or worker lane.

### 3.5 `route_event_artifacts`

Normalized raw/evidence handles shared by lifecycle events and route resolutions.

| column | SQLite type | null | meaning |
|---|---|---:|---|
| `ownerKind` | TEXT | no | `agentEvent | routeResolution` |
| `ownerId` | TEXT | no | event or resolution id |
| `ordinal` | INTEGER | no | zero-based within owner |
| `role` | TEXT | no | `sessionJournal | taskInput | taskOutput | rawRequest | rawResponse | contextManifest | resolverTrace | error | review | other` |
| `artifactId` | TEXT | no | existing `artifacts.id` |

```sql
PRIMARY KEY (ownerKind, ownerId, ordinal)
CREATE INDEX route_event_artifacts_artifact_idx
  ON route_event_artifacts (artifactId);
CREATE INDEX route_event_artifacts_owner_role_idx
  ON route_event_artifacts (ownerKind, ownerId, role);
```

Ingest validates that `ownerId` exists in the corresponding v7 table. Artifact rows may arrive later; the handle remains queryable.

### 3.6 Existing table additions

```sql
ALTER TABLE model_calls ADD COLUMN routeResolutionId TEXT;
CREATE INDEX model_calls_route_resolution_idx
  ON model_calls (routeResolutionId);
```

The v1 `modelCall` payload gains optional `routeResolutionId`. It is null for historical outboxes. Once the producer has emitted an initial `spawn_resolved`, every new child model call must carry the currently effective resolution id. This is the exact execution-to-route join; time-window inference is prohibited.

The existing `routing_observations` table remains unchanged. It stores dated evidence or judgments about lanes (`verdict`, `evidence`, `confidence`); it neither represents nor supersedes a per-packet resolved decision. `route_resolutions` records what route actually won and why. Telemetry may later support a reviewed observation, but ingest never creates observations automatically.

## 4. Publisher envelope payloads

The TypeScript names and shapes below are frozen. `JsonObject` means `{ readonly [key: string]: JsonValue }`; no `any` or `unknown` appears in the public types.

```ts
type AgentState =
  | "scheduled" | "resolved" | "running" | "interrupted"
  | "cancelled" | "idle" | "parked" | "completed" | "failed"

type PolicyLayer =
  | "hard_constraint" | "spawn_explicit" | "session_strategy"
  | "workspace_policy" | "global_policy"

type AccountKind = "configured" | "ambient" | "none"
type Effort = "none" | "low" | "medium" | "high" | "high_plus" | `provider_defined:${string}`

type LifecycleKind =
  | "spawn_scheduled" | "spawn_started" | "interrupt" | "cancel"
  | "idle" | "park" | "adopt" | "revive"
  | "interrupted_by_restart" | "completed" | "failed"

type RouteChangeKind =
  | "spawn_resolved" | "model_change" | "thinking_change" | "account_change"
  | "hotswap" | "fallback" | "revert" | "advisor_change"

interface EventLinkage {
  readonly agentId: string
  readonly agentSeq: number
  readonly agentSessionId: string | null
  readonly parentSessionId: string | null
  readonly parentAgentId: string | null
  readonly taskId: string | null
  readonly packetId: string | null
  readonly branchId: string | null
  readonly turnId: string | null
}

interface ArtifactHandle {
  readonly role:
    | "sessionJournal" | "taskInput" | "taskOutput" | "rawRequest"
    | "rawResponse" | "contextManifest" | "resolverTrace" | "error"
    | "review" | "other"
  readonly artifactId: string
}

interface AgentTimelinePayloadV1 extends EventLinkage {
  readonly payloadVersion: 1
  readonly eventId: string
  readonly occurredAt: number
  readonly kind: LifecycleKind
  readonly fromState: AgentState | null
  readonly toState: AgentState | null
  readonly reason: string | null
  readonly errorClass: string | null
  readonly detail: JsonObject
  readonly artifacts: readonly ArtifactHandle[]
}
```

Envelope:

```ts
{
  v: 1,
  kind: "agentTimeline",
  sessionId: sourceSessionId,
  seq: sourceSeq,
  ts: payload.occurredAt,
  payload: AgentTimelinePayloadV1
}
```

Route provenance types:

```ts
interface RouteConstraint {
  readonly id: string
  readonly kind: "quality" | "latency" | "budget" | "context" | "tool"
    | "privacy" | "auth" | "availability" | "review_independence" | "other"
  readonly requirement: string
  readonly hard: boolean
  readonly sourceLayer: PolicyLayer
  readonly sourceRef: string
}

interface ConsultedSource {
  readonly layer: PolicyLayer
  readonly sourceRef: string
  readonly values: JsonObject
}

interface OverriddenValue {
  readonly field: "lane" | "provider" | "model" | "account" | "effort" | "advisor" | "fallback"
  readonly losingLayer: PolicyLayer
  readonly losingSourceRef: string
  readonly losingValue: JsonValue
  readonly winningLayer: PolicyLayer
  readonly winningSourceRef: string
  readonly winningValue: JsonValue
  readonly reason: string
}

interface AccountResolution {
  readonly kind: AccountKind
  readonly ref: string | null
  readonly provenance: JsonObject
}

interface RouteCandidateV1 {
  readonly ordinal: number
  readonly lane: string
  readonly provider: string
  readonly model: string
  readonly account: AccountResolution
  readonly effort: Effort
  readonly disposition: "selected" | "rejected" | "fallback"
  readonly fallbackOrdinal: number | null
  readonly rejectionCode: string | null
  readonly rejectionReason: string | null
  readonly failedConstraintIds: readonly string[]
}

interface AdvisorRouteV1 {
  readonly ordinal: number
  readonly advisorAgentId: string | null
  readonly purpose: string
  readonly lane: string
  readonly provider: string
  readonly model: string
  readonly account: AccountResolution
  readonly effort: Effort
  readonly winningLayer: PolicyLayer
  readonly independenceRequired: boolean
  readonly rawAdviceArtifactId: string | null
}

interface RouteResolutionPayloadV1 extends EventLinkage {
  readonly payloadVersion: 1
  readonly resolutionId: string
  readonly occurredAt: number
  readonly changeKind: RouteChangeKind
  readonly reason: string | null
  readonly route: {
    readonly lane: string
    readonly provider: string
    readonly upstreamProvider: string | null
    readonly model: string
    readonly account: AccountResolution
    readonly effort: Effort
  }
  readonly provenance: {
    readonly winningLayer: PolicyLayer
    readonly constraints: readonly RouteConstraint[]
    readonly consultedSources: readonly ConsultedSource[]
    readonly overriddenValues: readonly OverriddenValue[]
  }
  readonly candidates: readonly RouteCandidateV1[]
  readonly fallbackFromResolutionId: string | null
  readonly revertedFromResolutionId: string | null
  readonly advisors: readonly AdvisorRouteV1[]
  readonly rawDecisionArtifactId: string | null
  readonly artifacts: readonly ArtifactHandle[]
}
```

Envelope:

```ts
{
  v: 1,
  kind: "routeResolution",
  sessionId: sourceSessionId,
  seq: sourceSeq,
  ts: payload.occurredAt,
  payload: RouteResolutionPayloadV1
}
```

Ingest derives the route timeline row as follows: `id = ${agentId}:event:${agentSeq}`, `kind = changeKind`, `routeResolutionId = resolutionId`, all linkage and reason copied, `errorClass = null`, `detail = { fallbackFromResolutionId, revertedFromResolutionId }`, and states are `scheduled -> resolved` only for `spawn_resolved`, otherwise both null. A failure-triggered fallback requires `reason`; the immediately preceding `failed` lifecycle event carries the typed `errorClass`, and `fallbackFromResolutionId` identifies the failed route.

## 5. Source event mapping

“Observable now” means present in the five inspected control-plane files or explicitly identified as durable/current in the system overview. It does not mean the current publisher exposes a hook for it.

| Contract fact | Source mapping | Current status |
|---|---|---|
| session start/switch/branch/shutdown | existing OMP extension hooks in `omp-events.ts` and `omp-publisher.ts` | observable and published as legacy `event`; not agent lifecycle |
| turn start/end | existing hooks and `turnStarts` publisher state | observable and published |
| actual provider/model/upstream provider/thinking on an assistant call | `message_end` plus captured `before_provider_request` | observable; provider/model materialized, thinking currently emitted only as attribution and `effort` is currently hard-coded `unknown` |
| raw provider request | `before_provider_request` payload | observable when supported; ingest content-addresses it as an artifact |
| raw response | no inspected publisher field/artifact mapping | missing producer hook |
| parent session | session start/switch/branch payload | observable for sessions; no stable parent-agent/task linkage hook |
| model/thinking/service-tier change journal entries | OMP JSONL per system overview | durable source fact, but absent from inspected extension payload types/publisher |
| advisor selector attribution/advice cards | OMP JSONL per system overview | durable source fact, but no route/advisor publisher payload or cost linkage |
| spawn receipt, stable child id, parent agent, task, live status | registry/task runtime per system overview | process-local and missing from publisher contract |
| resolved provider/model/account/effort before execution | route/task resolver | provider/model partly observable after call; full pre-execution decision and serving account missing |
| precedence, constraints, rejected candidates, fallback chain | route/config resolver | genuinely missing producer hook |
| hotswap/fallback/revert reason and effective boundary | hotswap/task lifecycle | model change may be journaled; semantic event and route linkage missing |
| interrupt/cancel/idle/park/completed/failed | job/registry/task lifecycle | live behavior exists; durable publisher hooks missing |
| adopt/revive/interrupted_by_restart | replacement/re-adoption lifecycle | target behavior; producer hook must be added with adoption implementation |
| packet linkage | task invocation/packet contract | columns exist elsewhere, but current publisher emits empty `packetId` for model calls |
| model call to exact resolved route | publisher’s active route state | missing; v7 adds nullable `model_calls.routeResolutionId` and requires it after initial resolution |

Producer hooks must be emitted at the state transition/resolver source, not inferred afterward from `message_end`, transcript text, Hub state, or raw assistant calls. The publisher may cache the currently effective `resolutionId` only after receiving a route hook; it must restore that id from durable session entries after restart.

## 6. Ingest behavior

1. Extend the known-kind union and `isKnownOutboxKind` with exactly `agentTimeline` and `routeResolution`. Do not alter the generic fallback condition: an unknown kind or `v !== 1` remains a byte-identical generic `events` row. A recognized kind whose payload has `payloadVersion !== 1` also goes to `genericEvent` with the complete original line; it is not a malformed v1 payload.
2. Decode payload v1 with Effect Schema using the existing known-payload excess-property behavior. Producers must bump `payloadVersion` for semantic additions; ignored excess fields are never materialized accidentally.
3. Validate deterministic ids, nonnegative integer sequences, linkage, state-transition table, account null rules, route candidate invariants, advisor invariants, fallback/revert references, and artifact owner roles before insertion.
4. Insert all rows derived from one envelope in one ledger transaction. A duplicate with byte-identical canonical payload increments `ignored`. If either idempotency key already names different content, fail the ingest batch with a `StorageError`; do not overwrite, ignore, or materialize a partial v7 projection.
5. Do not synthesize route rows from legacy model calls or generic events. Historical absence remains absence.
6. Do not update a prior route when fallback, revert, account rotation, effort change, or advisor change occurs; insert a new complete resolution.
7. Preserve the existing raw-request content addressing. Add the active `routeResolutionId` to new `modelCall` rows when present; old payloads remain valid and map it to null.

## 7. Required query surface

Worker A exposes these functions (names and semantics are fixed) from a new `packages/control-plane/src/agent-timeline.ts`. Each takes a `LedgerStore` dependency in the repository’s existing Effect style; JSON text columns are returned decoded into the payload types above.

### `getAgentTimeline(agentId, afterAgentSeq?, limit = 200)`

Ascending, gap-visible logical timeline:

```sql
SELECT *
FROM agent_timeline_events
WHERE agentId = ? AND (? IS NULL OR agentSeq > ?)
ORDER BY agentSeq ASC
LIMIT ?;
```

The function additionally returns `nextAgentSeq = last.agentSeq + 1` and `hasGap`, computed by checking every adjacent sequence. It never orders by timestamp.

### `getCurrentAgentStates(parentAgentId?)`

Latest durable fact per agent, optionally restricted to direct children:

```sql
WITH ranked AS (
  SELECT e.*,
         ROW_NUMBER() OVER (PARTITION BY agentId ORDER BY agentSeq DESC) AS rn
  FROM agent_timeline_events e
  WHERE (? IS NULL OR parentAgentId = ?)
)
SELECT * FROM ranked WHERE rn = 1 ORDER BY ts DESC, agentId ASC;
```

This is durable state, not a claim that a live in-process session exists. A latest `parked`/`adopt` row means a usable durable handle only when current auth/policy revival validation succeeds.

### `getResolvedRoute(resolutionId)`

Returns exactly one resolution with ordered candidates, advisors, and artifacts:

```sql
SELECT * FROM route_resolutions WHERE id = ?;
SELECT * FROM route_candidates WHERE routeResolutionId = ? ORDER BY ordinal;
SELECT * FROM route_advisors WHERE routeResolutionId = ? ORDER BY ordinal;
SELECT * FROM route_event_artifacts
 WHERE ownerKind = 'routeResolution' AND ownerId = ? ORDER BY ordinal;
```

### `getAgentRouteTimeline(agentId)`

```sql
SELECT r.*
FROM route_resolutions r
WHERE r.agentId = ?
ORDER BY r.agentSeq ASC;
```

Each returned route is hydrated with ordered candidates/advisors. The caller can explain every model/thinking/account/advisor/fallback/revert transition without reading `model_calls`.

### `getPacketRouteTimeline(packetId)`

```sql
SELECT r.*
FROM route_resolutions r
WHERE r.packetId = ?
ORDER BY r.ts ASC, r.sourceSessionId ASC, r.sourceSeq ASC;
```

This cross-agent order uses timestamp plus stable transport tie-breakers; it does not pretend to be a causal total order across sessions.

### `getRestartRecoveryTimeline(agentId)`

```sql
SELECT * FROM agent_timeline_events
WHERE agentId = ?
  AND kind IN ('interrupted_by_restart', 'adopt', 'revive')
ORDER BY agentSeq ASC;
```

### `getModelCallsForResolution(resolutionId)`

```sql
SELECT * FROM model_calls
WHERE routeResolutionId = ?
ORDER BY ts ASC, id ASC;
```

No query computes a composite quality/outcome score or writes `lane_state`, config, routing observations, or policy.

## 8. Publisher ordering and restart semantics

For initial spawn the required order is:

1. durable source record + `agentTimeline(spawn_scheduled)`;
2. durable resolved-route record + `routeResolution(spawn_resolved)`;
3. child session allocation/start record + `agentTimeline(spawn_started)`;
4. model calls carrying the current `routeResolutionId`.

For hotswap/fallback/revert, emit the complete `routeResolution` only when the new route becomes effective, not when queued. A queued request may be represented in legacy/raw events, but it is not route truth. For fallback, emit `failed` for the failed attempt when applicable, then the new `routeResolution(fallback)`, then subsequent model calls. For revert, `revertedFromResolutionId` points to the route being undone, while the new snapshot identifies the restored route.

At replacement startup:

1. inspect durable child journals and validate lineage;
2. for unfinished work, append/emit `interrupted_by_restart` using the next durable `agentSeq`;
3. register eligible children parked under the same id;
4. append/emit `adopt` with replacement and recovered-journal ids;
5. restore the last effective resolution id as historical/current metadata, but do not emit a new route resolution unless current auth/policy actually re-resolves it;
6. on wake, validate current auth/policy and emit a new route resolution if any provider/model/account/effort/advisor fact changes; only then emit `revive` with the actual rebuilt state.

Old async-job ownership, queued swaps, advisor runtime, and in-flight turns are never claimed as restored.

## 9. Implementation ownership and dependency order

The two follow-up workers do not share files.

### Worker A — schema, ingest, ledger/query

Exclusive ownership:

- `packages/control-plane/src/schema.ts`
- `packages/control-plane/src/migrate.ts`
- `packages/control-plane/src/ingest.ts`
- `packages/control-plane/src/ledger.ts`
- `packages/control-plane/src/agent-timeline.ts` (new)
- control-plane tests for migration v7, ingest of both new kinds, idempotency/conflict behavior, generic unknown preservation, and the six query functions

Implementation order:

1. migration v7 and Drizzle schema/types;
2. ledger batch input/transaction support for the five v7 tables and model-call route link;
3. typed ingest decoders and atomic mapping;
4. query module;
5. tests.

Worker A does not edit publisher, outbox type declarations, OMP/vendor producers, routing policy, or `routing_observations`.

### Worker B — envelope types, publisher, OMP producer hooks

Exclusive ownership:

- `packages/control-plane/src/outbox.ts` (add the two known kind literals only; preserve envelope `v: 1`)
- `packages/control-plane/src/omp-events.ts`
- `packages/control-plane/src/omp-publisher.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/task/index.ts` (spawn scheduling and resolved route source)
- `vendor/oh-my-pi/packages/coding-agent/src/task/hotswap.ts` (effective hotswap/revert source)
- `vendor/oh-my-pi/packages/coding-agent/src/registry/agent-lifecycle.ts` (idle/park/revive lifecycle source)
- `vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts` (interrupt/cancel request-to-result correlation only)
- producer-hook tests adjacent to those files

Dependency constraint: the active restart re-adoption pod currently owns `task/re-adopt.ts`, `task/executor.ts`, `main.ts`, `session/session-entries.ts`, and `test/task/re-adopt.test.ts`. Worker B must begin after that pod lands. It may then add the frozen durable route/lifecycle source-entry types to `session/session-entries.ts` and emit `adopt`/`interrupted_by_restart` from `task/re-adopt.ts`; it must not implement those concurrently or create a parallel journal. `task/executor.ts` remains the source for spawn-started/completed/failed and advisor composition after that handoff. Those five files are an explicit sequential handoff, not shared ownership.

Worker B implementation order after the handoff:

1. durable source journal entry types and `agentSeq` recovery;
2. producer hooks at transition/resolution sources;
3. `omp-events.ts` typed extension payloads;
4. `outbox.ts` known kinds;
5. publisher append/mapping and active-resolution restoration;
6. producer/publisher tests.

### Cross-worker dependency

Workers A and B may implement independently from this contract. Merge/order dependency is only: A’s migration/ingest must ship before structured v7 envelopes are enabled in a release. If B lands first, new kinds remain safely preserved as generic byte-identical `events` rows but are not retroactively projected; therefore production enablement waits for A. Neither worker invents aliases, compatibility envelopes, or a backfill.

## 10. Non-goals

- No automatic lane promotion, retirement, default change, quota policy, or config rewrite.
- No outcome super-score or quality inference from tokens, latency, edits, or completion.
- No reconstruction of missing historical routes from raw assistant calls.
- No second lifecycle store, messaging mechanism, or OS-process-per-child design.
- No claim that `adopt` restored an in-flight turn, async job, advisor runtime, or queued hotswap.
- No replacement of `routing_observations`, artifacts, packet contracts, or current config as their respective sources of truth.
