#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { extname, isAbsolute, relative, resolve } from "node:path"
import {
  KIE_CAPABILITIES,
  createKieTask,
  getKieCredits,
  getKieTaskDetail,
  prepareKieTask,
  type KieGenerateRequest,
} from "@wirebabel/ugc-cli"
import { EvalStore } from "./eval-store"
import { UgcJsonStore } from "./ugc-json-store"
import { routeUgc } from "./ugc-routes"
import type { ActionJobRequest, AnnotationWriteInput, JsonValue } from "../types"

const DEFAULT_PORT = 47522
const HYPERFRAMES_RENDER_TIMEOUT_MS = 10 * 60 * 1000
const HYPERFRAMES_OUTPUT_LIMIT_CHARS = 1024 * 1024
const HYPERFRAMES_MAX_JOBS = 50

interface ParsedArgs {
  once: boolean
  port: number
  cwd?: string
  sqlitePath?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  let port = Number(process.env.SLOTOK_DAEMON_PORT ?? DEFAULT_PORT)
  let cwd: string | undefined
  let sqlitePath: string | undefined
  let once = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === "--once") {
      once = true
    } else if (arg === "--port" && next) {
      port = Number(next)
      index += 1
    } else if (arg === "--cwd" && next) {
      cwd = next
      index += 1
    } else if (arg === "--sqlite" && next) {
      sqlitePath = next
      index += 1
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`)
    }
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${port}`)
  }

  return { once, port, cwd, sqlitePath }
}

if (import.meta.main) {
  startDaemon(process.argv.slice(2))
}

export function startDaemon(argv: string[]): void {
  const args = parseArgs(argv)
  const store = new EvalStore({ cwd: args.cwd, sqlitePath: args.sqlitePath })
  const ugcStore = new UgcJsonStore({ cwd: args.cwd })

  if (args.once) {
    console.log(JSON.stringify(store.bootstrap(), null, 2))
    process.exit(0)
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: args.port,
    fetch: (request) => route(request, store, ugcStore),
  })

  console.log(JSON.stringify({
    ok: true,
    name: "slotok-daemon",
    url: `http://${server.hostname}:${server.port}`,
    sqlitePath: store.config.sqlitePath,
  }, null, 2))
}

