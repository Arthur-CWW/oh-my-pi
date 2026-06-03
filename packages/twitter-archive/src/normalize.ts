import { createHash } from "node:crypto"

import { createArchiveScope, type ArchiveRun, type ArchiveScope, type ArchiveCaptureSource } from "./schema"

export function nowIso(): string {
  return new Date().toISOString()
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, "").toLowerCase()
}

export function canonicalTweetUrl(username: string, tweetId: string): string {
  return `https://x.com/${normalizeUsername(username)}/status/${tweetId}`
}

export function extractTweetId(input: string): string | undefined {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }

  return trimmed.match(/(?:status|statuses)\/(\d+)/)?.[1]
}

export function extractUsernameFromTweetUrl(input: string): string | undefined {
  try {
    const url = new URL(input)
    const host = url.hostname.replace(/^www\./, "")
    if (host !== "x.com" && host !== "twitter.com" && host !== "mobile.twitter.com") {
      return undefined
    }

    const [username, marker] = url.pathname.split("/").filter(Boolean)
    if (!username || (marker !== "status" && marker !== "statuses")) {
      return undefined
    }

    return normalizeUsername(username)
  } catch {
    return undefined
  }
}

export function stableId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex")
}

export interface CreateArchiveRunInput {
  id?: string
  target: string
  query?: string
  scope?: Partial<Omit<ArchiveScope, "excludeLikesBookmarks">>
  source?: ArchiveCaptureSource
  tool?: string
  startedAt?: string
}

export function createArchiveRun(input: CreateArchiveRunInput): ArchiveRun {
  const startedAt = input.startedAt ?? nowIso()
  const source = input.source ?? "unknown"
  const scope = createArchiveScope(input.scope)
  const id =
    input.id ??
    `run_${startedAt.replace(/[^0-9]/g, "").slice(0, 14)}_${stableId([
      input.target,
      input.query ?? "",
      source,
      input.tool ?? "",
      startedAt,
    ]).slice(0, 10)}`

  return {
    id,
    target: input.target,
    query: input.query,
    scope,
    source,
    tool: input.tool,
    status: "planned",
    startedAt,
    tweetIds: [],
    userIds: [],
    mediaIds: [],
  }
}
