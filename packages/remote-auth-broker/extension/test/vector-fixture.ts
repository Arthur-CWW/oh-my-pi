import { Schema } from "effect"
import {
  DigestSchema,
  Ed25519SignatureSchema,
  GdmCiphertextSchema,
  GdmSentinelSchema,
  HpkeEncSchema,
  IdSchema,
  MAX_FRAME_BYTES,
  PublicErrorSchema,
} from "../protocol.ts"

const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const
const HexSchema = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{2})+$/))

const RequestVectorSchema = Schema.Struct({
  name: Schema.String,
  request: Schema.Unknown,
  transcriptHex: HexSchema,
  sha256: DigestSchema,
  ed25519Signature: Schema.optionalKey(Ed25519SignatureSchema),
})

const GdmCryptoVectorSchema = Schema.Struct({
  challenge: Schema.Unknown,
  issueId: IdSchema,
  sentinel: GdmSentinelSchema,
  sentinelHash: DigestSchema,
  recipientKeyId: IdSchema,
  hpkeInfoTranscriptHex: HexSchema,
  hpkeAadTranscriptHex: HexSchema,
  recipientPrivateKeyTestOnly: HpkeEncSchema,
  recipientPublicKey: HpkeEncSchema,
  ephemeralPrivateKeyTestOnly: HpkeEncSchema,
  encapsulatedKey: HpkeEncSchema,
  plaintextTestPayloadHex: HexSchema,
  ciphertext: GdmCiphertextSchema,
  signingKeyId: IdSchema,
  ed25519PrivateSeedTestOnly: HpkeEncSchema,
  ed25519PublicKey: HpkeEncSchema,
  signatureTranscriptHex: HexSchema,
  signature: Ed25519SignatureSchema,
})

const ProtocolFixtureSchema = Schema.Struct({
  fixtureVersion: Schema.Literal(1),
  credentialFree: Schema.Literal(true),
  encoding: Schema.Struct({
    magicHex: Schema.Literal("52414231"),
    lengthFraming: Schema.Literal("u32be JSON byte length"),
    maxFrameBytes: Schema.Literal(MAX_FRAME_BYTES),
  }),
  requestVectors: Schema.Array(RequestVectorSchema),
  gdmCryptoVector: GdmCryptoVectorSchema,
  sentinelCases: Schema.Array(Schema.Struct({
    value: Schema.String,
    valid: Schema.Boolean,
  })),
  malformedRequestCases: Schema.Array(Schema.Struct({
    case: Schema.String,
    base: Schema.String,
    mutation: Schema.Struct({
      path: Schema.String,
      value: Schema.Unknown,
    }),
    expectedError: PublicErrorSchema,
  })),
})

const fixtureInput: unknown = await Bun.file(
  new URL("../../contracts/fixtures/v1/protocol-vectors.json", import.meta.url),
).json()

export const protocolFixture = Schema.decodeUnknownSync(ProtocolFixtureSchema)(
  fixtureInput,
  STRICT_DECODE_OPTIONS,
)

export type RequestVector = typeof RequestVectorSchema.Type

export function requestVector(name: string): RequestVector {
  const vector = protocolFixture.requestVectors.find((candidate) => candidate.name === name)
  if (vector === undefined) throw new Error(`Missing request vector: ${name}`)
  return vector
}

export function hexToBytes(value: string): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error("Hex fixture value is malformed")
  }
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export function bytesToHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex")
}

export function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"))
}

export function replaceTopLevelField(input: unknown, key: string, value: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Fixture request is not an object")
  }
  const entries: Array<readonly [string, unknown]> = []
  for (const existingKey of Object.keys(input)) {
    if (existingKey !== key) entries.push([existingKey, Reflect.get(input, existingKey)])
  }
  entries.push([key, value])
  return Object.fromEntries(entries)
}
