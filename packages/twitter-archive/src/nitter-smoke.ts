import { readTwitterArchiveConfig, type TwitterArchiveConfigEnv } from "./effect-services"
import { appendTwitterArchiveJsonlLog } from "./jsonl-log"
import {
  captureNitterTimelineToSqlite,
  NITTER_HARD_MAX_PAGES,
  type CapturedNitterTimelineToSqlite,
} from "./nitter"

export const NITTER_BACKFILL_DEFAULT_HANDLES = ["communalAI"] as const
export const NITTER_NAMED_BACKFILL_HANDLES = ["pleometric", "teortaxes", "teortaxestex"] as const

export interface NitterBackfillCliEnv extends TwitterArchiveConfigEnv {
  readonly TWITTER_ARCHIVE_BACKFILL_HANDLES?: string
  readonly NITTER_BACKFILL_HANDLES?: string
}

export interface NitterBackfillCliOptions {
  readonly handles: readonly string[]
  readonly maxPages?: number
  readonly dbPath?: string
  readonly logPath?: string
  readonly baseUrl?: string
}

export interface NitterBackfillTargetSummary {
  readonly username: string
  readonly rawPagesCached: number
  readonly usersUpserted: number
  readonly tweetsUpserted: number
  readonly mediaUpserted: number
  readonly counts: CapturedNitterTimelineToSqlite["counts"]
  readonly stopReason: CapturedNitterTimelineToSqlite["stopReason"]
  readonly nextCursor: string | null
}

export interface NitterBackfillRunSummary {
  readonly runId: string
  readonly dbPath: string
  readonly logPath: string
  readonly baseUrl: string
  readonly maxPages: number
  readonly targets: readonly NitterBackfillTargetSummary[]
}

