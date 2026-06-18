import { Database } from "bun:sqlite"
import { readFile, readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

export type BrowserBookmarkSourceKind = "chrome-bookmarks-json" | "arc-bookmarks-json" | "firefox-places-sqlite"
export type BrowserBookmarkTargetKind = "profile" | "status" | "search"
export type BrowserBookmarkSkipReason =
  | "not-twitter-url"
  | "x-authenticated-bookmarks"
  | "x-internal-page"
  | "search-without-query"
  | "not-profile-status-or-search"
  | "invalid-url"

export interface BrowserBookmarkSource {
  readonly kind: BrowserBookmarkSourceKind
  readonly path: string
  readonly profileName?: string
}

export interface BrowserBookmarkTarget {
  readonly kind: BrowserBookmarkTargetKind
  readonly canonicalUrl: string
  readonly handle?: string
  readonly statusId?: string
  readonly query?: string
}

export interface BrowserBookmarkProvenance {
  readonly sourceKind: BrowserBookmarkSourceKind
  readonly sourcePath: string
  readonly profileName?: string
  readonly bookmarkId?: string
  readonly title?: string
  readonly folderPath: readonly string[]
  readonly sourceUrl: string
  readonly addedAt?: string
  readonly lastUsedAt?: string
  readonly lastModifiedAt?: string
}

export interface BrowserBookmarkCandidate {
  readonly target: BrowserBookmarkTarget
  readonly provenance: BrowserBookmarkProvenance
}

export interface BrowserBookmarkSkippedTwitterUrl {
  readonly reason: BrowserBookmarkSkipReason
  readonly provenance: BrowserBookmarkProvenance
}

export interface BrowserBookmarkImportResult {
  readonly sources: readonly BrowserBookmarkSource[]
  readonly candidates: readonly BrowserBookmarkCandidate[]
  readonly skippedTwitterUrls: readonly BrowserBookmarkSkippedTwitterUrl[]
}

type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue }
type JsonRecord = { readonly [key: string]: JsonValue }

interface FirefoxBookmarkRow {
  readonly id: number
  readonly title: string | null
  readonly url: string
  readonly dateAdded: number | null
  readonly lastModified: number | null
  readonly folder_path: string | null
}

interface NormalizedTwitterBookmarkUrl {
  readonly target?: BrowserBookmarkTarget
  readonly skipReason?: BrowserBookmarkSkipReason
}

const TWITTER_HOSTS: Record<string, true> = {
  "mobile.twitter.com": true,
  "twitter.com": true,
  "x.com": true,
}
const X_INTERNAL_PATHS: Record<string, true> = {
  account: true,
  account_analytics: true,
  compose: true,
  explore: true,
  home: true,
  i: true,
  login: true,
  logout: true,
  messages: true,
  notifications: true,
  settings: true,
  signup: true,
}

export async function discoverMacBrowserBookmarkSources(homeDir: string): Promise<readonly BrowserBookmarkSource[]> {
  const sources: BrowserBookmarkSource[] = []
  sources.push(...(await discoverChromiumBookmarkSources(join(homeDir, "Library/Application Support/Google/Chrome"), "chrome-bookmarks-json")))
  sources.push(...(await discoverChromiumBookmarkSources(join(homeDir, "Library/Application Support/Arc/User Data"), "arc-bookmarks-json")))
  sources.push(...(await discoverFirefoxPlacesSources(join(homeDir, "Library/Application Support/Firefox/Profiles"))))
  return sources
}

export async function importLocalBrowserBookmarkTargets(sources: readonly BrowserBookmarkSource[]): Promise<BrowserBookmarkImportResult> {
  const candidates: BrowserBookmarkCandidate[] = []
  const skippedTwitterUrls: BrowserBookmarkSkippedTwitterUrl[] = []

  for (const source of sources) {
    const result = await readBrowserBookmarkSource(source)
    candidates.push(...result.candidates)
    skippedTwitterUrls.push(...result.skippedTwitterUrls)
  }

  return { sources, candidates: dedupeCandidates(candidates), skippedTwitterUrls }
}

export async function readBrowserBookmarkSource(
  source: BrowserBookmarkSource,
): Promise<Pick<BrowserBookmarkImportResult, "candidates" | "skippedTwitterUrls">> {
  if (source.kind === "firefox-places-sqlite") {
    return readFirefoxPlacesBookmarks(source)
  }
  return readChromiumBookmarksJson(source)
}

