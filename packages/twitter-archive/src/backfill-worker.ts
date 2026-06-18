import { readTwitterArchiveConfig, type TwitterArchiveConfigEnv } from "./effect-services"
import { appendTwitterArchiveJsonlLog, type JsonlLogDetails } from "./jsonl-log"
import {
  downloadArchivedMedia,
  MEDIA_DOWNLOAD_DEFAULT_MAX_ITEMS,
  type MediaDownloadFetchFunction,
} from "./media-download"
import {
  classifyNitterResponse,
  NITTER_HARD_MAX_PAGES,
  normalizeNitterUsername,
  parseNitterTimelinePage,
  type NitterFetchFunction,
  type NitterFetchRequestInit,
  type NitterFetchResponseLike,
  type NitterStopReason,
} from "./nitter"
import {
  initTwitterArchiveSqliteStore,
  type TwitterArchiveSqliteCounts,
  type TwitterArchiveSqliteStore,
} from "./sqlite-store"

export const NITTER_BACKFILL_WORKER_DEFAULT_HANDLES = ["communalAI"] as const
export const NITTER_BACKFILL_WORKER_NAMED_HANDLES = ["pleometric", "teortaxes", "teortaxestex"] as const
export const NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS = 1_500
export const NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS = 500
export const NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_CONCURRENCY = 1
export const NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS = Math.min(10, MEDIA_DOWNLOAD_DEFAULT_MAX_ITEMS)

export type NitterBackfillWorkerTargetStatus = "pending" | "running" | "completed" | "stopped" | "failed"
export type NitterBackfillWorkerStopReason =
  | NitterStopReason
  | "already-completed"
  | "error"
  | "run-once"
  | "safety-max-runtime"
  | "safety-max-total-pages"

export interface NitterBackfillWorkerCliEnv extends TwitterArchiveConfigEnv {
  readonly TWITTER_ARCHIVE_BACKFILL_HANDLES?: string
  readonly NITTER_BACKFILL_HANDLES?: string
  readonly NITTER_BACKFILL_INCLUDE_TARGETS?: string
  readonly NITTER_BACKFILL_MAX_TOTAL_PAGES?: string
  readonly NITTER_BACKFILL_MAX_RUNTIME_MS?: string
  readonly NITTER_BACKFILL_DELAY_MS?: string
  readonly NITTER_BACKFILL_JITTER_MS?: string
  readonly NITTER_BACKFILL_MEDIA_CONCURRENCY?: string
  readonly NITTER_BACKFILL_MEDIA_MAX_ITEMS?: string
}

export interface NitterBackfillWorkerCliOptions {
  readonly handles: readonly string[]
  readonly batchPages?: number
  readonly dbPath?: string
  readonly logPath?: string
  readonly mediaRoot?: string
  readonly baseUrl?: string
  readonly maxTotalPages?: number
  readonly maxRuntimeMs?: number
  readonly delayMs?: number
  readonly jitterMs?: number
  readonly mediaConcurrency?: number
  readonly mediaMaxItems?: number
  readonly runUntilEnd: boolean
}

export interface NitterBackfillWorkerOptions extends NitterBackfillWorkerCliOptions {
  readonly runId: string
  readonly dbPath: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly baseUrl: string
  readonly batchPages: number
  readonly fetchFn?: NitterFetchFunction
  readonly mediaFetchFn?: MediaDownloadFetchFunction
  readonly signal?: AbortSignal
  readonly now?: () => string
}

export interface NitterBackfillWorkerTargetSummary {
  readonly username: string
  readonly status: NitterBackfillWorkerTargetStatus
  readonly stopReason: NitterBackfillWorkerStopReason | null
  readonly cursor: string | null
  readonly pagesFetched: number
  readonly batchesCompleted: number
  readonly rawPagesCached: number
  readonly usersUpserted: number
  readonly tweetsUpserted: number
  readonly mediaUpserted: number
  readonly counts: TwitterArchiveSqliteCounts
}

export interface NitterBackfillWorkerRunSummary {
  readonly runId: string
  readonly dbPath: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly baseUrl: string
  readonly batchPages: number
  readonly maxTotalPages: number | null
  readonly maxRuntimeMs: number | null
  readonly runUntilEnd: boolean
  readonly targets: readonly NitterBackfillWorkerTargetSummary[]
}

