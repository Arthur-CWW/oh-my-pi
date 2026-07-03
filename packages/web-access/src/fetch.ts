import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { parseHTML } from "linkedom"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Defuddle } from "defuddle/node"
import { Effect, Result, Schedule } from "effect"
import { queryApi, isWebAvailable, queryWeb, isApiAvailable } from "./gemini"
import { type ExtractedContent, toErrorMessage } from "./schemas"

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
} as const

const CONCURRENT = 3
const HTTP_MS = 30_000
const JINA_MS = 30_000
const BROWSER_MS = 120_000
const MAX_CONTENT = 500_000

const EXTRACT = "Extract the complete readable content from this URL as clean markdown. Include the page title, all text content, code blocks, and tables. Do not summarize. URL: "
const PBS_MEDIA_RE = /https:\/\/pbs\.twimg\.com\/media\/[^\s)"'?]+/g
const TWITTER_ASSET_ROOT = resolveTwitterAssetRoot()

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

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function truncateContent(content: string): string {
  return content.length > MAX_CONTENT ? content.slice(0, MAX_CONTENT) + "\n\n[truncated]" : content
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function execFilePromise(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export function looksLikeBlockedPage(title: string, text: string, html: string): boolean {
  const sample = `${title}\n${text}\n${html.slice(0, 4000)}`.toLowerCase()
  return [
    "just a moment",
    "checking your browser",
    "verification successful. waiting",
    "please enable javascript and cookies to continue",
    "turnstile",
    "cf-chl",
    "challenges.cloudflare.com",
    "challenge-platform",
    "captcha",
  ].some((needle) => sample.includes(needle))
}

export function shouldReturnEarly(httpError: string): boolean {
  return /^HTTP 4/.test(httpError) && !/^HTTP (401|403|429)\b/.test(httpError)
}

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, "TASKS.md")) && existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return process.cwd()
    dir = parent
  }
}

function resolveTwitterAssetRoot(): string {
  const configured = process.env.PI_TWITTER_X_ASSET_ROOT
  return configured ? resolve(configured) : join(findWorkspaceRoot(), "docs/research/twitter-x/assets")
}

function isTwitterUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")
  } catch {
    return false
  }
}

function twitterAssetSlug(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/").filter(Boolean)
    const handle = parts[0]?.replace(/^@/, "") ?? "twitter"
    const status = parts.includes("status") ? parts[parts.indexOf("status") + 1] : parts.at(-1)
    return `${handle}-${status ?? "post"}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "tweet"
  } catch {
    return "tweet"
  }
}

function mediaFileName(url: string, contentType: string | null): string {
  const raw = basename(url).replace(/\?.*/, "")
  const stem = raw.replace(/\.[^.]+$/, "")
  const ext = contentType?.includes("png")
    ? ".png"
    : contentType?.includes("webp")
      ? ".webp"
      : contentType?.includes("gif")
        ? ".gif"
        : (raw.match(/\.(jpg|jpeg|png|webp|gif)$/i)?.[0].toLowerCase() ?? ".jpg")
  return `${stem}${ext}`
}

async function localizeTwitterImages(markdown: string, slug: string): Promise<string> {
  const urls = [...new Set(markdown.match(PBS_MEDIA_RE) ?? [])]
  if (!urls.length) return markdown

  const assetDir = join(TWITTER_ASSET_ROOT, slug)
  await mkdir(assetDir, { recursive: true })

  const localPaths = new Map<string, string>()
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": HTTP_HEADERS["User-Agent"] },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return
      const fileName = mediaFileName(url, response.headers.get("content-type"))
      await writeFile(join(assetDir, fileName), Buffer.from(await response.arrayBuffer()))
      localPaths.set(url, `assets/${slug}/${fileName}`)
    } catch {
      // Keep the remote URL if asset capture fails.
    }
  }))

  let localized = markdown
  for (const [remote, local] of localPaths) localized = localized.replaceAll(remote, local)
  return localized
}

async function extractFromHtml(html: string, url: string): Promise<ExtractedContent> {
  // Early detection: JS-heavy pages
  const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").trim()
  const scripts = (html.match(/<script/gi) || []).length
  const isJs = !bodyText || (bodyText.length < 500 && scripts > 3)
  if (isJs) {
    return { url, title: extractTitle(html, url), content: "", error: "js-rendered" }
  }

  try {
    const { document } = parseHTML(html)
    const result = await Defuddle(document, url, { markdown: true })
    const title = result.title || extractTitle(html, url)
    const extracted = result.content || ""
    const content = truncateContent(process.env.PI_AUTO_LOCALIZE_TWITTER_IMAGES === "0" || !isTwitterUrl(url) ? extracted : await localizeTwitterImages(extracted, twitterAssetSlug(url)))
    if (content.length < 100) return { url, title, content, error: "incomplete" }
    return { url, title, content, error: null }
  } catch {
    return { url, title: extractTitle(html, url), content: "", error: "defuddle-failed" }
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : null
      server.close((err) => {
        if (err) reject(err)
        else if (typeof port === "number") resolve(port)
        else reject(new Error("Could not determine free port"))
      })
    })
  })
}

async function cdpJson<T>(cdpUrl: string, path: string): Promise<T | null> {
  try {
    const response = await fetch(`${cdpUrl}${path}`)
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

async function waitForCdp(cdpUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cdpJson<unknown>(cdpUrl, "/json/version")) return true
    await sleep(200)
  }
  return false
}

function browserAppCandidates(): string[] {
  const candidates = [
    process.env.PI_FETCH_BROWSER_APP,
    "Google Chrome",
    "Chromium",
    "Brave Browser",
    "Microsoft Edge",
  ].filter((value): value is string => Boolean(value?.trim()))
  return [...new Set(candidates)]
}

function puppeteerTargetId(target: unknown): string | undefined {
  if (!target || typeof target !== "object") return undefined
  const candidate = target as { _targetId?: unknown }
  return typeof candidate._targetId === "string" ? candidate._targetId : undefined
}

async function launchBackgroundBrowser(app: string, port: number, profileDir: string): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Background browser fallback is currently macOS-only")
  await mkdir(profileDir, { recursive: true })
  const args = [
    "-g",
    "-na",
    app,
    "--args",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ]
  await execFilePromise("open", args)
  const cdpUrl = `http://127.0.0.1:${port}`
  if (!await waitForCdp(cdpUrl, 15_000)) throw new Error(`Timed out waiting for ${app} CDP at ${cdpUrl}`)
  return cdpUrl
}

