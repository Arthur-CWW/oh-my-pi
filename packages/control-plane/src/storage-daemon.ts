#!/usr/bin/env bun

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  inspectStorage,
  maintainStorage,
  type StorageConfig,
  type StorageStatus,
} from "./storage"

const DEFAULT_INTERVAL_MS = 60_000
const MAX_ACTIONS_PER_TICK = 64
const FLEET_TIMEOUT_MS = 5_000
const FLEET_OUTPUT_LIMIT_BYTES = 1024 * 1024
const HEARTBEAT_LIMIT_BYTES = 64 * 1024
const STATE_DIR = join(homedir(), ".agent-control-plane")
const LOCK_PATH = join(STATE_DIR, "storage-daemon.lock")
const HEARTBEAT_PATH = join(STATE_DIR, "storage-health.json")

export interface StorageDaemonOptions {
  readonly intervalMs?: number
  readonly config?: Partial<StorageConfig>
  readonly stateDir?: string
}

interface DaemonLock {
  readonly fd: number
  readonly path: string
  readonly owner: string
}

interface StorageHeartbeat {
  readonly version: 1
  readonly pid: number
  readonly startedAt: string
  readonly heartbeatAt: string
  readonly lastSuccessAt: string | null
  readonly lastError: string | null
  readonly state: "healthy" | "degraded" | "draining"
  readonly backlog: {
    readonly bytes: StorageStatus["bytes"] | null
    readonly segments: StorageStatus["segments"] | null
    readonly reclaimableBytes: StorageStatus["reclaimableBytes"] | null
    readonly pendingActions: number | null
  }
  readonly ingestProgress: StorageStatus["ingestProgress"] | null
  readonly quota: {
    readonly violations: StorageStatus["quotaViolations"]
  }
}

export async function runStorageDaemon(options: StorageDaemonOptions = {}): Promise<number> {
  const stateDir = options.stateDir ?? STATE_DIR
  const lockPath = options.stateDir === undefined ? LOCK_PATH : join(stateDir, "storage-daemon.lock")
  const heartbeatPath = options.stateDir === undefined ? HEARTBEAT_PATH : join(stateDir, "storage-health.json")
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) return 64

  const requestedActions = options.config?.maxActionsPerRun ?? MAX_ACTIONS_PER_TICK
  const config: Partial<StorageConfig> = {
    ...options.config,
    maxActionsPerRun: Math.min(requestedActions, MAX_ACTIONS_PER_TICK),
  }

  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const lock = acquireDaemonLock(lockPath)
  if (lock === undefined) return 75

  const startedAt = new Date().toISOString()
  const stop = new AbortController()
  const requestStop = (): void => stop.abort()
  process.once("SIGINT", requestStop)
  process.once("SIGTERM", requestStop)

  let snapshot: StorageStatus | undefined
  let lastSuccessAt: string | null = null
  let lastError: string | null = null
  let exitCode = 0

  try {
    while (!stop.signal.aborted) {
      try {
        const activeSessionIds = await discoverActiveSessionIds()
        const result = await maintainStorage({ config, mode: "apply", activeSessionIds })
        snapshot = result.after
        lastSuccessAt = new Date().toISOString()
        lastError = null
      } catch (cause) {
        lastError = sanitizeErrorCode(cause, "storage_maintenance_failed")
        try {
          snapshot = inspectStorage(config, undefined)
        } catch (inspectionCause) {
          lastError = sanitizeErrorCode(inspectionCause, "storage_inspection_failed")
        }
      }

      try {
        writeHeartbeat(heartbeatPath, makeHeartbeat({
          snapshot,
          startedAt,
          lastSuccessAt,
          lastError,
          draining: false,
        }))
      } catch {
        exitCode = 1
        break
      }

      await waitForNextTick(intervalMs, stop.signal)
    }

    try {
      writeHeartbeat(heartbeatPath, makeHeartbeat({
        snapshot,
        startedAt,
        lastSuccessAt,
        lastError,
        draining: true,
      }))
    } catch {
      exitCode = 1
    }
    return exitCode
  } finally {
    process.off("SIGINT", requestStop)
    process.off("SIGTERM", requestStop)
    releaseDaemonLock(lock)
  }
}

function acquireDaemonLock(path: string): DaemonLock | undefined {
  let fd = tryCreateDaemonLock(path)
  if (fd === undefined) {
    if (!reclaimDeadDaemonLock(path)) return undefined
    fd = tryCreateDaemonLock(path)
    if (fd === undefined) return undefined
  }

  const owner = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n"
  try {
    writeFileSync(fd, owner, { encoding: "utf8" })
    fsyncSync(fd)
    return { fd, path, owner }
  } catch (cause) {
    closeSync(fd)
    try {
      unlinkSync(path)
    } catch {
      // The original lock creation failure is authoritative.
    }
    throw cause
  }
}

function tryCreateDaemonLock(path: string): number | undefined {
  try {
    return openSync(path, "wx", 0o600)
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "EEXIST") return undefined
    throw cause
  }
}