interface NitterBackfillTargetRow {
  handle_key: string
  handle: string
  base_url: string
  status: NitterBackfillWorkerTargetStatus
  cursor: string | null
  stop_reason: string | null
  pages_fetched: number
  batches_completed: number
  raw_pages_cached: number
  users_upserted: number
  tweets_upserted: number
  media_upserted: number
  last_run_id: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface TargetProgressDelta {
  readonly pagesFetched?: number
  readonly batchesCompleted?: number
  readonly rawPagesCached?: number
  readonly usersUpserted?: number
  readonly tweetsUpserted?: number
  readonly mediaUpserted?: number
}

interface CapturedPageOutcome {
  readonly stopReason?: NitterBackfillWorkerStopReason
  readonly nextCursor: string | null
  readonly rawPagesCached: number
  readonly usersUpserted: number
  readonly tweetsUpserted: number
  readonly mediaUpserted: number
  readonly counts: TwitterArchiveSqliteCounts
}

interface BatchOutcome {
  readonly pagesFetched: number
  readonly rawPagesCached: number
  readonly usersUpserted: number
  readonly tweetsUpserted: number
  readonly mediaUpserted: number
  readonly stopReason?: NitterBackfillWorkerStopReason
  readonly nextCursor: string | null
}

export function parseNitterBackfillWorkerCliArgs(
  args: readonly string[],
  env: NitterBackfillWorkerCliEnv = {},
): NitterBackfillWorkerCliOptions {
  const cliHandles: string[] = []
  const envHandles = parseHandleList(firstNonEmpty(env.TWITTER_ARCHIVE_BACKFILL_HANDLES, env.NITTER_BACKFILL_HANDLES) ?? "")
  let includeNamedBackfillTargets = parseBooleanFlag(env.NITTER_BACKFILL_INCLUDE_TARGETS)
  let batchPages: number | undefined
  let dbPath: string | undefined
  let logPath: string | undefined
  let mediaRoot: string | undefined
  let baseUrl: string | undefined
  let maxTotalPages = parseOptionalNonNegativeInteger(env.NITTER_BACKFILL_MAX_TOTAL_PAGES, "NITTER_BACKFILL_MAX_TOTAL_PAGES")
  let maxRuntimeMs = parseOptionalNonNegativeInteger(env.NITTER_BACKFILL_MAX_RUNTIME_MS, "NITTER_BACKFILL_MAX_RUNTIME_MS")
  let delayMs = parseOptionalNonNegativeInteger(env.NITTER_BACKFILL_DELAY_MS, "NITTER_BACKFILL_DELAY_MS")
  let jitterMs = parseOptionalNonNegativeInteger(env.NITTER_BACKFILL_JITTER_MS, "NITTER_BACKFILL_JITTER_MS")
  let mediaConcurrency = parseOptionalNonNegativeInteger(
    env.NITTER_BACKFILL_MEDIA_CONCURRENCY,
    "NITTER_BACKFILL_MEDIA_CONCURRENCY",
  )
  let mediaMaxItems = parseOptionalNonNegativeInteger(env.NITTER_BACKFILL_MEDIA_MAX_ITEMS, "NITTER_BACKFILL_MEDIA_MAX_ITEMS")
  let runUntilEnd = true

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--") {
      for (const positional of args.slice(index + 1)) {
        cliHandles.push(...parseHandleList(positional))
      }
      break
    }

    if (arg === "--include-backfill-targets" || arg === "--backfill-targets" || arg === "--all-targets") {
      includeNamedBackfillTargets = true
      continue
    }

    if (arg === "--pleometric" || arg === "--include-pleometric") {
      cliHandles.push("pleometric")
      continue
    }

    if (arg === "--teortaxes" || arg === "--include-teortaxes") {
      cliHandles.push("teortaxes")
      continue
    }

    if (arg === "--teortaxestex" || arg === "--include-teortaxestex") {
      cliHandles.push("teortaxestex")
      continue
    }

    if (arg === "--run-until-end") {
      runUntilEnd = true
      continue
    }

    if (arg === "--once" || arg === "--one-batch") {
      runUntilEnd = false
      continue
    }

    const handlesValue = readFlagValue(args, index, arg, "--handles") ?? readFlagValue(args, index, arg, "--handle")
    if (handlesValue) {
      cliHandles.push(...parseHandleList(handlesValue.value))
      index = handlesValue.index
      continue
    }

    const batchPagesValue = readFlagValue(args, index, arg, "--batch-pages") ?? readFlagValue(args, index, arg, "--max-pages")
    if (batchPagesValue) {
      batchPages = parsePositiveInteger(batchPagesValue.value, batchPagesValue.flag)
      index = batchPagesValue.index
      continue
    }

    const maxTotalPagesValue = readFlagValue(args, index, arg, "--max-total-pages")
    if (maxTotalPagesValue) {
      maxTotalPages = parseNonNegativeInteger(maxTotalPagesValue.value, "--max-total-pages")
      index = maxTotalPagesValue.index
      continue
    }

    const maxRuntimeMsValue = readFlagValue(args, index, arg, "--max-runtime-ms")
    if (maxRuntimeMsValue) {
      maxRuntimeMs = parseNonNegativeInteger(maxRuntimeMsValue.value, "--max-runtime-ms")
      index = maxRuntimeMsValue.index
      continue
    }

    const delayMsValue = readFlagValue(args, index, arg, "--delay-ms")
    if (delayMsValue) {
      delayMs = parseNonNegativeInteger(delayMsValue.value, "--delay-ms")
      index = delayMsValue.index
      continue
    }