async function waitForExtractableHtml(page: any, signal?: AbortSignal): Promise<{ html: string; text: string; title: string }> {
  let last = { html: "", text: "", title: "" }
  const deadline = Date.now() + BROWSER_MS

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted")

    await page.waitForNetworkIdle({ idleTime: 1_500, timeout: 5_000 }).catch(() => {})
    last = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      text: document.body?.innerText ?? "",
      title: document.title,
    }))

    if (!looksLikeBlockedPage(last.title, last.text, last.html) && last.text.trim().length > 400) {
      return last
    }
    await sleep(1_500)
  }

  return last
}

async function extractViaBrowserApp(url: string, app: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  const profileDir = await mkdtemp(join(tmpdir(), "pi-fetch-browser-"))
  let browser: any = null

  try {
    const port = await freePort()
    const cdpUrl = await launchBackgroundBrowser(app, port, profileDir)
    const puppeteer = await import("puppeteer-core")
    browser = await puppeteer.connect({ browserURL: cdpUrl })

    const browserTarget = browser.targets().find((target: any) => target.type() === "browser")
    if (!browserTarget) return null

    const client = await browserTarget.createCDPSession()
    try {
      const created = await client.send("Target.createTarget", {
        background: true,
        url,
      }) as { targetId: string }

      const target = await browser.waitForTarget(
        (candidate: unknown) => puppeteerTargetId(candidate) === created.targetId,
        { timeout: 15_000 },
      )
      const page = await target.page()
      if (!page) return null

      const snapshot = await waitForExtractableHtml(page, signal)
      if (looksLikeBlockedPage(snapshot.title, snapshot.text, snapshot.html)) return null

      const extracted = await extractFromHtml(snapshot.html, url)
      if (!extracted.error) return extracted

      if (snapshot.text.trim().length > 500) {
        return {
          url,
          title: snapshot.title.trim() || extracted.title,
          content: truncateContent(snapshot.text.trim()),
          error: null,
        }
      }
      return null
    } finally {
      await client.detach().catch(() => {})
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── HTTP + Defuddle ──────────────────────────────────────────────────

const extractViaHttp = Effect.fn("extractViaHttp")(function* (
  url: string,
  signal?: AbortSignal,
) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(url, {
        headers: HTTP_HEADERS,
        signal: withTimeout(signal, HTTP_MS),
      }),
    catch: () => null as Response | null,
  }).pipe(Effect.retry(Schedule.recurs(1)))

  if (!response) return { url, title: "", content: "", error: "HTTP request failed" }
  if (!response.ok) return { url, title: "", content: "", error: `HTTP ${response.status}` }

  const contentType = response.headers.get("content-type") || ""
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (err) => `__error__${toErrorMessage(err)}`,
  })

  if (text.startsWith("__error__")) return { url, title: "", content: "", error: text.slice(9) }

  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    return {
      url,
      title: pathTitle(url),
      content: truncateContent(text),
      error: null,
    }
  }

  return yield* Effect.tryPromise({
    try: () => extractFromHtml(text, url),
    catch: (err) => ({ url, title: "", content: "", error: toErrorMessage(err) }),
  })
})

