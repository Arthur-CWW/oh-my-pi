import { Schema } from "effect"
import {
  AuthorizationModeSchema,
  decodeControlRequest,
  decodeExecutionRequest,
  DomainSchema,
  GrantIdSchema,
  IdSchema,
  NonceSchema,
  OperationSchema,
  PROTOCOL_VERSION,
  PublicErrorSchema,
  RequestIdSchema,
  TargetSchema,
  TextSchema,
  TimeMsSchema,
} from "./protocol.ts"
import type {
  ControlRequest,
  ExecutionRequest,
  Principal,
  PublicError,
  PublicStatus,
} from "./protocol.ts"
import { RemoteAuthClientError } from "./client.ts"
import type {
  RemoteAuthClient,
  RemoteAuthRequestEnvelope,
  RemoteAuthResponseEnvelope,
} from "./client.ts"

const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const
export const OMP_CODE_IDENTITY = "com.openai.omp" as const
export const REMOTE_AUTH_RUNTIME_ACTIVE = false as const

const ExactRequestToolInputSchema = Schema.Struct({
  action: Schema.Literal("request"),
  requestId: RequestIdSchema,
  nonce: NonceSchema,
  createdAt: TimeMsSchema,
  expiresAt: TimeMsSchema,
  authorizationModeRequested: AuthorizationModeSchema,
  domain: DomainSchema,
  operation: OperationSchema,
  target: TargetSchema,
  purpose: TextSchema,
  grantId: Schema.NullOr(GrantIdSchema),
})
const RequestStateToolInputSchema = Schema.Struct({ action: Schema.Literal("request-state"), requestId: RequestIdSchema })
const CancelToolInputSchema = Schema.Struct({ action: Schema.Literal("cancel"), requestId: RequestIdSchema })
const GrantListToolInputSchema = Schema.Struct({ action: Schema.Literal("grant-list") })
const GrantRevokeToolInputSchema = Schema.Struct({ action: Schema.Literal("grant-revoke"), grantId: GrantIdSchema })
const GrantExpireToolInputSchema = Schema.Struct({ action: Schema.Literal("grant-expire"), grantId: GrantIdSchema })
const CredentialForgetToolInputSchema = Schema.Struct({ action: Schema.Literal("credential-forget"), credentialId: IdSchema })
const EmergencyDisableToolInputSchema = Schema.Struct({ action: Schema.Literal("emergency-disable"), reason: TextSchema })
const ReEnableToolInputSchema = Schema.Struct({ action: Schema.Literal("re-enable") })
const StatusToolInputSchema = Schema.Struct({ action: Schema.Literal("status") })

export const RemoteAuthToolInputSchema = Schema.Union([
  StatusToolInputSchema,
  ExactRequestToolInputSchema,
  RequestStateToolInputSchema,
  CancelToolInputSchema,
  GrantListToolInputSchema,
  GrantRevokeToolInputSchema,
  GrantExpireToolInputSchema,
  CredentialForgetToolInputSchema,
  EmergencyDisableToolInputSchema,
  ReEnableToolInputSchema,
])

export type RemoteAuthToolInput = typeof RemoteAuthToolInputSchema.Type

export interface SessionOwnershipView {
  readonly sessionId: string
  readonly ownerEpoch: string
  readonly buildRevision: Readonly<{ readonly digest: string; readonly version: string }>
  readonly runnerInstanceIdentity: Readonly<{ readonly runnerInstanceId: string; readonly startedAt: string }>
  readonly ownershipSocketPath: string
  isCurrent(): Promise<boolean>
  isFenced(): boolean
}

export interface SessionOwnershipSource {
  getSessionOwnershipView(): SessionOwnershipView | undefined
}

export interface TrustedProcessIdentity {
  readonly pid: number
  readonly uid: number
  readonly codeIdentity: string
}

export interface RemoteAuthRuntimeOptions {
  readonly active: boolean
  readonly client: RemoteAuthClient
  readonly processIdentity?: TrustedProcessIdentity
}

export class RemoteAuthRuntimeError extends Error {
  readonly code: PublicError

  constructor(code: PublicError) {
    super("Remote authentication request was denied")
    this.name = "RemoteAuthRuntimeError"
    this.code = code
  }
}

const INACTIVE_ERROR = "inactive" satisfies PublicError
const INACTIVE_ENDPOINT = Object.freeze({ ready: false, errorCode: INACTIVE_ERROR })
export const INACTIVE_PUBLIC_STATUS: PublicStatus = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  canonicalStatus: "DESIGN/INACTIVE",
  policyDigest: null,
  installedBuildDigest: null,
  runningBuildDigest: null,
  codeIdentity: null,
  pid: null,
  socketPosture: "absent",
  jetkvmControllerGeneration: null,
  gdm: INACTIVE_ENDPOINT,
  browser: INACTIVE_ENDPOINT,
  sudo: INACTIVE_ENDPOINT,
  errors: [INACTIVE_ERROR] as const,
})

function decodeStrict<S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, input: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(input, STRICT_DECODE_OPTIONS)
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ""
    throw new RemoteAuthRuntimeError(message.includes("unexpected") ? "excess-field" : "noncanonical-value")
  }
}

export function decodeRemoteAuthToolInput(input: unknown): RemoteAuthToolInput {
  return decodeStrict(RemoteAuthToolInputSchema, input)
}

