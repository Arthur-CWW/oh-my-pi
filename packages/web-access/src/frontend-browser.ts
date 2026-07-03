import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Effect } from "effect"
import { FrontendBrowserError } from "./schemas"
import {
  listFrontendProjects,
  listFrontendSessions,
  resolveFrontendProject,
  resolveFrontendSession,
  saveFrontendProject,
  saveFrontendSession,
  type FrontendProjectRecord,
  type FrontendSessionRecord,
} from "./frontend-session-store"

export type { FrontendProjectRecord, FrontendSessionRecord } from "./frontend-session-store"

export type FrontendProvider = "aistudio" | "deepseek" | "chatgpt" | "grok" | "jimeng"

export interface FrontendBrowserOptions {
  provider?: FrontendProvider
  browser?: string
  port?: number
  profileDir?: string
  background?: boolean
  timeoutMs?: number
}

export interface FrontendBrowserTarget {
  id: string
  title: string
  type: string
  url: string
}

export interface FrontendBrowserStatus {
  browser: string
  cdpUrl: string
  defaultUrl: string
  port: number
  profileDir: string
  provider: FrontendProvider
  running: boolean
  tabs: FrontendBrowserTarget[]
}

export interface FrontendBrowserSetupResult extends FrontendBrowserStatus {
  launched: boolean
  selectedTab: FrontendBrowserTarget | null
}

export interface GoogleLoginOptions extends FrontendBrowserOptions {
  account?: string
}

export interface ChatGptLoginOptions extends FrontendBrowserOptions {
  account?: string
}

export interface FrontendPromptOptions extends FrontendBrowserOptions {
  conversationUrl?: string
  newChat?: boolean
  outputFile?: string
  project?: string
  projectKey?: string
  projectUrl?: string
  prompt: string
  responseTimeoutMs?: number
  session?: string
  waitForResponse?: boolean
}

export interface FrontendCollectOptions extends FrontendBrowserOptions {
  conversationUrl?: string
  outputFile?: string
  project?: string
  responseTimeoutMs?: number
  session?: string
  waitForResponse?: boolean
}

export interface GoogleLoginResult extends FrontendBrowserSetupResult {
  clicked: string[]
  credentialAccount: string
  hasInboxSurface: boolean
  loggedIn: boolean
  needsHuman: boolean
  reusedTab: boolean
  title: string
  url: string
}

export interface ChatGptLoginResult extends FrontendBrowserSetupResult {
  clicked: string[]
  credentialAccount: string
  humanReason: string | null
  loggedIn: boolean
  needsHuman: boolean
  title: string
  url: string
}

export interface FrontendPromptResult extends FrontendBrowserSetupResult {
  conversationUrl: string | null
  humanReason: string | null
  needsHuman: boolean
  outputFile: string | null
  projectKey: string | null
  projectUrl: string | null
  responseLength: number
  responseText: string
  sessionId: string | null
  submitted: boolean
  title: string
  url: string
}

export interface FrontendCollectResult extends FrontendBrowserSetupResult {
  conversationUrl: string | null
  outputFile: string | null
  responseLength: number
  responseText: string
  running: boolean
  sessionId: string | null
  title: string
  url: string
}

interface GoogleCredential {
  email: string
  password: string
}

interface ProviderConfig {
  defaultPort: number
  host: string
  id: FrontendProvider
  profileName: string
  url: string
}

const PROVIDERS: Record<FrontendProvider, ProviderConfig> = {
  aistudio: {
    defaultPort: 9336,
    host: "aistudio.google.com",
    id: "aistudio",
    profileName: "helium-aistudio-profile",
    url: "https://aistudio.google.com/",
  },
  deepseek: {
    defaultPort: 9337,
    host: "chat.deepseek.com",
    id: "deepseek",
    profileName: "helium-deepseek-profile",
    url: "https://chat.deepseek.com/",
  },
  chatgpt: {
    defaultPort: 9338,
    host: "chatgpt.com",
    id: "chatgpt",
    profileName: "helium-chatgpt-profile",
    url: "https://chatgpt.com/",
  },
  grok: {
    defaultPort: 9339,
    host: "grok.com",
    id: "grok",
    profileName: "helium-grok-profile",
    url: "https://grok.com/",
  },
  jimeng: {
    defaultPort: 9340,
    host: "jimeng.jianying.com",
    id: "jimeng",
    profileName: "helium-jimeng-profile",
    url: "https://jimeng.jianying.com/",
  },
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function buildGrokLoginRecoveryStep(prompt: string, outputPath?: string | null): string {
  const trimmedPrompt = prompt.trim()
  const outputFile = outputFilePath(outputPath ?? undefined)
  const outputArg = outputFile ? ` --output-file ${shellQuote(outputFile)}` : ""
  const waitCommand = `pi-llm-browser wait --provider grok --session latest --response-timeout-ms 300000${outputArg}`
  const submitClause = trimmedPrompt
    ? `after login, submit without blocking via \`pi-llm-browser prompt --provider grok --no-wait${outputArg} ${shellQuote(trimmedPrompt)}\`, then collect later with \`${waitCommand}\`.`
    : `after login, collect later with \`${waitCommand}\`; this blocked recovery did not have prompt text, so do not resubmit a guessed prompt.`
  return `Manual recovery: ask Arthur to run \`pi-llm-browser setup --provider grok\` and sign into Grok in the dedicated Helium profile; ${submitClause}`
}

function withGrokRecoveryStep(reason: string, prompt: string, outputPath?: string | null): string {
  return `${reason} ${buildGrokLoginRecoveryStep(prompt, outputPath)}`
}

function execFilePromise(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function providerConfig(provider?: FrontendProvider): ProviderConfig {
  const id = provider ?? "aistudio"
  const config = PROVIDERS[id]
  if (!config) throw new FrontendBrowserError({ reason: `Unknown provider: ${String(provider)}` })
  return config
}

function resolvedOptions(options: FrontendBrowserOptions) {
  const config = providerConfig(options.provider)
  const port = options.port ?? config.defaultPort
  return {
    browser: options.browser?.trim() || "Helium",
    cdpUrl: `http://127.0.0.1:${port}`,
    config,
    port,
    profileDir: options.profileDir ?? join(homedir(), ".pi", "pi-web-access", config.profileName),
    timeoutMs: options.timeoutMs ?? 12_000,
  }
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

function isProviderTab(tab: FrontendBrowserTarget, host: string): boolean {
  try {
    return new URL(tab.url).hostname === host
  } catch {
    return false
  }
}

function isHost(url: string, host: string): boolean {
  try {
    return new URL(url).hostname === host
  } catch {
    return false
  }
}

function chatGptConversationKey(value: string): string | null {
  try {
    const url = new URL(value)
    const match = /(?:^|\/)c\/([0-9a-f-]+)/i.exec(url.pathname)
    return url.hostname === "chatgpt.com" ? match?.[1] ?? null : null
  } catch {
    return null
  }
}

function isChatGptConversationUrl(value: string): boolean {
  return Boolean(chatGptConversationKey(value))
}

function puppeteerTargetId(target: unknown): string | undefined {
  const value = (target as { _targetId?: unknown })._targetId
  return typeof value === "string" ? value : undefined
}

async function readGoogleCredential(account = "chatgpt-gmail"): Promise<GoogleCredential> {
  const swift = `
import Foundation
import Security

func read(service: String, account: String) -> String? {
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne
  ]
  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  guard status == errSecSuccess, let data = item as? Data else { return nil }
  return String(data: data, encoding: .utf8)
}

let account = ProcessInfo.processInfo.environment["PI_WEB_ACCESS_KEYCHAIN_ACCOUNT"] ?? "chatgpt-gmail"
guard let email = read(service: "pi-web-access/google-email", account: account),
      let password = read(service: "pi-web-access/google-password", account: account) else {
  fputs("missing credential\\n", stderr)
  exit(2)
}
print(email.data(using: .utf8)!.base64EncodedString())
print(password.data(using: .utf8)!.base64EncodedString())
`

  const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
    const child = execFile("/usr/bin/swift", ["-e", swift], {
      env: { ...process.env, PI_WEB_ACCESS_KEYCHAIN_ACCOUNT: account },
    }, (err, stdout, stderr) => {
      resolve({
        code: err && "code" in err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        stderr,
        stdout,
      })
    })
  })

  if (result.code !== 0) {
    throw new FrontendBrowserError({
      reason: `Could not read Google credential "${account}" from macOS Keychain.`,
    })
  }

  const [email64, password64] = result.stdout.trim().split(/\r?\n/)
  if (!email64 || !password64) {
    throw new FrontendBrowserError({
      reason: `Google credential "${account}" was incomplete in macOS Keychain.`,
    })
  }

  return {
    email: Buffer.from(email64, "base64").toString("utf8"),
    password: Buffer.from(password64, "base64").toString("utf8"),
  }
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of [
      "continue",
      "state",
      "TL",
      "flowEntry",
      "flowName",
      "dsh",
      "authuser",
      "service",
      "ifkv",
      "ec",
      "sacu",
      "login_hint",
      "client_id",
      "nonce",
      "opparams",
      "rart",
    ]) {
      parsed.searchParams.delete(key)
    }
    return redactText(parsed.toString())
  } catch {
    return redactText(url)
  }
}

