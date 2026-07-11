#!/usr/bin/env bun

import { realpathSync } from "node:fs"
import { Buffer } from "node:buffer"
import { appendFile, chmod, mkdir, readdir, stat, unlink } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"

import { Clock, Effect } from "effect"

import { appendMuxLifecycleEvent, type MuxLifecycleEventKind } from "./outbox-events"
import { decodeMuxMessage, encodeMuxMessage, muxDirFor, socketPathFor, type MuxMessage, type MuxState } from "./protocol"
import { daemonLogPathFor, isPidAlive, writeMuxState } from "./state"
import { acquireSessionLease, canonicalSessionIdentity, ownerProofFor, processIdentityFor, type OwnershipHandle } from "./ownership"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const SCROLLBACK_BYTES = 512 * 1024
const FAST_FLAP_MS = 2_000
const SESSION_POLL_INTERVAL_MS = 500
const SESSION_POLL_TIMEOUT_MS = 30_000
const SIGKILL_GRACE_MS = 5_000

interface DaemonArgs {
  readonly name: string
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly sessionFile: string
  readonly sessionId: string
  readonly command: readonly string[]
}

export interface RunDaemonOptions extends DaemonArgs {
  readonly env?: Record<string, string | undefined>
  readonly nowMs?: () => Promise<number>
  readonly sleepMs?: (ms: number) => Promise<void>
  readonly sessionsRoot?: string
}

interface ClientData {
  buffer: string
  mode: "control" | "observe" | null
  clientId: string | null
}

interface ClientHandle {
  readonly socket: Bun.Socket<ClientData>
  readonly clientId: string
}

export class ScrollbackRing {
  private readonly chunks: Uint8Array[] = []
  private byteLength = 0

  constructor(private readonly capacityBytes: number = SCROLLBACK_BYTES) {}

  push(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return
    const chunk = bytes.byteLength > this.capacityBytes ? bytes.slice(bytes.byteLength - this.capacityBytes) : new Uint8Array(bytes)
    this.chunks.push(chunk)
    this.byteLength += chunk.byteLength
    while (this.byteLength > this.capacityBytes) {
      const first = this.chunks[0]
      if (first === undefined) return
      const overflow = this.byteLength - this.capacityBytes
      if (first.byteLength <= overflow) {
        this.chunks.shift()
        this.byteLength -= first.byteLength
      } else {
        this.chunks[0] = first.slice(overflow)
        this.byteLength -= overflow
      }
    }
  }

  replayBytes(): Uint8Array {
    if (this.chunks.length === 0) return new Uint8Array(0)
    if (this.chunks.length === 1) return this.chunks[0] ?? new Uint8Array(0)
    const replay = new Uint8Array(this.byteLength)
    let offset = 0
    for (const chunk of this.chunks) {
      replay.set(chunk, offset)
      offset += chunk.byteLength
    }
    return replay
  }
}

