import { createHash } from "node:crypto"
import {
  appendFileSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { Effect, Schema } from "effect"

import { ingestOutbox } from "./ingest"
import { defaultLedgerPath, openLedger } from "./ledger"
import { defaultOutboxDir } from "./outbox"

const DEFAULT_POLL_INTERVAL_MS = 250
const DEFAULT_BATCH_SIZE = 500
const DEFAULT_RETRY_LIMIT = 3
const DEFAULT_RETRY_DELAY_MS = 100

export interface IngestDaemonOptions {
  readonly outboxDir?: string
  readonly dbPath?: string
  readonly cursorPath?: string
  readonly errorLogPath?: string
  readonly batchSize?: number
  readonly pollIntervalMs?: number
  readonly retryLimit?: number
  readonly retryDelayMs?: number
}

export interface DaemonFileStatus {
  readonly path: string
  readonly cursor: number
  readonly size: number
  readonly inode: number
  readonly device: number
}

export interface IngestDaemonStatus {
  readonly running: boolean
  readonly draining: boolean
  readonly scans: number
  readonly files: readonly DaemonFileStatus[]
  readonly lastError?: string
}

export interface IngestDaemon {
  readonly start: () => void
  readonly scan: () => Promise<void>
  readonly stop: () => Promise<void>
  readonly status: () => IngestDaemonStatus
}

interface CursorFileV1 {
  readonly device: number
  readonly inode: number
  readonly offset: number
  readonly modifiedAt: number
}

export interface CursorFileV2 extends CursorFileV1 {
  readonly sha256: string
}

interface CursorState {
  readonly version: 2
  readonly files: Record<string, CursorFileV2>
}

interface FileSnapshot {
  readonly path: string
  readonly device: number
  readonly inode: number
  readonly size: number
  readonly modifiedAt: number
}

interface RuntimeState {
  running: boolean
  draining: boolean
  scans: number
  lastError?: string
  active?: Promise<void>
}

interface FiberFailure extends Error {
  readonly cause?: {
    readonly reasons?: readonly {
      readonly _tag?: string
      readonly error?: {
        readonly _tag?: string
      }
    }[]
  }
}

const CursorFileV1Schema = Schema.Struct({
  device: Schema.Number,
  inode: Schema.Number,
  offset: Schema.Number,
  modifiedAt: Schema.Number,
})

const CursorFileV2Schema = Schema.Struct({
  device: Schema.Number,
  inode: Schema.Number,
  offset: Schema.Number,
  modifiedAt: Schema.Number,
  sha256: Schema.String,
})

const CursorStateV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  files: Schema.Record(Schema.String, CursorFileV1Schema),
})

const CursorStateV2Schema = Schema.Struct({
  version: Schema.Literal(2),
  files: Schema.Record(Schema.String, CursorFileV2Schema),
})

/** Creates a supervised, single-writer outbox ingester. */
export function createIngestDaemon(options: IngestDaemonOptions = {}): IngestDaemon {
  const outboxDir = options.outboxDir ?? defaultOutboxDir()
  const dbPath = options.dbPath ?? defaultLedgerPath()
  const cursorPath = options.cursorPath ?? join(homedir(), ".agent-control-plane", "ingest-cursors.json")
  const errorLogPath = options.errorLogPath ?? join("data", "control-plane", "errors.log")
  const batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE)
  const pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
  const retryLimit = nonNegativeInteger(options.retryLimit, DEFAULT_RETRY_LIMIT)
  const retryDelayMs = positiveInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS)
  let cursors = readCursors(cursorPath)
  const state: RuntimeState = { running: false, draining: false, scans: 0 }

  const scan = (): Promise<void> => {
    if (state.active !== undefined) return state.active
    state.active = scanOnce().finally((): void => {
      state.active = undefined
    })
    return state.active
  }

  const schedule = (): void => {
    if (!state.running) return
    setTimeout((): void => {
      if (!state.running) return
      void scan().finally(schedule)
    }, pollIntervalMs)
  }

  const start = (): void => {
    if (state.running) return
    state.running = true
    void scan().finally(schedule)
  }

  const stop = async (): Promise<void> => {
    state.running = false
    state.draining = true
    while (state.active !== undefined) {
      await state.active
    }
    await scan()
    state.draining = false
  }

  const status = (): IngestDaemonStatus => ({
    running: state.running,
    draining: state.draining,
    scans: state.scans,
    files: snapshots(outboxDir).map((file): DaemonFileStatus => ({
      path: file.path,
      cursor: cursors.files[file.path]?.offset ?? 0,
      size: file.size,
      inode: file.inode,
      device: file.device,
    })),
    lastError: state.lastError,
  })
  const scanOnce = async (): Promise<void> => {
    state.scans += 1
    let files: readonly FileSnapshot[]
    try {
      files = snapshots(outboxDir)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      reportFailure(errorLogPath, "discover", outboxDir, failure)
      state.lastError = failure.message
      return
    }

    for (const file of files) {
      if (!requiresIngest(file, cursors.files[file.path])) continue
      const complete = completePrefix(file.path, file.size)
      if (complete.offset === 0) continue
      const completed = await ingestWithRetry(file, complete.offset)
      if (!completed) continue
      const current = snapshot(file.path)
      if (
        current.device !== file.device ||
        current.inode !== file.inode ||
        current.size !== file.size ||
        current.modifiedAt !== file.modifiedAt
      ) continue
      cursors = {
        version: 2,
        files: {
          ...cursors.files,
          [file.path]: {
            device: file.device,
            inode: file.inode,
            offset: complete.offset,
            modifiedAt: file.modifiedAt,
            sha256: complete.sha256,
          },
        },
      }
      try {
        writeCursors(cursorPath, cursors)
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        reportFailure(errorLogPath, "persistCursor", file.path, failure)
        state.lastError = failure.message
      }
    }
  }

  const ingestWithRetry = async (file: FileSnapshot, endOffset: number): Promise<boolean> => {
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      try {
        await Effect.runPromise(ingestOutbox(file.path, {
          batchSize,
          endOffset,
        }).pipe(Effect.provide(openLedger(dbPath))))
        return true
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        if (attempt === retryLimit) {
          reportFailure(errorLogPath, "ingest", file.path, failure)
          state.lastError = failure.message
          return false
        }
        await Bun.sleep(retryDelayMs * (attempt + 1))
      }
    }
    return false
  }

  return { start, scan, stop, status }
}

