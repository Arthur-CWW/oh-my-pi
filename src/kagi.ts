import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  readdirSync, copyFileSync, rmSync,
} from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { Effect, Result, Schedule } from "effect"
import { kagiSessionPath } from "./config"
import { type SearchResponse, toErrorMessage } from "./schemas"

// ─── Session ──────────────────────────────────────────────────────────

interface KagiSession {
  cookies: Array<{ name: string; value: string }>
  headers: Record<string, string>
  capturedAt: string
}

const FF_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0"

function loadCachedSession(): KagiSession | null {
  const p = kagiSessionPath()
  try {
    if (!existsSync(p)) return null
    const s: KagiSession = JSON.parse(readFileSync(p, "utf-8"))
    if (!s?.cookies?.length) return null
    if (s.capturedAt && Date.now() - new Date(s.capturedAt).getTime() > 24 * 60 * 60 * 1000) return null
    return s
  } catch { return null }
}

function findFirefoxCookiesDb(): string | null {
  const base = join(homedir(), "Library/Application Support/Firefox/Profiles")
  try {
    for (const dir of readdirSync(base)) {
      const db = join(base, dir, "cookies.sqlite")
      if (existsSync(db)) return db
    }
  } catch { /* nop */ }
  return null
}

function captureFromFirefox(): KagiSession | null {
  const dbPath = findFirefoxCookiesDb()
  if (!dbPath) return null

  const tempDir = join(tmpdir(), `pi-kagi-ff-${Date.now()}`)
  const tmpDb = join(tempDir, "cookies.sqlite")
  try {
    mkdirSync(tempDir, { recursive: true })
    copyFileSync(dbPath, tmpDb)

    const output = execFileSync(
      "sqlite3",
      ["-readonly", "-noheader", "-separator", "|", tmpDb,
        "SELECT name, value FROM moz_cookies WHERE host LIKE '%kagi.com%' AND (expiry > unixepoch() OR expiry = 0)"],
      { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim()

    if (!output) return null

    const cookies: Array<{ name: string; value: string }> = []
    for (const line of output.split("\n")) {
      const [name, value] = line.split("|")
      if (name && value) cookies.push({ name, value })
    }
    if (!cookies.length) return null

    return {
      cookies,
      headers: {
        "user-agent": FF_UA,
        "accept-language": "en-US,en;q=0.9",
        accept: "application/json",
      },
      capturedAt: new Date().toISOString(),
    }
  } catch { return null
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* nop */ }
  }
}

function getSession(): KagiSession | null {
  // 1. Try cached session file
  const cached = loadCachedSession()
  if (cached) return cached

  // 2. Extract fresh from Firefox cookies.sqlite
  const ff = captureFromFirefox()
  if (ff) {
    try {
      mkdirSync(dirname(kagiSessionPath()), { recursive: true })
      writeFileSync(kagiSessionPath(), JSON.stringify(ff, null, 2), "utf-8")
    } catch { /* nop */ }
    return ff
  }

  return null
}

/** Refresh the Kagi session from Firefox cookies */
export function refreshSession(): string {
  const ff = captureFromFirefox()
  if (!ff) throw new Error("No Firefox profile with Kagi cookies found. Sign into kagi.com in Firefox first.")
  const p = kagiSessionPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(ff, null, 2), "utf-8")
  return p
}

// ─── SSE Search ───────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim()
}

type KagiEventItem = {
  tag: string
  payload: string | { content?: string }
}

function getPayloadHtml(item: KagiEventItem): string {
  if (typeof item.payload === "string") return item.payload
  if (item.payload && typeof item.payload.content === "string") return item.payload.content
  return ""
}

function extractResults(events: Array<{ data: unknown }>): Array<{ title: string; url: string; snippet: string }> {
  const out: Array<{ title: string; url: string; snippet: string }> = []
  const seen = new Set<string>()

  for (const ev of events) {
    const data = ev.data
    if (!Array.isArray(data)) continue

    for (const item of data as KagiEventItem[]) {
      if (!item?.tag) continue
      if (item.tag !== "search") continue

      const html = getPayloadHtml(item)
      if (!html) continue

      const descs = [...html.matchAll(/<div[^>]*class="[^"]*__sri-desc[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)]
        .map((m) => stripHtml(m[1] ?? ""))
      let i = 0

      for (const m of html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const url = (m[1] ?? "").trim()
        const title = stripHtml(m[2] ?? "")
        if (!url || !title || seen.has(url)) continue
        seen.add(url)
        out.push({ title, url, snippet: descs[i] ?? "" })
        i++
      }
    }
  }
  return out
}

function extractAnswer(events: Array<{ data: unknown }>): string {
  for (const ev of events) {
    const data = ev.data
    if (!Array.isArray(data)) continue
    for (const item of data as KagiEventItem[]) {
      if (item.tag === "top-content-unique") {
        return stripHtml(getPayloadHtml(item))
      }
    }
  }
  return ""
}

// ─── Effect API ───────────────────────────────────────────────────────

export const runSearch = Effect.fn("kagiRunSearch")(function* (query: string) {
  const session = getSession()
  if (!session) return yield* Effect.fail(new Error("Kagi session not found. Sign into kagi.com in Chrome or Firefox."))

  const cookieHeader = session.cookies.map((c) => `${c.name}=${c.value}`).join("; ")

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`https://kagi.com/socket/search?q=${encodeURIComponent(query)}`, {
        headers: { ...session.headers, cookie: cookieHeader },
        signal: AbortSignal.timeout(30000),
      }),
    catch: (err) => new Error(`Kagi request: ${toErrorMessage(err)}`),
  }).pipe(Effect.retry(Schedule.recurs(1)))

  if (!response.ok) return yield* Effect.fail(new Error(`Kagi search failed: ${response.status}`))

  const raw = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (err) => new Error(`Kagi read: ${toErrorMessage(err)}`),
  })

  const events: Array<{ data: unknown }> = []
  for (const block of raw.split(/\n\n/)) {
    const m = block.match(/^data:\s*(.+)$/m)
    if (!m?.[1]) continue
    try { events.push({ data: JSON.parse(m[1]) }) } catch { /* nop */ }
  }

  return {
    answer: extractAnswer(events),
    results: extractResults(events),
    providerUsed: "kagi" as const,
  } satisfies SearchResponse
})
