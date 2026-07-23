import { createPublicKey, verify } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  MAX_REQUEST_LIFETIME_MS,
  PROTOCOL_VERSION,
  ProtocolValidationError,
  decodeControlRequest,
  decodeExecutionRequest,
  decodeGdmChallenge,
  decodeGdmEnvelope,
  isValidGdmSentinel,
  type PublicError,
} from "../protocol.ts"
import {
  buildExecutionRequestTranscript,
  buildGdmEnvelopeSignatureTranscript,
  buildGdmHpkeAadTranscript,
  buildGdmHpkeInfoTranscript,
  decodeSudoSignedRequest,
  sha256Digest,
} from "../transcript.ts"
import {
  base64UrlToBytes,
  bytesToHex,
  hexToBytes,
  protocolFixture,
  replaceTopLevelField,
  requestVector,
} from "./vector-fixture.ts"

const UTF8_ENCODER = new TextEncoder()
const ED25519_SPKI_PREFIX = hexToBytes("302a300506032b6570032100")

function expectProtocolError(action: () => unknown, code: PublicError): void {
  try {
    action()
    throw new Error("Expected protocol validation to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolValidationError)
    if (!(error instanceof ProtocolValidationError)) return
    expect(error.code).toBe(code)
    expect(error.message.length).toBeLessThanOrEqual(128)
  }
}

function verifyFixtureSignature(transcript: Uint8Array, signature: string): boolean {
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from(ED25519_SPKI_PREFIX),
      Buffer.from(base64UrlToBytes(protocolFixture.gdmCryptoVector.ed25519PublicKey)),
    ]),
    format: "der",
    type: "spki",
  })
  return verify(null, Buffer.from(transcript), publicKey, Buffer.from(base64UrlToBytes(signature)))
}