export async function route(request: Request, evalStore: EvalStore, ugcJsonStore: UgcJsonStore): Promise<Response> {
  if (request.method === "OPTIONS") {
    return empty(204)
  }

  const url = new URL(request.url)
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, name: "slotok-daemon", sqliteExists: existsSync(evalStore.config.sqlitePath), startedAt: evalStore.config.startedAt })
    }

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      return json(evalStore.bootstrap(limitParam(url, 250)))
    }

    if (request.method === "GET" && url.pathname === "/api/runs") {
      return json({ runs: evalStore.listRuns(limitParam(url, 100)) })
    }

    if (request.method === "GET" && url.pathname === "/api/elements") {
      return json({ elements: evalStore.listElements(limitParam(url, 250)) })
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/elements/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/elements/".length))
      const detail = evalStore.getElement(id)
      if (!detail) return json({ error: "element not found" }, 404)
      return json(detail)
    }


    if (request.method === "GET" && url.pathname === "/api/annotations") {
      return json({ annotations: evalStore.readAnnotations() })
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/annotations/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/annotations/".length))
      if (!key) return json({ error: "missing annotation key" }, 400)
      const annotation = evalStore.getAnnotation(key)
      if (!annotation) return json({ error: "annotation not found" }, 404)
      return json({ key, annotation })
    }

    if (request.method === "POST" && url.pathname === "/api/annotations") {
      const decoded = decodeAnnotationWriteInput(await request.json() as JsonValue)
      if (!decoded.ok) return json({ error: decoded.error }, 400)
      return json(evalStore.writeAnnotation(decoded.value))
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/annotations/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/annotations/".length))
      if (!key) return json({ error: "missing annotation key" }, 400)
      const decoded = decodeAnnotationWriteInput(await request.json() as JsonValue)
      if (!decoded.ok) return json({ error: decoded.error }, 400)
      return json(evalStore.writeAnnotation(decoded.value, key))
    }

    if (request.method === "POST" && (url.pathname === "/api/actions" || url.pathname === "/api/actions/rerun")) {
      const decoded = decodeActionJobRequest(await request.json() as JsonValue, url.pathname === "/api/actions/rerun")
      if (!decoded.ok) return json({ error: decoded.error }, 400)
      const job = evalStore.createDryRunActionJob(decoded.value)
      if (!job) return json({ error: "action target not found" }, 404)
      return json({ job })
    }
    if (request.method === "GET" && url.pathname === "/api/file") {
      const target = url.searchParams.get("path")
      if (!target) return json({ error: "missing path" }, 400)
      return fileResponse(evalStore.config.cwd, target)
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/ugc/hyperframes/jobs/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/api/ugc/hyperframes/jobs/".length))
      const job = hyperframesRenderJobs.get(jobId)
      if (!job) return json({ error: "hyperframes job not found" }, 404)
      return json(hyperframesRenderJobResponse(job))
    }

    if (request.method === "POST" && url.pathname === "/api/ugc/hyperframes/render") {
      const body = await readJsonBody(request)
      if (!body.ok) return json({ error: body.error }, 400)
      const decoded = decodeHyperframesRenderRequest(body.value)
      if (!decoded.ok) return json({ error: decoded.error }, 400)
      const planned = planHyperframesRender(evalStore.config.cwd, decoded.value)
      if (!planned.ok) return json({ error: planned.error }, planned.status)
      const job = startHyperframesRenderJob(planned.value)
      return json(hyperframesRenderJobResponse(job), 202)
    }

    const ugcResponse = await routeUgc(request, ugcJsonStore)
    if (ugcResponse) return ugcResponse

    if (request.method === "GET" && url.pathname === "/api/ugc/kie/capabilities") {
      return json({ provider: "kie", capabilities: KIE_CAPABILITIES })
    }

    if (request.method === "GET" && url.pathname === "/api/ugc/kie/credits") {
      if (url.searchParams.get("live") !== "true") {
        return json({ mode: "dry-run", endpoint: "GET /api/v1/chat/credit", keyPresent: hasKieKey(evalStore.config.cwd) })
      }
      return json(await getKieCredits({ envPath: resolve(evalStore.config.cwd, ".env") }))
    }

    if (request.method === "POST" && url.pathname === "/api/ugc/kie/plan") {
      const body = await request.json() as KieGenerateRequest
      return json(prepareKieTask(body))
    }

    if (request.method === "POST" && url.pathname === "/api/ugc/kie/create") {
      const body = await request.json() as KieGenerateRequest & { live?: boolean; maxSpendUsd?: number }
      return json(await createKieTask(body, {
        live: body.live === true,
        maxSpendUsd: body.maxSpendUsd ?? 0.25,
        envPath: resolve(evalStore.config.cwd, ".env"),
      }))
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/ugc/kie/tasks/")) {
      const taskId = decodeURIComponent(url.pathname.slice("/api/ugc/kie/tasks/".length))
      if (!taskId) return json({ error: "missing task id" }, 400)
      return json(await getKieTaskDetail(taskId, { envPath: resolve(evalStore.config.cwd, ".env") }))
    }

    return json({ error: "not found" }, 404)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message }, 500)
  }
}

type JsonRecord = { [key: string]: JsonValue }
type DecodeResult<T> = { ok: true; value: T } | { ok: false; error: string }

interface HyperframesRenderRequest {
  bootstrapRoot: string
  sampleId: string
  designSystem?: string
  template?: string
  modelId?: string
  workflowId?: string
  audio?: string
  render: boolean
}

interface HyperframesRenderPlan {
  cwd: string
  command: string[]
  outputDir: string
  manifestPath: string
}

type RouteResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
type HyperframesRenderJobStatus = "running" | "completed" | "failed" | "timed_out"

interface HyperframesRenderJob {
  id: string
  command: string[]
  outputDir: string
  manifestPath: string
  status: HyperframesRenderJobStatus
  startedAt: string
  updatedAt: string
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
}

const hyperframesRenderJobs = new Map<string, HyperframesRenderJob>()

