#!/usr/bin/env bun
import { chromium, type Browser, type Page } from "@playwright/test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { JsonValue } from "../src/renderer/ugcStudioModel"

const currentFile = fileURLToPath(import.meta.url)
const appRoot = resolve(dirname(currentFile), "..")
const repoRoot = resolve(appRoot, "../..")
const artifactRoot = resolve(repoRoot, "artifacts/slotok-visual-qa/latest")
const visualWorkspaceRoot = resolve(artifactRoot, "workspace")
const reportPath = resolve(repoRoot, "docs/qa/slotok-visual-qa.md")
const rendererPort = portFromEnv("SLOTOK_VISUAL_QA_RENDERER_PORT", 48_521)
const daemonPort = portFromEnv("SLOTOK_VISUAL_QA_DAEMON_PORT", 48_522)
const appUrl = `http://127.0.0.1:${rendererPort}`
const ugcUrl = `${appUrl}/ugc-studio/`
const daemonUrl = `http://127.0.0.1:${daemonPort}`
const rendererDaemonUrl = "http://127.0.0.1:47522"
const reuseServers = booleanEnv("SLOTOK_VISUAL_QA_REUSE_SERVERS")
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
  bodyOverflowY: boolean
  rootHeight: number
  viewportHeight: number
  stageLocalScroll: boolean
  inspectorLocalScroll: boolean
  title: string
  view: string
  placeholderHits: string[]
  fakeTopRightHits: string[]
}

interface ManagedProcess {
  label: string
  child: ReturnType<typeof Bun.spawn>
  exitCode: number | null
  logs: string[]
}

interface JsonResponse {
  ok: boolean
  status: number
  payload: JsonValue | null
}

interface ReferenceSeedAudit {
  responseOk: boolean
  status: number
  valid: boolean
  imported: boolean
  videosPlanned: number
  assetsPlanned: number
  referenceProfileIds: readonly string[]
  warnings: readonly string[]
  errors: readonly string[]
}

interface CoreLoopAudit {
  launcherVisible: boolean
  uiRunVisible: boolean
  runId: string
  runLane: string
  runStatus: string
  runPhase: string
  eventTypes: readonly string[]
  providerOperation: string
  providerMode: string
  providerStatus: string
  error: string | null
}

const PLACEHOLDER_LABELS = ["Summer Skincare", "Hydration Boost", "Coffee Brand", "Archived"] as const
const FAKE_TOP_RIGHT_LABELS = ["Notifications", "History", "Arthur", "Preview", "Export"] as const
const QA_VIEWS = [
  ["Exploration Board", "02-exploration-board.png"],
  ["Batch Review", "03-batch-review.png"],
  ["Campaign Branch Map", "04-campaign-map.png"],
  ["Reference Archive", "05-reference-archive.png"],
  ["Final Layer Editor", "06-final-editor.png"],
  ["Developer Graph", "07-developer-graph.png"],
  ["KIE Proxy", "08-kie-proxy.png"],
] as const
const REFERENCE_CATALOG_ROOTS = [
  "data/tiktok-catalogue/pleometric",
  "data/tiktok-catalogue/mynameissico",
] as const
const REFERENCE_ASSET_MANIFESTS = [
  "data/ugc-studio/reference-assets/higgsfield/manifest.json",
  "data/ugc-studio/reference-assets/arcads/manifest.json",
] as const

const processes: ManagedProcess[] = []

if (!reuseServers) await rm(artifactRoot, { recursive: true, force: true })
await mkdir(visualWorkspaceRoot, { recursive: true })
await mkdir(dirname(reportPath), { recursive: true })

