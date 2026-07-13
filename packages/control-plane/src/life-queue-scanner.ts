import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import { Effect, Schema } from "effect"

import { StorageError } from "./errors"
import { QueueStore, type QueueInsertResult } from "./life-queue"

const SessionEntrySchema = Schema.Struct({
  type: Schema.String,
  id: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.Unknown),
})

type SessionEntry = Schema.Schema.Type<typeof SessionEntrySchema>

export interface SessionScanOptions {
  readonly sessionsDir: string
  readonly now?: number
  readonly staleAfterMs?: number
}

export interface SessionScanResult {
  readonly scanned: number
  readonly abandoned: number
  readonly inserted: number
  readonly ignored: number
  readonly skipped: number
  readonly items: readonly QueueInsertResult[]
}

interface SessionCandidate {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly lastActivityAt: number
}

/**
 * A session is abandoned when its newest timestamp is older than the threshold and its
 * final message is not a successful assistant stop. A final user/tool message, aborted
 * or errored assistant message, or missing final message is therefore resumable.
 */
export function scanAbandonedSessions(options: SessionScanOptions): Effect.Effect<SessionScanResult, StorageError, QueueStore> {
  return Effect.gen(function* () {
    const store = yield* QueueStore
    const candidates = readCandidates(options)
    const items: QueueInsertResult[] = []
    for (const candidate of candidates.candidates) {
      items.push(yield* store.add({
        id: `session:${candidate.id}`,
        title: candidate.title,
        intent: "Resume and resolve the abandoned OMP session.",
        priority: "p2",
        source: "session-scan",
        contextPacketPath: candidate.path,
        status: "paused",
        resumeRef: candidate.id,
        createdAt: candidate.lastActivityAt,
      }))
    }
    return {
      scanned: candidates.scanned,
      abandoned: candidates.candidates.length,
      inserted: items.filter((result) => result.inserted).length,
      ignored: items.filter((result) => !result.inserted).length,
      skipped: candidates.skipped,
      items,
    }
  })
}

function readCandidates(options: SessionScanOptions): { readonly scanned: number; readonly skipped: number; readonly candidates: readonly SessionCandidate[] } {
  const now = options.now ?? Date.now()
  const staleAfterMs = options.staleAfterMs ?? 48 * 60 * 60 * 1_000
  const names = readdirSync(options.sessionsDir).filter((name) => name.endsWith(".jsonl") || name.endsWith(".jsonl.zst")).sort()
  const candidates: SessionCandidate[] = []
  let skipped = 0
  for (const name of names) {
    const path = join(options.sessionsDir, name)
    try {
      const candidate = inspectSession(path, now - staleAfterMs)
      if (candidate !== null) candidates.push(candidate)
    } catch {
      skipped += 1
    }
  }
  candidates.sort((left, right) => left.lastActivityAt - right.lastActivityAt)
  return { scanned: names.length, skipped, candidates }
}

function inspectSession(path: string, staleBefore: number): SessionCandidate | null {
  const content = path.endsWith(".zst") ? decompressZstd(path) : readFileSync(path, "utf8")
  let sessionId: string | undefined
  let firstUserText: string | undefined
  let lastMessage: SessionEntry | undefined
  let lastActivityAt = 0
  for (const line of content.split("\n")) {
    if (line.length === 0) continue
    const entry = Schema.decodeUnknownSync(SessionEntrySchema)(JSON.parse(line))
    if (entry.type === "session" && entry.id !== undefined) sessionId = entry.id
    if (entry.timestamp !== undefined) {
      const timestamp = Date.parse(entry.timestamp)
      if (Number.isFinite(timestamp)) lastActivityAt = Math.max(lastActivityAt, timestamp)
    }
    if (entry.type === "message") {
      lastMessage = entry
      firstUserText ??= extractUserText(entry.message)
    }
  }
  if (lastActivityAt === 0) lastActivityAt = statSync(path).mtimeMs
  if (sessionId === undefined) sessionId = sessionIdFromFilename(path)
  if (lastActivityAt >= staleBefore || isTerminal(lastMessage)) return null
  const fallbackTitle = `Resume abandoned session ${sessionId}`
  return {
    id: sessionId,
    title: truncateTitle(firstUserText ?? fallbackTitle),
    path,
    lastActivityAt: Math.trunc(lastActivityAt),
  }
}

function extractUserText(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null || !("role" in message) || message.role !== "user" || !("content" in message)) return undefined
  if (typeof message.content === "string") return normalizeTitle(message.content)
  if (!Array.isArray(message.content)) return undefined
  const text = message.content
    .filter((part): part is { readonly type: "text"; readonly text: string } =>
      typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join(" ")
  return text.length === 0 ? undefined : normalizeTitle(text)
}

function isTerminal(entry: SessionEntry | undefined): boolean {
  if (entry === undefined || typeof entry.message !== "object" || entry.message === null || !("role" in entry.message)) return false
  const message = entry.message
  return message.role === "assistant" && "stopReason" in message && message.stopReason === "stop" && !("errorMessage" in message)
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateTitle(value: string): string {
  const characters = Array.from(normalizeTitle(value))
  return characters.length <= 80 ? characters.join("") : `${characters.slice(0, 79).join("")}…`
}

function sessionIdFromFilename(path: string): string {
  const name = basename(path).replace(/\.jsonl(?:\.zst)?$/, "")
  const separator = name.indexOf("_")
  return separator === -1 ? name : name.slice(separator + 1)
}

function decompressZstd(path: string): string {
  const result = Bun.spawnSync(["zstd", "--quiet", "--decompress", "--stdout", path])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `zstd failed for ${path}`)
  return result.stdout.toString()
}
