import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  readdirSync, copyFileSync, rmSync, statSync,
} from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { homedir, platform, tmpdir } from "node:os"
import { parseHTML } from "linkedom"
import { Effect, Schedule } from "effect"
import { kagiSessionPath } from "./config"
import { type SearchResponse, toErrorMessage } from "./schemas"

// ─── Session ──────────────────────────────────────────────────────────

interface KagiSession {
  token: string
  headers: Record<string, string>
  capturedAt: string
}

const FF_UA = platform() === "darwin"
  ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0"
  : "Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0"

function loadCachedSession(): KagiSession | null {
  const p = kagiSessionPath()
  try {
    if (!existsSync(p)) return null
    const s: KagiSession = JSON.parse(readFileSync(p, "utf-8"))
    if (!s?.token) return null
    if (s.capturedAt && Date.now() - new Date(s.capturedAt).getTime() > 24 * 60 * 60 * 1000) return null
    return s
  } catch { return null }
}

function firefoxAppDirs(): string[] {
  return platform() === "darwin"
    ? [join(homedir(), "Library/Application Support/Firefox")]
    : [join(homedir(), ".mozilla/firefox"), join(homedir(), "snap/firefox/common/.mozilla/firefox")]
}

interface FirefoxProfileCandidate {
  dir: string
  rank: number
}

function parseIniBlocks(text: string): Array<{ section: string; values: Record<string, string> }> {
  const blocks: Array<{ section: string; values: Record<string, string> }> = []
  for (const block of text.split(/\r?\n(?=\[)/)) {
    const header = block.match(/^\[([^\]]+)\]/)
    if (!header?.[1]) continue
    const values: Record<string, string> = {}
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^([^=]+)=(.*)$/)
      if (m?.[1]) values[m[1].trim()] = (m[2] ?? "").trim()
    }
    blocks.push({ section: header[1], values })
  }
  return blocks
}

function firefoxProfileDir(appDir: string, path: string, isRelative = true): string {
  return isRelative ? join(appDir, path) : resolve(path)
}

function parseFirefoxInstallDefaults(appDir: string): FirefoxProfileCandidate[] {
  const out: FirefoxProfileCandidate[] = []
  for (const file of ["installs.ini", "profiles.ini"]) {
    let text: string
    try { text = readFileSync(join(appDir, file), "utf-8") } catch { continue }
    for (const block of parseIniBlocks(text)) {
      if (!block.section.startsWith("Install") || !block.values.Default) continue
      out.push({ dir: firefoxProfileDir(appDir, block.values.Default), rank: -100 + out.length })
    }
  }
  return out
}

function parseFirefoxProfilesIni(appDir: string): FirefoxProfileCandidate[] {
  let text: string
  try { text = readFileSync(join(appDir, "profiles.ini"), "utf-8") } catch { return [] }

  const profiles: Array<FirefoxProfileCandidate & { isDefault: boolean; index: number }> = []
  let index = 0
  for (const block of parseIniBlocks(text)) {
    if (!/^Profile\d+$/.test(block.section)) continue
    if (!block.values.Path) continue
    profiles.push({
      dir: firefoxProfileDir(appDir, block.values.Path, block.values.IsRelative !== "0"),
      isDefault: block.values.Default === "1",
      rank: 0,
      index: index++,
    })
  }

  profiles.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.index - b.index
  })
  return profiles.map((profile, i) => ({
    dir: profile.dir,
    rank: profile.isDefault ? i : 100 + i,
  }))
}

function addFirefoxProfileDb(
  candidates: Array<{ path: string; rank: number; mtimeMs: number }>,
  seen: Set<string>,
  profileDir: string,
  rank: number,
): void {
  const db = join(profileDir, "cookies.sqlite")
  if (seen.has(db) || !existsSync(db)) return
  let mtimeMs = 0
  try { mtimeMs = statSync(db).mtimeMs } catch { /* nop */ }
  seen.add(db)
  candidates.push({ path: db, rank, mtimeMs })
}

