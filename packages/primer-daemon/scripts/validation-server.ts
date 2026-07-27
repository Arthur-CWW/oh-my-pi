/**
 * Real Primer HTTP server for validation cells.
 *
 * Mounts the production reader and card route handlers on a loopback socket
 * with an operating-system assigned port and a fixed-sequence logical clock.
 * It deliberately does not boot `startDashboard`: that aggregate also starts
 * the browser-context runtime, and this cell declares its browser layer
 * skipped. Everything a cell asserts on — reading docs and marks, the queue,
 * card intake/approval/enrollment, the scheduler, and review events — is the
 * same production code the dashboard mounts.
 */
import { handleCardApi } from "../src/card-api"
import { resolveDaemonPaths } from "../src/paths"
import { handleReaderApi } from "../src/reader-api"

const startValue = process.env.PRIMER_VALIDATION_CLOCK_START
const stepValue = process.env.PRIMER_VALIDATION_CLOCK_STEP_MS
if (startValue === undefined || stepValue === undefined) {
  throw new Error("validation server requires a logical-clock start and step")
}

const startMs = Date.parse(startValue)
const stepMs = Number(stepValue)
if (!Number.isFinite(startMs) || !Number.isSafeInteger(stepMs) || stepMs <= 0) {
  throw new Error("validation server received an invalid logical clock")
}

let tick = 0
const clock = (): Date => {
  const value = new Date(startMs + tick * stepMs)
  tick += 1
  return value
}

const paths = resolveDaemonPaths(process.env)
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    try {
      const readerApiResponse = await handleReaderApi(request, paths, clock)
      if (readerApiResponse !== null) return readerApiResponse
      const cardApiResponse = await handleCardApi(request, url, paths, clock)
      if (cardApiResponse !== null) return cardApiResponse
      return Response.json({ error: "not found" }, { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal server error"
      process.stderr.write(`${request.method} ${url.pathname}: ${message}\n`)
      return Response.json({ error: message }, { status: 500 })
    }
  },
})

process.stdout.write(`${JSON.stringify({ type: "primer-validation-ready", pid: process.pid, port: server.port })}\n`)

let stopping = false
async function stop(exitCode: number): Promise<void> {
  if (stopping) return
  stopping = true
  await server.stop(true)
  process.exit(exitCode)
}

process.on("SIGTERM", () => {
  void stop(0)
})
process.on("SIGINT", () => {
  void stop(130)
})
