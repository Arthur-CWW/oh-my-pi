import { Database } from "bun:sqlite"

import { Effect } from "effect"

import { StorageError } from "./errors"

const DEFAULT_LIMIT = 50
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1_000

export interface OperationalQueryOptions {
  readonly asOf?: number
  readonly staleAfterMs?: number
  readonly limit?: number
}

export interface OperationalSessionDto {
  readonly sessionId: string
  readonly buildDigests: readonly string[]
  readonly runnerInstanceIds: readonly string[]
  readonly lastOccurredAt: number
  readonly lastObservedAt: number
  readonly routeCount: number
  readonly diagnosticCount: number
  readonly canaryCount: number
  readonly releaseCount: number
  readonly asOf: number
  readonly lagMs: number
  readonly stale: boolean
  readonly gap: boolean
  readonly missingLinks: readonly string[]
}

export interface OperationalRouteDto {
  readonly routeResolutionId: string
  readonly sourceSessionId: string
  readonly agentId: string
  readonly agentSeq: number
  readonly lane: string
  readonly provider: string
  readonly model: string
  readonly accountKind: string
  readonly accountRef: string | null
  readonly effort: string
  readonly changeKind: string
  readonly occurredAt: number
  readonly candidateCount: number
  readonly advisorCount: number
  readonly artifactCount: number
  readonly modelCallCount: number
  readonly asOf: number
  readonly lagMs: number
  readonly stale: boolean
  readonly gap: boolean
  readonly missingLinks: readonly string[]
}

export interface OperationalDiagnosticDto {
  readonly diagnosticId: string
  readonly sessionId: string | null
  readonly runnerInstanceId: string | null
  readonly buildDigest: string | null
  readonly failureClass: string
  readonly phase: string
  readonly message: string
  readonly occurredAt: number
  readonly projectionState: string | null
  readonly projectionOccurredAt: number | null
  readonly artifactCount: number
  readonly asOf: number
  readonly lagMs: number
  readonly stale: boolean
  readonly gap: boolean
  readonly missingLinks: readonly string[]
}

export interface OperationalCanaryDto {
  readonly canaryRunId: string
  readonly receiptDigest: string
  readonly buildDigest: string
  readonly version: string
  readonly runnerInstanceId: string
  readonly fixtureSessionId: string
  readonly commandId: string
  readonly startedAt: number
  readonly stoppedAt: number
  readonly artifactId: string
  readonly releasePromotionIds: readonly string[]
  readonly registryObservationIds: readonly string[]
  readonly asOf: number
  readonly lagMs: number
  readonly stale: boolean
  readonly gap: boolean
  readonly missingLinks: readonly string[]
  readonly mismatches: readonly string[]
}

export interface OperationalReleaseDto {
  readonly promotionId: string
  readonly operation: string
  readonly occurredAt: number
  readonly fromBuildDigest: string | null
  readonly toBuildDigest: string
  readonly receiptDigest: string | null
  readonly registryBeforeDigest: string
  readonly registryAfterDigest: string
  readonly transactionArtifactId: string
  readonly canaryRunId: string | null
  readonly registryObservationId: string | null
  readonly observedStableBuildDigest: string | null
  readonly observedPreviousBuildDigest: string | null
  readonly observedCandidateBuildDigest: string | null
  readonly observedReceiptDigest: string | null
  readonly asOf: number
  readonly lagMs: number
  readonly stale: boolean
  readonly gap: boolean
  readonly missingLinks: readonly string[]
  readonly mismatches: readonly string[]
}

interface QueryRuntime {
  readonly asOf: number
  readonly staleAfterMs: number
  readonly limit: number
}

interface SourceHealth {
  readonly lastObservedAt: number | null
  readonly gap: boolean
}

interface SessionRow {
  readonly sessionId: string
  readonly lastOccurredAt: number
  readonly lastObservedAt: number
  readonly buildDigests: string | null
  readonly runnerInstanceIds: string | null
}

interface RouteRow {
  readonly routeResolutionId: string
  readonly sourceSessionId: string
  readonly agentId: string
  readonly agentSeq: number
  readonly lane: string
  readonly provider: string
  readonly model: string
  readonly accountKind: string
  readonly accountRef: string | null
  readonly effort: string
  readonly changeKind: string
  readonly occurredAt: number
  readonly candidateCount: number
  readonly advisorCount: number
  readonly artifactCount: number
  readonly modelCallCount: number
}

