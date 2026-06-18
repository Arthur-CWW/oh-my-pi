import { Schema } from "effect"

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const OptionalNonEmptyString = Schema.optional(NonEmptyString)

export const RightsStatusSchema = Schema.Union([
  Schema.Literal("public_domain"),
  Schema.Literal("open_access"),
  Schema.Literal("user_provided"),
  Schema.Literal("licensed_owned"),
  Schema.Literal("metadata_only"),
  Schema.Literal("ambiguous"),
  Schema.Literal("rights_unknown"),
  Schema.Literal("restricted"),
  Schema.Literal("in_copyright_not_owned"),
])
export type RightsStatus = Schema.Schema.Type<typeof RightsStatusSchema>

export const SourceKindSchema = Schema.Union([
  Schema.Literal("library_catalog"),
  Schema.Literal("publisher_open_access"),
  Schema.Literal("public_domain_repository"),
  Schema.Literal("user_upload"),
  Schema.Literal("local_owned_file"),
  Schema.Literal("licensed_database"),
  Schema.Literal("unknown_web"),
  Schema.Literal("manual_entry"),
])
export type SourceKind = Schema.Schema.Type<typeof SourceKindSchema>

export const AssistantOperationSchema = Schema.Union([
  Schema.Literal("metadata_only"),
  Schema.Literal("full_text_import"),
])
export type AssistantOperation = Schema.Schema.Type<typeof AssistantOperationSchema>

export const BookIdentifierSchema = Schema.Struct({
  scheme: NonEmptyString,
  value: NonEmptyString,
})
export type BookIdentifier = Schema.Schema.Type<typeof BookIdentifierSchema>

export const BookMetadataSchema = Schema.Struct({
  title: NonEmptyString,
  creators: Schema.Array(NonEmptyString),
  language: OptionalNonEmptyString,
  publicationYear: Schema.optional(Schema.Number),
  identifiers: Schema.Array(BookIdentifierSchema),
  subjects: Schema.Array(NonEmptyString),
  summary: OptionalNonEmptyString,
})
export type BookMetadata = Schema.Schema.Type<typeof BookMetadataSchema>

export const SourceRecordSchema = Schema.Struct({
  sourceId: NonEmptyString,
  kind: SourceKindSchema,
  rightsStatus: RightsStatusSchema,
  label: NonEmptyString,
  locator: OptionalNonEmptyString,
  evidence: Schema.Array(NonEmptyString),
})
export type SourceRecord = Schema.Schema.Type<typeof SourceRecordSchema>

export const LocalDocumentContentSchema = Schema.Struct({
  kind: Schema.Union([
    Schema.Literal("none"),
    Schema.Literal("generated_fixture_text"),
    Schema.Literal("local_text_file"),
  ]),
  sha256: OptionalNonEmptyString,
  byteLength: Schema.Number,
  textPreview: OptionalNonEmptyString,
})
export type LocalDocumentContent = Schema.Schema.Type<typeof LocalDocumentContentSchema>

export const LocalDocumentManifestSchema = Schema.Struct({
  documentId: NonEmptyString,
  metadata: BookMetadataSchema,
  source: SourceRecordSchema,
  content: LocalDocumentContentSchema,
})
export type LocalDocumentManifest = Schema.Schema.Type<typeof LocalDocumentManifestSchema>

export const AllowedSourcePolicySchema = Schema.Struct({
  policyId: NonEmptyString,
  metadataOnlySourceKinds: Schema.Array(SourceKindSchema),
  fullTextRightsStatuses: Schema.Array(RightsStatusSchema),
  blockedSourceKinds: Schema.Array(SourceKindSchema),
  requireEvidenceForFullText: Schema.Boolean,
})
export type AllowedSourcePolicy = Schema.Schema.Type<typeof AllowedSourcePolicySchema>

export const ImportDecisionRequestSchema = Schema.Struct({
  operation: AssistantOperationSchema,
  manifest: LocalDocumentManifestSchema,
  policy: AllowedSourcePolicySchema,
})
export type ImportDecisionRequest = Schema.Schema.Type<typeof ImportDecisionRequestSchema>

export type ImportDecisionKind = "allow" | "gate" | "refuse"

export interface ImportDecision {
  decision: ImportDecisionKind
  operation: AssistantOperation
  documentId: string
  rightsStatus: RightsStatus
  reason: string
  allowedActions: ReadonlyArray<AssistantOperation>
}

export const FULL_TEXT_RIGHTS_STATUSES: ReadonlySet<RightsStatus> = new Set([
  "public_domain",
  "open_access",
  "user_provided",
  "licensed_owned",
])

export const AMBIGUOUS_RIGHTS_STATUSES: ReadonlySet<RightsStatus> = new Set([
  "ambiguous",
  "rights_unknown",
  "metadata_only",
])

export const DEFAULT_ALLOWED_SOURCE_POLICY: AllowedSourcePolicy = {
  policyId: "rights-aware-default-v1",
  metadataOnlySourceKinds: [
    "library_catalog",
    "publisher_open_access",
    "public_domain_repository",
    "user_upload",
    "local_owned_file",
    "licensed_database",
    "unknown_web",
    "manual_entry",
  ],
  fullTextRightsStatuses: ["public_domain", "open_access", "user_provided", "licensed_owned"],
  blockedSourceKinds: [],
  requireEvidenceForFullText: true,
}