    const jitterMsValue = readFlagValue(args, index, arg, "--jitter-ms")
    if (jitterMsValue) {
      jitterMs = parseNonNegativeInteger(jitterMsValue.value, "--jitter-ms")
      index = jitterMsValue.index
      continue
    }

    const mediaConcurrencyValue = readFlagValue(args, index, arg, "--media-concurrency")
    if (mediaConcurrencyValue) {
      mediaConcurrency = parsePositiveInteger(mediaConcurrencyValue.value, "--media-concurrency")
      index = mediaConcurrencyValue.index
      continue
    }

    const mediaMaxItemsValue = readFlagValue(args, index, arg, "--media-max-items")
    if (mediaMaxItemsValue) {
      mediaMaxItems = parseNonNegativeInteger(mediaMaxItemsValue.value, "--media-max-items")
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
      throw new Error(`Unknown Nitter backfill worker option: ${arg}`)
    }

    cliHandles.push(...parseHandleList(arg))
  }

  const selectedHandles = cliHandles.length > 0 ? cliHandles : envHandles
  const handles = dedupeHandles([
    ...(selectedHandles.length > 0 ? selectedHandles : NITTER_BACKFILL_WORKER_DEFAULT_HANDLES),
    ...(includeNamedBackfillTargets ? NITTER_BACKFILL_WORKER_NAMED_HANDLES : []),
  ])

  return pruneUndefined({
    handles,
    batchPages,
    dbPath,
    logPath,
    mediaRoot,
    baseUrl,
    maxTotalPages,
    maxRuntimeMs,
    delayMs,
    jitterMs,
    mediaConcurrency,
    mediaMaxItems,
    runUntilEnd,
  })
}

export async function runNitterBackfillWorkerCli(
  args: readonly string[] = runtimeArgs(),
  env: NitterBackfillWorkerCliEnv = runtimeEnv(),
): Promise<NitterBackfillWorkerRunSummary> {
  const config = readTwitterArchiveConfig(env)
  const cli = parseNitterBackfillWorkerCliArgs(args, env)
  return runNitterBackfillWorker({
    runId: `nitter-backfill-worker-${Date.now()}`,
    handles: cli.handles,
    dbPath: cli.dbPath ?? config.dbPath,
    logPath: cli.logPath ?? config.logPath,
    mediaRoot: cli.mediaRoot ?? config.mediaRoot,
    baseUrl: cli.baseUrl ?? config.baseUrl,
    batchPages: cli.batchPages ?? config.maxPages,
    maxTotalPages: cli.maxTotalPages,
    maxRuntimeMs: cli.maxRuntimeMs,
    delayMs: cli.delayMs,
    jitterMs: cli.jitterMs,
    mediaConcurrency: cli.mediaConcurrency,
    mediaMaxItems: cli.mediaMaxItems ?? NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS,
    runUntilEnd: cli.runUntilEnd,
  })
}

export async function runNitterBackfillWorker(options: NitterBackfillWorkerOptions): Promise<NitterBackfillWorkerRunSummary> {
  const batchPages = clampBatchPages(options.batchPages)
  const maxTotalPages = normalizeOptionalNonNegative(options.maxTotalPages)
  const maxRuntimeMs = normalizeOptionalNonNegative(options.maxRuntimeMs)
  const delayMs = normalizeNonNegative(options.delayMs, NITTER_BACKFILL_WORKER_DEFAULT_DELAY_MS)
  const jitterMs = normalizeNonNegative(options.jitterMs, NITTER_BACKFILL_WORKER_DEFAULT_JITTER_MS)
  const mediaConcurrency = normalizePositive(options.mediaConcurrency, NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_CONCURRENCY)
  const mediaMaxItems = normalizeNonNegative(options.mediaMaxItems, NITTER_BACKFILL_WORKER_DEFAULT_MEDIA_MAX_ITEMS)
  const startedAtMs = Date.now()
  const now = options.now ?? (() => new Date().toISOString())
  const store = initTwitterArchiveSqliteStore(options.dbPath)
  try {
    ensureBackfillTargetsTable(store)
    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill-worker",
      level: "info",
      event: "run.started",
      runId: options.runId,
      details: {
        handles: options.handles,
        dbPath: options.dbPath,
        logPath: options.logPath,
        mediaRoot: options.mediaRoot,
        baseUrl: normalizeBaseUrl(options.baseUrl),
        batchPages,
        maxTotalPages: maxTotalPages ?? null,
        maxRuntimeMs: maxRuntimeMs ?? null,
        runUntilEnd: options.runUntilEnd,
      },
    })

    const targets: NitterBackfillWorkerTargetSummary[] = []
    let runPagesFetched = 0
    for (const username of options.handles) {
      if (maxTotalPages !== undefined && runPagesFetched >= maxTotalPages) {
        break
      }
      if (maxRuntimeMs !== undefined && Date.now() - startedAtMs >= maxRuntimeMs) {
        break
      }

      const result = await runBackfillForTarget({
        store,
        runId: options.runId,
        username,
        baseUrl: normalizeBaseUrl(options.baseUrl),
        logPath: options.logPath,
        mediaRoot: options.mediaRoot,
        batchPages,
        maxTotalPages,
        maxRuntimeMs,
        runStartedAtMs: startedAtMs,
        runPagesFetched,
        delayMs,
        jitterMs,
        mediaConcurrency,
        mediaMaxItems,
        runUntilEnd: options.runUntilEnd,
        fetchFn: options.fetchFn ?? defaultFetch,
        mediaFetchFn: options.mediaFetchFn,
        signal: options.signal,
        now,
      })
      runPagesFetched += result.pagesFetchedThisRun
      targets.push(result.summary)
    }

    const summary: NitterBackfillWorkerRunSummary = {
      runId: options.runId,
      dbPath: options.dbPath,
      logPath: options.logPath,
      mediaRoot: options.mediaRoot,
      baseUrl: normalizeBaseUrl(options.baseUrl),
      batchPages,
      maxTotalPages: maxTotalPages ?? null,
      maxRuntimeMs: maxRuntimeMs ?? null,
      runUntilEnd: options.runUntilEnd,
      targets,
    }

    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill-worker",
      level: "info",
      event: "run.completed",
      runId: options.runId,
      details: {
        targets: targets.length,
        pagesFetched: targets.reduce((total, target) => total + target.pagesFetched, 0),
        rawPagesCached: targets.reduce((total, target) => total + target.rawPagesCached, 0),
        tweetsUpserted: targets.reduce((total, target) => total + target.tweetsUpserted, 0),
        mediaUpserted: targets.reduce((total, target) => total + target.mediaUpserted, 0),
      },
    })

    return summary
  } finally {
    store.close()
  }
}