export async function runDaemon(options: RunDaemonOptions): Promise<void> {
  const env = options.env ?? process.env
  const nowMs = options.nowMs ?? defaultNowMs
  const sleepMs = options.sleepMs ?? (async (ms: number) => await Bun.sleep(ms))
  const cwd = resolve(options.cwd)
  const sockPath = socketPathFor(options.name, env)
  const identity = await canonicalSessionIdentity(options.sessionFile, options.sessionId)
  const daemonProcess = await processIdentityFor(process.pid)
  const cmux = { workspaceId: env["CMUX_WORKSPACE_ID"], surfaceId: env["CMUX_SURFACE_ID"], socketPath: env["CMUX_SOCKET_PATH"] }
  const acquired = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: options.name, socketPath: sockPath, controllerProcess: daemonProcess, daemonProcess, cmux, dependencies: { root: env["AGENT_MUX_DIR"] } })
  if (!("epoch" in acquired)) throw new Error(`session ownership refused: ${acquired.classification}`)
  const ownership = acquired
  await mkdir(muxDirFor(options.name, env), { recursive: true })
  const ring = new ScrollbackRing()
  const observers = new Set<Bun.Socket<ClientData>>()
  let activeClient: ClientHandle | null = null
  let childExited = false
  let stopping = false
  let server: { stop(closeActiveConnections?: boolean): void } | null = null
  let stateWrite = Promise.resolve()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  const createdAt = await nowMs()
  let state: MuxState = { name: options.name, status: "starting", daemonPid: process.pid, childPid: 0, cwd, command: [...options.command], ompSessionFile: identity.sessionFile, ompSessionId: identity.sessionId, ownerEpoch: ownership.epoch, heartbeatSeq: 0, heartbeatAtUnixMs: createdAt, exitCode: null, createdAt, lastAttachAt: null }
  const persist = (patch: Partial<MuxState>): Promise<void> => {
    if ((state.status === "exited" || state.status === "failed") && (patch.status === "running-attached" || patch.status === "running-detached" || patch.status === "starting")) return stateWrite
    state = { ...state, ...patch }
    const snapshot = state
    stateWrite = stateWrite.then(() => writeMuxState(snapshot, env), () => writeMuxState(snapshot, env))
    return stateWrite
  }
  const child = Bun.spawn([...options.command], {
    cwd,
    env: { ...process.env, ...env, TERM: "xterm-256color", OMP_SESSION_OWNER_EPOCH: ownership.epoch, OMP_SESSION_OWNER_SOCKET: sockPath },
    onExit(_process, exitCode, signalCode, error) { void childExit(exitCode, signalCode === null ? null : String(signalCode), error) },
    terminal: { cols: options.cols, rows: options.rows, data(_terminal, bytes) { ring.push(bytes); const packet = encodeMuxMessage({ t: "output", data: bytesToBase64(bytes) }); activeClient?.socket.write(packet); for (const observer of observers) observer.write(packet) } },
  })
  const markedRunning = await ownership.markRunning(await processIdentityFor(child.pid), daemonProcess)
  if (!markedRunning && !childExited) { child.kill("SIGTERM"); throw new Error("ownership lost before child startup") }
  if (childExited) { await stateWrite; return }
  await persist({ childPid: child.pid, status: "running-detached" })
  await heartbeat()
  await appendLifecycle("muxSessionStart", null, null)
  server = Bun.listen<ClientData>({
    unix: sockPath,
    socket: {
      open(socket) { socket.data = { buffer: "", mode: null, clientId: null } },
      data(socket, bytes) { socket.data.buffer += new TextDecoder().decode(bytes); const lines = socket.data.buffer.split("\n"); socket.data.buffer = lines.pop() ?? ""; for (const line of lines) if (line.length > 0) void handle(socket, line) },
      close(socket) { observers.delete(socket); if (socket.data.mode === "control" && activeClient?.socket === socket && !stopping) void detach(socket.data.clientId) },
      error() {},
    },
  })
  await chmod(sockPath, 0o600).catch(() => {})
  heartbeatTimer = setInterval(() => void heartbeat(), 2_000)
  process.on("SIGTERM", () => void kill(null))
  process.on("SIGINT", () => void kill(null))
  async function heartbeat(): Promise<void> { if (childExited || !await ownership.heartbeat()) { if (!childExited) await kill(null); return }; const lease = await ownership.lease(); if (lease !== null) await persist({ heartbeatSeq: lease.heartbeatSeq, heartbeatAtUnixMs: lease.heartbeatAtUnixMs }) }
  async function handle(socket: Bun.Socket<ClientData>, line: string): Promise<void> {
    let message: MuxMessage
    try { message = decodeMuxMessage(line) } catch { socket.write(encodeMuxMessage({ t: "deny", reason: "malformed message" })); return }
    if (message.t === "ownerProbe") { const lease = await ownership.lease(); const proof = lease === null ? null : ownerProofFor(lease, message); socket.write(encodeMuxMessage(proof === null ? { t: "deny", reason: "owner proof denied" } : { t: "ownerProof", ...proof })); return }
    if (message.t === "status") { socket.write(encodeMuxMessage({ t: "status", state })); return }
    if (message.t === "attach") {
      if (message.mode === "control" && activeClient !== null && activeClient.socket !== socket) { socket.write(encodeMuxMessage({ t: "deny", reason: "session already has a control client" })); return }
      socket.data.mode = message.mode; socket.data.clientId = message.clientId
      if (message.mode === "observe") observers.add(socket)
      else { activeClient = { socket, clientId: message.clientId }; child.terminal?.resize(message.cols, message.rows); await persist({ status: "running-attached", lastAttachAt: await nowMs() }); await appendLifecycle("muxAttach", message.clientId, null); await heartbeat() }
      if (message.replay !== false) socket.write(encodeMuxMessage({ t: "replay", data: bytesToBase64(ring.replayBytes()) })); return
    }
    const controls = socket.data.mode === "control" && activeClient?.socket === socket
    if (message.t === "input") { if (!controls) socket.write(encodeMuxMessage({ t: "deny", reason: "observer cannot send input" })); else child.terminal?.write(base64ToBytes(message.data)); return }
    if (message.t === "resize") { if (!controls) socket.write(encodeMuxMessage({ t: "deny", reason: "observer cannot resize" })); else child.terminal?.resize(message.cols, message.rows); return }
    if (message.t === "kill") { if (!controls) socket.write(encodeMuxMessage({ t: "deny", reason: "observer cannot kill" })); else await kill(socket.data.clientId); return }
    if (message.t === "detach") { if (controls) await detach(socket.data.clientId); socket.end(); return }
  }
  async function detach(clientId: string | null): Promise<void> { activeClient = null; await persist({ status: "running-detached" }); await appendLifecycle("muxDetach", clientId, null) }
  async function kill(clientId: string | null): Promise<void> { if (stopping) return; stopping = true; await appendLifecycle("muxKill", clientId, null); child.kill("SIGTERM"); await sleepMs(SIGKILL_GRACE_MS); if (!childExited && isPidAlive(child.pid)) child.kill("SIGKILL") }
  async function childExit(exitCode: number | null, signal: string | null, error: unknown): Promise<void> {
    if (childExited) return; childExited = true; stopping = true; if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    if (error !== undefined && error !== null) await appendFile(daemonLogPathFor(options.name, env), `${errorMessage(error)}\n`, "utf8")
    await persist({ status: "exited", exitCode }); await appendLifecycle("muxChildExit", null, exitCode)
    const packet = encodeMuxMessage({ t: "exit", code: exitCode, signal }); activeClient?.socket.write(packet); for (const observer of observers) observer.write(packet)
    server?.stop(true); await unlink(sockPath).catch(() => {}); await stateWrite; await ownership.release(); process.exit(0)
  }
  async function appendLifecycle(kind: MuxLifecycleEventKind, clientId: string | null, exitCode: number | null): Promise<void> { appendMuxLifecycleEvent({ kind, muxName: options.name, cwd, pid: child.pid, nowMs: await nowMs(), ompSessionFile: state.ompSessionFile, clientId, exitCode }) }
}

