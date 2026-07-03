import {
  ensureNitterBackfillTargetsTable,
  NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS,
  NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS,
  NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_CONCURRENCY,
  NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS,
  runNitterBackfillWorker,
  type NitterBackfillWorkerRunSummary,
  type NitterBackfillWorkerTargetStatus,
} from "./backfill-worker"
import { readTwitterArchiveConfig, type TwitterArchiveConfigEnv } from "./effect-services"
import { appendTwitterArchiveJsonlLog } from "./jsonl-log"
import type { MediaDownloadFetchFunction } from "./media-download"
import type { NitterFetchFunction } from "./nitter"
import { initTwitterArchiveSqliteStore, type TwitterArchiveSqliteStore } from "./sqlite-store"

export const QUEUED_NITTER_BACKFILL_DEFAULT_INTERVAL_MS = 60_000
export const QUEUED_NITTER_BACKFILL_DEFAULT_LIMIT = 1
export const QUEUED_NITTER_BACKFILL_DEFAULT_BATCH_PAGES = 1

export interface QueuedNitterBackfillWorkerCliEnv extends TwitterArchiveConfigEnv {
  readonly NITTER_QUEUED_BACKFILL_DAEMON?: string
  readonly NITTER_QUEUED_BACKFILL_ONCE?: string
  readonly NITTER_QUEUED_BACKFILL_INTERVAL_MS?: string
  readonly NITTER_QUEUED_BACKFILL_LIMIT?: string
  readonly NITTER_QUEUED_BACKFILL_COMPLETED_RESYNC_MS?: string
  readonly NITTER_QUEUED_BACKFILL_BATCH_PAGES?: string
  readonly NITTER_QUEUED_BACKFILL_DELAY_MS?: string
  readonly NITTER_QUEUED_BACKFILL_JITTER_MS?: string
  readonly NITTER_QUEUED_BACKFILL_MEDIA_CONCURRENCY?: string
  readonly NITTER_QUEUED_BACKFILL_MEDIA_MAX_ITEMS?: string
  readonly NITTER_QUEUED_BACKFILL_RUN_UNTIL_END?: string
}

export interface QueuedNitterBackfillWorkerCliOptions {
  readonly once: boolean
  readonly daemon: boolean
  readonly dbPath?: string
  readonly logPath?: string
  readonly mediaRoot?: string
  readonly baseUrl?: string
  readonly intervalMs?: number
  readonly limit?: number
  readonly completedResyncMs?: number
  readonly batchPages?: number
  readonly delayMs?: number
  readonly jitterMs?: number
  readonly mediaConcurrency?: number
  readonly mediaMaxItems?: number
  readonly runUntilEnd: boolean
}

