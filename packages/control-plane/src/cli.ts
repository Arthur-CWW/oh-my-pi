#!/usr/bin/env bun

import { Effect } from "effect"

import { ArtifactError, StorageError } from "./errors"
import { ingestOutbox } from "./ingest"
import { LedgerStore, defaultLedgerPath, openLedger, type EventFilters, type ModelCallFilters, type StatusSummary } from "./ledger"
import type { EventRow, ModelCallRow } from "./schema"

type Command = StatusCommand | ModelCallsCommand | EventsCommand | IngestCommand

interface BaseCommand {
  readonly dbPath: string
  readonly json: boolean
}

interface StatusCommand extends BaseCommand {
  readonly name: "status"
}

interface ModelCallsCommand extends BaseCommand {
  readonly name: "model-calls"
  readonly filters: ModelCallFilters
}

interface EventsCommand extends BaseCommand {
  readonly name: "events"
  readonly filters: EventFilters
}

interface IngestCommand extends BaseCommand {
  readonly name: "ingest"
  readonly from: string
}

interface CliFailure {
  readonly class: string
  readonly error: string
}

class CliUsageError {
  readonly _tag = "CliUsageError"
  constructor(readonly message: string) {}
}

export async function runCli(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  const parsed = parseCommand(argv)
  if (parsed instanceof CliUsageError) {
    writeJsonError({ class: "UsageError", error: parsed.message })
    return 1
  }

  switch (parsed.name) {
    case "status":
      return runStatus(parsed)
    case "model-calls":
      return runModelCalls(parsed)
    case "events":
      return runEvents(parsed)
    case "ingest":
      return runIngest(parsed)
  }
}

function runStatus(command: StatusCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* store.statusSummary()
  }).pipe(Effect.provide(openLedger(command.dbPath)))

  return runLedgerProgram(program, command.json, renderStatusTable)
}

function runModelCalls(command: ModelCallsCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* store.listModelCalls(command.filters)
  }).pipe(Effect.provide(openLedger(command.dbPath)))

  return runLedgerProgram(program, command.json, renderModelCallsTable)
}

function runEvents(command: EventsCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* store.listEvents(command.filters)
  }).pipe(Effect.provide(openLedger(command.dbPath)))

  return runLedgerProgram(program, command.json, renderEventsTable)
}

function runIngest(command: IngestCommand): Promise<number> {
  const program = ingestOutbox(command.from).pipe(Effect.provide(openLedger(command.dbPath)))
  return runLedgerProgram(program, command.json, renderIngestTable)
}

async function runLedgerProgram<A>(
  program: Effect.Effect<A, StorageError | ArtifactError>,
  json: boolean,
  renderTable: (value: A) => string,
): Promise<number> {
  const result = await Effect.runPromise(Effect.match(program, {
    onFailure: (error) => ({ ok: false as const, failure: cliFailure(error) }),
    onSuccess: (value) => ({ ok: true as const, value }),
  }))

  if (result.ok) {
    writeStdout(json ? (JSON.stringify(result.value) ?? "null") : renderTable(result.value))
    return 0
  }

  writeJsonError(result.failure)
  return 1
}

function parseCommand(argv: readonly string[]): Command | CliUsageError {
  const commandName = argv[0]
  if (commandName === undefined) return usage("missing command")

  const base = { dbPath: defaultLedgerPath(), json: false }
  switch (commandName) {
    case "status":
      return parseStatus(argv.slice(1), base)
    case "model-calls":
      return parseModelCalls(argv.slice(1), base)
    case "events":
      return parseEvents(argv.slice(1), base)
    case "ingest":
      return parseIngest(argv.slice(1), base)
    default:
      return usage(`unknown command: ${commandName}`)
  }
}

function parseStatus(argv: readonly string[], base: BaseCommand): StatusCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--db") {
      const value = requiredValue(argv, index, "--db")
      if (value instanceof CliUsageError) return value
      dbPath = value
      index += 1
    } else if (arg?.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length)
    } else {
      return usage(`unknown status option: ${arg}`)
    }
  }

  return { name: "status", dbPath, json }
}

