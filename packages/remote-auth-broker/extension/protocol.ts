import { Schema } from "effect"

export const PROTOCOL_VERSION = 1 as const
export const MAX_FRAME_BYTES = 262_144 as const
export const MAX_REQUEST_LIFETIME_MS = 120_000 as const
export const MAX_GDM_CHALLENGE_LIFETIME_MS = 20_000 as const
export const MIN_GDM_CIPHERTEXT_BYTES = 16 as const
export const MAX_GDM_CIPHERTEXT_BYTES = 393_216 as const

const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const
const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]+$/u
const CANONICAL_HTTPS_ORIGIN = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[1-9][0-9]{0,4})?$/
const GDM_SENTINEL_PREFIX = "gdm-broker-v1:"
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const OWNER_EPOCH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OWNERSHIP_NAMESPACE_COMPONENT = "owners-v1"
const OWNERSHIP_SOCKET_COMPONENT = "owner.sock"
const MAX_OWNERSHIP_SOCKET_PATH_BYTES = 103
const UTF8_ENCODER = new TextEncoder()

function isCanonicalOwnershipSocketPath(value: string): boolean {
  if (!NO_CONTROL_CHARACTERS.test(value) || !value.startsWith("/") || value.endsWith("/") || value.includes("//")) return false
  if (UTF8_ENCODER.encode(value).byteLength > MAX_OWNERSHIP_SOCKET_PATH_BYTES) return false
  const components = value.split("/")
  if (components.some((component, index) => index > 0 && (component.length === 0 || component === "." || component === ".."))) {
    return false
  }
  const count = components.length
  return count >= 5
    && components[count - 4] === OWNERSHIP_NAMESPACE_COMPONENT
    && /^[0-9a-f]{64}$/.test(components[count - 3]!)
    && components[count - 2] === "claim"
    && components[count - 1] === OWNERSHIP_SOCKET_COMPONENT
}

function isCanonicalBase64Url(value: string): boolean {
  const remainder = value.length % 4
  if (remainder === 1) return false
  if (remainder === 0) return true
  const lastValue = BASE64URL_ALPHABET.indexOf(value.charAt(value.length - 1))
  if (lastValue < 0) return false
  return remainder === 2 ? (lastValue & 0x0f) === 0 : (lastValue & 0x03) === 0
}

function isCanonicalGrantId(value: string): boolean {
  if (!value.startsWith("grant-v1:")) return false
  const suffix = value.slice("grant-v1:".length)
  return /^[A-Za-z0-9_-]{22,64}$/.test(suffix) && isCanonicalBase64Url(suffix)
}

const CanonicalBase64UrlCheck = Schema.makeFilter<string>(
  (value) => isCanonicalBase64Url(value) || "must be canonical unpadded base64url",
)
const CanonicalGrantIdCheck = Schema.makeFilter<string>(
  (value) => isCanonicalGrantId(value) || "must contain canonical unpadded base64url",
)

const GdmCiphertextLengthCheck = Schema.makeFilter<string>((value) => {
  const decodedByteLength = Math.floor(value.length * 3 / 4)
  return (
    decodedByteLength >= MIN_GDM_CIPHERTEXT_BYTES &&
    decodedByteLength <= MAX_GDM_CIPHERTEXT_BYTES
  ) || "must decode to between 16 and 393216 bytes"
})
export const TextSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(NO_CONTROL_CHARACTERS),
)
export const TimeMsSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)
export const Uint32Schema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: 0xffff_ffff }),
)
export const DigestSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
export const OwnerEpochSchema = Schema.String.check(Schema.isPattern(OWNER_EPOCH_PATTERN))
export const IdSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{22,86}$/),
  CanonicalBase64UrlCheck,
)
export const RequestIdSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{22,64}$/),
  CanonicalBase64UrlCheck,
)
export const NonceSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/),
  CanonicalBase64UrlCheck,
)
export const GrantIdSchema = Schema.String.check(
  Schema.isPattern(/^grant-v1:[A-Za-z0-9_-]{22,64}$/),
  CanonicalGrantIdCheck,
)
export const Base64UrlSchema = Schema.String.check(
  Schema.isMaxLength(524_288),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  CanonicalBase64UrlCheck,
)
export const GdmCiphertextSchema = Base64UrlSchema.check(GdmCiphertextLengthCheck)
export const HpkeEncSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/),
  CanonicalBase64UrlCheck,
)
export const Ed25519SignatureSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{86}$/),
  CanonicalBase64UrlCheck,
)
export const GdmSentinelSchema = Schema.String.check(
  Schema.isPattern(/^gdm-broker-v1:[A-Za-z0-9_-]{43}$/),
  Schema.makeFilter<string>((value) =>
    isCanonicalBase64Url(value.slice(GDM_SENTINEL_PREFIX.length)) || "must contain a canonical 32-byte nonce"
  ),
)
export const CanonicalHttpsOriginSchema = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.isPattern(CANONICAL_HTTPS_ORIGIN),
)
export const OwnershipSocketPathSchema = Schema.String.check(
  Schema.makeFilter<string>((value) =>
    isCanonicalOwnershipSocketPath(value) || "must be the canonical owner-private ownership socket path"
  ),
)

