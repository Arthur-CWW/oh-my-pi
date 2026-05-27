import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"
import { Effect, Result, Schedule } from "effect"
import { queryApi, isWebAvailable, queryWeb, isApiAvailable } from "./gemini"
import { type ExtractedContent, toErrorMessage } from "./schemas"

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
} as const

const CONCURRENT = 3
const HTTP_MS = 30000
const JINA_MS = 30000

const EXTRACT = "Extract the complete readable content from this URL as clean markdown. Include the page title, all text content, code blocks, and tables. Do not summarize. URL: "

// ─── Helpers ──────────────────────────────────────────────────────────

function isHttp(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch { return false }
}

function pathTitle(url: string): string {
  try { return new URL(url).pathname.split("/").pop() || url } catch { return url }
}

function extractTitle(html: string, url: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/) ?? html.match(/^#{1,2}\s+(.+)/m)
  return m?.[1]?.replace(/\*+/g, "").trim() || pathTitle(url)
}

function withTimeout(s: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms)
  return s ? AbortSignal.any([s, t]) : t
}

// ─── HTTP + Readability ───────────────────────────────────────────────

const extractViaHttp = Effect.fn("extractViaHttp")(function* (
  url: string,
  sig?: AbortSignal,
) {
  const res = yield* Effect.tryPromise({
    try: () =>
      fetch(url, {
        headers: HTTP_HEADERS,
        signal: withTimeout(sig, HTTP_MS),
      }),
    catch: () => null as Response | null,
  }).pipe(Effect.retry(Schedule.recurs(1)))

  if (!res) return { url, title: "", content: "", error: "HTTP request failed" }
  if (!res.ok) return { url, title: "", content: "", error: `HTTP ${res.status}` }

  const ct = res.headers.get("content-type") || ""
  const text = yield* Effect.tryPromise({
    try: () => res.text(),
    catch: (err) => `__error__${toErrorMessage(err)}`,
  })

  if (typeof text === "string" && text.startsWith("__error__")) {
    return { url, title: "", content: "", error: text.slice(9) }
  }

  // Non-HTML
  if (!ct.includes("text/html") && !ct.includes("application/xhtml+xml")) {
    const max = 500_000
    return {
      url, title: pathTitle(url),
      content: text.length > max ? text.slice(0, max) + "\n\n[truncated]" : text,
      error: null,
    }
  }

  // Readability
  const article = yield* Effect.try({
    try: () => {
      const { document } = parseHTML(text)
      return new Readability(document as unknown as Document).parse()
    },
    catch: () => null,
  })

  if (!article) {
    const bodyText = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim()
    const scripts = (text.match(/<script/gi) || []).length
    const isJs = !bodyText || (bodyText.length < 500 && scripts > 3)
    return {
      url, title: extractTitle(text, url),
      content: "",
      error: isJs ? "js-rendered" : "readability-failed",
    }
  }

  const md = turndown.turndown(article.content)
  const title = article.title || ""

  if (md.length < 100) {
    return { url, title, content: md, error: "incomplete" }
  }

  return {
    url, title,
    content: md.length > 500_000 ? md.slice(0, 500_000) + "\n\n[truncated]" : md,
    error: null,
  }
})

// ─── Jina Reader fallback ─────────────────────────────────────────────

const extractViaJina = Effect.fn("extractViaJina")(function* (
  url: string,
  sig?: AbortSignal,
) {
  const res = yield* Effect.tryPromise({
    try: () =>
      fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/markdown", "X-No-Cache": "true" },
        signal: withTimeout(sig, JINA_MS),
      }),
    catch: () => null as Response | null,
  })
  if (!res?.ok) return null

  const raw = yield* Effect.tryPromise({
    try: () => res.text(),
    catch: () => null as string | null,
  })
  if (!raw) return null

  const idx = raw.indexOf("Markdown Content:")
  const md = idx >= 0 ? raw.slice(idx + 17).trim() : raw.trim()
  if (md.length < 100 || md.startsWith("Loading...")) return null

  return { url, title: extractTitle(md, url), content: md, error: null }
})

// ─── Gemini fallbacks ─────────────────────────────────────────────────

const extractViaApi = Effect.fn("extractViaApi")(function* (
  url: string,
  sig?: AbortSignal,
) {
  if (!isApiAvailable()) return null

  const result = yield* Effect.result(
    queryApi(EXTRACT + url, { urlContext: true, signal: sig, timeoutMs: 60000 }),
  )
  if (Result.isFailure(result)) return null
  const text = result.success
  if (text.length < 50) return null
  return { url, title: extractTitle(text, url), content: text, error: null }
})

const extractViaWeb = Effect.fn("extractViaWeb")(function* (
  url: string,
  sig?: AbortSignal,
) {
  const cookieResult = yield* Effect.result(isWebAvailable())
  if (Result.isFailure(cookieResult) || !cookieResult.success) return null

  const result = yield* Effect.result(
    queryWeb(EXTRACT + url, cookieResult.success, {
      model: "gemini-2.5-flash",
      signal: sig,
      timeoutMs: 60000,
    }),
  )
  if (Result.isFailure(result)) return null
  const text = result.success
  if (text.length < 50) return null
  return { url, title: extractTitle(text, url), content: text, error: null }
})

// ─── Main pipeline ────────────────────────────────────────────────────

const extractOne = Effect.fn("extractOne")(function* (
  url: string,
  sig?: AbortSignal,
) {
  if (!isHttp(url)) return { url, title: "", content: "", error: "Only HTTP(S) URLs" as string | null }
  if (sig?.aborted) return { url, title: "", content: "", error: "Aborted" }

  // 1. Direct HTTP + Readability
  const http = yield* extractViaHttp(url, sig)
  if (!http.error) return http
  if (http.error.startsWith("HTTP 4") && http.error !== "js-rendered") return http

  // 2. Jina Reader
  const jina = yield* extractViaJina(url, sig)
  if (jina) return jina

  // 3. Gemini API
  const api = yield* extractViaApi(url, sig)
  if (api) return api

  // 4. Gemini Web
  const web = yield* extractViaWeb(url, sig)
  if (web) return web

  return {
    ...http,
    error: http.error
      ? `${http.error}. Tried Readability, Jina, Gemini — all unavailable.`
      : "Could not extract content",
  }
})

// ─── Batch fetch ──────────────────────────────────────────────────────

export const fetchContent = Effect.fn("fetchContent")(function* (
  urls: ReadonlyArray<string>,
  sig?: AbortSignal,
) {
  if (!urls.length) return []
  return yield* Effect.forEach(
    urls,
    (u) => extractOne(u, sig),
    { concurrency: CONCURRENT },
  )
})
