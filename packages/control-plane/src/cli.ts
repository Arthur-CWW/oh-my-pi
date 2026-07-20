#!/usr/bin/env bun

import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import { Effect } from "effect"

import { ArtifactError, StorageError } from "./errors"
import { ingestOutbox } from "./ingest"
import { decodePapercutInput, LedgerStore, defaultLedgerPath, openLedger, type EventFilters, type ModelCallFilters, type PapercutReportResult, type StatusSummary } from "./index"
import {
  RoutingStore,
  openRoutingStore,
  parseRoutingVerdict,
  type LaneBrief,
  type RoutingObservationInput,
  type RoutingVerdict,
} from "./routing"
import { seedRoutingStore, type RoutingSeedResult } from "./routing-seed"
import type { EventRow, LaneStateRow, ModelCallRow, RoutingObservationRow } from "./schema"
import { queryOperationalCanaries, queryOperationalDiagnostics, queryOperationalReleases, queryOperationalRoutes, queryOperationalSessions, type OperationalCanaryDto, type OperationalDiagnosticDto, type OperationalQueryOptions, type OperationalReleaseDto, type OperationalRouteDto, type OperationalSessionDto } from "./operational-query"
import { queryUsageByAgent, queryUsageByLaneHour, queryUsageBySession, type UsageByAgentRow, type UsageByLaneHourRow, type UsageBySessionRow } from "./stats"
import { runQueueCli } from "./queue-cli"

type Command = StatusCommand | ModelCallsCommand | EventsCommand | IngestCommand | PapercutCommand | RoutingCommand | StatsCommand | OpsCommand

type RoutingCommand = RoutingObserveCommand | RoutingLanesCommand | RoutingBriefCommand | RoutingLogCommand | RoutingSeedCommand

type StatsCommand = StatsLanesCommand | StatsAgentsCommand | StatsSessionsCommand

type OpsCommand = OpsSessionsCommand | OpsRoutesCommand | OpsDiagnosticsCommand | OpsCanariesCommand | OpsReleasesCommand

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

interface PapercutCommand extends BaseCommand {
  readonly name: "papercut"
  readonly input: {
    readonly kind: "tool" | "repo" | "docs" | "test" | "workflow" | "config" | "agent"
    readonly severity: "low" | "medium" | "high"
    readonly message: string
    readonly commandOrTool?: string
    readonly cwdOrPackage?: string
    readonly evidenceArtifactId?: string
    readonly suggestedFix?: string
  }
}

interface RoutingObserveCommand extends BaseCommand {
  readonly name: "routing-observe"
  readonly observation: RoutingObservationInput
}

interface RoutingLanesCommand extends BaseCommand {
  readonly name: "routing-lanes"
}

interface RoutingBriefCommand extends BaseCommand {
  readonly name: "routing-brief"
  readonly lane?: string
}

interface RoutingLogCommand extends BaseCommand {
  readonly name: "routing-log"
  readonly filters: {
    readonly lane?: string
    readonly limit: number
  }
}

interface RoutingSeedCommand extends BaseCommand {
  readonly name: "routing-seed"
}

interface StatsLanesCommand extends BaseCommand {
  readonly name: "stats-lanes"
  readonly sinceTs?: number
}

interface StatsAgentsCommand extends BaseCommand {
  readonly name: "stats-agents"
  readonly sinceTs?: number
}

interface StatsSessionsCommand extends BaseCommand {
  readonly name: "stats-sessions"
  readonly sinceTs?: number
}

interface OpsSessionsCommand extends BaseCommand {
  readonly name: "ops-sessions"
  readonly options: OperationalQueryOptions
}

interface OpsRoutesCommand extends BaseCommand {
  readonly name: "ops-routes"
  readonly options: OperationalQueryOptions
}

interface OpsDiagnosticsCommand extends BaseCommand {
  readonly name: "ops-diagnostics"
  readonly options: OperationalQueryOptions
}

interface OpsCanariesCommand extends BaseCommand {
  readonly name: "ops-canaries"
  readonly options: OperationalQueryOptions
}

interface OpsReleasesCommand extends BaseCommand {
  readonly name: "ops-releases"
  readonly options: OperationalQueryOptions
}