export function parseNitterBackfillCliArgs(
  args: readonly string[],
  env: NitterBackfillCliEnv = {},
): NitterBackfillCliOptions {
  const cliHandles: string[] = []
  const envHandles = parseHandleList(firstNonEmpty(env.TWITTER_ARCHIVE_BACKFILL_HANDLES, env.NITTER_BACKFILL_HANDLES) ?? "")
  let includeNamedBackfillTargets = false
  let maxPages: number | undefined
  let dbPath: string | undefined
  let logPath: string | undefined
  let baseUrl: string | undefined

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

    const handlesValue = readFlagValue(args, index, arg, "--handles") ?? readFlagValue(args, index, arg, "--handle")
    if (handlesValue) {
      cliHandles.push(...parseHandleList(handlesValue.value))
      index = handlesValue.index
      continue
    }

    const maxPagesValue = readFlagValue(args, index, arg, "--max-pages")
    if (maxPagesValue) {
      maxPages = parsePositiveInteger(maxPagesValue.value, "--max-pages")
      index = maxPagesValue.index
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

    const baseUrlValue = readFlagValue(args, index, arg, "--base-url")
    if (baseUrlValue) {
      baseUrl = baseUrlValue.value
      index = baseUrlValue.index
      continue
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown Nitter backfill option: ${arg}`)
    }

    cliHandles.push(...parseHandleList(arg))
  }

  const selectedHandles = cliHandles.length > 0 ? cliHandles : envHandles
  const handles = dedupeHandles([
    ...(selectedHandles.length > 0 ? selectedHandles : NITTER_BACKFILL_DEFAULT_HANDLES),
    ...(includeNamedBackfillTargets ? NITTER_NAMED_BACKFILL_HANDLES : []),
  ])

  const options: {
    handles: string[]
    maxPages?: number
    dbPath?: string
    logPath?: string
    baseUrl?: string
  } = { handles }
  if (maxPages !== undefined) {
    options.maxPages = maxPages
  }
  if (dbPath !== undefined) {
    options.dbPath = dbPath
  }
  if (logPath !== undefined) {
    options.logPath = logPath
  }
  if (baseUrl !== undefined) {
    options.baseUrl = baseUrl
  }
  return options
}

export async function runNitterBackfillCli(
  args: readonly string[] = runtimeArgs(),
  env: NitterBackfillCliEnv = runtimeEnv(),
): Promise<NitterBackfillRunSummary> {
  const config = readTwitterArchiveConfig(env)
  const cli = parseNitterBackfillCliArgs(args, env)
  return runNitterBackfill({
    runId: `nitter-backfill-${Date.now()}`,
    handles: cli.handles,
    dbPath: cli.dbPath ?? config.dbPath,
    logPath: cli.logPath ?? config.logPath,
    baseUrl: cli.baseUrl ?? config.baseUrl,
    maxPages: Math.min(cli.maxPages ?? config.maxPages, NITTER_HARD_MAX_PAGES),
  })
}

export async function runNitterBackfill(options: {
  readonly runId: string
  readonly handles: readonly string[]
  readonly dbPath: string
  readonly logPath: string
  readonly baseUrl: string
  readonly maxPages: number
}): Promise<NitterBackfillRunSummary> {
  const maxPages = Math.min(Math.max(1, Math.floor(options.maxPages)), NITTER_HARD_MAX_PAGES)
  await appendTwitterArchiveJsonlLog(options.logPath, {
    component: "nitter-backfill",
    level: "info",
    event: "run.started",
    runId: options.runId,
    details: {
      handles: options.handles,
      dbPath: options.dbPath,
      baseUrl: options.baseUrl,
      maxPages,
    },
  })

  const targets: NitterBackfillTargetSummary[] = []
  for (const username of options.handles) {
    await appendTwitterArchiveJsonlLog(options.logPath, {
      component: "nitter-backfill",
      level: "info",
      event: "capture.started",
      runId: options.runId,
      details: {
        username,
        dbPath: options.dbPath,
        baseUrl: options.baseUrl,
        maxPages,
      },
    })

    try {
      const result = await captureNitterTimelineToSqlite(username, {
        maxPages,
        dbPath: options.dbPath,
        baseUrl: options.baseUrl,
      })
      const summary = summarizeTarget(username, result)
      targets.push(summary)

      await appendTwitterArchiveJsonlLog(options.logPath, {
        component: "nitter-backfill",
        level: "info",
        event: "capture.completed",
        runId: options.runId,
        details: {
          username: summary.username,
          rawPagesCached: summary.rawPagesCached,
          usersUpserted: summary.usersUpserted,
          tweetsUpserted: summary.tweetsUpserted,
          mediaUpserted: summary.mediaUpserted,
          counts: countsLogDetails(summary.counts),
          stopReason: summary.stopReason,
          nextCursor: summary.nextCursor,
        },
      })
    } catch (error) {
      await appendTwitterArchiveJsonlLog(options.logPath, {
        component: "nitter-backfill",
        level: "error",
        event: "capture.failed",
        runId: options.runId,
        details: {
          username,
          message: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  const summary = {
    runId: options.runId,
    dbPath: options.dbPath,
    logPath: options.logPath,
    baseUrl: options.baseUrl,
    maxPages,
    targets,
  }

  await appendTwitterArchiveJsonlLog(options.logPath, {
    component: "nitter-backfill",
    level: "info",
    event: "run.completed",
    runId: options.runId,
    details: {
      handles: targets.map((target) => target.username),
      targets: targets.length,
      rawPagesCached: targets.reduce((total, target) => total + target.rawPagesCached, 0),
      tweetsUpserted: targets.reduce((total, target) => total + target.tweetsUpserted, 0),
      mediaUpserted: targets.reduce((total, target) => total + target.mediaUpserted, 0),
    },
  })

  return summary
}

function summarizeTarget(
  username: string,
  result: CapturedNitterTimelineToSqlite,
): NitterBackfillTargetSummary {
  return {
    username,
    rawPagesCached: result.rawPagesCached,
    usersUpserted: result.entityUpserts.users,
    tweetsUpserted: result.entityUpserts.tweets,
    mediaUpserted: result.entityUpserts.media,
    counts: result.counts,
    stopReason: result.stopReason,
    nextCursor: result.nextCursor?.cursor ?? null,
  }
}

function countsLogDetails(counts: CapturedNitterTimelineToSqlite["counts"]): {
  readonly rawPages: number
  readonly captureJobs: number
  readonly users: number
  readonly tweets: number
  readonly media: number
} {
  return {
    rawPages: counts.rawPages,
    captureJobs: counts.captureJobs,
    users: counts.users,
    tweets: counts.tweets,
    media: counts.media,
  }
}

function parseHandleList(value: string): string[] {
  return value
    .split(/[,\s/]+/)
    .map((handle) => handle.trim().replace(/^@+/, ""))
    .filter((handle) => handle.length > 0)
}

function dedupeHandles(handles: readonly string[]): string[] {
  const selected = new Map<string, string>()
  for (const handle of handles) {
    const normalized = handle.trim().replace(/^@+/, "")
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
): { value: string; index: number } | undefined {
  if (arg === flag) {
    const value = args[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`)
    }
    return { value, index: index + 1 }
  }

  const prefix = `${flag}=`
  return arg.startsWith(prefix) ? { value: arg.slice(prefix.length), index } : undefined
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)
}

function runtimeArgs(): readonly string[] {
  return typeof Bun !== "undefined" ? Bun.argv.slice(2) : []
}

function runtimeEnv(): NitterBackfillCliEnv {
  return typeof Bun !== "undefined" ? Bun.env : {}
}

if (import.meta.main) {
  const summary = await runNitterBackfillCli()
  console.log(JSON.stringify(summary, null, 2))
}
