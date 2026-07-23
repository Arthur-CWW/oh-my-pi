import { afterEach, describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import * as TypeBox from "@oh-my-pi/pi-coding-agent/extensibility/typebox"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import type { Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RemoteAuthClient } from "../client.ts"
import { encodeJsonFrame, IncrementalFrameDecoder, decodeJsonPayload } from "../frame.ts"
import { registerRemoteAuthTool } from "../index.ts"
import { decodeExecutionRequest } from "../protocol.ts"
import {
  decodeRemoteAuthToolInput,
  OMP_CODE_IDENTITY,
  RemoteAuthRuntime,
} from "../runtime.ts"
import type { SessionOwnershipSource, SessionOwnershipView } from "../runtime.ts"
import { requestVector } from "./vector-fixture.ts"

const servers: Server[] = []
const directories: string[] = []
const BUILD_DIGEST = "1".repeat(64)
const OWNER_EPOCH = "00112233-4455-4677-8899-aabbccddeeff"
const RUNNER_ID = "11112222-3333-4444-8555-666677778888"
const OWNERSHIP_SOCKET_PATH = `/tmp/owners-v1/${"a".repeat(64)}/claim/owner.sock`

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (!server.listening) continue
    const { promise, resolve } = Promise.withResolvers<void>()
    server.close(() => resolve())
    await promise
  }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

function exactRequestInput() {
  const decoded = decodeExecutionRequest(requestVector("gdm-delegated").request)
  const now = Date.now()
  return {
    action: "request" as const,
    requestId: decoded.requestId,
    nonce: decoded.nonce,
    createdAt: now,
    expiresAt: now + 60_000,
    authorizationModeRequested: decoded.authorizationModeRequested,
    domain: decoded.domain,
    operation: decoded.operation,
    target: decoded.target,
    purpose: decoded.purpose,
    grantId: decoded.grantId,
  }
}

function ownershipSource(options: {
  readonly current?: boolean | (() => boolean)
  readonly fenced?: boolean
  readonly present?: boolean
  readonly onRelease?: () => void
} = {}): SessionOwnershipSource {
  const view: SessionOwnershipView & { readonly release: () => void } = {
    sessionId: "session-owned-by-this-runner",
    ownerEpoch: OWNER_EPOCH,
    buildRevision: { digest: BUILD_DIGEST, version: "test" },
    runnerInstanceIdentity: { runnerInstanceId: RUNNER_ID, startedAt: "2026-07-23T00:00:00.000Z" },
    ownershipSocketPath: OWNERSHIP_SOCKET_PATH,
    isCurrent: async () => typeof options.current === "function" ? options.current() : options.current ?? true,
    isFenced: () => options.fenced ?? false,
    release: () => options.onRelease?.(),
  }
  return { getSessionOwnershipView: () => options.present === false ? undefined : view }
}

async function broker(response: unknown, captured: unknown[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "remote-auth-runtime-"))
  directories.push(directory)
  const path = join(directory, "broker.sock")
  const server = createServer((socket) => {
    const decoder = new IncrementalFrameDecoder()
    socket.on("data", (chunk: Buffer) => {
      const frames = decoder.push(chunk)
      if (frames.length !== 1) return
      captured.push(decodeJsonPayload(frames[0]!))
      socket.end(encodeJsonFrame(response))
    })
  })
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once("error", reject)
  server.listen(path, () => {
    server.removeListener("error", reject)
    resolve()
  })
  await promise
  await chmod(path, 0o600)
  servers.push(server)
  return path
}

function failedReceipt(requestId: string, grantId: string | null) {
  const now = Date.now()
  return {
    type: "receipt",
    receipt: {
      protocolVersion: 1,
      receiptId: "AAAAAAAAAAAAAAAAAAAAAA",
      requestId,
      grantId,
      domain: "desktop-browser",
      operation: "gdm-login",
      authorizationModeUsed: "delegated",
      targetFingerprint: "2".repeat(64),
      state: "failed",
      errorCode: "inactive",
      events: { requestedAt: now, authorizedAt: null, executingAt: null, terminalAt: now },
      policyDigest: "3".repeat(64),
      brokerBuildDigest: "4".repeat(64),
      brokerCodeDigest: "5".repeat(64),
      targetReleaseDisposition: "not-applicable",
      browserTargetGeneration: null,
    },
  } as const
}

interface RegisteredTool {
  readonly name: string
  readonly approval?: string
  readonly parameters: unknown
  execute(
    callId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: { readonly sessionManager: SessionOwnershipSource },
  ): Promise<{
    readonly content: readonly { readonly type: "text"; readonly text: string }[]
    readonly details?: unknown
    readonly isError?: boolean
  }>
}

function registeredTool(runtime: RemoteAuthRuntime): RegisteredTool {
  let registered: RegisteredTool | undefined
  const api = {
    typebox: TypeBox,
    registerTool(tool: RegisteredTool) {
      registered = tool
    },
  } as unknown as ExtensionAPI
  registerRemoteAuthTool(api, runtime)
  if (!registered) throw new Error("remote_auth was not registered")
  return registered
}