async function runBackfillForTarget(options: {
  readonly store: TwitterArchiveSqliteStore
  readonly runId: string
  readonly username: string
  readonly baseUrl: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly batchPages: number
  readonly maxTotalPages: number | undefined
  readonly maxRuntimeMs: number | undefined
  readonly runStartedAtMs: number
  readonly runPagesFetched: number
  readonly delayMs: number
  readonly jitterMs: number
  readonly mediaConcurrency: number
  readonly mediaMaxItems: number
  readonly runUntilEnd: boolean
  readonly fetchFn: NitterFetchFunction
  readonly mediaFetchFn: MediaDownloadFetchFunction | undefined
  readonly signal: AbortSignal | undefined
  readonly now: () => string
}): Promise<{ readonly summary: NitterBackfillWorkerTargetSummary; readonly pagesFetchedThisRun: number }> {
  const username = normalizeNitterUsername(options.username)
  const handleKey = username.toLowerCase()
  const job = options.store.enqueueJob({
    source: "nitter",
    target: `timeline:${handleKey}`,
    requestHash: `nitter-backfill:${handleKey}:${options.baseUrl}`,
    stage: "nitter-backfill",
  })
  let row = ensureTargetRow(options.store, username, options.baseUrl, options.runId, options.now())
  if (row.status === "completed") {
    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill-worker",
      level: "info",
      event: "target.skipped",
      runId: options.runId,
      jobId: job.id,
      details: targetLogDetails(row, options.store.getCounts(), "already-completed"),
    })
    return { summary: summarizeTarget(row, options.store.getCounts(), "already-completed"), pagesFetchedThisRun: 0 }
  }

  options.store.startJob(job.id, { stage: "nitter-backfill" })
  row = setTargetState(options.store, {
    handleKey,
    baseUrl: options.baseUrl,
    status: "running",
    cursor: row.cursor,
    stopReason: row.stop_reason,
    runId: options.runId,
    now: options.now(),
    clearError: true,
  })

  await appendTwitterArchiveJsonlLog(options.logPath, {
    component: "nitter-backfill-worker",
    level: "info",
    event: "target.started",
    runId: options.runId,
    jobId: job.id,
    details: targetLogDetails(row, options.store.getCounts()),
  })

  let pagesFetchedThisRun = 0
  let cursor = row.cursor
  let finalStopReason: NitterBackfillWorkerStopReason | undefined

  try {
    for (;;) {
      const safetyStopReason = readSafetyStopReason(options, pagesFetchedThisRun)
      if (safetyStopReason) {
        finalStopReason = safetyStopReason
        row = setTargetState(options.store, {
          handleKey,
          baseUrl: options.baseUrl,
          status: "stopped",
          cursor,
          stopReason: safetyStopReason,
          runId: options.runId,
          now: options.now(),
        })
        break
      }

      const pagesRemaining = options.maxTotalPages === undefined ? options.batchPages : options.maxTotalPages - options.runPagesFetched - pagesFetchedThisRun
      const batchPageLimit = Math.min(options.batchPages, Math.max(0, pagesRemaining))
      if (batchPageLimit === 0) {
        finalStopReason = "safety-max-total-pages"
        row = setTargetState(options.store, {
          handleKey,
          baseUrl: options.baseUrl,
          status: "stopped",
          cursor,
          stopReason: finalStopReason,
          runId: options.runId,
          now: options.now(),
        })
        break
      }

      const batch = await captureTargetBatch({
        store: options.store,
        runId: options.runId,
        jobId: job.id,
        username,
        handleKey,
        baseUrl: options.baseUrl,
        logPath: options.logPath,
        startCursor: cursor,
        pageLimit: batchPageLimit,
        delayMs: options.delayMs,
        jitterMs: options.jitterMs,
        fetchFn: options.fetchFn,
        signal: options.signal,
        now: options.now,
      })
      pagesFetchedThisRun += batch.pagesFetched
      cursor = batch.nextCursor
      row = readTargetRow(options.store, handleKey, options.baseUrl) ?? row

      await runMediaCycle({
        store: options.store,
        runId: options.runId,
        jobId: job.id,
        logPath: options.logPath,
        mediaRoot: options.mediaRoot,
        mediaConcurrency: options.mediaConcurrency,
        mediaMaxItems: options.mediaMaxItems,
        mediaFetchFn: options.mediaFetchFn,
        signal: options.signal,
        now: options.now,
      })

      row = setTargetState(options.store, {
        handleKey,
        baseUrl: options.baseUrl,
        status: batch.stopReason === "no-cursor" ? "completed" : row.status,
        cursor,
        stopReason: batch.stopReason ?? row.stop_reason,
        runId: options.runId,
        now: options.now(),
        delta: { batchesCompleted: 1 },
      })

      await appendTwitterArchiveJsonlLog(options.logPath, {
        component: "nitter-backfill-worker",
        level: "info",
        event: "batch.completed",
        runId: options.runId,
        jobId: job.id,
        details: {
          username,
          pagesFetched: batch.pagesFetched,
          rawPagesCached: batch.rawPagesCached,
          usersUpserted: batch.usersUpserted,
          tweetsUpserted: batch.tweetsUpserted,
          mediaUpserted: batch.mediaUpserted,
          stopReason: batch.stopReason ?? "max-pages",
          nextCursor: batch.nextCursor,
          counts: countsLogDetails(options.store.getCounts()),
        },
      })

      if (batch.stopReason) {
        finalStopReason = batch.stopReason
        break
      }

      if (!options.runUntilEnd) {
        finalStopReason = "run-once"
        row = setTargetState(options.store, {
          handleKey,
          baseUrl: options.baseUrl,
          status: "stopped",
          cursor,
          stopReason: finalStopReason,
          runId: options.runId,
          now: options.now(),
        })
        break
      }
    }

    const completeStage = finalStopReason ?? "completed"
    if (row.status === "completed" || finalStopReason === "no-cursor") {
      options.store.completeJob(job.id, { stage: "nitter-backfill:completed" })
    } else {
      options.store.completeJob(job.id, { stage: `nitter-backfill:${completeStage}` })
    }

    row = readTargetRow(options.store, handleKey, options.baseUrl) ?? row
    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill-worker",
      level: row.status === "completed" ? "info" : "warn",
      event: "target.completed",
      runId: options.runId,
      jobId: job.id,
      details: targetLogDetails(row, options.store.getCounts(), finalStopReason),
    })
    return { summary: summarizeTarget(row, options.store.getCounts(), finalStopReason), pagesFetchedThisRun }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    row = setTargetState(options.store, {
      handleKey,
      baseUrl: options.baseUrl,
      status: "failed",
      cursor,
      stopReason: "error",
      runId: options.runId,
      now: options.now(),
      error: message,
    })
    options.store.failJob(job.id, message, { stage: "nitter-backfill:failed" })
    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill-worker",
      level: "error",
      event: "target.failed",
      runId: options.runId,
      jobId: job.id,
      details: targetLogDetails(row, options.store.getCounts(), "error"),
    })
    return { summary: summarizeTarget(row, options.store.getCounts(), "error"), pagesFetchedThisRun }
  }
}

