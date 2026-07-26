import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { hostname } from "node:os"
import { join, resolve } from "node:path"
import { dlopen, FFIType, ptr } from "bun:ffi"

import {
  contentObjectPathFor,
  defaultRawCaptureDir,
  MAX_RAW_CAPTURE_INPUT_BYTES,
  type JsonValue,
  type RawContentReferenceV1,
} from "./outbox"
const posix = dlopen(process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6", {
  openat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32],
    returns: FFIType.i32,
  },
  mkdirat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  linkat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
  unlinkat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
})


export const MAX_RAW_CAPTURE_QUOTA_BYTES = 256 * 1024 * 1024
const DEFAULT_RAW_QUOTA_BYTES = MAX_RAW_CAPTURE_QUOTA_BYTES
const LOCK_STALE_MS = 60_000

interface CaptureLockOwnerV1 {
  readonly v: 1
  readonly host: string
  readonly pid: number
  readonly createdAt: number
}

export interface RawCaptureConfig {
  readonly enabled: boolean
  readonly dir: string
  readonly quotaBytes: number
  readonly maxCaptureBytes: number
  readonly beforeObjectCommit?: () => void
}

export type RawCaptureStatus =
  | "unsupported"
  | "digest-only"
  | "stored"
  | "duplicate"
  | "quota-exceeded"
  | "payload-too-large"
  | "serialization-failed"
  | "capture-failed"

export interface RawCaptureResult {
  readonly sha256: string
  readonly bytes: number
  readonly representation: "json-utf8"
  readonly status: RawCaptureStatus
  readonly reference?: RawContentReferenceV1
  readonly artifactPath?: string
  readonly artifactId?: string
}

export function defaultRawCaptureConfig(env: Record<string, string | undefined> = process.env): RawCaptureConfig {
  return {
    enabled: env["AGENT_CONTROL_PLANE_RAW_CAPTURE"] !== "0",
    dir: defaultRawCaptureDir(env),
    quotaBytes: boundedPositiveInteger(
      env["AGENT_CONTROL_PLANE_RAW_QUOTA_BYTES"],
      DEFAULT_RAW_QUOTA_BYTES,
      MAX_RAW_CAPTURE_QUOTA_BYTES,
    ),
    maxCaptureBytes: boundedPositiveInteger(
      env["AGENT_CONTROL_PLANE_RAW_MAX_CAPTURE_BYTES"],
      MAX_RAW_CAPTURE_INPUT_BYTES,
      MAX_RAW_CAPTURE_INPUT_BYTES,
    ),
  }
}

/** Total at the callback boundary: failures are returned as bounded metadata. */
export function captureRawProviderPayload(
  payload: JsonValue | undefined,
  _capturedAt: number = Date.now(),
  config: RawCaptureConfig = defaultRawCaptureConfig(),
): RawCaptureResult {
  if (payload === undefined) return digestOnly(Buffer.alloc(0), "unsupported")

  let bytes: Buffer
  try {
    bytes = Buffer.from(canonicalJson(payload), "utf8")
  } catch {
    return digestOnly(Buffer.alloc(0), "serialization-failed")
  }

  const digest = createHash("sha256").update(bytes).digest("hex")
  const base: RawCaptureResult = {
    sha256: digest,
    bytes: bytes.byteLength,
    representation: "json-utf8",
    status: "digest-only",
  }
  if (bytes.byteLength > config.maxCaptureBytes) return { ...base, status: "payload-too-large" }
  if (!config.enabled) return base

  const reference: RawContentReferenceV1 = {
    v: 1,
    algorithm: "sha256",
    digest,
    byteLength: bytes.byteLength,
    contentType: "application/json",
    representation: "json-utf8",
    summary: structuralSummary(payload),
  }
  const objectPath = contentObjectPathFor(config.dir, digest)
  let lockPath: string | undefined
  try {
    ensureSafeRoot(config.dir)
    lockPath = acquireCaptureLock(config.dir)
    if (lockPath === undefined) return { ...base, status: "capture-failed" }

    if (existsSync(objectPath)) {
      verifyObject(objectPath, digest, bytes.byteLength, config.dir)
      return capturedResult(base, reference, objectPath, "duplicate")
    }

    const currentBytes = directoryBytes(config.dir)
    if (currentBytes === undefined) return { ...base, status: "capture-failed" }
    if (currentBytes + bytes.byteLength > config.quotaBytes) return { ...base, status: "quota-exceeded" }

    writeVerifiedObject(objectPath, bytes, digest, config.dir, config.beforeObjectCommit)
    return capturedResult(base, reference, objectPath, "stored")
  } catch {
    return { ...base, status: "capture-failed" }
  } finally {
    if (lockPath !== undefined) {
      try {
        rmSync(lockPath, { recursive: true, force: true })
        fsyncDirectory(config.dir)
      } catch {
        // A failed release remains owner-bound and cannot be stolen while this process lives.
      }
    }
  }
}

