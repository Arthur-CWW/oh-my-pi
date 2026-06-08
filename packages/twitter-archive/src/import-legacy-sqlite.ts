import { Database } from "bun:sqlite"
import { resolve } from "node:path"

import { ensureArchiveLayout, resolveArchiveRoot, archivePaths } from "./paths"
import { upsertJsonlById } from "./jsonl"
import {
  canonicalTweetUrl,
  createArchiveRun,
  normalizeUsername,
  nowIso,
  stableId,
} from "./normalize"
import type { ArchiveMedia, ArchiveMediaType, ArchiveNote, ArchiveTweet, ArchiveUser } from "./schema"

interface LegacyTweetRow {
  tweet_id: string
  text: string | null
  language: string | null
  type: string | null
  bookmark_count: number | null
  favorite_count: number | null
  retweet_count: number | null
  reply_count: number | null
  view_count: number | null
  created_at: string | null
  client: string | null
  hashtags: string | null
  urls: string | null
  media_type: string | null
  media_urls: string | null
  archive_state: string | null
  archive_updated_at: string | null
  archive_snapshot_path: string | null
  archive_source: string | null
  archive_error: string | null
}

interface LegacyArchiveRow {
  tweet_id: string
  author_name: string | null
  author_handle: string | null
  tweet_text: string | null
  html: string | null
  source: string | null
  snapshot_timestamp: string | null
  captured_at: string | null
  fetched_at: string | null
  raw_json_path: string | null
  state: string | null
}

export interface ImportLegacySqliteOptions {
  dbPath: string
  outputRoot?: string
  baseDir?: string
  target?: string
  username?: string
  displayName?: string
  capturedAt?: string
}

export interface ImportLegacySqliteResult {
  root: string
  users: number
  tweets: number
  media: number
  notes: number
  archiveRuns: number
}