function findFirefoxCookiesDbs(): string[] {
  const candidates: Array<{ path: string; rank: number; mtimeMs: number }> = []
  const seen = new Set<string>()

  for (const appDir of firefoxAppDirs()) {
    for (const profile of [...parseFirefoxInstallDefaults(appDir), ...parseFirefoxProfilesIni(appDir)]) {
      addFirefoxProfileDb(candidates, seen, profile.dir, profile.rank)
    }

    // Fallback for unusual installs and newly-created profiles not yet present
    // in profiles.ini. macOS keeps profiles in ./Profiles; Linux commonly keeps
    // them directly under the Firefox app directory.
    for (const container of [join(appDir, "Profiles"), appDir]) {
      try {
        for (const dirent of readdirSync(container, { withFileTypes: true })) {
          if (!dirent.isDirectory()) continue
          addFirefoxProfileDb(candidates, seen, join(container, dirent.name), 1000)
        }
      } catch { /* nop */ }
    }
  }

  return candidates
    .sort((a, b) => a.rank - b.rank || b.mtimeMs - a.mtimeMs)
    .map((candidate) => candidate.path)
}

function readKagiSessionTokenFromFirefoxDb(dbPath: string): string | null {
  const tempDir = join(tmpdir(), `pi-kagi-ff-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const tmpDb = join(tempDir, "cookies.sqlite")
  try {
    mkdirSync(tempDir, { recursive: true })
    copyFileSync(dbPath, tmpDb)
    // Firefox usually keeps the live cookie changes in the WAL file while it is
    // open. Copy it beside the database or sqlite3 can see stale data or fail
    // with "no such table: moz_cookies".
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, tmpDb + suffix)
    }

    const output = execFileSync(
      "sqlite3",
      ["-readonly", "-noheader", tmpDb,
        "SELECT value FROM moz_cookies WHERE (host = 'kagi.com' OR host LIKE '%.kagi.com') AND name = 'kagi_session' AND (expiry > unixepoch() OR expiry = 0) ORDER BY expiry DESC LIMIT 1"],
      { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim()
    return output.split(/\r?\n/)[0]?.trim() || null
  } catch { return null
  } finally { try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* nop */ } }
}

function captureFromFirefox(): KagiSession | null {
  for (const dbPath of findFirefoxCookiesDbs()) {
    const token = readKagiSessionTokenFromFirefoxDb(dbPath)
    if (!token) continue
    return {
      token,
      headers: { "user-agent": FF_UA, "accept-language": "en-US,en;q=0.9", accept: "application/json" },
      capturedAt: new Date().toISOString(),
    }
  }
  return null
}

async function captureFromChromeCdP(browserUrl = "http://localhost:9222"): Promise<KagiSession | null> {
  try {
    const pp = await import("puppeteer-core")
    const browser = await pp.default.connect({ browserURL: browserUrl, defaultViewport: null })
    try {
      const pages = await browser.pages()
      const page = pages.find((p) => p.url().startsWith("https://kagi.com")) ?? (await browser.newPage())
      if (!page.url().startsWith("https://kagi.com")) {
        await page.goto("https://kagi.com", { waitUntil: "domcontentloaded", timeout: 15000 })
      }
      const cdpCookies = (await page.target().createCDPSession().then((c) =>
        c.send("Network.getAllCookies")
      )) as { cookies: Array<{ name: string; value: string; domain: string }> }
      const kCookies = cdpCookies.cookies.filter(
        (c) => (c.domain === "kagi.com" || c.domain.endsWith(".kagi.com")) && c.name === "kagi_session",
      )
      const kagiSession = kCookies.find((c) => c.name === "kagi_session")
      if (!kagiSession?.value) return null
      const hdrs = await page.evaluate(() => ({
        "accept-language": navigator.language || "en-US",
        "user-agent": navigator.userAgent,
      }))
      await browser.disconnect()
      return {
        token: kagiSession.value,
        headers: { ...hdrs, accept: "application/json" },
        capturedAt: new Date().toISOString(),
      }
    } catch { await browser.disconnect().catch(() => {}); return null }
  } catch { return null }
}

function saveSession(session: KagiSession): void {
  try {
    mkdirSync(dirname(kagiSessionPath()), { recursive: true })
    writeFileSync(kagiSessionPath(), JSON.stringify(session, null, 2), "utf-8")
  } catch { /* nop */ }
}

function getOrCaptureSession(): KagiSession | null {
  const cached = loadCachedSession()
  if (cached) return cached
  const ff = captureFromFirefox()
  if (ff) {
    saveSession(ff)
    return ff
  }
  return null
}

async function captureFreshSession(): Promise<KagiSession | null> {
  return captureFromFirefox() ?? await captureFromChromeCdP()
}

export async function refreshSession(): Promise<string> {
  const session = await captureFreshSession()
  if (!session) throw new Error("No Kagi session found. Sign into kagi.com in Chrome or Firefox.")
  const p = kagiSessionPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(session, null, 2), "utf-8")
  return p
}

// ─── SSE Parsing ──────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/<![^>]*>/g, " ")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim()
}

export type KagiEventItem = { tag: string; payload: string | { content?: string } }

export function getPayloadHtml(item: KagiEventItem): string {
  if (typeof item.payload === "string") return item.payload
  if (item.payload && typeof item.payload.content === "string") return item.payload.content
  return ""
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function extractSnippet(anchor: Element): string {
  const container = anchor.closest("._0_SRI") ?? anchor.closest(".search-result") ?? anchor.parentElement
  const desc = container?.querySelector(".__sri-desc")
  return stripHtml(desc?.innerHTML ?? desc?.textContent ?? "")
}

export function parseResults(events: Array<{ data: unknown }>): Array<{ title: string; url: string; snippet: string }> {
  const out: Array<{ title: string; url: string; snippet: string }> = []
  const seen = new Set<string>()
  for (const ev of events) {
    if (!Array.isArray(ev.data)) continue
    for (const item of ev.data as KagiEventItem[]) {
      if (item.tag !== "search") continue
      const html = getPayloadHtml(item)
      if (!html) continue
      const { document } = parseHTML(html)
      for (const anchor of Array.from(document.querySelectorAll("a.__sri_title_link"))) {
        const url = anchor.getAttribute("href")?.trim() ?? ""
        const title = stripHtml(anchor.innerHTML || anchor.textContent || "")
        if (!isHttpUrl(url) || !title || seen.has(url)) continue
        seen.add(url)
        out.push({ title, url, snippet: extractSnippet(anchor) })
      }
    }
  }
  return out
}

export function parseAnswer(events: Array<{ data: unknown }>): string {
  for (const ev of events) {
    if (!Array.isArray(ev.data)) continue
    for (const item of ev.data as KagiEventItem[]) {
      if (item.tag === "top-content-unique") return stripHtml(getPayloadHtml(item))
    }
  }
  return ""
}

// ─── Search ───────────────────────────────────────────────────────────

export const runSearch = Effect.fn("kagiRunSearch")(function* (query: string) {
  let session = getOrCaptureSession()
  if (!session) {
    session = yield* Effect.tryPromise({ try: () => captureFreshSession(), catch: () => null })
    if (session) saveSession(session)
  }
  if (!session) return yield* Effect.fail(new Error("Kagi session not found. Sign into kagi.com in Chrome or Firefox."))

  const request = (activeSession: KagiSession) => Effect.tryPromise({
    try: () => fetch(`https://kagi.com/socket/search?q=${encodeURIComponent(query)}`, {
      headers: {
        ...activeSession.headers,
        referer: `https://kagi.com/search?q=${encodeURIComponent(query)}`,
        "X-Kagi-Authorization": activeSession.token,
      },
      signal: AbortSignal.timeout(30000),
    }),
    catch: (err) => new Error(`Kagi request: ${toErrorMessage(err)}`),
  }).pipe(Effect.retry(Schedule.recurs(1)))

  let response = yield* request(session)
  if (response.status === 401 || response.status === 403) {
    const refreshed = yield* Effect.tryPromise({ try: () => captureFreshSession(), catch: () => null })
    if (refreshed?.token && refreshed.token !== session.token) {
      session = refreshed
      saveSession(session)
      response = yield* request(session)
    }
  }

  if (!response.ok) return yield* Effect.fail(new Error(`Kagi search failed: ${response.status} ${response.statusText}`))

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
    answer: parseAnswer(events),
    results: parseResults(events),
    providerUsed: "kagi" as const,
  } satisfies SearchResponse
})
