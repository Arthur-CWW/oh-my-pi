import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { spawn } from "node:child_process"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { basename, dirname, join } from "node:path"
import puppeteer, { type Browser, type Page, type Target } from "puppeteer-core"

const DEFAULT_PORT = 9344
const STATE_DIR = join(homedir(), ".pi", "pi-browser-use")
const DEFAULT_PROFILE_DIR = join(STATE_DIR, "profile")
const SCREENSHOT_DIR = join(STATE_DIR, "screenshots")
const STATE_PATH = join(STATE_DIR, "state.json")

type ToolContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
>

interface BrowserUseState {
  activeTargetId?: string
  cdpUrl: string
  lastRefs?: Record<string, { selector: string; label: string; url: string }>
  port: number
  profileDir: string
}

interface TargetInfo {
  id: string
  title: string
  type: string
  url: string
}

interface BrowserOptions {
  browserApp?: string
  browserPath?: string
  cdpUrl?: string
  port?: number
  profileDir?: string
  timeoutMs?: number
}

interface DomElementInfo {
  ref: string
  selector: string
  tag: string
  role: string
  name: string
  text: string
  href: string | null
  inputType: string | null
  value: string | null
  rect: { x: number; y: number; width: number; height: number }
}

function textResult(text: string, details: Record<string, unknown> = {}): any {
  return { content: [{ type: "text" as const, text }], details: { error: null as string | null, ...details } }
}

function errorResult(message: string, details: Record<string, unknown> = {}): any {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], details: { error: message as string | null, ...details } }
}

async function ensureStateDir(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true })
  await mkdir(SCREENSHOT_DIR, { recursive: true })
}

function defaultBrowserApp(): string {
  return platform() === "darwin" ? "Helium" : "Google Chrome"
}

function defaultOptions(options: BrowserOptions = {}) {
  const port = options.port ?? DEFAULT_PORT
  return {
    browserApp: options.browserApp?.trim() || defaultBrowserApp(),
    browserPath: options.browserPath?.trim() || process.env.PI_BROWSER_USE_EXECUTABLE?.trim() || undefined,
    cdpUrl: options.cdpUrl?.trim() || `http://127.0.0.1:${port}`,
    port,
    profileDir: options.profileDir?.trim() || DEFAULT_PROFILE_DIR,
    timeoutMs: options.timeoutMs ?? 12_000,
  }
}

async function readState(): Promise<BrowserUseState | null> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as BrowserUseState
  } catch {
    return null
  }
}

async function writeState(state: BrowserUseState): Promise<void> {
  await ensureStateDir()
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8")
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
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function macAppExecutable(appName: string): string[] {
  const executableName = appName.endsWith(".app") ? basename(appName, ".app") : appName
  const appBundle = appName.endsWith(".app") ? appName : `${appName}.app`
  return [
    join("/Applications", appBundle, "Contents", "MacOS", executableName),
    join(homedir(), "Applications", appBundle, "Contents", "MacOS", executableName),
  ]
}

function macAppBundleName(appName: string): string {
  return appName.endsWith(".app") ? appName : `${appName}.app`
}

function macAppDisplayName(appName: string): string {
  return basename(macAppBundleName(appName), ".app")
}

async function findMacBrowserApp(browserApp: string): Promise<string> {
  const candidates = [
    browserApp,
    "Helium",
    "Google Chrome",
    "Chromium",
    "Brave Browser",
    "Microsoft Edge",
  ]
  const seen = new Set<string>()
  for (const app of candidates) {
    const displayName = macAppDisplayName(app)
    if (seen.has(displayName)) continue
    seen.add(displayName)
    const bundleName = macAppBundleName(displayName)
    if (
      existsSync(join("/Applications", bundleName))
      || existsSync(join(homedir(), "Applications", bundleName))
    ) {
      return displayName
    }
  }
  throw new Error(`Could not find a Chrome/Chromium app bundle. Tried browserApp=${browserApp}`)
}

async function findBrowserExecutable(browserApp = "Google Chrome", browserPath?: string): Promise<string> {
  if (browserPath) {
    if (await canAccess(browserPath)) return browserPath
    throw new Error(`browserPath not found: ${browserPath}`)
  }

  const candidates = platform() === "darwin"
    ? [
      ...macAppExecutable(browserApp),
      ...macAppExecutable("Google Chrome"),
      ...macAppExecutable("Chromium"),
      ...macAppExecutable("Brave Browser"),
      ...macAppExecutable("Microsoft Edge"),
      ...macAppExecutable("Helium"),
    ]
    : platform() === "win32"
      ? [
        join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env.LOCALAPPDATA ?? "", "Chromium", "Application", "chrome.exe"),
        join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
      ]
      : [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  throw new Error(
    `Could not find a Chrome/Chromium executable. Pass browserPath or set PI_BROWSER_USE_EXECUTABLE. Tried browserApp=${browserApp}`,
  )
}

function browserLaunchArgs(port: number, profileDir: string): string[] {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "about:blank",
  ]
}