function decodeAnnotationWriteInput(value: JsonValue): DecodeResult<AnnotationWriteInput> {
  if (!isRecord(value)) return { ok: false, error: "annotation body must be an object" }
  if (typeof value.targetId !== "string" || value.targetId.length === 0) return { ok: false, error: "targetId is required" }
  if (typeof value.targetKind !== "string" || value.targetKind.length === 0) return { ok: false, error: "targetKind is required" }
  if (typeof value.note !== "string") return { ok: false, error: "note is required" }
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) return { ok: false, error: "tags must be strings" }
  if (!isAnnotationStatus(value.status)) return { ok: false, error: "status is invalid" }
  if (!isAnnotationRating(value.rating)) return { ok: false, error: "rating is invalid" }
  const input: AnnotationWriteInput = {
    targetId: value.targetId,
    targetKind: value.targetKind,
    note: value.note,
    tags: value.tags,
    status: value.status,
    rating: value.rating,
  }
  if (typeof value.title === "string") input.title = value.title
  return { ok: true, value: input }
}

function decodeActionJobRequest(value: JsonValue, defaultRerun: boolean): DecodeResult<ActionJobRequest> {
  if (!isRecord(value)) return { ok: false, error: "action body must be an object" }
  if (typeof value.targetId !== "string" || value.targetId.length === 0) return { ok: false, error: "targetId is required" }
  const action = defaultRerun && value.action === undefined ? "rerun-video-eval" : value.action
  if (action !== "rerun-video-eval") return { ok: false, error: "action must be rerun-video-eval" }
  const targetKind = value.targetKind === undefined ? "video_eval_result" : value.targetKind
  if (targetKind !== "video_eval_result") return { ok: false, error: "targetKind must be video_eval_result" }
  const scope = value.scope === "descendants" ? "descendants" : "selected"
  const input: ActionJobRequest = {
    targetId: value.targetId,
    targetKind,
    action,
    scope,
  }
  if (value.provider !== undefined) {
    if (typeof value.provider !== "string" || value.provider.length === 0) return { ok: false, error: "provider must be a non-empty string" }
    input.provider = value.provider
  }
  if (value.maxFrames !== undefined) {
    if (typeof value.maxFrames !== "number" || !Number.isInteger(value.maxFrames) || value.maxFrames <= 0) return { ok: false, error: "maxFrames must be a positive integer" }
    input.maxFrames = value.maxFrames
  }
  if (value.maxOutputTokens !== undefined) {
    if (typeof value.maxOutputTokens !== "number" || !Number.isInteger(value.maxOutputTokens) || value.maxOutputTokens <= 0) return { ok: false, error: "maxOutputTokens must be a positive integer" }
    input.maxOutputTokens = value.maxOutputTokens
  }
  return { ok: true, value: input }
}

async function readJsonBody(request: Request): Promise<DecodeResult<JsonValue>> {
  try {
    return { ok: true, value: await request.json() as JsonValue }
  } catch {
    return { ok: false, error: "body must be valid JSON" }
  }
}

function decodeHyperframesRenderRequest(value: JsonValue): DecodeResult<HyperframesRenderRequest> {
  if (!isRecord(value)) return { ok: false, error: "hyperframes render body must be an object" }
  const bootstrapRoot = decodeRequiredString(value.bootstrapRoot, "bootstrapRoot")
  if (!bootstrapRoot.ok) return bootstrapRoot
  const sampleId = decodeRequiredString(value.sampleId, "sampleId")
  if (!sampleId.ok) return sampleId
  const designSystem = decodeOptionalString(value.designSystem, "designSystem")
  if (!designSystem.ok) return designSystem
  const template = decodeOptionalString(value.template, "template")
  if (!template.ok) return template
  const modelId = decodeOptionalString(value.modelId, "modelId")
  if (!modelId.ok) return modelId
  const workflowId = decodeOptionalString(value.workflowId, "workflowId")
  if (!workflowId.ok) return workflowId
  const audio = decodeOptionalString(value.audio, "audio")
  if (!audio.ok) return audio
  if (value.render !== undefined && typeof value.render !== "boolean") return { ok: false, error: "render must be a boolean" }

  return {
    ok: true,
    value: {
      bootstrapRoot: bootstrapRoot.value,
      sampleId: sampleId.value,
      ...(designSystem.value === undefined ? {} : { designSystem: designSystem.value }),
      ...(template.value === undefined ? {} : { template: template.value }),
      ...(modelId.value === undefined ? {} : { modelId: modelId.value }),
      ...(workflowId.value === undefined ? {} : { workflowId: workflowId.value }),
      ...(audio.value === undefined ? {} : { audio: audio.value }),
      render: value.render ?? true,
    },
  }
}

