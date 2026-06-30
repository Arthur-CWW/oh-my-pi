import path from "node:path"
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
  imagePath?: string
  voiceId: string
  voiceLabel?: string
  text: string
  actionText?: string
  timeoutMs?: number
}

export interface JimengBrowserLipSyncWorkbenchState {
  buttonText: string | null
  disabled: boolean
  ariaDisabled: string | null
  editorText: string | null
  selectedVoice: string | null
  rolePreviewCount: number
  visibleVoiceLabels: readonly string[]
  bodyTextPreview: string
}

export interface JimengBrowserLipSyncImagePreflightResult {
  workflow: "lip-sync-image"
  url: string
  title: string
  imageUri: string
  imagePath: string | null
  voiceId: string
  voiceLabel: string | null
  textLength: number
  actionTextLength: number
  submitReady: boolean
  state: JimengBrowserLipSyncWorkbenchState
}

export interface JimengBrowserSubmitWireResult {
  status: number
  text: string
  url: string
}

const JIMENG_WORKBENCH_SUBMIT_PATH = "/mweb/v1/aigc_draft/generate"
const JIMENG_IMAGE_WORKBENCH_URL = "https://jimeng.jianying.com/ai-tool/generate/?type=image"
const JIMENG_LIP_SYNC_WORKBENCH_URL = "https://jimeng.jianying.com/ai-tool/generate/?type=digitalHuman&workspace=undefined"
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
    await selectJimengLipSyncImageAsset(page, { imageUri: options.imageUri, imagePath: options.imagePath, timeoutMs: options.timeoutMs })
    await closeAssetDrawer(page)
    await selectJimengLipSyncVoice(page, { voiceId: options.voiceId, voiceLabel: options.voiceLabel })
    await fillJimengLipSyncText(page, { speechText: options.text, actionText: options.actionText })
    await assertJimengLipSyncSubmitEnabled(page, {
      imageUri: options.imageUri,
      imagePath: options.imagePath,
      voiceId: options.voiceId,
      voiceLabel: options.voiceLabel,
      text: options.text,
      actionText: options.actionText,
    })
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

export async function preflightJimengLipSyncImageInBrowser(options: JimengBrowserLipSyncImageSubmitOptions): Promise<JimengBrowserLipSyncImagePreflightResult> {
  if (options.imagePath) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_LIP_SYNC_PREFLIGHT_UPLOAD_DISABLED",
      message: "Lip-sync preflight does not upload local images. Preselect a role/avatar in the browser or pass --imageUri current without --image.",
      retryable: false,
      details: { imagePath: options.imagePath },
    })
  }

  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: options.cdpUrl, protocolTimeout: 600_000 })

  try {
    const page = await resolveJimengPage(browser, options)
    await page.goto(JIMENG_LIP_SYNC_WORKBENCH_URL, { waitUntil: "domcontentloaded" })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await assertJimengBrowserSession(page, options.cdpUrl)
    await ensureJimengLipSyncWorkbench(page)
    await closeAssetDrawer(page)
    await selectJimengLipSyncVoice(page, { voiceId: options.voiceId, voiceLabel: options.voiceLabel })
    await fillJimengLipSyncText(page, { speechText: options.text, actionText: options.actionText })
    const state = await readJimengLipSyncWorkbenchState(page)
    return {
      workflow: "lip-sync-image",
      url: page.url(),
      title: await page.title(),
      imageUri: options.imageUri,
      imagePath: null,
      voiceId: options.voiceId,
      voiceLabel: options.voiceLabel ?? null,
      textLength: options.text.length,
      actionTextLength: options.actionText?.length ?? 0,
      submitReady: !state.disabled && state.ariaDisabled !== "true",
      state,
    }
  } catch (error) {
    if (error instanceof JimengError) throw error
    throw jimengError({
      category: "transport",
      code: "JIMENG_BROWSER_UI_PREFLIGHT_FAILED",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
      details: { cdpUrl: options.cdpUrl, targetUrl: options.targetUrl ?? null, workflow: "lip-sync-image-preflight" },
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
    const clickable = Array.from(document.querySelectorAll("button, [role=\"tab\"], [role=\"button\"], [role=\"combobox\"]"))
    const lipSyncToggle = clickable.find((entry) => /数字人|口型|Lip Sync/i.test(text(entry)))
    if (lipSyncToggle) (lipSyncToggle as HTMLElement).click()
    const prompt = document.querySelector("div[role=\"textbox\"].ProseMirror, div.ProseMirror[contenteditable=\"true\"], textarea.prompt-input")
    return !!prompt
  })
  if (modeReady) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_WORKBENCH_MISSING",
    message: "Jimeng digital-human workbench did not expose the expected script editor.",
    retryable: false,
  })
}

