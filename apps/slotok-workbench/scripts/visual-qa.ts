#!/usr/bin/env bun
import { chromium, type Browser, type Page } from "@playwright/test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const currentFile = fileURLToPath(import.meta.url)
const appRoot = resolve(dirname(currentFile), "..")
const repoRoot = resolve(appRoot, "../..")
const artifactRoot = resolve(repoRoot, "artifacts/slotok-visual-qa/latest")
const reportPath = resolve(repoRoot, "docs/qa/slotok-visual-qa.md")
const appUrl = "http://127.0.0.1:47521"
const ugcUrl = `${appUrl}/ugc-studio/`
const daemonUrl = "http://127.0.0.1:47522"
const bunExecutable = process.execPath

type FindingStatus = "pass" | "fail" | "warn"

interface Finding {
  status: FindingStatus
  title: string
  detail: string
}

interface ViewAudit {
  commandBarVisible: boolean
  inspectorVisible: boolean
  overflowX: boolean
  title: string
  view: string
}

const processes: Array<ReturnType<typeof Bun.spawn>> = []

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(artifactRoot, { recursive: true })
await mkdir(dirname(reportPath), { recursive: true })

try {
  await startDaemon()
  await startRenderer()
  const browser = await launchBrowser()
  try {
    const page = await newPage(browser, 1280, 720)
    await page.goto(ugcUrl, { waitUntil: "load" })
    await page.waitForSelector("[data-ugc-studio-root]", { timeout: 20_000 })

    const findings: Finding[] = []
    const screenshots: string[] = []

    await captureView(page, "01-persona-atlas.png", screenshots)
    findings.push(...viewFindings(await auditView(page), "Persona Atlas"))

    for (const view of [
      ["Exploration Board", "02-exploration-board.png"],
      ["Batch Review", "03-batch-review.png"],
      ["Campaign Branch Map", "04-campaign-map.png"],
      ["Reference Archive", "05-reference-archive.png"],
      ["Final Layer Editor", "06-final-editor.png"],
      ["Developer Graph", "07-developer-graph.png"],
      ["KIE Proxy", "08-kie-proxy.png"],
    ] as const) {
      await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(view[0])}\\b`) }).click()
      await page.waitForTimeout(100)
      await captureView(page, view[1], screenshots)
      findings.push(...viewFindings(await auditView(page), view[0]))
    }

    await writeReport(findings, screenshots)
    printSummary(findings)
  } finally {
    await browser.close()
  }
} finally {
  for (const child of processes.reverse()) child.kill()
}

async function startRenderer(): Promise<void> {
  if (!await isUrlReady(ugcUrl)) {
    const vite = Bun.spawn([bunExecutable, "run", "dev:renderer"], {
      cwd: appRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    processes.push(vite)
    drain(vite.stdout)
    drain(vite.stderr)
  }
  await waitForUrl(ugcUrl, "renderer")
}

async function startDaemon(): Promise<void> {
  if (!await isUrlReady(`${daemonUrl}/api/health`)) {
    const daemon = Bun.spawn([bunExecutable, "src/daemon/server.ts"], {
      cwd: appRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    processes.push(daemon)
    drain(daemon.stdout)
    drain(daemon.stderr)
  }
  await waitForUrl(`${daemonUrl}/api/health`, "daemon")
}

async function isUrlReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

function drain(stream: ReadableStream<Uint8Array> | null): void {
  if (!stream) return
  void (async () => {
    for await (const _chunk of stream) {
      // Drain only; the markdown report is the artifact.
    }
  })()
}

async function waitForUrl(url: string, label: string): Promise<void> {
  const started = performance.now()
  while (performance.now() - started < 30_000) {
    if (await isUrlReady(url)) return
    await Bun.sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}: ${url}`)
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true })
  } catch {
    return await chromium.launch({ headless: true })
  }
}

async function newPage(browser: Browser, width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } })
  page.setDefaultTimeout(10_000)
  return page
}

async function captureView(page: Page, name: string, screenshots: string[]): Promise<void> {
  await page.screenshot({ path: screenshotPath(name), fullPage: true })
  screenshots.push(name)
}

async function auditView(page: Page): Promise<ViewAudit> {
  return page.evaluate(() => ({
    commandBarVisible: Boolean(document.querySelector("[data-ugc-command-surface]")),
    inspectorVisible: Boolean(document.querySelector("[data-ugc-inspector]")),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    title: document.title,
    view: document.querySelector("[data-ugc-view-title]")?.textContent?.trim() ?? "",
  }))
}

function viewFindings(audit: ViewAudit, expectedView: string): Finding[] {
  return [
    finding(audit.title === "Slotok Workbench", `${expectedView}: app title loads`, `title=${audit.title}`),
    finding(audit.view === expectedView, `${expectedView}: view activates`, `view=${audit.view}`),
    finding(audit.commandBarVisible, `${expectedView}: command bar remains visible`, `commandBar=${audit.commandBarVisible}`),
    finding(audit.inspectorVisible, `${expectedView}: inspector remains visible`, `inspector=${audit.inspectorVisible}`),
    finding(!audit.overflowX, `${expectedView}: no document horizontal overflow`, `overflowX=${audit.overflowX}`),
  ]
}

function finding(condition: boolean, title: string, detail: string): Finding {
  return { status: condition ? "pass" : "fail", title, detail }
}

function screenshotPath(name: string): string {
  return join(artifactRoot, name)
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
async function writeReport(findings: Finding[], screenshots: string[]): Promise<void> {
  const lines = [
    "# Slotok Visual QA",
    "",
    "Generated by `cd apps/slotok-workbench && bun run visual:qa` using headless Playwright/Chromium.",
    "",
    `Maintained UGC Studio route: \`${ugcUrl}\``,
    `Local daemon checked at: \`${daemonUrl}/api/health\``,
    "",
    "## Screenshot Artifacts",
    "",
    ...screenshots.map((name) => `- \`${relative(repoRoot, join(artifactRoot, name))}\``),
    "",
    "## Findings",
    "",
    ...findings.map((item) => `- ${icon(item.status)} **${item.title}** - ${item.detail}`),
    "",
  ]
  await writeFile(reportPath, `${lines.join("\n")}\n`)
}

function icon(status: FindingStatus): string {
  if (status === "pass") return "PASS"
  if (status === "warn") return "WARN"
  return "FAIL"
}

function printSummary(findings: Finding[]): void {
  const failed = findings.filter((finding) => finding.status === "fail")
  console.log(`visual QA: ${findings.length - failed.length}/${findings.length} passed`)
  if (failed.length > 0) {
    for (const item of failed) console.error(`FAIL: ${item.title} - ${item.detail}`)
    process.exitCode = 1
  }
}
