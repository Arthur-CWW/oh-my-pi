#!/usr/bin/env bun

import { homedir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"

import { defaultLedgerPath } from "./ledger"
import { openQueueStore, QueueStore, type QueueFilters, type QueueItemInput } from "./life-queue"
import { QueueItemSchema, QueuePrioritySchema, QueueSourceSchema, QueueStatusSchema, type QueueItem, type QueueStatus } from "./life-queue-schema"
import { scanAbandonedSessions } from "./life-queue-scanner"

interface ParsedOptions {
  readonly values: ReadonlyMap<string, string>
  readonly flags: ReadonlySet<string>
  readonly positional: readonly string[]
}

export async function runQueueCli(argv: readonly string[]): Promise<number> {
  const args = argv[0] === "queue" ? argv.slice(1) : argv
  try {
    const subcommand = args[0]
    if (subcommand === undefined) throw new Error("queue requires a subcommand: add|list|show|start|pause|done|drop|triage|scan-sessions")
    const options = parseOptions(args.slice(1))
    const dbPath = options.values.get("db") ?? defaultLedgerPath()
    const json = options.flags.has("json")
    const program = buildProgram(subcommand, options)
    const value = await Effect.runPromise(program.pipe(Effect.provide(openQueueStore(dbPath))))
    console.log(json ? JSON.stringify(value) : renderValue(value))
    return 0
  } catch (cause) {
    console.error(JSON.stringify({ class: "QueueError", error: cause instanceof Error ? cause.message : String(cause) }))
    return 1
  }
}

function buildProgram(subcommand: string, options: ParsedOptions): Effect.Effect<unknown, unknown, QueueStore> {
  switch (subcommand) {
    case "add":
      return Effect.gen(function* () {
        const store = yield* QueueStore
        return yield* store.add(parseAdd(options))
      })
    case "list":
      return Effect.gen(function* () {
        const store = yield* QueueStore
        return yield* store.list(parseFilters(options))
      })
    case "triage":
      return Effect.gen(function* () {
        const store = yield* QueueStore
        return yield* store.list({ status: "inbox", oldestFirst: true, limit: parseLimit(options) })
      })
    case "show":
      return Effect.gen(function* () {
        const store = yield* QueueStore
        const item = yield* store.show(requiredId(options))
        if (item === null) return yield* Effect.fail(new Error(`queue item not found: ${requiredId(options)}`))
        return item
      })
    case "start":
      return transitionProgram(options, "active")
    case "pause":
      return transitionProgram(options, "paused")
    case "done":
      return transitionProgram(options, "done")
    case "drop":
      return transitionProgram(options, "dropped")
    case "scan-sessions": {
      const sessionsDir = options.values.get("sessions-dir") ?? join(homedir(), ".omp", "agent", "sessions", "-agents")
      const staleHours = Number(options.values.get("stale-hours") ?? "48")
      if (!Number.isFinite(staleHours) || staleHours <= 0) throw new Error("--stale-hours must be positive")
      return scanAbandonedSessions({ sessionsDir, staleAfterMs: staleHours * 60 * 60 * 1_000 })
    }
    default:
      throw new Error(`unknown queue subcommand: ${subcommand}`)
  }
}

function transitionProgram(options: ParsedOptions, status: QueueStatus): Effect.Effect<QueueItem, unknown, QueueStore> {
  return Effect.gen(function* () {
    const store = yield* QueueStore
    return yield* store.transition(requiredId(options), status)
  })
}

function parseAdd(options: ParsedOptions): QueueItemInput {
  const title = requiredOption(options, "title")
  const intent = requiredOption(options, "intent")
  const priority = Schema.decodeUnknownSync(QueuePrioritySchema)(options.values.get("priority") ?? "p2")
  const source = Schema.decodeUnknownSync(QueueSourceSchema)(options.values.get("source") ?? "manual")
  const status = Schema.decodeUnknownSync(QueueStatusSchema)(options.values.get("status") ?? "inbox")
  return {
    id: options.values.get("id"),
    title,
    intent,
    priority,
    source,
    status,
    contextPacketPath: options.values.get("context-packet") ?? "",
    owningAgent: options.values.get("owning-agent"),
    resumeRef: options.values.get("resume-ref"),
  }
}

function parseFilters(options: ParsedOptions): QueueFilters {
  return {
    priority: options.values.has("priority") ? Schema.decodeUnknownSync(QueuePrioritySchema)(options.values.get("priority")) : undefined,
    source: options.values.has("source") ? Schema.decodeUnknownSync(QueueSourceSchema)(options.values.get("source")) : undefined,
    status: options.values.has("status") ? Schema.decodeUnknownSync(QueueStatusSchema)(options.values.get("status")) : undefined,
    owningAgent: options.values.get("owning-agent"),
    limit: parseLimit(options),
    oldestFirst: options.flags.has("oldest-first"),
  }
}

function parseLimit(options: ParsedOptions): number {
  const limit = Number(options.values.get("limit") ?? "100")
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer")
  return limit
}

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  const positional: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const equals = arg.indexOf("=")
    if (equals !== -1) {
      values.set(arg.slice(2, equals), arg.slice(equals + 1))
      continue
    }
    const key = arg.slice(2)
    if (key === "json" || key === "oldest-first") {
      flags.add(key)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`)
    values.set(key, value)
    index += 1
  }
  return { values, flags, positional }
}

function requiredId(options: ParsedOptions): string {
  const id = options.positional[0] ?? options.values.get("id")
  if (id === undefined) throw new Error("queue item id is required")
  return id
}

function requiredOption(options: ParsedOptions, name: string): string {
  const value = options.values.get(name)
  if (value === undefined || value.trim().length === 0) throw new Error(`--${name} is required`)
  return value
}

function renderValue(value: unknown): string {
  const candidate = typeof value === "object" && value !== null && "item" in value ? value.item : value
  const rows = Array.isArray(candidate) ? candidate : [candidate]
  if (rows.every((row) => isQueueItem(row))) {
    return renderQueueItems(rows)
  }
  return JSON.stringify(value, null, 2)
}

function isQueueItem(value: unknown): value is QueueItem {
  try {
    Schema.decodeUnknownSync(QueueItemSchema)(value)
    return true
  } catch {
    return false
  }
}

function renderQueueItems(items: readonly QueueItem[]): string {
  const headers = ["id", "priority", "status", "source", "title", "owningAgent", "resumeRef"]
  const rows = items.map((item) => [item.id, item.priority, item.status, item.source, item.title, item.owningAgent ?? "", item.resumeRef ?? ""])
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)))
  return [
    headers.map((header, column) => header.padEnd(widths[column] ?? header.length)).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? cell.length)).join("  ")),
  ].join("\n")
}

if (import.meta.main) {
  runQueueCli(Bun.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
