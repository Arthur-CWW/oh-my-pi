import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { Schema } from "effect"

const noncePattern = /^[A-Za-z0-9_-]{22,128}$/
const nodeIdPattern = /^node_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hashPattern = /^[0-9a-f]{64}$/
const signaturePattern = /^[0-9a-f]{64}$/
const methodPattern = /^[A-Z]{1,16}$/
const MAX_AUTH_PATH_LENGTH = 2_048
const MAX_AUTH_BODY_BYTES = 64 * 1024

export type RelayNonce = string
export const RelayNonceSchema = Schema.declare<RelayNonce>((value): value is RelayNonce => {
  try {
    validateNonce(value)
    return true
  } catch {
    return false
  }
})

export function decodeRelayNonce(value: unknown): RelayNonce {
  validateNonce(value)
  return Schema.decodeUnknownSync(RelayNonceSchema)(value)
}

export const makeRelayNonce = decodeRelayNonce

const RelayAuthV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), nodeId: Schema.String, nonce: RelayNonceSchema, bodyHash: Schema.String, signature: Schema.String,
})
export type RelayAuthV1 = Schema.Schema.Type<typeof RelayAuthV1ShapeSchema>
export const RelayAuthV1Schema = Schema.declare<RelayAuthV1>((value): value is RelayAuthV1 => {
  try {
    validateRelayAuth(value)
    Schema.decodeUnknownSync(RelayAuthV1ShapeSchema)(value)
    return true
  } catch {
    return false
  }
})

export interface RelaySigningRequestV1 {
  readonly method: string
  readonly path: string
  readonly body: string | Uint8Array
  readonly nonce: string
  readonly nodeId: string
}

export interface RelayVerificationRequestV1 {
  readonly method: string
  readonly path: string
  readonly body: string | Uint8Array
  readonly auth: RelayAuthV1
}

/** Parses and canonically encodes the JSON relay body before hashing it. */
export function canonicalRelayBody(body: string | Uint8Array): string {
  const bytes = bodyBytes(body)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new Error("relay body must be valid JSON")
  }
  const canonical = canonicalJson(parsed, 0)
  if (Buffer.byteLength(canonical, "utf8") > MAX_AUTH_BODY_BYTES) throw new Error("oversized relay body")
  return canonical
}

/** Returns the lower-case SHA-256 digest of canonical JSON request bytes. */
export function relayBodyHash(body: string | Uint8Array): string {
  return createHash("sha256").update(canonicalRelayBody(body), "utf8").digest("hex")
}

/** Canonical signing input; every component is schema-validated before joining. */
export function canonicalRelayRequestV1(request: RelaySigningRequestV1, bodyHash: string = relayBodyHash(request.body)): string {
  validateRequest(request)
  validateHash(bodyHash, "bodyHash")
  return `${request.method}\n${request.path}\n${bodyHash}\n${request.nonce}\n${request.nodeId}`
}

/** Signs a request without retaining or exposing the secret. */
export function signRelayRequestV1(request: RelaySigningRequestV1, secret: string | Uint8Array): Readonly<RelayAuthV1> {
  const key = decodeSecret(secret)
  const bodyHash = relayBodyHash(request.body)
  const signature = createHmac("sha256", key).update(canonicalRelayRequestV1(request, bodyHash)).digest("hex")
  return Object.freeze({ v: 1, nodeId: request.nodeId, nonce: request.nonce, bodyHash, signature })
}

/** Verifies the body hash before comparing the HMAC in constant time. */
export function verifyRelayRequestV1(request: RelayVerificationRequestV1, secret: string | Uint8Array): boolean {
  try {
    const auth = decodeRelayAuthV1(request.auth)
    const signingRequest: RelaySigningRequestV1 = { ...request, nonce: auth.nonce, nodeId: auth.nodeId }
    validateRequest(signingRequest)
    const suppliedBodyHash = Buffer.from(auth.bodyHash, "utf8")
    const actualBodyHash = Buffer.from(relayBodyHash(request.body), "utf8")
    if (suppliedBodyHash.length !== actualBodyHash.length || !timingSafeEqual(suppliedBodyHash, actualBodyHash)) return false
    const expected = createHmac("sha256", decodeSecret(secret)).update(canonicalRelayRequestV1(signingRequest, auth.bodyHash)).digest()
    const supplied = Buffer.from(auth.signature, "hex")
    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
  } catch {
    return false
  }
}

