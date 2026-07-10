#!/usr/bin/env bun

import { Effect, FileSystem, Layer, Option, Path, Schema, Stdio, Terminal } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import { StorageError } from "./errors"
import { EvidenceBundleV1Schema, type EvidenceBundleV1, type TrustLabel } from "./evidence"
import { EvidenceStore, openEvidenceStore } from "./evidence-ingest"
import { exportFrontierCsv, exportFrontierJson, exportFrontierSvg } from "./evidence-export"
import { frontierAxisId, queryFrontier, type FrontierAxis, type FrontierBoundsMode, type FrontierDirection, type FrontierReducer, type FrontierResult } from "./frontier"
import { defaultLedgerPath } from "./ledger"

const trustLabels = ["official", "primary", "independent", "secondary", "local", "inferred"] as const
const definitionKinds = ["benchmark", "local_outcome"] as const
const evidenceKinds = ["external_benchmark", "local_evaluation"] as const
const catalogReadinesses = ["unreleased", "released", "data_available", "ingested", "blocked", "retired"] as const
const ingestMethods = ["manual", "api", "download", "scrape", "unknown"] as const
const saturationStatuses = ["unknown", "active", "warning", "saturated"] as const
const exportFormats = ["json", "csv", "svg"] as const

class EvidenceCliUsageError extends Error {}

interface ParsedAxis extends FrontierAxis {}
interface FrontierOptions {
  readonly workClass: string
  readonly includeIncomplete: boolean
  readonly since: Option.Option<number>
  readonly until: Option.Option<number>
  readonly evidenceKind: Option.Option<(typeof evidenceKinds)[number]>
  readonly trust: readonly TrustLabel[]
  readonly taskModality: Option.Option<string>
  readonly harnessProfile: Option.Option<string>
  readonly toolProfile: Option.Option<string>
  readonly contextProfile: Option.Option<string>
  readonly provider: Option.Option<string>
  readonly model: Option.Option<string>
  readonly account: Option.Option<string>
  readonly effort: Option.Option<string>
}
const cliRuntime = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(Terminal.Terminal, Terminal.make({
    columns: Effect.succeed(process.stdout.columns ?? 80),
    rows: Effect.succeed(process.stdout.rows ?? 24),
    readInput: Effect.die("Interactive input is unavailable"),
    readLine: Effect.die("Interactive input is unavailable"),
    display: (text) => Effect.sync(() => process.stdout.write(text)),
  })),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => Effect.die("Child process spawning is unavailable"))),
)

const shared = {
  db: Flag.withDefault(Flag.string("db"), defaultLedgerPath()),
  json: Flag.boolean("json"),
}
const frontierFlags = {
  workClass: Flag.string("work-class"),
  axis: Flag.atLeast(Flag.string("axis"), 2),
  includeIncomplete: Flag.boolean("include-incomplete"),
  since: Flag.optional(Flag.integer("since")),
  until: Flag.optional(Flag.integer("until")),
  evidenceKind: Flag.optional(Flag.choice("evidence-kind", evidenceKinds)),
  trust: Flag.atLeast(Flag.choice("trust", trustLabels), 0),
  taskModality: Flag.optional(Flag.string("task-modality")),
  harnessProfile: Flag.optional(Flag.string("harness-profile")),
  toolProfile: Flag.optional(Flag.string("tool-profile")),
  contextProfile: Flag.optional(Flag.string("context-profile")),
  provider: Flag.optional(Flag.string("provider")),
  model: Flag.optional(Flag.string("model")),
  account: Flag.optional(Flag.string("account")),
  effort: Flag.optional(Flag.string("effort")),
}

const ingestCommand = Command.make("ingest", { ...shared, from: Flag.string("from") }, ({ db, from, json }) =>
  Effect.gen(function*() {
    const bundle = yield* readBundle(from)
    const store = yield* EvidenceStore
    yield* writeResult(yield* store.ingestBundle(bundle), json)
  }).pipe(Effect.provide(openEvidenceStore(db))))