function parseModelCalls(argv: readonly string[], base: BaseCommand): ModelCallsCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let session: string | undefined
  let model: string | undefined
  let provider: string | undefined
  let outcome: string | undefined
  let entryId: string | undefined
  let sinceTs: number | undefined
  let limit = 50

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--db") {
      const value = requiredValue(argv, index, "--db")
      if (value instanceof CliUsageError) return value
      dbPath = value
      index += 1
    } else if (arg?.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length)
    } else if (arg === "--session") {
      const value = requiredValue(argv, index, "--session")
      if (value instanceof CliUsageError) return value
      session = value
      index += 1
    } else if (arg?.startsWith("--session=")) {
      session = arg.slice("--session=".length)
    } else if (arg === "--model") {
      const value = requiredValue(argv, index, "--model")
      if (value instanceof CliUsageError) return value
      model = value
      index += 1
    } else if (arg?.startsWith("--model=")) {
      model = arg.slice("--model=".length)
    } else if (arg === "--provider") {
      const value = requiredValue(argv, index, "--provider")
      if (value instanceof CliUsageError) return value
      provider = value
      index += 1
    } else if (arg?.startsWith("--provider=")) {
      provider = arg.slice("--provider=".length)
    } else if (arg === "--outcome") {
      const value = requiredValue(argv, index, "--outcome")
      if (value instanceof CliUsageError) return value
      outcome = value
      index += 1
    } else if (arg?.startsWith("--outcome=")) {
      outcome = arg.slice("--outcome=".length)
    } else if (arg === "--entry") {
      const value = requiredValue(argv, index, "--entry")
      if (value instanceof CliUsageError) return value
      entryId = value
      index += 1
    } else if (arg?.startsWith("--entry=")) {
      entryId = arg.slice("--entry=".length)
    } else if (arg === "--since") {
      const value = requiredValue(argv, index, "--since")
      if (value instanceof CliUsageError) return value
      const parsed = parseSince(value)
      if (parsed instanceof CliUsageError) return parsed
      sinceTs = parsed
      index += 1
    } else if (arg?.startsWith("--since=")) {
      const parsed = parseSince(arg.slice("--since=".length))
      if (parsed instanceof CliUsageError) return parsed
      sinceTs = parsed
    } else if (arg === "--limit") {
      const value = requiredValue(argv, index, "--limit")
      if (value instanceof CliUsageError) return value
      const parsed = parseLimit(value)
      if (parsed instanceof CliUsageError) return parsed
      limit = parsed
      index += 1
    } else if (arg?.startsWith("--limit=")) {
      const parsed = parseLimit(arg.slice("--limit=".length))
      if (parsed instanceof CliUsageError) return parsed
      limit = parsed
    } else {
      return usage(`unknown model-calls option: ${arg}`)
    }
  }

  return { name: "model-calls", dbPath, json, filters: { session, model, provider, entryId, outcome, sinceTs, limit } }
}

function parseEvents(argv: readonly string[], base: BaseCommand): EventsCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let sessionId: string | undefined
  let kind: string | undefined
  let limit = 50

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--db") {
      const value = requiredValue(argv, index, "--db")
      if (value instanceof CliUsageError) return value
      dbPath = value
      index += 1
    } else if (arg?.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length)
    } else if (arg === "--session") {
      const value = requiredValue(argv, index, "--session")
      if (value instanceof CliUsageError) return value
      sessionId = value
      index += 1
    } else if (arg?.startsWith("--session=")) {
      sessionId = arg.slice("--session=".length)
    } else if (arg === "--kind") {
      const value = requiredValue(argv, index, "--kind")
      if (value instanceof CliUsageError) return value
      kind = value
      index += 1
    } else if (arg?.startsWith("--kind=")) {
      kind = arg.slice("--kind=".length)
    } else if (arg === "--limit") {
      const value = requiredValue(argv, index, "--limit")
      if (value instanceof CliUsageError) return value
      const parsed = parseLimit(value)
      if (parsed instanceof CliUsageError) return parsed
      limit = parsed
      index += 1
    } else if (arg?.startsWith("--limit=")) {
      const parsed = parseLimit(arg.slice("--limit=".length))
      if (parsed instanceof CliUsageError) return parsed
      limit = parsed
    } else {
      return usage(`unknown events option: ${arg}`)
    }
  }

  return { name: "events", dbPath, json, filters: { sessionId, kind, limit } }
}