async function launchBrowserProcess(resolved: ReturnType<typeof defaultOptions>): Promise<void> {
  const args = browserLaunchArgs(resolved.port, resolved.profileDir)
  const command = platform() === "darwin" && !resolved.browserPath
    ? "open"
    : await findBrowserExecutable(resolved.browserApp, resolved.browserPath)
  const commandArgs = platform() === "darwin" && !resolved.browserPath
    ? ["-g", "-na", await findMacBrowserApp(resolved.browserApp), "--args", ...args]
    : args

  const child = spawn(command, commandArgs, {
    detached: true,
    stdio: "ignore",
  })
  child.unref()
}

async function launchBrowser(options: BrowserOptions & { url?: string } = {}): Promise<BrowserUseState> {
  const resolved = defaultOptions(options)
  await ensureStateDir()
  await mkdir(resolved.profileDir, { recursive: true })

  if (!await waitForCdp(resolved.cdpUrl, 400)) {
    await launchBrowserProcess(resolved)
  }

  if (!await waitForCdp(resolved.cdpUrl, resolved.timeoutMs)) {
    throw new Error(`Timed out waiting for CDP at ${resolved.cdpUrl}`)
  }

  const state: BrowserUseState = {
    ...(await readState() ?? {}),
    cdpUrl: resolved.cdpUrl,
    port: resolved.port,
    profileDir: resolved.profileDir,
  }
  await writeState(state)
  return state
}

async function connect(options: BrowserOptions = {}): Promise<{ browser: Browser; state: BrowserUseState }> {
  const current = await readState()
  const resolved = defaultOptions({
    ...options,
    cdpUrl: options.cdpUrl ?? current?.cdpUrl,
    port: options.port ?? current?.port,
    profileDir: options.profileDir ?? current?.profileDir,
  })

  if (!await waitForCdp(resolved.cdpUrl, 500)) {
    await launchBrowser(options)
  }

  const browser = await puppeteer.connect({ browserURL: resolved.cdpUrl })
  const state: BrowserUseState = {
    ...(current ?? {}),
    cdpUrl: resolved.cdpUrl,
    port: resolved.port,
    profileDir: resolved.profileDir,
  }
  await writeState(state)
  return { browser, state }
}

function targetIdOfPage(page: Page): string | undefined {
  return (page.target() as { _targetId?: string })._targetId
}

function targetIdOfTarget(target: Target): string | undefined {
  return (target as { _targetId?: string })._targetId
}

async function createBackgroundPage(browser: Browser, url = "about:blank"): Promise<Page> {
  const browserTarget = browser.targets().find((target) => target.type() === "browser")
  if (!browserTarget) throw new Error("No browser CDP target is available.")

  const client = await browserTarget.createCDPSession()
  try {
    const created = await client.send("Target.createTarget", {
      background: true,
      url,
    }) as { targetId: string }
    const target = await browser.waitForTarget(
      (candidate) => targetIdOfTarget(candidate) === created.targetId,
      { timeout: 10_000 },
    )
    const page = await target.page()
    if (!page) throw new Error(`Created target has no page: ${created.targetId}`)
    return page
  } finally {
    await client.detach()
  }
}