function redactText(value: string): string {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
}

function outputFilePath(path: string | undefined): string | null {
  const trimmed = path?.trim()
  return trimmed || null
}

async function writeOutputFile(path: string | undefined, text: string): Promise<string | null> {
  const trimmed = outputFilePath(path)
  if (!trimmed) return null
  if (!text) return trimmed
  await mkdir(dirname(trimmed), { recursive: true })
  await writeFile(trimmed, text, "utf-8")
  return trimmed
}

async function readStatus(options: FrontendBrowserOptions): Promise<FrontendBrowserStatus> {
  const resolved = resolvedOptions(options)
  const rawTabs = await cdpJson<Array<Record<string, unknown>>>(resolved.cdpUrl, "/json/list")
  const tabs = rawTabs?.map((tab) => ({
    id: typeof tab.id === "string" ? tab.id : "",
    title: redactText(typeof tab.title === "string" ? tab.title : ""),
    type: typeof tab.type === "string" ? tab.type : "",
    url: sanitizeUrl(typeof tab.url === "string" ? tab.url : ""),
  })) ?? []
  return {
    browser: resolved.browser,
    cdpUrl: resolved.cdpUrl,
    defaultUrl: resolved.config.url,
    port: resolved.port,
    profileDir: resolved.profileDir,
    provider: resolved.config.id,
    running: Boolean(rawTabs),
    tabs,
  }
}