try {
  printConfig()
  await writeReferenceFixtures()
  await startDaemon()
  const referenceSeed = await seedReferenceInputs()
  await startRenderer()
  const browser = await launchBrowser()
  try {
    const page = await newPage(browser, 1280, 720)
    await page.goto(ugcUrl, { waitUntil: "load" })
    await page.waitForSelector("[data-ugc-studio-root]", { timeout: 20_000 })

    const findings: Finding[] = []
    const screenshots: string[] = []
    let coreLoop: CoreLoopAudit | null = null

    findings.push(...referenceSeedFindings(referenceSeed))

    await captureView(page, "01-persona-atlas.png", screenshots)
    findings.push(...viewFindings(await auditView(page), "Persona Atlas"))

    for (const view of QA_VIEWS) {
      await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(view[0])}\\b`) }).click()
      await page.waitForTimeout(100)
      if (view[0] === "Developer Graph") coreLoop = await exerciseCoreLoop(page)
      await captureView(page, view[1], screenshots)
      findings.push(...viewFindings(await auditView(page), view[0]))
    }

    findings.push(...coreLoopFindings(coreLoop))
    findings.push(...await auditResponsiveViewport(browser, 1024, 768, "tablet"))
    findings.push(...await auditMobileViewport(browser, 390, 844, "mobile"))
    await writeReport(findings, screenshots)
    printSummary(findings)
  } finally {
    await browser.close()
  }
} finally {
  for (const managed of processes.reverse()) managed.child.kill()
}

function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) throw new Error(`${name} must be a TCP port, got ${raw}`)
  return value
}

function booleanEnv(name: string): boolean {
  const raw = process.env[name]
  return raw === "1" || raw?.toLowerCase() === "true"
}

function printConfig(): void {
  console.log("visual QA config:")
  console.log(`- renderer: ${ugcUrl}`)
  console.log(`- daemon: ${daemonUrl}/api/health`)
  console.log(`- isolated daemon cwd: ${visualWorkspaceRoot}`)
  console.log(`- fresh-owned ports by default; set SLOTOK_VISUAL_QA_REUSE_SERVERS=1 to use already-running QA servers intentionally`)
  if (daemonUrl !== rendererDaemonUrl) {
    console.log(`- browser daemon calls to ${rendererDaemonUrl} are proxied to ${daemonUrl} for this Playwright session`)
  }
}

async function startRenderer(): Promise<void> {
  if (await isUrlReady(ugcUrl)) {
    if (!reuseServers) throw new Error(`Renderer is already responding at ${ugcUrl}. Stop it, choose SLOTOK_VISUAL_QA_RENDERER_PORT, or set SLOTOK_VISUAL_QA_REUSE_SERVERS=1 to reuse intentionally.`)
    console.log(`visual QA: reusing renderer at ${ugcUrl}`)
    return
  }
  const vite = spawnManaged("renderer", [bunExecutable, "run", "dev:renderer:qa"], appRoot)
  await waitForUrl(ugcUrl, "renderer", vite)
}

async function startDaemon(): Promise<void> {
  const healthUrl = `${daemonUrl}/api/health`
  if (await isUrlReady(healthUrl)) {
    if (!reuseServers) throw new Error(`Daemon is already responding at ${healthUrl}. Stop it, choose SLOTOK_VISUAL_QA_DAEMON_PORT, or set SLOTOK_VISUAL_QA_REUSE_SERVERS=1 to reuse intentionally.`)
    console.log(`visual QA: reusing daemon at ${healthUrl}`)
    return
  }
  const daemon = spawnManaged("daemon", [bunExecutable, "src/daemon/server.ts", "--port", String(daemonPort), "--cwd", visualWorkspaceRoot], appRoot)
  await waitForUrl(healthUrl, "daemon", daemon)
}

function spawnManaged(label: string, args: readonly string[], cwd: string): ManagedProcess {
  const child = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const managed: ManagedProcess = { label, child, exitCode: null, logs: [] }
  processes.push(managed)
  collectOutput(managed, "stdout", child.stdout)
  collectOutput(managed, "stderr", child.stderr)
  void child.exited.then((exitCode) => {
    managed.exitCode = exitCode
  }).catch(() => {
    managed.exitCode = -1
  })
  return managed
}

async function isUrlReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

function collectOutput(managed: ManagedProcess, streamName: "stdout" | "stderr", stream: ReadableStream<Uint8Array> | null): void {
  if (!stream) return
  const decoder = new TextDecoder()
  void (async () => {
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true })
      for (const line of text.split(/\r?\n/g)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        managed.logs.push(`${streamName}: ${trimmed}`)
        if (managed.logs.length > 40) managed.logs.shift()
      }
    }
  })()
}

async function waitForUrl(url: string, label: string, managed: ManagedProcess): Promise<void> {
  const started = performance.now()
  while (performance.now() - started < 30_000) {
    if (managed.exitCode !== null) throw new Error(`${label} exited before becoming ready at ${url}.\n${processDiagnostics()}`)
    if (await isUrlReady(url)) return
    await Bun.sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}: ${url}\n${processDiagnostics()}`)
}