async function listTargets(cdpUrl: string): Promise<TargetInfo[]> {
  const targets = await cdpJson<TargetInfo[]>(cdpUrl, "/json/list")
  return (targets ?? []).filter((target) => target.type === "page")
}

async function pageByTargetId(browser: Browser, targetId?: string): Promise<Page | null> {
  const pages = await browser.pages()
  if (targetId) {
    for (const page of pages) if (targetIdOfPage(page) === targetId) return page
  }
  return pages.find((page) => page.url() !== "about:blank") ?? pages[0] ?? null
}

async function activePage(browser: Browser, state: BrowserUseState, tabId?: string): Promise<Page> {
  const page = await pageByTargetId(browser, tabId ?? state.activeTargetId)
  if (!page) throw new Error("No browser page is available. Call browser_open first.")
  const id = targetIdOfPage(page)
  if (id && id !== state.activeTargetId) {
    await writeState({ ...state, activeTargetId: id })
  }
  return page
}

function normalizeKey(key: string): string {
  const aliases: Record<string, string> = {
    cmd: "Meta",
    command: "Meta",
    meta: "Meta",
    super: "Meta",
    ctrl: "Control",
    control: "Control",
    alt: "Alt",
    option: "Alt",
    shift: "Shift",
    return: "Enter",
    enter: "Enter",
    esc: "Escape",
    escape: "Escape",
    space: "Space",
    backspace: "Backspace",
    delete: "Delete",
    tab: "Tab",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  }
  return aliases[key.trim().toLowerCase()] ?? key.trim()
}

async function pressChord(page: Page, chord: string): Promise<void> {
  const parts = chord.split(/[+\s]+/).map(normalizeKey).filter(Boolean)
  if (parts.length === 0) throw new Error("Empty key")
  if (parts.length === 1) {
    await page.keyboard.press(parts[0]! as any)
    return
  }
  const key = parts.at(-1)!
  const modifiers = parts.slice(0, -1)
  for (const modifier of modifiers) await page.keyboard.down(modifier as any)
  try {
    await page.keyboard.press(key as any)
  } finally {
    for (const modifier of modifiers.reverse()) await page.keyboard.up(modifier as any)
  }
}

function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function formatTargets(targets: TargetInfo[], activeTargetId?: string): string {
  if (targets.length === 0) return "No tabs."
  return targets.map((target, index) => {
    const active = target.id === activeTargetId ? " *active*" : ""
    return `${index + 1}. ${target.id}${active}\n   ${target.title || "(untitled)"}\n   ${target.url}`
  }).join("\n")
}

function formatSnapshot(args: {
  accessibilityText: string
  elements: DomElementInfo[]
  screenshotPath: string
  title: string
  url: string
  viewport: { width: number; height: number }
}): string {
  const lines: string[] = []
  lines.push(`# Browser snapshot`, `Title: ${args.title || "(untitled)"}`, `URL: ${args.url}`)
  lines.push(`Viewport: ${args.viewport.width}x${args.viewport.height}`, `Screenshot: ${args.screenshotPath}`)
  lines.push("", `## Interactive elements (${args.elements.length})`)
  if (args.elements.length === 0) lines.push("No visible interactive elements found.")
  for (const element of args.elements) {
    const rect = `${Math.round(element.rect.x)},${Math.round(element.rect.y)} ${Math.round(element.rect.width)}x${Math.round(element.rect.height)}`
    const label = element.name || element.value || element.text || element.href || element.selector
    const bits = [element.ref, element.role || element.tag, rect]
    if (element.inputType) bits.push(`type=${element.inputType}`)
    lines.push(`- [${bits.join(" | ")}] ${truncate(label, 180)}`)
  }
  if (args.accessibilityText.trim()) {
    lines.push("", "## Accessibility tree (summary)", args.accessibilityText)
  }
  return lines.join("\n")
}