export async function runDaemonFromArgv(argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
  const parsed = parseDaemonArgs(argv)
  if (parsed instanceof Error) {
    process.stderr.write(`${parsed.message}\n`)
    process.exit(1)
  }
  await runDaemon(parsed)
}

export function parseDaemonArgs(argv: readonly string[]): DaemonArgs | Error {
  let name: string | undefined
  let cwd: string | undefined
  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let sessionFile: string | undefined
  let sessionId: string | undefined
  let commandStart = -1

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--") {
      commandStart = index + 1
      break
    }
    if (arg === "--name") {
      name = argv[index + 1]
      index += 1
    } else if (arg?.startsWith("--name=")) {
      name = arg.slice("--name=".length)
    } else if (arg === "--cwd") {
      cwd = argv[index + 1]
      index += 1
    } else if (arg?.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length)
    } else if (arg === "--cols") {
      cols = Number(argv[index + 1])
      index += 1
    } else if (arg?.startsWith("--cols=")) {
      cols = Number(arg.slice("--cols=".length))
    } else if (arg === "--rows") {
      rows = Number(argv[index + 1])
      index += 1
    } else if (arg?.startsWith("--rows=")) {
      rows = Number(arg.slice("--rows=".length))
    } else if (arg === "--session-file") {
      sessionFile = argv[index + 1]
      index += 1
    } else if (arg === "--session-id") {
      sessionId = argv[index + 1]
      index += 1
    } else {
      return new Error(`unknown daemon option: ${arg}`)
    }
  }

  const command = commandStart >= 0 ? argv.slice(commandStart) : []
  if (name === undefined || name.length === 0) return new Error("missing --name")
  if (cwd === undefined || cwd.length === 0) return new Error("missing --cwd")
  if (sessionFile === undefined || sessionFile.length === 0) return new Error("missing --session-file")
  if (sessionId === undefined || sessionId.length === 0) return new Error("missing --session-id")
  if (!Number.isInteger(cols) || cols <= 0) return new Error("--cols must be a positive integer")
  if (!Number.isInteger(rows) || rows <= 0) return new Error("--rows must be a positive integer")
  if (command.length === 0) return new Error("missing command after --")
  return { name, cwd, cols, rows, sessionFile, sessionId, command }
}