async function captureTargetBatch(options: {
  readonly store: TwitterArchiveSqliteStore
  readonly runId: string
  readonly jobId: string
  readonly username: string
  readonly handleKey: string
  readonly baseUrl: string
  readonly logPath: string
  readonly startCursor: string | null
  readonly pageLimit: number
  readonly delayMs: number
  readonly jitterMs: number
  readonly fetchFn: NitterFetchFunction
  readonly signal: AbortSignal | undefined
  readonly now: () => string
}): Promise<BatchOutcome> {
  let cursor = options.startCursor
  let pagesFetched = 0
  let rawPagesCached = 0
  let usersUpserted = 0
  let tweetsUpserted = 0
  let mediaUpserted = 0
  let stopReason: NitterBackfillWorkerStopReason | undefined

  for (let pageIndex = 0; pageIndex < options.pageLimit; pageIndex += 1) {
    const page = await captureTargetPage({
      store: options.store,
      runId: options.runId,
      jobId: options.jobId,
      username: options.username,
      handleKey: options.handleKey,
      baseUrl: options.baseUrl,
      logPath: options.logPath,
      cursor,
      fetchFn: options.fetchFn,
      signal: options.signal,
      now: options.now,
    })
    pagesFetched += 1
    rawPagesCached += page.rawPagesCached
    usersUpserted += page.usersUpserted
    tweetsUpserted += page.tweetsUpserted
    mediaUpserted += page.mediaUpserted
    cursor = page.nextCursor

    if (page.stopReason) {
      stopReason = page.stopReason
      break
    }

    if (pageIndex + 1 < options.pageLimit) {
      await delayBeforeNextPage(options.delayMs, options.jitterMs)
    }
  }

  return {
    pagesFetched,
    rawPagesCached,
    usersUpserted,
    tweetsUpserted,
    mediaUpserted,
    stopReason,
    nextCursor: cursor,
  }
}