interface DiagnosticRow {
  readonly diagnosticId: string
  readonly sessionId: string | null
  readonly runnerInstanceId: string | null
  readonly buildDigest: string | null
  readonly failureClass: string
  readonly phase: string
  readonly message: string
  readonly occurredAt: number
  readonly projectionState: string | null
  readonly projectionOccurredAt: number | null
  readonly artifactCount: number
}

interface CanaryRow {
  readonly canaryRunId: string
  readonly receiptDigest: string
  readonly buildDigest: string
  readonly version: string
  readonly runnerInstanceId: string
  readonly fixtureSessionId: string
  readonly commandId: string
  readonly startedAt: number
  readonly stoppedAt: number
  readonly artifactId: string
  readonly artifactSha256: string | null
  readonly releasePromotionIds: string | null
  readonly registryObservationIds: string | null
}

interface ReleaseRow {
  readonly promotionId: string
  readonly operation: string
  readonly occurredAt: number
  readonly fromBuildDigest: string | null
  readonly toBuildDigest: string
  readonly receiptDigest: string | null
  readonly registryBeforeDigest: string
  readonly registryAfterDigest: string
  readonly transactionArtifactId: string
  readonly transactionArtifactSha256: string | null
  readonly canaryRunId: string | null
  readonly registryObservationId: string | null
  readonly observedStableBuildDigest: string | null
  readonly observedPreviousBuildDigest: string | null
  readonly observedCandidateBuildDigest: string | null
  readonly observedReceiptDigest: string | null
}

export function queryOperationalSessions(dbPath: string, options: OperationalQueryOptions = {}): Effect.Effect<readonly OperationalSessionDto[], StorageError> {
  return storageEffect("queryOperationalSessions", () => withDb(dbPath, (sqlite) => {
    const runtime = queryRuntime(options)
    const rows = sqlite.query<SessionRow, [number]>(`
      SELECT
        sessionId,
        MAX(occurredAt) AS lastOccurredAt,
        MAX(observedAt) AS lastObservedAt,
        GROUP_CONCAT(DISTINCT buildDigest) AS buildDigests,
        GROUP_CONCAT(DISTINCT runnerInstanceId) AS runnerInstanceIds
      FROM operational_events
      WHERE sessionId IS NOT NULL
      GROUP BY sessionId
      ORDER BY lastObservedAt DESC, sessionId ASC
      LIMIT ?
    `).all(runtime.limit)
    return rows.map((row) => {
      const source = sourceHealth(sqlite, row.sessionId)
      const lagMs = runtime.asOf - Math.max(row.lastObservedAt, source.lastObservedAt ?? row.lastObservedAt)
      const missingLinks = [] as string[]
      if (sqlite.query<{ exists: number }, [string]>("SELECT 1 AS exists FROM sessions WHERE id = ? LIMIT 1").get(row.sessionId) == null) {
        missingLinks.push(`sessions:${row.sessionId}`)
      }
      return {
        sessionId: row.sessionId,
        buildDigests: splitList(row.buildDigests),
        runnerInstanceIds: splitList(row.runnerInstanceIds),
        lastOccurredAt: row.lastOccurredAt,
        lastObservedAt: row.lastObservedAt,
        routeCount: scalarCount(sqlite, "SELECT COUNT(*) AS count FROM route_resolutions WHERE sourceSessionId = ?", row.sessionId),
        diagnosticCount: scalarCount(sqlite, "SELECT COUNT(*) AS count FROM diagnostic_occurrences WHERE sessionId = ?", row.sessionId),
        canaryCount: scalarCount(sqlite, "SELECT COUNT(*) AS count FROM canary_runs WHERE fixtureSessionId = ?", row.sessionId),
        releaseCount: scalarCount(sqlite, "SELECT COUNT(*) AS count FROM release_transactions WHERE receiptDigest IN (SELECT receiptDigest FROM canary_runs WHERE fixtureSessionId = ?)", row.sessionId),
        asOf: runtime.asOf,
        lagMs,
        stale: lagMs > runtime.staleAfterMs,
        gap: source.gap,
        missingLinks,
      } satisfies OperationalSessionDto
    })
  }))
}

