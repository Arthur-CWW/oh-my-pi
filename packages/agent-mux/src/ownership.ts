import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { spawnSync } from "node:child_process"

import { Schema } from "effect"

import { muxRootDir } from "./state"

export const ProcessIdentitySchema = Schema.Struct({
  bootId: Schema.String,
  pid: Schema.Int,
  startFingerprint: Schema.String,
})
export type ProcessIdentity = Schema.Schema.Type<typeof ProcessIdentitySchema>

export const SessionLeaseV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  sessionFile: Schema.String,
  sessionId: Schema.String,
  ownerKind: Schema.Union([Schema.Literal("agent-mux"), Schema.Literal("omp")]),
  ownerEpoch: Schema.String,
  muxName: Schema.NullOr(Schema.String),
  socketPath: Schema.String,
  daemonProcess: Schema.NullOr(ProcessIdentitySchema),
  controllerProcess: ProcessIdentitySchema,
  phase: Schema.Union([Schema.Literal("acquiring"), Schema.Literal("running"), Schema.Literal("releasing")]),
  acquiredAtUnixMs: Schema.Number,
  heartbeatSeq: Schema.Int,
  heartbeatAtUnixMs: Schema.Number,
})
export type SessionLeaseV1 = Schema.Schema.Type<typeof SessionLeaseV1Schema>

export interface SessionIdentity {
  readonly sessionFile: string
  readonly sessionId: string
}

export type OwnerClassification = "none" | "live" | "stale" | "suspect" | "owner_record_corrupt"

export interface OwnerRefusal {
  readonly classification: Exclude<OwnerClassification, "none" | "stale">
  readonly lease: SessionLeaseV1 | null
  readonly attachHint: string | null
}

export interface OwnershipClock {
  readonly unixMs: () => Promise<number>
  readonly monotonicMs: () => number
  readonly sleep: (ms: number) => Promise<void>
}

export interface ProcessIdentityProvider {
  readonly current: () => Promise<ProcessIdentity>
  readonly matches: (identity: ProcessIdentity) => Promise<boolean>
}

export interface OwnerProof {
  readonly nonce: string
  readonly ownerEpoch: string
  readonly sessionMatch: boolean
  readonly phase: "acquiring" | "running" | "releasing"
  readonly heartbeatSeq: number
}

export interface OwnerProbe {
  readonly probe: (lease: SessionLeaseV1, identity: SessionIdentity, timeoutMs: number) => Promise<OwnerProof | null>
}

export interface OwnershipDependencies {
  readonly root?: string
  readonly clock?: OwnershipClock
  readonly processes?: ProcessIdentityProvider
  readonly probe?: OwnerProbe
}

export interface CmuxOwnerEnvironment {
  readonly workspaceId?: string
  readonly surfaceId?: string
  readonly socketPath?: string
}

export interface OwnershipHandle {
  readonly identity: SessionIdentity
  readonly epoch: string
  readonly paths: LeasePaths
  readonly lease: () => Promise<SessionLeaseV1 | null>
  readonly isCurrent: () => Promise<boolean>
  readonly heartbeat: () => Promise<boolean>
  readonly markRunning: (controllerProcess: ProcessIdentity, daemonProcess: ProcessIdentity | null) => Promise<boolean>
  readonly release: () => Promise<boolean>
}

export interface LeasePaths {
  readonly directory: string
  readonly claim: string
  readonly lease: string
}

const heartbeatIntervalMs = 2_000
const observationMs = 10_000
const probeTimeoutMs = 500

export async function canonicalSessionIdentity(sessionFile: string, sessionId: string): Promise<SessionIdentity> {
  const target = await stat(sessionFile)
  if (!target.isFile()) throw new Error(`resume target is not a regular file: ${sessionFile}`)
  const parent = await realpath(dirname(sessionFile))
  return { sessionFile: join(parent, basename(sessionFile)), sessionId }
}

export function leasePathsFor(identity: SessionIdentity, root = muxRootDir()): LeasePaths {
  const key = createHash("sha256").update(identity.sessionFile).update("\0").update(identity.sessionId).digest("hex")
  const directory = join(root, "owners-v1", key)
  const claim = join(directory, "claim")
  return { directory, claim, lease: join(claim, "lease.json") }
}

