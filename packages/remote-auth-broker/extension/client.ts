import { lstat } from "node:fs/promises"
import { createConnection } from "node:net"
import type { Socket } from "node:net"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { Schema } from "effect"
import { decodeJsonPayload, encodeJsonFrame, FrameError, IncrementalFrameDecoder } from "./frame.ts"
import {
  ControlRequestSchema,
  decodeGrant,
  decodePublicStatus,
  decodeReceipt,
  ExecutionRequestSchema,
  GrantIdSchema,
  GrantSchema,
  MAX_REQUEST_LIFETIME_MS,
  PublicErrorSchema,
  PublicStatusSchema,
  ReceiptSchema,
  RequestIdSchema,
} from "./protocol.ts"
import type {
  ControlRequest,
  ExecutionRequest,
  Grant,
  PublicError,
  PublicStatus,
  Receipt,
} from "./protocol.ts"

const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const
const SOCKET_MODE = 0o600
const MAX_UNIX_SOCKET_PATH_BYTES = 103
const DEFAULT_TIMEOUT_MS = 30_000

export const DEFAULT_BROKER_SOCKET_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "RemoteAuthBroker",
  "run",
  "remote-authd.sock",
)

const ControlActionSchema = Schema.Literals([
  "status",
  "request-state",
  "cancel",
  "grant-list",
  "grant-revoke",
  "grant-expire",
  "credential-forget",
  "emergency-disable",
  "re-enable",
])

export const RemoteAuthRequestEnvelopeSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("execution"), request: ExecutionRequestSchema }),
  Schema.Struct({ type: Schema.Literal("control"), control: ControlRequestSchema }),
])

export const RemoteAuthResponseEnvelopeSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("status"), status: PublicStatusSchema }),
  Schema.Struct({ type: Schema.Literal("receipt"), receipt: ReceiptSchema }),
  Schema.Struct({ type: Schema.Literal("grants"), grants: Schema.Array(GrantSchema).check(Schema.isMaxLength(256)) }),
  Schema.Struct({
    type: Schema.Literal("ack"),
    action: ControlActionSchema,
    requestId: Schema.NullOr(RequestIdSchema),
    grantId: Schema.NullOr(GrantIdSchema),
  }),
  Schema.Struct({ type: Schema.Literal("error"), error: PublicErrorSchema }),
])

export type RemoteAuthRequestEnvelope =
  | { readonly type: "execution"; readonly request: ExecutionRequest }
  | { readonly type: "control"; readonly control: ControlRequest }

export type RemoteAuthResponseEnvelope =
  | { readonly type: "status"; readonly status: PublicStatus }
  | { readonly type: "receipt"; readonly receipt: Receipt }
  | { readonly type: "grants"; readonly grants: readonly Grant[] }
  | {
      readonly type: "ack"
      readonly action: typeof ControlActionSchema.Type
      readonly requestId: string | null
      readonly grantId: string | null
    }
  | { readonly type: "error"; readonly error: PublicError }

export interface RemoteAuthClientOptions {
  readonly socketPath: string
  readonly timeoutMs?: number
  readonly expectedUid?: number
}

export interface SocketIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly uid: number
}

export class RemoteAuthClientError extends Error {
  readonly code: PublicError

  constructor(code: PublicError) {
    super("Remote authentication broker request failed")
    this.name = "RemoteAuthClientError"
    this.code = code
  }
}

function decodeStrict<S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, input: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(input, STRICT_DECODE_OPTIONS)
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ""
    throw new RemoteAuthClientError(message.includes("unexpected") ? "excess-field" : "protocol-invalid")
  }
}

export function decodeRemoteAuthResponse(input: unknown): RemoteAuthResponseEnvelope {
  const response = decodeStrict(RemoteAuthResponseEnvelopeSchema, input)
  switch (response.type) {
    case "status":
      return { type: "status", status: decodePublicStatus(response.status) }
    case "receipt":
      return { type: "receipt", receipt: decodeReceipt(response.receipt) }
    case "grants":
      return { type: "grants", grants: response.grants.map((grant) => decodeGrant(grant)) }
    case "ack":
      return response
    case "error":
      return response
  }
}

function expectedUid(options: RemoteAuthClientOptions): number {
  const uid = options.expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : -1)
  if (!Number.isInteger(uid) || uid < 0 || uid > 0xffff_ffff) throw new RemoteAuthClientError("principal-invalid")
  return uid
}

function timeoutMs(options: RemoteAuthClientOptions): number {
  const value = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(value) || value < 1 || value > MAX_REQUEST_LIFETIME_MS) {
    throw new RemoteAuthClientError("protocol-invalid")
  }
  return value
}