function planHyperframesRender(cwd: string, input: HyperframesRenderRequest): RouteResult<HyperframesRenderPlan> {
  const resolvedCwd = resolveExistingDirectory(cwd, "daemon cwd", 500)
  if (!resolvedCwd.ok) return resolvedCwd
  if (!isSafePathSegment(input.sampleId)) return { ok: false, status: 400, error: "sampleId must be a safe path segment" }
  if (input.designSystem !== undefined && !isSafePathSegment(input.designSystem)) {
    return { ok: false, status: 400, error: "designSystem must be a safe path segment" }
  }

  const bootstrapRoot = resolveExistingDirectoryUnderRoot(resolvedCwd.value, input.bootstrapRoot, "bootstrapRoot")
  if (!bootstrapRoot.ok) return bootstrapRoot
  const layerPlan = resolveExistingFileUnderRoot(bootstrapRoot.value, "birthrate-layer-plan.json", "birthrate-layer-plan.json")
  if (!layerPlan.ok) return layerPlan
  const rendererScript = "packages/hyperframes-renderer/src/render.ts"
  const renderer = resolveExistingFileUnderRoot(resolvedCwd.value, rendererScript, "hyperframes renderer")
  if (!renderer.ok) return renderer

  const rendersDir = resolve(bootstrapRoot.value, "renders")
  const rendersDirSafety = validateExistingDirectoryUnderRoot(bootstrapRoot.value, rendersDir, "renders directory")
  if (!rendersDirSafety.ok) return rendersDirSafety
  const outputName = input.designSystem === undefined
    ? `${input.sampleId}-hyperframes-rerender`
    : `${input.sampleId}-hyperframes-${input.designSystem}`
  const outputDir = resolve(rendersDir, outputName)
  const outputDirSafety = validateExistingDirectoryUnderRoot(bootstrapRoot.value, outputDir, "output directory")
  if (!outputDirSafety.ok) return outputDirSafety

  if (input.audio !== undefined) {
    const audio = resolveExistingFileUnderRoot(resolvedCwd.value, input.audio, "audio")
    if (!audio.ok) return audio
  }

  const command = [
    "bun",
    "x",
    "tsx",
    rendererScript,
    "--layer-plan",
    layerPlan.value,
    "--out",
    outputDir,
    "--model-id",
    input.modelId ?? "manual-baseline",
    "--workflow-id",
    input.workflowId ?? "hyperframes-local-baseline",
  ]
  if (input.render) command.push("--render")
  if (input.audio !== undefined) command.push("--audio", input.audio)

  return {
    ok: true,
    value: {
      cwd: resolvedCwd.value,
      command,
      outputDir,
      manifestPath: resolve(outputDir, "manifest.json"),
    },
  }
}

function startHyperframesRenderJob(plan: HyperframesRenderPlan): HyperframesRenderJob {
  pruneHyperframesRenderJobs()
  const now = new Date().toISOString()
  const job: HyperframesRenderJob = {
    id: crypto.randomUUID(),
    command: plan.command,
    outputDir: plan.outputDir,
    manifestPath: plan.manifestPath,
    status: "running",
    startedAt: now,
    updatedAt: now,
    stdout: "",
    stderr: "",
    exitCode: null,
  }
  hyperframesRenderJobs.set(job.id, job)
  void executeHyperframesRenderJob(plan, job)
  return job
}

function hyperframesRenderJobResponse(job: HyperframesRenderJob): object {
  return {
    ok: job.status === "running" || job.status === "completed",
    jobId: job.id,
    status: job.status,
    command: job.command.join(" "),
    outputDir: job.outputDir,
    manifestPath: job.manifestPath,
    stdout: job.stdout,
    stderr: job.stderr,
    exitCode: job.exitCode,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  }
}