export function verifyRawContentReference(rawDir: string, reference: RawContentReferenceV1): string {
  const path = contentObjectPathFor(rawDir, reference.digest)
  verifyObject(path, reference.digest, reference.byteLength, rawDir)
  return path
}

function capturedResult(
  base: RawCaptureResult,
  reference: RawContentReferenceV1,
  artifactPath: string,
  status: "stored" | "duplicate",
): RawCaptureResult {
  return {
    ...base,
    status,
    reference,
    artifactPath,
    artifactId: `artifact_${reference.digest.slice(0, 32)}`,
  }
}

function structuralSummary(value: JsonValue): RawContentReferenceV1["summary"] {
  if (value === null) return { redacted: true, valueType: "null", itemCount: 0 }
  if (Array.isArray(value)) return { redacted: true, valueType: "array", itemCount: value.length }
  if (typeof value === "object") return { redacted: true, valueType: "object", itemCount: Object.keys(value).length }
  const valueType = typeof value
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return { redacted: true, valueType, itemCount: 0 }
  }
  throw new Error("unsupported JSON value")
}

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: JsonValue): JsonValue {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite JSON number")
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  const objectValue = value as { readonly [key: string]: JsonValue }
  const sorted: Record<string, JsonValue> = {}
  for (const key of Object.keys(objectValue).sort()) sorted[key] = canonicalValue(objectValue[key] as JsonValue)
  return sorted
}

function digestOnly(bytes: Uint8Array, status: RawCaptureStatus): RawCaptureResult {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    representation: "json-utf8",
    status,
  }
}

function acquireCaptureLock(root: string): string | undefined {
  const lockPath = join(root, ".capture.lock")
  try {
    mkdirSync(lockPath, { mode: 0o700 })
    initializeCaptureLock(lockPath)
    fsyncDirectory(root)
    return lockPath
  } catch (cause) {
    if (!isAlreadyExists(cause)) return undefined
  }
  try {
    if (!recoverableCaptureLock(lockPath)) return undefined
    rmSync(lockPath, { recursive: true, force: true })
    fsyncDirectory(root)
    mkdirSync(lockPath, { mode: 0o700 })
    initializeCaptureLock(lockPath)
    fsyncDirectory(root)
    return lockPath
  } catch {
    return undefined
  }
}

function initializeCaptureLock(lockPath: string): void {
  const owner: CaptureLockOwnerV1 = {
    v: 1,
    host: hostname(),
    pid: process.pid,
    createdAt: Date.now(),
  }
  const path = join(lockPath, "owner.json")
  try {
    const descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, "utf8")
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    fsyncDirectory(lockPath)
  } catch (cause) {
    rmSync(lockPath, { recursive: true, force: true })
    throw cause
  }
}

function recoverableCaptureLock(lockPath: string): boolean {
  const owner = readCaptureLockOwner(join(lockPath, "owner.json"))
  if (owner === undefined || owner.host !== hostname()) return false
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM") {
      return false
    }
  }
  return Date.now() - owner.createdAt > LOCK_STALE_MS
}

