import { Schema } from "effect"
import {
  DigestSchema,
  IdSchema,
  MAX_GDM_CIPHERTEXT_BYTES,
  MIN_GDM_CIPHERTEXT_BYTES,
  PROTOCOL_VERSION,
  ProtocolValidationError,
  decodeExecutionRequest,
  decodeGdmChallenge,
  decodeSudoSignedRequestStructure,
  isValidGdmSentinel,
  type ExecutionRequest,
  type GdmChallenge,
  type Principal,
  type SudoSignedRequest,
  type Target,
} from "./protocol.ts"

export { isValidGdmSentinel } from "./protocol.ts"

const MAGIC = Uint8Array.of(0x52, 0x41, 0x42, 0x31)
const UTF8_ENCODER = new TextEncoder()
const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const

function decodeTranscriptValue<A>(schema: Schema.Codec<A>, input: unknown): A {
  try {
    return Schema.decodeUnknownSync(schema)(input, STRICT_DECODE_OPTIONS)
  } catch {
    throw new ProtocolValidationError("noncanonical-value", "Transcript field is not canonical")
  }
}

export const TRANSCRIPT_DOMAIN = {
  desktopBrowserRequest: "remote-auth-broker/v1/desktop-browser/execution-request",
  sudoRequest: "remote-auth-broker/v1/sudo/execution-request",
  gdmHpkeInfo: "remote-auth-broker/v1/desktop-browser/gdm-hpke-info",
  gdmHpkeAad: "remote-auth-broker/v1/desktop-browser/gdm-hpke-aad",
  gdmEnvelopeSignature: "remote-auth-broker/v1/desktop-browser/gdm-envelope-signature",
} as const

class ByteWriter {
  readonly #chunks: Uint8Array[] = []
  #length = 0

  append(bytes: Uint8Array): void {
    this.#chunks.push(bytes)
    this.#length += bytes.byteLength
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.#length)
    let offset = 0
    for (const chunk of this.#chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  }
}

function uint16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new ProtocolValidationError("noncanonical-value", "Transcript u16 value is out of range")
  }
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, false)
  return bytes
}

function uint32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new ProtocolValidationError("noncanonical-value", "Transcript u32 value is out of range")
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function uint64(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProtocolValidationError("noncanonical-value", "Transcript u64 value is out of range")
  }
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false)
  return bytes
}

