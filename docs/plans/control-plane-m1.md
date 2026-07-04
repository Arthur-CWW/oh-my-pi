# Control plane M1 — implementation contract

Status: active
Date: 2026-07-04
Parent spec: `docs/plans/pi-agent-control-plane.md` (spec v1 — authoritative; this doc pins M1 implementation decisions and the inter-packet contract)

## Settled decisions (closes spec open questions 1–2)

**Typed DB: Drizzle ORM over `bun:sqlite`, wrapped in thin Effect services.**

- Chosen: `drizzle-orm/bun-sqlite` (existing in-repo convention: `packages/jimeng-client/src/artifact-log.ts`, `packages/twitter-archive/src/sqlite-store.ts`). Clear generated types, widely-known API — weaker lanes (Kimi) write correct queries against it.
- Rejected: `@effect/sql` / `@effect/sql-sqlite-bun`. It exists for Effect v4 (`4.0.0-beta.x`) but is beta-churning, has zero in-repo precedent, and its service/resolver plumbing is exactly where weak models err. Revisit only if Drizzle's Effect integration becomes a friction source.
- Effect stays at the service boundary: store operations are Effect functions with `Schema` decoding at ingestion boundaries and `TaggedErrorClass` errors (`StorageError`, `ArtifactError`). Drizzle is an implementation detail inside `packages/control-plane`; it never leaks into consumer signatures.

**Package: new `packages/control-plane`** (`@wirebabel/control-plane`). Self-contained per repo rules (own package.json/scripts/deps; no root package.json edits). `packages/web-access/src/agent-cockpit*` is donor *concepts* only — its sqlite3-CLI-subprocess querying is explicitly not carried forward.

## Layout

```
packages/control-plane/
  package.json          # private, type module, exports ./src/index.ts
  tsconfig.json         # mirror primer-daemon; bun-types
  src/
    schema.ts           # Drizzle table definitions (all 9 row families)
    migrate.ts          # migration runner: user_version-gated, idempotent
    ledger.ts           # LedgerStore: open/close + typed write/query ops
    errors.ts           # TaggedErrorClass: StorageError, ArtifactError
    telemetry.ts        # (P3) Effect instrumentation: withModelCall etc.
    cli.ts              # (P5) Effect CLI: status/model-calls/events --json
    index.ts            # public exports
  test/                 # bun test; fixtures under test/.tmp (repo-local, NOT os.tmpdir)
```

DB location: every API takes explicit `dbPath`; `defaultLedgerPath()` = `$AGENT_CONTROL_PLANE_DB` else `~/.agent-control-plane/ledger.sqlite`. WAL mode on open.

## Schema contract (migration 0001 creates all families)

Column types: ids/enums/hashes TEXT, timestamps INTEGER ms UTC, counts/costs INTEGER/REAL, JSON payloads TEXT. Open-union columns (`status`, `kind`, `yieldKind`, `outcome`, `harness`) are plain TEXT — **no CHECK constraints**; unknown values must round-trip.

- `sessions`: id PK, machine, harness, workspace, title, status, createdAt, updatedAt, meta JSON
- `branches`: id PK, sessionId, parentBranchId?, kind (root|fork|resume|modelSwap|contextVariant|…), atTurn?, createdAt, meta JSON
- `turns`: id PK, sessionId, branchId, seq, startedAt, endedAt?, contextTokens, toolCalls, toolCallSummary? JSON, editBytes, turnDurationMs, yieldKind, affectSelfReport?, affectSignals? JSON
- `events`: id PK, ts, sessionId?, branchId?, packetId?, kind, payloadVersion, payload JSON — payload preserved verbatim, unknown kinds included
- `model_calls`: id PK + exactly the spec v1 required columns (ts, machine, session, branchId, agent, model, provider, effort, promptHash, systemPromptHash, skillProfile, contextManifest, packetId, tokensIn, tokensOut, cacheRead, cacheWrite, cost, latencyMs, outcome, errorClass?, retryOf?, fallbackFrom?, rawRequestArtifact, rawResponseArtifact)
- `provider_calls`: id PK, ts, sessionId, branchId?, packetId?, provider, operation, inputHash, rawRequestArtifact?, latencyMs, outcome, errorClass?, cost?, usage? JSON
- `artifacts`: id PK, ts, sessionId?, kind, contentPath?, contentInline?, sha256, bytes, retention, meta JSON — exactly one of contentPath/contentInline set
- `packets`: id PK, title, lane, status, priority?, summary?, sourcePointer?, ownerPaths JSON, excludedPaths JSON, dirtyPaths? JSON, workerSessionId?, reviewerSessionId?, branchId?, proofLinks? JSON, createdAt, updatedAt, claimedAt?, reviewReadyAt?, doneAt?, staleAt?
- `commits`: sha PK, sessionId, agentId?, packetId?, ts

M1 write paths required for: sessions, branches, turns, events, model_calls, provider_calls, artifacts. packets/commits tables exist in schema (M3 fills them).

## LedgerStore API (the inter-packet contract)

Effect functions, `Effect.fn` style, failing with `StorageError`/`ArtifactError`:

- `openLedger(dbPath)` → scoped store (runs migrations); `LedgerStore` as Effect service Layer
- Writes: `upsertSession`, `recordBranch`, `recordTurn`, `publishEvent`, `recordModelCall`, `recordProviderCall`, `putArtifact(content | path, meta)` → artifact id
- Queries: `statusSummary()` (sessions by status + counts + last-activity), `listModelCalls(filters: {session?, model?, provider?, outcome?, sinceTs?, limit})`, `listEvents(filters)`, `getArtifact(id)`
- All query results are plain typed objects (Schema-validated at the boundary), JSON-serializable for CLI `--json` parity.

## M1 packets

- **P1 foundation**: scaffold + schema.ts + migrate.ts + ledger.ts + errors.ts + fixture test (synthetic session writing every row family; unknown-event-kind round-trip asserted).
- **S1 scout** (read-only, parallel with P1): map OMP fork seams for the publisher — extension discovery/loading, session lifecycle hooks, where per-call usage/cost/model/provider is observable, session/branch id semantics, JSONL artifact paths.
- **P3 instrumentation** (after P1): `telemetry.ts` — `withModelCall(meta)(effect)` measures latency, classifies outcome (`ok|error|refusal|contentFilter|abort`), writes raw request/response artifacts + model_call row; same pattern for provider calls. Custom Effect-native; NOT OTLP.
- **P4 OMP publisher** (after P1+S1): extension in the fork per S1's findings, writing sessions/turns/model_calls/events rows from a live session via `@wirebabel/control-plane`.
- **P5 CLI** (after P1): Effect CLI — `control-plane status --json`, `model-calls --json` (+ `--session --model --outcome --since --limit`), `events --json`. Bounded output.

## Acceptance proof (spec M1)

Fixture or live-session run producing queryable rows; CLI showing model/provider/tokens/cost/latency/outcome/contextManifest and raw-request artifact linkage:

```
cd packages/control-plane && bun run check
bun src/cli.ts status --json --db test/.tmp/fixture.sqlite
bun src/cli.ts model-calls --json --db test/.tmp/fixture.sqlite
```

## Constraints for workers

- Tests use repo-local `test/.tmp/` fixture dirs (subagent sandbox blocks os.tmpdir SQLite writes); coordinator runs the gate.
- No root package.json edits; no formatters; no project-wide gates.
- No `any`/`unknown` outside typed boundary modules; raw JSON enters through Effect Schema only.