// ─── Jina Reader fallback ─────────────────────────────────────────────

const extractViaJina = Effect.fn("extractViaJina")(function* (
  url: string,
  signal?: AbortSignal,
) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/markdown", "X-No-Cache": "true" },
        signal: withTimeout(signal, JINA_MS),
      }),
    catch: () => null as Response | null,
  })
  if (!response?.ok) return null

  const raw = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: () => null as string | null,
  })
  if (!raw) return null

  const idx = raw.indexOf("Markdown Content:")
  const md = idx >= 0 ? raw.slice(idx + 17).trim() : raw.trim()
  if (md.length < 100 || md.startsWith("Loading...")) return null
  if (raw.includes("Target URL returned error 403") || looksLikeBlockedPage(extractTitle(md, url), md, raw)) return null

  return { url, title: extractTitle(md, url), content: truncateContent(md), error: null }
})

// ─── Browser fallback ─────────────────────────────────────────────────

const extractViaBrowser = Effect.fn("extractViaBrowser")(function* (
  url: string,
  signal?: AbortSignal,
) {
  if (process.env.PI_DISABLE_BROWSER_FALLBACK === "1") return null
  if (process.platform !== "darwin") return null

  for (const app of browserAppCandidates()) {
    const result = yield* Effect.result(Effect.tryPromise({
      try: () => extractViaBrowserApp(url, app, signal),
      catch: () => null,
    }))
    if (Result.isSuccess(result) && result.success) return result.success
  }

  return null
})

// ─── Gemini fallbacks ─────────────────────────────────────────────────

const extractViaApi = Effect.fn("extractViaApi")(function* (
  url: string,
  signal?: AbortSignal,
) {
  if (!isApiAvailable()) return null

  const result = yield* Effect.result(
    queryApi(EXTRACT + url, { urlContext: true, signal, timeoutMs: 60_000 }),
  )
  if (Result.isFailure(result)) return null
  const text = result.success
  if (text.length < 50) return null
  return { url, title: extractTitle(text, url), content: truncateContent(text), error: null }
})

const extractViaWeb = Effect.fn("extractViaWeb")(function* (
  url: string,
  signal?: AbortSignal,
) {
  const cookieResult = yield* Effect.result(isWebAvailable())
  if (Result.isFailure(cookieResult) || !cookieResult.success) return null

  const result = yield* Effect.result(
    queryWeb(EXTRACT + url, cookieResult.success, {
      model: "gemini-2.5-flash",
      signal,
      timeoutMs: 60_000,
    }),
  )
  if (Result.isFailure(result)) return null
  const text = result.success
  if (text.length < 50) return null
  return { url, title: extractTitle(text, url), content: truncateContent(text), error: null }
})

// ─── Main pipeline ────────────────────────────────────────────────────

const extractOne = Effect.fn("extractOne")(function* (
  url: string,
  signal?: AbortSignal,
) {
  if (!isHttp(url)) return { url, title: "", content: "", error: "Only HTTP(S) URLs" as string | null }
  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" }

  const http = yield* extractViaHttp(url, signal)
  if (!http.error) return http
  if (shouldReturnEarly(http.error)) return http

  const jina = yield* extractViaJina(url, signal)
  if (jina) return jina

  const browser = yield* extractViaBrowser(url, signal)
  if (browser) return browser

  const api = yield* extractViaApi(url, signal)
  if (api) return api

  const web = yield* extractViaWeb(url, signal)
  if (web) return web

  return {
    ...http,
    error: http.error
      ? `${http.error}. Tried Defuddle, Jina, background browser, Gemini — all unavailable.`
      : "Could not extract content",
  }
})

// ─── Batch fetch ──────────────────────────────────────────────────────

export const fetchContent = Effect.fn("fetchContent")(function* (
  urls: ReadonlyArray<string>,
  signal?: AbortSignal,
) {
  if (!urls.length) return []
  return yield* Effect.forEach(
    urls,
    (url) => extractOne(url, signal),
    { concurrency: CONCURRENT },
  )
})
