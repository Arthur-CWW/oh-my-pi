import {
  createCipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  sign,
} from "node:crypto"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  buildExecutionRequestTranscript,
  buildGdmEnvelopeSignatureTranscript,
  buildGdmHpkeAadTranscript,
  buildGdmHpkeInfoTranscript,
} from "../extension/transcript.ts"

const OUTPUT_PATH = fileURLToPath(new URL("./fixtures/v1/protocol-vectors.json", import.meta.url))
const OWNERSHIP_SOCKET_PATH =
  "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock"
const X25519_PRIVATE_KEY_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex")
const X25519_PUBLIC_KEY_PREFIX = Buffer.from("302a300506032b656e032100", "hex")
const ED25519_PRIVATE_KEY_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex")
const HPKE_VERSION = Buffer.from("HPKE-v1", "ascii")
const HPKE_KEM_SUITE = Buffer.from("4b454d0020", "hex")
const HPKE_SUITE = Buffer.from("48504b45002000010003", "hex")

function bytes(start, length) {
  return Buffer.from(Array.from({ length }, (_, index) => (start + index) & 0xff))
}

function base64url(value) {
  return Buffer.from(value).toString("base64url")
}

function hex(value) {
  return Buffer.from(value).toString("hex")
}

function sha256(value) {
  return createHash("sha256").update(value).digest()
}

function x25519PrivateKey(raw) {
  return createPrivateKey({
    key: Buffer.concat([X25519_PRIVATE_KEY_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  })
}

function x25519PublicKey(raw) {
  return createPublicKey({
    key: Buffer.concat([X25519_PUBLIC_KEY_PREFIX, raw]),
    format: "der",
    type: "spki",
  })
}

function rawPublicKey(privateKey) {
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32)
}

function hkdfExtract(salt, inputKeyMaterial) {
  const effectiveSalt = salt.length === 0 ? Buffer.alloc(32) : salt
  return createHmac("sha256", effectiveSalt).update(inputKeyMaterial).digest()
}

function hkdfExpand(pseudorandomKey, info, length) {
  const chunks = []
  let previous = Buffer.alloc(0)
  let emitted = 0
  for (let counter = 1; emitted < length; counter += 1) {
    previous = createHmac("sha256", pseudorandomKey)
      .update(Buffer.concat([previous, info, Buffer.of(counter)]))
      .digest()
    chunks.push(previous)
    emitted += previous.length
  }
  return Buffer.concat(chunks, emitted).subarray(0, length)
}

function labeledExtract(suite, salt, label, inputKeyMaterial) {
  return hkdfExtract(
    salt,
    Buffer.concat([HPKE_VERSION, suite, Buffer.from(label, "ascii"), inputKeyMaterial]),
  )
}

function labeledExpand(suite, pseudorandomKey, label, info, length) {
  const encodedLength = Buffer.allocUnsafe(2)
  encodedLength.writeUInt16BE(length)
  return hkdfExpand(
    pseudorandomKey,
    Buffer.concat([
      encodedLength,
      HPKE_VERSION,
      suite,
      Buffer.from(label, "ascii"),
      info,
    ]),
    length,
  )
}

function hpkeSealBase(recipientPublicKey, ephemeralPrivateKey, info, aad, plaintext) {
  const ephemeralPrivate = x25519PrivateKey(ephemeralPrivateKey)
  const encapsulatedKey = rawPublicKey(ephemeralPrivate)
  const sharedDiffieHellmanSecret = diffieHellman({
    privateKey: ephemeralPrivate,
    publicKey: x25519PublicKey(recipientPublicKey),
  })
  const kemContext = Buffer.concat([encapsulatedKey, recipientPublicKey])
  const extractAndExpandKey = labeledExtract(
    HPKE_KEM_SUITE,
    Buffer.alloc(0),
    "eae_prk",
    sharedDiffieHellmanSecret,
  )
  const sharedSecret = labeledExpand(
    HPKE_KEM_SUITE,
    extractAndExpandKey,
    "shared_secret",
    kemContext,
    32,
  )

  const empty = Buffer.alloc(0)
  const pskIdHash = labeledExtract(HPKE_SUITE, empty, "psk_id_hash", empty)
  const infoHash = labeledExtract(HPKE_SUITE, empty, "info_hash", info)
  const keyScheduleContext = Buffer.concat([Buffer.of(0), pskIdHash, infoHash])
  const secret = labeledExtract(HPKE_SUITE, sharedSecret, "secret", empty)
  const key = labeledExpand(HPKE_SUITE, secret, "key", keyScheduleContext, 32)
  const nonce = labeledExpand(HPKE_SUITE, secret, "base_nonce", keyScheduleContext, 12)

  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 })
  cipher.setAAD(aad, { plaintextLength: plaintext.length })
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  return { encapsulatedKey, ciphertext }
}