function parseIngest(argv: readonly string[], base: BaseCommand): IngestCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let from: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--db") {
      const value = requiredValue(argv, index, "--db")
      if (value instanceof CliUsageError) return value
      dbPath = value
      index += 1
    } else if (arg?.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length)
    } else if (arg === "--from") {
      const value = requiredValue(argv, index, "--from")
      if (value instanceof CliUsageError) return value
      from = value
      index += 1
    } else if (arg?.startsWith("--from=")) {
      from = arg.slice("--from=".length)
    } else {
      return usage(`unknown ingest option: ${arg}`)
    }
  }

  if (from === undefined || from.length === 0) return usage("ingest requires --from <outbox.jsonl>")
  return { name: "ingest", dbPath, json, from }
}

function requiredValue(argv: readonly string[], index: number, flag: string): string | CliUsageError {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith("--")) return usage(`${flag} requires a value`)
  return value
}

function parseLimit(value: string): number | CliUsageError {
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1) return usage(`invalid --limit: ${value}`)
  return limit
}

function parseSince(value: string): number | CliUsageError {
  if (/^\d+$/.test(value)) return Number(value)
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return usage(`invalid --since: ${value}`)
  return parsed
}

function cliFailure(error: StorageError | ArtifactError): CliFailure {
  if (error instanceof StorageError) return { class: "StorageError", error: error.message }
  if (error instanceof ArtifactError) return { class: "ArtifactError", error: error.message }
  return { class: "Error", error: String(error) }
}

function renderStatusTable(summary: StatusSummary): string {
  return renderTable(
    ["metric", "value"],
    [
      ...summary.sessionsByStatus.map((row) => [`sessions:${row.status}`, row.count]),
      ["sessions", summary.counts.sessions],
      ["branches", summary.counts.branches],
      ["turns", summary.counts.turns],
      ["events", summary.counts.events],
      ["modelCalls", summary.counts.modelCalls],
      ["providerCalls", summary.counts.providerCalls],
      ["artifacts", summary.counts.artifacts],
      ["packets", summary.counts.packets],
      ["commits", summary.counts.commits],
      ["lastActivity", summary.lastActivity ?? ""],
    ],
  )
}

function renderModelCallsTable(rows: readonly ModelCallRow[]): string {
  return renderTable(
    ["ts", "session", "entryId", "model", "provider", "upstreamProvider", "tokensIn", "tokensOut", "cost", "latencyMs", "outcome", "rawRequestArtifact"],
    rows.map((row) => [
      row.ts,
      row.session,
      row.entryId ?? "",
      row.model,
      row.provider,
      row.upstreamProvider ?? "",
      row.tokensIn,
      row.tokensOut,
      row.cost,
      row.latencyMs,
      row.outcome,
      row.rawRequestArtifact,
    ]),
  )
}

function renderEventsTable(rows: readonly EventRow[]): string {
  return renderTable(
    ["ts", "sessionId", "seq", "kind", "payloadVersion"],
    rows.map((row) => [row.ts, row.sessionId ?? "", row.seq ?? "", row.kind, row.payloadVersion]),
  )
}

function renderIngestTable(result: { readonly inserted: number; readonly ignored: number; readonly malformed: number }): string {
  return renderTable(["inserted", "ignored", "malformed"], [[result.inserted, result.ignored, result.malformed]])
}

type TableCell = string | number

function renderTable(headers: readonly string[], rows: readonly (readonly TableCell[])[]): string {
  const renderedRows = rows.map((row) => row.map((cell) => String(cell)))
  const widths = headers.map((header, column) => Math.max(header.length, ...renderedRows.map((row) => row[column]?.length ?? 0)))
  const headerLine = headers.map((header, column) => header.padEnd(widths[column] ?? header.length)).join("  ")
  const dividerLine = widths.map((width) => "-".repeat(width)).join("  ")
  const bodyLines = renderedRows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? cell.length)).join("  "))
  return [headerLine, dividerLine, ...bodyLines].join("\n")
}

function writeStdout(output: string): void {
  console.log(output)
}

function writeJsonError(error: CliFailure): void {
  console.error(JSON.stringify({ error: error.error, class: error.class }))
}

function usage(message: string): CliUsageError {
  return new CliUsageError(`${message}. usage: control-plane <status|model-calls|events|ingest> [--db <path>] [--json]`)
}

if (import.meta.main) {
  runCli().then((code) => {
    process.exitCode = code
  }).catch((cause) => {
    writeJsonError({ class: "Error", error: cause instanceof Error ? cause.message : String(cause) })
    process.exitCode = 1
  })
}
