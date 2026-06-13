import type { Browser, Page } from "puppeteer-core"
import { JimengError, jimengError } from "./errors"
import { type JimengSessionBundle } from "./capture"
import { type JimengFetch, type JimengFetchResponse } from "./client"

export interface JimengBrowserSessionOptions {
  cdpUrl: string
  targetUrl?: string
}

export interface JimengBrowserFetchOptions extends JimengBrowserSessionOptions {}

interface CdpCookie {
  name?: string
  value?: string
  domain?: string
}

interface BrowserFetchBodyPayload {
  base64: string
}

interface BrowserFetchPayload {
  url: string
  method?: string
  headers: Array<[string, string]>
  body?: BrowserFetchBodyPayload
}

interface BrowserFetchWireResponse {
  ok: boolean
  status: number
  bodyBase64: string
}

const FORBIDDEN_BROWSER_FETCH_HEADERS = new Set([
  "cookie",
  "host",
  "origin",
  "referer",
  "user-agent",
  "content-length",
])

export function createJimengBrowserFetch(options: JimengBrowserFetchOptions): JimengFetch {
  return async (url, init) => {
    const puppeteer = await import("puppeteer-core")
    const browser = await puppeteer.connect({ browserURL: options.cdpUrl })

    try {
      const page = await resolveJimengPage(browser, options)
      await assertJimengBrowserSession(page, options.cdpUrl)
      const payload = await serializeBrowserFetchPayload(url, init)
      const response = await page.evaluate(async (request) => {
        const bodyBytes = request.body
          ? Uint8Array.from(atob(request.body.base64), (char) => char.charCodeAt(0))
          : undefined
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyBytes,
          credentials: "include",
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ""
        for (let index = 0; index < bytes.length; index += 1) {
          binary += String.fromCharCode(bytes[index]!)
        }
        return {
          ok: response.ok,
          status: response.status,
          bodyBase64: btoa(binary),
        } satisfies BrowserFetchWireResponse
      }, payload)
      return responseFromBase64(response)
    } catch (error) {
      if (error instanceof JimengError) throw error
      throw jimengError({
        category: "transport",
        code: "JIMENG_BROWSER_FETCH_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        details: { cdpUrl: options.cdpUrl, url },
      })
    } finally {
      await browser.disconnect()
    }
  }
}

export async function loadJimengSessionFromBrowser(options: JimengBrowserSessionOptions): Promise<JimengSessionBundle> {
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: options.cdpUrl })

  try {
    const page = await resolveJimengPage(browser, options)
    const cookies = await readJimengCookies(page)
    const cookie = cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")

    if (!cookie) {
      throw jimengError({
        category: "auth",
        code: "JIMENG_BROWSER_SESSION_MISSING",
        message: `No Jimeng cookies found in browser at ${options.cdpUrl}. Refresh/login in the dedicated profile first.`,
        retryable: false,
        details: { cdpUrl: options.cdpUrl, targetUrl: options.targetUrl ?? null },
      })
    }

    const userAgent = await page.evaluate(() => navigator.userAgent)
    const referer = page.url()
    return {
      cookie,
      userAgent,
      origin: "https://jimeng.jianying.com",
      referer,
      capturedAtIso: new Date().toISOString(),
    }
  } finally {
    await browser.disconnect()
  }
}

async function resolveJimengPage(
  browser: Browser,
  options: JimengBrowserSessionOptions,
): Promise<Page> {
  const pages = await browser.pages()
  const targetNeedle = options.targetUrl ?? "jimeng.jianying.com"
  const existingPage = pages.find((candidate) => candidate.url().includes(targetNeedle))
    ?? pages.find((candidate) => candidate.url().includes("jimeng.jianying.com"))
  if (existingPage) return existingPage
  const page = await browser.newPage()
  await page.goto(options.targetUrl ?? "https://jimeng.jianying.com", {
    waitUntil: "domcontentloaded",
  })
  return page
}

async function assertJimengBrowserSession(page: Page, cdpUrl: string): Promise<void> {
  const cookies = await readJimengCookies(page)
  if (cookies.length > 0) return
  throw jimengError({
    category: "auth",
    code: "JIMENG_BROWSER_SESSION_MISSING",
    message: `No Jimeng browser session found at ${cdpUrl}. Open Jimeng in the dedicated browser profile and sign in first.`,
    retryable: false,
    details: { cdpUrl, pageUrl: page.url() },
  })
}

async function readJimengCookies(page: Page): Promise<Array<Required<CdpCookie>>> {
  const client = await page.target().createCDPSession()
  await client.send("Network.enable")
  const cookieResult = await client.send("Network.getAllCookies") as { cookies?: CdpCookie[] }
  return (cookieResult.cookies ?? [])
    .filter((entry): entry is Required<CdpCookie> =>
      typeof entry.name === "string" && typeof entry.value === "string" && typeof entry.domain === "string")
    .filter((entry) => entry.domain.includes("jianying.com") || entry.domain.includes("dreamina") || entry.domain.includes("bytedance"))
}

async function serializeBrowserFetchPayload(url: string, init?: RequestInit): Promise<BrowserFetchPayload> {
  return {
    url,
    method: init?.method,
    headers: sanitizeBrowserFetchHeaders(new Headers(init?.headers)),
    body: await serializeBrowserFetchBody(init?.body),
  }
}

function sanitizeBrowserFetchHeaders(headers: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [key, value] of headers.entries()) {
    if (FORBIDDEN_BROWSER_FETCH_HEADERS.has(key.toLowerCase())) continue
    out.push([key, value])
  }
  return out
}

async function serializeBrowserFetchBody(body: BodyInit | null | undefined): Promise<BrowserFetchBodyPayload | undefined> {
  if (body == null) return undefined
  if (typeof body === "string") return { base64: Buffer.from(body).toString("base64") }
  if (body instanceof URLSearchParams) return { base64: Buffer.from(body.toString()).toString("base64") }
  if (body instanceof ArrayBuffer) return { base64: Buffer.from(body).toString("base64") }
  if (ArrayBuffer.isView(body)) {
    return {
      base64: Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("base64"),
    }
  }
  if (body instanceof Blob) {
    return { base64: Buffer.from(await body.arrayBuffer()).toString("base64") }
  }
  throw jimengError({
    category: "validation",
    code: "JIMENG_BROWSER_FETCH_BODY_UNSUPPORTED",
    message: "Jimeng browser fetch only supports string, URLSearchParams, ArrayBuffer, typed-array, Blob, or empty request bodies.",
    retryable: false,
    details: { bodyKind: Object.prototype.toString.call(body) },
  })
}

function responseFromBase64(response: BrowserFetchWireResponse): JimengFetchResponse {
  const bytes = Buffer.from(response.bodyBase64, "base64")
  return {
    ok: response.ok,
    status: response.status,
    text: async () => bytes.toString("utf8"),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}