function processDiagnostics(): string {
  if (processes.length === 0) return "No managed process logs were captured."
  return processes.map((managed) => {
    const exit = managed.exitCode === null ? "running" : `exited ${managed.exitCode}`
    const logs = managed.logs.length ? managed.logs.map((line) => `    ${line}`).join("\n") : "    no output captured"
    return `  ${managed.label} (${exit})\n${logs}`
  }).join("\n")
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
  if (daemonUrl !== rendererDaemonUrl) {
    await page.route(`${rendererDaemonUrl}/**`, async (route) => {
      const source = new URL(route.request().url())
      if (source.pathname === "/api/ugc/workflows/events/stream") {
        await route.abort("blockedbyclient")
        return
      }
      const response = await route.fetch({ url: `${daemonUrl}${source.pathname}${source.search}` })
      await route.fulfill({ response })
    })
  }
  return page
}

async function captureView(page: Page, name: string, screenshots: string[]): Promise<void> {
  await page.screenshot({ path: screenshotPath(name), fullPage: true })
  screenshots.push(name)
}

async function auditView(page: Page): Promise<ViewAudit> {
  return page.evaluate(
    ([placeholderDenylist, fakeTopRightDenylist]) => {
      const bodyTextNodes: string[] = []
      const bodyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
      while (bodyWalker.nextNode()) {
        const text = bodyWalker.currentNode.textContent?.trim()
        if (text) bodyTextNodes.push(text)
      }

      const header = document.querySelector("header")
      const topRightLabels: string[] = []
      if (header) {
        header.querySelectorAll("button, a, input, [aria-label]").forEach((el) => {
          const text = el.textContent?.trim()
          const aria = el.getAttribute("aria-label")
          const placeholder = (el as HTMLInputElement).placeholder?.trim()
          if (text) topRightLabels.push(text)
          if (aria) topRightLabels.push(aria)
          if (placeholder) topRightLabels.push(placeholder)
        })
      }

      const placeholderHits = placeholderDenylist.filter((label) => bodyTextNodes.some((node) => node.includes(label)))
      const fakeTopRightHits = fakeTopRightDenylist.filter((label) => topRightLabels.some((node) => node.includes(label)))

      const stage = document.querySelector(".rugc-stage")
      const inspector = document.querySelector("[data-ugc-inspector]")
      const root = document.querySelector("[data-ugc-studio-root]")
      return {
        commandBarVisible: Boolean(document.querySelector("[data-ugc-command-surface]")),
        inspectorVisible: Boolean(inspector),
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        bodyOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
        rootHeight: Math.round(root?.getBoundingClientRect().height ?? 0),
        viewportHeight: window.innerHeight,
        stageLocalScroll: Boolean(stage && stage.scrollHeight >= stage.clientHeight && getComputedStyle(stage).overflowY !== "visible"),
        inspectorLocalScroll: Boolean(inspector && inspector.scrollHeight >= inspector.clientHeight && getComputedStyle(inspector).overflowY !== "visible"),
        title: document.title,
        view: document.querySelector("[data-ugc-view-title]")?.textContent?.trim() ?? "",
        placeholderHits,
        fakeTopRightHits,
      }
    },
    [PLACEHOLDER_LABELS, FAKE_TOP_RIGHT_LABELS],
  )
}