export function buildJimengLipSyncVoiceSelectionNeedles(input: {
  voiceId: string
  voiceLabel?: string | null
}): string[] {
  const raw = [input.voiceLabel ?? undefined, input.voiceId]
  const needles: string[] = []
  for (const value of raw) {
    const normalized = value?.trim()
    if (!normalized || needles.includes(normalized)) continue
    needles.push(normalized)
  }
  return needles
}

async function fillJimengLipSyncText(page: Page, input: {
  speechText: string
  actionText?: string
}): Promise<void> {
  const filled = await page.evaluate(({ speechText, actionText }) => {
    const editor = document.querySelector("div[role=\"textbox\"].ProseMirror, div.ProseMirror[contenteditable=\"true\"]") as HTMLElement | null
    if (!editor) return false

    interface TipTapTextNode {
      type: "text"
      text: string
    }
    interface TipTapParagraphTagNode {
      type: "paragraph-tag"
      attrs: { type: "speech" | "prompt" }
    }
    interface TipTapParagraphNode {
      type: "paragraph"
      content: Array<TipTapParagraphTagNode | TipTapTextNode>
    }
    interface TipTapDoc {
      type: "doc"
      content: TipTapParagraphNode[]
    }
    interface TipTapEditorHandle {
      commands?: {
        setContent?: (content: TipTapDoc, emitUpdate?: boolean) => boolean
      }
      getJSON?: () => TipTapDoc
    }
    const tiptapEditor = (editor as HTMLElement & { editor?: TipTapEditorHandle }).editor
    const setContent = tiptapEditor?.commands?.setContent
    if (setContent) {
      const content: TipTapDoc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "paragraph-tag", attrs: { type: "speech" } }, { type: "text", text: speechText }] },
          {
            type: "paragraph",
            content: actionText
              ? [{ type: "paragraph-tag", attrs: { type: "prompt" } }, { type: "text", text: actionText }]
              : [{ type: "paragraph-tag", attrs: { type: "prompt" } }],
          },
        ],
      }
      setContent.call(tiptapEditor, content, true)
      const json = tiptapEditor?.getJSON?.()
      const flattened = json?.content.flatMap((paragraph) => paragraph.content).filter((node): node is TipTapTextNode => node.type === "text").map((node) => node.text) ?? []
      if (flattened.includes(speechText) && (actionText === undefined || flattened.includes(actionText))) return true
    }

    const paragraphText = (paragraph: Element): string =>
      Array.from(paragraph.childNodes)
        .filter((node) => !(node instanceof HTMLElement && node.matches("[contenteditable=\"false\"], .react-renderer")))
        .map((node) => node.textContent || "")
        .join("")
        .replace(/\u200b/g, "")
        .trim()
    const tagLabel = (paragraph: Element): string =>
      (paragraph.querySelector("[contenteditable=\"false\"]")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
    const replaceParagraphText = (paragraph: Element, nextText: string): void => {
      const preserved = Array.from(paragraph.childNodes).filter((node) => node instanceof HTMLElement && node.matches("[contenteditable=\"false\"], .react-renderer"))
      paragraph.replaceChildren(...preserved.map((node) => node.cloneNode(true)), document.createTextNode(nextText))
    }

    const paragraphs = Array.from(editor.querySelectorAll("p"))
    const contentParagraphForTag = (tagPattern: RegExp): Element | undefined => {
      const tagParagraphIndex = paragraphs.findIndex((paragraph) => tagPattern.test(tagLabel(paragraph)))
      if (tagParagraphIndex < 0) return undefined
      const tagParagraph = paragraphs[tagParagraphIndex]
      if (!tagParagraph) return undefined
      return paragraphText(tagParagraph) ? tagParagraph : paragraphs.slice(tagParagraphIndex + 1).find((paragraph) => !tagLabel(paragraph))
    }

    const speechParagraph = contentParagraphForTag(/角色说|说话内容/)
    const actionParagraph = contentParagraphForTag(/动作描述/)
    if (speechParagraph) replaceParagraphText(speechParagraph, speechText)
    if (actionParagraph && actionText !== undefined) replaceParagraphText(actionParagraph, actionText)

    if (!speechParagraph) {
      const textarea = document.querySelector("textarea.prompt-input") as HTMLTextAreaElement | null
      if (!textarea) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(textarea, speechText)
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: speechText, inputType: "insertText" }))
      textarea.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    }

    editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: speechText, inputType: "insertText" }))
    editor.dispatchEvent(new Event("change", { bubbles: true }))
    return paragraphText(speechParagraph) === speechText && (!actionParagraph || actionText === undefined || paragraphText(actionParagraph) === actionText)
  }, input)
  if (filled) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_TEXT_EDITOR_MISSING",
    message: "Jimeng digital-human workbench script editor is missing or does not expose the tagged ProseMirror paragraphs.",
    retryable: false,
  })
}