function readCaptureLockOwner(path: string): CaptureLockOwnerV1 | undefined {
  let descriptor: number
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    return undefined
  }
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size <= 0 || before.size > 4_096) return undefined
    const bytes = Buffer.allocUnsafe(before.size)
    let position = 0
    while (position < bytes.length) {
      const count = readSync(descriptor, bytes, position, bytes.length - position, position)
      if (count === 0) return undefined
      position += count
    }
    const after = fstatSync(descriptor)
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return undefined
    const value: unknown = JSON.parse(bytes.toString("utf8"))
    if (typeof value !== "object" || value === null || !("v" in value) || value.v !== 1 ||
        !("host" in value) || typeof value.host !== "string" || !("pid" in value) ||
        typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
        !("createdAt" in value) || typeof value.createdAt !== "number" ||
        !Number.isFinite(value.createdAt)) return undefined
    return value as unknown as CaptureLockOwnerV1
  } catch {
    return undefined
  } finally {
    closeSync(descriptor)
  }
}

function ensureSafeRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const resolvedRoot = resolve(root)
  const metadata = lstatSync(resolvedRoot)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(resolvedRoot) !== resolvedRoot) {
    throw new Error(`Raw capture root is not a real directory: ${root}`)
  }
}

function verifyObject(path: string, digest: string, byteLength: number, root: string): void {
  if (resolve(path) !== resolve(contentObjectPathFor(root, digest))) {
    throw new Error("raw capture CAS path mismatch")
  }
  withObjectDirectory(root, digest, false, (directoryDescriptor, objectName) => {
    verifyObjectAt(directoryDescriptor, objectName, digest, byteLength)
  })
}