async function auditResponsiveViewport(browser: Browser, width: number, height: number, label: string): Promise<readonly Finding[]> {
  const page = await newPage(browser, width, height)
  try {
    await page.goto(ugcUrl, { waitUntil: "load" })
    await page.waitForSelector("[data-ugc-studio-root]", { timeout: 20_000 })
    const findings: Finding[] = []
    findings.push(...responsiveViewFindings(await auditView(page), "Persona Atlas", label))
    for (const view of QA_VIEWS) {
      await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(view[0])}\\b`) }).click()
      await page.waitForTimeout(50)
      findings.push(...responsiveViewFindings(await auditView(page), view[0], label))
    }
    return findings
  } finally {
    await page.close()
  }
}

async function auditMobileViewport(browser: Browser, width: number, height: number, label: string): Promise<readonly Finding[]> {
  const page = await newPage(browser, width, height)
  try {
    await page.goto(ugcUrl, { waitUntil: "load" })
    await page.waitForSelector("[data-ugc-studio-root]", { timeout: 20_000 })
    const findings: Finding[] = []
    findings.push(...mobileViewFindings(await auditView(page), "Persona Atlas", label))
    for (const view of QA_VIEWS) {
      await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(view[0])}\\b`) }).click()
      await page.waitForTimeout(50)
      findings.push(...mobileViewFindings(await auditView(page), view[0], label))
    }
    return findings
  } finally {
    await page.close()
  }
}

async function seedReferenceInputs(): Promise<ReferenceSeedAudit> {
  console.log("visual QA: seeding reference-only local catalogs and provider manifests")
  const response = await daemonJson("/api/ugc/reference-catalog/import", {
    roots: REFERENCE_CATALOG_ROOTS,
    manifestPaths: REFERENCE_ASSET_MANIFESTS,
  })
  const root = isRecord(response.payload) ? response.payload : {}
  return {
    responseOk: response.ok,
    status: response.status,
    valid: root.valid === true,
    imported: root.imported === true,
    videosPlanned: numberField(root.videosPlanned),
    assetsPlanned: numberField(root.assetsPlanned),
    referenceProfileIds: stringArray(root.referenceProfileIds),
    warnings: stringArray(root.warnings),
    errors: stringArray(root.errors),
  }
}

async function writeReferenceFixtures(): Promise<void> {
  for (const root of REFERENCE_CATALOG_ROOTS) {
    const absoluteRoot = resolve(visualWorkspaceRoot, root)
    await mkdir(absoluteRoot, { recursive: true })
    await writeReferenceCatalogVideo(absoluteRoot, "2026-06-19_1000000000000000001", "1000000000000000001")
  }
  await writeProviderManifest("higgsfield", REFERENCE_ASSET_MANIFESTS[0], "https://higgsfield.ai/supercomputer", "higgsfield-demo.mp4")
  await writeProviderManifest("arcads", REFERENCE_ASSET_MANIFESTS[1], "https://www.arcads.ai/", "arcads-demo.mp4")
}