export async function acquireSessionLease(input: {
  readonly identity: SessionIdentity
  readonly ownerKind: "agent-mux" | "omp"
  readonly muxName: string | null
  readonly socketPath: string
  readonly controllerProcess: ProcessIdentity
  readonly daemonProcess: ProcessIdentity | null
  readonly cmux?: CmuxOwnerEnvironment
}): Promise<OwnershipHandle | OwnerRefusal> {
  const dependencies = input.dependencies ?? {}
  const paths = leasePathsFor(input.identity, dependencies.root ?? muxRootDir())
  const clock = dependencies.clock ?? systemClock
  const processes = dependencies.processes ?? systemProcesses
  const epoch = randomUUID()
  await mkdir(dirname(paths.claim), { recursive: true })

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await mkdir(paths.claim, { recursive: false })
      const now = await clock.unixMs()
      const lease: SessionLeaseV1 = {
        version: 1, ...input.identity, ownerKind: input.ownerKind, ownerEpoch: epoch, muxName: input.muxName,
        socketPath: input.socketPath, daemonProcess: input.daemonProcess, controllerProcess: input.controllerProcess,
        phase: "acquiring", acquiredAtUnixMs: now, heartbeatSeq: 0, heartbeatAtUnixMs: now,
      }
      try {
        await replaceLease(paths, lease)
        return makeHandle(paths, lease, clock, input.cmux)
      } catch (error) {
        await removeClaimIfEpoch(paths, epoch)
        throw error
      }
    } catch (error) {
      if (!isErrno(error as { readonly code?: string }, "EEXIST")) throw error
      const classified = await classifyExistingLease(input.identity, { ...dependencies, processes })
      if (classified.classification !== "stale" || classified.lease === null) return classified as OwnerRefusal
      const old = classified.lease
      const current = await readLease(paths.lease)
      if (current === null || current.ownerEpoch !== old.ownerEpoch || current.heartbeatSeq !== old.heartbeatSeq) continue
      try {
        await rename(paths.claim, join(paths.directory, `retired-${old.ownerEpoch}`))
        await fsyncDirectory(paths.directory)
      } catch (renameError) {
        if (isErrno(renameError as { readonly code?: string }, "ENOENT") || isErrno(renameError as { readonly code?: string }, "EEXIST")) continue
        throw renameError
      }
    }
  }
  return { classification: "suspect", lease: await readLease(paths.lease), attachHint: null }
}

export async function classifyExistingLease(identity: SessionIdentity, dependencies: OwnershipDependencies = {}): Promise<{ readonly classification: OwnerClassification; readonly lease: SessionLeaseV1 | null; readonly attachHint: string | null }> {
  const paths = leasePathsFor(identity, dependencies.root ?? muxRootDir())
  const clock = dependencies.clock ?? systemClock
  const processes = dependencies.processes ?? systemProcesses
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = await readLease(paths.lease).catch(() => undefined)
    if (lease === undefined) return { classification: "owner_record_corrupt", lease: null, attachHint: null }
    if (lease === null) return { classification: "none", lease: null, attachHint: null }
    if (lease.sessionFile !== identity.sessionFile || lease.sessionId !== identity.sessionId) return { classification: "owner_record_corrupt", lease, attachHint: null }
    const proof = dependencies.probe === undefined ? null : await dependencies.probe.probe(lease, identity, probeTimeoutMs)
    if (proof !== null && proof.nonce.length > 0 && proof.ownerEpoch === lease.ownerEpoch && proof.sessionMatch && proof.phase === lease.phase) {
      return { classification: "live", lease, attachHint: hintFor(lease) }
    }
    const identities = [lease.controllerProcess, lease.daemonProcess].filter((value): value is ProcessIdentity => value !== null)
    let matching = false
    for (const processIdentity of identities) if (await processes.matches(processIdentity)) matching = true
    if (matching) {
      const start = clock.monotonicMs()
      const initialSequence = lease.heartbeatSeq
      while (clock.monotonicMs() - start < observationMs) {
        await clock.sleep(Math.min(heartbeatIntervalMs, observationMs - (clock.monotonicMs() - start)))
        const later = await readLease(paths.lease).catch(() => undefined)
        if (later === undefined || later === null || later.ownerEpoch !== lease.ownerEpoch) break
        if (later.heartbeatSeq > initialSequence) return { classification: "live", lease: later, attachHint: hintFor(later) }
      }
      const final = await readLease(paths.lease).catch(() => undefined)
      if (final === undefined || final === null || final.ownerEpoch !== lease.ownerEpoch) continue
      return { classification: "suspect", lease: final, attachHint: hintFor(final) }
    }
    const final = await readLease(paths.lease).catch(() => undefined)
    if (final === undefined) return { classification: "owner_record_corrupt", lease: null, attachHint: null }
    if (final === null || final.ownerEpoch !== lease.ownerEpoch || final.heartbeatSeq !== lease.heartbeatSeq) continue
    return { classification: "stale", lease: final, attachHint: hintFor(final) }
  }
  return { classification: "suspect", lease: await readLease(paths.lease), attachHint: null }
}