function principal(ownerEpoch) {
  return {
    sessionId: "session-fixture-v1",
    ownerEpoch,
    pid: 4242,
    uid: 501,
    codeIdentity: "com.openai.omp.fixture",
    buildDigest: "1".repeat(64),
    runnerInstanceIdentity: "runner-fixture-v1",
    ownershipSocketPath: OWNERSHIP_SOCKET_PATH,
  }
}

const gdmRequest = {
  protocolVersion: 1,
  requestId: base64url(bytes(0, 16)),
  nonce: base64url(bytes(0, 32)),
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_000_060_000,
  principal: principal("00112233-4455-4677-8899-aabbccddeeff"),
  authorizationModeRequested: "delegated",
  domain: "desktop-browser",
  operation: "gdm-login",
  target: {
    kind: "gdm",
    sshHostKeyDigest: "2".repeat(64),
    machineId: "ubuntu-fixture-machine",
    bootId: "ubuntu-fixture-boot",
    username: "fixture-user",
    uid: 1000,
    pamService: "gdm-password",
    seat: "seat0",
    tty: "/dev/tty1",
    rhost: "empty",
    greeterGeneration: 19,
    jetkvmDeviceId: "jetkvm-fixture-device",
    controllerGeneration: 23,
  },
  purpose: "credential-free GDM protocol fixture",
  grantId: `grant-v1:${base64url(bytes(32, 16))}`,
}

const sudoRequest = {
  protocolVersion: 1,
  requestId: base64url(bytes(128, 16)),
  nonce: base64url(bytes(255, 32)),
  createdAt: 1_700_000_100_000,
  expiresAt: 1_700_000_160_000,
  principal: principal("ffeeddcc-bbaa-4988-8776-554433221100"),
  authorizationModeRequested: "biometric-one-shot",
  domain: "sudo",
  operation: "sudo",
  target: {
    kind: "sudo",
    sshHostKeyDigest: "3".repeat(64),
    machineId: "ubuntu-fixture-machine",
    bootId: "ubuntu-fixture-boot",
    username: "fixture-user",
    uid: 1000,
    sudoPolicyDigest: "4".repeat(64),
    actionId: "fixture-safe-status",
    executable: "/usr/libexec/remote-auth-broker/fixture-safe-status",
    argvDigest: "5".repeat(64),
  },
  purpose: "credential-free sudo protocol fixture",
  grantId: null,
}

const challenge = {
  protocolVersion: 1,
  challengeId: base64url(bytes(64, 16)),
  challenge: base64url(bytes(96, 32)),
  bootId: "ubuntu-fixture-boot",
  issuedBoottimeMs: 500_000,
  expiresBoottimeMs: 520_000,
  policyDigest: "6".repeat(64),
}

const issueId = base64url(bytes(192, 16))
const sentinel = `gdm-broker-v1:${base64url(bytes(64, 32))}`
const sentinelHash = hex(sha256(Buffer.from(sentinel, "utf8")))
const recipientKeyId = base64url(bytes(16, 16))
const recipientPrivateKey = bytes(1, 32)
const recipientPublicKey = rawPublicKey(x25519PrivateKey(recipientPrivateKey))
const ephemeralPrivateKey = bytes(101, 32)
const plaintext = bytes(160, 32)
const signingKeyId = base64url(bytes(80, 16))
const ed25519PrivateSeed = bytes(224, 32)
const ed25519PrivateKey = createPrivateKey({
  key: Buffer.concat([ED25519_PRIVATE_KEY_PREFIX, ed25519PrivateSeed]),
  format: "der",
  type: "pkcs8",
})
const ed25519PublicKey = rawPublicKey(ed25519PrivateKey)