export const DomainSchema = Schema.Literals(["desktop-browser", "sudo"])
export const OperationSchema = Schema.Literals(["gdm-login", "bitwarden-unlock", "website-autofill", "sudo"])
export const AuthorizationModeSchema = Schema.Literals(["delegated", "biometric-one-shot"])
export const RiskSchema = Schema.Literals(["low", "medium", "high", "critical"])
export const PublicErrorSchema = Schema.Literals([
  "inactive",
  "disabled",
  "unavailable",
  "timeout",
  "cancelled",
  "protocol-invalid",
  "frame-invalid",
  "excess-field",
  "noncanonical-value",
  "principal-invalid",
  "owner-stale",
  "peer-mismatch",
  "request-expired",
  "request-replayed",
  "body-conflict",
  "grant-required",
  "grant-forbidden",
  "grant-invalid",
  "policy-mismatch",
  "domain-mismatch",
  "target-mismatch",
  "review-blocked",
  "signature-invalid",
  "ciphertext-invalid",
  "challenge-invalid",
  "claim-rejected",
  "execution-failed",
  "integrity-failure",
  "internal",
])

export type Domain = typeof DomainSchema.Type
export type Operation = typeof OperationSchema.Type
export type AuthorizationMode = typeof AuthorizationModeSchema.Type
export type Risk = typeof RiskSchema.Type
export type PublicError = typeof PublicErrorSchema.Type

export const PrincipalSchema = Schema.Struct({
  sessionId: TextSchema,
  ownerEpoch: OwnerEpochSchema,
  pid: Uint32Schema,
  uid: Uint32Schema,
  codeIdentity: TextSchema,
  buildDigest: DigestSchema,
  runnerInstanceIdentity: TextSchema,
  ownershipSocketPath: OwnershipSocketPathSchema,
})

const BrowserBindingFields = {
  hostIdentity: TextSchema,
  graphicalSessionId: TextSchema,
  chromeService: TextSchema,
  chromeExecutableDigest: DigestSchema,
  chromePid: Uint32Schema,
  profileIdentity: TextSchema,
  browserTargetId: TextSchema,
  windowId: TextSchema,
  extensionId: TextSchema,
  extensionVersion: TextSchema,
  extensionSource: Schema.Literal("official-chrome-web-store"),
  manifestDigest: DigestSchema,
  uiTarget: TextSchema,
} as const

export const GdmTargetSchema = Schema.Struct({
  kind: Schema.Literal("gdm"),
  sshHostKeyDigest: DigestSchema,
  machineId: TextSchema,
  bootId: TextSchema,
  username: TextSchema,
  uid: Uint32Schema,
  pamService: Schema.Literal("gdm-password"),
  seat: TextSchema,
  tty: TextSchema,
  rhost: Schema.Literals(["empty", "local"]),
  greeterGeneration: TimeMsSchema,
  jetkvmDeviceId: TextSchema,
  controllerGeneration: TimeMsSchema,
})

export const BitwardenTargetSchema = Schema.Struct({
  kind: Schema.Literal("bitwarden"),
  ...BrowserBindingFields,
})

