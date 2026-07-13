import { createHash } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { ingestOutbox } from "../src/ingest"
import { appendOutboxLine, type JsonValue, type OutboxEnvelope } from "../src/outbox"
import { openLedger } from "../src/ledger"

const tmpDir = join(import.meta.dir, ".tmp", "operational-ingest")
const sessionId = "session-operational"

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("operational ingest preserves duplicates, gaps, and unknown payload versions", async () => {
  const dbPath = join(tmpDir, "duplicate-gap.sqlite")
  const outboxPath = join(tmpDir, "duplicate-gap.jsonl")

  appendOutboxLine(outboxPath, envelope(0, "runnerEvent", runnerEventPayload("runner-event-0", 0)))
  appendOutboxLine(outboxPath, envelope(0, "runnerEvent", runnerEventPayload("runner-event-0", 0)))
  appendOutboxLine(outboxPath, envelope(2, "runnerEvent", { payloadVersion: 2, future: true, nested: { ok: true } }))
  appendOutboxLine(outboxPath, envelope(3, "runnerEvent", runnerEventPayload("runner-event-3", 3)))

  await Effect.runPromise(ingestOutbox(outboxPath).pipe(Effect.provide(openLedger(dbPath))))

  const sqlite = new Database(dbPath)
  try {
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM operational_events").get()?.count).toBe(2)
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM events WHERE kind = 'runnerEvent'").get()?.count).toBe(1)
    const generic = sqlite.query<{ payload: string }, []>("SELECT payload FROM events WHERE kind = 'runnerEvent'").get()
    expect(generic?.payload).toContain('"payloadVersion":2')
    const source = sqlite.query<{ lastSourceSequence: number; gapFromSequence: number | null; gapToSequence: number | null; status: string }, [string]>("SELECT lastSourceSequence, gapFromSequence, gapToSequence, status FROM operational_sources WHERE sourceKind = 'outbox' AND sourceId = ?").get(sessionId)
    expect(source).toEqual({ lastSourceSequence: 3, gapFromSequence: 1, gapToSequence: 2, status: "gap" })
  } finally {
    sqlite.close()
  }
})

test("operational gaps close after out-of-order fill and remain closed after reopen", async () => {
  const dbPath = join(tmpDir, "gap-fill.sqlite")
  const firstOutbox = join(tmpDir, "gap-fill-first.jsonl")
  const fillOutbox = join(tmpDir, "gap-fill-second.jsonl")
  appendOutboxLine(firstOutbox, envelope(2, "runnerEvent", runnerEventPayload("gap-event-2", 2)))
  await Effect.runPromise(ingestOutbox(firstOutbox).pipe(Effect.provide(openLedger(dbPath))))
  const initial = new Database(dbPath, { readonly: true })
  try {
    expect(initial.query<{ gapFromSequence: number | null; gapToSequence: number | null; status: string }, [string]>(
      "SELECT gapFromSequence, gapToSequence, status FROM operational_sources WHERE sourceKind = 'outbox' AND sourceId = ?",
    ).get(sessionId)).toEqual({ gapFromSequence: 0, gapToSequence: 1, status: "gap" })
  } finally {
    initial.close()
  }
  appendOutboxLine(fillOutbox, envelope(0, "runnerEvent", runnerEventPayload("gap-event-0", 0)))
  appendOutboxLine(fillOutbox, envelope(1, "runnerEvent", runnerEventPayload("gap-event-1", 1)))
  await Effect.runPromise(ingestOutbox(fillOutbox).pipe(Effect.provide(openLedger(dbPath))))

  const sqlite = new Database(dbPath, { readonly: true })
  try {
    expect(sqlite.query<{ gapFromSequence: number | null; gapToSequence: number | null; status: string }, [string]>(
      "SELECT gapFromSequence, gapToSequence, status FROM operational_sources WHERE sourceKind = 'outbox' AND sourceId = ?",
    ).get(sessionId)).toEqual({ gapFromSequence: null, gapToSequence: null, status: "ok" })
  } finally {
    sqlite.close()
  }
})

