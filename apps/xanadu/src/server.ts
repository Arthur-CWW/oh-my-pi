import { watch } from "node:fs"
import { mkdir, readdir, readFile, writeFile, appendFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"
import {
  actionArgv,
  appendFeedEntry,
  contentTypeForPath,
  FEED_PATH,
  FEED_SCHEMA,
  findFeedAction,
  readFeedFile,
  REPO_ROOT,
  resolveActionCwd,
  resolveArtifactPath,
  type FeedEntry,
} from "./feed.ts"

const PORT = Number.parseInt(process.env.PORT ?? "4970", 10)
const ACTION_TIMEOUT_MS = 600_000
const PUBLIC_DIR = resolve(import.meta.dir, "../public")
export const RUNS_DIR = resolve(REPO_ROOT, "data/xanadu/runs")
const encoder = new TextEncoder()
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>()
const systemLog: SystemLogEntry[] = []
let actionBusy = false
let feedReloadTimer: Timer | null = null

export interface RunRecord {
  readonly id: string
  readonly entryId: string
  readonly actionIndex: number
  readonly argv: readonly string[]
  readonly cwd: string
  readonly start: string
  readonly end?: string
  readonly exitCode?: number
  readonly status: "running" | "ok" | "fail"
}

interface SystemLogEntry {
  readonly ts: string
  readonly level: "warn" | "error"
  readonly message: string
}

interface RunPlan {
  readonly id: string
  readonly path: string
  readonly entryId: string
  readonly actionIndex: number
  readonly argv: readonly string[]
  readonly cwd: string
  readonly start: string
}

await mkdir(dirname(FEED_PATH), { recursive: true })
await mkdir(RUNS_DIR, { recursive: true })

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

function pushSystemLog(level: "warn" | "error", message: string): void {
  const entry = { ts: new Date().toISOString(), level, message }
  systemLog.push(entry)
  if (systemLog.length > 200) systemLog.splice(0, systemLog.length - 200)
  for (const client of [...sseClients]) {
    try {
      sendSse(client, "system", { logs: systemLog, entry })
    } catch {
      sseClients.delete(client)
    }
  }
}

async function currentFeedPayload(): Promise<{ readonly entries: object; readonly runs: readonly RunRecord[]; readonly systemLog: readonly SystemLogEntry[] }> {
  return { entries: await readFeedFile(FEED_PATH, (message) => pushSystemLog("warn", message)), runs: await listRunRecords(), systemLog }
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

async function broadcastRun(run: RunRecord): Promise<void> {
  const runs = await listRunRecords()
  for (const client of [...sseClients]) {
    try {
      sendSse(client, "run", { run, runs })
      if (run.status === "fail") sendSse(client, "failure", { run })
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
    pushSystemLog("warn", `bad artifact path: ${encodedPath}`)
    return textResponse("Bad artifact path", 400)
  }

  const resolvedArtifact = resolveArtifactPath(decodedPath)
  if (!resolvedArtifact) {
    pushSystemLog("warn", `artifact path is not allowed: ${decodedPath}`)
    return textResponse("Artifact path is not allowed", 403)
  }
  const file = Bun.file(resolvedArtifact.absolutePath)
  if (!(await file.exists())) {
    pushSystemLog("warn", `artifact not found: ${resolvedArtifact.repoRelativePath}`)
    return textResponse("Artifact not found", 404)
  }
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

function safeRunId(id: string): boolean {
  return id.length > 0 && !id.includes("/") && !id.includes("\\") && !id.includes("\0") && !id.startsWith(".")
}

function parseRunRecord(id: string, text: string): RunRecord | null {
  const lines = text.split(/\r?\n/)
  const headers = new Map<string, string>()
  for (const line of lines) {
    if (!line.startsWith("# ")) continue
    const index = line.indexOf(":")
    if (index <= 2) continue
    headers.set(line.slice(2, index), line.slice(index + 1).trim())
  }
  const entryId = headers.get("entry-id")
  const actionIndexText = headers.get("action-index")
  const argvText = headers.get("argv")
  const cwd = headers.get("cwd")
  const start = headers.get("start")
  if (!entryId || !actionIndexText || !argvText || !cwd || !start) return null
  const actionIndex = Number.parseInt(actionIndexText, 10)
  if (!Number.isInteger(actionIndex) || actionIndex < 0) return null
  const exitCodeText = headers.get("exit-code")
  const exitCode = exitCodeText ? Number.parseInt(exitCodeText, 10) : undefined
  const end = headers.get("end")
  const status = exitCode === undefined ? "running" : exitCode === 0 ? "ok" : "fail"
  const argv = JSON.parse(argvText) as readonly string[]
  return { id, entryId, actionIndex, argv, cwd, start, ...(end ? { end } : {}), ...(exitCode !== undefined ? { exitCode } : {}), status }
}

export async function listRunRecords(): Promise<readonly RunRecord[]> {
  await mkdir(RUNS_DIR, { recursive: true })
  const records: RunRecord[] = []
  const files = await readdir(RUNS_DIR)
  for (const file of files) {
    if (!file.endsWith(".log")) continue
    const id = file.slice(0, -".log".length)
    const text = await readFile(resolve(RUNS_DIR, file), "utf8")
    const record = parseRunRecord(id, text)
    if (record) records.push(record)
  }
  return records.sort((left, right) => Date.parse(right.start) - Date.parse(left.start))
}

export async function readRunLog(id: string): Promise<string | null> {
  if (!safeRunId(id)) return null
  const records = await listRunRecords()
  if (!records.some((record) => record.id === id)) return null
  return readFile(resolve(RUNS_DIR, `${id}.log`), "utf8")
}

async function nextRunNumber(entryId: string): Promise<number> {
  await mkdir(RUNS_DIR, { recursive: true })
  let max = 0
  for (const file of await readdir(RUNS_DIR)) {
    if (!file.startsWith(`${entryId}-`) || !file.endsWith(".log")) continue
    const numberText = file.slice(entryId.length + 1, -".log".length)
    const number = Number.parseInt(numberText, 10)
    if (Number.isInteger(number) && number > max) max = number
  }
  return max + 1
}

async function createRunPlan(entryId: string, actionIndex: number, argv: readonly string[], cwd: string): Promise<RunPlan | null> {
  if (!safeRunId(entryId)) return null
  const runNumber = await nextRunNumber(entryId)
  const id = `${entryId}-${runNumber}`
  return { id, path: resolve(RUNS_DIR, `${id}.log`), entryId, actionIndex, argv, cwd, start: new Date().toISOString() }
}

function runHeader(run: RunPlan): string {
  return [
    `# run-id: ${run.id}`,
    `# entry-id: ${run.entryId}`,
    `# action-index: ${run.actionIndex}`,
    `# argv: ${JSON.stringify(run.argv)}`,
    `# cwd: ${run.cwd}`,
    `# start: ${run.start}`,
    "",
  ].join("\n")
}

function runFooter(end: string, exitCode: number): string {
  return ["", `# end: ${end}`, `# exit-code: ${exitCode}`, ""].join("\n")
}

async function serveAction(entryId: string, indexText: string): Promise<Response> {
  if (actionBusy) return textResponse("Another Xanadu action is already running. Try again when it finishes.\n", 409)
  const index = Number.parseInt(indexText, 10)
  const lookup = findFeedAction(await readFeedFile(FEED_PATH, (message) => pushSystemLog("warn", message)), entryId, index)
  if (!lookup) return textResponse("Action not found in the feed on disk.\n", 404)

  const cwd = resolveActionCwd(lookup.action.cwd)
  if (!cwd) return textResponse("Action cwd is not repo-relative.\n", 400)

  const argv = actionArgv(lookup.action)
  const runOrNull = await createRunPlan(entryId, index, argv, cwd.absolutePath)
  if (!runOrNull) return textResponse("Action id cannot be used as a run log filename.\n", 400)
  const run = runOrNull
  actionBusy = true

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let timedOut = false
      await writeFile(run.path, runHeader(run))
      await broadcastRun({ id: run.id, entryId: run.entryId, actionIndex: run.actionIndex, argv: run.argv, cwd: run.cwd, start: run.start, status: "running" })
      const child = Bun.spawn([...argv], {
        cwd: cwd.absolutePath,
        stdout: "pipe",
        stderr: "pipe",
      })
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill()
        const chunk = encoder.encode(`\n[xanadu] action timed out after ${ACTION_TIMEOUT_MS / 1000}s\n`)
        controller.enqueue(chunk)
        void appendFile(run.path, chunk)
      }, ACTION_TIMEOUT_MS)

      async function pump(readable: ReadableStream<Uint8Array>): Promise<void> {
        for await (const chunk of readable) {
          controller.enqueue(chunk)
          await appendFile(run.path, chunk)
        }
      }

      try {
        const exitPromise = child.exited
        await Promise.all([pump(child.stdout), pump(child.stderr), exitPromise])
        clearTimeout(timeout)
        const rawExitCode = await exitPromise
        const exitCode = timedOut && rawExitCode === 0 ? 124 : rawExitCode
        const end = new Date().toISOString()
        if (!timedOut) {
          const chunk = encoder.encode(`\n[xanadu] action exited ${exitCode}\n`)
          controller.enqueue(chunk)
          await appendFile(run.path, chunk)
        }
        await appendFile(run.path, runFooter(end, exitCode))
        await broadcastRun({ id: run.id, entryId: run.entryId, actionIndex: run.actionIndex, argv: run.argv, cwd: run.cwd, start: run.start, end, exitCode, status: exitCode === 0 ? "ok" : "fail" })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const end = new Date().toISOString()
        const chunk = encoder.encode(`\n[xanadu] action failed: ${message}\n`)
        controller.enqueue(chunk)
        await appendFile(run.path, chunk)
        await appendFile(run.path, runFooter(end, 1))
        await broadcastRun({ id: run.id, entryId: run.entryId, actionIndex: run.actionIndex, argv: run.argv, cwd: run.cwd, start: run.start, end, exitCode: 1, status: "fail" })
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
      "x-xanadu-run-id": run.id,
    },
  })
}