export const WebsiteTargetSchema = Schema.Struct({
  kind: Schema.Literal("website"),
  ...BrowserBindingFields,
  originSet: Schema.Array(CanonicalHttpsOriginSchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
  ),
  activeTabId: TextSchema,
  frameId: TextSchema,
  formActionOrigin: CanonicalHttpsOriginSchema,
  foregroundWindowId: TextSchema,
  credentialPairingId: TextSchema,
})

export const SudoTargetSchema = Schema.Struct({
  kind: Schema.Literal("sudo"),
  sshHostKeyDigest: DigestSchema,
  machineId: TextSchema,
  bootId: TextSchema,
  username: TextSchema,
  uid: Uint32Schema,
  sudoPolicyDigest: DigestSchema,
  actionId: TextSchema,
  executable: Schema.String.check(
    Schema.isMaxLength(512),
    Schema.isPattern(/^\/(?:[^/\u0000-\u001f\u007f]+\/)*[^/\u0000-\u001f\u007f]+$/),
  ),
  argvDigest: DigestSchema,
})

export const TargetSchema = Schema.Union([
  GdmTargetSchema,
  BitwardenTargetSchema,
  WebsiteTargetSchema,
  SudoTargetSchema,
])

export const ExecutionRequestSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  nonce: NonceSchema,
  createdAt: TimeMsSchema,
  expiresAt: TimeMsSchema,
  principal: PrincipalSchema,
  authorizationModeRequested: AuthorizationModeSchema,
  domain: DomainSchema,
  operation: OperationSchema,
  target: TargetSchema,
  purpose: TextSchema,
  grantId: Schema.NullOr(GrantIdSchema),
})
const ExecutionGrantProbeSchema = Schema.Struct({
  authorizationModeRequested: AuthorizationModeSchema,
  grantId: Schema.NullOr(Schema.String),
})

export type Principal = typeof PrincipalSchema.Type
export type GdmTarget = typeof GdmTargetSchema.Type
export type BitwardenTarget = typeof BitwardenTargetSchema.Type
export type WebsiteTarget = typeof WebsiteTargetSchema.Type
export type SudoTarget = typeof SudoTargetSchema.Type
export type Target = typeof TargetSchema.Type
export type ExecutionRequest = typeof ExecutionRequestSchema.Type

export const PrincipalSelectorSchema = Schema.Struct({
  sessionId: TextSchema,
  ownerEpoch: OwnerEpochSchema,
  uid: Uint32Schema,
  codeIdentity: TextSchema,
  buildDigest: DigestSchema,
})

export const GrantSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  grantId: GrantIdSchema,
  principalSelector: PrincipalSelectorSchema,
  domain: DomainSchema,
  operation: OperationSchema,
  targetPredicate: TargetSchema,
  riskCeiling: RiskSchema,
  issuedAt: TimeMsSchema,
  expiresAt: TimeMsSchema,
  revokedAt: Schema.NullOr(TimeMsSchema),
  consumedAt: Schema.NullOr(TimeMsSchema),
  policyDigest: DigestSchema,
  brokerBuildDigest: DigestSchema,
  brokerCodeIdentity: TextSchema,
  biometricEvidenceId: IdSchema,
  biometricIssuedAt: TimeMsSchema,
  lifecycleState: Schema.Literals(["active", "consumed", "expired", "revoked", "invalidated"]),
})

export type PrincipalSelector = typeof PrincipalSelectorSchema.Type
export type Grant = typeof GrantSchema.Type

export const ReceiptEventsSchema = Schema.Struct({
  requestedAt: TimeMsSchema,
  authorizedAt: Schema.NullOr(TimeMsSchema),
  executingAt: Schema.NullOr(TimeMsSchema),
  terminalAt: Schema.NullOr(TimeMsSchema),
})