async function writeReferenceCatalogVideo(root: string, stem: string, id: string): Promise<void> {
  await writeFile(resolve(root, `${stem}.info.json`), `${JSON.stringify({
    id,
    title: `Visual QA reference video ${id}`,
    uploader: "Visual QA fixture",
    uploader_id: root.includes("mynameissico") ? "mynameissico" : "pleometric",
    duration: 12.5,
    view_count: 1200,
    like_count: 45,
    comment_count: 6,
    share_count: 3,
    save_count: 2,
    webpage_url: `https://www.tiktok.com/@fixture/video/${id}`,
    http_headers: { Cookie: "redacted fixture header must not persist" },
    formats: [{ url: `https://cdn.example/${id}.mp4`, cookies: "redacted fixture cookie must not persist" }],
  })}\n`)
  await writeFile(resolve(root, `${stem}.jpg`), "visual qa poster fixture")
  await writeFile(resolve(root, `${stem}.mp4`), "visual qa video fixture")
}

async function writeProviderManifest(provider: "higgsfield" | "arcads", manifestPath: string, sourcePageUrl: string, local: string): Promise<void> {
  const absoluteManifestPath = resolve(visualWorkspaceRoot, manifestPath)
  await mkdir(dirname(absoluteManifestPath), { recursive: true })
  await writeFile(absoluteManifestPath, `${JSON.stringify({
    provider,
    captureTimestamp: "2026-06-19T00:00:00.000Z",
    manifestPath,
    sourcePages: [sourcePageUrl],
    rightsSummary: `Public ${provider} visual QA fixture for reference/inspiration only; no rights grant.`,
    useGuidance: "Metadata only; not a direct generation input.",
    assets: [{
      id: `${provider}-visual-demo`,
      title: `${provider} visual demo`,
      assetUrl: `${sourcePageUrl.replace(/\/$/, "")}/demo.mp4`,
      local,
      mediaType: "video/mp4",
      sourcePageUrl,
      bytes: 123,
      sha256: `${provider}-visual-fixture-sha`,
      rights: "Public fixture; reference-only.",
      provenance: "Created by visual QA as a metadata-only public reference fixture.",
    }],
  })}\n`)
}

async function exerciseCoreLoop(page: Page): Promise<CoreLoopAudit> {
  try {
    const beforeRunIds = await workflowRunIds()
    await page.getByText("Deterministic local demo workflow launcher").waitFor({ timeout: 10_000 })
    await page.getByRole("button", { name: /Run brainrot demo/ }).click()
    const run = await waitForDemoRun(beforeRunIds)
    await page.getByRole("button", { name: /Refresh/ }).click()
    const eventTypes = await fetchWorkflowEventTypes(stringField(run.id))
    const workspaceResponse = await daemonJson("/api/ugc/workspace")
    const providerJob = findDemoProviderJob(workspaceResponse.payload)
    let uiRunVisible = true
    try {
      const visibleRunLabels = [stringField(run.title), stringField(run.scriptId), stringField(run.id), "workflow_demo_workflow"].filter(Boolean)
      await page.waitForFunction((labels) => labels.some((label) => document.body.textContent?.includes(label)), visibleRunLabels, { timeout: 10_000 })
    } catch {
      uiRunVisible = false
    }
    return {
      launcherVisible: true,
      uiRunVisible,
      runId: stringField(run.id),
      runLane: stringField(run.lane),
      runStatus: stringField(run.status),
      runPhase: stringField(run.currentPhase),
      eventTypes,
      providerOperation: stringField(providerJob?.operation),
      providerMode: stringField(providerJob?.mode),
      providerStatus: stringField(providerJob?.status),
      error: null,
    }
  } catch (error) {
    return {
      launcherVisible: false,
      uiRunVisible: false,
      runId: "",
      runLane: "",
      runStatus: "",
      runPhase: "",
      eventTypes: [],
      providerOperation: "",
      providerMode: "",
      providerStatus: "",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function daemonJson(path: string, body?: object): Promise<JsonResponse> {
  const response = await fetch(`${daemonUrl}${path}`, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : undefined)
  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    payload: text.trim() ? JSON.parse(text) as JsonValue : null,
  }
}

async function workflowRunIds(): Promise<Set<string>> {
  const response = await daemonJson("/api/ugc/workflows")
  const root = isRecord(response.payload) ? response.payload : {}
  return new Set(recordArray(root.workflowRuns).map((run) => stringField(run.id)).filter(Boolean))
}

async function waitForDemoRun(beforeRunIds: ReadonlySet<string>): Promise<Record<string, JsonValue>> {
  const started = performance.now()
  while (performance.now() - started < 15_000) {
    const response = await daemonJson("/api/ugc/workflows")
    const root = isRecord(response.payload) ? response.payload : {}
    const run = recordArray(root.workflowRuns).find((item) => (
      !beforeRunIds.has(stringField(item.id))
      && stringField(item.lane) === "brainrot"
      && stringField(item.title).includes("Demo brainrot workflow")
    ))
    if (run && stringField(run.status) === "succeeded" && stringField(run.currentPhase) === "completed") return run
    await Bun.sleep(250)
  }
  throw new Error("Timed out waiting for a new succeeded brainrot demo workflow run")
}

function findDemoProviderJob(payload: JsonValue | null): Record<string, JsonValue> | null {
  const root = isRecord(payload) ? payload : {}
  return recordArray(root.providerJobs).find((job) => stringField(job.operation) === "demo-brainrot-local-plan") ?? null
}

async function fetchWorkflowEventTypes(runId: string): Promise<readonly string[]> {
  if (!runId) return []
  const response = await daemonJson(`/api/ugc/workflows/${encodeURIComponent(runId)}/events`)
  const root = isRecord(response.payload) ? response.payload : {}
  return recordArray(root.events).map((event) => stringField(event.type)).filter(Boolean)
}

function referenceSeedFindings(seed: ReferenceSeedAudit): Finding[] {
  return [
    finding(seed.responseOk, "reference seed: route responds", `status=${seed.status}`),
    finding(seed.valid && seed.imported, "reference seed: imports reference-only fixtures", `valid=${seed.valid}, imported=${seed.imported}, errors=${seed.errors.join("; ") || "none"}`),
    finding(seed.videosPlanned > 0, "reference seed: catalog videos planned", `videosPlanned=${seed.videosPlanned}`),
    finding(seed.assetsPlanned > 0, "reference seed: provider asset manifests planned", `assetsPlanned=${seed.assetsPlanned}`),
    finding(seed.referenceProfileIds.length >= 2, "reference seed: both reference lanes available", `referenceProfileIds=${seed.referenceProfileIds.join(", ") || "none"}`),
  ]
}

function coreLoopFindings(audit: CoreLoopAudit | null): Finding[] {
  if (!audit) return [finding(false, "core loop: browser demo launcher exercised", "Developer Graph view was not audited")]
  return [
    finding(!audit.error, "core loop: browser demo launcher completes", audit.error ?? "no error"),
    finding(audit.launcherVisible, "core loop: local demo launcher is visible", `launcherVisible=${audit.launcherVisible}`),
    finding(audit.uiRunVisible, "core loop: demo run appears in browser telemetry", `uiRunVisible=${audit.uiRunVisible}`),
    finding(audit.runLane === "brainrot", "core loop: brainrot lane run created", `lane=${audit.runLane || "missing"}`),
    finding(audit.runStatus === "succeeded" && audit.runPhase === "completed", "core loop: demo run reaches completed success", `status=${audit.runStatus || "missing"}, phase=${audit.runPhase || "missing"}`),
    finding(["created", "queued", "phase", "message", "import", "result", "completed"].every((type) => audit.eventTypes.includes(type)), "core loop: event-sourced run timeline recorded", `events=${audit.eventTypes.join(", ") || "none"}`),
    finding(audit.providerOperation === "demo-brainrot-local-plan" && audit.providerMode === "dry-run" && audit.providerStatus === "completed", "core loop: local dry-run provider plan persists", `operation=${audit.providerOperation || "missing"}, mode=${audit.providerMode || "missing"}, status=${audit.providerStatus || "missing"}`),
  ]
}

function viewFindings(audit: ViewAudit, expectedView: string): Finding[] {
  return [
    finding(audit.title === "Slotok Workbench", `${expectedView}: app title loads`, `title=${audit.title}`),
    finding(audit.view === expectedView, `${expectedView}: view activates`, `view=${audit.view}`),
    finding(audit.commandBarVisible, `${expectedView}: command bar remains visible`, `commandBar=${audit.commandBarVisible}`),
    finding(audit.inspectorVisible, `${expectedView}: inspector remains visible`, `inspector=${audit.inspectorVisible}`),
    finding(!audit.overflowX, `${expectedView}: no document horizontal overflow`, `overflowX=${audit.overflowX}`),
    finding(!audit.bodyOverflowY, `${expectedView}: no document vertical overflow`, `bodyOverflowY=${audit.bodyOverflowY}, rootHeight=${audit.rootHeight}, viewportHeight=${audit.viewportHeight}`),
    finding(audit.stageLocalScroll, `${expectedView}: stage owns vertical scroll`, `stageLocalScroll=${audit.stageLocalScroll}`),
    finding(audit.inspectorLocalScroll, `${expectedView}: inspector owns vertical scroll`, `inspectorLocalScroll=${audit.inspectorLocalScroll}`),
    finding(
      audit.placeholderHits.length === 0,
      `${expectedView}: no placeholder campaign labels`,
      audit.placeholderHits.join(", ") || "none detected",
    ),
    finding(
      audit.fakeTopRightHits.length === 0,
      `${expectedView}: no fake top-right controls`,
      audit.fakeTopRightHits.join(", ") || "none detected",
    ),
  ]
}

function responsiveViewFindings(audit: ViewAudit, expectedView: string, viewportLabel: string): Finding[] {
  return [
    finding(audit.view === expectedView, `${expectedView} ${viewportLabel}: view activates`, `view=${audit.view}`),
    finding(!audit.overflowX, `${expectedView} ${viewportLabel}: no document horizontal overflow`, `overflowX=${audit.overflowX}`),
    finding(!audit.bodyOverflowY, `${expectedView} ${viewportLabel}: no document vertical overflow`, `bodyOverflowY=${audit.bodyOverflowY}, rootHeight=${audit.rootHeight}, viewportHeight=${audit.viewportHeight}`),
    finding(audit.stageLocalScroll, `${expectedView} ${viewportLabel}: stage owns vertical scroll`, `stageLocalScroll=${audit.stageLocalScroll}`),
    finding(audit.inspectorLocalScroll, `${expectedView} ${viewportLabel}: inspector owns vertical scroll`, `inspectorLocalScroll=${audit.inspectorLocalScroll}`),
  ]
}

function mobileViewFindings(audit: ViewAudit, expectedView: string, viewportLabel: string): Finding[] {
  return [
    finding(audit.view === expectedView, `${expectedView} ${viewportLabel}: view activates`, `view=${audit.view}`),
    finding(audit.commandBarVisible, `${expectedView} ${viewportLabel}: command bar remains visible`, `commandBar=${audit.commandBarVisible}`),
    finding(!audit.overflowX, `${expectedView} ${viewportLabel}: no document horizontal overflow`, `overflowX=${audit.overflowX}`),
    finding(!audit.bodyOverflowY, `${expectedView} ${viewportLabel}: no document vertical overflow`, `bodyOverflowY=${audit.bodyOverflowY}, rootHeight=${audit.rootHeight}, viewportHeight=${audit.viewportHeight}`),
    finding(audit.stageLocalScroll, `${expectedView} ${viewportLabel}: stage owns vertical scroll`, `stageLocalScroll=${audit.stageLocalScroll}`),
  ]
}

function finding(condition: boolean, title: string, detail: string): Finding {
  return { status: condition ? "pass" : "fail", title, detail }
}

function screenshotPath(name: string): string {
  return join(artifactRoot, name)
}

function isRecord(value: JsonValue | null | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordArray(value: JsonValue | null | undefined): readonly Record<string, JsonValue>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringArray(value: JsonValue | null | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function stringField(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : ""
}

function numberField(value: JsonValue | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
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
    `Isolated daemon cwd: \`${relative(repoRoot, visualWorkspaceRoot)}\``,
    daemonUrl !== rendererDaemonUrl ? `Renderer daemon calls proxied from \`${rendererDaemonUrl}\` to \`${daemonUrl}\`.` : "Renderer uses the daemon directly.",
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
