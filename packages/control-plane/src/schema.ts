import { sql } from "drizzle-orm"
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  machine: text("machine").notNull(),
  harness: text("harness").notNull(),
  workspace: text("workspace").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  meta: text("meta").notNull(),
})

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  sessionId: text("sessionId").notNull(),
  parentBranchId: text("parentBranchId"),
  kind: text("kind").notNull(),
  atTurn: integer("atTurn"),
  createdAt: integer("createdAt").notNull(),
  meta: text("meta").notNull(),
})

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("sessionId").notNull(),
    branchId: text("branchId").notNull(),
    seq: integer("seq").notNull(),
    startedAt: integer("startedAt").notNull(),
    endedAt: integer("endedAt"),
    contextTokens: integer("contextTokens").notNull(),
    toolCalls: integer("toolCalls").notNull(),
    toolCallSummary: text("toolCallSummary"),
    editBytes: integer("editBytes").notNull(),
    turnDurationMs: integer("turnDurationMs").notNull(),
    yieldKind: text("yieldKind").notNull(),
    affectSelfReport: text("affectSelfReport"),
    affectSignals: text("affectSignals"),
  },
  (table) => [index("turns_sessionId_branchId_seq_idx").on(table.sessionId, table.branchId, table.seq)],
)

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    sessionId: text("sessionId"),
    seq: integer("seq"),
    branchId: text("branchId"),
    packetId: text("packetId"),
    kind: text("kind").notNull(),
    payloadVersion: integer("payloadVersion").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [
    index("events_sessionId_ts_idx").on(table.sessionId, table.ts),
    index("events_kind_idx").on(table.kind),
    uniqueIndex("events_sessionId_seq_unique_idx").on(table.sessionId, table.seq).where(sql`seq IS NOT NULL`),
  ],
)

export const modelCalls = sqliteTable(
  "model_calls",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    machine: text("machine").notNull(),
    session: text("session").notNull(),
    branchId: text("branchId").notNull(),
    agent: text("agent").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    effort: text("effort").notNull(),
    promptHash: text("promptHash").notNull(),
    systemPromptHash: text("systemPromptHash").notNull(),
    skillProfile: text("skillProfile").notNull(),
    contextManifest: text("contextManifest").notNull(),
    packetId: text("packetId").notNull(),
    tokensIn: integer("tokensIn").notNull(),
    tokensOut: integer("tokensOut").notNull(),
    cacheRead: integer("cacheRead").notNull(),
    cacheWrite: integer("cacheWrite").notNull(),
    cost: real("cost").notNull(),
    latencyMs: integer("latencyMs").notNull(),
    outcome: text("outcome").notNull(),
    errorClass: text("errorClass"),
    retryOf: text("retryOf"),
    fallbackFrom: text("fallbackFrom"),
    rawRequestArtifact: text("rawRequestArtifact").notNull(),
    rawResponseArtifact: text("rawResponseArtifact").notNull(),
  },
  (table) => [
    index("model_calls_session_ts_idx").on(table.session, table.ts),
    index("model_calls_outcome_idx").on(table.outcome),
  ],
)

export const providerCalls = sqliteTable("provider_calls", {
  id: text("id").primaryKey(),
  ts: integer("ts").notNull(),
  sessionId: text("sessionId").notNull(),
  branchId: text("branchId"),
  packetId: text("packetId"),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  inputHash: text("inputHash").notNull(),
  rawRequestArtifact: text("rawRequestArtifact"),
  latencyMs: integer("latencyMs").notNull(),
  outcome: text("outcome").notNull(),
  errorClass: text("errorClass"),
  cost: real("cost"),
  usage: text("usage"),
})

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  ts: integer("ts").notNull(),
  sessionId: text("sessionId"),
  kind: text("kind").notNull(),
  contentPath: text("contentPath"),
  contentInline: text("contentInline"),
  sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(),
  retention: text("retention").notNull(),
  meta: text("meta").notNull(),
})

export const packets = sqliteTable("packets", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  lane: text("lane").notNull(),
  status: text("status").notNull(),
  priority: integer("priority"),
  summary: text("summary"),
  sourcePointer: text("sourcePointer"),
  ownerPaths: text("ownerPaths").notNull(),
  excludedPaths: text("excludedPaths").notNull(),
  dirtyPaths: text("dirtyPaths"),
  workerSessionId: text("workerSessionId"),
  reviewerSessionId: text("reviewerSessionId"),
  branchId: text("branchId"),
  proofLinks: text("proofLinks"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  claimedAt: integer("claimedAt"),
  reviewReadyAt: integer("reviewReadyAt"),
  doneAt: integer("doneAt"),
  staleAt: integer("staleAt"),
})

export const commits = sqliteTable("commits", {
  sha: text("sha").primaryKey(),
  sessionId: text("sessionId").notNull(),
  agentId: text("agentId"),
  packetId: text("packetId"),
  ts: integer("ts").notNull(),
})

export const ledgerTables = {
  sessions,
  branches,
  turns,
  events,
  modelCalls,
  providerCalls,
  artifacts,
  packets,
  commits,
} as const

export type SessionRow = typeof sessions.$inferSelect
export type BranchRow = typeof branches.$inferSelect
export type TurnRow = typeof turns.$inferSelect
export type EventRow = typeof events.$inferSelect
export type ModelCallRow = typeof modelCalls.$inferSelect
export type ProviderCallRow = typeof providerCalls.$inferSelect
export type ArtifactRow = typeof artifacts.$inferSelect
export type PacketRow = typeof packets.$inferSelect
export type CommitRow = typeof commits.$inferSelect