export const ReceiptSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  receiptId: IdSchema,
  requestId: RequestIdSchema,
  grantId: Schema.NullOr(GrantIdSchema),
  domain: DomainSchema,
  operation: OperationSchema,
  authorizationModeUsed: AuthorizationModeSchema,
  targetFingerprint: DigestSchema,
  state: Schema.Literals([
    "requested",
    "authorized",
    "executing",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
    "revoked",
    "disabled",
  ]),
  errorCode: Schema.NullOr(PublicErrorSchema),
  events: ReceiptEventsSchema,
  policyDigest: DigestSchema,
  brokerBuildDigest: DigestSchema,
  brokerCodeDigest: DigestSchema,
  targetReleaseDisposition: Schema.Literals(["not-applicable", "quarantined", "destroyed", "closed"]),
  browserTargetGeneration: Schema.NullOr(TimeMsSchema),
})

export const EndpointStatusSchema = Schema.Struct({
  ready: Schema.Boolean,
  errorCode: Schema.NullOr(PublicErrorSchema),
})

export const PublicStatusSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  canonicalStatus: Schema.Literals(["DESIGN/INACTIVE", "ACTIVE", "DISABLED", "DEGRADED"]),
  policyDigest: Schema.NullOr(DigestSchema),
  installedBuildDigest: Schema.NullOr(DigestSchema),
  runningBuildDigest: Schema.NullOr(DigestSchema),
  codeIdentity: Schema.NullOr(TextSchema),
  pid: Schema.NullOr(Uint32Schema),
  socketPosture: Schema.Literals(["absent", "owner-only", "invalid"]),
  jetkvmControllerGeneration: Schema.NullOr(TimeMsSchema),
  gdm: EndpointStatusSchema,
  browser: EndpointStatusSchema,
  sudo: EndpointStatusSchema,
  errors: Schema.Array(PublicErrorSchema).check(Schema.isMaxLength(8)),
})

export type ReceiptEvents = typeof ReceiptEventsSchema.Type
export type Receipt = typeof ReceiptSchema.Type
export type EndpointStatus = typeof EndpointStatusSchema.Type
export type PublicStatus = typeof PublicStatusSchema.Type

const RequestStateControlSchema = Schema.Struct({
  action: Schema.Literal("request-state"),
  requestId: RequestIdSchema,
})
const CancelControlSchema = Schema.Struct({
  action: Schema.Literal("cancel"),
  requestId: RequestIdSchema,
})
const GrantListControlSchema = Schema.Struct({ action: Schema.Literal("grant-list") })
const GrantRevokeControlSchema = Schema.Struct({
  action: Schema.Literal("grant-revoke"),
  grantId: GrantIdSchema,
})
const GrantExpireControlSchema = Schema.Struct({
  action: Schema.Literal("grant-expire"),
  grantId: GrantIdSchema,
})
const CredentialForgetControlSchema = Schema.Struct({
  action: Schema.Literal("credential-forget"),
  credentialId: IdSchema,
})
const EmergencyDisableControlSchema = Schema.Struct({
  action: Schema.Literal("emergency-disable"),
  reason: TextSchema,
})
const ReEnableControlSchema = Schema.Struct({ action: Schema.Literal("re-enable") })
const StatusControlSchema = Schema.Struct({ action: Schema.Literal("status") })

export const ControlRequestSchema = Schema.Union([
  RequestStateControlSchema,
  CancelControlSchema,
  GrantListControlSchema,
  GrantRevokeControlSchema,
  GrantExpireControlSchema,
  CredentialForgetControlSchema,
  EmergencyDisableControlSchema,
  ReEnableControlSchema,
  StatusControlSchema,
])
export type ControlRequest = typeof ControlRequestSchema.Type

export const GdmChallengeSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  challengeId: IdSchema,
  challenge: NonceSchema,
  bootId: TextSchema,
  issuedBoottimeMs: TimeMsSchema,
  expiresBoottimeMs: TimeMsSchema,
  policyDigest: DigestSchema,
})

export const GdmEnvelopeSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  request: ExecutionRequestSchema,
  challenge: GdmChallengeSchema,
  issueId: IdSchema,
  sentinelHash: DigestSchema,
  hpkeEnc: HpkeEncSchema,
  ciphertext: GdmCiphertextSchema,
  signingKeyId: IdSchema,
  signature: Ed25519SignatureSchema,
})