const listCommand = Command.make("list", {
  ...shared,
  kind: Flag.choice("kind", ["sources", "benchmarks", "catalog", "saturation", "rates", "runs", "measurements"] as const),
  source: Flag.optional(Flag.string("source")), trust: Flag.optional(Flag.choice("trust", trustLabels)), sourceKind: Flag.optional(Flag.string("source-kind")),
  definitionKind: Flag.optional(Flag.choice("definition-kind", definitionKinds)), workClass: Flag.optional(Flag.string("work-class")), benchmark: Flag.optional(Flag.string("benchmark")),
  readiness: Flag.optional(Flag.choice("readiness", catalogReadinesses)), ingestMethod: Flag.optional(Flag.choice("ingest-method", ingestMethods)), catalog: Flag.optional(Flag.string("catalog")), cohort: Flag.optional(Flag.string("cohort")), saturationStatus: Flag.optional(Flag.choice("saturation-status", saturationStatuses)),
  provider: Flag.optional(Flag.string("provider")), model: Flag.optional(Flag.string("model")), evidenceKind: Flag.optional(Flag.choice("evidence-kind", evidenceKinds)),
  run: Flag.optional(Flag.string("run")), metricDefinition: Flag.optional(Flag.string("metric-definition")), metric: Flag.optional(Flag.string("metric")), since: Flag.optional(Flag.integer("since")), limit: Flag.withDefault(Flag.integer("limit"), 50),
}, (options) => Effect.gen(function*() {
  const store = yield* EvidenceStore
  const since = optionValue(options.since)
  switch (options.kind) {
    case "sources": yield* writeResult(yield* store.listSources({ trustLabel: optionValue(options.trust), sourceKind: optionValue(options.sourceKind), since, limit: options.limit }), options.json); return
    case "benchmarks": yield* writeResult(yield* store.listMetricDefinitions({ definitionKind: optionValue(options.definitionKind), workClass: optionValue(options.workClass), definitionKey: optionValue(options.benchmark), limit: options.limit }), options.json); return
    case "catalog": yield* writeResult(yield* store.listBenchmarkCatalog({ readiness: optionValue(options.readiness), ingestMethod: optionValue(options.ingestMethod), since, limit: options.limit }), options.json); return
    case "saturation": yield* writeResult(yield* store.listBenchmarkSaturationAssessments({ benchmarkCatalogId: optionValue(options.catalog), cohortKey: optionValue(options.cohort), status: optionValue(options.saturationStatus), since, limit: options.limit }), options.json); return
    case "rates": yield* writeResult(yield* store.listCommercialFacts({ sourceId: optionValue(options.source), provider: optionValue(options.provider), model: optionValue(options.model), since, limit: options.limit }), options.json); return
    case "runs": yield* writeResult(yield* store.listRuns({ sourceId: optionValue(options.source), workClass: optionValue(options.workClass), evidenceKind: optionValue(options.evidenceKind), provider: optionValue(options.provider), model: optionValue(options.model), since, limit: options.limit }), options.json); return
    case "measurements": yield* writeResult(yield* store.listMeasurements({ runId: optionValue(options.run), metricDefinitionId: optionValue(options.metricDefinition), metricKey: optionValue(options.metric), limit: options.limit }), options.json); return
  }
}).pipe(Effect.provide(openEvidenceStore(options.db))))

const frontierCommand = Command.make("frontier", { ...shared, ...frontierFlags }, (options) =>
  Effect.gen(function*() {
    const axes = yield* parseAxes(options.axis)
    yield* writeResult(yield* queryFrontier(options.db, frontierQuery(options, axes)), options.json)
  }))

const exportCommand = Command.make("export", { ...shared, ...frontierFlags, format: Flag.choice("format", exportFormats), out: Flag.optional(Flag.string("out")), x: Flag.optional(Flag.string("x")), y: Flag.optional(Flag.string("y")) }, (options) =>
  Effect.gen(function*() {
    const axes = yield* parseAxes(options.axis)
    const result = yield* queryFrontier(options.db, frontierQuery(options, axes))
    const output = yield* exportResult(result, options.format, optionValue(options.x), optionValue(options.y))
    const out = optionValue(options.out)
    if (out === undefined) yield* Effect.sync(() => process.stdout.write(output))
    else yield* Effect.tryPromise({ try: () => Bun.write(out, output), catch: (cause) => storageError("write evidence export", cause) })
  }))

export const evidenceCommand = Command.make("evidence").pipe(Command.withDescription("Evidence ledger commands"), Command.withSubcommands([ingestCommand, listCommand, frontierCommand, exportCommand]))
export const evidenceCli = Command.runWith(evidenceCommand, { version: "0.1.0" })

export async function runEvidenceCli(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  try { await Effect.runPromise(evidenceCli(argv).pipe(Effect.provide(cliRuntime))); return 0 } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    process.stderr.write(argv.includes("--json") ? `${JSON.stringify({ class: "EvidenceCliError", error: message })}\n` : `${message}\n`)
    return 1
  }
}