test("operational conflicts are fatal and rollback the whole batch", async () => {
  const dbPath = join(tmpDir, "conflict.sqlite")
  const outboxPath = join(tmpDir, "conflict.jsonl")

  appendOutboxLine(outboxPath, envelope(0, "runnerEvent", runnerEventPayload("runner-event-conflict", 0)))
  const conflictingRunner = runnerEventPayload("runner-event-conflict", 1) as Record<string, JsonValue>
  appendOutboxLine(outboxPath, envelope(1, "runnerEvent", {
    ...conflictingRunner,
    detail: { changed: true },
  }))

  await expect(Effect.runPromise(ingestOutbox(outboxPath).pipe(Effect.provide(openLedger(dbPath))))).rejects.toThrow("Operational event idempotency conflict")

  const sqlite = new Database(dbPath)
  try {
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM operational_events").get()?.count).toBe(0)
    expect(sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM operational_sources").get()?.count).toBe(0)
  } finally {
    sqlite.close()
  }
})

test("diagnostic derived-row failures roll back and recurrences stay distinct while projections fold", async () => {
  const rollbackDbPath = join(tmpDir, "diagnostic-rollback.sqlite")
  const rollbackOutboxPath = join(tmpDir, "diagnostic-rollback.jsonl")
  const artifactContent = JSON.stringify({ token: "redacted" })
  const artifactSha = sha256(artifactContent)
  const artifactId = `artifact_${artifactSha.slice(0, 32)}`

  appendOutboxLine(rollbackOutboxPath, envelope(0, "artifact", {
    content: artifactContent,
    kind: "diagnosticEvidence",
    retention: "keep",
    meta: "{}",
  }))
  appendOutboxLine(rollbackOutboxPath, envelope(1, "diagnosticOccurrence", diagnosticOccurrencePayload({
    diagnosticId: "diag-rollback",
    occurredAt: 10_001,
    regressionId: "reg-rollback",
    artifacts: [{ role: "stderr", artifactId, sha256: "0".repeat(64), redactionPolicyId: "policy-v1" }],
  })))

  await expect(Effect.runPromise(ingestOutbox(rollbackOutboxPath).pipe(Effect.provide(openLedger(rollbackDbPath))))).rejects.toThrow("Diagnostic artifact digest mismatch")

  const rollbackSqlite = new Database(rollbackDbPath)
  try {
    expect(rollbackSqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM artifacts").get()?.count).toBe(0)
    expect(rollbackSqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM diagnostic_occurrences").get()?.count).toBe(0)
    expect(rollbackSqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM operational_events").get()?.count).toBe(0)
  } finally {
    rollbackSqlite.close()
  }

  const recurrenceDbPath = join(tmpDir, "diagnostic-recurrence.sqlite")
  const recurrenceOutboxPath = join(tmpDir, "diagnostic-recurrence.jsonl")

  appendOutboxLine(recurrenceOutboxPath, envelope(0, "artifact", {
    content: artifactContent,
    kind: "diagnosticEvidence",
    retention: "keep",
    meta: "{}",
  }))
  appendOutboxLine(recurrenceOutboxPath, envelope(1, "diagnosticOccurrence", diagnosticOccurrencePayload({
    diagnosticId: "diag-1",
    occurredAt: 10_001,
    regressionId: "reg-shared",
    artifacts: [{ role: "stderr", artifactId, sha256: artifactSha, redactionPolicyId: "policy-v1" }],
  })))
  appendOutboxLine(recurrenceOutboxPath, envelope(2, "diagnosticProjection", diagnosticProjectionPayload("proj-1", "diag-1", 10_002, "unread", "entry-1")))
  appendOutboxLine(recurrenceOutboxPath, envelope(3, "diagnosticProjection", diagnosticProjectionPayload("proj-2", "diag-1", 10_003, "resolved", "entry-2")))
  appendOutboxLine(recurrenceOutboxPath, envelope(4, "diagnosticOccurrence", diagnosticOccurrencePayload({
    diagnosticId: "diag-2",
    occurredAt: 10_004,
    regressionId: "reg-shared",
    artifacts: [{ role: "stderr", artifactId, sha256: artifactSha, redactionPolicyId: "policy-v1" }],
  })))
  appendOutboxLine(recurrenceOutboxPath, envelope(5, "diagnosticProjection", diagnosticProjectionPayload("proj-3", "diag-2", 10_005, "unread", "entry-3")))
  appendOutboxLine(recurrenceOutboxPath, envelope(6, "diagnosticProjection", diagnosticProjectionPayload("proj-4", "diag-2", 10_006, "reopened", "entry-4")))

  await Effect.runPromise(ingestOutbox(recurrenceOutboxPath).pipe(Effect.provide(openLedger(recurrenceDbPath))))

  const recurrenceSqlite = new Database(recurrenceDbPath)
  try {
    const occurrences = recurrenceSqlite.query<{ diagnosticId: string; regressionId: string | null }, []>("SELECT diagnosticId, regressionId FROM diagnostic_occurrences ORDER BY occurredAt").all()
    expect(occurrences).toEqual([
      { diagnosticId: "diag-1", regressionId: "reg-shared" },
      { diagnosticId: "diag-2", regressionId: "reg-shared" },
    ])
    expect(recurrenceSqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM diagnostic_artifacts WHERE diagnosticId IN ('diag-1', 'diag-2')").get()?.count).toBe(2)

    const projectionRows = recurrenceSqlite.query<{ diagnosticId: string; occurredAt: number; state: string }, []>("SELECT diagnosticId, occurredAt, state FROM diagnostic_projection_events ORDER BY occurredAt").all()
    const folded = projectionRows.reduce<Record<string, string>>((acc, row) => {
      acc[row.diagnosticId] = row.state
      return acc
    }, {})
    expect(folded).toEqual({ "diag-1": "resolved", "diag-2": "reopened" })
  } finally {
    recurrenceSqlite.close()
  }
})

function envelope(seq: number, kind: string, payload: JsonValue): OutboxEnvelope {
  return {
    v: 1,
    kind,
    sessionId,
    seq,
    ts: 10_000 + seq,
    payload,
  }
}

function runnerEventPayload(eventId: string, revision: number): JsonValue {
  return {
    payloadVersion: 1,
    runnerIdentity: {
      buildRevision: { digest: "a".repeat(64), version: "1.0.0" },
      runnerInstance: { runnerInstanceId: "runner-1", startedAt: 9_000 },
    },
    sessionId,
    ownerEpoch: "owner-1",
    kind: "command_applied",
    eventId,
    commandId: "command-1",
    correlationId: `corr-${revision}`,
    causationId: null,
    revision,
    sequence: revision,
    sessionRevision: null,
    controllerEpoch: 1,
    viewId: null,
    inputId: null,
    durableSequence: null,
    attemptId: null,
    routeResolutionId: null,
    quotaDecisionId: null,
    toolCallId: null,
    transcriptEntryId: null,
    transcriptLeafId: null,
    transcriptPosition: null,
    targetGeneration: null,
    targetCommandId: null,
    targetOperationGeneration: null,
    detail: { revision },
  }
}

function diagnosticOccurrencePayload(input: {
  diagnosticId: string
  occurredAt: number
  regressionId: string
  artifacts: readonly { role: string; artifactId: string; sha256: string; redactionPolicyId: string }[]
}): JsonValue {
  return {
    payloadVersion: 1,
    diagnosticId: input.diagnosticId,
    occurredAt: input.occurredAt,
    failureClass: "transport",
    phase: "request",
    message: "provider failed",
    requestFingerprint: "b".repeat(64),
    buildDigest: "a".repeat(64),
    runnerInstanceId: "runner-1",
    runtimeIdentity: "runtime-1",
    configHash: "c".repeat(64),
    manifestHash: "d".repeat(64),
    sessionId,
    branchId: null,
    turnId: null,
    entryId: null,
    agentId: null,
    routeResolutionId: null,
    inputId: null,
    attemptId: null,
    ownerEpoch: "owner-1",
    explicitRoute: null,
    outcome: null,
    causeDiagnosticId: null,
    retryOfAttemptId: null,
    fallbackResolutionId: null,
    interventionCommandId: null,
    regressionId: input.regressionId,
    redactionPolicyId: "policy-v1",
    artifacts: input.artifacts,
  }
}

function diagnosticProjectionPayload(projectionEventId: string, diagnosticId: string, occurredAt: number, state: "unread" | "acknowledged" | "resolved" | "reopened", sourceEntryId: string): JsonValue {
  return {
    payloadVersion: 1,
    projectionEventId,
    diagnosticId,
    occurredAt,
    state,
    actor: null,
    commandId: null,
    sourceEntryId,
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