export const GdmClaimSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  nonce: NonceSchema,
  issueId: IdSchema,
  sentinel: GdmSentinelSchema,
  username: TextSchema,
  uid: Uint32Schema,
  pamService: Schema.Literal("gdm-password"),
  seat: TextSchema,
  tty: TextSchema,
  rhost: Schema.Literals(["empty", "local"]),
  greeterGeneration: TimeMsSchema,
  controllerGeneration: TimeMsSchema,
})

export const SudoSignedRequestSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  request: ExecutionRequestSchema,
  canonicalBodyDigest: DigestSchema,
  signingKeyId: IdSchema,
  signature: Ed25519SignatureSchema,
})

export type GdmChallenge = typeof GdmChallengeSchema.Type
export type GdmEnvelope = typeof GdmEnvelopeSchema.Type
export type GdmClaim = typeof GdmClaimSchema.Type
export type SudoSignedRequest = typeof SudoSignedRequestSchema.Type

export const ReviewerStatusSchema = Schema.Literals(["completed", "failed", "cancelled"])
export const ReviewerOutcomeSchema = Schema.Literals(["allow", "deny", "escalate", "blocked"])
export const ReviewerSemanticReasonSchema = Schema.Literals([
  "semantic_allow",
  "semantic_deny",
  "semantic_escalate",
])
export const ReviewerFailureReasonSchema = Schema.Literals([
  "timeout",
  "model_failure",
  "session_failure",
  "provider_failure",
  "transport_failure",
  "parse_failure",
  "missing_evidence",
  "prompt_injection",
  "digest_mismatch",
  "truncated_input",
  "omitted_security_field",
  "canonical_action_unreconstructable",
  "reviewer_setup_failure",
])
export const ReviewerReasonSchema = Schema.Union([
  ReviewerSemanticReasonSchema,
  ReviewerFailureReasonSchema,
  Schema.Literal("cancelled"),
])

export const ReviewerResultSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  reviewId: IdSchema,
  canonicalRequestDigest: DigestSchema,
  reviewerModel: TextSchema,
  reviewerBuildDigest: DigestSchema,
  promptPolicyDigest: DigestSchema,
  risk: RiskSchema,
  userAuthorization: Schema.Literals(["unknown", "low", "medium", "high"]),
  status: ReviewerStatusSchema,
  outcome: ReviewerOutcomeSchema,
  reasonCode: ReviewerReasonSchema,
  reason: TextSchema,
  rationale: TextSchema,
  attemptCount: Schema.Number.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 3 }),
  ),
  startedAt: TimeMsSchema,
  completedAt: TimeMsSchema,
  expiresAt: TimeMsSchema,
})

export type ReviewerStatus = typeof ReviewerStatusSchema.Type
export type ReviewerOutcome = typeof ReviewerOutcomeSchema.Type
export type ReviewerFailureReason = typeof ReviewerFailureReasonSchema.Type
export type ReviewerReason = typeof ReviewerReasonSchema.Type
export type ReviewerResult = typeof ReviewerResultSchema.Type

export class ProtocolValidationError extends Error {
  readonly code: PublicError

  constructor(code: PublicError, message: string) {
    super(message)
    this.name = "ProtocolValidationError"
    this.code = code
  }
}

function decodeStrict<S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, input: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(input, STRICT_DECODE_OPTIONS)
  } catch (error) {
    if (error instanceof ProtocolValidationError) throw error
    const message = error instanceof Error ? error.message : String(error)
    const code = message.toLowerCase().includes("unexpected") ? "excess-field" : "noncanonical-value"
    throw new ProtocolValidationError(code, "Wire value failed its closed schema")
  }
}

function requireCondition(condition: boolean, code: PublicError, message: string): asserts condition {
  if (!condition) throw new ProtocolValidationError(code, message)
}

function validateCanonicalOrigin(origin: string): void {
  let canonical: string
  try {
    canonical = new URL(origin).origin
  } catch {
    throw new ProtocolValidationError("noncanonical-value", "Origin is not a valid HTTPS origin")
  }
  requireCondition(canonical === origin, "noncanonical-value", "Origin is not canonical")
}

