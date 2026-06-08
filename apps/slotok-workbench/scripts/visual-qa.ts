#!/usr/bin/env bun
import { chromium, type Browser, type Page } from "@playwright/test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const currentFile = fileURLToPath(import.meta.url)
const appRoot = resolve(dirname(currentFile), "..")
const repoRoot = resolve(appRoot, "../..")
const artifactRoot = resolve(repoRoot, "artifacts/slotok-visual-qa/latest")
const reportPath = resolve(repoRoot, "docs/qa/slotok-visual-qa.md")
const appUrl = "http://127.0.0.1:47521"
const solidUrl = `${appUrl}/solid/`
const daemonUrl = "http://127.0.0.1:47522/api/health"

type FindingStatus = "pass" | "fail" | "warn"

interface Finding {
  status: FindingStatus
  title: string
  detail: string
}

interface RectRecord {
  x: number
  y: number
  width: number
  height: number
}

interface LayoutAudit {
  viewportWidth: number
  viewportHeight: number
  documentOverflowX: number
  video: RectRecord
  primaryMedia: RectRecord
  primaryData: RectRecord
  queue: RectRecord
  inspector: RectRecord
  jsonTree: RectRecord
  videoControls: boolean
  videoSrc: string
  queueItems: number
  jsonTextLength: number
  bodyTextHasArtificialEllipsis: boolean
}

const processes: Array<ReturnType<typeof Bun.spawn>> = []

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(artifactRoot, { recursive: true })
await mkdir(dirname(reportPath), { recursive: true })

try {
  await startServers()
  const browser = await launchBrowser()
  try {
    const findings: Finding[] = []
    const screenshots: string[] = []

    const desktop = await newPage(browser, 1440, 960)
    await desktop.goto(solidUrl, { waitUntil: "networkidle" })
    await desktop.waitForSelector(".review-canvas", { timeout: 20_000 })
    await desktop.screenshot({ path: screenshotPath("01-solid-review-canvas-1440.png"), fullPage: true })
    screenshots.push("01-solid-review-canvas-1440.png")

    const reviewAudit = await auditLayout(desktop)
    findings.push(...reviewFindings(reviewAudit, "Solid review canvas @ 1440×960"))

    await desktop.locator(".primary-media").screenshot({ path: screenshotPath("02-primary-media.png") })
    screenshots.push("02-primary-media.png")

    await desktop.keyboard.press("g")
    await desktop.keyboard.press("j")
    await desktop.waitForTimeout(100)
    await desktop.locator(".primary-data").screenshot({ path: screenshotPath("03-json-tree.png") })
    screenshots.push("03-json-tree.png")
    const jsonAudit = await auditLayout(desktop)
    findings.push(...jsonFindings(jsonAudit))

    await desktop.keyboard.press("j")
    await desktop.waitForTimeout(150)
    await desktop.screenshot({ path: screenshotPath("04-second-element-json.png"), fullPage: true })
    screenshots.push("04-second-element-json.png")
    findings.push(...selectionFindings(await auditLayout(desktop)))

    const narrow = await newPage(browser, 1280, 900)
    await narrow.goto(solidUrl, { waitUntil: "networkidle" })
    await narrow.waitForSelector(".review-canvas", { timeout: 20_000 })
    await narrow.screenshot({ path: screenshotPath("05-solid-review-canvas-1280.png"), fullPage: true })
    screenshots.push("05-solid-review-canvas-1280.png")
    findings.push(...reviewFindings(await auditLayout(narrow), "Solid review canvas @ 1280×900"))

    const prototype = await newPage(browser, 1440, 960)
    await prototype.goto(`${appUrl}/design-lab/react-shadcn-tailwind.html`, { waitUntil: "networkidle" })
    await prototype.screenshot({ path: screenshotPath("06-react-shadcn-tailwind-prototype.png"), fullPage: true })
    screenshots.push("06-react-shadcn-tailwind-prototype.png")
    findings.push(...prototypeFindings(await auditPrototype(prototype)))

    await writeReport(findings, screenshots)
    printSummary(findings)
  } finally {
    await browser.close()
  }
} finally {
  for (const child of processes.reverse()) child.kill()
}

