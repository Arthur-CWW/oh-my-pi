import { readFile } from "node:fs/promises"

import { extractTweetId, extractUsernameFromTweetUrl, normalizeUsername } from "./normalize"
import {
  initTwitterArchiveSqliteStore,
  type SqliteArchiveJob,
  type SqliteArchiveJobTargetType,
  type TwitterArchiveSqliteStore,
} from "./sqlite-store"

type CandidateValue = null | string | number | boolean | readonly CandidateValue[] | CandidateRecord
interface CandidateRecord {
  readonly [key: string]: CandidateValue | undefined
}

export interface BrowserHistoryArchiveJobImportOptions {
  dbPath?: string
  store?: TwitterArchiveSqliteStore
  sourceLane?: string
  defaultPriority?: number
  provenance?: CandidateRecord
}

export interface BrowserHistoryArchiveJobImportResult {
  jobs: SqliteArchiveJob[]
  skipped: number
}

interface NormalizedHistoryCandidate {
  targetType: Extract<SqliteArchiveJobTargetType, "profile" | "status">
  targetValue: string
  priority?: number
  options?: CandidateRecord
  provenance?: CandidateRecord
}

export async function enqueueBrowserHistoryArchiveJobsFromFile(
  path: string,
  options: BrowserHistoryArchiveJobImportOptions = {},
): Promise<BrowserHistoryArchiveJobImportResult> {
  const payload = JSON.parse(await readFile(path, "utf8")) as CandidateValue
  return enqueueBrowserHistoryArchiveJobs(payload, options)
}

export function enqueueBrowserHistoryArchiveJobs(
  payload: CandidateValue,
  options: BrowserHistoryArchiveJobImportOptions = {},
): BrowserHistoryArchiveJobImportResult {
  const { store, closeStore } = openHistoryImportStore(options)
  try {
    const sourceLane = options.sourceLane ?? "browser-history"
    const imported = flattenCandidatePayload(payload)
    const jobs: SqliteArchiveJob[] = []
    let skipped = 0

    for (const rawCandidate of imported) {
      const candidate = normalizeHistoryCandidate(rawCandidate)
      if (!candidate) {
        skipped += 1
        continue
      }
      jobs.push(
        store.enqueueArchiveJob({
          sourceLane,
          targetType: candidate.targetType,
          targetValue: candidate.targetValue,
          priority: candidate.priority ?? options.defaultPriority,
          options: candidate.options,
          provenance: {
            import: "browser-history-candidates",
            candidate: candidate.provenance ?? rawCandidate,
            ...(isRecord(options.provenance) ? options.provenance : {}),
          },
        }),
      )
    }

    return { jobs, skipped }
  } finally {
    if (closeStore) {
      store.close()
    }
  }
}

function openHistoryImportStore(options: BrowserHistoryArchiveJobImportOptions): { store: TwitterArchiveSqliteStore; closeStore: boolean } {
  if (options.store) {
    return { store: options.store, closeStore: false }
  }
  if (!options.dbPath) {
    throw new Error("enqueueBrowserHistoryArchiveJobs requires dbPath or store")
  }
  return { store: initTwitterArchiveSqliteStore(options.dbPath), closeStore: true }
}

function flattenCandidatePayload(payload: CandidateValue): CandidateValue[] {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!isRecord(payload)) {
    return []
  }
  const candidates = [payload.candidateScrapeTargets, payload.candidates, payload.targets, payload.jobs, payload.accounts, payload.profiles, payload.statuses, payload.posts]
  return candidates.flatMap((value) => (Array.isArray(value) ? value : []))
}

function normalizeHistoryCandidate(candidate: CandidateValue): NormalizedHistoryCandidate | undefined {
  if (!isRecord(candidate)) {
    return undefined
  }

  const explicitType = stringField(candidate, "targetType") ?? stringField(candidate, "type") ?? stringField(candidate, "kind")
  const explicitValue = stringField(candidate, "targetValue") ?? stringField(candidate, "target")
  if (explicitValue && explicitType) {
    if (explicitType === "profile" || explicitType === "account" || explicitType === "handle") {
      return withCandidateMetadata(candidate, "profile", normalizeProfileTarget(explicitValue))
    }
    if (explicitType === "status" || explicitType === "post" || explicitType === "tweet") {
      return withCandidateMetadata(candidate, "status", explicitValue)
    }
  }

  const statusUrl = stringField(candidate, "statusUrl") ?? stringField(candidate, "tweetUrl") ?? stringField(candidate, "postUrl")
  if (statusUrl && extractTweetId(statusUrl)) {
    return withCandidateMetadata(candidate, "status", statusUrl)
  }

  const url = stringField(candidate, "url")
  if (url && extractTweetId(url)) {
    return withCandidateMetadata(candidate, "status", url)
  }
  if (url) {
    const username = profileUsernameFromUrl(url)
    if (username) {
      return withCandidateMetadata(candidate, "profile", username)
    }
  }

  const username = stringField(candidate, "username") ?? stringField(candidate, "handle") ?? stringField(candidate, "account")
  return username ? withCandidateMetadata(candidate, "profile", normalizeProfileTarget(username)) : undefined
}

function withCandidateMetadata(
  candidate: CandidateRecord,
  targetType: Extract<SqliteArchiveJobTargetType, "profile" | "status">,
  targetValue: string,
): NormalizedHistoryCandidate {
  return {
    targetType,
    targetValue,
    priority: numberField(candidate, "priority") ?? numberField(candidate, "enqueuePriority") ?? numberField(candidate, "score"),
    options: isRecord(candidate.options) ? candidate.options : undefined,
    provenance: candidate,
  }
}

function normalizeProfileTarget(target: string): string {
  return normalizeUsername(target)
}

function profileUsernameFromUrl(value: string): string | undefined {
  const fromStatus = extractUsernameFromTweetUrl(value)
  if (fromStatus) {
    return fromStatus
  }
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./, "")
    if (host !== "x.com" && host !== "twitter.com" && host !== "mobile.twitter.com") {
      return undefined
    }
    const [username] = url.pathname.split("/").filter(Boolean)
    return username ? normalizeUsername(username) : undefined
  } catch {
    return undefined
  }
}

function stringField(record: CandidateRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function numberField(record: CandidateRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: CandidateValue | undefined): value is CandidateRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function runCli(args: readonly string[]): Promise<void> {
  const [file, ...rest] = args
  if (!file) {
    throw new Error("Usage: bun src/browser-history-queue.ts <candidates.json> --db <archive.sqlite>")
  }
  const dbFlagIndex = rest.indexOf("--db")
  const dbPath = dbFlagIndex >= 0 ? rest[dbFlagIndex + 1] : undefined
  if (!dbPath) {
    throw new Error("Missing --db <archive.sqlite>")
  }
  const result = await enqueueBrowserHistoryArchiveJobsFromFile(file, { dbPath })
  console.info(JSON.stringify({ enqueued: result.jobs.length, skipped: result.skipped }, null, 2))
}

if (import.meta.main) {
  await runCli(Bun.argv.slice(2))
}