function validateWebsiteTarget(target: WebsiteTarget): void {
  let previous: string | undefined
  for (const origin of target.originSet) {
    validateCanonicalOrigin(origin)
    requireCondition(previous === undefined || previous < origin, "noncanonical-value", "Origins must be sorted and unique")
    previous = origin
  }
  validateCanonicalOrigin(target.formActionOrigin)
  requireCondition(
    target.originSet.includes(target.formActionOrigin),
    "target-mismatch",
    "Form action origin is outside the approved origin set",
  )
}

function validateAgreement(domain: Domain, operation: Operation, target: Target): void {
  const expectedDomain: Domain = operation === "sudo" ? "sudo" : "desktop-browser"
  requireCondition(domain === expectedDomain, "domain-mismatch", "Domain does not agree with operation")
  const expectedTargetKind = operation === "gdm-login"
    ? "gdm"
    : operation === "bitwarden-unlock"
      ? "bitwarden"
      : operation === "website-autofill"
        ? "website"
        : "sudo"
  requireCondition(target.kind === expectedTargetKind, "target-mismatch", "Target does not agree with operation")
  if (target.kind === "website") validateWebsiteTarget(target)
}

function validateExecutionRequest(request: ExecutionRequest): void {
  validateAgreement(request.domain, request.operation, request.target)
  requireCondition(request.expiresAt > request.createdAt, "request-expired", "Request expiry must follow creation")
  requireCondition(
    request.expiresAt - request.createdAt <= MAX_REQUEST_LIFETIME_MS,
    "noncanonical-value",
    "Request lifetime exceeds the v1 bound",
  )
  if (request.authorizationModeRequested === "delegated") {
    requireCondition(request.grantId !== null, "grant-required", "Delegated authorization requires a grant")
  } else {
    requireCondition(request.grantId === null, "grant-forbidden", "One-shot authorization forbids a grant")
  }
}

function validateGrant(grant: Grant): void {
  try {
    validateAgreement(grant.domain, grant.operation, grant.targetPredicate)
  } catch {
    throw new ProtocolValidationError("grant-invalid", "Grant target does not agree with its authority")
  }
  requireCondition(grant.expiresAt > grant.issuedAt, "grant-invalid", "Grant expiry must follow issue time")
  requireCondition(grant.biometricIssuedAt <= grant.issuedAt, "grant-invalid", "Biometric evidence cannot postdate grant issue")
  if (grant.revokedAt !== null) {
    requireCondition(
      grant.revokedAt >= grant.issuedAt && grant.revokedAt <= grant.expiresAt,
      "grant-invalid",
      "Grant revocation lies outside its lifetime",
    )
  }
  if (grant.consumedAt !== null) {
    requireCondition(
      grant.consumedAt >= grant.issuedAt && grant.consumedAt <= grant.expiresAt,
      "grant-invalid",
      "Grant consumption lies outside its lifetime",
    )
  }
  if (grant.lifecycleState === "active") {
    requireCondition(grant.revokedAt === null && grant.consumedAt === null, "grant-invalid", "Active grant has terminal timestamps")
  } else if (grant.lifecycleState === "consumed") {
    requireCondition(grant.consumedAt !== null && grant.revokedAt === null, "grant-invalid", "Consumed grant timestamps disagree")
  } else if (grant.lifecycleState === "revoked") {
    requireCondition(grant.revokedAt !== null && grant.consumedAt === null, "grant-invalid", "Revoked grant timestamps disagree")
  } else {
    requireCondition(grant.consumedAt === null, "grant-invalid", "Unredeemable grant records consumption")
  }
}

