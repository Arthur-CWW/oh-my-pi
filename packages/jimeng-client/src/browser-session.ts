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

export interface JimengBrowserLipSyncImageSubmitOptions extends JimengBrowserSessionOptions {
  imageUri: string
  voiceId: string
  text: string
  timeoutMs?: number
}

export interface JimengBrowserSubmitWireResult {
  status: number
  text: string
  url: string
}

const JIMENG_WORKBENCH_SUBMIT_PATH = "/mweb/v1/aigc_draft/generate"
const JIMENG_IMAGE_WORKBENCH_URL = "https://jimeng.jianying.com/ai-tool/generate/?type=image"
const JIMENG_LIP_SYNC_WORKBENCH_URL = "https://jimeng.jianying.com/ai-tool/generate/?type=lip_sync"
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
      (response) => response.url().includes(JIMENG_WORKBENCH_SUBMIT_PATH),
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
export async function submitJimengLipSyncImageInBrowser(options: JimengBrowserLipSyncImageSubmitOptions): Promise<JimengBrowserSubmitWireResult> {
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: options.cdpUrl, protocolTimeout: 600_000 })

  try {
    const page = await resolveJimengPage(browser, options)
    await page.goto(JIMENG_LIP_SYNC_WORKBENCH_URL, { waitUntil: "domcontentloaded" })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await assertJimengBrowserSession(page, options.cdpUrl)
    await ensureJimengLipSyncWorkbench(page)
    await selectJimengLipSyncImageAsset(page, options.imageUri)
    await closeAssetDrawer(page)
    await fillJimengLipSyncText(page, options.text)
    await selectJimengLipSyncVoice(page, options.voiceId)
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes(JIMENG_WORKBENCH_SUBMIT_PATH),
      { timeout: options.timeoutMs ?? 60_000 },
    )
    await clickJimengLipSyncSubmit(page)
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
      details: { cdpUrl: options.cdpUrl, targetUrl: options.targetUrl ?? null, workflow: "lip-sync-image" },
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
async function ensureJimengLipSyncWorkbench(page: Page): Promise<void> {
  const modeReady = await page.evaluate(() => {
    const text = (node: Element | null | undefined): string => (node?.textContent || "").replace(/\s+/g, " ").trim()
    const clickable = Array.from(document.querySelectorAll("button, [role=\"tab\"], [role=\"button\"]"))
    const lipSyncToggle = clickable.find((entry) => /数字人|口型|Lip Sync/i.test(text(entry)))
    if (lipSyncToggle) (lipSyncToggle as HTMLElement).click()
    const prompt = document.querySelector("div[role=\"textbox\"].ProseMirror, div.ProseMirror[contenteditable=\"true\"], textarea.prompt-input")
    return !!prompt
  })
  if (modeReady) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_WORKBENCH_MISSING",
    message: "Jimeng lip-sync workbench did not expose the expected prompt editor.",
    retryable: false,
  })
}

async function fillJimengLipSyncText(page: Page, text: string): Promise<void> {
  const filled = await page.evaluate((nextText) => {
    const applyText = (element: HTMLElement | null): boolean => {
      if (!element) return false
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set
          ?? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
          ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(element, nextText)
        element.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextText, inputType: "insertText" }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }
      element.textContent = nextText
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextText, inputType: "insertText" }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    }
    return applyText(document.querySelector("textarea.prompt-input"))
      || applyText(document.querySelector("div[role=\"textbox\"].ProseMirror") as HTMLElement | null)
      || applyText(document.querySelector("div.ProseMirror[contenteditable=\"true\"]") as HTMLElement | null)
  }, text)
  if (filled) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_TEXT_EDITOR_MISSING",
    message: "Jimeng lip-sync workbench text editor is missing.",
    retryable: false,
  })
}

async function selectJimengLipSyncImageAsset(page: Page, imageUri: string): Promise<void> {
  const selected = await page.evaluate((targetImageUri) => {
    const normalized = targetImageUri.trim()
    const encoded = encodeURIComponent(normalized)
    const allElements = Array.from(document.querySelectorAll("button, [role=\"button\"], [role=\"tab\"], label, li, div"))
    const text = (node: Element | null | undefined): string => (node?.textContent || "").replace(/\s+/g, " ").trim()
    const click = (node: Element | null | undefined): boolean => {
      const clickable = (node instanceof HTMLElement ? node : node?.closest("button, [role=\"button\"], label, li, div")) as HTMLElement | null
      if (!clickable || clickable.hasAttribute("disabled") || clickable.getAttribute("aria-disabled") === "true") return false
      clickable.click()
      return true
    }
    const valueMatches = (value: string | null | undefined): boolean => !!value && (value.includes(normalized) || value.includes(encoded))
    const matchNode = allElements.find((entry) => {
      for (const attribute of entry.getAttributeNames()) {
        if (valueMatches(entry.getAttribute(attribute))) return true
      }
      const datasetValues = Object.values((entry as HTMLElement).dataset ?? {})
      return datasetValues.some((value) => valueMatches(value))
    })
    if (click(matchNode)) return true
    const imageMatch = Array.from(document.querySelectorAll("img")).find((entry) => valueMatches(entry.getAttribute("src")) || valueMatches(entry.getAttribute("data-src")))
    return click(imageMatch)
  }, imageUri)
  if (selected) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_IMAGE_ASSET_MISSING",
    message: "Jimeng lip-sync workbench could not locate the requested image asset. Preselect the avatar image in the open workbench, then rerun the browser-backed submit.",
    retryable: false,
    details: { imageUri },
  })
}

async function selectJimengLipSyncVoice(page: Page, voiceId: string): Promise<void> {
  const selected = await page.evaluate((targetVoiceId) => {
    const normalized = targetVoiceId.trim()
    const text = (node: Element | null | undefined): string => (node?.textContent || "").replace(/\s+/g, " ").trim()
    const clickable = Array.from(document.querySelectorAll("button, [role=\"button\"], [role=\"option\"], li, div"))
    const openVoicePicker = clickable.find((entry) => /音色|声音|配音|发音人|语音/i.test(text(entry)))
    ;(openVoicePicker as HTMLElement | undefined)?.click()
    const match = clickable.find((entry) => {
      if (text(entry).includes(normalized)) return true
      for (const attribute of entry.getAttributeNames()) {
        const value = entry.getAttribute(attribute)
        if (value?.includes(normalized)) return true
      }
      return Object.values((entry as HTMLElement).dataset ?? {}).some((value) => value?.includes(normalized))
    }) as HTMLElement | undefined
    if (!match || match.hasAttribute("disabled") || match.getAttribute("aria-disabled") === "true") return false
    match.click()
    return true
  }, voiceId)
  if (selected) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_VOICE_OPTION_MISSING",
    message: "Jimeng lip-sync workbench could not locate the requested voice. Open the voice picker, ensure the target voice is visible or preselected, then rerun the browser-backed submit.",
    retryable: false,
    details: { voiceId },
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
async function clickJimengLipSyncSubmit(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"))
    const match = buttons
      .filter((entry) => !(entry as HTMLButtonElement).disabled)
      .find((entry) =>
        (entry.className || "").toString().includes("generate-btn")
        || (entry.className || "").toString().includes("submit-button")
        || /生成|提交/i.test((entry.textContent || "").trim()))
    if (!match) return false
    ;(match as HTMLButtonElement).click()
    return true
  })
  if (clicked) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_SUBMIT_BUTTON_MISSING",
    message: "Jimeng lip-sync workbench submit button is missing or disabled.",
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