export function decodeLocalDocumentManifest(value: object): LocalDocumentManifest {
  return Schema.decodeUnknownSync(LocalDocumentManifestSchema)(value)
}

export function decodeAllowedSourcePolicy(value: object): AllowedSourcePolicy {
  return Schema.decodeUnknownSync(AllowedSourcePolicySchema)(value)
}

export function decideLibraryImport(request: ImportDecisionRequest): ImportDecision {
  const source = request.manifest.source
  if (request.policy.blockedSourceKinds.includes(source.kind)) {
    return refuseDecision(request, `Source kind ${source.kind} is blocked by policy.`)
  }

  if (request.operation === "metadata_only") {
    if (!request.policy.metadataOnlySourceKinds.includes(source.kind)) {
      return refuseDecision(request, `Source kind ${source.kind} is not approved for metadata records.`)
    }
    return {
      decision: "allow",
      operation: request.operation,
      documentId: request.manifest.documentId,
      rightsStatus: source.rightsStatus,
      reason: "Metadata-only records are allowed for approved sources, including ambiguous rights.",
      allowedActions: ["metadata_only"],
    }
  }

  if (!request.policy.fullTextRightsStatuses.includes(source.rightsStatus)) {
    if (AMBIGUOUS_RIGHTS_STATUSES.has(source.rightsStatus)) {
      return gateDecision(request, `Full-text import needs clearer rights evidence for ${source.rightsStatus}; keep metadata only.`)
    }
    return refuseDecision(request, `Full-text import is not allowed for rights status ${source.rightsStatus}.`)
  }

  if (!FULL_TEXT_RIGHTS_STATUSES.has(source.rightsStatus)) {
    return refuseDecision(request, `Policy contains unsupported full-text status ${source.rightsStatus}.`)
  }

  if (request.policy.requireEvidenceForFullText && source.evidence.length === 0) {
    return gateDecision(request, "Full-text import requires recorded rights evidence.")
  }

  return {
    decision: "allow",
    operation: request.operation,
    documentId: request.manifest.documentId,
    rightsStatus: source.rightsStatus,
    reason: `Full-text import is allowed for ${source.rightsStatus}.`,
    allowedActions: ["metadata_only", "full_text_import"],
  }
}

function gateDecision(request: ImportDecisionRequest, reason: string): ImportDecision {
  return {
    decision: "gate",
    operation: request.operation,
    documentId: request.manifest.documentId,
    rightsStatus: request.manifest.source.rightsStatus,
    reason,
    allowedActions: ["metadata_only"],
  }
}

function refuseDecision(request: ImportDecisionRequest, reason: string): ImportDecision {
  return {
    decision: "refuse",
    operation: request.operation,
    documentId: request.manifest.documentId,
    rightsStatus: request.manifest.source.rightsStatus,
    reason,
    allowedActions: [],
  }
}

export const GENERATED_FIXTURE_TEXT = "Generated fixture text for rights-gating tests. This sentence is synthetic and not from a book."

export const GENERATED_PUBLIC_DOMAIN_FIXTURE: LocalDocumentManifest = {
  documentId: "fixture-public-domain-generated",
  metadata: {
    title: "Generated Public Domain Fixture",
    creators: ["Wirebabel Fixture Generator"],
    language: "en",
    publicationYear: 1899,
    identifiers: [{ scheme: "fixture", value: "pd-001" }],
    subjects: ["generated", "rights-test"],
    summary: "Synthetic metadata used to exercise public-domain full-text import decisions.",
  },
  source: {
    sourceId: "source-generated-public-domain",
    kind: "public_domain_repository",
    rightsStatus: "public_domain",
    label: "Generated public-domain fixture source",
    locator: "fixture://public-domain/generated",
    evidence: ["Fixture declares public_domain and contains only generated text."],
  },
  content: {
    kind: "generated_fixture_text",
    sha256: "0f7ef2b6b7d3e0e9b9d6e8d1b9a7e2d85f3d0c0a6a729f18a28f6dfc7c8b3b7b",
    byteLength: GENERATED_FIXTURE_TEXT.length,
    textPreview: GENERATED_FIXTURE_TEXT,
  },
}

export const GENERATED_AMBIGUOUS_METADATA_FIXTURE: LocalDocumentManifest = {
  documentId: "fixture-ambiguous-metadata-only",
  metadata: {
    title: "Generated Ambiguous Metadata Fixture",
    creators: ["Wirebabel Fixture Generator"],
    language: "en",
    identifiers: [{ scheme: "fixture", value: "ambiguous-001" }],
    subjects: ["generated", "metadata-only"],
    summary: "Synthetic metadata with intentionally ambiguous rights and no imported text.",
  },
  source: {
    sourceId: "source-generated-ambiguous",
    kind: "unknown_web",
    rightsStatus: "ambiguous",
    label: "Generated ambiguous fixture source",
    evidence: ["Fixture has no full-text rights evidence."],
  },
  content: {
    kind: "none",
    byteLength: 0,
  },
}