async function simplifiedAccessibilityText(page: Page, maxLines: number): Promise<string> {
  try {
    const root = await page.accessibility.snapshot({ interestingOnly: true })
    const lines: string[] = []
    const walk = (node: any, depth: number) => {
      if (!node || lines.length >= maxLines) return
      const name = typeof node.name === "string" ? truncate(node.name, 120) : ""
      const value = typeof node.value === "string" ? truncate(node.value, 120) : ""
      const role = typeof node.role === "string" ? node.role : "node"
      const suffix = [name, value].filter(Boolean).join(" = ")
      if (suffix || role !== "generic") lines.push(`${"  ".repeat(depth)}- ${role}${suffix ? `: ${suffix}` : ""}`)
      for (const child of node.children ?? []) walk(child, depth + 1)
    }
    walk(root, 0)
    return lines.join("\n")
  } catch {
    return ""
  }
}

async function collectDomElements(page: Page, maxElements: number): Promise<DomElementInfo[]> {
  return await page.evaluate((maxElements) => {
    const out: any[] = []
    const seen = new Set<Element>()

    const cssEscape = (value: string) => {
      const css = (globalThis as any).CSS
      return typeof css?.escape === "function" ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
    }

    const textOf = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()

    const selectorFor = (element: Element): string => {
      if (element.id) {
        const id = `#${cssEscape(element.id)}`
        try {
          if (document.querySelectorAll(id).length === 1) return id
        } catch {}
      }
      const parts: string[] = []
      let current: Element | null = element
      while (current && current !== document.documentElement && parts.length < 8) {
        const tag = current.tagName.toLowerCase()
        if (current.id) {
          parts.unshift(`${tag}#${cssEscape(current.id)}`)
          break
        }
        let nth = 1
        let sibling = current.previousElementSibling
        while (sibling) {
          if (sibling.tagName === current.tagName) nth += 1
          sibling = sibling.previousElementSibling
        }
        parts.unshift(`${tag}:nth-of-type(${nth})`)
        current = current.parentElement
      }
      return parts.join(" > ")
    }

    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return false
      if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return false
      const style = window.getComputedStyle(element)
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false
      return true
    }

    const roleFor = (element: Element) => {
      const explicit = element.getAttribute("role")
      if (explicit) return explicit
      const tag = element.tagName.toLowerCase()
      if (tag === "a") return "link"
      if (tag === "button") return "button"
      if (tag === "input") return (element as HTMLInputElement).type || "textbox"
      if (tag === "textarea") return "textbox"
      if (tag === "select") return "combobox"
      if (/^h[1-6]$/.test(tag)) return "heading"
      return tag
    }

    const isInteractive = (element: Element) => {
      const tag = element.tagName.toLowerCase()
      if (["a", "button", "input", "textarea", "select", "summary"].includes(tag)) return true
      if ((element as HTMLElement).isContentEditable) return true
      if (element.hasAttribute("onclick")) return true
      const role = element.getAttribute("role")
      if (role && /button|link|checkbox|menuitem|option|radio|switch|tab|textbox|combobox|slider|spinbutton/i.test(role)) return true
      const tabIndex = (element as HTMLElement).tabIndex
      return Number.isFinite(tabIndex) && tabIndex >= 0
    }

    const nameFor = (element: Element) => {
      const input = element as HTMLInputElement
      return (
        element.getAttribute("aria-label") ||
        element.getAttribute("alt") ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder") ||
        (typeof input.value === "string" && ["input", "textarea", "select"].includes(element.tagName.toLowerCase()) ? input.value : "") ||
        textOf(element)
      ).replace(/\s+/g, " ").trim()
    }

    const visit = (root: ParentNode) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
      let node = walker.currentNode as Element | null
      while (node && out.length < maxElements) {
        const element = node
        if (!seen.has(element)) {
          seen.add(element)
          if (isInteractive(element) && isVisible(element)) {
            const rect = element.getBoundingClientRect()
            const input = element as HTMLInputElement
            out.push({
              href: element instanceof HTMLAnchorElement ? element.href : null,
              inputType: element.tagName.toLowerCase() === "input" ? input.type || null : null,
              name: nameFor(element),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              ref: `e${out.length + 1}`,
              role: roleFor(element),
              selector: selectorFor(element),
              tag: element.tagName.toLowerCase(),
              text: textOf(element),
              value: typeof input.value === "string" && ["input", "textarea", "select"].includes(element.tagName.toLowerCase()) ? input.value : null,
            })
          }
          const shadowRoot = (element as HTMLElement).shadowRoot
          if (shadowRoot) visit(shadowRoot)
        }
        node = walker.nextNode() as Element | null
      }
    }

    visit(document.body || document.documentElement)
    return out
  }, maxElements)
}

