#!/usr/bin/env bun

import {
  inspectStorage,
  maintainStorage,
  type StorageAction,
  type StorageConfig,
  type StorageMaintenanceResult,
  type StorageStatus,
} from "./storage"

const FLEET_TIMEOUT_MS = 5_000
const FLEET_OUTPUT_LIMIT_BYTES = 1024 * 1024
const PATH_OPTIONS = new Set(["outbox-dir", "archive-dir", "state-db-path", "raw-dir"])
const INTEGER_OPTIONS = new Set([
  "segment-bytes",
  "hot-quota-bytes",
  "archive-quota-bytes",
  "raw-ttl-ms",
  "raw-quota-bytes",
  "max-actions-per-run",
])
const FLAG_OPTIONS = new Set(["json", "dry-run", "apply"])

interface ParsedOptions {
  readonly config: Partial<StorageConfig>
  readonly json: boolean
  readonly dryRun: boolean
  readonly apply: boolean
}

class UsageError extends Error {}

export async function runStorageCli(argv: readonly string[]): Promise<number> {
  try {
    const command = argv[0]
    if (command !== "status" && command !== "maintain") {
      throw new UsageError("expected status or maintain")
    }

    const options = parseOptions(argv.slice(1))
    validateMode(command, options)
    const activeSessionIds = await discoverActiveSessionIds()

    if (command === "status") {
      const status = inspectStorage(options.config, activeSessionIds)
      writeOutput(projectStatus(status), options.json)
      return statusHasFailures(status) ? 2 : 0
    }

    const mode = options.apply ? "apply" : "dry-run"
    const result = await maintainStorage({ config: options.config, mode, activeSessionIds })
    writeOutput(projectMaintenanceResult(result), options.json)
    return statusHasFailures(result.after) ? 2 : 0
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`storage: ${cause.message}`)
    } else {
      console.error("storage: runtime failure")
    }
    return 1
  }
}

export async function discoverActiveSessionIds(): Promise<readonly string[] | undefined> {
  let subprocess: Bun.Subprocess<"ignore", "pipe", "ignore">
  try {
    subprocess = Bun.spawn(["omp", "fleet", "overview", "--json"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
  } catch {
    return undefined
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const timedOut = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), FLEET_TIMEOUT_MS)
    })
    const completed = Promise.all([subprocess.exited, readBoundedText(subprocess.stdout)])
    const outcome = await Promise.race([completed, timedOut])
    if (outcome === null) {
      try {
        subprocess.kill()
      } catch {
        return undefined
      }
      return undefined
    }

    const [exitCode, text] = outcome
    if (exitCode !== 0) return undefined
    return parseActiveSessionIds(text)
  } catch {
    try {
      subprocess.kill()
    } catch {
      return undefined
    }
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values = new Map<string, string>()
  const flags = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined || !argument.startsWith("--")) {
      throw new UsageError("unexpected positional argument")
    }

    const equalsIndex = argument.indexOf("=")
    const key = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex)
    if (!PATH_OPTIONS.has(key) && !INTEGER_OPTIONS.has(key) && !FLAG_OPTIONS.has(key)) {
      throw new UsageError("unknown option")
    }
    if (values.has(key) || flags.has(key)) throw new UsageError("duplicate option")

    if (FLAG_OPTIONS.has(key)) {
      if (equalsIndex !== -1) throw new UsageError("flags do not accept values")
      flags.add(key)
      continue
    }

    const value = equalsIndex === -1 ? argv[index + 1] : argument.slice(equalsIndex + 1)
    if (value === undefined || value.length === 0 || (equalsIndex === -1 && value.startsWith("--"))) {
      throw new UsageError("option requires a value")
    }
    values.set(key, value)
    if (equalsIndex === -1) index += 1
  }

  return {
    config: parseConfig(values),
    json: flags.has("json"),
    dryRun: flags.has("dry-run"),
    apply: flags.has("apply"),
  }
}

function parseConfig(values: ReadonlyMap<string, string>): Partial<StorageConfig> {
  const config: { -readonly [Key in keyof StorageConfig]?: StorageConfig[Key] } = {}

  const outboxDir = values.get("outbox-dir")
  const archiveDir = values.get("archive-dir")
  const stateDbPath = values.get("state-db-path")
  const rawDir = values.get("raw-dir")
  if (outboxDir !== undefined) config.outboxDir = parsePath(outboxDir)
  if (archiveDir !== undefined) config.archiveDir = parsePath(archiveDir)
  if (stateDbPath !== undefined) config.stateDbPath = parsePath(stateDbPath)
  if (rawDir !== undefined) config.rawDir = parsePath(rawDir)

  const segmentBytes = values.get("segment-bytes")
  const hotQuotaBytes = values.get("hot-quota-bytes")
  const archiveQuotaBytes = values.get("archive-quota-bytes")
  const rawTtlMs = values.get("raw-ttl-ms")
  const rawQuotaBytes = values.get("raw-quota-bytes")
  const maxActionsPerRun = values.get("max-actions-per-run")
  if (segmentBytes !== undefined) config.segmentBytes = parsePositiveSafeInteger(segmentBytes)
  if (hotQuotaBytes !== undefined) config.hotQuotaBytes = parsePositiveSafeInteger(hotQuotaBytes)
  if (archiveQuotaBytes !== undefined) config.archiveQuotaBytes = parsePositiveSafeInteger(archiveQuotaBytes)
  if (rawTtlMs !== undefined) config.rawTtlMs = parsePositiveSafeInteger(rawTtlMs)
  if (rawQuotaBytes !== undefined) config.rawQuotaBytes = parsePositiveSafeInteger(rawQuotaBytes)
  if (maxActionsPerRun !== undefined) config.maxActionsPerRun = parsePositiveSafeInteger(maxActionsPerRun)

  return config
}