export function normalizeTwitterBookmarkUrl(input: string): NormalizedTwitterBookmarkUrl {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { skipReason: "invalid-url" }
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase()
  if (!Object.hasOwn(TWITTER_HOSTS, host)) {
    return { skipReason: "not-twitter-url" }
  }

  const parts = url.pathname.split("/").filter(Boolean)
  if (parts.length === 0) {
    return { skipReason: "not-profile-status-or-search" }
  }

  const firstPart = parts[0]?.toLowerCase() ?? ""
  if (firstPart === "search") {
    const query = url.searchParams.get("q")?.trim()
    if (!query) {
      return { skipReason: "search-without-query" }
    }
    return { target: { kind: "search", query, canonicalUrl: canonicalXSearchUrl(query) } }
  }

  const secondPart = parts[1]?.toLowerCase()
  const statusId = parts[2]
  if ((secondPart === "status" || secondPart === "statuses") && statusId && /^\d+$/.test(statusId)) {
    const handle = normalizeHandle(parts[0] ?? "")
    if (!handle) {
      return { skipReason: "not-profile-status-or-search" }
    }
    return { target: { kind: "status", handle, statusId, canonicalUrl: `https://x.com/${handle}/status/${statusId}` } }
  }

  if (Object.hasOwn(X_INTERNAL_PATHS, firstPart)) {
    return { skipReason: firstPart === "i" && parts[1]?.toLowerCase() === "bookmarks" ? "x-authenticated-bookmarks" : "x-internal-page" }
  }

  if (parts.length === 1) {
    const handle = normalizeHandle(parts[0] ?? "")
    if (handle) {
      return { target: { kind: "profile", handle, canonicalUrl: `https://x.com/${handle}` } }
    }
  }

  return { skipReason: "not-profile-status-or-search" }
}

async function readChromiumBookmarksJson(
  source: BrowserBookmarkSource,
): Promise<Pick<BrowserBookmarkImportResult, "candidates" | "skippedTwitterUrls">> {
  const parsed = JSON.parse(await readFile(source.path, "utf8")) as JsonValue
  const roots = readRecord(readRecord(parsed)?.roots)
  const candidates: BrowserBookmarkCandidate[] = []
  const skippedTwitterUrls: BrowserBookmarkSkippedTwitterUrl[] = []

  if (!roots) {
    return { candidates, skippedTwitterUrls }
  }

  for (const [rootName, rootNode] of Object.entries(roots)) {
    walkChromiumBookmarkNode(source, rootNode, [rootName], candidates, skippedTwitterUrls)
  }

  return { candidates, skippedTwitterUrls }
}

function walkChromiumBookmarkNode(
  source: BrowserBookmarkSource,
  node: JsonValue,
  folderPath: readonly string[],
  candidates: BrowserBookmarkCandidate[],
  skippedTwitterUrls: BrowserBookmarkSkippedTwitterUrl[],
): void {
  const record = readRecord(node)
  if (!record) {
    return
  }

  const type = readString(record.type)
  const name = readString(record.name)
  if (type === "url") {
    const sourceUrl = readString(record.url)
    if (sourceUrl) {
      collectBookmarkUrl({
        candidates,
        skippedTwitterUrls,
        source,
        sourceUrl,
        title: name,
        folderPath,
        bookmarkId: readString(record.id),
        addedAt: chromeTimeToIso(readString(record.date_added)),
        lastUsedAt: chromeTimeToIso(readString(record.date_last_used)),
      })
    }
  }

  const children = readArray(record.children)
  if (!children) {
    return
  }

  const nextFolderPath = type === "folder" && name ? [...folderPath, name] : folderPath
  for (const child of children) {
    walkChromiumBookmarkNode(source, child, nextFolderPath, candidates, skippedTwitterUrls)
  }
}

function readFirefoxPlacesBookmarks(
  source: BrowserBookmarkSource,
): Pick<BrowserBookmarkImportResult, "candidates" | "skippedTwitterUrls"> {
  const db = new Database(firefoxImmutableUri(source.path), { readonly: true })
  try {
    const rows = db
      .prepare(
        `WITH RECURSIVE bookmark_paths(id, parent, title, path) AS (
          SELECT id, parent, COALESCE(title, ''), COALESCE(title, '')
          FROM moz_bookmarks
          WHERE parent = 0
          UNION ALL
          SELECT child.id, child.parent, COALESCE(child.title, ''), bookmark_paths.path || '/' || COALESCE(child.title, '')
          FROM moz_bookmarks child
          JOIN bookmark_paths ON child.parent = bookmark_paths.id
        )
        SELECT b.id, b.title, p.url, b.dateAdded, b.lastModified, parent.path AS folder_path
        FROM moz_bookmarks b
        JOIN moz_places p ON p.id = b.fk
        LEFT JOIN bookmark_paths parent ON parent.id = b.parent
        WHERE p.url LIKE '%://x.com/%'
           OR p.url LIKE '%://www.x.com/%'
           OR p.url LIKE '%://twitter.com/%'
           OR p.url LIKE '%://www.twitter.com/%'
           OR p.url LIKE '%://mobile.twitter.com/%'
        ORDER BY b.dateAdded DESC, b.id DESC`,
      )
      .all() as FirefoxBookmarkRow[]

    const candidates: BrowserBookmarkCandidate[] = []
    const skippedTwitterUrls: BrowserBookmarkSkippedTwitterUrl[] = []
    for (const row of rows) {
      collectBookmarkUrl({
        candidates,
        skippedTwitterUrls,
        source,
        sourceUrl: row.url,
        title: row.title ?? undefined,
        folderPath: splitFirefoxFolderPath(row.folder_path),
        bookmarkId: String(row.id),
        addedAt: firefoxTimeToIso(row.dateAdded),
        lastModifiedAt: firefoxTimeToIso(row.lastModified),
      })
    }

    return { candidates, skippedTwitterUrls }
  } finally {
    db.close()
  }
}