async function selectorForRef(ref: string, expectedUrl: string | undefined): Promise<string> {
  const state = await readState()
  const entry = state?.lastRefs?.[ref]
  if (!entry) throw new Error(`Unknown ref ${ref}. Call browser_snapshot to refresh refs.`)
  if (expectedUrl && entry.url !== expectedUrl) {
    // Continue anyway; SPAs often update URLs without invalidating DOM, but tell the caller through errors if selector misses.
  }
  return entry.selector
}

async function resolveElementSelector(params: { ref?: string; selector?: string }, page: Page): Promise<string | null> {
  if (params.selector?.trim()) return params.selector.trim()
  if (params.ref?.trim()) return await selectorForRef(params.ref.trim(), page.url())
  return null
}

async function clickSelector(page: Page, selector: string, clickCount: number, button: "left" | "right" | "middle") {
  const element = await page.$(selector)
  if (!element) throw new Error(`Element not found for selector: ${selector}`)
  const box = await element.boundingBox()
  if (!box) throw new Error(`Element has no clickable bounding box: ${selector}`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button, count: clickCount })
}

function commonBrowserParams() {
  return {
    browserApp: Type.Optional(Type.String({ description: "macOS app name (default: Helium on macOS, Google Chrome elsewhere)" })),
    browserPath: Type.Optional(Type.String({ description: "Chrome/Chromium executable path" })),
    cdpUrl: Type.Optional(Type.String({ description: "Existing CDP endpoint (default: http://127.0.0.1:9344)" })),
    port: Type.Optional(Type.Number({ description: "Remote debugging port (default: 9344)" })),
    profileDir: Type.Optional(Type.String({ description: "Dedicated user-data directory" })),
  }
}