function defaultProcessIdentity(): TrustedProcessIdentity {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1
  return Object.freeze({ pid: process.pid, uid, codeIdentity: OMP_CODE_IDENTITY })
}

function validUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff
}

async function assertCurrentOwnership(view: SessionOwnershipView): Promise<void> {
  if (view.isFenced()) throw new RemoteAuthRuntimeError("owner-stale")
  let current: boolean
  try {
    current = await view.isCurrent()
  } catch {
    throw new RemoteAuthRuntimeError("owner-stale")
  }
  if (!current || view.isFenced()) throw new RemoteAuthRuntimeError("owner-stale")
}

async function trustedPrincipal(
  source: SessionOwnershipSource,
  processIdentity: TrustedProcessIdentity,
): Promise<{ readonly principal: Principal; readonly ownership: SessionOwnershipView }> {
  const ownership = source.getSessionOwnershipView()
  if (!ownership) throw new RemoteAuthRuntimeError("owner-stale")
  await assertCurrentOwnership(ownership)
  if (!validUint32(processIdentity.pid) || !validUint32(processIdentity.uid) || processIdentity.codeIdentity !== OMP_CODE_IDENTITY) {
    throw new RemoteAuthRuntimeError("principal-invalid")
  }

  const principal: Principal = {
    sessionId: ownership.sessionId,
    ownerEpoch: ownership.ownerEpoch,
    pid: processIdentity.pid,
    uid: processIdentity.uid,
    codeIdentity: processIdentity.codeIdentity,
    buildDigest: ownership.buildRevision.digest,
    runnerInstanceIdentity: ownership.runnerInstanceIdentity.runnerInstanceId,
    ownershipSocketPath: ownership.ownershipSocketPath,
  }
  return { principal, ownership }
}

function toControlRequest(input: Exclude<RemoteAuthToolInput, { readonly action: "request" }>): ControlRequest {
  return decodeControlRequest(input)
}

function toExecutionRequest(input: Extract<RemoteAuthToolInput, { readonly action: "request" }>, principal: Principal): ExecutionRequest {
  return decodeExecutionRequest({
    protocolVersion: PROTOCOL_VERSION,
    requestId: input.requestId,
    nonce: input.nonce,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    principal,
    authorizationModeRequested: input.authorizationModeRequested,
    domain: input.domain,
    operation: input.operation,
    target: input.target,
    purpose: input.purpose,
    grantId: input.grantId,
  })
}

function assertResponseMatchesRequest(
  request: RemoteAuthRequestEnvelope,
  response: RemoteAuthResponseEnvelope,
): void {
  if (response.type === "error") return
  if (request.type === "execution") {
    if (response.type !== "receipt" || response.receipt.requestId !== request.request.requestId) {
      throw new RemoteAuthClientError("protocol-invalid")
    }
    return
  }

  const control = request.control
  switch (control.action) {
    case "status":
      if (response.type !== "status") throw new RemoteAuthClientError("protocol-invalid")
      return
    case "request-state":
      if (response.type !== "receipt" || response.receipt.requestId !== control.requestId) {
        throw new RemoteAuthClientError("protocol-invalid")
      }
      return
    case "grant-list":
      if (response.type !== "grants") throw new RemoteAuthClientError("protocol-invalid")
      return
    case "cancel":
      if (response.type !== "ack" || response.action !== control.action || response.requestId !== control.requestId || response.grantId !== null) {
        throw new RemoteAuthClientError("protocol-invalid")
      }
      return
    case "grant-revoke":
    case "grant-expire":
      if (response.type !== "ack" || response.action !== control.action || response.requestId !== null || response.grantId !== control.grantId) {
        throw new RemoteAuthClientError("protocol-invalid")
      }
      return
    case "credential-forget":
    case "emergency-disable":
    case "re-enable":
      if (response.type !== "ack" || response.action !== control.action || response.requestId !== null || response.grantId !== null) {
        throw new RemoteAuthClientError("protocol-invalid")
      }
  }
}

export class RemoteAuthRuntime {
  readonly #active: boolean
  readonly #client: RemoteAuthClient
  readonly #processIdentity: TrustedProcessIdentity

  constructor(options: RemoteAuthRuntimeOptions) {
    this.#active = options.active
    this.#client = options.client
    this.#processIdentity = Object.freeze(options.processIdentity ?? defaultProcessIdentity())
  }

  async execute(
    untrustedInput: unknown,
    ownershipSource: SessionOwnershipSource,
    signal?: AbortSignal,
  ): Promise<RemoteAuthResponseEnvelope> {
    const input = decodeRemoteAuthToolInput(untrustedInput)
    const { principal, ownership } = await trustedPrincipal(ownershipSource, this.#processIdentity)

    if (!this.#active) {
      if (input.action === "status") return { type: "status", status: INACTIVE_PUBLIC_STATUS }
      throw new RemoteAuthRuntimeError("inactive")
    }

    const envelope: RemoteAuthRequestEnvelope = input.action === "request"
      ? { type: "execution", request: toExecutionRequest(input, principal) }
      : { type: "control", control: toControlRequest(input) }

    const response = await this.#client.request(envelope, signal)
    await assertCurrentOwnership(ownership)
    assertResponseMatchesRequest(envelope, response)
    return response
  }
}

export function publicErrorFrom(error: unknown): PublicError {
  if (error instanceof RemoteAuthRuntimeError || error instanceof RemoteAuthClientError) return error.code
  return decodeStrict(PublicErrorSchema, "internal")
}