export function ownerProofFor(lease: SessionLeaseV1, input: { readonly nonce: string; readonly expectedEpoch: string; readonly sessionFile: string; readonly sessionId: string }): OwnerProof | null {
  if (input.expectedEpoch !== lease.ownerEpoch || input.sessionFile !== lease.sessionFile || input.sessionId !== lease.sessionId) return null
  return { nonce: input.nonce, ownerEpoch: lease.ownerEpoch, sessionMatch: true, phase: lease.phase, heartbeatSeq: lease.heartbeatSeq }
}

function makeHandle(paths: LeasePaths, initial: SessionLeaseV1, clock: OwnershipClock, cmux: CmuxOwnerEnvironment | undefined): OwnershipHandle {
  const current = async (): Promise<SessionLeaseV1 | null> => await readLease(paths.lease)
  const isCurrent = async (): Promise<boolean> => (await current())?.ownerEpoch === initial.ownerEpoch
  const mutate = async (change: (lease: SessionLeaseV1) => SessionLeaseV1): Promise<boolean> => {
    const lease = await current()
    if (lease === null || lease.ownerEpoch !== initial.ownerEpoch) return false
    await replaceLease(paths, change(lease))
    return true
  }
  return {
    identity: { sessionFile: initial.sessionFile, sessionId: initial.sessionId }, epoch: initial.ownerEpoch, paths,
    lease: current, isCurrent,
    heartbeat: async () => {
      const now = await clock.unixMs()
      return await mutate((lease) => ({ ...lease, heartbeatSeq: lease.heartbeatSeq + 1, heartbeatAtUnixMs: now }))
    },
    markRunning: async (controllerProcess, daemonProcess) => {
      const now = await clock.unixMs()
      const markedRunning = await mutate((lease) => ({ ...lease, phase: "running", controllerProcess, daemonProcess, heartbeatSeq: lease.heartbeatSeq + 1, heartbeatAtUnixMs: now }))
      if (markedRunning) await writeCmuxOwnerView(paths, initial.ownerEpoch, cmux).catch((error) => console.warn(`cmux owner metadata unavailable: ${errorMessage(error)}`))
      return markedRunning
    },
    release: async () => {
      if (!await mutate((lease) => ({ ...lease, phase: "releasing" }))) return false
      const lease = await current()
      if (lease === null || lease.ownerEpoch !== initial.ownerEpoch) return false
      try { await rename(paths.claim, join(paths.directory, `retired-${initial.ownerEpoch}`)); await fsyncDirectory(paths.directory); await rm(join(paths.directory, `retired-${initial.ownerEpoch}`), { recursive: true, force: true }); return true } catch { return false }
    },
  }
}

async function readLease(path: string): Promise<SessionLeaseV1 | null> {
  try { return Schema.decodeUnknownSync(SessionLeaseV1Schema)(JSON.parse(await readFile(path, "utf8"))) } catch (error) { if (isErrno(error as { readonly code?: string }, "ENOENT")) return null; throw error }
}