describe("shared protocol vectors", () => {
  for (const vector of protocolFixture.requestVectors) {
    test(`${vector.name} request transcript and digest`, () => {
      const request = decodeExecutionRequest(vector.request)
      const transcript = buildExecutionRequestTranscript(request)
      expect(bytesToHex(transcript)).toBe(vector.transcriptHex)
      expect(sha256Digest(transcript)).toBe(vector.sha256)
      if (vector.ed25519Signature !== undefined) {
        expect(verifyFixtureSignature(transcript, vector.ed25519Signature)).toBe(true)
      }
    })
  }

  test("GDM HPKE and signature transcripts preserve the RFC 9180 vector representation", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    const cryptoVector = protocolFixture.gdmCryptoVector
    const challenge = decodeGdmChallenge(cryptoVector.challenge)
    const hpkeInfo = buildGdmHpkeInfoTranscript(cryptoVector.recipientKeyId)
    const hpkeAad = buildGdmHpkeAadTranscript(
      request,
      challenge,
      cryptoVector.issueId,
      cryptoVector.sentinelHash,
    )
    const encapsulatedKey = base64UrlToBytes(cryptoVector.encapsulatedKey)
    const ciphertext = base64UrlToBytes(cryptoVector.ciphertext)
    const signatureTranscript = buildGdmEnvelopeSignatureTranscript(
      hpkeAad,
      encapsulatedKey,
      ciphertext,
      cryptoVector.signingKeyId,
    )

    expect(bytesToHex(hpkeInfo)).toBe(cryptoVector.hpkeInfoTranscriptHex)
    expect(bytesToHex(hpkeAad)).toBe(cryptoVector.hpkeAadTranscriptHex)
    expect(bytesToHex(signatureTranscript)).toBe(cryptoVector.signatureTranscriptHex)
    expect(sha256Digest(UTF8_ENCODER.encode(cryptoVector.sentinel))).toBe(cryptoVector.sentinelHash)
    expect(encapsulatedKey.byteLength).toBe(32)
    expect(ciphertext.byteLength).toBe(hexToBytes(cryptoVector.plaintextTestPayloadHex).byteLength + 16)
    expect(base64UrlToBytes(cryptoVector.signature).byteLength).toBe(64)
    expect(verifyFixtureSignature(signatureTranscript, cryptoVector.signature)).toBe(true)

    const envelope = decodeGdmEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      request,
      challenge,
      issueId: cryptoVector.issueId,
      sentinelHash: cryptoVector.sentinelHash,
      hpkeEnc: cryptoVector.encapsulatedKey,
      ciphertext: cryptoVector.ciphertext,
      signingKeyId: cryptoVector.signingKeyId,
      signature: cryptoVector.signature,
    })
    expect(envelope.hpkeEnc).toBe(cryptoVector.encapsulatedKey)
    expectProtocolError(
      () => decodeGdmEnvelope({ ...envelope, hpkeEnc: envelope.hpkeEnc.slice(1) }),
      "noncanonical-value",
    )
    expectProtocolError(
      () => decodeGdmEnvelope({ ...envelope, signature: envelope.signature.slice(1) }),
      "noncanonical-value",
    )
  })

  test("GDM ciphertext enforces the decoded AEAD-tag boundary", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    const cryptoVector = protocolFixture.gdmCryptoVector
    const challenge = decodeGdmChallenge(cryptoVector.challenge)
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      request,
      challenge,
      issueId: cryptoVector.issueId,
      sentinelHash: cryptoVector.sentinelHash,
      hpkeEnc: cryptoVector.encapsulatedKey,
      signingKeyId: cryptoVector.signingKeyId,
      signature: cryptoVector.signature,
    }
    for (const ciphertext of ["A".repeat(19), "A".repeat(20)]) {
      expect(base64UrlToBytes(ciphertext).byteLength).toBeLessThan(16)
      expectProtocolError(
        () => decodeGdmEnvelope({ ...envelope, ciphertext }),
        "noncanonical-value",
      )
    }
    const minimumCiphertext = "A".repeat(22)
    expect(base64UrlToBytes(minimumCiphertext).byteLength).toBe(16)
    expect(
      decodeGdmEnvelope({ ...envelope, ciphertext: minimumCiphertext }).ciphertext,
    ).toBe(minimumCiphertext)
  })

  test("the sudo vector has the fixed Ed25519 wire representation", () => {
    const vector = requestVector("sudo-biometric-one-shot")
    if (vector.ed25519Signature === undefined) throw new Error("Sudo vector lacks its signature")
    const request = decodeExecutionRequest(vector.request)
    const signedInput = {
      protocolVersion: PROTOCOL_VERSION,
      request,
      canonicalBodyDigest: vector.sha256,
      signingKeyId: protocolFixture.gdmCryptoVector.signingKeyId,
      signature: vector.ed25519Signature,
    }
    const signed = decodeSudoSignedRequest(signedInput)
    expect(base64UrlToBytes(signed.signature).byteLength).toBe(64)
    expect(verifyFixtureSignature(buildExecutionRequestTranscript(request), signed.signature)).toBe(true)
    const mismatchedDigest = `${
      vector.sha256[0] === "0" ? "1" : "0"
    }${vector.sha256.slice(1)}`
    expectProtocolError(
      () => decodeSudoSignedRequest({ ...signedInput, canonicalBodyDigest: mismatchedDigest }),
      "integrity-failure",
    )
  })
})

