#!/usr/bin/env bun
/**
 * Public Nitter media corpus sync.
 *
 * Respectful defaults: public Nitter only, concurrency 1, 1-3s jitter, hard cap 150 video/GIF items.
 */
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"

const DEFAULT_HANDLE = "pleometric"
const SCHEMA_VERSION = "pleometric-corpus.v1" as const
const DEFAULT_BASE_URL = "https://nitter.tiekoetter.com"
const DEFAULT_DB_PATH = "data/twitter-archive/twitter-archive.sqlite"
const MAX_ITEMS = 150
const MAX_PAGES = 25
const USER_AGENT = "curl/8.0"

interface Args {
  handle: string
  baseUrl: string
  dataDir: string
  reportDir: string
  dbPath: string
  maxItems: number
  maxPages: number
}

interface ManifestItem {
  tweetId: string
  date?: string
  text?: string
  mediaType: "video" | "gif"
  file: string
  sourceUrl: string
  width?: number
  height?: number
  durationSeconds?: number
}

interface RawVideoItem {
  tweetId: string
  date?: string
  text?: string
  mediaType: "video" | "gif"
  sourceUrl: string
}

interface Manifest {
  schemaVersion: typeof SCHEMA_VERSION
  handle: string
  generatedAt: string
  items: ManifestItem[]
}

interface ProbeResult {
  streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
  format?: { duration?: string }
}

interface SyncReport {
  schemaVersion: "pleometric-sync-report.v1"
  generatedAt: string
  tools: Record<string, string>
  archiveSqlite: { path: string; pleometricMediaRows: number; pleometricVideoGifRows: number }
  fetch: { baseUrl: string; pagesFetched: number; stopReason: string; walls: string[] }
  files: { manifest: string; contactSheet: string; dataDir: string }
  counts: { items: number; existingAtStart: number; newItems: number; filesOnDisk: number }
  dateRange?: { earliest: string; latest: string }
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const dataDir = resolve(args.dataDir)
  const reportDir = resolve(args.reportDir)
  const manifestPath = join(dataDir, "manifest.json")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(reportDir, { recursive: true })

  const existingManifest = loadExistingManifest(manifestPath)
  const startingItemCount = existingManifest?.items.length ?? 0
  const manifestItems = existingManifest ? [...existingManifest.items] : []
  const seenSourceUrls = new Set<string>()
  const mediaOrdinalByTweet = new Map<string, number>()
  seedResumeState(manifestItems, seenSourceUrls, mediaOrdinalByTweet)

  const tools = await probeTools(["yt-dlp", "gallery-dl", "ffmpeg", "ffprobe"])
  const archiveSqlite = queryLocalArchive(args.dbPath, args.handle)

  let pagesFetched = 0
  let stopReason = "max-pages"
  const walls: string[] = []
  let nextUrl: string | undefined = `${trimSlash(args.baseUrl)}/${args.handle}/media?view=timeline`

