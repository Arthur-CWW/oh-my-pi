import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"

import { Effect } from "effect"

import { StorageError } from "./errors"

export const REFUSAL_PROMPT_EXCERPT_MAX = 160
export const REFUSAL_PROVIDER_MESSAGE_MAX = 512
export const REFUSAL_REDACTION_POLICY = "refusal-v1"

export interface RefusalRecordInput {
  readonly timestamp: number
  readonly provider: string
  readonly model: string
  readonly role: string
  readonly category: string
  readonly tool?: string | null
  readonly action?: string | null
  readonly sessionId?: string | null
  readonly turnId?: string | null
  readonly correlationId?: string | null
  readonly prompt: string
  readonly providerCode?: string | null
  readonly providerMessage?: string | null
  readonly retryOutcome?: string | null
  readonly rerouteOutcome?: string | null
  readonly contextSources?: readonly string[]
}

export interface RefusalRecord {
  readonly refusalId: string
  readonly timestamp: number
  readonly provider: string
  readonly model: string
  readonly role: string
  readonly category: string
  readonly tool: string | null
  readonly action: string | null
  readonly sessionId: string | null
  readonly turnId: string | null
  readonly correlationId: string | null
  readonly promptFingerprint: string
  readonly promptExcerpt: string
  readonly providerCode: string | null
  readonly providerMessage: string | null
  readonly retryOutcome: string | null
  readonly rerouteOutcome: string | null
  readonly contextSources: readonly string[]
  readonly redactionPolicyId: typeof REFUSAL_REDACTION_POLICY
}

export type RefusalCountDimension = "model" | "category" | "tool" | "action"

export interface RefusalCount {
  readonly dimension: RefusalCountDimension
  readonly value: string | null
  readonly count: number
}

export interface RecentRefusalOptions {
  readonly limit?: number
  readonly since?: number
}

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]"],
  [/\b(?:sk|pk|rk|api|key)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]"],
  [/\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret)\s*[:=]\s*["']?[^\s,"'};]+/gi, "$1=[REDACTED]"],
]

export function redactRefusalText(value: string): string {
  let redacted = value
  for (const [pattern, replacement] of SECRET_PATTERNS) redacted = redacted.replace(pattern, replacement)
  return redacted
}

export function normalizeRefusalRecord(input: RefusalRecordInput, refusalId: string = randomUUID()): RefusalRecord {
  const redactedPrompt = redactRefusalText(input.prompt)
  return {
    refusalId,
    timestamp: input.timestamp,
    provider: input.provider,
    model: input.model,
    role: input.role,
    category: input.category,
    tool: input.tool ?? null,
    action: input.action ?? null,
    sessionId: input.sessionId ?? null,
    turnId: input.turnId ?? null,
    correlationId: input.correlationId ?? null,
    promptFingerprint: createHash("sha256").update(redactedPrompt).digest("hex"),
    promptExcerpt: cap(redactedPrompt, REFUSAL_PROMPT_EXCERPT_MAX),
    providerCode: input.providerCode === undefined || input.providerCode === null ? null : cap(redactRefusalText(input.providerCode), 128),
    providerMessage: input.providerMessage === undefined || input.providerMessage === null ? null : cap(redactRefusalText(input.providerMessage), REFUSAL_PROVIDER_MESSAGE_MAX),
    retryOutcome: input.retryOutcome ?? null,
    rerouteOutcome: input.rerouteOutcome ?? null,
    contextSources: (input.contextSources ?? []).map(redactContextSource),
    redactionPolicyId: REFUSAL_REDACTION_POLICY,
  }
}

export function insertRefusalRecord(dbPath: string, input: RefusalRecordInput): Effect.Effect<RefusalRecord, StorageError> {
  return storageEffect("insertRefusalRecord", () => withDb(dbPath, false, (sqlite) => {
    const record = normalizeRefusalRecord(input)
    sqlite.query(`INSERT INTO refusal_records (refusalId, timestamp, provider, model, role, category, tool, action, sessionId, turnId, correlationId, promptFingerprint, promptExcerpt, providerCode, providerMessage, retryOutcome, rerouteOutcome, contextSources, redactionPolicyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.refusalId, record.timestamp, record.provider, record.model, record.role, record.category, record.tool, record.action,
      record.sessionId, record.turnId, record.correlationId, record.promptFingerprint, record.promptExcerpt, record.providerCode,
      record.providerMessage, record.retryOutcome, record.rerouteOutcome, JSON.stringify(record.contextSources), record.redactionPolicyId,
    )
    return record
  }))
}

export function queryRecentRefusals(dbPath: string, options: RecentRefusalOptions = {}): Effect.Effect<readonly RefusalRecord[], StorageError> {
  return storageEffect("queryRecentRefusals", () => withDb(dbPath, true, (sqlite) => {
    const limit = Math.max(1, Math.min(500, options.limit ?? 50))
    const since = options.since ?? Number.MIN_SAFE_INTEGER
    const rows = sqlite.query<StoredRefusalRow, [number, number]>("SELECT * FROM refusal_records WHERE timestamp >= ? ORDER BY timestamp DESC, refusalId ASC LIMIT ?").all(since, limit)
    return rows.map(fromStoredRow)
  }))
}

export function queryRefusalCounts(dbPath: string, dimension: RefusalCountDimension, since = Number.MIN_SAFE_INTEGER): Effect.Effect<readonly RefusalCount[], StorageError> {
  return storageEffect("queryRefusalCounts", () => withDb(dbPath, true, (sqlite) => {
    const column = dimension
    const rows = sqlite.query<{ value: string | null; count: number }, [number]>(`SELECT ${column} AS value, COUNT(*) AS count FROM refusal_records WHERE timestamp >= ? GROUP BY ${column} ORDER BY count DESC, value ASC`).all(since)
    return rows.map((row) => ({ dimension, value: row.value, count: row.count }))
  }))
}

interface StoredRefusalRow extends Omit<RefusalRecord, "contextSources" | "redactionPolicyId"> {
  readonly contextSources: string
  readonly redactionPolicyId: string
}

function fromStoredRow(row: StoredRefusalRow): RefusalRecord {
  return { ...row, contextSources: JSON.parse(row.contextSources) as readonly string[], redactionPolicyId: REFUSAL_REDACTION_POLICY }
}

function redactContextSource(source: string): string {
  const normalized = source.replaceAll("\\", "/")
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1)
  return normalized === basename ? basename : `[path]/${basename}`
}

function cap(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum)
}

function withDb<T>(dbPath: string, readonly: boolean, fn: (sqlite: Database) => T): T {
  const sqlite = readonly ? new Database(dbPath, { readonly: true, create: false }) : new Database(dbPath, { readwrite: true, create: false })
  try {
    const version = sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0
    if (version < 11) throw new Error(`Refusal ledger schema version ${version} is older than required version 11`)
    return fn(sqlite)
  } finally {
    sqlite.close()
  }
}

function storageEffect<A>(operation: string, run: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({
    try: run,
    catch: (cause) => new StorageError({ operation, message: cause instanceof Error ? cause.message : String(cause), cause: cause instanceof Error ? cause.message : String(cause) }),
  })
}
