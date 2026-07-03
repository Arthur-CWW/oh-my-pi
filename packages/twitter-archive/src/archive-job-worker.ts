import { extractTweetId, extractUsernameFromTweetUrl, normalizeUsername } from "./normalize"
import {
  captureNitterTimelineToSqlite,
  normalizeNitterUsername,
  resolveNitterTweetDetails,
  type NitterFetchFunction,
} from "./nitter"
import { captureNitterFollowingToSqlite } from "./following-graph"
import {
  initTwitterArchiveSqliteStore,
  type SqliteArchiveJob,
  type SqliteJsonRecord,
  type TwitterArchiveSqliteStore,
} from "./sqlite-store"

type ArchiveJobJsonValue = null | string | number | boolean | readonly ArchiveJobJsonValue[] | ArchiveJobJsonRecord
interface ArchiveJobJsonRecord {
  readonly [key: string]: ArchiveJobJsonValue | undefined
}
type ArchiveJobWorkerDetails = ArchiveJobJsonValue | object

export interface ArchiveJobWorkerOptions {
  dbPath?: string
  store?: TwitterArchiveSqliteStore
  workerId?: string
  baseUrl?: string
  fetchFn?: NitterFetchFunction
  signal?: AbortSignal
}

export type ArchiveJobWorkerResultStatus = "idle" | "completed" | "failed" | "skipped"

export interface ArchiveJobWorkerResult {
  status: ArchiveJobWorkerResultStatus
  job?: SqliteArchiveJob
  details?: ArchiveJobWorkerDetails
  error?: string
}

interface ArchiveJobOptionsRecord {
  baseUrl?: string
  maxPages?: number
  delayMs?: number
  jitterMs?: number
  username?: string
}

export async function runArchiveJobWorkerOnce(options: ArchiveJobWorkerOptions): Promise<ArchiveJobWorkerResult> {
  const { store, closeStore } = openArchiveJobWorkerStore(options)
  try {
    const claimed = store.claimNextArchiveJob({ workerId: options.workerId })
    if (!claimed) {
      return { status: "idle" }
    }

    try {
      const details = await dispatchArchiveJob(claimed, store, options)
      const completed = store.finishArchiveJob(claimed.id, { status: "completed" })
      return { status: "completed", job: completed, details }
    } catch (error) {
      const message = errorToMessage(error as Error | string | null | undefined)
      const failed = store.finishArchiveJob(claimed.id, { status: "failed", error: message })
      return { status: "failed", job: failed, error: message }
    }
  } finally {
    if (closeStore) {
      store.close()
    }
  }
}

async function dispatchArchiveJob(job: SqliteArchiveJob, store: TwitterArchiveSqliteStore, workerOptions: ArchiveJobWorkerOptions): Promise<ArchiveJobWorkerDetails> {
  const jobOptions = archiveJobOptionsRecord(job.options)
  const baseUrl = jobOptions.baseUrl ?? workerOptions.baseUrl

  if (job.targetType === "following") {
    const username = parseProfileTarget(job.targetValue)
    const provenance = isRecord(job.provenance) ? job.provenance : undefined
    return captureNitterFollowingToSqlite(username, {
      store,
      baseUrl,
      fetch: workerOptions.fetchFn,
      maxPages: jobOptions.maxPages,
      observedAt: job.createdAt,
      provenance,
    })
  }

  if (job.targetType === "profile") {
    const username = parseProfileTarget(job.targetValue)
    return captureNitterTimelineToSqlite(username, {
      store,
      baseUrl,
      fetchFn: workerOptions.fetchFn,
      maxPages: jobOptions.maxPages,
      delayMs: jobOptions.delayMs,
      jitterMs: jobOptions.jitterMs,
      signal: workerOptions.signal,
    })
  }

  if (job.targetType === "status") {
    const reference = parseStatusTarget(job.targetValue, jobOptions.username)
    return resolveNitterTweetDetails([reference], {
      store,
      baseUrl,
      fetchFn: workerOptions.fetchFn,
      maxTweets: 1,
      delayMs: jobOptions.delayMs,
      jitterMs: jobOptions.jitterMs,
      signal: workerOptions.signal,
      targetUsername: reference.username,
    })
  }

  throw new Error(`Archive job target type is not dispatched yet: ${job.targetType}`)
}

function openArchiveJobWorkerStore(options: ArchiveJobWorkerOptions): { store: TwitterArchiveSqliteStore; closeStore: boolean } {
  if (options.store) {
    return { store: options.store, closeStore: false }
  }
  if (!options.dbPath) {
    throw new Error("runArchiveJobWorkerOnce requires dbPath or store")
  }
  return { store: initTwitterArchiveSqliteStore(options.dbPath), closeStore: true }
}

function isRecord(value: SqliteArchiveJob["options"]): value is SqliteJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function archiveJobOptionsRecord(options: SqliteArchiveJob["options"]): ArchiveJobOptionsRecord {
  if (!isRecord(options)) {
    return {}
  }
  return {
    baseUrl: stringField(options, "baseUrl"),
    maxPages: numberField(options, "maxPages"),
    delayMs: numberField(options, "delayMs"),
    jitterMs: numberField(options, "jitterMs"),
    username: stringField(options, "username"),
  }
}

function parseProfileTarget(target: string): string {
  const trimmed = target.trim()
  if (trimmed.length === 0) {
    throw new Error("Archive profile job target is empty")
  }

  try {
    const url = new URL(trimmed)
    const [first] = url.pathname.split("/").filter(Boolean)
    if (first) {
      return normalizeNitterUsername(first)
    }
  } catch {
    // Plain @handle targets are expected.
  }

  return normalizeNitterUsername(trimmed)
}

function parseStatusTarget(target: string, fallbackUsername?: string): { tweetId: string; username?: string; url?: string } {
  const tweetId = extractTweetId(target)
  if (!tweetId) {
    throw new Error(`Archive status job target does not contain a tweet id: ${target}`)
  }
  return {
    tweetId,
    username: extractUsernameFromTweetUrl(target) ?? extractUsernameFromNitterStatusUrl(target) ?? normalizeOptionalUsername(fallbackUsername),
    url: target,
  }
}

function extractUsernameFromNitterStatusUrl(input: string): string | undefined {
  try {
    const url = new URL(input)
    const [username, marker] = url.pathname.split("/").filter(Boolean)
    if (!username || (marker !== "status" && marker !== "statuses")) {
      return undefined
    }
    return normalizeUsername(username)
  } catch {
    return undefined
  }
}

function normalizeOptionalUsername(username: string | undefined): string | undefined {
  return username ? normalizeUsername(username) : undefined
}

function stringField(record: ArchiveJobJsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function numberField(record: ArchiveJobJsonRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}


function errorToMessage(error: Error | string | null | undefined): string {
  return error instanceof Error ? error.message : String(error)
}