export interface QueuedNitterBackfillWorkerOptions {
  readonly runId?: string
  readonly once?: boolean
  readonly daemon?: boolean
  readonly dbPath: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly baseUrl: string
  readonly intervalMs?: number
  readonly limit?: number
  readonly completedResyncMs?: number
  readonly batchPages?: number
  readonly delayMs?: number
  readonly jitterMs?: number
  readonly mediaConcurrency?: number
  readonly mediaMaxItems?: number
  readonly runUntilEnd?: boolean
  readonly fetchFn?: NitterFetchFunction
  readonly mediaFetchFn?: MediaDownloadFetchFunction
  readonly signal?: AbortSignal
  readonly now?: () => string
  readonly sleepFn?: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

export interface QueuedNitterBackfillSelectedTarget {
  readonly handleKey: string
  readonly handle: string
  readonly status: NitterBackfillWorkerTargetStatus
  readonly updatedAt: string
  readonly completedAt: string | null
  readonly requeuedForResync: boolean
}

export interface QueuedNitterBackfillWorkerCycleSummary {
  readonly runId: string
  readonly startedAt: string
  readonly selectedTargets: readonly QueuedNitterBackfillSelectedTarget[]
  readonly backfill: NitterBackfillWorkerRunSummary | null
}

export interface QueuedNitterBackfillWorkerSummary {
  readonly runId: string
  readonly mode: "once" | "daemon"
  readonly dbPath: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly baseUrl: string
  readonly intervalMs: number
  readonly limit: number
  readonly completedResyncMs: number | null
  readonly batchPages: number
  readonly runUntilEnd: boolean
  readonly cyclesCompleted: number
  readonly stoppedReason: "once" | "aborted"
  readonly lastCycle: QueuedNitterBackfillWorkerCycleSummary | null
}

interface QueuedNitterBackfillTargetRow {
  readonly handle_key: string
  readonly handle: string
  readonly status: NitterBackfillWorkerTargetStatus
  readonly updated_at: string
  readonly completed_at: string | null
}

interface NormalizedQueuedNitterBackfillWorkerOptions extends Required<Pick<QueuedNitterBackfillWorkerOptions, "dbPath" | "logPath" | "mediaRoot" | "baseUrl">> {
  readonly runId: string
  readonly daemon: boolean
  readonly intervalMs: number
  readonly limit: number
  readonly completedResyncMs: number | undefined
  readonly batchPages: number
  readonly delayMs: number
  readonly jitterMs: number
  readonly mediaConcurrency: number
  readonly mediaMaxItems: number
  readonly runUntilEnd: boolean
  readonly fetchFn: NitterFetchFunction | undefined
  readonly mediaFetchFn: MediaDownloadFetchFunction | undefined
  readonly signal: AbortSignal | undefined
  readonly now: () => string
  readonly sleepFn: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

export function parseQueuedNitterBackfillWorkerCliArgs(
  args: readonly string[],
  env: QueuedNitterBackfillWorkerCliEnv = {},
): QueuedNitterBackfillWorkerCliOptions {
  let daemon = parseBooleanFlag(env.NITTER_QUEUED_BACKFILL_DAEMON)
  if (parseBooleanFlag(env.NITTER_QUEUED_BACKFILL_ONCE)) {
    daemon = false
  }

  let dbPath: string | undefined
  let logPath: string | undefined
  let mediaRoot: string | undefined
  let baseUrl: string | undefined
  let intervalMs = parseOptionalNonNegativeInteger(env.NITTER_QUEUED_BACKFILL_INTERVAL_MS, "NITTER_QUEUED_BACKFILL_INTERVAL_MS")
  let limit = parseOptionalPositiveInteger(env.NITTER_QUEUED_BACKFILL_LIMIT, "NITTER_QUEUED_BACKFILL_LIMIT")
  let completedResyncMs = parseOptionalNonNegativeInteger(
    env.NITTER_QUEUED_BACKFILL_COMPLETED_RESYNC_MS,
    "NITTER_QUEUED_BACKFILL_COMPLETED_RESYNC_MS",
  )
  let batchPages = parseOptionalPositiveInteger(env.NITTER_QUEUED_BACKFILL_BATCH_PAGES, "NITTER_QUEUED_BACKFILL_BATCH_PAGES")
  let delayMs = parseOptionalNonNegativeInteger(env.NITTER_QUEUED_BACKFILL_DELAY_MS, "NITTER_QUEUED_BACKFILL_DELAY_MS")
  let jitterMs = parseOptionalNonNegativeInteger(env.NITTER_QUEUED_BACKFILL_JITTER_MS, "NITTER_QUEUED_BACKFILL_JITTER_MS")
  let mediaConcurrency = parseOptionalPositiveInteger(
    env.NITTER_QUEUED_BACKFILL_MEDIA_CONCURRENCY,
    "NITTER_QUEUED_BACKFILL_MEDIA_CONCURRENCY",
  )
  let mediaMaxItems = parseOptionalNonNegativeInteger(
    env.NITTER_QUEUED_BACKFILL_MEDIA_MAX_ITEMS,
    "NITTER_QUEUED_BACKFILL_MEDIA_MAX_ITEMS",
  )
  let runUntilEnd = parseBooleanFlag(env.NITTER_QUEUED_BACKFILL_RUN_UNTIL_END)

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--once") {
      daemon = false
      continue
    }

    if (arg === "--daemon") {
      daemon = true
      continue
    }

    if (arg === "--run-until-end") {
      runUntilEnd = true
      continue
    }

    if (arg === "--one-batch") {
      runUntilEnd = false
      continue
    }

    const intervalMsValue = readFlagValue(args, index, arg, "--interval-ms")
    if (intervalMsValue) {
      intervalMs = parseNonNegativeInteger(intervalMsValue.value, intervalMsValue.flag)
      index = intervalMsValue.index
      continue
    }

    const limitValue = readFlagValue(args, index, arg, "--limit")
    if (limitValue) {
      limit = parsePositiveInteger(limitValue.value, limitValue.flag)
      index = limitValue.index
      continue
    }

    const completedResyncValue = readFlagValue(args, index, arg, "--completed-resync-ms")
    if (completedResyncValue) {
      completedResyncMs = parseNonNegativeInteger(completedResyncValue.value, completedResyncValue.flag)
      index = completedResyncValue.index
      continue
    }

    const batchPagesValue = readFlagValue(args, index, arg, "--batch-pages") ?? readFlagValue(args, index, arg, "--max-pages")
    if (batchPagesValue) {
      batchPages = parsePositiveInteger(batchPagesValue.value, batchPagesValue.flag)
      index = batchPagesValue.index
      continue
    }