function reclaimDeadDaemonLock(path: string): boolean {
  let owner: string
  try {
    owner = readFileSync(path, "utf8")
  } catch {
    return false
  }

  const pid = parseDaemonLockPid(owner)
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (cause) {
    if (typeof cause !== "object" || cause === null || Reflect.get(cause, "code") !== "ESRCH") return false
  }

  try {
    if (readFileSync(path, "utf8") !== owner) return false
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

function parseDaemonLockPid(text: string): number | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const pid = Reflect.get(value, "pid")
  return Number.isSafeInteger(pid) && (pid as number) > 0 ? pid as number : undefined
}

function releaseDaemonLock(lock: DaemonLock): void {
  closeSync(lock.fd)
  try {
    if (readFileSync(lock.path, "utf8") !== lock.owner) return
    unlinkSync(lock.path)
  } catch {
    // The daemon is already drained; a missing or replaced lock is not ours to remove.
  }
}

interface HeartbeatInput {
  readonly snapshot: StorageStatus | undefined
  readonly startedAt: string
  readonly lastSuccessAt: string | null
  readonly lastError: string | null
  readonly draining: boolean
}

function makeHeartbeat(input: HeartbeatInput): StorageHeartbeat {
  const degraded = input.lastError !== null
    || (input.snapshot !== undefined && (
      input.snapshot.quotaViolations.length > 0
      || input.snapshot.corruptionErrors.length > 0
      || input.snapshot.healthErrors.length > 0
    ))

  return {
    version: 1,
    pid: process.pid,
    startedAt: input.startedAt,
    heartbeatAt: new Date().toISOString(),
    lastSuccessAt: input.lastSuccessAt,
    lastError: input.lastError,
    state: input.draining ? "draining" : degraded ? "degraded" : "healthy",
    backlog: {
      bytes: input.snapshot?.bytes ?? null,
      segments: input.snapshot?.segments ?? null,
      reclaimableBytes: input.snapshot?.reclaimableBytes ?? null,
      pendingActions: input.snapshot?.actions.length ?? null,
    },
    ingestProgress: input.snapshot?.ingestProgress ?? null,
    quota: {
      violations: input.snapshot?.quotaViolations ?? [],
    },
  }
}

function writeHeartbeat(path: string, heartbeat: StorageHeartbeat): void {
  const text = JSON.stringify(heartbeat) + "\n"
  if (Buffer.byteLength(text, "utf8") > HEARTBEAT_LIMIT_BYTES) {
    throw new Error("storage heartbeat exceeds size limit")
  }

  const temporaryPath = `${path}.tmp-${process.pid}`
  const fd = openSync(temporaryPath, "w", 0o600)
  try {
    writeFileSync(fd, text, { encoding: "utf8" })
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporaryPath, path)

  const directoryFd = openSync(dirname(path), "r")
  try {
    fsyncSync(directoryFd)
  } finally {
    closeSync(directoryFd)
  }
}

async function waitForNextTick(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, intervalMs)
    signal.addEventListener("abort", finish, { once: true })
  })
}

async function discoverActiveSessionIds(): Promise<readonly string[] | undefined> {
  let subprocess: Bun.Subprocess<"ignore", "pipe", "ignore">
  try {
    subprocess = Bun.spawn(["omp", "fleet", "overview", "--json"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
  } catch {
    return undefined
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const timedOut = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), FLEET_TIMEOUT_MS)
    })
    const completed = Promise.all([subprocess.exited, readBoundedText(subprocess.stdout)])
    const outcome = await Promise.race([completed, timedOut])
    if (outcome === null) {
      try {
        subprocess.kill()
      } catch {
        return undefined
      }
      return undefined
    }

    const [exitCode, text] = outcome
    if (exitCode !== 0) return undefined

    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return undefined
    }
    if (!Array.isArray(value)) return undefined

    const ids = new Set<string>()
    for (const record of value) {
      if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined
      const sessionId = Reflect.get(record, "session_id")
      if (typeof sessionId !== "string" || sessionId.length === 0) return undefined
      ids.add(sessionId)
    }
    return [...ids].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  } catch {
    try {
      subprocess.kill()
    } catch {
      return undefined
    }
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

async function readBoundedText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let byteCount = 0
  let text = ""
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      byteCount += result.value.byteLength
      if (byteCount > FLEET_OUTPUT_LIMIT_BYTES) throw new Error("fleet output limit exceeded")
      text += decoder.decode(result.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function sanitizeErrorCode(cause: unknown, fallback: string): string {
  if (typeof cause !== "object" || cause === null) return fallback
  const code = Reflect.get(cause, "code")
  if (typeof code === "string" && code.length > 0 && code.length <= 80 && /^[A-Za-z0-9_.:-]+$/.test(code)) {
    return code
  }
  const name = Reflect.get(cause, "name")
  return typeof name === "string" && name.length > 0 && name.length <= 80 && /^[A-Za-z0-9_.:-]+$/.test(name)
    ? name
    : fallback
}

if (import.meta.main) {
  runStorageDaemon().then((exitCode) => {
    process.exitCode = exitCode
  }).catch(() => {
    process.exitCode = 1
  })
}
