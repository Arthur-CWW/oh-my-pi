import { describe, expect, it } from "bun:test"
import {
  decideLibraryImport,
  decodeLocalDocumentManifest,
  decodeAllowedSourcePolicy,
  DEFAULT_ALLOWED_SOURCE_POLICY,
  GENERATED_PUBLIC_DOMAIN_FIXTURE,
  GENERATED_AMBIGUOUS_METADATA_FIXTURE,
  GENERATED_FIXTURE_TEXT,
  type ImportDecisionRequest,
  type LocalDocumentManifest,
  type AllowedSourcePolicy
} from "../src/index"

describe("decideLibraryImport", () => {
  it("allows metadata-only operation for ambiguous sources under default policy", () => {
    const request: ImportDecisionRequest = {
      operation: "metadata_only",
      manifest: GENERATED_AMBIGUOUS_METADATA_FIXTURE,
      policy: DEFAULT_ALLOWED_SOURCE_POLICY,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("allow")
    expect(result.operation).toBe("metadata_only")
    expect(result.allowedActions).toContain("metadata_only")
    expect(result.allowedActions).not.toContain("full_text_import")
  })

  it("gates full-text import for ambiguous sources under default policy", () => {
    const request: ImportDecisionRequest = {
      operation: "full_text_import",
      manifest: GENERATED_AMBIGUOUS_METADATA_FIXTURE,
      policy: DEFAULT_ALLOWED_SOURCE_POLICY,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("gate")
    expect(result.operation).toBe("full_text_import")
    expect(result.allowedActions).toContain("metadata_only")
    expect(result.allowedActions).not.toContain("full_text_import")
    expect(result.reason).toContain("clearer rights evidence")
  })

  it("allows full-text import for public domain fixture under default policy", () => {
    const request: ImportDecisionRequest = {
      operation: "full_text_import",
      manifest: GENERATED_PUBLIC_DOMAIN_FIXTURE,
      policy: DEFAULT_ALLOWED_SOURCE_POLICY,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("allow")
    expect(result.operation).toBe("full_text_import")
    expect(result.allowedActions).toContain("metadata_only")
    expect(result.allowedActions).toContain("full_text_import")
    expect(request.manifest.content.textPreview).toBe(GENERATED_FIXTURE_TEXT)
  })

  it("refuses full-text import for in_copyright_not_owned status", () => {
    const manifest: LocalDocumentManifest = {
      documentId: "copyrighted-book",
      metadata: {
        title: "Some Copyrighted Book",
        creators: ["Famous Author"],
        language: "en",
        identifiers: [],
        subjects: [],
      },
      source: {
        sourceId: "source-copyright",
        kind: "unknown_web",
        rightsStatus: "in_copyright_not_owned",
        label: "Found on web",
        evidence: ["No license information found."],
      },
      content: {
        kind: "local_text_file",
        byteLength: 1000,
      },
    }
    const request: ImportDecisionRequest = {
      operation: "full_text_import",
      manifest,
      policy: DEFAULT_ALLOWED_SOURCE_POLICY,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("refuse")
    expect(result.allowedActions).toEqual([])
  })

  it("refuses metadata_only if the source kind is blocked by policy", () => {
    const policy: AllowedSourcePolicy = {
      ...DEFAULT_ALLOWED_SOURCE_POLICY,
      blockedSourceKinds: ["unknown_web"],
    }
    const request: ImportDecisionRequest = {
      operation: "metadata_only",
      manifest: GENERATED_AMBIGUOUS_METADATA_FIXTURE,
      policy,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("refuse")
    expect(result.reason).toContain("blocked by policy")
  })

  it("refuses metadata_only if the source kind is not approved for metadata records", () => {
    const policy: AllowedSourcePolicy = {
      ...DEFAULT_ALLOWED_SOURCE_POLICY,
      metadataOnlySourceKinds: ["library_catalog"],
    }
    const request: ImportDecisionRequest = {
      operation: "metadata_only",
      manifest: GENERATED_AMBIGUOUS_METADATA_FIXTURE,
      policy,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("refuse")
    expect(result.reason).toContain("not approved for metadata records")
  })

  it("gates full-text import if requireEvidenceForFullText is true but evidence is empty", () => {
    const manifest: LocalDocumentManifest = {
      ...GENERATED_PUBLIC_DOMAIN_FIXTURE,
      source: {
        ...GENERATED_PUBLIC_DOMAIN_FIXTURE.source,
        evidence: [],
      },
    }
    const request: ImportDecisionRequest = {
      operation: "full_text_import",
      manifest,
      policy: DEFAULT_ALLOWED_SOURCE_POLICY,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("gate")
    expect(result.reason).toContain("requires recorded rights evidence")
  })

  it("allows full-text import if requireEvidenceForFullText is false and evidence is empty", () => {
    const manifest: LocalDocumentManifest = {
      ...GENERATED_PUBLIC_DOMAIN_FIXTURE,
      source: {
        ...GENERATED_PUBLIC_DOMAIN_FIXTURE.source,
        evidence: [],
      },
    }
    const policy: AllowedSourcePolicy = {
      ...DEFAULT_ALLOWED_SOURCE_POLICY,
      requireEvidenceForFullText: false,
    }
    const request: ImportDecisionRequest = {
      operation: "full_text_import",
      manifest,
      policy,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("allow")
  })

  it("refuses full-text import if policy contains unsupported full-text status", () => {
    const policy: AllowedSourcePolicy = {
      ...DEFAULT_ALLOWED_SOURCE_POLICY,
      fullTextRightsStatuses: ["ambiguous"],
    }
    const request: ImportDecisionRequest = {
      operation: "full_text_import",
      manifest: GENERATED_AMBIGUOUS_METADATA_FIXTURE,
      policy,
    }
    const result = decideLibraryImport(request)
    expect(result.decision).toBe("refuse")
    expect(result.reason).toContain("unsupported full-text status")
  })
})

describe("decoders", () => {
  it("decodes valid manifest and policy successfully", () => {
    const decodedManifest = decodeLocalDocumentManifest(GENERATED_PUBLIC_DOMAIN_FIXTURE)
    expect(decodedManifest.documentId).toBe(GENERATED_PUBLIC_DOMAIN_FIXTURE.documentId)

    const decodedPolicy = decodeAllowedSourcePolicy(DEFAULT_ALLOWED_SOURCE_POLICY)
    expect(decodedPolicy.policyId).toBe(DEFAULT_ALLOWED_SOURCE_POLICY.policyId)
  })

  it("throws on invalid manifest decoding", () => {
    const invalidManifest = {
      documentId: "invalid",
      metadata: {},
    }
    expect(() => decodeLocalDocumentManifest(invalidManifest)).toThrow()
  })

  it("throws on invalid policy decoding", () => {
    const invalidPolicy = {
      policyId: "invalid",
      metadataOnlySourceKinds: ["invalid-source-kind"],
    }
    expect(() => decodeAllowedSourcePolicy(invalidPolicy as unknown as object)).toThrow()
  })
})