    const delayMsValue = readFlagValue(args, index, arg, "--delay-ms")
    if (delayMsValue) {
      delayMs = parseNonNegativeInteger(delayMsValue.value, delayMsValue.flag)
      index = delayMsValue.index
      continue
    }

    const jitterMsValue = readFlagValue(args, index, arg, "--jitter-ms")
    if (jitterMsValue) {
      jitterMs = parseNonNegativeInteger(jitterMsValue.value, jitterMsValue.flag)
      index = jitterMsValue.index
      continue
    }

    const mediaConcurrencyValue = readFlagValue(args, index, arg, "--media-concurrency")
    if (mediaConcurrencyValue) {
      mediaConcurrency = parsePositiveInteger(mediaConcurrencyValue.value, mediaConcurrencyValue.flag)
      index = mediaConcurrencyValue.index
      continue
    }

    const mediaMaxItemsValue = readFlagValue(args, index, arg, "--media-max-items")
    if (mediaMaxItemsValue) {
      mediaMaxItems = parseNonNegativeInteger(mediaMaxItemsValue.value, mediaMaxItemsValue.flag)
      index = mediaMaxItemsValue.index
      continue
    }

    const dbPathValue = readFlagValue(args, index, arg, "--db-path") ?? readFlagValue(args, index, arg, "--db")
    if (dbPathValue) {
      dbPath = dbPathValue.value
      index = dbPathValue.index
      continue
    }

    const logPathValue = readFlagValue(args, index, arg, "--log-path") ?? readFlagValue(args, index, arg, "--log")
    if (logPathValue) {
      logPath = logPathValue.value
      index = logPathValue.index
      continue
    }

    const mediaRootValue = readFlagValue(args, index, arg, "--media-root")
    if (mediaRootValue) {
      mediaRoot = mediaRootValue.value
      index = mediaRootValue.index
      continue
    }

