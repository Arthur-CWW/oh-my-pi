import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { expect, test } from "bun:test"

import { acquireSessionLease, canonicalSessionIdentity, classifyExistingLease, leasePathsFor, linuxProcStartFingerprint, ownerProofFor, type OwnershipClock, type ProcessIdentity, type ProcessIdentityProvider, type SessionLeaseV1 } from "../src/ownership"
import { decodeCmuxOwnerView } from "../../../vendor/oh-my-pi/packages/coding-agent/src/session/session-ownership.ts"
const root = join(import.meta.dir, ".tmp", "ownership")
const processIdentity: ProcessIdentity = { bootId: "boot-a", pid: 100, startFingerprint: "start-a" }
const deadProcesses: ProcessIdentityProvider = { current: async () => processIdentity, matches: async () => false }
const workspaceId = "123e4567-e89b-12d3-a456-426614174000"
const surfaceId = "987fcdeb-51a2-43d7-8f60-123456789abc"

function clock(): OwnershipClock {
  let unix = 1_000
  let monotonic = 0
  return { unixMs: async () => unix, monotonicMs: () => monotonic, sleep: async (ms) => { monotonic += ms; unix += ms } }
}

test("canonical identity and atomic claim fence concurrent owners", async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  const file = join(root, "parent.jsonl")
  await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "parent")
  const first = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "one", socketPath: join(root, "one.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses } })
  expect("epoch" in first).toBe(true)
  const second = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "two", socketPath: join(root, "two.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses, probe: { probe: async (lease) => ({ nonce: "proof", ownerEpoch: lease.ownerEpoch, sessionMatch: true, phase: lease.phase, heartbeatSeq: lease.heartbeatSeq }) } } })
  expect("classification" in second).toBe(true)
  expect(leasePathsFor(identity, root).claim).toContain("owners-v1")
})

test("stable dead owner is stale while a matching process is suspect", async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  const file = join(root, "parent.jsonl")
  await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "parent")
  const lease = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "one", socketPath: join(root, "one.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses } })
  if (!("epoch" in lease)) throw new Error("failed to acquire test lease")
  expect((await classifyExistingLease(identity, { root, clock: clock(), processes: deadProcesses })).classification).toBe("stale")
  const liveProcesses: ProcessIdentityProvider = { current: async () => processIdentity, matches: async () => true }
  expect((await classifyExistingLease(identity, { root, clock: clock(), processes: liveProcesses })).classification).toBe("suspect")
})

test("proof is fenced by epoch and full session identity", () => {
  const lease: SessionLeaseV1 = { version: 1, sessionFile: "/tmp/parent.jsonl", sessionId: "parent", ownerKind: "agent-mux", ownerEpoch: "epoch-a", muxName: "mux", socketPath: "/tmp/mux.sock", daemonProcess: processIdentity, controllerProcess: processIdentity, phase: "running", acquiredAtUnixMs: 1, heartbeatSeq: 2, heartbeatAtUnixMs: 3 }
  expect(ownerProofFor(lease, { nonce: "n", expectedEpoch: "epoch-a", sessionFile: lease.sessionFile, sessionId: lease.sessionId })?.nonce).toBe("n")
  expect(ownerProofFor(lease, { nonce: "n", expectedEpoch: "epoch-b", sessionFile: lease.sessionFile, sessionId: lease.sessionId })).toBeNull()
  expect(ownerProofFor(lease, { nonce: "n", expectedEpoch: "epoch-a", sessionFile: "/tmp/other.jsonl", sessionId: lease.sessionId })).toBeNull()
})

test("writes epoch-bound cmux metadata after markRunning without changing proof or release", async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
  const file = join(root, "cmux.jsonl"); await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "cmux")
  const lease = await acquireSessionLease({
    identity, ownerKind: "agent-mux", muxName: "mux", socketPath: join(root, "mux.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity,
    cmux: { workspaceId, surfaceId, socketPath: "/tmp/cmux.sock" }, dependencies: { root, clock: clock(), processes: deadProcesses },
  })
  if (!("epoch" in lease)) throw new Error("lease unavailable")
  expect(await lease.markRunning(processIdentity, processIdentity)).toBe(true)
  const view = JSON.parse(await readFile(join(lease.paths.claim, "view.json"), "utf8"))
  expect(view).toEqual({
    version: 1, ownerEpoch: lease.epoch, cmux: { workspaceId, surfaceId, socketPath: "/tmp/cmux.sock" },
  })
  expect(decodeCmuxOwnerView(view)).toEqual(view)
  const running = await lease.lease()
  if (running === null) throw new Error("running lease unavailable")
  expect(ownerProofFor(running, { nonce: "n", expectedEpoch: lease.epoch, sessionFile: identity.sessionFile, sessionId: identity.sessionId })?.phase).toBe("running")
  expect(await lease.release()).toBe(true)
})