async function executeHyperframesRenderJob(plan: HyperframesRenderPlan, job: HyperframesRenderJob): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    if (job.status === "running") {
      job.status = "timed_out"
      job.error = "hyperframes renderer timed out"
      job.updatedAt = new Date().toISOString()
    }
    controller.abort()
  }, HYPERFRAMES_RENDER_TIMEOUT_MS)

  try {
    const child = Bun.spawn(plan.command, {
      cwd: plan.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    })
    const stdoutTask = captureHyperframesOutput(child.stdout, job, "stdout", controller)
    const stderrTask = captureHyperframesOutput(child.stderr, job, "stderr", controller)
    let exitCode: number
    try {
      exitCode = await child.exited
    } finally {
      await Promise.allSettled([stdoutTask, stderrTask])
    }
    job.exitCode = exitCode
    if (job.status === "failed" || job.status === "timed_out") {
      job.updatedAt = new Date().toISOString()
      return
    }
    if (exitCode !== 0) {
      job.status = "failed"
      job.error = job.stderr.trim() || job.stdout.trim() || `hyperframes renderer exited with status ${exitCode}`
      job.updatedAt = new Date().toISOString()
      return
    }
    if (!existsSync(plan.manifestPath)) {
      job.status = "failed"
      job.error = "hyperframes renderer did not write manifest.json"
      job.updatedAt = new Date().toISOString()
      return
    }
    job.status = "completed"
    job.updatedAt = new Date().toISOString()
  } catch (error) {
    if (job.status === "running") {
      job.status = "failed"
      job.error = error instanceof Error ? error.message : String(error)
    }
    job.updatedAt = new Date().toISOString()
  } finally {
    clearTimeout(timeout)
  }
}

async function captureHyperframesOutput(
  stream: ReadableStream<Uint8Array> | null,
  job: HyperframesRenderJob,
  field: "stdout" | "stderr",
  controller: AbortController,
): Promise<void> {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const read = await reader.read()
      if (read.done) break
      appendHyperframesOutput(job, field, decoder.decode(read.value, { stream: true }), controller)
      if (job.status !== "running") break
    }
    appendHyperframesOutput(job, field, decoder.decode(), controller)
  } finally {
    reader.releaseLock()
  }
}

function appendHyperframesOutput(
  job: HyperframesRenderJob,
  field: "stdout" | "stderr",
  chunk: string,
  controller: AbortController,
): void {
  if (job.status !== "running" || chunk.length === 0) return
  const current = job[field]
  const nextLength = current.length + chunk.length
  if (nextLength > HYPERFRAMES_OUTPUT_LIMIT_CHARS) {
    const remaining = Math.max(0, HYPERFRAMES_OUTPUT_LIMIT_CHARS - current.length)
    job[field] = `${current}${chunk.slice(0, remaining)}\n[output truncated]`
    if (job.status === "running") {
      job.status = "failed"
      job.error = "hyperframes renderer output exceeded limit"
      job.updatedAt = new Date().toISOString()
    }
    controller.abort()
    return
  }
  job[field] = `${current}${chunk}`
  job.updatedAt = new Date().toISOString()
}

function pruneHyperframesRenderJobs(): void {
  if (hyperframesRenderJobs.size < HYPERFRAMES_MAX_JOBS) return
  for (const [jobId, job] of hyperframesRenderJobs) {
    if (hyperframesRenderJobs.size < HYPERFRAMES_MAX_JOBS) return
    if (job.status !== "running") hyperframesRenderJobs.delete(jobId)
  }
}


function decodeRequiredString(value: JsonValue | undefined, field: string): DecodeResult<string> {
  if (typeof value !== "string" || value.length === 0) return { ok: false, error: `${field} is required` }
  if (value.includes("\0")) return { ok: false, error: `${field} must not contain NUL bytes` }
  return { ok: true, value }
}

function decodeOptionalString(value: JsonValue | undefined, field: string): DecodeResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value !== "string" || value.length === 0) return { ok: false, error: `${field} must be a non-empty string` }
  if (value.includes("\0")) return { ok: false, error: `${field} must not contain NUL bytes` }
  return { ok: true, value }
}

function resolveExistingDirectoryUnderRoot(root: string, target: string, label: string): RouteResult<string> {
  const candidate = resolve(root, target)
  const resolved = resolveExistingDirectory(candidate, label, 404)
  if (!resolved.ok) return resolved
  if (!isPathUnderRoot(root, resolved.value)) return { ok: false, status: 403, error: `${label} is outside the project` }
  return resolved
}