function snapshots(outboxDir: string): readonly FileSnapshot[] {
  return [...snapshotDirectory(outboxDir), ...snapshotDirectory(join(outboxDir, "sealed"))]
    .sort((left, right): number => left.path.localeCompare(right.path))
}

function snapshotDirectory(dir: string): readonly FileSnapshot[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry): boolean => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry): FileSnapshot => snapshot(join(dir, entry.name)))
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) return []
    throw error
  }
}

function snapshot(path: string): FileSnapshot {
  const stat = statSync(path)
  return { path, device: stat.dev, inode: stat.ino, size: stat.size, modifiedAt: stat.mtimeMs }
}

function requiresIngest(file: FileSnapshot, cursor: CursorFileV2 | undefined): boolean {
  if (cursor === undefined) return file.size > 0
  if (cursor.device !== file.device || cursor.inode !== file.inode) return file.size > 0
  return file.size !== cursor.offset || file.modifiedAt !== cursor.modifiedAt
}

function readCursors(path: string): CursorState {
  try {
    const input: unknown = JSON.parse(readFileSync(path, "utf8"))
    const current = Schema.decodeUnknownOption(CursorStateV2Schema)(input)
    if (current._tag === "Some") return current.value
    // A v1 cursor remains usable for ingestion progress, but intentionally carries
    // no prune-proof digest and is therefore omitted from the v2 state.
    const legacy = Schema.decodeUnknownOption(CursorStateV1Schema)(input)
    if (legacy._tag === "Some") return { version: 2, files: {} }
  } catch {
    // Corrupt cursor state is treated as absent and rebuilt by ingestion.
  }
  return { version: 2, files: {} }
}

function writeCursors(path: string, cursors: CursorState): void {
  mkdirSync(dirname(path), { recursive: true })
  const content = JSON.stringify(cursors)
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 12)
  const temporaryPath = `${path}.${process.pid}.${digest}.tmp`
  const descriptor = openSync(temporaryPath, "wx", 0o600)
  try {
    writeFileSync(descriptor, content, "utf8")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporaryPath, path)
  fsyncDirectory(dirname(path))
}

function completePrefix(path: string, size: number): { readonly offset: number; readonly sha256: string } {
  const descriptor = openSync(path, "r")
  try {
    const scan = Buffer.allocUnsafe(64 * 1024)
    let end = size
    let offset = 0
    while (end > 0 && offset === 0) {
      const start = Math.max(0, end - scan.byteLength)
      const count = readSync(descriptor, scan, 0, end - start, start)
      for (let index = count - 1; index >= 0; index -= 1) {
        if (scan[index] === 0x0a) {
          offset = start + index + 1
          break
        }
      }
      end = start
    }
    const hash = createHash("sha256")
    let position = 0
    while (position < offset) {
      const count = readSync(descriptor, scan, 0, Math.min(scan.byteLength, offset - position), position)
      if (count === 0) throw new Error(`Unexpected EOF while hashing ${path}`)
      hash.update(scan.subarray(0, count))
      position += count
    }
    return { offset, sha256: hash.digest("hex") }
  } finally {
    closeSync(descriptor)
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
function reportFailure(logPath: string, operation: string, path: string, error: Error): void {
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${JSON.stringify({ ts: Date.now(), operation, path, type: failureType(error), message: error.message })}\n`, "utf8")
}

function failureType(error: Error): string {
  const fiberFailure = error as FiberFailure
  const failure = fiberFailure.cause?.reasons?.find((reason): boolean => reason._tag === "Fail")
  if (failure?.error?._tag !== undefined) return failure.error._tag
  const typedFailure = /ArtifactError|StorageError/.exec(`${error.name}: ${error.message}\n${error.stack ?? ""}`)
  return typedFailure?.[0] ?? error.name
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(1, Math.floor(value))
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(0, Math.floor(value))
}

async function runDaemon(): Promise<void> {
  const daemon = createIngestDaemon()
  daemon.start()
  const stop = async (): Promise<void> => {
    await daemon.stop()
    process.exitCode = 0
  }
  process.once("SIGINT", (): void => { void stop() })
  process.once("SIGTERM", (): void => { void stop() })
}

if (import.meta.main) {
  void runDaemon()
}
