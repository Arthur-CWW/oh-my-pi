import {
  appendErrorLog,
  defaultPaths,
  parseOverviewJson,
  pathsAt,
  readRegisterSnapshot,
  readStateDoc,
  toFleetOverviewApiRow,
  type FleetBoardPaths,
  type FleetOverviewApiRow,
  type RegisterCard,
  type RegisterSnapshot,
} from "./data"

export interface FleetPayload {
  readonly generatedAt: string
  readonly sessions: readonly FleetOverviewApiRow[]
}
export interface CardsPayload {
  readonly cards: readonly RegisterCard[]
}

export type OverviewRunner = (binary: string) => Promise<string>

export interface FleetBoardServerOptions {
  readonly paths?: FleetBoardPaths
  readonly ompBin?: string
  readonly now?: () => number
  readonly runOverview?: OverviewRunner
}

export type RequestHandler = (request: Request) => Promise<Response>

const CACHE_WINDOW_MS = 5_000
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runOverview(binary: string): Promise<string> {
  const process = Bun.spawn([binary, "fleet", "overview", "--json"], {
    stderr: "pipe",
    stdout: "pipe",
  })
  const stdoutPromise = new Response(process.stdout).text()
  const stderrPromise = new Response(process.stderr).text()
  const [exitCode, stdout, stderr] = await Promise.all([process.exited, stdoutPromise, stderrPromise])
  if (exitCode !== 0) {
    throw new Error(`omp fleet overview exited ${exitCode}: ${stderr.trim() || "unknown error"}`)
  }
  return stdout
}

function safeStaticPath(publicDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes("\\") || decoded.split("/").some(segment => segment === "..")) return null
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "")
  const root = publicDir.endsWith("/") ? publicDir.slice(0, -1) : publicDir
  const candidate = `${root}/${relative}`
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return null
  return candidate
}

async function staticResponse(publicDir: string, pathname: string): Promise<Response> {
  const filePath = safeStaticPath(publicDir, pathname)
  if (!filePath) return new Response("Not found", { status: 404 })
  const file = Bun.file(filePath)
  if (!(await file.exists())) return new Response("Not found", { status: 404 })
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  const contentType = STATIC_CONTENT_TYPES[extension] ?? "application/octet-stream"
  return new Response(file, { headers: { "content-type": contentType } })
}

export function createRequestHandler(options: FleetBoardServerOptions = {}): RequestHandler {
  const paths = options.paths ?? defaultPaths()
  const ompBin = options.ompBin ?? process.env.OMP_BIN ?? "omp"
  const uiDistDir = `${paths.repoRoot}/packages/fleet-board/ui/dist`
  const now = options.now ?? Date.now
  const overviewRunner = options.runOverview ?? runOverview
  let fleetCache: FleetPayload | undefined
  let fleetFetchedAt = 0
  let fleetPending: Promise<FleetPayload> | undefined
  let cardsCache: RegisterSnapshot | undefined
  let cardsPending: Promise<RegisterSnapshot> | undefined

  const loadFleet = async (): Promise<FleetPayload> => {
    const timestamp = now()
    if (fleetCache && timestamp - fleetFetchedAt < CACHE_WINDOW_MS) return fleetCache
    if (fleetPending) return fleetPending
    fleetPending = (async () => {
      const rows = parseOverviewJson(await overviewRunner(ompBin))
      const payload: FleetPayload = {
        generatedAt: new Date(now()).toISOString(),
        sessions: rows.map(toFleetOverviewApiRow),
      }
      fleetCache = payload
      fleetFetchedAt = now()
      return payload
    })()
    try {
      return await fleetPending
    } finally {
      fleetPending = undefined
    }
  }

  const loadCards = async (): Promise<CardsPayload> => {
    if (cardsPending) return { cards: (await cardsPending).cards }
    cardsPending = (async () => {
      const current = await readRegisterSnapshot(paths.registerPath)
      if (cardsCache && cardsCache.mtimeMs === current.mtimeMs && cardsCache.size === current.size) return cardsCache
      cardsCache = current
      return current
    })()
    try {
      return { cards: (await cardsPending).cards }
    } finally {
      cardsPending = undefined
    }
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    try {
      if (request.method === "GET" && url.pathname === "/healthz") return new Response("ok")
      if (request.method === "GET" && url.pathname === "/api/fleet") return jsonResponse(await loadFleet())
      if (request.method === "GET" && url.pathname === "/api/cards") return jsonResponse(await loadCards())
      if (request.method === "GET" && url.pathname.startsWith("/api/statedoc/")) {
        const encodedSessionId = url.pathname.slice("/api/statedoc/".length)
        let sessionId: string
        try {
          sessionId = decodeURIComponent(encodedSessionId)
        } catch {
          return new Response("Not found", { status: 404 })
        }
        if (!sessionId || sessionId.includes("/")) return new Response("Not found", { status: 404 })
        const markdown = await readStateDoc(paths, sessionId)
        return markdown === null ? new Response("Not found", { status: 404 }) : jsonResponse({ markdown })
      }
      if (request.method === "POST" && url.pathname === "/client-error") {
        const body = await request.text()
        await appendErrorLog(paths.errorLogPath, "client-error", body || "empty client error")
        return new Response(null, { status: 204 })
      }
      if (request.method === "GET") {
        return staticResponse(uiDistDir, url.pathname)
      }
      return new Response("Not found", { status: 404 })
    } catch (error) {
      await appendErrorLog(paths.errorLogPath, `${request.method} ${url.pathname}`, error)
      return jsonResponse({ error: errorMessage(error) }, 500)
    }
  }
}

export interface RunningFleetBoardServer {
  readonly server: Bun.Server<unknown>
}

export function startServer(options: FleetBoardServerOptions = {}): RunningFleetBoardServer {
  const handler = createRequestHandler(options)
  const portText = process.env.PORT ?? process.env.FLEET_BOARD_PORT ?? "1355"
  const port = Number(portText)
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid fleet board port: ${portText}`)
  return { server: Bun.serve({ fetch: handler, port }) }
}

if (import.meta.main) startServer()

export { defaultPaths, pathsAt }