async function selectJimengLipSyncImageAsset(page: Page, input: {
  imageUri: string
  imagePath?: string
  timeoutMs?: number
}): Promise<void> {
  if (!input.imagePath) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_LIP_SYNC_IMAGE_ASSET_MISSING",
      message: "Jimeng digital-human workbench only has a confirmed local `--image` upload path right now. Provider-URI avatar reselection is still unsupported; preselect the role manually or rerun with --image.",
      retryable: false,
      details: { imageUri: input.imageUri, imagePath: null },
    })
  }

  const uploadInput = await page.$('input[type="file"][accept*="image"]')
  if (uploadInput) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/mweb/v1/imagex/submit_audit_job")
        || response.url().includes("/mweb/v1/algo_proxy")
        || response.url().includes("/mweb/v1/video_generate/pre_process"),
      { timeout: Math.min(input.timeoutMs ?? 60_000, 15_000) },
    ).catch(() => null)
    await uploadInput.uploadFile(path.resolve(input.imagePath))
    await page.waitForFunction(
      () => !!(document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement | null)?.files?.length,
      { timeout: 5_000 },
    )
    await responsePromise
    return
  }

  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_IMAGE_ASSET_MISSING",
    message: "Jimeng digital-human workbench did not expose the hidden image upload input required for the confirmed local `--image` path.",
    retryable: false,
    details: { imageUri: input.imageUri, imagePath: input.imagePath },
  })
}

async function selectJimengLipSyncVoice(page: Page, input: {
  voiceId: string
  voiceLabel?: string
}): Promise<void> {
  const needles = buildJimengLipSyncVoiceSelectionNeedles(input)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const selected = await page.evaluate((selection) => {
      const visible = (entry: Element): boolean => {
        const rect = entry.getBoundingClientRect()
        const style = getComputedStyle(entry)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }
      const text = (node: Element | null | undefined): string => (node?.textContent || "").replace(/\s+/g, " ").trim()
      const queryClickable = (): Element[] => Array.from(document.querySelectorAll("button, [role=\"button\"], [role=\"option\"], [role=\"combobox\"], li, div"))
        .filter(visible)
        .sort((left, right) => text(left).length - text(right).length)
      const openVoicePicker = queryClickable().find((entry) => /^(音色|声音|配音|发音人|语音)$|^(全部音色|我的音色)$/i.test(text(entry)))
        ?? queryClickable().find((entry) => text(entry).length <= 12 && /音色|声音|配音|发音人|语音/i.test(text(entry)))
      ;(openVoicePicker as HTMLElement | undefined)?.click()
      const match = queryClickable().find((entry) => selection.needles.some((needle) => {
        const label = text(entry)
        if (label === needle || (label.length <= Math.max(needle.length + 8, 24) && label.includes(needle))) return true
        for (const attribute of entry.getAttributeNames()) {
          const value = entry.getAttribute(attribute)
          if (value?.includes(needle)) return true
        }
        return Object.values((entry as HTMLElement).dataset ?? {}).some((value) => value?.includes(needle))
      })) as HTMLElement | undefined
      if (!match || match.hasAttribute("disabled") || match.getAttribute("aria-disabled") === "true") return false
      match.click()
      return true
    }, { needles })
    if (selected) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_VOICE_OPTION_MISSING",
    message: "Jimeng digital-human workbench could not locate the requested voice by visible label/title or id fallback. Open the voice picker, ensure the target voice is visible or preselected, then rerun the browser-backed submit.",
    retryable: false,
    details: { voiceId: input.voiceId, voiceLabel: input.voiceLabel ?? null },
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
    message: "Jimeng digital-human workbench submit button is missing.",
    retryable: false,
  })
}