async function replaceLease(paths: LeasePaths, lease: SessionLeaseV1): Promise<void> {
  Schema.decodeUnknownSync(SessionLeaseV1Schema)(lease)
  const temporary = `${paths.lease}.tmp-${process.pid}-${randomUUID()}`
  const handle = await open(temporary, "w", 0o600)
  try { await handle.writeFile(`${JSON.stringify(lease)}\n`, "utf8"); await handle.sync() } finally { await handle.close() }
  await rename(temporary, paths.lease)
  await fsyncDirectory(paths.claim)
  await fsyncDirectory(paths.directory)
}

async function writeCmuxOwnerView(paths: LeasePaths, ownerEpoch: string, cmux: CmuxOwnerEnvironment | undefined): Promise<void> {
  if (!isValidCmuxOwnerEnvironment(cmux)) return
  const view = { version: 1, ownerEpoch, cmux: { workspaceId: cmux.workspaceId, surfaceId: cmux.surfaceId, socketPath: cmux.socketPath } }
  const temporary = join(paths.claim, `.view-${process.pid}-${randomUUID()}`)
  const handle = await open(temporary, "w", 0o600)
  try { await handle.writeFile(`${JSON.stringify(view)}\n`, "utf8"); await handle.sync() } finally { await handle.close() }
  await rename(temporary, join(paths.claim, "view.json"))
  await fsyncDirectory(paths.claim)
}
function isValidCmuxOwnerEnvironment(cmux: CmuxOwnerEnvironment | undefined): cmux is Required<CmuxOwnerEnvironment> {
  return cmux !== undefined
    && isCmuxId(cmux.workspaceId)
    && isCmuxId(cmux.surfaceId)
    && typeof cmux.socketPath === "string"
    && cmux.socketPath.length > 0
    && isAbsolute(cmux.socketPath)
}
function isCmuxId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

async function fsyncDirectory(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync() } finally { await handle.close() } }
async function removeClaimIfEpoch(paths: LeasePaths, epoch: string): Promise<void> { const lease = await readLease(paths.lease).catch(() => null); if (lease?.ownerEpoch === epoch) await rm(paths.claim, { recursive: true, force: true }) }
function hintFor(lease: SessionLeaseV1): string | null { return lease.muxName === null ? null : `agent-mux attach ${lease.muxName}` }
function isErrno(error: { readonly code?: string } | null, code: string): boolean { return error?.code === code }

const systemClock: OwnershipClock = { unixMs: async () => Date.now(), monotonicMs: () => performance.now(), sleep: async (ms) => await Bun.sleep(ms) }
const systemProcesses: ProcessIdentityProvider = {
  current: async () => await processIdentityFor(process.pid),
  matches: async (identity) => { try { const current = await processIdentityFor(identity.pid); return current.bootId === identity.bootId && current.startFingerprint === identity.startFingerprint } catch { return false } },
}
export function linuxProcStartFingerprint(processStat: string): string | null {
  const closingParen = processStat.lastIndexOf(")")
  if (closingParen < 0) return null
  const fieldsAfterCommand = processStat.slice(closingParen + 2).trim().split(/\s+/)
  return fieldsAfterCommand[19] ?? null
}
export async function processIdentityFor(pid: number): Promise<ProcessIdentity> {
  if (process.platform === "linux") {
    const [bootId, processStat] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ])
    const startFingerprint = linuxProcStartFingerprint(processStat)
    if (bootId.trim().length === 0 || startFingerprint === null || startFingerprint.length === 0) throw new Error(`cannot inspect process ${pid}`)
    return { bootId: bootId.trim(), pid, startFingerprint }
  }
  const boot = spawnSync("sysctl", ["-n", "kern.boottime"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } })
  const started = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } })
  const bootId = boot.stdout.trim(); const startFingerprint = started.stdout.trim()
  if (boot.status !== 0 || started.status !== 0 || bootId.length === 0 || startFingerprint.length === 0) throw new Error(`cannot inspect process ${pid}`)
  return { bootId, pid, startFingerprint }
}