function utf8(value: string): Uint8Array {
  return UTF8_ENCODER.encode(value)
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.byteLength
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function optionalString(value: string | null): Uint8Array {
  return value === null ? Uint8Array.of(0) : concatenate(Uint8Array.of(1), utf8(value))
}

function stringArray(values: readonly string[]): Uint8Array {
  const writer = new ByteWriter()
  writer.append(uint32(values.length))
  for (const value of values) {
    const bytes = utf8(value)
    writer.append(uint32(bytes.byteLength))
    writer.append(bytes)
  }
  return writer.finish()
}

function orderedFields(fields: readonly (readonly [name: string, value: Uint8Array])[]): Uint8Array {
  const writer = new ByteWriter()
  for (const [name, value] of fields) {
    const nameBytes = utf8(name)
    writer.append(uint16(nameBytes.byteLength))
    writer.append(nameBytes)
    writer.append(uint32(value.byteLength))
    writer.append(value)
  }
  return writer.finish()
}

function transcript(domain: string, fields: readonly (readonly [name: string, value: Uint8Array])[]): Uint8Array {
  const domainBytes = utf8(domain)
  return concatenate(MAGIC, uint16(domainBytes.byteLength), domainBytes, orderedFields(fields))
}

function encodePrincipal(principal: Principal): Uint8Array {
  return orderedFields([
    ["sessionId", utf8(principal.sessionId)],
    ["ownerEpoch", utf8(principal.ownerEpoch)],
    ["pid", uint32(principal.pid)],
    ["uid", uint32(principal.uid)],
    ["codeIdentity", utf8(principal.codeIdentity)],
    ["buildDigest", utf8(principal.buildDigest)],
    ["runnerInstanceIdentity", utf8(principal.runnerInstanceIdentity)],
    ["ownershipSocketPath", utf8(principal.ownershipSocketPath)],
  ])
}

function encodeTarget(target: Target): Uint8Array {
  switch (target.kind) {
    case "gdm":
      return orderedFields([
        ["kind", utf8(target.kind)],
        ["sshHostKeyDigest", utf8(target.sshHostKeyDigest)],
        ["machineId", utf8(target.machineId)],
        ["bootId", utf8(target.bootId)],
        ["username", utf8(target.username)],
        ["uid", uint32(target.uid)],
        ["pamService", utf8(target.pamService)],
        ["seat", utf8(target.seat)],
        ["tty", utf8(target.tty)],
        ["rhost", utf8(target.rhost)],
        ["greeterGeneration", uint64(target.greeterGeneration)],
        ["jetkvmDeviceId", utf8(target.jetkvmDeviceId)],
        ["controllerGeneration", uint64(target.controllerGeneration)],
      ])
    case "bitwarden":
      return orderedFields([
        ["kind", utf8(target.kind)],
        ["hostIdentity", utf8(target.hostIdentity)],
        ["graphicalSessionId", utf8(target.graphicalSessionId)],
        ["chromeService", utf8(target.chromeService)],
        ["chromeExecutableDigest", utf8(target.chromeExecutableDigest)],
        ["chromePid", uint32(target.chromePid)],
        ["profileIdentity", utf8(target.profileIdentity)],
        ["browserTargetId", utf8(target.browserTargetId)],
        ["windowId", utf8(target.windowId)],
        ["extensionId", utf8(target.extensionId)],
        ["extensionVersion", utf8(target.extensionVersion)],
        ["extensionSource", utf8(target.extensionSource)],
        ["manifestDigest", utf8(target.manifestDigest)],
        ["uiTarget", utf8(target.uiTarget)],
      ])
    case "website":
      return orderedFields([
        ["kind", utf8(target.kind)],
        ["hostIdentity", utf8(target.hostIdentity)],
        ["graphicalSessionId", utf8(target.graphicalSessionId)],
        ["chromeService", utf8(target.chromeService)],
        ["chromeExecutableDigest", utf8(target.chromeExecutableDigest)],
        ["chromePid", uint32(target.chromePid)],
        ["profileIdentity", utf8(target.profileIdentity)],
        ["browserTargetId", utf8(target.browserTargetId)],
        ["windowId", utf8(target.windowId)],
        ["extensionId", utf8(target.extensionId)],
        ["extensionVersion", utf8(target.extensionVersion)],
        ["extensionSource", utf8(target.extensionSource)],
        ["manifestDigest", utf8(target.manifestDigest)],
        ["uiTarget", utf8(target.uiTarget)],
        ["originSet", stringArray(target.originSet)],
        ["activeTabId", utf8(target.activeTabId)],
        ["frameId", utf8(target.frameId)],
        ["formActionOrigin", utf8(target.formActionOrigin)],
        ["foregroundWindowId", utf8(target.foregroundWindowId)],
        ["credentialPairingId", utf8(target.credentialPairingId)],
      ])
    case "sudo":
      return orderedFields([
        ["kind", utf8(target.kind)],
        ["sshHostKeyDigest", utf8(target.sshHostKeyDigest)],
        ["machineId", utf8(target.machineId)],
        ["bootId", utf8(target.bootId)],
        ["username", utf8(target.username)],
        ["uid", uint32(target.uid)],
        ["sudoPolicyDigest", utf8(target.sudoPolicyDigest)],
        ["actionId", utf8(target.actionId)],
        ["executable", utf8(target.executable)],
        ["argvDigest", utf8(target.argvDigest)],
      ])
  }
}

function encodeGdmChallenge(challenge: GdmChallenge): Uint8Array {
  return orderedFields([
    ["protocolVersion", uint32(challenge.protocolVersion)],
    ["challengeId", utf8(challenge.challengeId)],
    ["challenge", utf8(challenge.challenge)],
    ["bootId", utf8(challenge.bootId)],
    ["issuedBoottimeMs", uint64(challenge.issuedBoottimeMs)],
    ["expiresBoottimeMs", uint64(challenge.expiresBoottimeMs)],
    ["policyDigest", utf8(challenge.policyDigest)],
  ])
}

function encodeExecutionRequestTranscript(request: ExecutionRequest): Uint8Array {
  const domain = request.domain === "desktop-browser"
    ? TRANSCRIPT_DOMAIN.desktopBrowserRequest
    : TRANSCRIPT_DOMAIN.sudoRequest
  return transcript(domain, [
    ["protocolVersion", uint32(request.protocolVersion)],
    ["requestId", utf8(request.requestId)],
    ["nonce", utf8(request.nonce)],
    ["createdAt", uint64(request.createdAt)],
    ["expiresAt", uint64(request.expiresAt)],
    ["principal", encodePrincipal(request.principal)],
    ["authorizationModeRequested", utf8(request.authorizationModeRequested)],
    ["domain", utf8(request.domain)],
    ["operation", utf8(request.operation)],
    ["target", encodeTarget(request.target)],
    ["purpose", utf8(request.purpose)],
    ["grantId", optionalString(request.grantId)],
  ])
}

export function buildExecutionRequestTranscript(input: ExecutionRequest): Uint8Array {
  return encodeExecutionRequestTranscript(decodeExecutionRequest(input))
}

export function buildGdmHpkeInfoTranscript(recipientKeyId: string): Uint8Array {
  const keyId = decodeTranscriptValue(IdSchema, recipientKeyId)
  return transcript(TRANSCRIPT_DOMAIN.gdmHpkeInfo, [
    ["protocolVersion", uint32(PROTOCOL_VERSION)],
    ["recipientKeyId", utf8(keyId)],
  ])
}

export function buildGdmHpkeAadTranscript(
  requestInput: ExecutionRequest,
  challengeInput: GdmChallenge,
  issueIdInput: string,
  sentinelHashInput: string,
): Uint8Array {
  const request = decodeExecutionRequest(requestInput)
  const challenge = decodeGdmChallenge(challengeInput)
  const issueId = decodeTranscriptValue(IdSchema, issueIdInput)
  const sentinelHash = decodeTranscriptValue(DigestSchema, sentinelHashInput)
  if (request.target.kind !== "gdm" || request.target.bootId !== challenge.bootId) {
    throw new ProtocolValidationError("challenge-invalid", "Challenge does not bind the GDM request boot")
  }
  return transcript(TRANSCRIPT_DOMAIN.gdmHpkeAad, [
    ["requestTranscript", encodeExecutionRequestTranscript(request)],
    ["challenge", encodeGdmChallenge(challenge)],
    ["issueId", utf8(issueId)],
    ["sentinelHash", utf8(sentinelHash)],
  ])
}

export function buildGdmEnvelopeSignatureTranscript(
  hpkeAadTranscript: Uint8Array,
  hpkeEnc: Uint8Array,
  ciphertext: Uint8Array,
  signingKeyIdInput: string,
): Uint8Array {
  const signingKeyId = decodeTranscriptValue(IdSchema, signingKeyIdInput)
  if (hpkeEnc.byteLength !== 32) {
    throw new ProtocolValidationError("noncanonical-value", "HPKE encapsulated key must be 32 bytes")
  }
  if (
    ciphertext.byteLength < MIN_GDM_CIPHERTEXT_BYTES ||
    ciphertext.byteLength > MAX_GDM_CIPHERTEXT_BYTES
  ) {
    throw new ProtocolValidationError("noncanonical-value", "HPKE ciphertext length is outside protocol bounds")
  }
  return transcript(TRANSCRIPT_DOMAIN.gdmEnvelopeSignature, [
    ["hpkeAadTranscript", hpkeAadTranscript],
    ["hpkeEnc", hpkeEnc],
    ["ciphertext", ciphertext],
    ["signingKeyId", utf8(signingKeyId)],
  ])
}

export function sha256Digest(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
}

export function decodeSudoSignedRequest(input: unknown): SudoSignedRequest {
  const signed = decodeSudoSignedRequestStructure(input)
  const acceptedBodyDigest = sha256Digest(encodeExecutionRequestTranscript(signed.request))
  if (signed.canonicalBodyDigest !== acceptedBodyDigest) {
    throw new ProtocolValidationError("integrity-failure", "Sudo canonical body digest does not match the accepted request")
  }
  return signed
}