test("does not write cmux metadata outside cmux", async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
  const file = join(root, "outside-cmux.jsonl"); await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "outside-cmux")
  const lease = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "mux", socketPath: join(root, "mux.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses } })
  if (!("epoch" in lease)) throw new Error("lease unavailable")
  expect(await lease.markRunning(processIdentity, processIdentity)).toBe(true)
  expect(await Bun.file(join(lease.paths.claim, "view.json")).exists()).toBe(false)
})

test("omits partial or invalid cmux metadata", async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
  const cases = [
    ["partial", { workspaceId }],
    ["invalid-workspace", { workspaceId: "workspace-a", surfaceId, socketPath: "/tmp/cmux.sock" }],
    ["invalid-surface", { workspaceId, surfaceId: "surface-a", socketPath: "/tmp/cmux.sock" }],
    ["relative-socket", { workspaceId, surfaceId, socketPath: "tmp/cmux.sock" }],
  ] as const
  for (const [name, cmux] of cases) {
    const file = join(root, `${name}.jsonl`); await writeFile(file, "{}\n")
    const identity = await canonicalSessionIdentity(file, name)
    const lease = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "mux", socketPath: join(root, `${name}.sock`), controllerProcess: processIdentity, daemonProcess: processIdentity, cmux, dependencies: { root, clock: clock(), processes: deadProcesses } })
    if (!("epoch" in lease)) throw new Error(`lease unavailable for ${name}`)
    expect(await lease.markRunning(processIdentity, processIdentity)).toBe(true)
    expect(await Bun.file(join(lease.paths.claim, "view.json")).exists()).toBe(false)
  }
})

test("release removes only its matching epoch claim", async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  const file = join(root, "parent.jsonl")
  await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "parent")
  const lease = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "one", socketPath: join(root, "one.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses } })
  if (!("epoch" in lease)) throw new Error("failed to acquire test lease")
  expect(await lease.release()).toBe(true)
  expect((await classifyExistingLease(identity, { root, clock: clock(), processes: deadProcesses })).classification).toBe("none")
})

test("stale takeover creates a distinct epoch", async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
  const file = join(root, "takeover.jsonl"); await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "takeover")
  const first = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "old", socketPath: join(root, "old.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, cmux: { workspaceId: "workspace-a" }, dependencies: { root, clock: clock(), processes: deadProcesses } })
  if (!("epoch" in first)) throw new Error("first lease unavailable")
  expect(await first.markRunning(processIdentity, processIdentity)).toBe(true)
  expect(await Bun.file(join(first.paths.claim, "view.json")).exists()).toBe(false)
  const second = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "new", socketPath: join(root, "new.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses } })
  if (!("epoch" in second)) throw new Error("stale takeover unavailable")
  expect(second.epoch).not.toBe(first.epoch)
  expect(await first.isCurrent()).toBe(false)
  expect(await Bun.file(join(second.paths.claim, "view.json")).exists()).toBe(false)
})

test("pid reuse and boot changes are not liveness proof", async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
  const file = join(root, "reuse.jsonl"); await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "reuse")
  const lease = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "mux", socketPath: join(root, "mux.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses } })
  if (!("epoch" in lease)) throw new Error("lease unavailable")
  const reused: ProcessIdentityProvider = { current: async () => ({ ...processIdentity, startFingerprint: "other" }), matches: async () => false }
  expect((await classifyExistingLease(identity, { root, clock: clock(), processes: reused })).classification).toBe("stale")
})

test("renamed claim fences an old heartbeat", async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
  const file = join(root, "fence.jsonl"); await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "fence")
  const lease = await acquireSessionLease({ identity, ownerKind: "agent-mux", muxName: "mux", socketPath: join(root, "mux.sock"), controllerProcess: processIdentity, daemonProcess: processIdentity, dependencies: { root, clock: clock(), processes: deadProcesses } })
  if (!("epoch" in lease)) throw new Error("lease unavailable")
  await rename(lease.paths.claim, join(lease.paths.directory, `retired-${lease.epoch}`))
  expect(await lease.heartbeat()).toBe(false)
})

test("malformed matching claim is conservatively corrupt", async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
  const file = join(root, "corrupt.jsonl"); await writeFile(file, "{}\n")
  const identity = await canonicalSessionIdentity(file, "corrupt")
  const paths = leasePathsFor(identity, root); await mkdir(paths.claim, { recursive: true }); await writeFile(paths.lease, "{")
  expect((await classifyExistingLease(identity, { root, clock: clock(), processes: deadProcesses })).classification).toBe("owner_record_corrupt")
})

test("parses Linux proc start time when comm contains spaces and parentheses", () => {
  const fields = ["S", ...Array.from({ length: 18 }, (_, index) => String(index + 1)), "424242", "21"]
  expect(linuxProcStartFingerprint(`123 (worker name) with ) paren) ${fields.join(" ")}`)).toBe("424242")
  expect(linuxProcStartFingerprint("malformed")).toBeNull()
})