async function assertJimengLipSyncSubmitEnabled(page: Page, input: {
  imageUri: string
  imagePath?: string
  voiceId: string
  voiceLabel?: string
  text: string
  actionText?: string
}): Promise<void> {
  const state = await readJimengLipSyncWorkbenchState(page)
  if (!state.disabled) return
  throw jimengError({
    category: "validation",
    code: "JIMENG_LIP_SYNC_SUBMIT_DISABLED_AFTER_POPULATION",
    message: "Jimeng digital-human workbench still keeps submit disabled after avatar, voice, and script population. The live UI is rejecting the prepared state before request dispatch.",
    retryable: false,
    details: {
      imageUri: input.imageUri,
      imagePath: input.imagePath ?? null,
      voiceId: input.voiceId,
      voiceLabel: input.voiceLabel ?? null,
      textLength: input.text.length,
      actionTextLength: input.actionText?.length ?? 0,
      buttonText: state.buttonText,
      ariaDisabled: state.ariaDisabled,
      selectedVoice: state.selectedVoice,
      editorText: state.editorText,
      rolePreviewCount: state.rolePreviewCount,
    },
  })
}

async function readJimengLipSyncWorkbenchState(page: Page): Promise<JimengBrowserLipSyncWorkbenchState> {
  return page.evaluate(() => {
    const visible = (entry: Element): boolean => {
      const rect = entry.getBoundingClientRect()
      const style = getComputedStyle(entry)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const text = (entry: Element | null | undefined): string => (entry?.textContent || "").replace(/\s+/g, " ").trim()
    const button = Array.from(document.querySelectorAll("button")).find((entry) =>
      (entry.className || "").toString().includes("generate-btn")
      || (entry.className || "").toString().includes("submit-button")
      || /生成|提交/i.test(text(entry)))
    const editor = document.querySelector("div[role=\"textbox\"].ProseMirror, div.ProseMirror[contenteditable=\"true\"]")
    const selectedVoice = Array.from(document.querySelectorAll("[aria-selected=\"true\"], [data-selected=\"true\"], .selected, .active"))
      .map((entry) => text(entry))
      .find(Boolean) ?? null
    const visibleVoiceLabels = Array.from(document.querySelectorAll("button, [role=\"button\"], [role=\"option\"], li, div"))
      .filter(visible)
      .map((entry) => text(entry))
      .filter((value) => value && value.length <= 32 && /多情感|女声|男声|女大|男大|大叔|软妹|甜妹|低音炮|直爽|温柔/.test(value))
      .slice(0, 40)
    return {
      buttonText: text(button) || null,
      disabled: button instanceof HTMLButtonElement ? button.disabled : false,
      ariaDisabled: button?.getAttribute("aria-disabled") ?? null,
      editorText: text(editor) || null,
      selectedVoice,
      rolePreviewCount: document.querySelectorAll("img").length,
      visibleVoiceLabels,
      bodyTextPreview: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200),
    }
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
