import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { watch } from "node:fs"
import {
  actionArgv,
  contentTypeForPath,
  FEED_PATH,
  findFeedAction,
  readFeedFile,
  resolveActionCwd,
  resolveArtifactPath,
} from "./feed.ts"

const PORT = Number.parseInt(process.env.PORT ?? "4970", 10)
const ACTION_TIMEOUT_MS = 600_000
const PUBLIC_DIR = resolve(import.meta.dir, "../public")
const encoder = new TextEncoder()
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>()
let actionBusy = false
let feedReloadTimer: Timer | null = null

await mkdir(dirname(FEED_PATH), { recursive: true })

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

function jsonResponse(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: object): void {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

async function currentFeedPayload(): Promise<{ readonly entries: object }> {
  return { entries: await readFeedFile() }
}

async function broadcastFeed(): Promise<void> {
  const payload = await currentFeedPayload()
  for (const client of [...sseClients]) {
    try {
      sendSse(client, "feed", payload)
    } catch {
      sseClients.delete(client)
    }
  }
}

function scheduleFeedBroadcast(): void {
  if (feedReloadTimer !== null) clearTimeout(feedReloadTimer)
  feedReloadTimer = setTimeout(() => {
    feedReloadTimer = null
    void broadcastFeed()
  }, 80)
}

watch(dirname(FEED_PATH), { persistent: false }, (_eventType, filename) => {
  if (!filename || filename.toString() === "feed.jsonl") scheduleFeedBroadcast()
})

async function servePublic(pathname: string): Promise<Response> {
  const publicPath = pathname === "/" ? "index.html" : pathname.slice(1)
  const filePath = resolve(PUBLIC_DIR, publicPath)
  if (!filePath.startsWith(PUBLIC_DIR)) return textResponse("Not found", 404)
  const file = Bun.file(filePath)
  if (!(await file.exists())) return textResponse("Not found", 404)
  const type = publicPath.endsWith(".css")
    ? "text/css; charset=utf-8"
    : publicPath.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8"
  return new Response(file, { headers: { "content-type": type } })
}

async function serveArtifact(pathname: string): Promise<Response> {
  const encodedPath = pathname.slice("/artifact/".length)
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    return textResponse("Bad artifact path", 400)
  }

  const resolvedArtifact = resolveArtifactPath(decodedPath)
  if (!resolvedArtifact) return textResponse("Artifact path is not allowed", 403)
  const file = Bun.file(resolvedArtifact.absolutePath)
  if (!(await file.exists())) return textResponse("Artifact not found", 404)
  return new Response(file, {
    headers: {
      "content-type": contentTypeForPath(resolvedArtifact.repoRelativePath),
      "x-content-type-options": "nosniff",
    },
  })
}

function serveEvents(): Response {
  let activeController: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      activeController = controller
      sseClients.add(controller)
      controller.enqueue(encoder.encode(": xanadu feed stream\n\n"))
      sendSse(controller, "feed", await currentFeedPayload())
    },
    cancel() {
      if (activeController) sseClients.delete(activeController)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}

async function serveAction(entryId: string, indexText: string): Promise<Response> {
  if (actionBusy) return textResponse("Another Xanadu action is already running. Try again when it finishes.\n", 409)
  const index = Number.parseInt(indexText, 10)
  const lookup = findFeedAction(await readFeedFile(), entryId, index)
  if (!lookup) return textResponse("Action not found in the feed on disk.\n", 404)

  const cwd = resolveActionCwd(lookup.action.cwd)
  if (!cwd) return textResponse("Action cwd is not repo-relative.\n", 400)

  const argv = actionArgv(lookup.action)
  actionBusy = true

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let timedOut = false
      const child = Bun.spawn([...argv], {
        cwd: cwd.absolutePath,
        stdout: "pipe",
        stderr: "pipe",
      })
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill()
        controller.enqueue(encoder.encode(`\n[xanadu] action timed out after ${ACTION_TIMEOUT_MS / 1000}s\n`))
      }, ACTION_TIMEOUT_MS)

      async function pump(readable: ReadableStream<Uint8Array>): Promise<void> {
        for await (const chunk of readable) controller.enqueue(chunk)
      }

      try {
        await Promise.all([pump(child.stdout), pump(child.stderr), child.exited])
        clearTimeout(timeout)
        const exitCode = await child.exited
        if (!timedOut) controller.enqueue(encoder.encode(`\n[xanadu] action exited ${exitCode}\n`))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        controller.enqueue(encoder.encode(`\n[xanadu] action failed: ${message}\n`))
      } finally {
        clearTimeout(timeout)
        actionBusy = false
        controller.close()
      }
    },
    cancel() {
      actionBusy = false
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  })
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === "GET" && url.pathname === "/api/feed") {
      return jsonResponse({ entries: await readFeedFile() })
    }
    if (request.method === "GET" && url.pathname === "/api/events") return serveEvents()
    if (request.method === "GET" && url.pathname.startsWith("/artifact/")) return serveArtifact(url.pathname)
    if (request.method === "POST" && url.pathname.startsWith("/api/actions/")) {
      const parts = url.pathname.split("/")
      const entryId = parts[3]
      const indexText = parts[4]
      if (!entryId || !indexText || parts.length !== 5) return textResponse("Malformed action URL.\n", 404)
      return serveAction(decodeURIComponent(entryId), indexText)
    }
    if (request.method === "GET") return servePublic(url.pathname)
    return textResponse("Method not allowed", 405)
  },
})

console.log(`xanadu listening on http://127.0.0.1:${server.port}`)
