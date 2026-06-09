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

const args = parseArgs(process.argv.slice(2))
const store = new EvalStore({ cwd: args.cwd, sqlitePath: args.sqlitePath })

if (args.once) {
  console.log(JSON.stringify(store.bootstrap(), null, 2))
  process.exit(0)
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: args.port,
  fetch: (request) => route(request, store),
})

console.log(JSON.stringify({
  ok: true,
  name: "slotok-daemon",
  url: `http://${server.hostname}:${server.port}`,
  sqlitePath: store.config.sqlitePath,
}, null, 2))

async function route(request: Request, evalStore: EvalStore): Promise<Response> {
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

    if (request.method === "GET" && url.pathname === "/api/file") {
      const target = url.searchParams.get("path")
      if (!target) return json({ error: "missing path" }, 400)
      return fileResponse(evalStore.config.cwd, target)
    }

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
    "access-control-allow-methods": "GET,POST,OPTIONS",
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