export async function discoverOmpSessionFile(input: {
  readonly cwd: string
  readonly sessionsRoot?: string
  readonly afterMs: number
  readonly nowMs?: () => Promise<number>
  readonly sleepMs?: (ms: number) => Promise<void>
}): Promise<string | null> {
  const nowMs = input.nowMs ?? defaultNowMs
  const sleepMs = input.sleepMs ?? ((ms: number) => Bun.sleep(ms))
  const deadline = (await nowMs()) + SESSION_POLL_TIMEOUT_MS
  const sessionDir = join(input.sessionsRoot ?? join(homedir(), ".omp", "agent", "sessions"), defaultSessionDirName(input.cwd))

  while ((await nowMs()) <= deadline) {
    const newest = await newestSessionJsonl(sessionDir, input.afterMs)
    if (newest !== null) return newest
    await sleepMs(SESSION_POLL_INTERVAL_MS)
  }
  return null
}

async function newestSessionJsonl(sessionDir: string, afterMs: number): Promise<string | null> {
  let entries: readonly string[]
  try {
    entries = await readdir(sessionDir)
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) return null
    throw error
  }

  let newest: { path: string; mtimeMs: number } | null = null
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue
    const path = join(sessionDir, entry)
    const info = await stat(path)
    if (!info.isFile() || info.mtimeMs <= afterMs) continue
    if (newest === null || info.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: info.mtimeMs }
  }
  return newest?.path ?? null
}

function defaultSessionDirName(cwd: string): string {
  const canonicalCwd = canonicalPath(resolve(cwd))
  const homeRelative = relative(canonicalPath(homedir()), canonicalCwd)
  const tempRelative = relative(canonicalPath(tmpdir()), canonicalCwd)
  if (homeRelative === "" || (!homeRelative.startsWith("..") && !isAbsolute(homeRelative))) {
    return encodeRelativeSessionDirName("-", homeRelative)
  }
  if (tempRelative === "" || (!tempRelative.startsWith("..") && !isAbsolute(tempRelative))) {
    return encodeRelativeSessionDirName("-tmp", tempRelative)
  }
  return `--${canonicalCwd.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function encodeRelativeSessionDirName(prefix: string, relativePath: string): string {
  const encoded = relativePath.replace(/[\\/:]/g, "-")
  if (encoded.length === 0) return prefix
  return prefix.endsWith("-") ? `${prefix}${encoded}` : `${prefix}-${encoded}`
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

function base64ToBytes(data: string): Uint8Array {
  return Buffer.from(data, "base64")
}

async function defaultNowMs(): Promise<number> {
  return Effect.runPromise(Clock.currentTimeMillis)
}

async function logLine(path: string, line: string): Promise<void> {
  await appendFile(path, `${line}\n`, "utf8").catch(() => {})
}

function isNodeErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  await runDaemonFromArgv()
}