interface RoutingObserveResult {
  readonly id: string
  readonly inserted: boolean
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
  if (argv[0] === "queue") return runQueueCli(argv.slice(1))
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
    case "papercut":
      return runPapercut(parsed)
    case "routing-observe":
      return runRoutingObserve(parsed)
    case "routing-lanes":
      return runRoutingLanes(parsed)
    case "routing-brief":
      return runRoutingBrief(parsed)
    case "routing-log":
      return runRoutingLog(parsed)
    case "routing-seed":
      return runRoutingSeed(parsed)
    case "stats-lanes":
      return runStatsLanes(parsed)
    case "stats-agents":
      return runStatsAgents(parsed)
    case "stats-sessions":
      return runStatsSessions(parsed)
    case "ops-sessions":
      return runOpsSessions(parsed)
    case "ops-routes":
      return runOpsRoutes(parsed)
    case "ops-diagnostics":
      return runOpsDiagnostics(parsed)
    case "ops-canaries":
      return runOpsCanaries(parsed)
    case "ops-releases":
      return runOpsReleases(parsed)
  }
}

function runStatus(command: StatusCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* store.statusSummary()
  }).pipe(Effect.provide(openLedger(command.dbPath)))

  return runStorageProgram(program, command.json, renderStatusTable)
}

function runModelCalls(command: ModelCallsCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* store.listModelCalls(command.filters)
  }).pipe(Effect.provide(openLedger(command.dbPath)))

  return runStorageProgram(program, command.json, renderModelCallsTable)
}

function runEvents(command: EventsCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* store.listEvents(command.filters)
  }).pipe(Effect.provide(openLedger(command.dbPath)))

  return runStorageProgram(program, command.json, renderEventsTable)
}

function runIngest(command: IngestCommand): Promise<number> {
  const program = ingestOutbox(command.from).pipe(Effect.provide(openLedger(command.dbPath)))
  return runStorageProgram(program, command.json, renderIngestTable)
}

function runPapercut(command: PapercutCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore
    return yield* store.reportPapercut({
      ...command.input,
      cwdOrPackage: command.input.cwdOrPackage ?? process.cwd(),
      timestamp: Date.now(),
    })
  }).pipe(Effect.provide(openLedger(command.dbPath)))

  return runStorageProgram(program, command.json, renderPapercutTable)
}

function runRoutingObserve(command: RoutingObserveCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* RoutingStore
    const result = yield* store.recordObservation(command.observation)
    return { id: command.observation.id, inserted: result.inserted }
  }).pipe(Effect.provide(openRoutingStore(command.dbPath)))

  return runStorageProgram(program, command.json, renderRoutingObserveTable)
}

function runRoutingLanes(command: RoutingLanesCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* RoutingStore
    return yield* store.getLaneState()
  }).pipe(Effect.provide(openRoutingStore(command.dbPath)))

  return runStorageProgram(program, command.json, (value) => renderLaneStateTable(value as readonly LaneStateRow[]))
}

function runRoutingBrief(command: RoutingBriefCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* RoutingStore
    return yield* store.laneBrief({ lane: command.lane })
  }).pipe(Effect.provide(openRoutingStore(command.dbPath)))

  return runStorageProgram(program, command.json, renderLaneBriefTable)
}

function runRoutingLog(command: RoutingLogCommand): Promise<number> {
  const program = Effect.gen(function* () {
    const store = yield* RoutingStore
    return yield* store.listObservations(command.filters)
  }).pipe(Effect.provide(openRoutingStore(command.dbPath)))

  return runStorageProgram(program, command.json, renderRoutingLogTable)
}

function runOpsSessions(command: OpsSessionsCommand): Promise<number> {
  return runStorageProgram(queryOperationalSessions(command.dbPath, command.options), command.json, renderOperationalSessionsTable)
}

function runOpsRoutes(command: OpsRoutesCommand): Promise<number> {
  return runStorageProgram(queryOperationalRoutes(command.dbPath, command.options), command.json, renderOperationalRoutesTable)
}

function runOpsDiagnostics(command: OpsDiagnosticsCommand): Promise<number> {
  return runStorageProgram(queryOperationalDiagnostics(command.dbPath, command.options), command.json, renderOperationalDiagnosticsTable)
}

