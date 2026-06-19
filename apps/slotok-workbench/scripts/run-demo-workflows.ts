#!/usr/bin/env bun
import type { JsonValue } from "../src/renderer/ugcStudioModel"
import type { UgcWorkflowLane } from "../src/ugc/local-state"

type DemoWorkflowSelection = UgcWorkflowLane | "all"

type JsonObject = { readonly [key: string]: JsonValue | undefined }

interface ParsedArgs {
  readonly selection: DemoWorkflowSelection
  readonly baseUrl: string
  readonly help: boolean
}

interface WorkflowRunSummary {
  readonly id: string
  readonly lane: string
  readonly status: string
  readonly title: string
  readonly currentPhase: string | null
  readonly importedRecordCount: number
  readonly artifactCount: number
  readonly error: string | null
}

interface ImportResultSummary {
  readonly runId: string
  readonly lane: string
  readonly valid: boolean
  readonly imported: boolean
  readonly providerJobCount: number
  readonly referenceArchiveCount: number
  readonly candidateCount: number
  readonly noteCount: number
  readonly importedRecordCount: number
  readonly errorCount: number
  readonly warningCount: number
}

interface DemoWorkflowLaunchSummary {
  readonly lane: DemoWorkflowSelection
  readonly workflowRuns: readonly WorkflowRunSummary[]
  readonly importResults: readonly ImportResultSummary[]
}

const defaultDaemonPort = "47522"
const demoRoutePath = "/api/ugc/workflows/demo"
const usage = [
  "Usage: bun run demo:workflows [brainrot|ugc-ads|all] [--url http://127.0.0.1:47522]",
  "",
  "Launches local Slotok demo workflows through the running daemon route /api/ugc/workflows/demo.",
  "Defaults: lane=all, url=SLOTOK_DAEMON_URL or http://127.0.0.1:${SLOTOK_DAEMON_PORT:-47522}.",
].join("\n")

try {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage)
  } else {
    await assertDaemonRunning(args.baseUrl)
    const summary = await launchDemoWorkflows(args.baseUrl, args.selection)
    if (summary.workflowRuns.length === 0) throw new Error("Demo workflow launch returned no workflow runs.")
    console.log(JSON.stringify(summary))
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Demo workflow launcher failed."
  console.error(message)
  process.exitCode = 1
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let selection: DemoWorkflowSelection = "all"
  let baseUrl = defaultBaseUrl()
  let help = false
  let hasSelection = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === "--help" || arg === "-h") {
      help = true
    } else if (arg === "--url") {
      if (!next || next.startsWith("-")) throw new Error(`Missing value for --url.\n${usage}`)
      baseUrl = next
      index += 1
    } else if (arg.startsWith("--url=")) {
      baseUrl = arg.slice("--url=".length)
      if (baseUrl.length === 0) throw new Error(`Missing value for --url.\n${usage}`)
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}\n${usage}`)
    } else if (isDemoWorkflowSelection(arg)) {
      if (hasSelection) throw new Error(`Only one workflow lane may be provided.\n${usage}`)
      selection = arg
      hasSelection = true
    } else {
      throw new Error(`Unknown demo workflow lane: ${arg}\n${usage}`)
    }
  }

  return { selection, baseUrl: normalizeBaseUrl(baseUrl), help }
}

function defaultBaseUrl(): string {
  const configuredUrl = process.env.SLOTOK_DAEMON_URL?.trim()
  if (configuredUrl) return configuredUrl
  const configuredPort = process.env.SLOTOK_DAEMON_PORT?.trim() || defaultDaemonPort
  return `http://127.0.0.1:${configuredPort}`
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`Invalid daemon URL: ${value}`)
  }
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "")
  return `${parsed.origin}${path}`
}

function isDemoWorkflowSelection(value: string): value is DemoWorkflowSelection {
  return value === "brainrot" || value === "ugc-ads" || value === "all"
}

async function assertDaemonRunning(baseUrl: string): Promise<void> {
  const response = await fetchDaemon(baseUrl, "/api/health", { signal: AbortSignal.timeout(3_000) })
  if (!response.ok) throw new Error(`Slotok daemon health check failed at ${baseUrl}/api/health: HTTP ${response.status}.`)
}