function parsePath(value: string): string {
  if (value.trim().length === 0) throw new UsageError("path option must not be blank")
  return value
}

function parsePositiveSafeInteger(value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new UsageError("numeric options require positive safe integers")
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new UsageError("numeric options require positive safe integers")
  }
  return parsed
}

function validateMode(command: "status" | "maintain", options: ParsedOptions): void {
  if (options.apply && options.dryRun) throw new UsageError("--apply and --dry-run are mutually exclusive")
  if (command === "status" && (options.apply || options.dryRun)) {
    throw new UsageError("maintenance mode flags require maintain")
  }
}

async function readBoundedText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let byteCount = 0
  let text = ""
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      byteCount += result.value.byteLength
      if (byteCount > FLEET_OUTPUT_LIMIT_BYTES) throw new Error("fleet output limit exceeded")
      text += decoder.decode(result.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseActiveSessionIds(text: string): readonly string[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(value)) return undefined

  const ids = new Set<string>()
  for (const record of value) {
    if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined
    const sessionId = Reflect.get(record, "session_id")
    if (typeof sessionId !== "string" || sessionId.length === 0) return undefined
    ids.add(sessionId)
  }
  return [...ids].sort(compareStrings)
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

interface OutputStorageStatus {
  readonly generatedAt: StorageStatus["generatedAt"]
  readonly bytes: StorageStatus["bytes"]
  readonly activeWriters: StorageStatus["activeWriters"]
  readonly segments: StorageStatus["segments"]
  readonly ingestProgress: StorageStatus["ingestProgress"]
  readonly reclaimableBytes: StorageStatus["reclaimableBytes"]
  readonly oldestTimestamp: StorageStatus["oldestTimestamp"]
  readonly quotaViolations: StorageStatus["quotaViolations"]
  readonly actions: readonly StorageAction[]
  readonly healthErrors: readonly string[]
  readonly corruptionErrors: readonly string[]
}

interface OutputMaintenanceResult {
  readonly mode: StorageMaintenanceResult["mode"]
  readonly startedAt: StorageMaintenanceResult["startedAt"]
  readonly finishedAt: StorageMaintenanceResult["finishedAt"]
  readonly before: OutputStorageStatus
  readonly after: OutputStorageStatus
  readonly actions: readonly StorageAction[]
}

function projectStatus(status: StorageStatus): OutputStorageStatus {
  return {
    generatedAt: status.generatedAt,
    bytes: status.bytes,
    activeWriters: status.activeWriters,
    segments: status.segments,
    ingestProgress: status.ingestProgress,
    reclaimableBytes: status.reclaimableBytes,
    oldestTimestamp: status.oldestTimestamp,
    quotaViolations: status.quotaViolations,
    actions: status.actions,
    healthErrors: sanitizeErrorCodes(status.healthErrors, "storage_health_failure"),
    corruptionErrors: sanitizeErrorCodes(status.corruptionErrors, "storage_corruption"),
  }
}

function sanitizeErrorCodes(values: readonly unknown[], fallback: string): readonly string[] {
  const sanitized: string[] = []
  for (const value of values) {
    sanitized.push(
      typeof value === "string" && value.length > 0 && value.length <= 80 && /^[A-Za-z0-9_.:-]+$/.test(value)
        ? value
        : fallback,
    )
  }
  return sanitized
}

function projectMaintenanceResult(result: StorageMaintenanceResult): OutputMaintenanceResult {
  return {
    mode: result.mode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    before: projectStatus(result.before),
    after: projectStatus(result.after),
    actions: result.actions,
  }
}

function statusHasFailures(status: StorageStatus): boolean {
  return status.quotaViolations.length > 0 || status.corruptionErrors.length > 0 || status.healthErrors.length > 0
}

function writeOutput(value: OutputStorageStatus | OutputMaintenanceResult, json: boolean): void {
  console.log(json ? stableJson(value) : renderTable(value))
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== "object") return value

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort(compareStrings)) {
    const child = Reflect.get(value, key)
    if (child !== undefined) output[key] = canonicalize(child)
  }
  return output
}

function renderTable(value: OutputStorageStatus | OutputMaintenanceResult): string {
  const rows: Array<readonly [string, string]> = []
  flattenRows(value, "", rows)
  const fieldWidth = Math.max("FIELD".length, ...rows.map(([field]) => field.length))
  return [
    `${"FIELD".padEnd(fieldWidth)}  VALUE`,
    `${"-".repeat(fieldWidth)}  -----`,
    ...rows.map(([field, cell]) => `${field.padEnd(fieldWidth)}  ${cell}`),
  ].join("\n")
}

function flattenRows(value: unknown, prefix: string, rows: Array<readonly [string, string]>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort(compareStrings)) {
      const child = Reflect.get(value, key)
      if (child === undefined) continue
      const label = prefix.length === 0 ? key : `${prefix}.${key}`
      flattenRows(child, label, rows)
    }
    return
  }
  rows.push([prefix, Array.isArray(value) ? stableJson(value) : renderScalar(value)])
}

function renderScalar(value: unknown): string {
  if (value === null) return "-"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return stableJson(value)
}

if (import.meta.main) {
  runStorageCli(Bun.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}
