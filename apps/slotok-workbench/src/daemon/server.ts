#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { extname, resolve } from "node:path"
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
    case ".json":
      return "application/json; charset=utf-8"
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