export function queryOperationalRoutes(dbPath: string, options: OperationalQueryOptions = {}): Effect.Effect<readonly OperationalRouteDto[], StorageError> {
  return storageEffect("queryOperationalRoutes", () => withDb(dbPath, (sqlite) => {
    const runtime = queryRuntime(options)
    const rows = sqlite.query<RouteRow, [number]>(`
      SELECT
        r.id AS routeResolutionId,
        r.sourceSessionId,
        r.agentId,
        r.agentSeq,
        r.lane,
        r.provider,
        r.model,
        r.accountKind,
        r.accountRef,
        r.effort,
        r.changeKind,
        r.ts AS occurredAt,
        (SELECT COUNT(*) FROM route_candidates c WHERE c.routeResolutionId = r.id) AS candidateCount,
        (SELECT COUNT(*) FROM route_advisors a WHERE a.routeResolutionId = r.id) AS advisorCount,
        (SELECT COUNT(*) FROM route_event_artifacts x WHERE x.ownerKind = 'routeResolution' AND x.ownerId = r.id) AS artifactCount,
        (SELECT COUNT(*) FROM model_calls m WHERE m.routeResolutionId = r.id) AS modelCallCount
      FROM route_resolutions r
      ORDER BY r.ts DESC, r.id ASC
      LIMIT ?
    `).all(runtime.limit)
    return rows.map((row) => {
      const source = sourceHealth(sqlite, row.sourceSessionId)
      const lagMs = runtime.asOf - Math.max(row.occurredAt, source.lastObservedAt ?? row.occurredAt)
      const missingLinks = [] as string[]
      if (row.candidateCount === 0) missingLinks.push(`routeCandidates:${row.routeResolutionId}`)
      if (row.modelCallCount === 0) missingLinks.push(`modelCalls:${row.routeResolutionId}`)
      return {
        routeResolutionId: row.routeResolutionId,
        sourceSessionId: row.sourceSessionId,
        agentId: row.agentId,
        agentSeq: row.agentSeq,
        lane: row.lane,
        provider: row.provider,
        model: row.model,
        accountKind: row.accountKind,
        accountRef: row.accountRef,
        effort: row.effort,
        changeKind: row.changeKind,
        occurredAt: row.occurredAt,
        candidateCount: row.candidateCount,
        advisorCount: row.advisorCount,
        artifactCount: row.artifactCount,
        modelCallCount: row.modelCallCount,
        asOf: runtime.asOf,
        lagMs,
        stale: lagMs > runtime.staleAfterMs,
        gap: source.gap,
        missingLinks,
      } satisfies OperationalRouteDto
    })
  }))
}

export function queryOperationalDiagnostics(dbPath: string, options: OperationalQueryOptions = {}): Effect.Effect<readonly OperationalDiagnosticDto[], StorageError> {
  return storageEffect("queryOperationalDiagnostics", () => withDb(dbPath, (sqlite) => {
    const runtime = queryRuntime(options)
    const rows = sqlite.query<DiagnosticRow, [number]>(`
      SELECT
        d.diagnosticId,
        d.sessionId,
        d.runnerInstanceId,
        d.buildDigest,
        d.failureClass,
        d.phase,
        d.message,
        d.occurredAt,
        (
          SELECT p.state
          FROM diagnostic_projection_events p
          WHERE p.diagnosticId = d.diagnosticId
          ORDER BY p.occurredAt DESC, p.projectionEventId DESC
          LIMIT 1
        ) AS projectionState,
        (
          SELECT p.occurredAt
          FROM diagnostic_projection_events p
          WHERE p.diagnosticId = d.diagnosticId
          ORDER BY p.occurredAt DESC, p.projectionEventId DESC
          LIMIT 1
        ) AS projectionOccurredAt,
        (SELECT COUNT(*) FROM diagnostic_artifacts a WHERE a.diagnosticId = d.diagnosticId) AS artifactCount
      FROM diagnostic_occurrences d
      ORDER BY d.occurredAt DESC, d.diagnosticId ASC
      LIMIT ?
    `).all(runtime.limit)
    return rows.map((row) => {
      const source = row.sessionId === null ? { lastObservedAt: null, gap: false } : sourceHealth(sqlite, row.sessionId)
      const referenceTime = row.projectionOccurredAt ?? row.occurredAt
      const lagMs = runtime.asOf - Math.max(referenceTime, source.lastObservedAt ?? referenceTime)
      const missingLinks = [] as string[]
      if (row.artifactCount === 0) missingLinks.push(`diagnosticArtifacts:${row.diagnosticId}`)
      if (row.projectionState === null) missingLinks.push(`diagnosticProjection:${row.diagnosticId}`)
      return {
        diagnosticId: row.diagnosticId,
        sessionId: row.sessionId,
        runnerInstanceId: row.runnerInstanceId,
        buildDigest: row.buildDigest,
        failureClass: row.failureClass,
        phase: row.phase,
        message: row.message,
        occurredAt: row.occurredAt,
        projectionState: row.projectionState,
        projectionOccurredAt: row.projectionOccurredAt,
        artifactCount: row.artifactCount,
        asOf: runtime.asOf,
        lagMs,
        stale: lagMs > runtime.staleAfterMs,
        gap: source.gap,
        missingLinks,
      } satisfies OperationalDiagnosticDto
    })
  }))
}