function readBundle(path: string): Effect.Effect<EvidenceBundleV1, EvidenceCliUsageError> {
  return Effect.tryPromise({ try: () => Bun.file(path).text(), catch: (cause) => new EvidenceCliUsageError(causeMessage(cause)) }).pipe(Effect.flatMap((text) => Effect.try({ try: () => JSON.parse(text), catch: () => new EvidenceCliUsageError("Invalid JSON bundle") })), Effect.flatMap((value) => {
    const decoded = Schema.decodeUnknownOption(EvidenceBundleV1Schema)(value)
    return Option.isSome(decoded) ? Effect.succeed(decoded.value) : Effect.fail(new EvidenceCliUsageError("Bundle does not match EvidenceBundleV1"))
  }))
}

function parseAxes(values: readonly string[]): Effect.Effect<readonly [FrontierAxis, FrontierAxis, ...FrontierAxis[]], EvidenceCliUsageError> {
  const [first, second, ...rest] = values
  if (first === undefined || second === undefined) return Effect.fail(new EvidenceCliUsageError("At least two --axis values are required"))
  const firstAxis = parseAxis(first); const secondAxis = parseAxis(second)
  if (firstAxis instanceof Error) return Effect.fail(firstAxis)
  if (secondAxis instanceof Error) return Effect.fail(secondAxis)
  const axes: FrontierAxis[] = [firstAxis, secondAxis]
  for (const value of rest) { const axis = parseAxis(value); if (axis instanceof Error) return Effect.fail(axis); axes.push(axis) }
  return Effect.succeed([firstAxis, secondAxis, ...axes.slice(2)])
}

export function parseAxis(value: string): ParsedAxis | EvidenceCliUsageError {
  const [definition, metricKey, unit, direction, reducer, boundsMode, extra] = value.split(":")
  if (definition === undefined || definition.length === 0 || extra !== undefined || metricKey === undefined || metricKey.length === 0 || unit === undefined || unit.length === 0 || !isDirection(direction) || !isReducer(reducer) || !isBoundsMode(boundsMode)) return new EvidenceCliUsageError("--axis must be definition-or-:metric:unit:direction:reducer:bounds")
  return { metricDefinitionId: definition === "-" ? undefined : definition, metricKey, unit, direction, reducer, boundsMode }
}

function frontierQuery(options: FrontierOptions, axes: readonly [FrontierAxis, FrontierAxis, ...FrontierAxis[]]) {
  return { workClass: options.workClass, axes, includeIncomplete: options.includeIncomplete, since: optionValue(options.since), until: optionValue(options.until), evidenceKind: optionValue(options.evidenceKind), trustLabels: optionalTrustLabels(options.trust), taskModality: optionValue(options.taskModality), harnessProfile: optionValue(options.harnessProfile), toolProfile: optionValue(options.toolProfile), contextProfile: optionValue(options.contextProfile), provider: optionValue(options.provider), model: optionValue(options.model), account: optionValue(options.account), effort: optionValue(options.effort) }
}

function exportResult(result: FrontierResult, format: (typeof exportFormats)[number], xAxis: string | undefined, yAxis: string | undefined): Effect.Effect<string, EvidenceCliUsageError> {
  if (format === "json") return Effect.succeed(exportFrontierJson(result))
  if (format === "csv") return Effect.succeed(exportFrontierCsv(result))
  return xAxis === undefined || yAxis === undefined ? Effect.fail(new EvidenceCliUsageError("SVG export requires --x and --y frontier axis IDs")) : Effect.succeed(exportFrontierSvg(result, { xAxis, yAxis }))
}

function writeResult(result: object | readonly object[], json: boolean): Effect.Effect<void> { return Effect.sync(() => process.stdout.write(renderEvidenceResult(result, json))) }
function optionValue<A>(value: Option.Option<A>): A | undefined { return Option.isSome(value) ? value.value : undefined }
export function optionalTrustLabels(labels: readonly TrustLabel[]): readonly TrustLabel[] | undefined { return labels.length === 0 ? undefined : labels }
function storageError(operation: string, cause: unknown): StorageError { return new StorageError({ operation, message: causeMessage(cause) }) }
function causeMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
export function renderEvidenceResult(result: object | readonly object[], json: boolean): string { return json ? `${JSON.stringify(result)}\n` : ["result", "------", ...(Array.isArray(result) ? result : [result]).map((row) => JSON.stringify(row))].join("\n") + "\n" }
function isDirection(value: string | undefined): value is FrontierDirection { return value === "maximize" || value === "minimize" }
function isReducer(value: string | undefined): value is FrontierReducer { return value === "latest" || value === "mean" || value === "median" || value === "sum" || value === "rate" }
function isBoundsMode(value: string | undefined): value is FrontierBoundsMode { return value === "point" || value === "conservative" }
export function axisId(axis: FrontierAxis): string { return frontierAxisId(axis) }
if (import.meta.main) { runEvidenceCli().then((code) => { process.exitCode = code }) }