function resolveExistingFileUnderRoot(root: string, target: string, label: string): RouteResult<string> {
  const candidate = resolve(root, target)
  if (!existsSync(candidate)) return { ok: false, status: 404, error: `${label} not found` }
  let resolved: string
  try {
    resolved = realpathSync(candidate)
  } catch {
    return { ok: false, status: 400, error: `${label} cannot be resolved` }
  }
  if (!isPathUnderRoot(root, resolved)) return { ok: false, status: 403, error: `${label} is outside the project` }
  if (!statSync(resolved).isFile()) return { ok: false, status: 400, error: `${label} must be a file` }
  return { ok: true, value: resolved }
}

function resolveExistingDirectory(target: string, label: string, missingStatus: number): RouteResult<string> {
  if (!existsSync(target)) return { ok: false, status: missingStatus, error: `${label} not found` }
  let resolved: string
  try {
    resolved = realpathSync(target)
  } catch {
    return { ok: false, status: 400, error: `${label} cannot be resolved` }
  }
  if (!statSync(resolved).isDirectory()) return { ok: false, status: 400, error: `${label} must be a directory` }
  return { ok: true, value: resolved }
}

function validateExistingDirectoryUnderRoot(root: string, target: string, label: string): RouteResult<null> {
  if (!existsSync(target)) return { ok: true, value: null }
  let resolved: string
  try {
    resolved = realpathSync(target)
  } catch {
    return { ok: false, status: 400, error: `${label} cannot be resolved` }
  }
  if (!isPathUnderRoot(root, resolved)) return { ok: false, status: 403, error: `${label} is outside the bootstrap root` }
  if (!statSync(resolved).isDirectory()) return { ok: false, status: 400, error: `${label} must be a directory` }
  return { ok: true, value: null }
}

function isPathUnderRoot(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

function isSafePathSegment(value: string): boolean {
  return value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\")
}

function isAnnotationStatus(value: JsonValue | undefined): value is AnnotationWriteInput["status"] {
  return (
    value === "untriaged"
    || value === "interesting"
    || value === "good"
    || value === "bad"
    || value === "needs_rerun"
    || value === "follow_up"
  )
}

function isAnnotationRating(value: JsonValue | undefined): value is AnnotationWriteInput["rating"] {
  return value === -2 || value === -1 || value === 0 || value === 1 || value === 2
}

function isRecord(value: JsonValue | undefined | null): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function limitParam(url: URL, fallback: number): number {
  const raw = url.searchParams.get("limit")
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(1000, Math.trunc(value)))
}

function fileResponse(cwd: string, target: string): Response {
  const resolvedCwd = realpathSync(cwd)
  const candidate = resolve(cwd, target)
  if (!existsSync(candidate)) return json({ error: "file not found" }, 404)
  const resolvedTarget = realpathSync(candidate)
  if (resolvedTarget !== resolvedCwd && !resolvedTarget.startsWith(`${resolvedCwd}/`)) {
    return json({ error: "path outside project is not allowed" }, 403)
  }
  return new Response(Bun.file(resolvedTarget), {
    headers: corsHeaders({ "content-type": mimeType(resolvedTarget) }),
  })
}

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    case ".mp4":
      return "video/mp4"
    case ".webm":
      return "video/webm"
    case ".mp3":
      return "audio/mpeg"
    case ".m4a":
      return "audio/mp4"
    case ".wav":
      return "audio/wav"
    case ".json":
      return "application/json; charset=utf-8"
    case ".txt":
      return "text/plain; charset=utf-8"
    case ".md":
      return "text/markdown; charset=utf-8"
    case ".vtt":
      return "text/vtt; charset=utf-8"
    case ".srt":
      return "text/plain; charset=utf-8"
    default:
      return "application/octet-stream"
  }
}

function json(value: object, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: corsHeaders({ "content-type": "application/json; charset=utf-8" }),
  })
}

function empty(status: number): Response {
  return new Response(null, { status, headers: corsHeaders() })
}

function corsHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    ...extra,
  })
}

function hasKieKey(cwd: string): boolean {
  if (process.env.KIE_API_KEY) return true
  const envPath = resolve(cwd, ".env")
  if (!existsSync(envPath)) return false
  return /^KIE_API_KEY=/m.test(readFileSync(envPath, "utf8"))
}