async function launchDemoWorkflows(baseUrl: string, selection: DemoWorkflowSelection): Promise<DemoWorkflowLaunchSummary> {
  const response = await fetchDaemon(baseUrl, demoRoutePath, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ lane: selection }),
    signal: AbortSignal.timeout(30_000),
  })

  if (response.status === 404) {
    throw new Error(`Slotok daemon at ${baseUrl} does not expose ${demoRoutePath}. Restart the daemon after pulling the demo workflow backend route.`)
  }
  if (!response.ok) {
    const detail = await response.text()
    const trimmedDetail = detail.trim()
    const suffix = trimmedDetail ? ` - ${trimmedDetail.slice(0, 500)}` : ""
    throw new Error(`Demo workflow launch failed at ${baseUrl}${demoRoutePath}: HTTP ${response.status}${suffix}.`)
  }

  const payload = await response.json() as JsonValue
  return summarizeDemoResponse(selection, payload)
}

async function fetchDaemon(baseUrl: string, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${path}`, init)
  } catch {
    throw new Error(`Slotok daemon is not running at ${baseUrl}. Start it with "bun run dev:daemon" in apps/slotok-workbench, or pass --url.`)
  }
}

function summarizeDemoResponse(selection: DemoWorkflowSelection, payload: JsonValue): DemoWorkflowLaunchSummary {
  const root = asObject(payload)
  if (!root) throw new Error("Demo workflow route returned a non-object response.")

  const workflowRunsValue = root.workflowRuns
  const importResultsValue = root.importResults
  if (!Array.isArray(workflowRunsValue)) throw new Error("Demo workflow route response is missing workflowRuns[].")
  if (!Array.isArray(importResultsValue)) throw new Error("Demo workflow route response is missing importResults[].")

  const workflowRuns = workflowRunsValue as readonly JsonValue[]
  const importResults = importResultsValue as readonly JsonValue[]

  return {
    lane: selection,
    workflowRuns: workflowRuns.map(summarizeWorkflowRun),
    importResults: importResults.map(summarizeImportResult),
  }
}

function summarizeWorkflowRun(value: JsonValue): WorkflowRunSummary {
  const root = asObject(value)
  const id = jsonString(root?.id)
  const lane = jsonString(root?.lane)
  const status = jsonString(root?.status)
  if (!root || !id || !lane || !status) throw new Error("Demo workflow route returned an invalid workflow run summary.")

  return {
    id,
    lane,
    status,
    title: jsonString(root.title) || "",
    currentPhase: jsonString(root.currentPhase),
    importedRecordCount: jsonArrayLength(root.importedRecordIds),
    artifactCount: jsonArrayLength(root.artifactPaths),
    error: jsonString(root.error),
  }
}

function summarizeImportResult(value: JsonValue): ImportResultSummary {
  const root = asObject(value)
  const runId = jsonString(root?.runId)
  const lane = jsonString(root?.lane)
  const valid = typeof root?.valid === "boolean" ? root.valid : null
  const imported = typeof root?.imported === "boolean" ? root.imported : null
  if (!root || !runId || !lane || valid === null || imported === null) throw new Error("Demo workflow route returned an invalid import result summary.")

  const plannedChanges = asObject(root.plannedChanges)
  return {
    runId,
    lane,
    valid,
    imported,
    providerJobCount: jsonArrayLength(plannedChanges?.providerJobIds),
    referenceArchiveCount: jsonArrayLength(plannedChanges?.referenceArchiveIds),
    candidateCount: jsonArrayLength(plannedChanges?.candidateIds),
    noteCount: jsonArrayLength(plannedChanges?.noteIds),
    importedRecordCount: jsonArrayLength(plannedChanges?.importedRecordIds),
    errorCount: jsonArrayLength(root.errors),
    warningCount: jsonArrayLength(root.warnings),
  }
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as JsonObject
}

function jsonString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function jsonArrayLength(value: JsonValue | undefined): number {
  return Array.isArray(value) ? value.length : 0
}