function collectBookmarkUrl(input: {
  readonly candidates: BrowserBookmarkCandidate[]
  readonly skippedTwitterUrls: BrowserBookmarkSkippedTwitterUrl[]
  readonly source: BrowserBookmarkSource
  readonly sourceUrl: string
  readonly title?: string
  readonly folderPath: readonly string[]
  readonly bookmarkId?: string
  readonly addedAt?: string
  readonly lastUsedAt?: string
  readonly lastModifiedAt?: string
}): void {
  const normalized = normalizeTwitterBookmarkUrl(input.sourceUrl)
  const provenance: BrowserBookmarkProvenance = {
    sourceKind: input.source.kind,
    sourcePath: input.source.path,
    profileName: input.source.profileName,
    bookmarkId: input.bookmarkId,
    title: input.title,
    folderPath: input.folderPath,
    sourceUrl: input.sourceUrl,
    addedAt: input.addedAt,
    lastUsedAt: input.lastUsedAt,
    lastModifiedAt: input.lastModifiedAt,
  }

  if (normalized.target) {
    input.candidates.push({ target: normalized.target, provenance })
    return
  }

  if (normalized.skipReason && normalized.skipReason !== "not-twitter-url") {
    input.skippedTwitterUrls.push({ reason: normalized.skipReason, provenance })
  }
}

async function discoverChromiumBookmarkSources(rootDir: string, kind: "chrome-bookmarks-json" | "arc-bookmarks-json"): Promise<readonly BrowserBookmarkSource[]> {
  const profileNames = await readDirectoryNames(rootDir)
  const sources: BrowserBookmarkSource[] = []
  for (const profileName of profileNames) {
    const path = join(rootDir, profileName, "Bookmarks")
    if (await isReadableFile(path)) {
      sources.push({ kind, path, profileName })
    }
  }
  return sources
}

async function discoverFirefoxPlacesSources(rootDir: string): Promise<readonly BrowserBookmarkSource[]> {
  const profileNames = await readDirectoryNames(rootDir)
  const sources: BrowserBookmarkSource[] = []
  for (const profileName of profileNames) {
    const path = join(rootDir, profileName, "places.sqlite")
    if (await isReadableFile(path)) {
      sources.push({ kind: "firefox-places-sqlite", path, profileName })
    }
  }
  return sources
}

async function readDirectoryNames(path: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function dedupeCandidates(candidates: readonly BrowserBookmarkCandidate[]): readonly BrowserBookmarkCandidate[] {
  const byKey = new Map<string, BrowserBookmarkCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.target.kind}\u001f${candidate.target.canonicalUrl}`
    if (!byKey.has(key)) {
      byKey.set(key, candidate)
    }
  }
  return Array.from(byKey.values())
}

function normalizeHandle(input: string): string | undefined {
  const handle = input.trim().replace(/^@+/, "").toLowerCase()
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : undefined
}

function canonicalXSearchUrl(query: string): string {
  const url = new URL("https://x.com/search")
  url.searchParams.set("q", query)
  return url.toString()
}

function chromeTimeToIso(value: string | undefined): string | undefined {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined
  }
  return new Date(timestamp / 1000 - 11644473600000).toISOString()
}

function firefoxTimeToIso(value: number | null): string | undefined {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return new Date(value / 1000).toISOString()
}

function firefoxImmutableUri(path: string): string {
  return `file:${resolve(path).split("/").map(encodeURIComponent).join("/")}?immutable=1&mode=ro`
}

function splitFirefoxFolderPath(path: string | null): readonly string[] {
  if (!path) {
    return []
  }
  return path.split("/").filter(Boolean)
}

function readRecord(value: JsonValue | undefined): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return value as JsonRecord
}

function readArray(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}