const gdmRequestTranscript = Buffer.from(buildExecutionRequestTranscript(gdmRequest))
const sudoRequestTranscript = Buffer.from(buildExecutionRequestTranscript(sudoRequest))
const hpkeInfoTranscript = Buffer.from(buildGdmHpkeInfoTranscript(recipientKeyId))
const hpkeAadTranscript = Buffer.from(
  buildGdmHpkeAadTranscript(gdmRequest, challenge, issueId, sentinelHash),
)
const { encapsulatedKey, ciphertext } = hpkeSealBase(
  recipientPublicKey,
  ephemeralPrivateKey,
  hpkeInfoTranscript,
  hpkeAadTranscript,
  plaintext,
)
const signatureTranscript = Buffer.from(
  buildGdmEnvelopeSignatureTranscript(
    hpkeAadTranscript,
    encapsulatedKey,
    ciphertext,
    signingKeyId,
  ),
)

const fixture = {
  fixtureVersion: 1,
  credentialFree: true,
  encoding: {
    magicHex: "52414231",
    lengthFraming: "u32be JSON byte length",
    maxFrameBytes: 262_144,
  },
  requestVectors: [
    {
      name: "gdm-delegated",
      request: gdmRequest,
      transcriptHex: hex(gdmRequestTranscript),
      sha256: hex(sha256(gdmRequestTranscript)),
    },
    {
      name: "sudo-biometric-one-shot",
      request: sudoRequest,
      transcriptHex: hex(sudoRequestTranscript),
      sha256: hex(sha256(sudoRequestTranscript)),
      ed25519Signature: base64url(sign(null, sudoRequestTranscript, ed25519PrivateKey)),
    },
  ],
  gdmCryptoVector: {
    challenge,
    issueId,
    sentinel,
    sentinelHash,
    recipientKeyId,
    hpkeInfoTranscriptHex: hex(hpkeInfoTranscript),
    hpkeAadTranscriptHex: hex(hpkeAadTranscript),
    recipientPrivateKeyTestOnly: base64url(recipientPrivateKey),
    recipientPublicKey: base64url(recipientPublicKey),
    ephemeralPrivateKeyTestOnly: base64url(ephemeralPrivateKey),
    encapsulatedKey: base64url(encapsulatedKey),
    plaintextTestPayloadHex: hex(plaintext),
    ciphertext: base64url(ciphertext),
    signingKeyId,
    ed25519PrivateSeedTestOnly: base64url(ed25519PrivateSeed),
    ed25519PublicKey: base64url(ed25519PublicKey),
    signatureTranscriptHex: hex(signatureTranscript),
    signature: base64url(sign(null, signatureTranscript, ed25519PrivateKey)),
  },
  sentinelCases: [
    { value: sentinel, valid: true },
    { value: `gdm-broker-v1:${base64url(Buffer.alloc(32, 7)).slice(0, -1)}`, valid: false },
    { value: `gdm-broker-v1:${base64url(Buffer.alloc(33, 7))}`, valid: false },
    { value: "gdm-broker-v1:__________________________________________=", valid: false },
    { value: `prefix:${base64url(Buffer.alloc(32, 7))}`, valid: false },
  ],
  malformedRequestCases: [
    {
      case: "excess-field",
      base: "gdm-delegated",
      mutation: { path: "unexpected", value: "rejected" },
      expectedError: "excess-field",
    },
    {
      case: "domain-mismatch",
      base: "gdm-delegated",
      mutation: { path: "domain", value: "sudo" },
      expectedError: "domain-mismatch",
    },
    {
      case: "delegated-without-grant",
      base: "gdm-delegated",
      mutation: { path: "grantId", value: null },
      expectedError: "grant-required",
    },
    {
      case: "one-shot-with-grant",
      base: "sudo-biometric-one-shot",
      mutation: { path: "grantId", value: `grant-v1:${base64url(bytes(32, 16))}` },
      expectedError: "grant-forbidden",
    },
    {
      case: "expires-before-created",
      base: "gdm-delegated",
      mutation: { path: "expiresAt", value: 1_699_999_999_999 },
      expectedError: "request-expired",
    },
    {
      case: "lifetime-too-long",
      base: "gdm-delegated",
      mutation: { path: "expiresAt", value: 1_700_000_120_001 },
      expectedError: "noncanonical-value",
    },
    {
      case: "control-character",
      base: "gdm-delegated",
      mutation: { path: "purpose", value: "bad\ncontrol" },
      expectedError: "noncanonical-value",
    },
  ],
}

writeFileSync(OUTPUT_PATH, `${JSON.stringify(fixture)}\n`)