  for (let page = 0; page < args.maxPages && manifestItems.length < args.maxItems && nextUrl; page += 1) {
    const response = await fetch(nextUrl, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT } })
    const body = await response.text()
    pagesFetched += 1

    if (response.status === 429 || response.status === 403) {
      stopReason = `wall-${response.status}`
      walls.push(`${response.status} at ${nextUrl}`)
      break
    }
    if (!response.ok) {
      stopReason = `non-2xx-${response.status}`
      walls.push(`${response.status} at ${nextUrl}`)
      break
    }
    if (!body.includes("timeline-item") && /captcha|enable javascript|cloudflare|temporarily unavailable|instance has been rate limited/i.test(body)) {
      stopReason = "challenge-or-rate-limit"
      walls.push(`challenge/rate-limit marker at ${nextUrl}`)
      break
    }

    for (const media of extractPrimaryVideoItems(body, args.handle)) {
      if (manifestItems.length >= args.maxItems) break
      if (seenSourceUrls.has(media.sourceUrl)) continue
      seenSourceUrls.add(media.sourceUrl)

      const ordinal = (mediaOrdinalByTweet.get(media.tweetId) ?? 0) + 1
      mediaOrdinalByTweet.set(media.tweetId, ordinal)
      const ext = extensionForUrl(media.sourceUrl)
      const fileName = `${media.tweetId}-${ordinal}${ext}`
      const outputPath = join(dataDir, fileName)
      await downloadMedia(media.sourceUrl, outputPath)
      const probe = await probeVideo(outputPath)
      manifestItems.push({
        tweetId: media.tweetId,
        date: media.date,
        text: media.text,
        mediaType: media.mediaType,
        file: fileName,
        sourceUrl: media.sourceUrl,
        width: probe.width,
        height: probe.height,
        durationSeconds: probe.durationSeconds,
      })
      writeManifest(manifestPath, args.handle, manifestItems, startingItemCount)
      if (manifestItems.length < args.maxItems) await sleep(jitterMs())
    }

    writeManifest(manifestPath, args.handle, manifestItems, startingItemCount)

    const cursorUrl = extractNextCursorUrl(body, args.baseUrl, nextUrl)
    if (!cursorUrl) {
      stopReason = "no-cursor"
      break
    }
    nextUrl = cursorUrl
    if (manifestItems.length < args.maxItems && page + 1 < args.maxPages) await sleep(jitterMs())
  }

  if (manifestItems.length >= args.maxItems) stopReason = "max-items"
  writeManifest(manifestPath, args.handle, manifestItems, startingItemCount)

  const contactSheetPath = join(reportDir, `${args.handle}-contact-sheet.png`)
  if (manifestItems.length > 0) {
    await buildContactSheet(manifestItems.slice(0, 24), dataDir, reportDir, contactSheetPath)
  }

  const report: SyncReport = {
    schemaVersion: "pleometric-sync-report.v1",
    generatedAt: new Date().toISOString(),
    tools,
    archiveSqlite,
    fetch: { baseUrl: args.baseUrl, pagesFetched, stopReason, walls },
    files: {
      manifest: relative(process.cwd(), manifestPath),
      contactSheet: relative(process.cwd(), contactSheetPath),
      dataDir: relative(process.cwd(), dataDir),
    },
    counts: { items: manifestItems.length, existingAtStart: startingItemCount, newItems: manifestItems.length - startingItemCount, filesOnDisk: manifestItems.length + 1 },
    dateRange: dateRange(manifestItems),
  }
  writeFileSync(join(reportDir, "sync-summary.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

function parseArgs(argv: string[]): Args {
  let handle = DEFAULT_HANDLE
  let dataDir: string | undefined
  let reportDir: string | undefined
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    dbPath: DEFAULT_DB_PATH,
    maxItems: MAX_ITEMS,
    maxPages: MAX_PAGES,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case "--handle":
        if (!value) throw new Error("--handle requires a value")
        handle = validHandle(value)
        i += 1
        break
      case "--base-url":
        if (!value) throw new Error("--base-url requires a value")
        args.baseUrl = value
        i += 1
        break
      case "--data-dir":
        if (!value) throw new Error("--data-dir requires a value")
        dataDir = value
        i += 1
        break
      case "--report-dir":
        if (!value) throw new Error("--report-dir requires a value")
        reportDir = value
        i += 1
        break
      case "--db":
        if (!value) throw new Error("--db requires a value")
        args.dbPath = value
        i += 1
        break
      case "--max-items":
        if (!value) throw new Error("--max-items requires a value")
        args.maxItems = Math.min(MAX_ITEMS, positiveInteger(value, "--max-items"))
        i += 1
        break
      case "--max-pages":
        if (!value) throw new Error("--max-pages requires a value")
        args.maxPages = Math.min(MAX_PAGES, positiveInteger(value, "--max-pages"))
        i += 1
        break
      case "--help":
      case "-h":
        console.log([
          "Usage: bun scripts/pleometric-media-sync.boundary.ts [options]",
          "",
          "Options:",
          "  --handle <h>       Nitter/Twitter handle to sync (default: pleometric)",
          "  --base-url <url>   Public Nitter base URL",
          "  --data-dir <dir>   Corpus dir (default: data/inspiration/<handle>)",
          "  --report-dir <dir> Report dir (default: workflows/scene-lab/reports/<YYYY-MM-DD>-<handle>-corpus)",
          "  --db <path>        Local twitter archive sqlite path",
          "  --max-items <n>    Total corpus cap after merge (ceiling: 150)",
          "  --max-pages <n>    Page fetch cap (ceiling: 25)",
        ].join("\n"))
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }
  return {
    handle,
    dataDir: dataDir ?? defaultDataDir(handle),
    reportDir: reportDir ?? defaultReportDir(handle),
    ...args,
  }
}

function defaultDataDir(handle: string): string {
  return `data/inspiration/${handle}`
}

function defaultReportDir(handle: string): string {
  return `workflows/scene-lab/reports/${todayIsoDate()}-${handle}-corpus`
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function validHandle(value: string): string {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) throw new Error("--handle must be a Twitter/Nitter handle")
  return value
}

function loadExistingManifest(manifestPath: string): Manifest | undefined {
  if (!existsSync(manifestPath)) return undefined
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<Manifest>
  if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported manifest schema at ${manifestPath}`)
  if (typeof parsed.handle !== "string") throw new Error(`manifest handle missing at ${manifestPath}`)
  if (typeof parsed.generatedAt !== "string") throw new Error(`manifest generatedAt missing at ${manifestPath}`)
  if (!Array.isArray(parsed.items)) throw new Error(`manifest items missing at ${manifestPath}`)
  return {
    schemaVersion: SCHEMA_VERSION,
    handle: parsed.handle,
    generatedAt: parsed.generatedAt,
    items: parsed.items as ManifestItem[],
  }
}

function seedResumeState(
  items: ManifestItem[],
  seenSourceUrls: Set<string>,
  mediaOrdinalByTweet: Map<string, number>,
): void {
  for (const item of items) {
    seenSourceUrls.add(item.sourceUrl)
    const current = mediaOrdinalByTweet.get(item.tweetId) ?? 0
    mediaOrdinalByTweet.set(item.tweetId, Math.max(current, ordinalFromFile(item.file) ?? current + 1))
  }
}

function ordinalFromFile(fileName: string): number | undefined {
  const value = Number(fileName.match(/-(\d+)\.[^.]+$/)?.[1])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function writeManifest(manifestPath: string, handle: string, items: ManifestItem[], minimumItemCount: number): void {
  if (items.length < minimumItemCount) {
    throw new Error(`refusing to shrink manifest from ${minimumItemCount} to ${items.length} items`)
  }
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    handle,
    generatedAt: new Date().toISOString(),
    items,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function queryLocalArchive(dbPath: string, handle: string): SyncReport["archiveSqlite"] {
  if (!existsSync(dbPath)) return { path: dbPath, pleometricMediaRows: 0, pleometricVideoGifRows: 0 }
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db
      .query<{ mediaRows: number; videoGifRows: number }, [string]>(
        `SELECT count(*) AS mediaRows,
          sum(CASE WHEN m.type IN ('video','gif') THEN 1 ELSE 0 END) AS videoGifRows
         FROM tweets t JOIN media m ON m.tweet_id = t.id
         WHERE lower(t.username) = lower(?)`,
      )
      .get(handle)
    return { path: dbPath, pleometricMediaRows: row?.mediaRows ?? 0, pleometricVideoGifRows: row?.videoGifRows ?? 0 }
  } finally {
    db.close()
  }
}

async function probeTools(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const proc = Bun.spawn(["/bin/zsh", "-lc", `command -v ${shellQuote(name)}`], { stdout: "pipe", stderr: "pipe" })
    const text = (await new Response(proc.stdout).text()).trim()
    const code = await proc.exited
    out[name] = code === 0 && text ? text : "absent"
  }
  return out
}

async function downloadMedia(url: string, outputPath: string): Promise<void> {
  if (existsSync(outputPath)) return
  mkdirSync(dirname(outputPath), { recursive: true })
  const response = await fetch(url, { headers: { accept: "video/mp4,video/*,*/*", "user-agent": USER_AGENT } })
  if (response.status === 429 || response.status === 403) throw new Error(`download wall ${response.status} for ${url}`)
  if (!response.ok) throw new Error(`download failed ${response.status} for ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  writeFileSync(outputPath, bytes)
}

async function probeVideo(path: string): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`ffprobe failed for ${path}: ${stderr}`)
  const parsed = JSON.parse(stdout) as ProbeResult
  const video = parsed.streams?.find((stream) => stream.codec_type === "video")
  const duration = Number(video?.duration ?? parsed.format?.duration)
  return {
    width: video?.width,
    height: video?.height,
    durationSeconds: Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : undefined,
  }
}