function runOpsCanaries(command: OpsCanariesCommand): Promise<number> {
  return runStorageProgram(queryOperationalCanaries(command.dbPath, command.options), command.json, renderOperationalCanariesTable)
}

function runOpsReleases(command: OpsReleasesCommand): Promise<number> {
  return runStorageProgram(queryOperationalReleases(command.dbPath, command.options), command.json, renderOperationalReleasesTable)
}

function runStatsLanes(command: StatsLanesCommand): Promise<number> {
  const program = queryUsageByLaneHour(command.dbPath, { sinceTs: command.sinceTs })
  return runStorageProgram(program, command.json, renderStatsLanesTable)
}

function runStatsAgents(command: StatsAgentsCommand): Promise<number> {
  const program = queryUsageByAgent(command.dbPath, { sinceTs: command.sinceTs })
  return runStorageProgram(program, command.json, renderStatsAgentsTable)
}

function runStatsSessions(command: StatsSessionsCommand): Promise<number> {
  const program = queryUsageBySession(command.dbPath, { sinceTs: command.sinceTs })
  return runStorageProgram(program, command.json, renderStatsSessionsTable)
}

function runRoutingSeed(command: RoutingSeedCommand): Promise<number> {
  const program = seedRoutingStore().pipe(Effect.provide(openRoutingStore(command.dbPath)))
  return runStorageProgram(program, command.json, renderRoutingSeedTable)
}

async function runStorageProgram<A>(
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
    case "papercut":
      return parsePapercut(argv.slice(1), base)
    case "routing":
      return parseRouting(argv.slice(1), base)
    case "stats":
      return parseStats(argv.slice(1), base)
    case "ops":
      return parseOps(argv.slice(1), base)
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

function parsePapercut(argv: readonly string[], base: BaseCommand): PapercutCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let kind: string | undefined
  let severity: string | undefined
  let message: string | undefined
  let commandOrTool: string | undefined
  let cwdOrPackage: string | undefined
  let evidenceArtifactId: string | undefined
  let suggestedFix: string | undefined

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
    } else if (arg === "--kind") {
      const value = requiredValue(argv, index, "--kind")
      if (value instanceof CliUsageError) return value
      kind = value
      index += 1
    } else if (arg?.startsWith("--kind=")) {
      kind = arg.slice("--kind=".length)
    } else if (arg === "--severity") {
      const value = requiredValue(argv, index, "--severity")
      if (value instanceof CliUsageError) return value
      severity = value
      index += 1
    } else if (arg?.startsWith("--severity=")) {
      severity = arg.slice("--severity=".length)
    } else if (arg === "--message") {
      const value = requiredValue(argv, index, "--message")
      if (value instanceof CliUsageError) return value
      message = value
      index += 1
    } else if (arg?.startsWith("--message=")) {
      message = arg.slice("--message=".length)
    } else if (arg === "--command-or-tool") {
      const value = requiredValue(argv, index, "--command-or-tool")
      if (value instanceof CliUsageError) return value
      commandOrTool = value
      index += 1
    } else if (arg?.startsWith("--command-or-tool=")) {
      commandOrTool = arg.slice("--command-or-tool=".length)
    } else if (arg === "--cwd-or-package") {
      const value = requiredValue(argv, index, "--cwd-or-package")
      if (value instanceof CliUsageError) return value
      cwdOrPackage = value
      index += 1
    } else if (arg?.startsWith("--cwd-or-package=")) {
      cwdOrPackage = arg.slice("--cwd-or-package=".length)
    } else if (arg === "--evidence-artifact-id") {
      const value = requiredValue(argv, index, "--evidence-artifact-id")
      if (value instanceof CliUsageError) return value
      evidenceArtifactId = value
      index += 1
    } else if (arg?.startsWith("--evidence-artifact-id=")) {
      evidenceArtifactId = arg.slice("--evidence-artifact-id=".length)
    } else if (arg === "--suggested-fix") {
      const value = requiredValue(argv, index, "--suggested-fix")
      if (value instanceof CliUsageError) return value
      suggestedFix = value
      index += 1
    } else if (arg?.startsWith("--suggested-fix=")) {
      suggestedFix = arg.slice("--suggested-fix=".length)
    } else {
      return usage(`unknown papercut option: ${arg}`)
    }
  }

  const input = decodePapercutInput({ kind, severity, message, commandOrTool, cwdOrPackage, evidenceArtifactId, suggestedFix })
  if (input === undefined) return usage("papercut requires valid --kind, --severity, and --message values")
  return { name: "papercut", dbPath, json, input }
}