    const baseUrlValue = readFlagValue(args, index, arg, "--base-url")
    if (baseUrlValue) {
      baseUrl = baseUrlValue.value
      index = baseUrlValue.index
      continue
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown queued Nitter backfill worker option: ${arg}`)
    }

    throw new Error(`Queued Nitter backfill worker does not accept positional handles: ${arg}`)
  }

  return pruneUndefined({
    once: !daemon,
    daemon,
    dbPath,
    logPath,
    mediaRoot,
    baseUrl,
    intervalMs,
    limit,
    completedResyncMs,
    batchPages,
    delayMs,
    jitterMs,
    mediaConcurrency,
    mediaMaxItems,
    runUntilEnd,
  })
}

export async function runQueuedNitterBackfillWorkerCli(
  args: readonly string[] = runtimeArgs(),
  env: QueuedNitterBackfillWorkerCliEnv = runtimeEnv(),
): Promise<QueuedNitterBackfillWorkerSummary> {
  const config = readTwitterArchiveConfig(env)
  const cli = parseQueuedNitterBackfillWorkerCliArgs(args, env)
  return runQueuedNitterBackfillWorker({
    runId: `queued-nitter-backfill-worker-${Date.now()}`,
    once: cli.once,
    daemon: cli.daemon,
    dbPath: cli.dbPath ?? config.dbPath,
    logPath: cli.logPath ?? config.logPath,
    mediaRoot: cli.mediaRoot ?? config.mediaRoot,
    baseUrl: cli.baseUrl ?? config.baseUrl,
    intervalMs: cli.intervalMs,
    limit: cli.limit,
    completedResyncMs: cli.completedResyncMs,
    batchPages: cli.batchPages,
    delayMs: cli.delayMs,
    jitterMs: cli.jitterMs,
    mediaConcurrency: cli.mediaConcurrency,
    mediaMaxItems: cli.mediaMaxItems,
    runUntilEnd: cli.runUntilEnd,
  })
}

export async function runQueuedNitterBackfillWorker(
  options: QueuedNitterBackfillWorkerOptions,
): Promise<QueuedNitterBackfillWorkerSummary> {
  const normalized = normalizeQueuedNitterBackfillWorkerOptions(options)
  let cyclesCompleted = 0
  let lastCycle: QueuedNitterBackfillWorkerCycleSummary | null = null
  let stoppedReason: "once" | "aborted" = normalized.daemon ? "aborted" : "once"

  while (!normalized.signal?.aborted) {
    const cycleRunId = normalized.daemon ? `${normalized.runId}-cycle-${cyclesCompleted + 1}` : normalized.runId
    lastCycle = await runQueuedNitterBackfillWorkerCycle(normalized, cycleRunId)
    cyclesCompleted += 1

    if (!normalized.daemon) {
      stoppedReason = "once"
      break
    }

    await normalized.sleepFn(normalized.intervalMs, normalized.signal)
  }

  return {
    runId: normalized.runId,
    mode: normalized.daemon ? "daemon" : "once",
    dbPath: normalized.dbPath,
    logPath: normalized.logPath,
    mediaRoot: normalized.mediaRoot,
    baseUrl: normalizeBaseUrl(normalized.baseUrl),
    intervalMs: normalized.intervalMs,
    limit: normalized.limit,
    completedResyncMs: normalized.completedResyncMs ?? null,
    batchPages: normalized.batchPages,
    runUntilEnd: normalized.runUntilEnd,
    cyclesCompleted,
    stoppedReason,
    lastCycle,
  }
}

async function runQueuedNitterBackfillWorkerCycle(
  options: NormalizedQueuedNitterBackfillWorkerOptions,
  runId: string,
): Promise<QueuedNitterBackfillWorkerCycleSummary> {
  const startedAt = options.now()
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const selectedTargets = selectAndRequeueDueTargets({
    dbPath: options.dbPath,
    baseUrl,
    limit: options.limit,
    completedResyncMs: options.completedResyncMs,
    now: startedAt,
    runId,
  })

  await appendTwitterArchiveJsonlLog(options.logPath, {
    component: "queued-nitter-backfill-worker",
    level: "info",
    event: selectedTargets.length === 0 ? "queue.idle" : "queue.selected",
    runId,
    details: {
      dbPath: options.dbPath,
      baseUrl,
      limit: options.limit,
      completedResyncMs: options.completedResyncMs ?? null,
      selectedTargets: selectedTargets.map((target) => ({
        handle: target.handle,
        status: target.status,
        requeuedForResync: target.requeuedForResync,
      })),
    },
  })

  if (selectedTargets.length === 0) {
    return { runId, startedAt, selectedTargets, backfill: null }
  }

  const backfill = await runNitterBackfillWorker({
    runId,
    handles: selectedTargets.map((target) => target.handle),
    dbPath: options.dbPath,
    logPath: options.logPath,
    mediaRoot: options.mediaRoot,
    baseUrl,
    batchPages: options.batchPages,
    delayMs: options.delayMs,
    jitterMs: options.jitterMs,
    mediaConcurrency: options.mediaConcurrency,
    mediaMaxItems: options.mediaMaxItems,
    runUntilEnd: options.runUntilEnd,
    fetchFn: options.fetchFn,
    mediaFetchFn: options.mediaFetchFn,
    signal: options.signal,
    now: options.now,
  })

  return { runId, startedAt, selectedTargets, backfill }
}

function selectAndRequeueDueTargets(options: {
  readonly dbPath: string
  readonly baseUrl: string
  readonly limit: number
  readonly completedResyncMs: number | undefined
  readonly now: string
  readonly runId: string
}): readonly QueuedNitterBackfillSelectedTarget[] {
  const store = initTwitterArchiveSqliteStore(options.dbPath)
  try {
    ensureNitterBackfillTargetsTable(store)
    const rows = selectDueTargetRows(store, options)
    const staleCompleted = rows.filter((row) => row.status === "completed")
    for (const row of staleCompleted) {
      requeueCompletedTarget(store, row, options.baseUrl, options.now, options.runId)
    }
    return rows.map((row) => ({
      handleKey: row.handle_key,
      handle: row.handle,
      status: row.status,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      requeuedForResync: row.status === "completed",
    }))
  } finally {
    store.close()
  }
}

function selectDueTargetRows(
  store: TwitterArchiveSqliteStore,
  options: {
    readonly baseUrl: string
    readonly limit: number
    readonly completedResyncMs: number | undefined
    readonly now: string
  },
): readonly QueuedNitterBackfillTargetRow[] {
  const completedCutoff = completedResyncCutoff(options.now, options.completedResyncMs)
  return store.sqlite
    .query(
      `SELECT handle_key, handle, status, updated_at, completed_at
       FROM nitter_backfill_targets
       WHERE base_url = ?
         AND (
           status IN ('pending', 'running', 'stopped', 'failed')
           OR (? IS NOT NULL AND status = 'completed' AND COALESCE(completed_at, updated_at) <= ?)
         )
       ORDER BY
         CASE status
           WHEN 'pending' THEN 0
           WHEN 'running' THEN 1
           WHEN 'stopped' THEN 2
           WHEN 'failed' THEN 3
           ELSE 4
         END,
         COALESCE(completed_at, updated_at),
         handle_key
       LIMIT ?`,
    )
    .all(options.baseUrl, completedCutoff ?? null, completedCutoff ?? "", options.limit) as readonly QueuedNitterBackfillTargetRow[]
}

function requeueCompletedTarget(
  store: TwitterArchiveSqliteStore,
  row: QueuedNitterBackfillTargetRow,
  baseUrl: string,
  now: string,
  runId: string,
): void {
  store.sqlite
    .query(
      `UPDATE nitter_backfill_targets
       SET status = 'pending',
           cursor = NULL,
           stop_reason = NULL,
           completed_at = NULL,
           last_run_id = ?,
           updated_at = ?
       WHERE handle_key = ? AND base_url = ? AND status = 'completed'`,
    )
    .run(runId, now, row.handle_key, baseUrl)
}

function normalizeQueuedNitterBackfillWorkerOptions(
  options: QueuedNitterBackfillWorkerOptions,
): NormalizedQueuedNitterBackfillWorkerOptions {
  if (options.once === true && options.daemon === true) {
    throw new Error("Queued Nitter backfill worker cannot run with both once and daemon modes")
  }

  return {
    runId: options.runId ?? `queued-nitter-backfill-worker-${Date.now()}`,
    daemon: options.daemon ?? options.once === false,
    dbPath: options.dbPath,
    logPath: options.logPath,
    mediaRoot: options.mediaRoot,
    baseUrl: normalizeBaseUrl(options.baseUrl),
    intervalMs: normalizeNonNegative(options.intervalMs, QUEUED_NITTER_BACKFILL_DEFAULT_INTERVAL_MS),
    limit: normalizePositive(options.limit, QUEUED_NITTER_BACKFILL_DEFAULT_LIMIT),
    completedResyncMs: normalizeOptionalNonNegative(options.completedResyncMs),
    batchPages: normalizePositive(options.batchPages, QUEUED_NITTER_BACKFILL_DEFAULT_BATCH_PAGES),
    delayMs: normalizeNonNegative(options.delayMs, NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS),
    jitterMs: normalizeNonNegative(options.jitterMs, NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS),
    mediaConcurrency: normalizePositive(options.mediaConcurrency, NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_CONCURRENCY),
    mediaMaxItems: normalizeNonNegative(options.mediaMaxItems, NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS),
    runUntilEnd: options.runUntilEnd ?? false,
    fetchFn: options.fetchFn,
    mediaFetchFn: options.mediaFetchFn,
    signal: options.signal,
    now: options.now ?? (() => new Date().toISOString()),
    sleepFn: options.sleepFn ?? sleep,
  }
}

function completedResyncCutoff(now: string, completedResyncMs: number | undefined): string | undefined {
  if (completedResyncMs === undefined) {
    return undefined
  }

  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) {
    throw new Error(`Queued Nitter backfill worker received an invalid timestamp: ${now}`)
  }
  return new Date(nowMs - completedResyncMs).toISOString()
}

function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs === 0 || signal?.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      signal?.removeEventListener("abort", finish)
      resolve()
    }
    timer = setTimeout(finish, delayMs)
    signal?.addEventListener("abort", finish, { once: true })
  })
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer, received ${value}`)
  }
  return value
}

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}`)
  }
  return value
}

function normalizeOptionalNonNegative(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}`)
  }
  return value
}

function readFlagValue(
  args: readonly string[],
  index: number,
  arg: string,
  flag: string,
): { readonly value: string; readonly index: number; readonly flag: string } | undefined {
  if (arg === flag) {
    const value = args[index + 1]
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`)
    }
    return { value, index: index + 1, flag }
  }
  const prefix = `${flag}=`
  if (arg.startsWith(prefix)) {
    return { value: arg.slice(prefix.length), index, flag }
  }
  return undefined
}

function parseOptionalPositiveInteger(value: string | undefined, flag: string): number | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : parsePositiveInteger(value, flag)
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function parseOptionalNonNegativeInteger(value: string | undefined, flag: string): number | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : parseNonNegativeInteger(value, flag)
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`)
  }
  return parsed
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

function pruneUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}

function runtimeArgs(): readonly string[] {
  return typeof Bun !== "undefined" ? Bun.argv.slice(2) : []
}

function runtimeEnv(): QueuedNitterBackfillWorkerCliEnv {
  return typeof Bun !== "undefined" ? Bun.env : {}
}

if (import.meta.main) {
  const summary = await runQueuedNitterBackfillWorkerCli()
  console.log(JSON.stringify(summary, null, 2))
}