async function buildContactSheet(items: ManifestItem[], dataDir: string, reportDir: string, outputPath: string): Promise<void> {
  const frameDir = join(reportDir, "contact-frames")
  mkdirSync(frameDir, { recursive: true })
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const inputPath = join(dataDir, item.file)
    const framePath = join(frameDir, `frame-${String(i + 1).padStart(3, "0")}.jpg`)
    const timestamp = Math.max(0, Math.min((item.durationSeconds ?? 1) / 2, Math.max(0, (item.durationSeconds ?? 1) - 0.05)))
    await run([
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      timestamp.toFixed(3),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=black",
      framePath,
    ])
  }
  await run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    "1",
    "-i",
    join(frameDir, "frame-%03d.jpg"),
    "-vf",
    `tile=${items.length > 12 ? "6x4" : "4x3"}:padding=8:margin=8:color=0x111111`,
    "-frames:v",
    "1",
    outputPath,
  ])
}

async function run(argv: string[]): Promise<void> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`${argv[0]} failed (${code}): ${stderr}`)
}

function extractPrimaryVideoItems(html: string, handle: string): RawVideoItem[] {
  const items: RawVideoItem[] = []
  const escapedHandle = escapeRegExp(handle)
  const escapedLowerHandle = escapeRegExp(handle.toLowerCase())
  const chunks = html.split(new RegExp(`<div class="timeline-item[^"]*" data-username="${escapedLowerHandle}">`, "i"))
  const statusPattern = new RegExp(`href="/${escapedHandle}/status/(\\d+)#m"`, "i")
  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    const primary = chunk.split(/<div class="quote quote-big"|<div class="quote "/)[0] ?? chunk
    const tweetId = primary.match(statusPattern)?.[1]
    if (!tweetId) continue
    const date = decodeHtmlEntities(primary.match(/class="tweet-date"><a [^>]*title="([^"]+)"/)?.[1] ?? "")
    const textHtml = primary.match(/<div class="tweet-content media-body"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ""
    const text = normalizeText(textHtml)
    const sourceMatches = primary.matchAll(/<source src="(https:\/\/video\.twimg\.com\/[^"]+?\.mp4)"/g)
    for (const match of sourceMatches) {
      const sourceUrl = decodeHtmlEntities(match[1])
      items.push({
        tweetId,
        date: date || undefined,
        text: text || undefined,
        mediaType: /\/tweet_video\//.test(sourceUrl) || /\bgif\b/i.test(primary) ? "gif" : "video",
        sourceUrl,
      })
    }
  }
  return items
}