async function captureTargetPage(options: {
  readonly store: TwitterArchiveSqliteStore
  readonly runId: string
  readonly jobId: string
  readonly username: string
  readonly handleKey: string
  readonly baseUrl: string
  readonly logPath: string
  readonly cursor: string | null
  readonly fetchFn: NitterFetchFunction
  readonly signal: AbortSignal | undefined
  readonly now: () => string
}): Promise<CapturedPageOutcome> {
  const url = buildNitterTimelineUrl(options.baseUrl, options.username, options.cursor ?? undefined)
  const response = await options.fetchFn(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
    },
    signal: options.signal,
  })
  const body = await response.text()
  const contentType = response.headers?.get("content-type") ?? undefined
  const cachedPage = options.store.cacheRawPage({
    source: "nitter",
    url,
    body,
    fetchedAt: options.now(),
    statusCode: response.status,
    contentType,
    headers: contentType ? { "content-type": contentType } : undefined,
  })

  const classification = classifyNitterResponse(response.status, body)
  if (!classification.ok) {
    options.store.updateRawPageParseStatus("nitter", url, cachedPage.requestHash, "failed")
    const stopReason = classification.reason ?? "non-2xx"
    const row = setTargetState(options.store, {
      handleKey: options.handleKey,
      baseUrl: options.baseUrl,
      status: "stopped",
      cursor: options.cursor,
      stopReason,
      runId: options.runId,
      now: options.now(),
      delta: { pagesFetched: 1, rawPagesCached: 1 },
    })
    const counts = options.store.getCounts()
    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill-worker",
      level: "warn",
      event: "page.stopped",
      runId: options.runId,
      jobId: options.jobId,
      details: {
        ...targetLogDetails(row, counts, stopReason),
        url,
        statusCode: response.status,
      },
    })
    return {
      stopReason,
      nextCursor: options.cursor,
      rawPagesCached: 1,
      usersUpserted: 0,
      tweetsUpserted: 0,
      mediaUpserted: 0,
      counts,
    }
  }

  const parsed = parseNitterTimelinePage(body, {
    baseUrl: options.baseUrl,
    targetUsername: options.username,
    capturedAt: options.now(),
  })
  options.store.updateRawPageParseStatus("nitter", url, cachedPage.requestHash, "parsed")
  const userUpserts = options.store.upsertUsers(parsed.users)
  const tweetUpserts = options.store.upsertTweets(parsed.tweets)
  const mediaUpserts = options.store.upsertMedia(parsed.media)
  for (const item of parsed.timeline) {
    if (item.needsDetailResolution) {
      options.store.setTweetAttribute({ tweetId: item.tweetId, key: "nitter:detail", value: "pending" })
      options.store.updateTweetResolutionStatus(item.tweetId, { threadStatus: "pending" })
    }
  }
  const nextCursor = parsed.nextCursor?.cursor ?? null
  const stopReason: NitterBackfillWorkerStopReason | undefined = nextCursor ? undefined : "no-cursor"
  const row = setTargetState(options.store, {
    handleKey: options.handleKey,
    baseUrl: options.baseUrl,
    status: nextCursor ? "running" : "completed",
    cursor: nextCursor,
    stopReason: stopReason ?? null,
    runId: options.runId,
    now: options.now(),
    delta: {
      pagesFetched: 1,
      rawPagesCached: 1,
      usersUpserted: userUpserts.upserted,
      tweetsUpserted: tweetUpserts.upserted,
      mediaUpserted: mediaUpserts.upserted,
    },
  })
  const counts = options.store.getCounts()
  await appendTwitterArchiveJsonlLog(options.logPath, {
    component: "nitter-backfill-worker",
    level: "info",
    event: "page.completed",
    runId: options.runId,
    jobId: options.jobId,
    details: {
      ...targetLogDetails(row, counts, stopReason),
      url,
      statusCode: response.status,
      tweetsParsed: parsed.tweets.length,
      mediaParsed: parsed.media.length,
    },
  })

  return {
    stopReason,
    nextCursor,
    rawPagesCached: 1,
    usersUpserted: userUpserts.upserted,
    tweetsUpserted: tweetUpserts.upserted,
    mediaUpserted: mediaUpserts.upserted,
    counts,
  }
}