function parseRouting(argv: readonly string[], base: BaseCommand): RoutingCommand | CliUsageError {
  const subcommand = argv[0]
  if (subcommand === undefined) return usage("routing requires a subcommand")

  switch (subcommand) {
    case "observe":
      return parseRoutingObserve(argv.slice(1), base)
    case "lanes":
      return parseRoutingLanes(argv.slice(1), base)
    case "brief":
      return parseRoutingBrief(argv.slice(1), base)
    case "log":
      return parseRoutingLog(argv.slice(1), base)
    case "seed":
      return parseRoutingSeed(argv.slice(1), base)
    default:
      return usage(`unknown routing subcommand: ${subcommand}`)
  }
}

function parseRoutingObserve(argv: readonly string[], base: BaseCommand): RoutingObserveCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let id: string | undefined
  let ts = Date.now()
  let machine = hostname()
  let session: string | undefined
  let agent: string | undefined
  let lane: string | undefined
  let workType: string | undefined
  let verdict: RoutingVerdict | undefined
  let note: string | undefined
  let evidence: string | undefined
  let confidence: number | undefined

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
    } else if (arg === "--id") {
      const value = requiredValue(argv, index, "--id")
      if (value instanceof CliUsageError) return value
      id = value
      index += 1
    } else if (arg?.startsWith("--id=")) {
      id = arg.slice("--id=".length)
    } else if (arg === "--ts") {
      const value = requiredValue(argv, index, "--ts")
      if (value instanceof CliUsageError) return value
      const parsed = parseSince(value)
      if (parsed instanceof CliUsageError) return parsed
      ts = parsed
      index += 1
    } else if (arg?.startsWith("--ts=")) {
      const parsed = parseSince(arg.slice("--ts=".length))
      if (parsed instanceof CliUsageError) return parsed
      ts = parsed
    } else if (arg === "--machine") {
      const value = requiredValue(argv, index, "--machine")
      if (value instanceof CliUsageError) return value
      machine = value
      index += 1
    } else if (arg?.startsWith("--machine=")) {
      machine = arg.slice("--machine=".length)
    } else if (arg === "--session") {
      const value = requiredValue(argv, index, "--session")
      if (value instanceof CliUsageError) return value
      session = value
      index += 1
    } else if (arg?.startsWith("--session=")) {
      session = arg.slice("--session=".length)
    } else if (arg === "--agent") {
      const value = requiredValue(argv, index, "--agent")
      if (value instanceof CliUsageError) return value
      agent = value
      index += 1
    } else if (arg?.startsWith("--agent=")) {
      agent = arg.slice("--agent=".length)
    } else if (arg === "--lane") {
      const value = requiredValue(argv, index, "--lane")
      if (value instanceof CliUsageError) return value
      lane = value
      index += 1
    } else if (arg?.startsWith("--lane=")) {
      lane = arg.slice("--lane=".length)
    } else if (arg === "--work-type") {
      const value = requiredValue(argv, index, "--work-type")
      if (value instanceof CliUsageError) return value
      workType = value
      index += 1
    } else if (arg?.startsWith("--work-type=")) {
      workType = arg.slice("--work-type=".length)
    } else if (arg === "--verdict") {
      const value = requiredValue(argv, index, "--verdict")
      if (value instanceof CliUsageError) return value
      const parsed = parseRoutingVerdict(value)
      if (parsed === null) return usage(`invalid --verdict: ${value}`)
      verdict = parsed
      index += 1
    } else if (arg?.startsWith("--verdict=")) {
      const value = arg.slice("--verdict=".length)
      const parsed = parseRoutingVerdict(value)
      if (parsed === null) return usage(`invalid --verdict: ${value}`)
      verdict = parsed
    } else if (arg === "--note") {
      const value = requiredValue(argv, index, "--note")
      if (value instanceof CliUsageError) return value
      note = value
      index += 1
    } else if (arg?.startsWith("--note=")) {
      note = arg.slice("--note=".length)
    } else if (arg === "--evidence") {
      const value = requiredValue(argv, index, "--evidence")
      if (value instanceof CliUsageError) return value
      evidence = value
      index += 1
    } else if (arg?.startsWith("--evidence=")) {
      evidence = arg.slice("--evidence=".length)
    } else if (arg === "--confidence") {
      const value = requiredValue(argv, index, "--confidence")
      if (value instanceof CliUsageError) return value
      const parsed = parseConfidence(value)
      if (parsed instanceof CliUsageError) return parsed
      confidence = parsed
      index += 1
    } else if (arg?.startsWith("--confidence=")) {
      const parsed = parseConfidence(arg.slice("--confidence=".length))
      if (parsed instanceof CliUsageError) return parsed
      confidence = parsed
    } else {
      return usage(`unknown routing observe option: ${arg}`)
    }
  }

  if (lane === undefined || lane.length === 0) return usage("routing observe requires --lane <lane>")
  if (workType === undefined || workType.length === 0) return usage("routing observe requires --work-type <workType>")
  if (verdict === undefined) return usage("routing observe requires --verdict <verdict>")
  if (note === undefined || note.length === 0) return usage("routing observe requires --note <note>")

  return {
    name: "routing-observe",
    dbPath,
    json,
    observation: {
      id: id ?? `cli:${ts}:${randomUUID()}`,
      ts,
      machine,
      session,
      agent,
      lane,
      workType,
      verdict,
      note,
      evidence,
      confidence,
    },
  }
}