async function startServers(): Promise<void> {
  if (!await isUrlReady(daemonUrl)) {
    const daemon = Bun.spawn(["bun", "src/daemon/server.ts"], {
      cwd: appRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    processes.push(daemon)
    drain(daemon.stdout)
    drain(daemon.stderr)
  }
  await waitForUrl(daemonUrl, "daemon")

  if (!await isUrlReady(appUrl)) {
    const vite = Bun.spawn(["bun", "run", "dev:renderer"], {
      cwd: appRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    processes.push(vite)
    drain(vite.stdout)
    drain(vite.stderr)
  }
  await waitForUrl(solidUrl, "renderer")
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
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Retry until timeout.
    }
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
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(10_000)
  return page
}

async function auditLayout(page: Page): Promise<LayoutAudit> {
  return await page.evaluate(() => {
    function rect(selector: string): RectRecord {
      const node = document.querySelector(selector)
      if (!node) return { x: 0, y: 0, width: 0, height: 0 }
      const box = node.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }

    const video = document.querySelector("video.review-video") as HTMLVideoElement | null
    const jsonTree = document.querySelector(".json-tree")
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      video: rect("video.review-video"),
      primaryMedia: rect(".primary-media"),
      primaryData: rect(".primary-data"),
      queue: rect(".element-queue"),
      inspector: rect(".inspector-panel"),
      jsonTree: rect(".json-tree"),
      videoControls: Boolean(video?.controls),
      videoSrc: video?.currentSrc || video?.src || "",
      queueItems: document.querySelectorAll(".queue-item").length,
      jsonTextLength: jsonTree?.textContent?.length ?? 0,
      bodyTextHasArtificialEllipsis: document.body.textContent?.includes("…") ?? false,
    }
  })
}

async function auditPrototype(page: Page): Promise<{ cards: number; mediaWidth: number; queueHeight: number; title: string }> {
  return await page.evaluate(() => {
    const media = document.querySelector("[data-qa='prototype-media']")?.getBoundingClientRect()
    const queue = document.querySelector("[data-qa='prototype-queue']")?.getBoundingClientRect()
    return {
      cards: document.querySelectorAll("[data-qa='prototype-card']").length,
      mediaWidth: media?.width ?? 0,
      queueHeight: queue?.height ?? 0,
      title: document.title,
    }
  })
}

function reviewFindings(audit: LayoutAudit, label: string): Finding[] {
  const minMediaWidth = audit.viewportWidth * 0.38
  const maxQueueHeight = audit.viewportHeight * 0.16
  const maxInspectorWidth = audit.viewportWidth * 0.24
  return [
    finding(audit.documentOverflowX <= 2, `${label}: no horizontal overflow`, `overflowX=${audit.documentOverflowX}px`),
    finding(audit.videoControls, `${label}: selected video is playable`, `controls=${audit.videoControls}; src=${audit.videoSrc}`),
    finding(audit.video.width >= minMediaWidth, `${label}: video dominates center`, `video=${size(audit.video)}; expected width >= ${Math.round(minMediaWidth)}px`),
    finding(audit.primaryMedia.height >= audit.viewportHeight * 0.5, `${label}: media area is tall enough`, `media=${size(audit.primaryMedia)}`),
    finding(audit.queue.height <= maxQueueHeight, `${label}: element queue stays compact`, `queue=${size(audit.queue)}; max=${Math.round(maxQueueHeight)}px`),
    finding(audit.inspector.width <= maxInspectorWidth, `${label}: inspector does not dominate`, `inspector=${size(audit.inspector)}; max=${Math.round(maxInspectorWidth)}px`),
    finding(audit.queueItems > 0, `${label}: element queue is present`, `queueItems=${audit.queueItems}`),
  ]
}

function jsonFindings(audit: LayoutAudit): Finding[] {
  return [
    finding(audit.jsonTree.width > 250 && audit.jsonTree.height > 250, "JSON view uses formatted tree", `jsonTree=${size(audit.jsonTree)}`),
    finding(audit.jsonTextLength > 200, "JSON view has substantial readable content", `textLength=${audit.jsonTextLength}`),
    finding(!audit.bodyTextHasArtificialEllipsis, "UI is not adding artificial truncation ellipsis", `containsEllipsis=${audit.bodyTextHasArtificialEllipsis}`),
  ]
}

function selectionFindings(audit: LayoutAudit): Finding[] {
  return [
    finding(audit.queueItems >= 2, "Can flip to another element in the queue", `queueItems=${audit.queueItems}`),
    finding(audit.videoControls, "Video remains playable after selection changes", `controls=${audit.videoControls}`),
  ]
}

function prototypeFindings(audit: { cards: number; mediaWidth: number; queueHeight: number; title: string }): Finding[] {
  return [
    finding(audit.title.includes("shadcn"), "React/shadcn/Tailwind prototype endpoint loads", `title=${audit.title}`),
    finding(audit.mediaWidth > 520, "Prototype also prioritizes primary media", `mediaWidth=${Math.round(audit.mediaWidth)}px`),
    finding(audit.queueHeight < 130, "Prototype queue is compact", `queueHeight=${Math.round(audit.queueHeight)}px`),
    finding(audit.cards >= 3, "Prototype includes comparison cards", `cards=${audit.cards}`),
  ]
}

function finding(condition: boolean, title: string, detail: string): Finding {
  return { status: condition ? "pass" : "fail", title, detail }
}

function size(rect: RectRecord): string {
  return `${Math.round(rect.width)}×${Math.round(rect.height)}`
}

function screenshotPath(name: string): string {
  return join(artifactRoot, name)
}

async function writeReport(findings: Finding[], screenshots: string[]): Promise<void> {
  const lines = [
    "# Slotok Visual QA",
    "",
    "Generated by `cd apps/slotok-workbench && bun run visual:qa` using headless Playwright/Chromium.",
    "",
    `SolidJS app route: \`${solidUrl}\``,
    `React/shadcn/Tailwind design-lab route: \`${appUrl}/design-lab/react-shadcn-tailwind.html\``,
    "",
    "## Current UX rule",
    "",
    "The center is a review canvas. The selected video/data must dominate; sidebars and queues are supporting context only.",
    "",
    "## Screenshot artifacts",
    "",
    ...screenshots.map((name) => `- \`${relative(repoRoot, join(artifactRoot, name))}\``),
    "",
    "## Findings",
    "",
    ...findings.map((item) => `- ${icon(item.status)} **${item.title}** — ${item.detail}`),
    "",
    "## Manual visual checklist for future passes",
    "",
    "- Video must be playable and obvious without hunting for controls.",
    "- JSON/raw provider data must be readable, formatted, and not artificially truncated.",
    "- Element navigation must stay compact; never a huge stacked table unless explicitly in a table view.",
    "- Cache hits, paths, tokens, cost, and latency belong in inspector/metadata, not as central hero content.",
    "- At 1280px and 1440px widths, the primary media/output area should still be the largest thing on screen.",
    "- If a visual QA screenshot looks like a dashboard, the layout failed.",
    "",
  ]
  await writeFile(reportPath, `${lines.join("\n")}\n`)
}

function icon(status: FindingStatus): string {
  if (status === "pass") return "✅"
  if (status === "warn") return "⚠️"
  return "❌"
}

function printSummary(findings: Finding[]): void {
  const failCount = findings.filter((item) => item.status === "fail").length
  const passCount = findings.filter((item) => item.status === "pass").length
  console.log(`visual qa: ${passCount} pass, ${failCount} fail`)
  console.log(`report: ${relative(repoRoot, reportPath)}`)
  console.log(`screenshots: ${relative(repoRoot, artifactRoot)}`)
  if (failCount > 0) process.exitCode = 1
}