export function queryOperationalCanaries(dbPath: string, options: OperationalQueryOptions = {}): Effect.Effect<readonly OperationalCanaryDto[], StorageError> {
  return storageEffect("queryOperationalCanaries", () => withDb(dbPath, (sqlite) => {
    const runtime = queryRuntime(options)
    const rows = sqlite.query<CanaryRow, [number]>(`
      SELECT
        c.canaryRunId,
        c.receiptDigest,
        c.buildDigest,
        c.version,
        c.runnerInstanceId,
        c.fixtureSessionId,
        c.commandId,
        c.startedAt,
        c.stoppedAt,
        c.artifactId,
        a.sha256 AS artifactSha256,
        (SELECT GROUP_CONCAT(promotionId) FROM release_transactions r WHERE r.receiptDigest = c.receiptDigest) AS releasePromotionIds,
        (SELECT GROUP_CONCAT(observationId) FROM release_registry_observations o WHERE o.receiptDigest = c.receiptDigest) AS registryObservationIds
      FROM canary_runs c
      LEFT JOIN artifacts a ON a.id = c.artifactId
      ORDER BY c.stoppedAt DESC, c.canaryRunId ASC
      LIMIT ?
    `).all(runtime.limit)
    return rows.map((row) => {
      const lagMs = runtime.asOf - row.stoppedAt
      const missingLinks = [] as string[]
      const mismatches = [] as string[]
      if (row.artifactSha256 === null) missingLinks.push(`artifacts:${row.artifactId}`)
      if (splitList(row.releasePromotionIds).length === 0) missingLinks.push(`releaseTransactions:${row.receiptDigest}`)
      if (splitList(row.registryObservationIds).length === 0) missingLinks.push(`releaseRegistry:${row.receiptDigest}`)
      if (row.artifactSha256 !== null && row.artifactSha256 !== row.receiptDigest) mismatches.push(`artifactDigest:${row.artifactSha256}`)
      return {
        canaryRunId: row.canaryRunId,
        receiptDigest: row.receiptDigest,
        buildDigest: row.buildDigest,
        version: row.version,
        runnerInstanceId: row.runnerInstanceId,
        fixtureSessionId: row.fixtureSessionId,
        commandId: row.commandId,
        startedAt: row.startedAt,
        stoppedAt: row.stoppedAt,
        artifactId: row.artifactId,
        releasePromotionIds: splitList(row.releasePromotionIds),
        registryObservationIds: splitList(row.registryObservationIds),
        asOf: runtime.asOf,
        lagMs,
        stale: lagMs > runtime.staleAfterMs,
        gap: false,
        missingLinks,
        mismatches,
      } satisfies OperationalCanaryDto
    })
  }))
}

