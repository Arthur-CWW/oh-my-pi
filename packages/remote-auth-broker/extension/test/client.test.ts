import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import type { Server, Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertSocketContinuity,
  captureOwnerOnlySocketIdentity,
  RemoteAuthClient,
} from "../client.ts"
import type { RemoteAuthRequestEnvelope } from "../client.ts"
import { encodeJsonFrame, IncrementalFrameDecoder } from "../frame.ts"
import { MAX_FRAME_BYTES } from "../protocol.ts"

const servers: Server[] = []
const serverSockets = new Map<Server, Set<Socket>>()
const directories: string[] = []

const STATUS_RESPONSE = {
  type: "status",
  status: {
    protocolVersion: 1,
    canonicalStatus: "DESIGN/INACTIVE",
    policyDigest: null,
    installedBuildDigest: null,
    runningBuildDigest: null,
    codeIdentity: null,
    pid: null,
    socketPosture: "owner-only",
    jetkvmControllerGeneration: null,
    gdm: { ready: false, errorCode: "inactive" },
    browser: { ready: false, errorCode: "inactive" },
    sudo: { ready: false, errorCode: "inactive" },
    errors: ["inactive"],
  },
} as const

const STATUS_REQUEST: RemoteAuthRequestEnvelope = {
  type: "control",
  control: { action: "status" },
}

afterEach(async () => {
  for (const server of servers.splice(0)) await closeServer(server)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  const { promise, resolve } = Promise.withResolvers<void>()
  for (const socket of serverSockets.get(server) ?? []) socket.destroy()
  serverSockets.delete(server)
  server.close(() => resolve())
  await promise
}

async function socketPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "remote-auth-client-"))
  directories.push(directory)
  return join(directory, "broker.sock")
}

async function listen(server: Server, path: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once("error", reject)
  server.listen(path, () => {
    server.removeListener("error", reject)
    resolve()
  })
  await promise
  await chmod(path, 0o600)
  servers.push(server)
}

async function serve(
  response: unknown | ((socket: Socket) => void),
): Promise<{ readonly path: string; readonly server: Server }> {
  const path = await socketPath()
  const activeSockets = new Set<Socket>()
  const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
    activeSockets.add(socket)
    socket.once("close", () => activeSockets.delete(socket))
    if (typeof response === "function") {
      response(socket)
      return
    }
    const decoder = new IncrementalFrameDecoder()
    socket.on("data", (chunk: Buffer) => {
      const frames = decoder.push(chunk)
      if (frames.length === 1) socket.end(encodeJsonFrame(response))
    })
  })
  serverSockets.set(server, activeSockets)
  await listen(server, path)
  return { path, server }
}


describe.serial("remote-auth owner-only Unix client", () => {
  test("accepts one strict framed metadata response", async () => {
    const endpoint = await serve(STATUS_RESPONSE)
    const result = await new RemoteAuthClient({ socketPath: endpoint.path, timeoutMs: 1_000 }).request(STATUS_REQUEST)
    expect(result).toEqual(STATUS_RESPONSE)
  })

  test("rejects group-readable sockets before connecting", async () => {
    let connected = false
    const endpoint = await serve((socket: Socket) => {
      connected = true
      socket.destroy()
    })
    await chmod(endpoint.path, 0o640)

    await expect(new RemoteAuthClient({ socketPath: endpoint.path }).request(STATUS_REQUEST)).rejects.toMatchObject({
      code: "peer-mismatch",
    })
    expect(connected).toBe(false)
  })

  test("detects an owner-only socket inode replacement", async () => {
    const firstPath = await socketPath()
    const firstServer = createServer()
    await listen(firstServer, firstPath)
    const getuid = process.getuid
    if (typeof getuid !== "function") throw new Error("process.getuid is unavailable")
    const uid = getuid()
    const first = await captureOwnerOnlySocketIdentity(firstPath, uid)
    await closeServer(firstServer)
    servers.splice(servers.indexOf(firstServer), 1)
    await rm(firstPath, { force: true })

    const replacementServer = createServer()
    await listen(replacementServer, firstPath)
    const replacement = await captureOwnerOnlySocketIdentity(firstPath, uid)
    expect(() => assertSocketContinuity(first, replacement)).toThrow(expect.objectContaining({ code: "peer-mismatch" }))
  })

  test("rejects oversized and truncated frames", async () => {
    const oversized = await serve((socket: Socket) => {
      socket.once("data", () => {
        const header = Buffer.alloc(4)
        header.writeUInt32BE(MAX_FRAME_BYTES + 1)
        socket.end(header)
      })
    })
    await expect(new RemoteAuthClient({ socketPath: oversized.path }).request(STATUS_REQUEST)).rejects.toMatchObject({
      code: "frame-invalid",
    })

    const truncated = await serve((socket: Socket) => {
      socket.once("data", () => {
        const bytes = Buffer.alloc(6)
        bytes.writeUInt32BE(8)
        bytes.write("{}", 4)
        socket.end(bytes)
      })
    })
    await expect(new RemoteAuthClient({ socketPath: truncated.path }).request(STATUS_REQUEST)).rejects.toMatchObject({
      code: "frame-invalid",
    })
  })

  test("rejects multiple responses and excess secret-like fields", async () => {
    const multiple = await serve((socket: Socket) => {
      socket.once("data", () => {
        const frame = encodeJsonFrame(STATUS_RESPONSE)
        socket.end(Buffer.concat([frame, frame]))
      })
    })
    await expect(new RemoteAuthClient({ socketPath: multiple.path }).request(STATUS_REQUEST)).rejects.toMatchObject({
      code: "frame-invalid",
    })

    const excess = await serve({ ...STATUS_RESPONSE, secret: "canary-credential" })
    await expect(new RemoteAuthClient({ socketPath: excess.path }).request(STATUS_REQUEST)).rejects.toMatchObject({
      code: "excess-field",
    })
  })

  test("bounds response time and aborts without returning transport data", async () => {
    const endpoint = await serve((socket: Socket) => {
      socket.resume()
      socket.on("end", () => {})
    })
    await expect(new RemoteAuthClient({ socketPath: endpoint.path, timeoutMs: 10 }).request(STATUS_REQUEST)).rejects.toMatchObject({
      code: "timeout",
    })

    const controller = new AbortController()
    const pending = new RemoteAuthClient({ socketPath: endpoint.path, timeoutMs: 1_000 }).request(STATUS_REQUEST, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })
})