function normalizeText(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function extractNextCursorUrl(html: string, baseUrl: string, currentUrl: string): string | undefined {
  const rawHref = html.match(/<div class="show-more">\s*<a href="([^"]*cursor=[^"]+)"/)?.[1]
  if (!rawHref) return undefined
  const href = decodeHtmlEntities(rawHref)
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith("?")) {
    const current = new URL(currentUrl)
    return `${trimSlash(baseUrl)}${current.pathname}${href}`
  }
  return `${trimSlash(baseUrl)}${href.startsWith("/") ? "" : "/"}${href}`
}

function dateRange(items: ManifestItem[]): { earliest: string; latest: string } | undefined {
  const dates = items.map((item) => item.date).filter((date): date is string => Boolean(date))
  dates.sort((a, b) => Date.parse(a.replace(" · ", " ")) - Date.parse(b.replace(" · ", " ")))
  if (dates.length === 0) return undefined
  return { earliest: dates[0], latest: dates[dates.length - 1] }
}

function extensionForUrl(url: string): string {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase()
    return ext && ext.length <= 5 ? ext : ".mp4"
  } catch {
    return ".mp4"
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function jitterMs(): number {
  return 1000 + Math.floor(Math.random() * 2001)
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve: resolveSleep } = Promise.withResolvers<void>()
  setTimeout(resolveSleep, ms)
  return promise
}

main(Bun.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