function validateReceipt(receipt: Receipt): void {
  const expectedDomain: Domain = receipt.operation === "sudo" ? "sudo" : "desktop-browser"
  requireCondition(receipt.domain === expectedDomain, "domain-mismatch", "Receipt domain does not agree with operation")
  if (receipt.authorizationModeUsed === "delegated") {
    requireCondition(receipt.grantId !== null, "grant-required", "Delegated receipt requires a grant")
  } else {
    requireCondition(receipt.grantId === null, "grant-forbidden", "One-shot receipt forbids a grant")
  }
  const { requestedAt, authorizedAt, executingAt, terminalAt } = receipt.events
  if (authorizedAt !== null) requireCondition(authorizedAt >= requestedAt, "noncanonical-value", "Receipt events are out of order")
  if (executingAt !== null) {
    requireCondition(authorizedAt !== null && executingAt >= authorizedAt, "noncanonical-value", "Receipt events are out of order")
  }
  if (terminalAt !== null) {
    const predecessor = executingAt ?? authorizedAt ?? requestedAt
    requireCondition(terminalAt >= predecessor, "noncanonical-value", "Receipt events are out of order")
  }
  if (receipt.state === "requested") {
    requireCondition(authorizedAt === null && executingAt === null && terminalAt === null, "noncanonical-value", "Requested receipt has later events")
  } else if (receipt.state === "authorized") {
    requireCondition(authorizedAt !== null && executingAt === null && terminalAt === null, "noncanonical-value", "Authorized receipt events disagree")
  } else if (receipt.state === "executing") {
    requireCondition(authorizedAt !== null && executingAt !== null && terminalAt === null, "noncanonical-value", "Executing receipt events disagree")
  } else {
    requireCondition(terminalAt !== null, "noncanonical-value", "Terminal receipt lacks terminal time")
  }
  const terminal = receipt.state !== "requested" && receipt.state !== "authorized" && receipt.state !== "executing"
  if (receipt.state === "succeeded") {
    requireCondition(receipt.errorCode === null, "noncanonical-value", "Successful receipt has an error")
  } else {
    requireCondition(
      terminal ? receipt.errorCode !== null : receipt.errorCode === null,
      "noncanonical-value",
      "Receipt state and error disagree",
    )
  }
  const browserSecretOperation = receipt.operation === "bitwarden-unlock" || receipt.operation === "website-autofill"
  requireCondition(
    browserSecretOperation
      ? receipt.targetReleaseDisposition !== "not-applicable" && receipt.browserTargetGeneration !== null
      : receipt.targetReleaseDisposition === "not-applicable" && receipt.browserTargetGeneration === null,
    "noncanonical-value",
    "Receipt target-release metadata does not agree with operation",
  )
}

function validatePublicStatus(status: PublicStatus): void {
  const errors = new Set(status.errors)
  requireCondition(errors.size === status.errors.length, "noncanonical-value", "Status errors must be unique")
  for (const endpoint of [status.gdm, status.browser, status.sudo]) {
    requireCondition(
      endpoint.ready === (endpoint.errorCode === null),
      "noncanonical-value",
      "Endpoint readiness and error disagree",
    )
  }
}

function validateGdmChallenge(challenge: GdmChallenge): void {
  requireCondition(
    challenge.expiresBoottimeMs > challenge.issuedBoottimeMs,
    "challenge-invalid",
    "Challenge expiry must follow issue time",
  )
  requireCondition(
    challenge.expiresBoottimeMs - challenge.issuedBoottimeMs <= MAX_GDM_CHALLENGE_LIFETIME_MS,
    "challenge-invalid",
    "Challenge lifetime exceeds the v1 bound",
  )
}

function validateReviewerResult(result: ReviewerResult): void {
  requireCondition(result.completedAt >= result.startedAt, "review-blocked", "Reviewer completion predates start")
  requireCondition(result.expiresAt > result.completedAt, "review-blocked", "Reviewer result expired before completion")
  const completedSemantic =
    (result.outcome === "allow" && result.reasonCode === "semantic_allow") ||
    (result.outcome === "deny" && result.reasonCode === "semantic_deny") ||
    (result.outcome === "escalate" && result.reasonCode === "semantic_escalate")
  const completedIntegrityBlock =
    result.outcome === "blocked" &&
    (
      result.reasonCode === "missing_evidence" ||
      result.reasonCode === "prompt_injection" ||
      result.reasonCode === "digest_mismatch" ||
      result.reasonCode === "truncated_input" ||
      result.reasonCode === "omitted_security_field" ||
      result.reasonCode === "canonical_action_unreconstructable"
    )
  const failedOperationalBlock =
    result.outcome === "blocked" &&
    (
      result.reasonCode === "timeout" ||
      result.reasonCode === "model_failure" ||
      result.reasonCode === "session_failure" ||
      result.reasonCode === "provider_failure" ||
      result.reasonCode === "transport_failure" ||
      result.reasonCode === "parse_failure" ||
      result.reasonCode === "reviewer_setup_failure"
    )
  const consistent = result.status === "completed"
    ? completedSemantic || completedIntegrityBlock
    : result.status === "failed"
      ? failedOperationalBlock
      : result.outcome === "blocked" && result.reasonCode === "cancelled"
  requireCondition(consistent, "review-blocked", "Reviewer result fields are inconsistent")
}