export async function importLegacyTweetArchivesSqlite(
  options: ImportLegacySqliteOptions,
): Promise<ImportLegacySqliteResult> {
  const target = options.target ?? options.username ?? "legacy-twitter-archive"
  const username = normalizeUsername(options.username ?? target)
  const capturedAt = options.capturedAt ?? nowIso()
  const root = options.outputRoot ?? resolveArchiveRoot({ baseDir: options.baseDir, target })
  const paths = archivePaths(root)

  await ensureArchiveLayout(paths)

  const db = new Database(resolve(options.dbPath), { readonly: true })
  try {
    const primaryRows = db.prepare("SELECT * FROM tweets ORDER BY created_at DESC, tweet_id DESC").all() as LegacyTweetRow[]
    const archiveRows = hasTable(db, "tweet_archives")
      ? (db.prepare("SELECT * FROM tweet_archives ORDER BY tweet_id").all() as LegacyArchiveRow[])
      : []

    const usersById = new Map<string, ArchiveUser>()
    const tweetsById = new Map<string, ArchiveTweet>()
    const mediaById = new Map<string, ArchiveMedia>()
    const notesById = new Map<string, ArchiveNote>()

    usersById.set(username, {
      id: username,
      username,
      displayName: options.displayName ?? username,
      profileUrl: `https://x.com/${username}`,
      capturedAt,
    })

    for (const row of primaryRows) {
      const mediaIds: string[] = []
      for (const [index, remoteUrl] of splitList(row.media_urls).entries()) {
        const id = `${row.tweet_id}_media_${index + 1}`
        const media: ArchiveMedia = {
          id,
          tweetId: row.tweet_id,
          type: normalizeMediaType(row.media_type),
          remoteUrl,
          capturedAt,
          source: "manual",
        }
        mediaById.set(id, media)
        mediaIds.push(id)
      }

      tweetsById.set(row.tweet_id, {
        id: row.tweet_id,
        authorId: username,
        username,
        url: canonicalTweetUrl(username, row.tweet_id),
        text: row.text ?? "",
        ...(row.created_at ? { createdAt: row.created_at } : {}),
        mediaIds,
        ...(row.language ? { language: row.language } : {}),
        publicMetrics: {
          replies: row.reply_count ?? undefined,
          reposts: row.retweet_count ?? undefined,
          likes: row.favorite_count ?? undefined,
          views: row.view_count ?? undefined,
        },
        capturedAt,
        source: "manual",
      })

      if (row.archive_error) {
        const id = `legacy_archive_error_${row.tweet_id}`
        notesById.set(id, {
          id,
          entityType: "tweet",
          entityId: row.tweet_id,
          text: `Legacy archive error (${row.archive_state ?? "unknown"}): ${row.archive_error}`,
          createdAt: row.archive_updated_at ?? capturedAt,
        })
      }
    }

    for (const row of archiveRows) {
      if (!row.tweet_text || !row.author_handle) {
        if (row.state && row.state !== "applied") {
          const id = `legacy_hydration_state_${row.tweet_id}`
          notesById.set(id, {
            id,
            entityType: "tweet",
            entityId: row.tweet_id,
            text: `Legacy hydration state: ${row.state}`,
            createdAt: row.fetched_at ?? capturedAt,
          })
        }
        continue
      }

      const archivedUsername = normalizeUsername(row.author_handle)
      usersById.set(archivedUsername, {
        id: archivedUsername,
        username: archivedUsername,
        displayName: row.author_name ?? archivedUsername,
        profileUrl: `https://x.com/${archivedUsername}`,
        capturedAt,
      })

      if (!tweetsById.has(row.tweet_id)) {
        tweetsById.set(row.tweet_id, {
          id: row.tweet_id,
          authorId: archivedUsername,
          username: archivedUsername,
          url: canonicalTweetUrl(archivedUsername, row.tweet_id),
          text: row.tweet_text,
          mediaIds: [],
          capturedAt: row.fetched_at ?? capturedAt,
          source: row.source === "wayback" || row.source === "live" ? "tool" : "manual",
        })
      }

      if (row.raw_json_path || row.snapshot_timestamp) {
        const id = `legacy_hydration_${row.tweet_id}`
        notesById.set(id, {
          id,
          entityType: "tweet",
          entityId: row.tweet_id,
          text: [
            `Legacy hydration source: ${row.source ?? "unknown"}`,
            row.snapshot_timestamp ? `snapshot: ${row.snapshot_timestamp}` : undefined,
            row.raw_json_path ? `raw: ${row.raw_json_path}` : undefined,
          ]
            .filter(Boolean)
            .join("; "),
          createdAt: row.fetched_at ?? capturedAt,
        })
      }
    }

    const users = [...usersById.values()]
    const tweets = [...tweetsById.values()]
    const media = [...mediaById.values()]
    const notes = [...notesById.values()]
    const run = createArchiveRun({
      target,
      query: `legacy sqlite import from ${options.dbPath}`,
      source: "manual",
      tool: "packages/twitter-archive/src/import-legacy-sqlite.ts",
      startedAt: capturedAt,
    })
    run.status = "completed"
    run.finishedAt = capturedAt
    run.tweetIds = tweets.map((tweet) => tweet.id)
    run.userIds = users.map((user) => user.id)
    run.mediaIds = media.map((item) => item.id)

    await upsertJsonlById(paths.entityFiles.users, users)
    await upsertJsonlById(paths.entityFiles.tweets, tweets)
    await upsertJsonlById(paths.entityFiles.media, media)
    await upsertJsonlById(paths.entityFiles.notes, notes)
    await upsertJsonlById(paths.entityFiles.archiveRuns, [run])

    return {
      root,
      users: users.length,
      tweets: tweets.length,
      media: media.length,
      notes: notes.length,
      archiveRuns: 1,
    }
  } finally {
    db.close()
  }
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined
  return row?.name === tableName
}

function splitList(value: string | null): string[] {
  if (!value) {
    return []
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeMediaType(value: string | null): ArchiveMediaType {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "photo" || normalized === "image") {
    return "image"
  }
  if (normalized === "video") {
    return "video"
  }
  if (normalized === "animated_gif" || normalized === "gif") {
    return "gif"
  }
  return "unknown"
}

function parseArgs(argv: string[]): ImportLegacySqliteOptions {
  const options: ImportLegacySqliteOptions = { dbPath: "tweets.db" }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === "--db" && next) {
      options.dbPath = next
      index += 1
    } else if (arg === "--out" && next) {
      options.outputRoot = next
      index += 1
    } else if (arg === "--base-dir" && next) {
      options.baseDir = next
      index += 1
    } else if (arg === "--target" && next) {
      options.target = next
      index += 1
    } else if (arg === "--username" && next) {
      options.username = next
      index += 1
    } else if (arg === "--display-name" && next) {
      options.displayName = next
      index += 1
    }
  }
  return options
}

if (import.meta.main) {
  const result = await importLegacyTweetArchivesSqlite(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