async function runMediaCycle(options: {
  readonly store: TwitterArchiveSqliteStore
  readonly runId: string
  readonly jobId: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly mediaConcurrency: number
  readonly mediaMaxItems: number
  readonly mediaFetchFn: MediaDownloadFetchFunction | undefined
  readonly signal: AbortSignal | undefined
  readonly now: () => string
}): Promise<void> {
  try {
    await downloadArchivedMedia({
      store: options.store,
      mediaRoot: options.mediaRoot,
      fetchFn: options.mediaFetchFn,
      logPath: options.logPath,
      runId: options.runId,
      jobId: options.jobId,
      maxItems: options.mediaMaxItems,
      concurrency: options.mediaConcurrency,
      signal: options.signal,
      now: options.now,
    })
  } catch (error) {
    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill-worker",
      level: "error",
      event: "media-cycle.failed",
      runId: options.runId,
      jobId: options.jobId,
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function ensureBackfillTargetsTable(store: TwitterArchiveSqliteStore): void {
  store.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS nitter_backfill_targets (
      handle_key TEXT NOT NULL,
      handle TEXT NOT NULL,
      base_url TEXT NOT NULL,
      status TEXT NOT NULL,
      cursor TEXT,
      stop_reason TEXT,
      pages_fetched INTEGER NOT NULL DEFAULT 0,
      batches_completed INTEGER NOT NULL DEFAULT 0,
      raw_pages_cached INTEGER NOT NULL DEFAULT 0,
      users_upserted INTEGER NOT NULL DEFAULT 0,
      tweets_upserted INTEGER NOT NULL DEFAULT 0,
      media_upserted INTEGER NOT NULL DEFAULT 0,
      last_run_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (handle_key, base_url)
    )
  `)
}

function ensureTargetRow(
  store: TwitterArchiveSqliteStore,
  username: string,
  baseUrl: string,
  runId: string,
  now: string,
): NitterBackfillTargetRow {
  const handleKey = username.toLowerCase()
  store.sqlite
    .query(
      `INSERT INTO nitter_backfill_targets (
        handle_key, handle, base_url, status, cursor, stop_reason, last_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', NULL, NULL, ?, ?, ?)
      ON CONFLICT(handle_key, base_url) DO UPDATE SET
        handle = excluded.handle,
        last_run_id = excluded.last_run_id,
        updated_at = excluded.updated_at`,
    )
    .run(handleKey, username, baseUrl, runId, now, now)
  const row = readTargetRow(store, handleKey, baseUrl)
  if (!row) {
    throw new Error(`Backfill target row was not created: ${username}`)
  }
  return row
}

function readTargetRow(
  store: TwitterArchiveSqliteStore,
  handleKey: string,
  baseUrl: string,
): NitterBackfillTargetRow | undefined {
  return (
    store.sqlite
      .query("SELECT * FROM nitter_backfill_targets WHERE handle_key = ? AND base_url = ?")
      .get(handleKey, baseUrl) as NitterBackfillTargetRow | null
  ) ?? undefined
}

function setTargetState(
  store: TwitterArchiveSqliteStore,
  input: {
    readonly handleKey: string
    readonly baseUrl: string
    readonly status: NitterBackfillWorkerTargetStatus
    readonly cursor: string | null
    readonly stopReason: NitterBackfillWorkerStopReason | string | null | undefined
    readonly runId: string
    readonly now: string
    readonly delta?: TargetProgressDelta
    readonly error?: string
    readonly clearError?: boolean
  },
): NitterBackfillTargetRow {
  const delta = input.delta ?? {}
  store.sqlite
    .query(
      `UPDATE nitter_backfill_targets SET
        status = ?,
        cursor = ?,
        stop_reason = ?,
        pages_fetched = pages_fetched + ?,
        batches_completed = batches_completed + ?,
        raw_pages_cached = raw_pages_cached + ?,
        users_upserted = users_upserted + ?,
        tweets_upserted = tweets_upserted + ?,
        media_upserted = media_upserted + ?,
        last_run_id = ?,
        last_error = ?,
        updated_at = ?,
        completed_at = ?
      WHERE handle_key = ? AND base_url = ?`,
    )
    .run(
      input.status,
      input.cursor,
      input.stopReason ?? null,
      delta.pagesFetched ?? 0,
      delta.batchesCompleted ?? 0,
      delta.rawPagesCached ?? 0,
      delta.usersUpserted ?? 0,
      delta.tweetsUpserted ?? 0,
      delta.mediaUpserted ?? 0,
      input.runId,
      input.clearError ? null : input.error ?? null,
      input.now,
      input.status === "completed" ? input.now : null,
      input.handleKey,
      input.baseUrl,
    )
  const row = readTargetRow(store, input.handleKey, input.baseUrl)
  if (!row) {
    throw new Error(`Backfill target row missing: ${input.handleKey}`)
  }
  return row
}

function summarizeTarget(
  row: NitterBackfillTargetRow,
  counts: TwitterArchiveSqliteCounts,
  stopReason: NitterBackfillWorkerStopReason | undefined,
): NitterBackfillWorkerTargetSummary {
  return {
    username: row.handle,
    status: row.status,
    stopReason: (stopReason ?? row.stop_reason) as NitterBackfillWorkerStopReason | null,
    cursor: row.cursor,
    pagesFetched: row.pages_fetched,
    batchesCompleted: row.batches_completed,
    rawPagesCached: row.raw_pages_cached,
    usersUpserted: row.users_upserted,
    tweetsUpserted: row.tweets_upserted,
    mediaUpserted: row.media_upserted,
    counts,
  }
}

function targetLogDetails(
  row: NitterBackfillTargetRow,
  counts: TwitterArchiveSqliteCounts,
  stopReason?: NitterBackfillWorkerStopReason,
): JsonlLogDetails {
  return {
    username: row.handle,
    status: row.status,
    cursor: row.cursor,
    stopReason: stopReason ?? row.stop_reason,
    pagesFetched: row.pages_fetched,
    batchesCompleted: row.batches_completed,
    rawPagesCached: row.raw_pages_cached,
    usersUpserted: row.users_upserted,
    tweetsUpserted: row.tweets_upserted,
    mediaUpserted: row.media_upserted,
    counts: countsLogDetails(counts),
  }
}

function countsLogDetails(counts: TwitterArchiveSqliteCounts): JsonlLogDetails {
  return {
    rawPages: counts.rawPages,
    captureJobs: counts.captureJobs,
    users: counts.users,
    tweets: counts.tweets,
    media: counts.media,
  }
}

function readSafetyStopReason(
  options: {
    readonly maxTotalPages: number | undefined
    readonly maxRuntimeMs: number | undefined
    readonly runStartedAtMs: number
    readonly runPagesFetched: number
  },
  pagesFetchedThisRun: number,
): NitterBackfillWorkerStopReason | undefined {
  if (options.maxTotalPages !== undefined && options.runPagesFetched + pagesFetchedThisRun >= options.maxTotalPages) {
    return "safety-max-total-pages"
  }
  if (options.maxRuntimeMs !== undefined && Date.now() - options.runStartedAtMs >= options.maxRuntimeMs) {
    return "safety-max-runtime"
  }
  return undefined
}

function buildNitterTimelineUrl(baseUrl: string, username: string, cursor: string | undefined): string {
  const url = new URL(`${baseUrl}/${encodeURIComponent(normalizeNitterUsername(username))}`)
  if (cursor) {
    url.searchParams.set("cursor", cursor)
  }
  return url.toString()
}

async function defaultFetch(url: string, init: NitterFetchRequestInit): Promise<NitterFetchResponseLike> {
  return fetch(url, init)
}

async function delayBeforeNextPage(delayMs: number, jitterMs: number): Promise<void> {
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0
  const waitMs = delayMs + jitter
  if (waitMs <= 0) {
    return
  }
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, waitMs)
  return promise
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function clampBatchPages(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1
  }
  return Math.min(NITTER_HARD_MAX_PAGES, Math.floor(value))
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.floor(value)
}

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isFinite(value) || value < 0) {
    return fallback
  }
  return Math.floor(value)
}

function normalizeOptionalNonNegative(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.floor(value)
}

function parseHandleList(value: string): string[] {
  return value
    .split(/[,\s/]+/)
    .map((handle) => normalizeNitterUsername(handle))
    .filter((handle) => handle.length > 0)
}

function dedupeHandles(handles: readonly string[]): string[] {
  const selected = new Map<string, string>()
  for (const handle of handles) {
    const normalized = normalizeNitterUsername(handle)
    if (normalized.length === 0) {
      continue
    }
    const key = normalized.toLowerCase()
    if (!selected.has(key)) {
      selected.set(key, normalized)
    }
  }
  return Array.from(selected.values())
}

function readFlagValue(
  args: readonly string[],
  index: number,
  arg: string,
  flag: string,
): { readonly value: string; readonly index: number; readonly flag: string } | undefined {
  if (arg === flag) {
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`)
    }
    return { value, index: index + 1, flag }
  }

  const prefix = `${flag}=`
  return arg.startsWith(prefix) ? { value: arg.slice(prefix.length), index, flag } : undefined
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`)
  }
  return parsed
}

function parseOptionalNonNegativeInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined
  }
  return parseNonNegativeInteger(value, flag)
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)
}

function pruneUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}

function runtimeArgs(): readonly string[] {
  return typeof Bun !== "undefined" ? Bun.argv.slice(2) : []
}

function runtimeEnv(): NitterBackfillWorkerCliEnv {
  return typeof Bun !== "undefined" ? Bun.env : {}
}

if (import.meta.main) {
  const summary = await runNitterBackfillWorkerCli()
  console.log(JSON.stringify(summary, null, 2))
}