describe.serial("remote-auth Effect runtime", () => {
  test.each(["secret", "password", "token", "cookie", "query", "rawUrl", "script", "shell"])(
    "rejects excess secret-like field %s",
    (field) => {
      expect(() => decodeRemoteAuthToolInput({ action: "status", [field]: "canary-credential" })).toThrow(
        expect.objectContaining({ code: "excess-field" }),
      )
    },
  )

  test("rejects nested excess fields and generic actions", () => {
    const exact = exactRequestInput()
    expect(() => decodeRemoteAuthToolInput({
      ...exact,
      target: { ...exact.target, cookie: "canary-credential" },
    })).toThrow(expect.objectContaining({ code: "excess-field" }))
    expect(() => decodeRemoteAuthToolInput({ action: "shell", executable: "/bin/sh" })).toThrow(
      expect.objectContaining({ code: "noncanonical-value" }),
    )
  })

  test("rejects missing, fenced, and non-current ownership without releasing it", async () => {
    let releases = 0
    const runtime = new RemoteAuthRuntime({ active: false, client: new RemoteAuthClient({ socketPath: "/tmp/remote-auth-never-connect.sock" }) })
    await expect(runtime.execute({ action: "status" }, ownershipSource({ present: false }))).rejects.toMatchObject({ code: "owner-stale" })
    await expect(runtime.execute({ action: "status" }, ownershipSource({ fenced: true, onRelease: () => releases++ }))).rejects.toMatchObject({ code: "owner-stale" })
    await expect(runtime.execute({ action: "status" }, ownershipSource({ current: false, onRelease: () => releases++ }))).rejects.toMatchObject({ code: "owner-stale" })
    expect(releases).toBe(0)
  })

  test("binds immutable ownership and trusted process metadata, then rechecks ownership", async () => {
    const exact = exactRequestInput()
    const captured: unknown[] = []
    const path = await broker(failedReceipt(exact.requestId, exact.grantId), captured)
    let currentChecks = 0
    const source = ownershipSource({ current: () => ++currentChecks <= 2 })
    const runtime = new RemoteAuthRuntime({
      active: true,
      client: new RemoteAuthClient({ socketPath: path }),
      processIdentity: { pid: 4242, uid: 501, codeIdentity: OMP_CODE_IDENTITY },
    })

    await runtime.execute(exact, source)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      type: "execution",
      request: {
        principal: {
          sessionId: "session-owned-by-this-runner",
          ownerEpoch: OWNER_EPOCH,
          pid: 4242,
          uid: 501,
          codeIdentity: OMP_CODE_IDENTITY,
          buildDigest: BUILD_DIGEST,
          runnerInstanceIdentity: RUNNER_ID,
          ownershipSocketPath: OWNERSHIP_SOCKET_PATH,
        },
      },
    })
    expect(currentChecks).toBe(2)
  })

  test("fails closed when ownership becomes stale after the broker response", async () => {
    const exact = exactRequestInput()
    const captured: unknown[] = []
    const path = await broker(failedReceipt(exact.requestId, exact.grantId), captured)
    let currentChecks = 0
    const runtime = new RemoteAuthRuntime({
      active: true,
      client: new RemoteAuthClient({ socketPath: path }),
      processIdentity: { pid: 4242, uid: 501, codeIdentity: OMP_CODE_IDENTITY },
    })
    await expect(runtime.execute(exact, ownershipSource({ current: () => ++currentChecks === 1 }))).rejects.toMatchObject({
      code: "owner-stale",
    })
  })

  test("registered tool is closed, metadata-only, and surfaces DESIGN/INACTIVE", async () => {
    const runtime = new RemoteAuthRuntime({ active: false, client: new RemoteAuthClient({ socketPath: "/tmp/remote-auth-never-connect.sock" }) })
    const tool = registeredTool(runtime)
    expect(tool.name).toBe("remote_auth")
    expect(tool.approval).toBe("exec")
    expect(JSON.stringify(tool.parameters)).not.toContain("additionalProperties\":true")

    const context = { sessionManager: ownershipSource() }
    const status = await tool.execute("call-1", { action: "status" }, undefined, undefined, context)
    expect(status.isError).toBeUndefined()
    expect(status.details).toMatchObject({
      ok: true,
      response: { type: "status", status: { canonicalStatus: "DESIGN/INACTIVE" } },
    })
    const serialized = JSON.stringify(status)
    for (const forbidden of ["password", "secret", "cookie", "token", "rawUrl", "query", "script", "shell", "canary-credential"]) {
      expect(serialized).not.toContain(forbidden)
    }

    const denied = await tool.execute("call-2", { action: "status", secret: "canary-credential" }, undefined, undefined, context)
    expect(denied).toMatchObject({ isError: true, details: { ok: false, errorCode: "excess-field" } })
    expect(JSON.stringify(denied)).not.toContain("canary-credential")

    const inactive = await tool.execute("call-3", exactRequestInput(), undefined, undefined, context)
    expect(inactive).toMatchObject({ isError: true, details: { ok: false, errorCode: "inactive" } })
  })
})