export function decodeRelayAuthV1(value: unknown): Readonly<RelayAuthV1> {
  validateRelayAuth(value)
  return Object.freeze(Schema.decodeUnknownSync(RelayAuthV1ShapeSchema)(value))
}

function validateRelayAuth(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("relay auth must be an object")
  const record = value as Record<string, unknown>
  const keys = ["v", "nodeId", "nonce", "bodyHash", "signature"] as const
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) || Object.keys(record).some((key) => !keys.includes(key as typeof keys[number]))) throw new Error("invalid relay auth fields")
  if (record.v !== 1) throw new Error("unsupported relay auth version")
  validateNodeId(record.nodeId)
  validateNonce(record.nonce)
  validateHash(record.bodyHash, "bodyHash")
  if (typeof record.signature !== "string" || !signaturePattern.test(record.signature)) throw new Error("invalid relay signature")
}

export function redactRelayAuth(auth: Pick<RelayAuthV1, "nodeId" | "nonce" | "bodyHash">): Readonly<{ readonly v: 1; readonly nodeId: string; readonly nonce: string; readonly bodyHash: string; readonly signature: "[REDACTED]" }> {
  return Object.freeze({ v: 1, nodeId: auth.nodeId, nonce: auth.nonce, bodyHash: auth.bodyHash, signature: "[REDACTED]" })
}

function validateRequest(request: RelaySigningRequestV1): void {
  if (typeof request.method !== "string" || !methodPattern.test(request.method)) throw new Error("invalid relay method")
  if (typeof request.path !== "string" || request.path.length === 0 || request.path.length > MAX_AUTH_PATH_LENGTH || !request.path.startsWith("/") || /[\r\n]/.test(request.path)) throw new Error("invalid relay path")
  validateNonce(request.nonce)
  validateNodeId(request.nodeId)
  bodyBytes(request.body)
}

function validateNonce(value: unknown): void {
  if (typeof value !== "string" || !noncePattern.test(value)) throw new Error("invalid relay nonce")
}

function validateNodeId(value: unknown): void {
  if (typeof value !== "string" || !nodeIdPattern.test(value)) throw new Error("invalid relay nodeId")
}

function validateHash(value: unknown, name: string): void {
  if (typeof value !== "string" || !hashPattern.test(value)) throw new Error(`invalid relay ${name}`)
}

function bodyBytes(body: string | Uint8Array): Uint8Array {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body
  if (bytes.byteLength > MAX_AUTH_BODY_BYTES) throw new Error("oversized relay body")
  return bytes
}

function decodeSecret(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === "string" ? Buffer.from(secret, "base64") : secret
  if (bytes.byteLength !== 32) throw new Error("invalid relay secret")
  return bytes
}

function canonicalJson(value: unknown, depth: number): string {
  if (depth > 8) throw new Error("relay body exceeds maximum depth")
  if (value === null || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("relay body contains a non-finite number")
    return JSON.stringify(value)
  }
  if (typeof value === "string") {
    if (value.length > 16 * 1024) throw new Error("relay body contains an oversized string")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (value.length > 128) throw new Error("relay body contains too many array items")
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`
  }
  if (value === undefined || typeof value !== "object") throw new Error("relay body contains an unsupported value")
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 64) throw new Error("relay body contains too many object keys")
  return `{${entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => {
    if (key.length > 256) throw new Error("relay body contains an oversized key")
    return `${JSON.stringify(key)}:${canonicalJson(item, depth + 1)}`
  }).join(",")}}`
}