describe("closed request validation", () => {
  for (const malformed of protocolFixture.malformedRequestCases) {
    test(malformed.case, () => {
      const base = requestVector(malformed.base)
      const mutated = replaceTopLevelField(base.request, malformed.mutation.path, malformed.mutation.value)
      expectProtocolError(() => decodeExecutionRequest(mutated), malformed.expectedError)
    })
  }

  test("rejects nested excess fields", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    expectProtocolError(
      () => decodeExecutionRequest({
        ...request,
        principal: { ...request.principal, credential: "must-not-be-accepted" },
      }),
      "excess-field",
    )
    expectProtocolError(
      () => decodeExecutionRequest({
        ...request,
        target: { ...request.target, unexpected: true },
      }),
      "excess-field",
    )
  })

  test("requires canonical UUID owner epochs", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    const invalidOwnerEpochs: readonly unknown[] = [
      7,
      "00112233-4455-4677-8899-AABBCCDDEEFF",
      "00112233-4455-4677-8899-aabbccddeef",
      "00112233-4455-0677-8899-aabbccddeeff",
      "00112233-4455-4677-7899-aabbccddeeff",
    ]
    for (const ownerEpoch of invalidOwnerEpochs) {
      expectProtocolError(
        () => decodeExecutionRequest({
          ...request,
          principal: { ...request.principal, ownerEpoch },
        }),
        "noncanonical-value",
      )
    }
  })

  test("requires a canonical owner-private ownership socket path", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    const invalidPaths = [
      "relative/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock",
      "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/../owner.sock",
      "/tmp/owners-v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/claim/owner.sock",
      "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/other.sock",
      `/tmp/${"x".repeat(40)}/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock`,
    ] as const
    for (const ownershipSocketPath of invalidPaths) {
      expectProtocolError(
        () => decodeExecutionRequest({
          ...request,
          principal: { ...request.principal, ownershipSocketPath },
        }),
        "noncanonical-value",
      )
    }
  })

  test("rejects operation and target disagreement", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    expectProtocolError(
      () => decodeExecutionRequest({ ...request, operation: "bitwarden-unlock" }),
      "target-mismatch",
    )
  })

  test("rejects malformed and noncanonical grant IDs with a bounded grant error", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    expectProtocolError(
      () => decodeExecutionRequest({ ...request, grantId: "grant-v2:ICEiIyQlJicoKSorLC0uLw" }),
      "grant-invalid",
    )
    expectProtocolError(
      () => decodeExecutionRequest({ ...request, grantId: "grant-v1:ICEiIyQlJicoKSorLC0uLx" }),
      "grant-invalid",
    )
  })

  test("accepts the request lifetime boundary and rejects time edge violations", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    expect(decodeExecutionRequest({
      ...request,
      expiresAt: request.createdAt + MAX_REQUEST_LIFETIME_MS,
    }).expiresAt).toBe(request.createdAt + MAX_REQUEST_LIFETIME_MS)
    expectProtocolError(
      () => decodeExecutionRequest({ ...request, expiresAt: request.createdAt }),
      "request-expired",
    )
    expectProtocolError(
      () => decodeExecutionRequest({
        ...request,
        expiresAt: request.createdAt + MAX_REQUEST_LIFETIME_MS + 1,
      }),
      "noncanonical-value",
    )
    expectProtocolError(
      () => decodeExecutionRequest({ ...request, createdAt: Number.MAX_SAFE_INTEGER + 1 }),
      "noncanonical-value",
    )
  })

  for (const control of ["\u0000", "\n", "\u007f", "\u0085"]) {
    test(`rejects purpose text containing control U+${control.codePointAt(0)?.toString(16).padStart(4, "0")}`, () => {
      const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
      expectProtocolError(
        () => decodeExecutionRequest({ ...request, purpose: `invalid${control}purpose` }),
        "noncanonical-value",
      )
    })
  }

  test("requires canonical request IDs rather than regex-only base64url", () => {
    const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
    const noncanonical = `${request.requestId.slice(0, -1)}x`
    expectProtocolError(
      () => decodeExecutionRequest({ ...request, requestId: noncanonical }),
      "noncanonical-value",
    )
  })
})

describe("closed control requests", () => {
  test("accepts only the exact control variant", () => {
    expect(decodeControlRequest({ action: "status" })).toEqual({ action: "status" })
    expectProtocolError(
      () => decodeControlRequest({ action: "status", requestId: requestVector("gdm-delegated").name }),
      "excess-field",
    )
    expectProtocolError(
      () => decodeControlRequest({ action: "grant-revoke", grantId: "grant-v1:not-canonical" }),
      "noncanonical-value",
    )
  })
})

describe("GDM sentinel validation", () => {
  for (const sentinelCase of protocolFixture.sentinelCases) {
    test(`${sentinelCase.valid ? "accepts" : "rejects"} ${sentinelCase.value}`, () => {
      expect(isValidGdmSentinel(sentinelCase.value)).toBe(sentinelCase.valid)
    })
  }
})
