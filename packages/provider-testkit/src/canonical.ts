import { createHash } from "node:crypto"
import type { ComponentDigests, DigestComponent, DigestMismatch } from "./errors"
import { REQUEST_SCHEMA_VERSION, type JsonValue, type ProviderRequest } from "./protocol"

/**
 * Bumping this invalidates every sealed cassette: a canonicalizer change means
 * previously equal requests may no longer be equal.
 */
export const CANONICALIZER_VERSION = 1

const DOMAIN_SEPARATOR = "omp.provider-testkit/request-digest/v1"
const FIELD_SEPARATOR = "\u0000"

/**
 * The only normalizations the canonicalizer is permitted to perform: Unicode NFC
 * and LF line endings. It never trims, collapses, lowercases, or reorders text.
 */
const normalizeText = (value: string): string => {
  const nfc = value.normalize("NFC")
  return nfc.includes("\r") ? nfc.replace(/\r\n?/g, "\n") : nfc
}

/**
 * Object keys are sorted; array order is preserved because message, prompt-part,
 * tool and enum order is semantic.
 */
const canonicalize = (value: JsonValue, normalizeStrings: boolean): JsonValue => {
  if (typeof value === "string") return normalizeStrings ? normalizeText(value) : value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical request bytes cannot contain a non-finite number")
    return value === 0 ? 0 : value
  }
  if (value === null || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    const out: JsonValue[] = new Array(value.length)
    for (let i = 0; i < value.length; i++) out[i] = canonicalize(value[i] as JsonValue, normalizeStrings)
    return out
  }
  const source = value as { readonly [key: string]: JsonValue }
  const keys = Object.keys(source).sort()
  const out: Record<string, JsonValue> = {}
  for (const key of keys) {
    const entry = source[key]
    if (entry === undefined) continue
    out[normalizeText(key)] = canonicalize(entry, normalizeStrings)
  }
  return out
}

/** Digest input: sorts keys and applies the two permitted text normalizations. */
export const canonicalJson = (value: JsonValue): string => JSON.stringify(canonicalize(value, true))

/**
 * Cassette bytes: sorts keys for reproducible checksums but never touches text.
 * Recorded chunk boundaries must survive byte-exact — NFC-normalizing a split
 * combining sequence per fragment would silently break the invariant that
 * concatenated fragments equal the final tool arguments.
 */
export const stableJson = (value: JsonValue): string => JSON.stringify(canonicalize(value, false))

export const digestOf = (label: string, value: JsonValue): string =>
  `sha256:${createHash("sha256")
    .update(DOMAIN_SEPARATOR)
    .update(FIELD_SEPARATOR)
    .update(label)
    .update(FIELD_SEPARATOR)
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`

export const sha256Hex = (bytes: string): string => `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`

// ---------------------------------------------------------------------------
// Component views
//
// Each view is a *total* projection of one identity dimension. `volatile` is
// never read by any view, so credentials, trace IDs, wall time and baggage
// cannot influence the digest.
// ---------------------------------------------------------------------------

const routeView = (request: ProviderRequest): JsonValue => ({
  providerApi: request.route.providerApi,
  model: request.route.model,
})

const contractView = (request: ProviderRequest): JsonValue => ({
  promptVersion: request.contract.promptVersion,
  toolContractVersion: request.contract.toolContractVersion,
  productContractVersion: request.contract.productContractVersion ?? null,
})

const promptView = (request: ProviderRequest): JsonValue => request.system

/**
 * Typed boundary. Schema-decoded protocol values are JSON trees by construction
 * (every leaf is string/number/boolean/null), but their nominal object types are
 * not assignable to the structural `JsonValue` index signature. This is the only
 * place in the package where that identity is asserted; `canonicalize` still
 * walks the tree and rejects anything that is not JSON-representable.
 */
export const jsonOf = <A extends object>(value: A): JsonValue => value as unknown as JsonValue

const conversationView = (request: ProviderRequest): JsonValue => jsonOf(request.messages)

const toolsView = (request: ProviderRequest): JsonValue => jsonOf(request.tools)

const generationView = (request: ProviderRequest): JsonValue => jsonOf(request.generation)

export const componentDigests = (request: ProviderRequest): ComponentDigests => ({
  route: digestOf("route", routeView(request)),
  contract: digestOf("contract", contractView(request)),
  prompt: digestOf("prompt", promptView(request)),
  conversation: digestOf("conversation", conversationView(request)),
  tools: digestOf("tools", toolsView(request)),
  generation: digestOf("generation", generationView(request)),
})

/** `SHA-256(domain separator || canonical request bytes)` over every identity dimension. */
export const requestDigest = (request: ProviderRequest): string =>
  digestOf("request", {
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    canonicalizerVersion: CANONICALIZER_VERSION,
    route: routeView(request),
    contract: contractView(request),
    prompt: promptView(request),
    conversation: conversationView(request),
    tools: toolsView(request),
    generation: generationView(request),
  })

export interface RequestIdentity {
  readonly requestDigest: string
  readonly componentDigests: ComponentDigests
}

export const requestIdentity = (request: ProviderRequest): RequestIdentity => ({
  requestDigest: requestDigest(request),
  componentDigests: componentDigests(request),
})

const COMPONENT_ORDER: readonly DigestComponent[] = [
  "route",
  "contract",
  "prompt",
  "conversation",
  "tools",
  "generation",
]

export const diffComponentDigests = (
  expected: ComponentDigests,
  actual: ComponentDigests,
): readonly DigestMismatch[] => {
  const out: DigestMismatch[] = []
  for (const component of COMPONENT_ORDER) {
    if (expected[component] !== actual[component]) {
      out.push({ component, expected: expected[component], actual: actual[component] })
    }
  }
  return out
}