export function createAnswerEntry(original: FeedEntry, summary: string): FeedEntry {
  return {
    schema: FEED_SCHEMA,
    id: randomUUID(),
    ts: new Date().toISOString(),
    stream: original.stream,
    kind: "decision",
    title: `Re: ${original.title}`,
    summary,
    artifacts: [],
    actions: [],
    links: [{ label: "in reply to", href: `#entry-${original.id}` }],
    needsInput: false,
    tags: original.tags,
    parentId: original.id,
  }
}

async function serveAnswer(entryId: string, request: Request): Promise<Response> {
  const entries = await readFeedFile(FEED_PATH, (message) => pushSystemLog("warn", message))
  const original = entries.find((entry) => entry.id === entryId)
  if (!original) return textResponse("Entry not found.\n", 404)
  const body = (await request.json()) as { readonly summary?: string }
  const summary = body.summary?.trim()
  if (!summary) return textResponse("Answer summary is required.\n", 400)
  const answer = createAnswerEntry(original, summary)
  await appendFeedEntry(answer)
  await broadcastFeed()
  return jsonResponse({ entry: answer }, 201)
}

export async function handleXanaduRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === "GET" && url.pathname === "/api/feed") return jsonResponse(await currentFeedPayload())
  if (request.method === "GET" && url.pathname === "/api/runs") return jsonResponse({ runs: await listRunRecords() })
  if (request.method === "GET" && url.pathname.startsWith("/api/runs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/runs/".length))
    const log = await readRunLog(id)
    return log === null ? textResponse("Run log not found.\n", 404) : textResponse(log)
  }
  if (request.method === "GET" && url.pathname === "/api/system-log") return jsonResponse({ logs: systemLog })
  if (request.method === "GET" && url.pathname === "/api/events") return serveEvents()
  if (request.method === "GET" && url.pathname.startsWith("/artifact/")) return serveArtifact(url.pathname)
  if (request.method === "POST" && url.pathname.startsWith("/api/actions/")) {
    const parts = url.pathname.split("/")
    const entryId = parts[3]
    const indexText = parts[4]
    if (!entryId || !indexText || parts.length !== 5) return textResponse("Malformed action URL.\n", 404)
    return serveAction(decodeURIComponent(entryId), indexText)
  }
  if (request.method === "POST" && url.pathname.startsWith("/api/entries/") && url.pathname.endsWith("/answer")) {
    const parts = url.pathname.split("/")
    const entryId = parts[3]
    if (!entryId || parts.length !== 5) return textResponse("Malformed answer URL.\n", 404)
    return serveAnswer(decodeURIComponent(entryId), request)
  }
  if (request.method === "GET") return servePublic(url.pathname)
  return textResponse("Method not allowed", 405)
}

if (import.meta.main) {
  // idleTimeout: action streams can be silent for minutes while a command runs (Bun caps this at 255s).
  const server = Bun.serve({ port: PORT, fetch: handleXanaduRequest, idleTimeout: 255 })
  console.log(`xanadu listening on http://127.0.0.1:${server.port}`)
}