export default function registerBrowserUse(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser_open",
    label: "Browser Open",
    description: "Launch or connect to a dedicated Chrome/Chromium CDP browser and optionally open a URL.",
    promptSnippet: "Launch/connect a CDP browser for browser automation.",
    promptGuidelines: [
      "Use browser_open before other browser_* tools when no browser session is active.",
      "On macOS, prefer the default Helium automation profile and keep browser work in the background.",
      "Use browser_snapshot after page changes to refresh refs before browser_click/browser_type/browser_scroll.",
      "Browser tools operate a live browser; ask the user before submitting forms, sending messages, making purchases, deleting data, or transmitting sensitive data.",
    ],
    parameters: Type.Object({
      ...commonBrowserParams(),
      newTab: Type.Optional(Type.Boolean({ description: "Open url in a new tab after connecting" })),
      url: Type.Optional(Type.String({ description: "URL to open" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { newTab?: boolean; url?: string }
      try {
        const state = await launchBrowser(params)
        const { browser } = await connect(state)
        try {
          let page = await activePage(browser, state).catch(() => null)
          if (params.url?.trim() && params.newTab) {
            page = await createBackgroundPage(browser, params.url.trim())
          } else if (params.url?.trim() && page && page.url() === "about:blank") {
            await page.goto(params.url.trim(), { waitUntil: "domcontentloaded" })
          } else if (params.url?.trim() && !page) {
            page = await createBackgroundPage(browser, params.url.trim())
          }
          const activeTargetId = page ? targetIdOfPage(page) : state.activeTargetId
          const nextState = { ...state, activeTargetId }
          await writeState(nextState)
          const targets = await listTargets(state.cdpUrl)
          return textResult([
            `Browser ready at ${state.cdpUrl}`,
            `Profile: ${state.profileDir}`,
            "",
            formatTargets(targets, activeTargetId),
          ].join("\n"), { cdpUrl: state.cdpUrl, activeTargetId })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_tabs",
    label: "Browser Tabs",
    description: "List, select, create, or close browser tabs in the CDP browser session.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      action: Type.Optional(Type.String({ description: "list, select, new, or close (default: list)" })),
      tabId: Type.Optional(Type.String({ description: "Target tab ID" })),
      url: Type.Optional(Type.String({ description: "URL for action=new" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { action?: string; tabId?: string; url?: string }
      const action = params.action ?? "list"
      if (!["list", "select", "new", "close"].includes(action)) return errorResult("action must be list, select, new, or close")
      try {
        const { browser, state } = await connect(params)
        try {
          let activeTargetId = state.activeTargetId
          if (action === "new") {
            const page = await createBackgroundPage(browser, params.url?.trim() || "about:blank")
            activeTargetId = targetIdOfPage(page)
          } else if (action === "select") {
            if (!params.tabId?.trim()) return errorResult("tabId is required for action=select")
            const page = await pageByTargetId(browser, params.tabId.trim())
            if (!page) return errorResult(`No tab found: ${params.tabId}`)
            activeTargetId = params.tabId.trim()
          } else if (action === "close") {
            if (!params.tabId?.trim()) return errorResult("tabId is required for action=close")
            const page = await pageByTargetId(browser, params.tabId.trim())
            if (!page) return errorResult(`No tab found: ${params.tabId}`)
            await page.close()
            activeTargetId = undefined
          }
          await writeState({ ...state, activeTargetId })
          const targets = await listTargets(state.cdpUrl)
          return textResult(formatTargets(targets, activeTargetId), { activeTargetId, targets })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description: "Navigate the active browser tab to a URL.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      tabId: Type.Optional(Type.String({ description: "Target tab ID (default: active)" })),
      url: Type.String({ description: "URL to navigate to" }),
      waitUntil: Type.Optional(Type.String({ description: "load, domcontentloaded, networkidle0, or networkidle2 (default: domcontentloaded)" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { tabId?: string; url: string; waitUntil?: string }
      try {
        const { browser, state } = await connect(params)
        try {
          const page = await activePage(browser, state, params.tabId)
          const waitUntil = ["load", "domcontentloaded", "networkidle0", "networkidle2"].includes(params.waitUntil ?? "")
            ? params.waitUntil as "load" | "domcontentloaded" | "networkidle0" | "networkidle2"
            : "domcontentloaded"
          await page.goto(params.url, { waitUntil })
          const activeTargetId = targetIdOfPage(page)
          await writeState({ ...state, activeTargetId, lastRefs: {} })
          return textResult(`Navigated to ${page.url()}\nTitle: ${await page.title()}`, { activeTargetId, url: page.url() })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_snapshot",
    label: "Browser Snapshot",
    description: "Capture current browser state: screenshot path, optional image, accessibility summary, and ref-indexed interactive elements.",
    promptSnippet: "Capture a page screenshot and ref-indexed interactive element list.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full-page screenshot instead of viewport" })),
      includeImage: Type.Optional(Type.Boolean({ description: "Attach screenshot image content to the tool result" })),
      maxAccessibilityLines: Type.Optional(Type.Number({ description: "Max accessibility summary lines (default: 80)" })),
      maxElements: Type.Optional(Type.Number({ description: "Max interactive elements (default: 120)" })),
      tabId: Type.Optional(Type.String({ description: "Target tab ID (default: active)" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & {
        fullPage?: boolean
        includeImage?: boolean
        maxAccessibilityLines?: number
        maxElements?: number
        tabId?: string
      }
      try {
        const { browser, state } = await connect(params)
        try {
          const page = await activePage(browser, state, params.tabId)
          const activeTargetId = targetIdOfPage(page)
          const viewport = page.viewport() ?? { width: 0, height: 0 }
          const screenshotPath = join(SCREENSHOT_DIR, `${Date.now()}-${activeTargetId ?? "page"}.png`)
          await page.screenshot({ path: screenshotPath as `${string}.png`, fullPage: params.fullPage ?? false })
          const elements = await collectDomElements(page, Math.max(1, Math.min(params.maxElements ?? 120, 500)))
          const lastRefs: BrowserUseState["lastRefs"] = {}
          for (const element of elements) {
            lastRefs[element.ref] = {
              label: element.name || element.text || element.value || element.href || element.selector,
              selector: element.selector,
              url: page.url(),
            }
          }
          await writeState({ ...state, activeTargetId, lastRefs })
          const accessibilityText = await simplifiedAccessibilityText(page, Math.max(0, Math.min(params.maxAccessibilityLines ?? 80, 400)))
          const text = formatSnapshot({
            accessibilityText,
            elements,
            screenshotPath,
            title: await page.title(),
            url: page.url(),
            viewport,
          })
          const content: ToolContent = [{ type: "text", text }]
          if (params.includeImage) {
            content.push({ type: "image", data: await readFile(screenshotPath, "base64"), mimeType: "image/png" })
          }
          return {
            content,
            details: { activeTargetId, elements, error: null, screenshotPath, url: page.url() },
          }
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description: "Click by browser_snapshot ref, CSS selector, or viewport coordinates.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      button: Type.Optional(Type.String({ description: "left, right, or middle (default: left)" })),
      clickCount: Type.Optional(Type.Number({ description: "Number of clicks (default: 1)" })),
      ref: Type.Optional(Type.String({ description: "Element ref from browser_snapshot, e.g. e3" })),
      selector: Type.Optional(Type.String({ description: "CSS selector fallback" })),
      tabId: Type.Optional(Type.String({ description: "Target tab ID (default: active)" })),
      x: Type.Optional(Type.Number({ description: "Viewport x coordinate" })),
      y: Type.Optional(Type.Number({ description: "Viewport y coordinate" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { button?: string; clickCount?: number; ref?: string; selector?: string; tabId?: string; x?: number; y?: number }
      try {
        const { browser, state } = await connect(params)
        try {
          const page = await activePage(browser, state, params.tabId)
          const button = ["left", "right", "middle"].includes(params.button ?? "") ? params.button as "left" | "right" | "middle" : "left"
          const clickCount = Math.max(1, Math.floor(params.clickCount ?? 1))
          const selector = await resolveElementSelector(params, page)
          if (selector) await clickSelector(page, selector, clickCount, button)
          else if (typeof params.x === "number" && typeof params.y === "number") await page.mouse.click(params.x, params.y, { button, count: clickCount })
          else return errorResult("Provide ref, selector, or both x and y")
          return textResult("Clicked. Call browser_snapshot to fetch updated state.", { url: page.url() })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description: "Type literal text into a ref/selector or the currently focused element.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      clear: Type.Optional(Type.Boolean({ description: "Clear existing field first using Ctrl/Meta+A then Backspace" })),
      delayMs: Type.Optional(Type.Number({ description: "Delay between keystrokes" })),
      ref: Type.Optional(Type.String({ description: "Element ref from browser_snapshot" })),
      selector: Type.Optional(Type.String({ description: "CSS selector fallback" })),
      tabId: Type.Optional(Type.String({ description: "Target tab ID (default: active)" })),
      text: Type.String({ description: "Literal text to type" }),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { clear?: boolean; delayMs?: number; ref?: string; selector?: string; tabId?: string; text: string }
      try {
        const { browser, state } = await connect(params)
        try {
          const page = await activePage(browser, state, params.tabId)
          const selector = await resolveElementSelector(params, page)
          if (selector) {
            const element = await page.$(selector)
            if (!element) return errorResult(`Element not found for selector: ${selector}`)
            await element.click()
          }
          if (params.clear) {
            await pressChord(page, platform() === "darwin" ? "Meta+A" : "Control+A")
            await page.keyboard.press("Backspace")
          }
          await page.keyboard.type(params.text, { delay: Math.max(0, params.delayMs ?? 0) })
          return textResult("Typed. Call browser_snapshot to fetch updated state.", { textLength: params.text.length, url: page.url() })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_key",
    label: "Browser Key",
    description: "Press a key or key combination in the active browser tab.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      key: Type.String({ description: "Key or chord, e.g. Enter, Tab, Meta+L, Control+A" }),
      tabId: Type.Optional(Type.String({ description: "Target tab ID (default: active)" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { key: string; tabId?: string }
      try {
        const { browser, state } = await connect(params)
        try {
          const page = await activePage(browser, state, params.tabId)
          await pressChord(page, params.key)
          return textResult(`Pressed ${params.key}. Call browser_snapshot to fetch updated state.`, { url: page.url() })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_scroll",
    label: "Browser Scroll",
    description: "Scroll the page or a ref/selector element.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      deltaX: Type.Optional(Type.Number({ description: "Raw horizontal scroll delta" })),
      deltaY: Type.Optional(Type.Number({ description: "Raw vertical scroll delta" })),
      direction: Type.Optional(Type.String({ description: "up, down, left, or right" })),
      pages: Type.Optional(Type.Number({ description: "Number of viewport pages/elements pages (default: 1)" })),
      ref: Type.Optional(Type.String({ description: "Element ref from browser_snapshot" })),
      selector: Type.Optional(Type.String({ description: "CSS selector fallback" })),
      tabId: Type.Optional(Type.String({ description: "Target tab ID (default: active)" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { deltaX?: number; deltaY?: number; direction?: string; pages?: number; ref?: string; selector?: string; tabId?: string }
      try {
        const { browser, state } = await connect(params)
        try {
          const page = await activePage(browser, state, params.tabId)
          const pages = Number.isFinite(params.pages) ? Math.max(0.05, params.pages ?? 1) : 1
          const viewport = page.viewport() ?? { width: 1000, height: 800 }
          let dx = params.deltaX ?? 0
          let dy = params.deltaY ?? 0
          if (dx === 0 && dy === 0) {
            switch ((params.direction ?? "down").toLowerCase()) {
              case "up": dy = -viewport.height * pages * 0.85; break
              case "down": dy = viewport.height * pages * 0.85; break
              case "left": dx = -viewport.width * pages * 0.85; break
              case "right": dx = viewport.width * pages * 0.85; break
              default: return errorResult("direction must be up, down, left, or right")
            }
          }
          const selector = await resolveElementSelector(params, page)
          if (selector) {
            await page.$eval(selector, (element, scroll) => {
              element.scrollBy({ left: scroll.dx, top: scroll.dy, behavior: "auto" })
            }, { dx, dy })
          } else {
            await page.mouse.wheel({ deltaX: dx, deltaY: dy })
          }
          return textResult("Scrolled. Call browser_snapshot to fetch updated state.", { deltaX: dx, deltaY: dy, url: page.url() })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  pi.registerTool({
    name: "browser_wait",
    label: "Browser Wait",
    description: "Wait for time, a selector, or text to appear in the active browser tab.",
    parameters: Type.Object({
      ...commonBrowserParams(),
      milliseconds: Type.Optional(Type.Number({ description: "Time to wait" })),
      selector: Type.Optional(Type.String({ description: "CSS selector to wait for" })),
      tabId: Type.Optional(Type.String({ description: "Target tab ID (default: active)" })),
      text: Type.Optional(Type.String({ description: "Text substring to wait for in document.body" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Timeout for selector/text wait" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as BrowserOptions & { milliseconds?: number; selector?: string; tabId?: string; text?: string; timeoutMs?: number }
      try {
        const { browser, state } = await connect(params)
        try {
          const page = await activePage(browser, state, params.tabId)
          if (params.selector?.trim()) {
            await page.waitForSelector(params.selector.trim(), { timeout: params.timeoutMs ?? 10_000 })
            return textResult(`Selector appeared: ${params.selector}`, { url: page.url() })
          }
          if (params.text?.trim()) {
            const text = params.text.trim()
            const timeoutMs = params.timeoutMs ?? 10_000
            await page.waitForFunction((needle) => document.body?.innerText.includes(needle), { timeout: timeoutMs }, text)
            return textResult(`Text appeared: ${text}`, { url: page.url() })
          }
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, params.milliseconds ?? 1000)))
          return textResult("Waited.", { url: page.url() })
        } finally {
          await browser.disconnect()
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })
}
