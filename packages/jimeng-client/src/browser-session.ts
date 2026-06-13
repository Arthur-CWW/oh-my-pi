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

export interface JimengBrowserImageSubmitOptions extends JimengBrowserSessionOptions {
  prompt: string
  ratio?: string
  resolution?: "2k" | "4k"
  timeoutMs?: number
}

export interface JimengBrowserSubmitWireResult {
  status: number
  text: string
  url: string
}

const JIMENG_IMAGE_WORKBENCH_URL = "https://jimeng.jianying.com/ai-tool/generate/?type=image"

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

export async function submitJimengText2ImageInBrowser(options: JimengBrowserImageSubmitOptions): Promise<JimengBrowserSubmitWireResult> {
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: options.cdpUrl, protocolTimeout: 600_000 })

  try {
    const page = await resolveJimengPage(browser, options)
    await page.goto(JIMENG_IMAGE_WORKBENCH_URL, { waitUntil: "domcontentloaded" })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await assertJimengBrowserSession(page, options.cdpUrl)
    await closeAssetDrawer(page)
    await fillJimengPrompt(page, options.prompt)
    await ensureJimengImageSettings(page, options.ratio, options.resolution)
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/mweb/v1/aigc_draft/generate"),
      { timeout: options.timeoutMs ?? 60_000 },
    )
    await clickJimengImageSubmit(page)
    const response = await responsePromise
    return {
      status: response.status(),
      text: await response.text(),
      url: response.url(),
    }
  } catch (error) {
    if (error instanceof JimengError) throw error
    throw jimengError({
      category: "transport",
      code: "JIMENG_BROWSER_UI_SUBMIT_FAILED",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
      details: { cdpUrl: options.cdpUrl, targetUrl: options.targetUrl ?? null },
    })
  } finally {
    await browser.disconnect()
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

async function closeAssetDrawer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const close = document.querySelector('button[aria-label="关闭"]') as HTMLButtonElement | null
    close?.click()
  })
}

async function fillJimengPrompt(page: Page, prompt: string): Promise<void> {
  const result = await page.evaluate((nextPrompt) => {
    const editors = Array.from(document.querySelectorAll('div[role="textbox"].ProseMirror, div.ProseMirror[contenteditable="true"]'))
    const editor = editors[0] as HTMLElement | undefined
    if (!editor) return false
    editor.textContent = nextPrompt
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextPrompt, inputType: "insertText" }))
    editor.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }, prompt)
  if (result) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_IMAGE_PROMPT_EDITOR_MISSING",
    message: "Jimeng image workbench prompt editor is missing.",
    retryable: false,
  })
}

async function ensureJimengImageSettings(page: Page, ratio?: string, resolution?: "2k" | "4k"): Promise<void> {
  const current = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"))
    const match = buttons.find((entry) => /智能比例|1:1|9:16|16:9|高清 2K|超清 4K/.test((entry.innerText || entry.textContent || "").trim()))
    return (match?.innerText || match?.textContent || "").trim()
  })
  if (ratio && !current.includes(ratio)) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_IMAGE_RATIO_SWITCH_UNSUPPORTED",
      message: `Jimeng browser UI submit expected ratio ${ratio}, but the current workbench toolbar is ${JSON.stringify(current)}.`,
      retryable: false,
      details: { ratio, current },
    })
  }
  if (resolution) {
    const label = browserResolutionLabel(resolution)
    if (!current.includes(label)) {
      throw jimengError({
        category: "validation",
        code: "JIMENG_IMAGE_RESOLUTION_SWITCH_UNSUPPORTED",
        message: `Jimeng browser UI submit expected resolution ${label}, but the current workbench toolbar is ${JSON.stringify(current)}.`,
        retryable: false,
        details: { resolution, current },
      })
    }
  }
}

async function clickJimengImageSubmit(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"))
    const match = buttons
      .filter((entry) => !(entry as HTMLButtonElement).disabled)
      .find((entry) => (entry.className || "").toString().includes("submit-button"))
    if (!match) return false
    ;(match as HTMLButtonElement).click()
    return true
  })
  if (clicked) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_IMAGE_SUBMIT_BUTTON_MISSING",
    message: "Jimeng image workbench submit button is missing or disabled.",
    retryable: false,
  })
}

function browserResolutionLabel(value: "2k" | "4k"): string {
  return value === "4k" ? "超清 4K" : "高清 2K"
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
  headers.forEach((value, key) => {
    if (FORBIDDEN_BROWSER_FETCH_HEADERS.has(key.toLowerCase())) return
    out.push([key, value])
  })
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