export function queryOperationalReleases(dbPath: string, options: OperationalQueryOptions = {}): Effect.Effect<readonly OperationalReleaseDto[], StorageError> {
  return storageEffect("queryOperationalReleases", () => withDb(dbPath, (sqlite) => {
    const runtime = queryRuntime(options)
    const rows = sqlite.query<ReleaseRow, [number]>(`
      SELECT
        r.promotionId,
        r.operation,
        r.occurredAt,
        r.fromBuildDigest,
        r.toBuildDigest,
        r.receiptDigest,
        r.registryBeforeDigest,
        r.registryAfterDigest,
        r.transactionArtifactId,
        a.sha256 AS transactionArtifactSha256,
        c.canaryRunId,
        o.observationId AS registryObservationId,
        o.stableBuildDigest AS observedStableBuildDigest,
        o.previousBuildDigest AS observedPreviousBuildDigest,
        o.candidateBuildDigest AS observedCandidateBuildDigest,
        o.receiptDigest AS observedReceiptDigest
      FROM release_transactions r
      LEFT JOIN artifacts a ON a.id = r.transactionArtifactId
      LEFT JOIN canary_runs c ON c.receiptDigest = r.receiptDigest
      LEFT JOIN release_registry_observations o ON o.sourceDigest = r.registryAfterDigest
      ORDER BY r.occurredAt DESC, r.promotionId ASC
      LIMIT ?
    `).all(runtime.limit)
    return rows.map((row) => {
      const lagMs = runtime.asOf - row.occurredAt
      const missingLinks = [] as string[]
      const mismatches = [] as string[]
      if (row.transactionArtifactSha256 === null) missingLinks.push(`artifacts:${row.transactionArtifactId}`)
      if (row.canaryRunId === null && row.receiptDigest !== null) missingLinks.push(`canaryRuns:${row.receiptDigest}`)
      if (row.registryObservationId === null) missingLinks.push(`releaseRegistry:${row.registryAfterDigest}`)
      if (row.transactionArtifactSha256 !== null && !artifactIdMatchesDigest(row.transactionArtifactId, row.transactionArtifactSha256)) {
        mismatches.push(`transactionArtifact:${row.transactionArtifactId}`)
      }
      if (row.registryObservationId !== null) {
        if (row.operation === "bless" && row.observedStableBuildDigest !== row.toBuildDigest) {
          mismatches.push(`stableBuildDigest:${row.observedStableBuildDigest ?? "null"}`)
        }
        if (row.operation === "rollback" && row.observedStableBuildDigest !== row.toBuildDigest) {
          mismatches.push(`rollbackStable:${row.observedStableBuildDigest ?? "null"}`)
        }
        if ((row.receiptDigest ?? null) !== (row.observedReceiptDigest ?? null)) {
          mismatches.push(`receiptDigest:${row.observedReceiptDigest ?? "null"}`)
        }
        if (row.operation === "bless" && row.observedCandidateBuildDigest !== null) {
          mismatches.push(`candidateBuildDigest:${row.observedCandidateBuildDigest}`)
        }
      }
      return {
        promotionId: row.promotionId,
        operation: row.operation,
        occurredAt: row.occurredAt,
        fromBuildDigest: row.fromBuildDigest,
        toBuildDigest: row.toBuildDigest,
        receiptDigest: row.receiptDigest,
        registryBeforeDigest: row.registryBeforeDigest,
        registryAfterDigest: row.registryAfterDigest,
        transactionArtifactId: row.transactionArtifactId,
        canaryRunId: row.canaryRunId,
        registryObservationId: row.registryObservationId,
        observedStableBuildDigest: row.observedStableBuildDigest,
        observedPreviousBuildDigest: row.observedPreviousBuildDigest,
        observedCandidateBuildDigest: row.observedCandidateBuildDigest,
        observedReceiptDigest: row.observedReceiptDigest,
        asOf: runtime.asOf,
        lagMs,
        stale: lagMs > runtime.staleAfterMs,
        gap: false,
        missingLinks,
        mismatches,
      } satisfies OperationalReleaseDto
    })
  }))
}

function sourceHealth(sqlite: Database, sessionId: string): SourceHealth {
  const row = sqlite.query<{ lastObservedAt: number; status: string }, [string]>(
    "SELECT lastObservedAt, status FROM operational_sources WHERE sourceKind = 'outbox' AND sourceId = ?",
  ).get(sessionId)
  return row == null ? { lastObservedAt: null, gap: false } : { lastObservedAt: row.lastObservedAt, gap: row.status === "gap" }
}

function scalarCount(sqlite: Database, sql: string, value: string): number {
  return sqlite.query<{ count: number }, [string]>(sql).get(value)?.count ?? 0
}

function splitList(value: string | null): readonly string[] {
  return value === null || value.length === 0 ? [] : value.split(",")
}

function queryRuntime(options: OperationalQueryOptions): QueryRuntime {
  return {
    asOf: options.asOf ?? Date.now(),
    staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    limit: Math.max(1, options.limit ?? DEFAULT_LIMIT),
  }
}

function withDb<T>(dbPath: string, fn: (sqlite: Database) => T): T {
  const sqlite = new Database(dbPath, { readonly: true, create: false })
  try {
    const schemaVersion = sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0
    if (schemaVersion < 10) {
      throw new Error(`Operational ledger schema version ${schemaVersion} is older than required version 10`)
    }
    return fn(sqlite)
  } finally {
    sqlite.close()
  }
}

function artifactIdMatchesDigest(artifactId: string, digest: string): boolean {
  const expected = artifactId.startsWith("artifact_")
    ? artifactId.slice("artifact_".length)
    : artifactId.startsWith("sha256:")
      ? artifactId.slice("sha256:".length)
      : artifactId
  return expected.length >= 16 && expected.length <= digest.length && /^[a-f0-9]+$/i.test(expected) && digest.startsWith(expected)
}

function storageEffect<A>(operation: string, run: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({
    try: run,
    catch: (cause) => new StorageError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause: cause instanceof Error ? cause.message : String(cause),
    }),
  })
}