function writeVerifiedObject(
  path: string,
  bytes: Uint8Array,
  digest: string,
  root: string,
  beforeObjectCommit: (() => void) | undefined,
): void {
  if (resolve(path) !== resolve(contentObjectPathFor(root, digest))) {
    throw new Error("raw capture CAS path mismatch")
  }
  withObjectDirectory(root, digest, true, (directoryDescriptor, objectName) => {
    const temporaryName = `.${digest}.${process.pid}.${randomUUID()}.tmp`
    const descriptor = openAt(
      directoryDescriptor,
      temporaryName,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    fchmodSync(descriptor, 0o600)
    try {
      writeFileSync(descriptor, bytes)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    try {
      verifyObjectAt(directoryDescriptor, temporaryName, digest, bytes.byteLength)
      beforeObjectCommit?.()
      const linked = posix.symbols.linkat(
        directoryDescriptor,
        ptr(cPath(temporaryName)),
        directoryDescriptor,
        ptr(cPath(objectName)),
        0,
      )
      const created = linked === 0
      try {
        verifyObjectAt(directoryDescriptor, objectName, digest, bytes.byteLength)
        assertCanonicalObjectDirectory(root, digest, directoryDescriptor)
      } catch (cause) {
        if (created) {
          try { unlinkAt(directoryDescriptor, objectName) } catch { /* preserve original failure */ }
        }
        throw cause
      }
      unlinkAt(directoryDescriptor, temporaryName)
      fsyncSync(directoryDescriptor)
    } catch (cause) {
      try { unlinkAt(directoryDescriptor, temporaryName) } catch { /* preserve original failure */ }
      throw cause
    }
  })
}

function withObjectDirectory<T>(
  root: string,
  digest: string,
  create: boolean,
  operation: (directoryDescriptor: number, objectName: string) => T,
): T {
  if (create) ensureSafeRoot(root)
  const resolvedRoot = resolve(root)
  const before = lstatSync(resolvedRoot)
  if (!before.isDirectory() || before.isSymbolicLink() || realpathSync(resolvedRoot) !== resolvedRoot) {
    throw new Error(`Raw capture root is not a real directory: ${root}`)
  }
  const descriptors: number[] = []
  try {
    const rootDescriptor = openSync(
      resolvedRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    descriptors.push(rootDescriptor)
    const openedRoot = fstatSync(rootDescriptor)
    if (!openedRoot.isDirectory() || openedRoot.dev !== before.dev || openedRoot.ino !== before.ino ||
        realpathSync(resolvedRoot) !== resolvedRoot) {
      throw new Error(`Raw capture root changed while opening: ${root}`)
    }
    let parent = rootDescriptor
    for (const component of ["objects", "sha256", digest.slice(0, 2)]) {
      parent = openDirectoryAt(parent, component, create)
      descriptors.push(parent)
    }
    return operation(parent, `${digest}.json`)
  } finally {
    for (let index = descriptors.length - 1; index >= 0; index -= 1) {
      const descriptor = descriptors[index]
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }
}

function assertCanonicalObjectDirectory(root: string, digest: string, expectedDescriptor: number): void {
  const descriptors: number[] = []
  try {
    let parent = openSync(
      resolve(root),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    descriptors.push(parent)
    for (const component of ["objects", "sha256", digest.slice(0, 2)]) {
      parent = openDirectoryAt(parent, component, false)
      descriptors.push(parent)
    }
    const expected = fstatSync(expectedDescriptor)
    const current = fstatSync(parent)
    if (expected.dev !== current.dev || expected.ino !== current.ino) {
      throw new Error("Raw capture object directory changed before commit")
    }
  } finally {
    for (let index = descriptors.length - 1; index >= 0; index -= 1) {
      const descriptor = descriptors[index]
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }
}

function openDirectoryAt(parent: number, name: string, create: boolean): number {
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  let descriptor = posix.symbols.openat(parent, ptr(cPath(name)), flags, 0)
  if (descriptor >= 0) return descriptor
  if (!create) throw new Error(`Raw capture directory is missing or unsafe: ${name}`)
  posix.symbols.mkdirat(parent, ptr(cPath(name)), 0o700)
  descriptor = posix.symbols.openat(parent, ptr(cPath(name)), flags, 0)
  if (descriptor < 0) throw new Error(`Raw capture directory is missing or unsafe: ${name}`)
  fsyncSync(parent)
  return descriptor
}

function openAt(parent: number, name: string, flags: number, mode: number): number {
  const descriptor = posix.symbols.openat(parent, ptr(cPath(name)), flags, mode)
  if (descriptor < 0) throw new Error(`Descriptor-relative open failed: ${name}`)
  return descriptor
}

function unlinkAt(parent: number, name: string): void {
  if (posix.symbols.unlinkat(parent, ptr(cPath(name)), 0) !== 0) {
    throw new Error(`Descriptor-relative unlink failed: ${name}`)
  }
}

function verifyObjectAt(parent: number, name: string, digest: string, byteLength: number): void {
  const descriptor = openAt(
    parent,
    name,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0,
  )
  const hash = createHash("sha256")
  const chunk = Buffer.allocUnsafe(64 * 1024)
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size !== byteLength) {
      throw new Error("raw capture CAS verification failed")
    }
    let position = 0
    while (position < before.size) {
      const count = readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.length, before.size - position),
        position,
      )
      if (count === 0) throw new Error("raw capture CAS verification failed")
      hash.update(chunk.subarray(0, count))
      position += count
    }
    const after = fstatSync(descriptor)
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
        hash.digest("hex") !== digest) {
      throw new Error("raw capture CAS verification failed")
    }
  } finally {
    closeSync(descriptor)
  }
}

function cPath(value: string): Buffer {
  return Buffer.from(`${value}\u0000`, "utf8")
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function directoryBytes(root: string): number | undefined {
  let total = 0
  const pending = [root]
  try {
    while (pending.length > 0) {
      const path = pending.pop()
      if (path === undefined) break
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name)
        if (entry.isDirectory()) pending.push(child)
        else if (entry.isFile()) {
          total += statSync(child).size
          if (!Number.isSafeInteger(total)) return undefined
        }
      }
    }
    return total
  } catch {
    return undefined
  }
}

function boundedPositiveInteger(raw: string | undefined, fallback: number, hardMaximum: number): number {
  if (raw === undefined || raw.trim() === "") return Math.min(fallback, hardMaximum)
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, hardMaximum) : Math.min(fallback, hardMaximum)
}

function isAlreadyExists(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST"
}