function parseRoutingLanes(argv: readonly string[], base: BaseCommand): RoutingLanesCommand | CliUsageError {
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
      return usage(`unknown routing lanes option: ${arg}`)
    }
  }

  return { name: "routing-lanes", dbPath, json }
}

function parseRoutingBrief(argv: readonly string[], base: BaseCommand): RoutingBriefCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let lane: string | undefined

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
    } else if (arg === "--lane") {
      const value = requiredValue(argv, index, "--lane")
      if (value instanceof CliUsageError) return value
      lane = value
      index += 1
    } else if (arg?.startsWith("--lane=")) {
      lane = arg.slice("--lane=".length)
    } else {
      return usage(`unknown routing brief option: ${arg}`)
    }
  }

  return { name: "routing-brief", dbPath, json, lane }
}

function parseRoutingLog(argv: readonly string[], base: BaseCommand): RoutingLogCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let lane: string | undefined
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
    } else if (arg === "--lane") {
      const value = requiredValue(argv, index, "--lane")
      if (value instanceof CliUsageError) return value
      lane = value
      index += 1
    } else if (arg?.startsWith("--lane=")) {
      lane = arg.slice("--lane=".length)
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
      return usage(`unknown routing log option: ${arg}`)
    }
  }

  return { name: "routing-log", dbPath, json, filters: { lane, limit } }
}

function parseRoutingSeed(argv: readonly string[], base: BaseCommand): RoutingSeedCommand | CliUsageError {
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
      return usage(`unknown routing seed option: ${arg}`)
    }
  }

  return { name: "routing-seed", dbPath, json }
}

function parseStats(argv: readonly string[], base: BaseCommand): StatsCommand | CliUsageError {
  const subcommand = argv[0]
  if (subcommand === undefined) return usage("stats requires a subcommand: lanes|agents|sessions")

  switch (subcommand) {
    case "lanes":
      return parseStatsSubcommand(argv.slice(1), base, "stats-lanes")
    case "agents":
      return parseStatsSubcommand(argv.slice(1), base, "stats-agents")
    case "sessions":
      return parseStatsSubcommand(argv.slice(1), base, "stats-sessions")
    default:
      return usage(`unknown stats subcommand: ${subcommand}`)
  }
}

function parseStatsSubcommand(argv: readonly string[], base: BaseCommand, name: StatsCommand["name"]): StatsCommand | CliUsageError {
  let dbPath = base.dbPath
  let json = base.json
  let sinceTs: number | undefined

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
    } else {
      return usage(`unknown stats ${name.slice("stats-".length)} option: ${arg}`)
    }
  }

  return { name, dbPath, json, sinceTs } as StatsCommand
}

