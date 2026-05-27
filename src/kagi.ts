import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import { Effect, Result, Schedule } from "effect"
import { kagiSessionPath } from "./config"
import { type SearchResponse, toErrorMessage } from "./schemas"

// ─── Session ──────────────────────────────────────────────────────────

interface KagiSession {
  cookies: Array<{ name: string; value: string }>
  headers: Record<string, string>
  capturedAt: string
}

function loadSession(): KagiSession | null {
  for (const p of [kagiSessionPath()]) {
    try {
      if (!existsSync(p)) continue
      const s: KagiSession = JSON.parse(readFileSync(p, "utf-8"))
      if (!s?.cookies?.length) continue
      if (s.capturedAt && Date.now() - new Date(s.capturedAt).getTime() > 24 * 60 * 60 * 1000) continue
      return s
    } catch { /* nop */ }
  }
  return null
}

async function captureFromChrome(browserUrl = "http://localhost:9222"): Promise<KagiSession> {
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
      (c) => c.domain === "kagi.com" || c.domain.endsWith(".kagi.com"),
    )
    if (!kCookies.length) throw new Error("No Kagi cookies found. Sign into kagi.com in Chrome first.")

    await page.goto("https://kagi.com/search?q=test", { waitUntil: "domcontentloaded", timeout: 15000 })
    const hdrs = await page.evaluate(() => ({
      "accept-language": navigator.language || "en-US",
      "user-agent": navigator.userAgent,
    }))

    await browser.disconnect()
    return {
      cookies: kCookies.map((c) => ({ name: c.name, value: c.value })),
      headers: { ...hdrs, accept: "application/json" },
      capturedAt: new Date().toISOString(),
    }
  } catch (err) {
    await browser.disconnect().catch(() => {})
    throw err
  }
}

export async function refreshSession(browserUrl?: string): Promise<string> {
  const s = await captureFromChrome(browserUrl)
  const p = kagiSessionPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(s, null, 2), "utf-8")
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

function extractResults(events: Array<{ data: unknown }>): Array<{ title: string; url: string; snippet: string }> {
  const out: Array<{ title: string; url: string; snippet: string }> = []
  const seen = new Set<string>()

  for (const ev of events) {
    const data = ev.data
    if (!Array.isArray(data)) continue

    for (const item of data) {
      if (!item || typeof item !== "object" || !("t" in item)) continue
      if ((item as { t: string }).t !== "search") continue

      const html = (item as { c?: string }).c ?? ""
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
    const d = ev.data
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const o = d as Record<string, unknown>
      if (o.t === "top-content-unique" && typeof o.c === "string") return stripHtml(o.c)
    }
  }
  return ""
}

// ─── Effect API ───────────────────────────────────────────────────────

export const runSearch = Effect.fn("kagiRunSearch")(function* (query: string) {
  const session = loadSession()
  if (!session) return yield* Effect.fail(new Error("Kagi session not found"))

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