function validateSocketPath(socketPath: string): void {
  if (!isAbsolute(socketPath) || socketPath.includes("\0") || Buffer.byteLength(socketPath) > MAX_UNIX_SOCKET_PATH_BYTES) {
    throw new RemoteAuthClientError("peer-mismatch")
  }
}

export async function captureOwnerOnlySocketIdentity(socketPath: string, uid: number): Promise<SocketIdentity> {
  let stat
  try {
    stat = await lstat(socketPath, { bigint: true })
  } catch {
    throw new RemoteAuthClientError("unavailable")
  }
  if (!stat.isSocket() || Number(stat.uid) !== uid || Number(stat.mode & 0o777n) !== SOCKET_MODE) {
    throw new RemoteAuthClientError("peer-mismatch")
  }
  return { dev: stat.dev, ino: stat.ino, uid: Number(stat.uid) }
}

export function assertSocketContinuity(left: SocketIdentity, right: SocketIdentity): void {
  if (left.dev !== right.dev || left.ino !== right.ino || left.uid !== right.uid) {
    throw new RemoteAuthClientError("peer-mismatch")
  }
}

function abortError(): Error {
  const error = new Error("Remote authentication broker request was cancelled")
  error.name = "AbortError"
  return error
}

function mapTransportError(error: unknown): RemoteAuthClientError | Error {
  if (error instanceof RemoteAuthClientError) return error
  if (error instanceof FrameError) {
    return new RemoteAuthClientError(error.kind === "oversize" || error.kind === "truncated" ? "frame-invalid" : "protocol-invalid")
  }
  return new RemoteAuthClientError("unavailable")
}

export class RemoteAuthClient {
  readonly #options: RemoteAuthClientOptions

  constructor(options: RemoteAuthClientOptions = { socketPath: DEFAULT_BROKER_SOCKET_PATH }) {
    validateSocketPath(options.socketPath)
    expectedUid(options)
    timeoutMs(options)
    this.#options = Object.freeze({ ...options })
  }

  async request(request: RemoteAuthRequestEnvelope, signal?: AbortSignal): Promise<RemoteAuthResponseEnvelope> {
    const envelope = decodeStrict(RemoteAuthRequestEnvelopeSchema, request)
    const frame = encodeJsonFrame(envelope)
    const uid = expectedUid(this.#options)
    const before = await captureOwnerOnlySocketIdentity(this.#options.socketPath, uid)
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError()

    const socket = createConnection({ path: this.#options.socketPath })
    return await exchange(socket, frame, before, this.#options.socketPath, uid, timeoutMs(this.#options), signal)
  }
}

async function exchange(
  socket: Socket,
  frame: Uint8Array,
  before: SocketIdentity,
  socketPath: string,
  uid: number,
  requestTimeoutMs: number,
  signal?: AbortSignal,
): Promise<RemoteAuthResponseEnvelope> {
  const { promise, resolve, reject } = Promise.withResolvers<RemoteAuthResponseEnvelope>()
  const decoder = new IncrementalFrameDecoder()
  let payload: Uint8Array | undefined
  let settled = false
  let ended = false

  const cleanup = (): void => {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
    socket.removeAllListeners()
    if (!socket.destroyed) socket.destroy()
  }
  const fail = (error: unknown): void => {
    if (settled) return
    settled = true
    cleanup()
    reject(mapTransportError(error))
  }
  const succeed = (response: RemoteAuthResponseEnvelope): void => {
    if (settled) return
    settled = true
    cleanup()
    resolve(response)
  }
  const onAbort = (): void => {
    if (signal?.reason instanceof Error) {
      fail(signal.reason)
      return
    }
    fail(abortError())
  }
  const timer = setTimeout(() => fail(new RemoteAuthClientError("timeout")), requestTimeoutMs)
  signal?.addEventListener("abort", onAbort, { once: true })

  socket.once("error", fail)
  socket.once("connect", () => {
    void (async () => {
      try {
        const after = await captureOwnerOnlySocketIdentity(socketPath, uid)
        assertSocketContinuity(before, after)
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError()
        socket.write(frame)
      } catch (error) {
        fail(error)
      }
    })()
  })
  socket.on("data", (chunk: Buffer) => {
    try {
      const frames = decoder.push(chunk)
      for (const completed of frames) {
        if (payload !== undefined) throw new RemoteAuthClientError("frame-invalid")
        payload = completed
      }
    } catch (error) {
      fail(error)
    }
  })
  socket.once("end", () => {
    ended = true
    try {
      decoder.finish()
      if (payload === undefined) throw new RemoteAuthClientError("frame-invalid")
      succeed(decodeRemoteAuthResponse(decodeJsonPayload(payload)))
    } catch (error) {
      fail(error)
    }
  })
  socket.once("close", () => {
    if (!ended) fail(new RemoteAuthClientError("frame-invalid"))
  })

  return await promise
}