async function launchBrowser(options: FrontendBrowserOptions): Promise<boolean> {
  const resolved = resolvedOptions(options)
  if (await waitForCdp(resolved.cdpUrl, 400)) return false
  if (process.platform !== "darwin") {
    throw new FrontendBrowserError({ reason: "Browser launch is currently implemented for macOS only." })
  }

  await mkdir(resolved.profileDir, { recursive: true })
  const args = [
    ...(options.background ? ["-g"] : []),
    "-na",
    resolved.browser,
    "--args",
    `--remote-debugging-port=${resolved.port}`,
    `--user-data-dir=${resolved.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ]
  await execFilePromise("open", args)

  if (!await waitForCdp(resolved.cdpUrl, resolved.timeoutMs)) {
    throw new FrontendBrowserError({
      reason: `Timed out waiting for ${resolved.browser} CDP at ${resolved.cdpUrl}.`,
    })
  }
  return true
}

async function ensureProviderTab(options: FrontendBrowserOptions): Promise<FrontendBrowserTarget | null> {
  const resolved = resolvedOptions(options)
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: resolved.cdpUrl })
  try {
    const browserTarget = browser.targets().find((target) => target.type() === "browser")
    if (!browserTarget) throw new FrontendBrowserError({ reason: "Could not find browser CDP target." })

    const existing = browser.targets().find((target) => {
      try {
        return new URL(target.url()).hostname === resolved.config.host
      } catch {
        return false
      }
    })

    const client = await browserTarget.createCDPSession()
    try {
      let targetId = existing ? puppeteerTargetId(existing) : undefined
      if (!targetId) {
        const created = await client.send("Target.createTarget", {
          background: options.background ?? true,
          url: resolved.config.url,
        }) as { targetId: string }
        targetId = created.targetId
      } else if (!options.background) {
        await client.send("Target.activateTarget", { targetId })
      }

      const status = await readStatus(options)
      return status.tabs.find((tab) => tab.id === targetId)
        ?? status.tabs.find((tab) => isProviderTab(tab, resolved.config.host))
        ?? null
    } finally {
      await client.detach()
    }
  } finally {
    await browser.disconnect()
  }
}

async function clickText(page: any, texts: string[]): Promise<string | null> {
  return await page.evaluate((labels: string[]) => {
    const normalized = labels.map((label: string) => label.toLowerCase())
    const visible = (el: Element) => {
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0
    }

    for (const selector of ["button, a, [role='button']", "span, div"]) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(visible)
      for (const exact of [true, false]) {
        for (const el of candidates) {
          const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").toLowerCase()
          const match = normalized.find((label: string) => exact ? text === label : text.includes(label))
          if (match) {
            ;(el as HTMLElement).click()
            return labels[normalized.indexOf(match)]
          }
        }
      }
    }
    return null
  }, texts)
}

async function clickTextByMouse(page: any, texts: string[], options: { preferRight?: boolean } = {}): Promise<string | null> {
  const match = await page.evaluate((labels: string[], preferRight: boolean) => {
    const normalized = labels.map((label: string) => label.toLowerCase())
    const visible = (el: Element) => {
      const style = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0
    }
    const matches: Array<{ exact: boolean; index: number; label: string; x: number; y: number }> = []
    for (const selector of ["button, a, [role='button']", "span, div"]) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(visible)
      for (const el of candidates) {
        const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").toLowerCase()
        const rect = el.getBoundingClientRect()
        normalized.forEach((label: string, index: number) => {
          if (text === label || text.includes(label)) {
            matches.push({
              exact: text === label,
              index,
              label: labels[index]!,
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
            })
          }
        })
      }
      if (matches.length) break
    }

    matches.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1
      if (a.index !== b.index) return a.index - b.index
      return preferRight ? b.x - a.x : a.y - b.y
    })
    return matches[0] ?? null
  }, texts, Boolean(options.preferRight))

  if (!match) return null
  await page.mouse.click(match.x, match.y)
  return match.label
}

async function typeInput(page: any, selector: string, value: string): Promise<boolean> {
  const focused = await page.evaluate((inputSelector: string) => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const input = Array.from(document.querySelectorAll(inputSelector))
      .find((el) => visible(el) && !(el as HTMLInputElement).disabled) as HTMLInputElement | undefined
    if (!input) return false

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    input.focus()
    setter?.call(input, "")
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))
    return true
  }, selector)
  if (!focused) return false

  const client = await page.target().createCDPSession()
  try {
    await client.send("Input.insertText", { text: value })
  } finally {
    await client.detach()
  }
  await page.evaluate((inputSelector: string) => {
    const input = Array.from(document.querySelectorAll(inputSelector))
      .find((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }) as HTMLInputElement | undefined
    input?.dispatchEvent(new Event("change", { bubbles: true }))
  }, selector).catch(() => {})
  return true
}

type FrontendAutomationPage = Parameters<typeof typeInput>[0]

async function createGrokPromptPage(options: FrontendBrowserOptions) {
  const promptOptions = {
    ...options,
    background: options.background ?? true,
    provider: "grok" as const,
  }
  const launched = await launchBrowser(promptOptions)
  const created = await createBackgroundPage(promptOptions, "https://grok.com/")
  const status = await readStatus(promptOptions)
  const selectedTab = status.tabs.find((tab) => tab.id === created.targetId)
    ?? status.tabs.find((tab) => isProviderTab(tab, "x.com"))
    ?? null
  return {
    browser: created.browser,
    launched,
    page: created.page,
    selectedTab,
  }
}

async function inspectGrokHumanBlocker(page: FrontendAutomationPage): Promise<string | null> {
  return await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const text = document.body?.innerText ?? ""
    const controls = Array.from(document.querySelectorAll("button, a, [role='button']")).filter(visible)
    const loginControl = controls.some((el) => /^(sign in|log in|sign up|join)(\b|$)/i.test((el.textContent ?? "").trim()))
    const loginPage = /\/i\/(?:flow\/)?login|\/i\/jf\/onboarding|\/auth|\/login|\/sign-in/i.test(location.pathname)
      || /See what.s happening|Join X today|Continue with Google|Continue with Apple|Continue with X|Email or username|Sign in to Grok|Log in to Grok/i.test(text)
    if (loginControl || loginPage) {
      return "X/Grok login is required in the dedicated Grok browser profile before frontend prompt automation."
    }
    if (/captcha|verification|2-step|two-step|passkey|security code|approve|cloudflare|checking your browser/i.test(text)) {
      return "X/Grok sign-in or browser challenge requires manual attention."
    }
    const termsPrompt = controls.some((el) => /accept|agree/i.test((el.textContent ?? "").trim()))
      && /terms|privacy policy/i.test(text)
    if (termsPrompt) {
      return "X/Grok terms or policy prompt requires manual attention."
    }
    return null
  })
}

async function fillGrokPrompt(page: FrontendAutomationPage, prompt: string): Promise<void> {
  const focused = await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const selectors = [
      "main [contenteditable='true'][role='textbox']",
      "main [contenteditable='true']",
      "[data-testid*='grok' i] [contenteditable='true']",
      "[contenteditable='true'][role='textbox']",
      "textarea",
      "[role='textbox']",
    ]
    const candidates = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))))
      .filter(visible)
      .filter((el) => {
        const label = [
          el.getAttribute("aria-label") ?? "",
          el.getAttribute("placeholder") ?? "",
          el.textContent ?? "",
        ].join("\n")
        return !/search|phone|email|username|password/i.test(label)
      }) as HTMLElement[]
    candidates.sort((a, b) => {
      const aRect = a.getBoundingClientRect()
      const bRect = b.getBoundingClientRect()
      const aArea = aRect.width * aRect.height
      const bArea = bRect.width * bRect.height
      if (aArea !== bArea) return bArea - aArea
      return bRect.y - aRect.y
    })
    const input = candidates[0]
    if (!input) return false

    input.scrollIntoView({ block: "center", inline: "nearest" })
    input.focus()
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
      setter?.call(input, "")
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))
      return true
    }

    document.getSelection()?.selectAllChildren(input)
    document.execCommand("delete")
    return true
  })

  if (!focused) {
    throw new FrontendBrowserError({ reason: "Could not find Grok prompt textbox." })
  }

  const client = await page.target().createCDPSession()
  try {
    await client.send("Input.insertText", { text: prompt })
  } finally {
    await client.detach()
  }
}

async function submitGrokPrompt(page: FrontendAutomationPage): Promise<boolean> {
  for (let i = 0; i < 24; i++) {
    const box = await page.evaluate(() => {
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }
      const disabled = (el: Element) => {
        const button = el as HTMLButtonElement
        return Boolean(button.disabled) || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
      }
      const buttons = Array.from(document.querySelectorAll("main button, button, [role='button']"))
        .filter(visible)
        .filter((el) => !disabled(el))
      const send = buttons.find((el) => /send|submit/i.test(el.getAttribute("aria-label") ?? ""))
        ?? buttons.find((el) => /send|submit/i.test(el.getAttribute("data-testid") ?? ""))
        ?? buttons.find((el) => /send|submit/i.test((el.textContent ?? "").trim()))
      if (!send) return null
      const rect = send.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    if (box) {
      await page.mouse.click(box.x, box.y)
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function extractGrokResponse(page: FrontendAutomationPage, prompt: string, baseline = ""): Promise<string> {
  return await page.evaluate((submittedPrompt: string, previousText: string) => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim()
    const clean = (value: string) => normalize(value)
      .replace(/^Grok\s*/i, "")
      .trim()
    const normalizedPrompt = normalize(submittedPrompt)
    const normalizedBaseline = normalize(previousText)
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const selectors = [
      "main article",
      "main [data-testid*='message' i]",
      "main [data-testid*='cellInnerDiv' i]",
      "main [class*='markdown' i]",
      "main [role='listitem']",
      "main",
    ]
    const reject = [
      /See what.s happening/i,
      /Continue with Google|Continue with Apple/i,
      /^Home Notifications Messages/i,
      /What do you want to know/i,
      /Terms of Service|Privacy Policy|Cookie Policy/i,
    ]
    const accept = (text: string) => {
      if (text.length < 2) return false
      if (text === normalizedPrompt) return false
      if (text === normalizedBaseline) return false
      if (reject.some((pattern) => pattern.test(text))) return false
      if (text.includes(normalizedPrompt) && text.length < normalizedPrompt.length + 20) return false
      return true
    }

    for (const selector of selectors) {
      const candidates = Array.from(new Set(Array.from(document.querySelectorAll(selector))))
        .filter(visible)
        .map((el) => {
          const text = clean(el.textContent ?? "")
          return text.includes(normalizedPrompt) ? clean(text.replace(normalizedPrompt, "")) : text
        })
        .filter(accept)
      if (candidates.length) return candidates[candidates.length - 1]!
    }
    return ""
  }, prompt, baseline)
}

async function isGrokResponseRunning(page: FrontendAutomationPage): Promise<boolean> {
  return await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    return Array.from(document.querySelectorAll("main button, button, [role='button']"))
      .filter(visible)
      .some((el) => {
        const label = [
          el.getAttribute("aria-label") ?? "",
          el.getAttribute("data-testid") ?? "",
          el.textContent ?? "",
        ].join("\n")
        return /stop|cancel|generating|responding/i.test(label)
      })
  }).catch(() => false)
}

async function waitForGrokResponse(page: FrontendAutomationPage, prompt: string, timeoutMs: number, baseline: string): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let best = ""
  let last = ""
  let stableTicks = 0
  await new Promise((resolve) => setTimeout(resolve, 1_000))

  while (Date.now() < deadline) {
    const current = await extractGrokResponse(page, prompt, baseline).catch(() => "")
    if (current.length > best.length) best = current
    if (current && current === last) stableTicks++
    else stableTicks = 0
    last = current

    const running = await isGrokResponseRunning(page)
    if (best && !running && stableTicks >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return best
}

async function promptGrok(options: FrontendPromptOptions): Promise<FrontendPromptResult> {
  const prompt = options.prompt.trim()
  if (!prompt) throw new FrontendBrowserError({ reason: "Prompt is empty." })

  const connection = options.conversationUrl || options.newChat === false
    ? await connectProviderPage({
      ...options,
      background: options.background ?? true,
      provider: "grok",
    })
    : await createGrokPromptPage(options)
  const { browser, launched, page, selectedTab } = connection

  try {
    if (options.conversationUrl) {
      await page.goto(options.conversationUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => {})
    }
    await page.waitForSelector("body", { timeout: 15_000 })
    await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 8_000 }).catch(() => {})

    const humanReason = await inspectGrokHumanBlocker(page)
    const title = redactText(await page.title())
    const url = sanitizeUrl(page.url())
    if (humanReason) {
      const status = await readStatus({ ...options, provider: "grok" })
      return {
        ...status,
        conversationUrl: null,
        humanReason,
        launched,
        needsHuman: true,
        outputFile: null,
        projectKey: null,
        projectUrl: null,
        responseLength: 0,
        responseText: "",
        sessionId: null,
        selectedTab,
        submitted: false,
        title,
        url,
      }
    }

    await fillGrokPrompt(page, prompt)
    const responseBaseline = await extractGrokResponse(page, prompt).catch(() => "")
    const submitted = await submitGrokPrompt(page)
    if (!submitted) {
      throw new FrontendBrowserError({ reason: "Could not find an enabled Grok send button." })
    }

    const responseText = options.waitForResponse === false
      ? ""
      : await waitForGrokResponse(page, prompt, options.responseTimeoutMs ?? 120_000, responseBaseline)
    const status = await readStatus({ ...options, provider: "grok" })

    return {
      ...status,
      conversationUrl: sanitizeUrl(page.url()),
      humanReason: null,
      launched,
      needsHuman: false,
      outputFile: null,
      projectKey: null,
      projectUrl: null,
      responseLength: responseText.length,
      responseText,
      sessionId: null,
      selectedTab,
      submitted,
      title: redactText(await page.title()),
      url: sanitizeUrl(page.url()),
    }
  } finally {
    await browser.disconnect()
  }
}

async function findExistingPage(options: FrontendBrowserOptions, host: string) {
  const resolved = resolvedOptions(options)
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: resolved.cdpUrl })
  const target = browser.targets().find((candidate) => candidate.type() === "page" && isHost(candidate.url(), host))
  if (!target) {
    await browser.disconnect()
    return null
  }

  const page = await target.page()
  if (!page) {
    await browser.disconnect()
    return null
  }

  return { browser, page, targetId: puppeteerTargetId(target) }
}

async function createBackgroundPage(options: FrontendBrowserOptions, url: string) {
  const resolved = resolvedOptions(options)
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: resolved.cdpUrl })
  const browserTarget = browser.targets().find((target) => target.type() === "browser")
  if (!browserTarget) {
    await browser.disconnect()
    throw new FrontendBrowserError({ reason: "Could not find browser CDP target." })
  }

  const client = await browserTarget.createCDPSession()
  try {
    const created = await client.send("Target.createTarget", {
      background: options.background ?? true,
      url,
    }) as { targetId: string }

    const target = await browser.waitForTarget(
      (candidate) => puppeteerTargetId(candidate) === created.targetId,
      { timeout: 10_000 },
    )
    const page = await target.page()
    if (!page) throw new FrontendBrowserError({ reason: "Could not attach to created page." })
    return { browser, page, targetId: created.targetId }
  } finally {
    await client.detach()
  }
}

async function connectProviderPage(options: FrontendBrowserOptions) {
  const resolved = resolvedOptions(options)
  const launched = await launchBrowser(options)
  const selectedTab = await ensureProviderTab(options)
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: resolved.cdpUrl })
  const target = browser.targets().find((candidate) => candidate.type() === "page" && isHost(candidate.url(), resolved.config.host))
  if (!target) {
    await browser.disconnect()
    throw new FrontendBrowserError({ reason: `Could not find ${resolved.config.id} tab after launch.` })
  }

  const page = await target.page()
  if (!page) {
    await browser.disconnect()
    throw new FrontendBrowserError({ reason: `Could not attach to ${resolved.config.id} tab.` })
  }

  return { browser, launched, page, selectedTab }
}

async function inspectGmailSession(page: any) {
  await page.goto("https://mail.google.com/mail/u/0/#inbox", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  })
  await page.waitForNetworkIdle({ idleTime: 1_500, timeout: 10_000 }).catch(() => {})

  const title = await page.title()
  const url = page.url()
  const body = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")
  const loggedIn = /mail\.google\.com/.test(url) && !/accounts\.google\.com/.test(url)
  const needsHuman =
    !loggedIn
    && /accounts\.google\.com/.test(url)
    && /2-step|two-step|verify|verification|captcha|passkey|recovery phone|phone verification|approve|challenge|security code|couldn.t sign you in|suspicious/i
      .test(`${url}\n${body}`)
  const hasInboxSurface = /Inbox|Compose|Primary|Gmail/i.test(`${title}\n${body}`)

  return {
    hasInboxSurface,
    loggedIn,
    needsHuman,
    title,
    url,
  }
}

async function inspectAiStudioHumanBlocker(page: any): Promise<string | null> {
  return await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const terms = Array.from(document.querySelectorAll("input, button"))
      .filter(visible)
      .some((el) => {
        const label = `${el.getAttribute("aria-label") ?? ""}\n${el.textContent ?? ""}`
        return /terms of service|accept terms/i.test(label)
      })
    if (terms) return "AI Studio terms of service require manual acceptance in the browser."

    const text = document.body?.innerText ?? ""
    if (/sign in|choose an account/i.test(text) && /accounts\.google\.com/.test(location.href)) {
      return "Google sign-in requires manual attention."
    }
    if (/captcha|verification|2-step|two-step|passkey|security code|approve/i.test(text)) {
      return "Google sign-in challenge requires manual attention."
    }
    return null
  })
}

async function dismissAiStudioBanners(page: any): Promise<void> {
  await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const buttons = Array.from(document.querySelectorAll("button")).filter(visible)
    for (const button of buttons) {
      const text = (button.textContent ?? "").trim()
      const label = button.getAttribute("aria-label") ?? ""
      if (/^dismiss$/i.test(text) || /^dismiss$/i.test(label)) {
        ;(button as HTMLElement).click()
        return
      }
    }
  }).catch(() => {})
}

async function fillAiStudioPrompt(page: any, prompt: string): Promise<void> {
  const ok = await page.evaluate((value: string) => {
    const input = document.querySelector(
      "textarea[aria-label='Enter a prompt'], textarea[placeholder*='prompt' i]",
    ) as HTMLTextAreaElement | null
    if (!input) return false

    input.focus()
    input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }, prompt)

  if (!ok) {
    throw new FrontendBrowserError({ reason: "Could not find AI Studio prompt textarea." })
  }
}

async function submitAiStudioPrompt(page: any): Promise<boolean> {
  return await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter(visible)
      .filter((button) => !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true")
    const run = buttons.find((button) => /(^|\s)run(\s|$)/i.test((button.textContent ?? "").trim()))
      ?? buttons.find((button) => button.getAttribute("aria-label")?.match(/run|send|submit/i))
    if (!run) return false
    ;(run as HTMLElement).click()
    return true
  })
}

async function extractAiStudioResponse(page: any, prompt: string, baseline = ""): Promise<string> {
  return await page.evaluate((submittedPrompt: string, previousText: string) => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim()
    const normalizedBaseline = normalize(previousText)
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const selectors = [
      "ms-model-response",
      "ms-chat-turn",
      "ms-cmark-node",
      "[data-testid*='response' i]",
      "[class*='response' i]",
      "markdown",
    ]
    const candidates = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))))
      .filter(visible)
      .map((el) => normalize(el.textContent ?? ""))
      .filter((text) => {
        if (text.length < 2) return false
        if (text === normalize(submittedPrompt)) return false
        if (text === normalizedBaseline) return false
        if (text.includes("Start typing a prompt")) return false
        return true
      })

    candidates.sort((a, b) => b.length - a.length)
    return candidates[0] ?? ""
  }, prompt, baseline)
}

async function waitForAiStudioResponse(page: any, prompt: string, timeoutMs: number, baseline: string): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let best = ""
  let last = ""
  let stableTicks = 0
  await new Promise((resolve) => setTimeout(resolve, 1_000))

  while (Date.now() < deadline) {
    const current = await extractAiStudioResponse(page, prompt, baseline).catch(() => "")
    if (current.length > best.length) best = current
    if (current && current === last) stableTicks++
    else stableTicks = 0
    last = current

    const running = await page.evaluate(() => /stop|cancel/i.test(document.body?.innerText ?? "")).catch(() => false)
    if (best && !running && stableTicks >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return best
}

async function promptAiStudio(options: FrontendPromptOptions): Promise<FrontendPromptResult> {
  if ((options.provider ?? "aistudio") !== "aistudio") {
    throw new FrontendBrowserError({ reason: "Frontend prompt automation currently supports provider=aistudio only." })
  }

  const prompt = options.prompt.trim()
  if (!prompt) throw new FrontendBrowserError({ reason: "Prompt is empty." })

  const { browser, launched, page, selectedTab } = await connectProviderPage({
    ...options,
    background: options.background ?? true,
    provider: "aistudio",
  })

  try {
    if (options.newChat ?? true) {
      await page.goto("https://aistudio.google.com/prompts/new_chat", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => {})
    }
    await page.waitForSelector("body", { timeout: 15_000 })
    await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 8_000 }).catch(() => {})
    await dismissAiStudioBanners(page)

    const humanReason = await inspectAiStudioHumanBlocker(page)
    const title = redactText(await page.title())
    const url = sanitizeUrl(page.url())
    if (humanReason) {
      const status = await readStatus({ ...options, provider: "aistudio" })
      return {
        ...status,
        conversationUrl: null,
        humanReason,
        launched,
        needsHuman: true,
        outputFile: null,
        projectKey: null,
        projectUrl: null,
        responseLength: 0,
        responseText: "",
        sessionId: null,
        selectedTab,
        submitted: false,
        title,
        url,
      }
    }

    await fillAiStudioPrompt(page, prompt)
    const responseBaseline = await extractAiStudioResponse(page, prompt).catch(() => "")
    const submitted = await submitAiStudioPrompt(page)
    if (!submitted) {
      throw new FrontendBrowserError({ reason: "Could not find an enabled AI Studio Run button." })
    }

    const responseText = options.waitForResponse === false
      ? ""
      : await waitForAiStudioResponse(page, prompt, options.responseTimeoutMs ?? 120_000, responseBaseline)
    const status = await readStatus({ ...options, provider: "aistudio" })

    return {
      ...status,
      conversationUrl: sanitizeUrl(page.url()),
      humanReason: null,
      launched,
      needsHuman: false,
      outputFile: null,
      projectKey: null,
      projectUrl: null,
      responseLength: responseText.length,
      responseText,
      sessionId: null,
      selectedTab,
      submitted,
      title: redactText(await page.title()),
      url: sanitizeUrl(page.url()),
    }
  } finally {
    await browser.disconnect()
  }
}

async function inspectChatGptHumanBlocker(page: any, loginRequiredIsHuman = true): Promise<string | null> {
  return await page.evaluate((treatLoginAsHuman: boolean) => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const visibleButtons = Array.from(document.querySelectorAll("button, a")).filter(visible)
    const hasLogin = visibleButtons.some((el) => /^log in$/i.test((el.textContent ?? "").trim()))
    const hasSignup = visibleButtons.some((el) => /sign up/i.test((el.textContent ?? "").trim()))
    if (treatLoginAsHuman && hasLogin && hasSignup) {
      return "ChatGPT login is required before Pro frontend prompt automation."
    }

    const text = document.body?.innerText ?? ""
    if (/captcha|verification|2-step|two-step|passkey|security code|approve|cloudflare|checking your browser/i.test(text)) {
      return "ChatGPT sign-in or browser challenge requires manual attention."
    }
    const termsPrompt = visibleButtons.some((el) => /accept|agree/i.test((el.textContent ?? "").trim()))
      && /terms of use|privacy policy/i.test(text)
    if (termsPrompt) {
      return "ChatGPT terms or policy prompt requires manual attention."
    }
    return null
  }, loginRequiredIsHuman)
}

async function inspectChatGptSession(page: any, loginRequiredIsHuman = true) {
  const data = await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const visibleControls = Array.from(document.querySelectorAll("button, a")).filter(visible)
    const hasLogin = visibleControls.some((el) => /^log in$/i.test((el.textContent ?? "").trim()))
    const hasSignup = visibleControls.some((el) => /sign up/i.test((el.textContent ?? "").trim()))
    const hasTextbox = Array.from(document.querySelectorAll("[contenteditable='true'][role='textbox'], [contenteditable='true']"))
      .some(visible)
    const body = document.body?.innerText ?? ""
    return {
      body,
      hasLogin,
      hasSignup,
      hasTextbox,
      title: document.title,
      url: location.href,
    }
  })
  const humanReason = await inspectChatGptHumanBlocker(page, loginRequiredIsHuman)
  const loggedIn = /chatgpt\.com/.test(data.url) && data.hasTextbox && !data.hasLogin && !data.hasSignup
  return {
    humanReason,
    loggedIn,
    needsHuman: Boolean(humanReason),
    title: data.title,
    url: data.url,
  }
}

async function fillChatGptPrompt(page: any, prompt: string): Promise<void> {
  const focused = await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const input = Array.from(document.querySelectorAll("[contenteditable='true'][role='textbox'], [contenteditable='true']"))
      .find(visible) as HTMLElement | undefined
    if (!input) return false
    input.focus()
    document.getSelection()?.selectAllChildren(input)
    document.execCommand("delete")
    return true
  })

  if (!focused) {
    throw new FrontendBrowserError({ reason: "Could not find ChatGPT prompt textbox." })
  }

  const client = await page.target().createCDPSession()
  try {
    await client.send("Input.insertText", { text: prompt })
  } finally {
    await client.detach()
  }
}

async function submitChatGptPrompt(page: any): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const box = await page.evaluate(() => {
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }
      const buttons = Array.from(document.querySelectorAll("button"))
        .filter(visible)
        .filter((button) => !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true")
      const send = buttons.find((button) => /send/i.test(button.getAttribute("aria-label") ?? ""))
        ?? buttons.find((button) => button.getAttribute("data-testid")?.match(/send/i))
        ?? buttons.find((button) => /send|submit/i.test((button.textContent ?? "").trim()))
      if (!send) return null
      const rect = send.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    if (box) {
      await page.mouse.click(box.x, box.y)
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function extractChatGptResponse(page: any, prompt: string, baseline = ""): Promise<string> {
  return await page.evaluate((submittedPrompt: string, previousText: string) => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim()
    const clean = (value: string) => normalize(value)
      .replace(/^ChatGPT said:\s*/i, "")
      .replace(/^Worked for\s+(?:\d+[smh]\s*)+/i, "")
      .trim()
    const normalizedPrompt = normalize(submittedPrompt)
    const normalizedBaseline = normalize(previousText)
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const selectorGroups = [
      "[data-message-author-role='assistant'] .markdown",
      ".markdown",
      "[data-message-author-role='assistant']",
      "[data-testid*='assistant']",
      "[data-testid*='conversation-turn']",
      "article",
    ]
    const accept = (text: string) => {
      if (text.length < 2) return false
      if (/^(pro\s+)?thinking$/i.test(text)) return false
      if (/^finalizing answer$/i.test(text)) return false
      if (text === normalizedPrompt) return false
      if (text === normalizedBaseline) return false
      if (text.includes(normalizedPrompt) && text.length < normalizedPrompt.length + 20) return false
      if (/What.s on your mind today|By messaging ChatGPT/i.test(text)) return false
      return true
    }

    for (const selector of selectorGroups) {
      const candidates = Array.from(new Set(Array.from(document.querySelectorAll(selector))))
        .filter(visible)
        .map((el) => clean(el.textContent ?? ""))
        .filter(accept)
      if (candidates.length) return candidates[candidates.length - 1]!
    }
    return ""
  }, prompt, baseline)
}

async function isChatGptResponseRunning(page: any): Promise<boolean> {
  return await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const disabled = (el: Element) => {
      const button = el as HTMLButtonElement
      return Boolean(button.disabled) || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
    }
    return Array.from(document.querySelectorAll("button, [role='button']"))
      .filter(visible)
      .filter((el) => !disabled(el))
      .some((el) => {
        const label = [
          el.getAttribute("aria-label") ?? "",
          el.getAttribute("data-testid") ?? "",
          el.textContent ?? "",
        ].join("\n")
        return /stop answering|stop generating|stop streaming|stop-button|cancel response|cancel generation/i.test(label)
      })
  }).catch(() => false)
}

async function waitForChatGptResponse(page: any, prompt: string, timeoutMs: number, baseline: string): Promise<string> {
  const startedAt = Date.now()
  const minimumQuietMs = Math.min(20_000, Math.max(8_000, Math.floor(timeoutMs / 12)))
  const deadline = Date.now() + timeoutMs
  let best = ""
  let last = ""
  let stableTicks = 0
  await new Promise((resolve) => setTimeout(resolve, 1_000))

  while (Date.now() < deadline) {
    const current = await extractChatGptResponse(page, prompt, baseline).catch(() => "")
    if (current.length > best.length) best = current
    if (current && current === last) stableTicks++
    else stableTicks = 0
    last = current

    const running = await isChatGptResponseRunning(page)
    const likelyProPreamble = /^I(?:'|’)ll\b/i.test(best.trim()) && best.length < 1_000
    const preambleQuietMs = likelyProPreamble
      ? Math.min(timeoutMs - 1_000, Math.max(minimumQuietMs, 90_000))
      : minimumQuietMs
    if (best && !running && stableTicks >= 2 && Date.now() - startedAt >= preambleQuietMs) break
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return best
}

async function promptChatGpt(options: FrontendPromptOptions): Promise<FrontendPromptResult> {
  const prompt = options.prompt.trim()
  if (!prompt) throw new FrontendBrowserError({ reason: "Prompt is empty." })

  const { browser, launched, page, selectedTab } = await connectProviderPage({
    ...options,
    background: options.background ?? true,
    provider: "chatgpt",
  })

  try {
    if (options.conversationUrl) {
      await page.goto(options.conversationUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => {})
    } else if (options.projectUrl) {
      await page.goto(options.projectUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => {})
    } else if (options.newChat ?? true) {
      await page.goto("https://chatgpt.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => {})
    }
    await page.waitForSelector("body", { timeout: 15_000 })
    await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 8_000 }).catch(() => {})

    const humanReason = await inspectChatGptHumanBlocker(page)
    const title = redactText(await page.title())
    const url = sanitizeUrl(page.url())
    if (humanReason) {
      const status = await readStatus({ ...options, provider: "chatgpt" })
      return {
        ...status,
        conversationUrl: null,
        humanReason,
        launched,
        needsHuman: true,
        outputFile: null,
        projectKey: null,
        projectUrl: null,
        responseLength: 0,
        responseText: "",
        sessionId: null,
        selectedTab,
        submitted: false,
        title,
        url,
      }
    }

    await fillChatGptPrompt(page, prompt)
    const responseBaseline = await extractChatGptResponse(page, prompt).catch(() => "")
    const submitted = await submitChatGptPrompt(page)
    if (!submitted) {
      throw new FrontendBrowserError({ reason: "Could not find an enabled ChatGPT send button." })
    }

    const responseText = options.waitForResponse === false
      ? ""
      : await waitForChatGptResponse(page, prompt, options.responseTimeoutMs ?? 120_000, responseBaseline)
    const status = await readStatus({ ...options, provider: "chatgpt" })

    return {
      ...status,
      conversationUrl: sanitizeUrl(page.url()),
      humanReason: null,
      launched,
      needsHuman: false,
      outputFile: null,
      projectKey: null,
      projectUrl: null,
      responseLength: responseText.length,
      responseText,
      sessionId: null,
      selectedTab,
      submitted,
      title: redactText(await page.title()),
      url: sanitizeUrl(page.url()),
    }
  } finally {
    await browser.disconnect()
  }
}

async function preparePromptOptions(options: FrontendPromptOptions): Promise<{
  options: FrontendPromptOptions
  project: FrontendProjectRecord | null
  session: FrontendSessionRecord | null
}> {
  let prepared = { ...options }
  let session: FrontendSessionRecord | null = null

  if (options.session) {
    session = await resolveFrontendSession(options.session, {
      project: options.project,
      provider: options.provider,
    })
    if (!session) throw new FrontendBrowserError({ reason: `Stored session not found: ${options.session}` })
    prepared = {
      ...prepared,
      conversationUrl: session.conversationUrl ?? prepared.conversationUrl,
      newChat: false,
      outputFile: prepared.outputFile ?? session.outputPath ?? undefined,
      project: prepared.project ?? session.projectKey ?? undefined,
      projectKey: prepared.projectKey ?? session.projectKey ?? undefined,
      projectUrl: prepared.projectUrl ?? session.projectUrl ?? undefined,
      provider: prepared.provider ?? session.provider,
    }
  }

  const provider = prepared.provider ?? "aistudio"
  let project: FrontendProjectRecord | null = null
  if (prepared.project && !prepared.projectUrl) {
    project = await resolveFrontendProject(provider, prepared.project)
    if (!project) throw new FrontendBrowserError({ reason: `Stored project not found: ${prepared.project}` })
    prepared = {
      ...prepared,
      projectKey: project.key,
      projectUrl: project.url,
    }
  } else if (prepared.projectUrl) {
    project = await resolveFrontendProject(provider, prepared.projectUrl)
    prepared = {
      ...prepared,
      projectKey: prepared.projectKey ?? project?.key,
    }
  }

  return { options: prepared, project, session }
}

async function promptProvider(options: FrontendPromptOptions): Promise<FrontendPromptResult> {
  const prepared = await preparePromptOptions(options)
  const provider = prepared.options.provider ?? "aistudio"
  let result: FrontendPromptResult
  if (provider === "aistudio") result = await promptAiStudio(prepared.options)
  else if (provider === "chatgpt") result = await promptChatGpt(prepared.options)
  else if (provider === "grok") result = await promptGrok(prepared.options)
  else {
    throw new FrontendBrowserError({
      reason: "Frontend prompt automation currently supports provider=aistudio, provider=chatgpt, and provider=grok. Use setup/open/status for deepseek and jimeng until provider-specific prompt adapters are implemented.",
    })
  }

  if (!result.submitted) {
    const outputFile = outputFilePath(prepared.options.outputFile) ?? prepared.session?.outputPath ?? null
    const recoveryStep = provider === "grok" && result.humanReason ? buildGrokLoginRecoveryStep(prepared.options.prompt, outputFile) : null
    const humanReason = recoveryStep && result.humanReason ? `${result.humanReason} ${recoveryStep}` : result.humanReason
    if (!result.needsHuman && !outputFile) return result
    const session = await saveFrontendSession({
      blockerReason: humanReason,
      conversationUrl: result.conversationUrl ?? result.url,
      outputPath: outputFile,
      projectKey: prepared.options.projectKey ?? prepared.project?.key ?? prepared.session?.projectKey ?? null,
      projectUrl: prepared.options.projectUrl ?? prepared.project?.url ?? prepared.session?.projectUrl ?? null,
      prompt: prepared.options.prompt,
      provider,
      recoveryStep,
      responseText: result.responseText,
      title: result.title,
    })
    return {
      ...result,
      humanReason,
      conversationUrl: session.conversationUrl,
      outputFile,
      projectKey: session.projectKey,
      projectUrl: session.projectUrl,
      sessionId: session.id,
    }
  }

  const outputFile = await writeOutputFile(prepared.options.outputFile, result.responseText)
  const session = await saveFrontendSession({
    conversationUrl: result.conversationUrl ?? result.url,
    outputPath: outputFile ?? prepared.session?.outputPath ?? null,
    projectKey: prepared.options.projectKey ?? prepared.project?.key ?? prepared.session?.projectKey ?? null,
    projectUrl: prepared.options.projectUrl ?? prepared.project?.url ?? prepared.session?.projectUrl ?? null,
    prompt: prepared.options.prompt,
    provider,
    responseText: result.responseText,
    title: result.title,
    blockerReason: null,
    recoveryStep: null,
  })

  return {
    ...result,
    conversationUrl: session.conversationUrl,
    outputFile,
    projectKey: session.projectKey,
    projectUrl: session.projectUrl,
    sessionId: session.id,
  }
}

async function collectGrokResponse(options: FrontendCollectOptions): Promise<FrontendCollectResult> {
  const provider = options.provider ?? "grok"
  if (provider !== "grok") {
    throw new FrontendBrowserError({ reason: "Grok collect/wait requires provider=grok." })
  }

  const session = options.session
    ? await resolveFrontendSession(options.session, { project: options.project, provider })
    : null
  if (options.session && !session) {
    throw new FrontendBrowserError({ reason: `Stored session not found: ${options.session}` })
  }

  const conversationUrl = options.conversationUrl?.trim() || session?.conversationUrl?.trim() || "https://grok.com/"
  const { browser, launched, page, selectedTab } = await connectProviderPage({
    ...options,
    background: options.background ?? true,
    provider: "grok",
  })

  try {
    if (conversationUrl && page.url() !== conversationUrl) {
      await page.goto(conversationUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => {})
    }
    await page.waitForSelector("body", { timeout: 15_000 })
    await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 8_000 }).catch(() => {})

    const humanReason = await inspectGrokHumanBlocker(page)
    if (humanReason) {
      const recoveryOutputFile = outputFilePath(options.outputFile) ?? session?.outputPath ?? null
      const blockerReason = withGrokRecoveryStep(humanReason, session?.prompt ?? "", recoveryOutputFile)
      if (session) {
        await saveFrontendSession({
          blockerReason,
          conversationUrl,
          id: session.id,
          outputPath: recoveryOutputFile,
          projectKey: session.projectKey,
          projectUrl: session.projectUrl,
          prompt: session.prompt,
          provider,
          recoveryStep: buildGrokLoginRecoveryStep(session.prompt, recoveryOutputFile),
          responseText: session.responseText,
          title: session.title,
        })
      }
      throw new FrontendBrowserError({ reason: blockerReason })
    }

    const prompt = session?.prompt ?? ""
    const responseBaseline = options.waitForResponse === false
      ? ""
      : session?.responseText || await extractGrokResponse(page, prompt).catch(() => "")
    const responseText = options.waitForResponse === false
      ? await extractGrokResponse(page, prompt).catch(() => "")
      : await waitForGrokResponse(page, prompt, options.responseTimeoutMs ?? 120_000, responseBaseline)
    const running = await isGrokResponseRunning(page)
    const status = await readStatus({ ...options, provider: "grok" })
    const title = redactText(await page.title())
    const url = sanitizeUrl(page.url())
    const savedResponseText = responseText || session?.responseText || ""
    const outputFile = await writeOutputFile(options.outputFile ?? session?.outputPath ?? undefined, responseText)
    const saved = await saveFrontendSession({
      blockerReason: null,
      conversationUrl: url || conversationUrl,
      id: session?.id,
      outputPath: outputFile ?? session?.outputPath ?? null,
      projectKey: session?.projectKey ?? null,
      projectUrl: session?.projectUrl ?? null,
      prompt: session?.prompt ?? `Collected response from ${conversationUrl}`,
      provider,
      responseText: savedResponseText,
      recoveryStep: null,
      title,
    })

    return {
      ...status,
      conversationUrl: saved.conversationUrl,
      launched,
      outputFile,
      responseLength: responseText.length,
      responseText,
      running,
      selectedTab,
      sessionId: saved.id,
      title,
      url,
    }
  } finally {
    await browser.disconnect()
  }
}

async function collectChatGptResponse(options: FrontendCollectOptions): Promise<FrontendCollectResult> {
  const provider = options.provider ?? "chatgpt"
  if (provider !== "chatgpt") {
    throw new FrontendBrowserError({ reason: "Collect/wait currently supports provider=chatgpt only." })
  }

  const session = options.session
    ? await resolveFrontendSession(options.session, { project: options.project, provider })
    : null
  if (options.session && !session) {
    throw new FrontendBrowserError({ reason: `Stored session not found: ${options.session}` })
  }

  const conversationUrl = options.conversationUrl?.trim() || session?.conversationUrl?.trim()
  if (!conversationUrl) {
    throw new FrontendBrowserError({ reason: "conversationUrl or session is required for collect/wait." })
  }

  const { browser, launched, page, selectedTab } = await connectProviderPage({
    ...options,
    background: options.background ?? true,
    provider: "chatgpt",
  })

  try {
    const currentConversationKey = chatGptConversationKey(page.url())
    const requestedConversationKey = chatGptConversationKey(conversationUrl)
    if (!requestedConversationKey || currentConversationKey !== requestedConversationKey) {
      await page.goto(conversationUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => {})
    }
    await page.waitForSelector("body", { timeout: 15_000 })
    await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 8_000 }).catch(() => {})

    const prompt = session?.prompt ?? ""
    const responseBaseline = options.waitForResponse === false
      ? ""
      : session?.responseText || await extractChatGptResponse(page, prompt).catch(() => "")
    const responseText = options.waitForResponse === false
      ? await extractChatGptResponse(page, prompt).catch(() => "")
      : await waitForChatGptResponse(page, prompt, options.responseTimeoutMs ?? 120_000, responseBaseline)
    const running = await isChatGptResponseRunning(page)
    const status = await readStatus({ ...options, provider: "chatgpt" })
    const title = redactText(await page.title())
    const url = sanitizeUrl(page.url())
    const requestedConversation = isChatGptConversationUrl(conversationUrl)
    const landedConversation = isChatGptConversationUrl(url)
    if (requestedConversation && !landedConversation && !responseText) {
      throw new FrontendBrowserError({
        reason: `ChatGPT did not open the requested conversation. Landed on ${url || "unknown URL"}.`,
      })
    }

    const savedResponseText = responseText || session?.responseText || ""
    const outputFile = await writeOutputFile(options.outputFile ?? session?.outputPath ?? undefined, responseText)
    const saved = await saveFrontendSession({
      conversationUrl: landedConversation ? url : conversationUrl,
      id: session?.id,
      outputPath: outputFile ?? session?.outputPath ?? null,
      projectKey: session?.projectKey ?? null,
      projectUrl: session?.projectUrl ?? null,
      prompt: session?.prompt ?? `Collected response from ${conversationUrl}`,
      provider,
      responseText: savedResponseText,
      title,
    })

    return {
      ...status,
      conversationUrl: saved.conversationUrl,
      launched,
      outputFile,
      responseLength: responseText.length,
      responseText,
      running,
      selectedTab,
      sessionId: saved.id,
      title,
      url,
    }
  } finally {
    await browser.disconnect()
  }
}

async function collectProviderResponse(options: FrontendCollectOptions): Promise<FrontendCollectResult> {
  const provider = options.provider ?? "chatgpt"
  if (provider === "chatgpt") return await collectChatGptResponse(options)
  if (provider === "grok") return await collectGrokResponse(options)
  throw new FrontendBrowserError({ reason: "Collect/wait currently supports provider=chatgpt or provider=grok only." })
}

function isChatGptAuthUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname === "auth.openai.com"
      || (url.hostname === "accounts.google.com" && value.includes("auth.openai.com"))
  } catch {
    return false
  }
}

async function connectChatGptLoginPage(options: FrontendBrowserOptions) {
  const resolved = resolvedOptions({ ...options, provider: "chatgpt" })
  const launched = await launchBrowser({ ...options, provider: "chatgpt" })
  const puppeteer = await import("puppeteer-core")
  let browser = await puppeteer.connect({ browserURL: resolved.cdpUrl })
  let target = browser.targets().find((candidate) => candidate.type() === "page" && isChatGptAuthUrl(candidate.url()))

  if (!target) {
    await browser.disconnect()
    const providerPage = await connectProviderPage({
      ...options,
      background: options.background ?? true,
      provider: "chatgpt",
    })
    return { ...providerPage, launched: launched || providerPage.launched }
  }

  const page = await target.page()
  if (!page) {
    await browser.disconnect()
    throw new FrontendBrowserError({ reason: "Could not attach to ChatGPT auth tab." })
  }

  const status = await readStatus({ ...options, provider: "chatgpt" })
  const selectedTab = status.tabs.find((tab) => tab.id === puppeteerTargetId(target))
    ?? status.tabs.find((tab) => isChatGptAuthUrl(tab.url))
    ?? null
  return { browser, launched, page, selectedTab }
}

async function clickChatGptLoginStep(page: any, credential: GoogleCredential, clicked: string[]): Promise<boolean> {
  const currentUrl = page.url()

  const challenge = await page.evaluate(() => {
    const text = document.body?.innerText ?? ""
    if (/captcha|verification|2-step|two-step|passkey|security code|approve|cloudflare|checking your browser/i.test(text)) {
      return true
    }
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const visibleControls = Array.from(document.querySelectorAll("button, a, [role='button']")).filter(visible)
    const termsPrompt = visibleControls.some((el) => /accept|agree/i.test((el.textContent ?? "").trim()))
      && /terms of use|privacy policy/i.test(text)
    if (termsPrompt) {
      return true
    }
    return false
  }).catch(() => false)
  if (challenge) return false

  if (await typeInput(page, "input[type='email']", credential.email)) {
    const next = await clickTextByMouse(page, ["Next"])
    clicked.push(next ?? "email-enter")
    if (!next) await page.keyboard.press("Enter")
    return true
  }

  if (await typeInput(page, "input[type='password']", credential.password)) {
    const next = await clickTextByMouse(page, ["Next"])
    clicked.push(next ?? "password-enter")
    if (!next) await page.keyboard.press("Enter")
    return true
  }

  const accountChoice = await clickTextByMouse(page, [credential.email])
  if (accountChoice) {
    clicked.push("account-choice")
    return true
  }

  for (const labels of [
    ["Continue with Google", "Continue with Google Account", "Google"],
    ["Log in"],
    ["Continue", "Allow"],
    ["Not now", "Maybe later", "Skip", "Skip for now"],
  ]) {
    const clickedLabel = await clickTextByMouse(page, labels, { preferRight: labels.includes("Log in") })
    if (clickedLabel) {
      clicked.push(clickedLabel)
      return true
    }
  }

  return page.url() !== currentUrl
}

async function chatGptLogin(options: ChatGptLoginOptions): Promise<ChatGptLoginResult> {
  const credentialAccount = options.account?.trim() || "chatgpt-gmail"
  const credential = await readGoogleCredential(credentialAccount)
  const { browser, launched, page, selectedTab: initialSelectedTab } = await connectChatGptLoginPage({
    ...options,
    background: options.background ?? true,
    provider: "chatgpt",
  })
  const clicked: string[] = []

  try {
    await page.goto("https://chatgpt.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    }).catch(() => {})
    await page.waitForSelector("body", { timeout: 15_000 })
    await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 8_000 }).catch(() => {})

    let session = await inspectChatGptSession(page, false)
    for (let i = 0; i < 12 && !session.loggedIn && !session.needsHuman; i++) {
      const advanced = await clickChatGptLoginStep(page, credential, clicked)
      if (!advanced) break
      await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 10_000 }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 800))
      session = await inspectChatGptSession(page, false)
    }

    const status = await readStatus({ ...options, provider: "chatgpt" })
    const selectedTab = status.tabs.find((tab) => isProviderTab(tab, "chatgpt.com")) ?? null
    const humanReason = session.loggedIn ? null : session.humanReason ?? "ChatGPT login did not complete automatically."

    return {
      ...status,
      clicked,
      credentialAccount,
      humanReason,
      launched,
      loggedIn: session.loggedIn,
      needsHuman: !session.loggedIn,
      selectedTab: selectedTab ?? initialSelectedTab,
      title: redactText(session.title),
      url: sanitizeUrl(session.url),
    }
  } finally {
    await browser.disconnect()
  }
}

async function googleLogin(options: GoogleLoginOptions): Promise<GoogleLoginResult> {
  const credentialAccount = options.account?.trim() || "chatgpt-gmail"
  const launched = await launchBrowser(options)
  const resolved = resolvedOptions(options)
  const existing = await findExistingPage(options, "mail.google.com")
  if (existing) {
    try {
      const session = await inspectGmailSession(existing.page)
      if (session.loggedIn && session.hasInboxSurface && !session.needsHuman) {
        const status = await readStatus(options)
        const selectedTab = status.tabs.find((tab) => isProviderTab(tab, resolved.config.host))
          ?? null

        return {
          ...status,
          clicked: [],
          credentialAccount,
          hasInboxSurface: session.hasInboxSurface,
          launched,
          loggedIn: session.loggedIn,
          needsHuman: session.needsHuman,
          reusedTab: true,
          selectedTab,
          title: redactText(session.title),
          url: sanitizeUrl(session.url),
        }
      }
    } finally {
      await existing.browser.disconnect()
    }
  }

  const credential = await readGoogleCredential(credentialAccount)
  const loginUrl = "https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F"
  const { browser, page } = await createBackgroundPage(options, loginUrl)
  const clicked: string[] = []

  try {
    await page.goto(loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    }).catch(() => {})
    await page.waitForNetworkIdle({ idleTime: 750, timeout: 8_000 }).catch(() => {})
    await page.waitForSelector("body", { timeout: 15_000 })

    const accountChoice = await clickText(page, [credential.email])
    if (accountChoice) {
      clicked.push("account-choice")
      await page.waitForNetworkIdle({ idleTime: 750, timeout: 6_000 }).catch(() => {})
    }

    if (await typeInput(page, "input[type='email']", credential.email)) {
      const next = await clickText(page, ["Next"])
      if (next) clicked.push(next)
      else await page.keyboard.press("Enter")
      await page.waitForNetworkIdle({ idleTime: 750, timeout: 8_000 }).catch(() => {})
    }

    const alternate = await clickText(page, ["Try another way", "Enter your password", "Use your password"])
    if (alternate) {
      clicked.push(alternate)
      await page.waitForNetworkIdle({ idleTime: 750, timeout: 5_000 }).catch(() => {})
    }

    if (await typeInput(page, "input[type='password']", credential.password)) {
      const next = await clickText(page, ["Next"])
      if (next) clicked.push(next)
      else await page.keyboard.press("Enter")
      await page.waitForNetworkIdle({ idleTime: 750, timeout: 10_000 }).catch(() => {})
    }

    for (let i = 0; i < 5; i++) {
      const promptClick = await clickText(page, [
        "Skip",
        "Skip for now",
        "Not now",
        "Maybe later",
        "Continue",
        "Done",
        "Next",
      ])
      if (!promptClick) break
      clicked.push(promptClick)
      await page.waitForNetworkIdle({ idleTime: 750, timeout: 6_000 }).catch(() => {})
    }

    const session = await inspectGmailSession(page)
    const status = await readStatus(options)
    const selectedTab = status.tabs.find((tab) => isProviderTab(tab, resolved.config.host))
      ?? null

    return {
      ...status,
      clicked,
      credentialAccount,
      hasInboxSurface: session.hasInboxSurface,
      launched,
      loggedIn: session.loggedIn,
      needsHuman: session.needsHuman,
      reusedTab: false,
      selectedTab,
      title: redactText(session.title),
      url: sanitizeUrl(session.url),
    }
  } finally {
    await browser.disconnect()
  }
}

export const frontendBrowserStatus = Effect.fn("frontendBrowserStatus")(function* (
  options: FrontendBrowserOptions = {},
) {
  return yield* Effect.tryPromise({
    try: () => readStatus(options),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const googleLoginFrontendBrowser = Effect.fn("googleLoginFrontendBrowser")(function* (
  options: GoogleLoginOptions = {},
) {
  return yield* Effect.tryPromise({
    try: () => googleLogin(options),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const chatGptLoginFrontendBrowser = Effect.fn("chatGptLoginFrontendBrowser")(function* (
  options: ChatGptLoginOptions = {},
) {
  return yield* Effect.tryPromise({
    try: () => chatGptLogin(options),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const promptFrontendBrowser = Effect.fn("promptFrontendBrowser")(function* (
  options: FrontendPromptOptions,
) {
  return yield* Effect.tryPromise({
    try: () => promptProvider(options),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const collectFrontendBrowser = Effect.fn("collectFrontendBrowser")(function* (
  options: FrontendCollectOptions,
) {
  return yield* Effect.tryPromise({
    try: () => collectProviderResponse(options),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const frontendBrowserProjects = Effect.fn("frontendBrowserProjects")(function* (
  options: { provider?: FrontendProvider } = {},
) {
  return yield* Effect.tryPromise({
    try: () => listFrontendProjects(options.provider),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const frontendBrowserSessions = Effect.fn("frontendBrowserSessions")(function* (
  options: { limit?: number; project?: string; provider?: FrontendProvider } = {},
) {
  return yield* Effect.tryPromise({
    try: () => listFrontendSessions(options),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const saveFrontendBrowserProject = Effect.fn("saveFrontendBrowserProject")(function* (
  options: { key: string; provider?: FrontendProvider; title?: string; url: string },
) {
  return yield* Effect.tryPromise({
    try: () => saveFrontendProject({
      key: options.key,
      provider: options.provider ?? "chatgpt",
      title: options.title,
      url: options.url,
    }),
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})

export const setupFrontendBrowser = Effect.fn("setupFrontendBrowser")(function* (
  options: FrontendBrowserOptions = {},
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const launched = await launchBrowser(options)
      const selectedTab = await ensureProviderTab(options)
      const status = await readStatus(options)
      return { ...status, launched, selectedTab }
    },
    catch: (err) => err instanceof FrontendBrowserError
      ? err
      : new FrontendBrowserError({ reason: String(err) }),
  })
})