export function isValidGdmSentinel(value: string): boolean {
  if (!value.startsWith(GDM_SENTINEL_PREFIX)) return false
  const payload = value.slice(GDM_SENTINEL_PREFIX.length)
  return /^[A-Za-z0-9_-]{43}$/.test(payload) && isCanonicalBase64Url(payload)
}

function prevalidateExecutionGrant(input: unknown): void {
  let probe: typeof ExecutionGrantProbeSchema.Type
  try {
    probe = Schema.decodeUnknownSync(ExecutionGrantProbeSchema)(input)
  } catch {
    return
  }
  if (probe.authorizationModeRequested === "delegated") {
    if (probe.grantId !== null && !isCanonicalGrantId(probe.grantId)) {
      throw new ProtocolValidationError("grant-invalid", "Delegated authorization has an invalid grant ID")
    }
  } else if (probe.grantId !== null) {
    throw new ProtocolValidationError("grant-forbidden", "One-shot authorization forbids a grant")
  }
}

export function decodeExecutionRequest(input: unknown): ExecutionRequest {
  prevalidateExecutionGrant(input)
  const request = decodeStrict(ExecutionRequestSchema, input)
  validateExecutionRequest(request)
  return request
}

export function decodeGrant(input: unknown): Grant {
  const grant = decodeStrict(GrantSchema, input)
  validateGrant(grant)
  return grant
}

export function decodeReceipt(input: unknown): Receipt {
  const receipt = decodeStrict(ReceiptSchema, input)
  validateReceipt(receipt)
  return receipt
}

export function decodePublicStatus(input: unknown): PublicStatus {
  const status = decodeStrict(PublicStatusSchema, input)
  validatePublicStatus(status)
  return status
}

export function decodeControlRequest(input: unknown): ControlRequest {
  return decodeStrict(ControlRequestSchema, input)
}

export function decodeGdmChallenge(input: unknown): GdmChallenge {
  const challenge = decodeStrict(GdmChallengeSchema, input)
  validateGdmChallenge(challenge)
  return challenge
}

export function decodeGdmEnvelope(input: unknown): GdmEnvelope {
  const envelope = decodeStrict(GdmEnvelopeSchema, input)
  validateExecutionRequest(envelope.request)
  validateGdmChallenge(envelope.challenge)
  requireCondition(envelope.request.operation === "gdm-login", "target-mismatch", "GDM envelope contains a non-GDM request")
  requireCondition(envelope.request.target.kind === "gdm", "target-mismatch", "GDM envelope target is not GDM")
  requireCondition(envelope.request.target.bootId === envelope.challenge.bootId, "challenge-invalid", "Challenge boot does not match target")
  return envelope
}

export function decodeGdmClaim(input: unknown): GdmClaim {
  const claim = decodeStrict(GdmClaimSchema, input)
  requireCondition(isValidGdmSentinel(claim.sentinel), "claim-rejected", "GDM sentinel is not canonical")
  return claim
}

// The security-complete public decoder lives beside the authoritative transcript encoder.
export function decodeSudoSignedRequestStructure(input: unknown): SudoSignedRequest {
  const signed = decodeStrict(SudoSignedRequestSchema, input)
  validateExecutionRequest(signed.request)
  requireCondition(signed.request.operation === "sudo", "target-mismatch", "Sudo envelope contains a non-sudo request")
  requireCondition(signed.request.target.kind === "sudo", "target-mismatch", "Sudo envelope target is not sudo")
  return signed
}

export function decodeReviewerResult(input: unknown): ReviewerResult {
  const result = decodeStrict(ReviewerResultSchema, input)
  validateReviewerResult(result)
  return result
}