function parseOps(argv: readonly string[], base: BaseCommand): OpsCommand | CliUsageError {
  const subcommand = argv[0]
  const names = {
    sessions: "ops-sessions",
    routes: "ops-routes",
    diagnostics: "ops-diagnostics",
    canaries: "ops-canaries",
    releases: "ops-releases",
  } as const
  if (subcommand === undefined || !(subcommand in names)) {
    return usage("ops requires a subcommand: sessions|routes|diagnostics|canaries|releases")
  }
  let dbPath = base.dbPath
  let json = base.json
  let limit = 50
  const args = argv.slice(1)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--db") {
      const value = requiredValue(args, index, "--db")
      if (value instanceof CliUsageError) return value
      dbPath = value
      index += 1
    } else if (arg?.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length)
    } else if (arg === "--limit") {
      const value = requiredValue(args, index, "--limit")
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
      return usage(`unknown ops ${subcommand} option: ${arg}`)
    }
  }
  return { name: names[subcommand as keyof typeof names], dbPath, json, options: { limit } }
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

function parseConfidence(value: string): number | CliUsageError {
  const confidence = Number(value)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return usage(`invalid --confidence: ${value}`)
  return confidence
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

function renderPapercutTable(result: PapercutReportResult): string {
  return renderTable(
    ["fingerprint", "status", "occurrences"],
    [[result.record.fingerprint, result.record.status, result.record.occurrences]],
  )
}

function renderRoutingObserveTable(result: RoutingObserveResult): string {
  return renderTable(["id", "inserted"], [[result.id, result.inserted ? "true" : "false"]])
}

function renderLaneStateTable(rows: readonly LaneStateRow[]): string {
  return renderTable(
    ["lane", "status", "costTier", "exhaustedUntilTs", "defaultFor", "notes", "updatedTs", "updatedBy"],
    rows.map((row) => [
      row.lane,
      row.status,
      row.costTier ?? "",
      row.exhaustedUntilTs ?? "",
      row.defaultFor ?? "",
      row.notes ?? "",
      row.updatedTs,
      row.updatedBy,
    ]),
  )
}

function renderLaneBriefTable(brief: LaneBrief): string {
  return renderTable(
    ["lane", "status", "costTier", "recentObservations"],
    brief.entries.map((entry) => [
      entry.lane,
      entry.state?.status ?? "",
      entry.state?.costTier ?? "",
      entry.observations.map((row) => `${row.verdict}:${row.workType}:${row.note}`).join(" | "),
    ]),
  )
}

function renderRoutingLogTable(rows: readonly RoutingObservationRow[]): string {
  return renderTable(
    ["ts", "lane", "workType", "verdict", "confidence", "evidence", "note"],
    rows.map((row) => [
      row.ts,
      row.lane,
      row.workType,
      row.verdict,
      row.confidence ?? "",
      row.evidence ?? "",
      row.note,
    ]),
  )
}

function renderRoutingSeedTable(result: RoutingSeedResult): string {
  return renderTable(
    ["observationsInserted", "observationsIgnored", "laneStatesWritten"],
    [[result.observationsInserted, result.observationsIgnored, result.laneStatesWritten]],
  )
}

function renderOperationalSessionsTable(rows: readonly OperationalSessionDto[]): string {
  return renderTable(["session", "runners", "routes", "diagnostics", "lagMs", "stale", "gap", "missingLinks"], rows.map((row) => [
    row.sessionId,
    row.runnerInstanceIds.length,
    row.routeCount,
    row.diagnosticCount,
    row.lagMs,
    String(row.stale),
    String(row.gap),
    row.missingLinks.join(","),
  ]))
}

function renderOperationalRoutesTable(rows: readonly OperationalRouteDto[]): string {
  return renderTable(["resolution", "session", "agent", "revision", "lane", "provider", "model", "kind", "lagMs", "stale", "gap", "missingLinks"], rows.map((row) => [
    row.routeResolutionId,
    row.sourceSessionId,
    row.agentId,
    row.agentSeq,
    row.lane,
    row.provider,
    row.model,
    row.changeKind,
    row.lagMs,
    String(row.stale),
    String(row.gap),
    row.missingLinks.join(","),
  ]))
}

function renderOperationalDiagnosticsTable(rows: readonly OperationalDiagnosticDto[]): string {
  return renderTable(["diagnostic", "session", "kind", "phase", "state", "artifacts", "lagMs", "stale", "gap", "missingLinks"], rows.map((row) => [
    row.diagnosticId,
    row.sessionId ?? "",
    row.failureClass,
    row.phase,
    row.projectionState ?? "",
    row.artifactCount,
    row.lagMs,
    String(row.stale),
    String(row.gap),
    row.missingLinks.join(","),
  ]))
}

function renderOperationalCanariesTable(rows: readonly OperationalCanaryDto[]): string {
  return renderTable(["canary", "version", "build", "runner", "session", "promotions", "lagMs", "stale", "gap", "missingLinks", "mismatches"], rows.map((row) => [
    row.canaryRunId,
    row.version,
    row.buildDigest,
    row.runnerInstanceId,
    row.fixtureSessionId,
    row.releasePromotionIds.length,
    row.lagMs,
    String(row.stale),
    String(row.gap),
    row.missingLinks.join(","),
    row.mismatches.join(","),
  ]))
}

function renderOperationalReleasesTable(rows: readonly OperationalReleaseDto[]): string {
  return renderTable(["promotion", "kind", "fromBuild", "toBuild", "canary", "registry", "lagMs", "stale", "gap", "missingLinks", "mismatches"], rows.map((row) => [
    row.promotionId,
    row.operation,
    row.fromBuildDigest ?? "",
    row.toBuildDigest,
    row.canaryRunId ?? "",
    row.registryObservationId ?? "",
    row.lagMs,
    String(row.stale),
    String(row.gap),
    row.missingLinks.join(","),
    row.mismatches.join(","),
  ]))
}
function renderStatsLanesTable(rows: readonly UsageByLaneHourRow[]): string {
  return renderTable(
    ["lane", "hourBucket", "calls", "tokensIn", "tokensOut", "cacheRead", "cost", "avgLatencyMs", "tokensPerMinute", "tokensPerSecond", "avgTtftMs", "reasoningTokens"],
    rows.map((row) => [
      row.lane,
      row.hourBucket,
      row.calls,
      row.tokensIn,
      row.tokensOut,
      row.cacheRead,
      row.cost,
      row.avgLatencyMs,
      row.tokensPerMinute,
      row.tokensPerSecond,
      row.avgTtftMs,
      row.reasoningTokens,
    ]),
  )
}

function renderStatsAgentsTable(rows: readonly UsageByAgentRow[]): string {
  return renderTable(
    ["agent", "lane", "calls", "tokensIn", "tokensOut", "cacheRead", "cost", "avgLatencyMs", "firstTs", "lastTs", "tokensPerMinute", "tokensPerSecond", "avgTtftMs", "reasoningTokens"],
    rows.map((row) => [
      row.agent,
      row.lane,
      row.calls,
      row.tokensIn,
      row.tokensOut,
      row.cacheRead,
      row.cost,
      row.avgLatencyMs,
      row.firstTs,
      row.lastTs,
      row.tokensPerMinute,
      row.tokensPerSecond,
      row.avgTtftMs,
      row.reasoningTokens,
    ]),
  )
}

function renderStatsSessionsTable(rows: readonly UsageBySessionRow[]): string {
  return renderTable(
    ["session", "lane", "calls", "tokensIn", "tokensOut", "cacheRead", "cost", "avgLatencyMs", "firstTs", "lastTs", "tokensPerMinute", "tokensPerSecond", "avgTtftMs", "reasoningTokens"],
    rows.map((row) => [
      row.session,
      row.lane,
      row.calls,
      row.tokensIn,
      row.tokensOut,
      row.cacheRead,
      row.cost,
      row.avgLatencyMs,
      row.firstTs,
      row.lastTs,
      row.tokensPerMinute,
      row.tokensPerSecond,
      row.avgTtftMs,
      row.reasoningTokens,
    ]),
  )
}

type TableCell = string | number | null

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
  return new CliUsageError(`${message}. usage: control-plane <status|model-calls|events|ingest|papercut|routing|stats|ops|queue> [--db <path>] [--json]`)
}

if (import.meta.main) {
  runCli().then((code) => {
    process.exitCode = code
  }).catch((cause) => {
    writeJsonError({ class: "Error", error: cause instanceof Error ? cause.message : String(cause) })
    process.exitCode = 1
  })
}
