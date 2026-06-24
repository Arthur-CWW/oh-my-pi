import { Schema } from "effect"

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const FiniteNumber = Schema.Number.check(Schema.isFinite())
const NonNegativeNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const PositiveNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const AzimuthDegrees = Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: -180, maximum: 180 }))
const ElevationDegrees = Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: -90, maximum: 90 }))
const DistanceMeters = Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0.01, maximum: 20 }))

export const ASMR_CONTRACT_SCHEMA_VERSIONS = [
  "analysis-tags.v1",
  "voice-assets.v1",
  "asmr-stems.v1",
  "spatial-audio-manifest.v1",
  "generated-video-clips.v1",
] as const

export type AsmrContractSchemaVersion = typeof ASMR_CONTRACT_SCHEMA_VERSIONS[number]

export class AsmrContractValidationError extends Error {
  readonly operation: string

  constructor(operation: string, message: string) {
    super(`${operation}: ${message}`)
    this.name = "AsmrContractValidationError"
    this.operation = operation
  }
}

export const Sha256HashSchema = Schema.Struct({
  algorithm: Schema.Literal("sha256"),
  value: NonEmptyString,
})
export type Sha256Hash = typeof Sha256HashSchema.Type

export const ContractArtifactSchema = Schema.Struct({
  path: NonEmptyString,
  mediaType: NonEmptyString,
  hash: Schema.optional(Sha256HashSchema),
  byteLength: Schema.optional(NonNegativeNumber),
})
export type ContractArtifact = typeof ContractArtifactSchema.Type

export const SourceAssetSchema = Schema.Struct({
  assetId: NonEmptyString,
  uri: NonEmptyString,
  mediaType: NonEmptyString,
  hash: Sha256HashSchema,
  provenance: Schema.Struct({
    kind: Schema.Union([
      Schema.Literal("synthetic"),
      Schema.Literal("owned"),
      Schema.Literal("licensed"),
      Schema.Literal("public_reference"),
      Schema.Literal("local_research_reference"),
    ]),
    sourceName: NonEmptyString,
    acquiredAt: NonEmptyString,
    rightsSummary: NonEmptyString,
  }),
})
export type SourceAsset = typeof SourceAssetSchema.Type

export const PromptCardPlaceholderSchema = Schema.Struct({
  cardSchema: Schema.Literal("brainrot_referential_mirror_card_v0"),
  conceptId: NonEmptyString,
  originalityBoundary: NonEmptyString,
  sourceInspirations: Schema.NonEmptyArray(Schema.Struct({
    label: NonEmptyString,
    abstractedMechanic: NonEmptyString,
    avoid: NonEmptyString,
  })),
  layers: Schema.Struct({
    primaryCharacter: NonEmptyString,
    secondaryPropOrCharacter: Schema.optional(NonEmptyString),
    background: NonEmptyString,
    audio: NonEmptyString,
    edit: NonEmptyString,
    i2vControls: NonEmptyString,
  }),
  providerPromptPlaceholders: Schema.Array(Schema.Struct({
    provider: NonEmptyString,
    placeholder: NonEmptyString,
  })),
})
export type PromptCardPlaceholder = typeof PromptCardPlaceholderSchema.Type

export const AnalysisTagsV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal("analysis-tags.v1"),
  manifestId: NonEmptyString,
  createdAt: NonEmptyString,
  sourceAsset: SourceAssetSchema,
  analyzer: Schema.Struct({
    provider: NonEmptyString,
    model: NonEmptyString,
    runId: NonEmptyString,
    analyzedAt: NonEmptyString,
  }),
  tags: Schema.Array(Schema.Struct({
    namespace: NonEmptyString,
    value: NonEmptyString,
    confidence: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 1 }))),
  })),
  analysisCopies: Schema.Array(Schema.Struct({
    path: NonEmptyString,
    sourceHash: Sha256HashSchema,
    purpose: Schema.Union([
      Schema.Literal("vision_analysis"),
      Schema.Literal("thumbnail_review"),
      Schema.Literal("metadata_probe"),
    ]),
  })),
  generationInputs: Schema.NonEmptyArray(Schema.Struct({
    kind: Schema.Union([
      Schema.Literal("canonical_source_hash"),
      Schema.Literal("conditioned_first_frame_hash"),
      Schema.Literal("provider_uri"),
    ]),
    sourceAssetId: NonEmptyString,
    sourceHash: Sha256HashSchema,
    providerUri: Schema.optional(NonEmptyString),
    intendedUse: Schema.Union([
      Schema.Literal("first_frame_provenance"),
      Schema.Literal("prompt_reference_metadata"),
      Schema.Literal("conditioning_record"),
    ]),
  })),
  promptCardPlaceholder: Schema.optional(PromptCardPlaceholderSchema),
  sidecars: Schema.Array(ContractArtifactSchema),
})
export type AnalysisTagsV1 = typeof AnalysisTagsV1Schema.Type

export const VoiceAssetsV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal("voice-assets.v1"),
  manifestId: NonEmptyString,
  createdAt: NonEmptyString,
  voices: Schema.NonEmptyArray(Schema.Struct({
    voiceAssetId: NonEmptyString,
    displayName: NonEmptyString,
    provider: NonEmptyString,
    model: NonEmptyString,
    voiceId: Schema.optional(NonEmptyString),
    consent: Schema.Struct({
      status: Schema.Union([
        Schema.Literal("synthetic"),
        Schema.Literal("owned_voice"),
        Schema.Literal("licensed_voice"),
      ]),
      sourceRecord: NonEmptyString,
      provenancePath: Schema.optional(NonEmptyString),
    }),
    deliveryStyle: Schema.Struct({
      language: NonEmptyString,
      pace: Schema.Union([Schema.Literal("slow"), Schema.Literal("medium"), Schema.Literal("fast")]),
      affect: NonEmptyString,
      asmrStyle: Schema.Array(NonEmptyString),
    }),
    preview: ContractArtifactSchema,
  })),
})
export type VoiceAssetsV1 = typeof VoiceAssetsV1Schema.Type

export const AsmrStemKindSchema = Schema.Union([
  Schema.Literal("voice"),
  Schema.Literal("whisper_double"),
  Schema.Literal("breath"),
  Schema.Literal("foley"),
  Schema.Literal("ambience"),
  Schema.Literal("music"),
  Schema.Literal("room_tone"),
  Schema.Literal("heartbeat"),
])
export type AsmrStemKind = typeof AsmrStemKindSchema.Type

export const AsmrStemsV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal("asmr-stems.v1"),
  manifestId: NonEmptyString,
  createdAt: NonEmptyString,
  timeline: Schema.Struct({
    durationSec: PositiveNumber,
    sampleRateHz: PositiveInteger,
    frameRate: PositiveNumber,
  }),
  stems: Schema.NonEmptyArray(Schema.Struct({
    stemId: NonEmptyString,
    kind: AsmrStemKindSchema,
    role: NonEmptyString,
    artifact: ContractArtifactSchema,
    timing: Schema.Struct({
      startSec: NonNegativeNumber,
      durationSec: PositiveNumber,
      fadeInSec: Schema.optional(NonNegativeNumber),
      fadeOutSec: Schema.optional(NonNegativeNumber),
      loop: Schema.Boolean,
    }),
    channels: Schema.Union([Schema.Literal("mono"), Schema.Literal("stereo")]),
    provenance: Schema.Struct({
      generator: NonEmptyString,
      sourceVoiceAssetId: Schema.optional(NonEmptyString),
      sourceHash: Schema.optional(Sha256HashSchema),
      notes: Schema.optional(NonEmptyString),
    }),
  })),
})
export type AsmrStemsV1 = typeof AsmrStemsV1Schema.Type

export const SpatialPositionSchema = Schema.Struct({
  azimuthDeg: AzimuthDegrees,
  elevationDeg: ElevationDegrees,
  distanceMeters: DistanceMeters,
})
export type SpatialPosition = typeof SpatialPositionSchema.Type

export const SpatialAudioManifestV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal("spatial-audio-manifest.v1"),
  manifestId: NonEmptyString,
  createdAt: NonEmptyString,
  stemsManifestPath: NonEmptyString,
  durationSec: PositiveNumber,
  renderer: Schema.Struct({
    engine: Schema.Union([
      Schema.Literal("webaudio-pannernode"),
      Schema.Literal("offline-audio-context"),
      Schema.Literal("ffmpeg-hrtf"),
      Schema.Literal("manual-daw"),
    ]),
    version: NonEmptyString,
  }),
  mix: Schema.Struct({
    outputPath: NonEmptyString,
    outputHash: Schema.optional(Sha256HashSchema),
    loudnessTargetLufs: FiniteNumber,
    truePeakDb: Schema.optional(FiniteNumber),
  }),
  objects: Schema.NonEmptyArray(Schema.Struct({
    stemId: NonEmptyString,
    bus: Schema.Union([
      Schema.Literal("voice"),
      Schema.Literal("foley"),
      Schema.Literal("ambience"),
      Schema.Literal("music"),
    ]),
    automation: Schema.NonEmptyArray(Schema.Struct({
      timeSec: NonNegativeNumber,
      gainDb: FiniteNumber,
      position: SpatialPositionSchema,
      occlusion: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 1 }))),
      reverbSend: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 1 }))),
    })),
  })),
  provenance: Schema.Struct({
    stemsManifestHash: Sha256HashSchema,
    renderRunId: NonEmptyString,
  }),
})
export type SpatialAudioManifestV1 = typeof SpatialAudioManifestV1Schema.Type

export const GeneratedVideoClipsV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal("generated-video-clips.v1"),
  manifestId: NonEmptyString,
  createdAt: NonEmptyString,
  clips: Schema.NonEmptyArray(Schema.Struct({
    clipId: NonEmptyString,
    providerJob: Schema.Struct({
      provider: NonEmptyString,
      model: NonEmptyString,
      jobId: NonEmptyString,
      submittedAt: NonEmptyString,
      completedAt: Schema.optional(NonEmptyString),
      accountClass: Schema.optional(NonEmptyString),
    }),
    prompt: Schema.Struct({
      text: NonEmptyString,
      negativePrompt: Schema.optional(NonEmptyString),
      promptHash: Sha256HashSchema,
    }),
    firstFrame: Schema.Struct({
      sourceAssetId: NonEmptyString,
      originalHash: Sha256HashSchema,
      conditionedHash: Sha256HashSchema,
      providerUri: NonEmptyString,
      conditioningManifestPath: NonEmptyString,
    }),
    generation: Schema.Struct({
      seed: Schema.optional(PositiveInteger),
      durationSec: PositiveNumber,
      ratio: NonEmptyString,
      fps: PositiveNumber,
      dryRun: Schema.Boolean,
    }),
    artifact: ContractArtifactSchema,
    provenance: Schema.Struct({
      runId: NonEmptyString,
      requestPath: NonEmptyString,
      responsePath: NonEmptyString,
      providerWatermark: Schema.optional(NonEmptyString),
    }),
  })),
})
export type GeneratedVideoClipsV1 = typeof GeneratedVideoClipsV1Schema.Type

export type AsmrContractManifest =
  | AnalysisTagsV1
  | VoiceAssetsV1
  | AsmrStemsV1
  | SpatialAudioManifestV1
  | GeneratedVideoClipsV1

export function decodeAnalysisTagsV1(value: unknown, operation = "analysis-tags.v1 manifest"): AnalysisTagsV1 {
  return decodeContract(AnalysisTagsV1Schema, value, operation, validateAnalysisTagsV1)
}

export function decodeVoiceAssetsV1(value: unknown, operation = "voice-assets.v1 manifest"): VoiceAssetsV1 {
  return decodeContract(VoiceAssetsV1Schema, value, operation, validateVoiceAssetsV1)
}

export function decodeAsmrStemsV1(value: unknown, operation = "asmr-stems.v1 manifest"): AsmrStemsV1 {
  return decodeContract(AsmrStemsV1Schema, value, operation, validateAsmrStemsV1)
}

export function decodeSpatialAudioManifestV1(value: unknown, operation = "spatial-audio-manifest.v1 manifest"): SpatialAudioManifestV1 {
  return decodeContract(SpatialAudioManifestV1Schema, value, operation, validateSpatialAudioManifestV1)
}

export function decodeGeneratedVideoClipsV1(value: unknown, operation = "generated-video-clips.v1 manifest"): GeneratedVideoClipsV1 {
  return decodeContract(GeneratedVideoClipsV1Schema, value, operation, validateGeneratedVideoClipsV1)
}

export function decodeAsmrContractManifest(value: unknown, operation = "ASMR media contract manifest"): AsmrContractManifest {
  const schemaVersion = schemaVersionOf(value, operation)
  switch (schemaVersion) {
    case "analysis-tags.v1":
      return decodeAnalysisTagsV1(value, operation)
    case "voice-assets.v1":
      return decodeVoiceAssetsV1(value, operation)
    case "asmr-stems.v1":
      return decodeAsmrStemsV1(value, operation)
    case "spatial-audio-manifest.v1":
      return decodeSpatialAudioManifestV1(value, operation)
    case "generated-video-clips.v1":
      return decodeGeneratedVideoClipsV1(value, operation)
    default:
      throw new AsmrContractValidationError(operation, `unsupported schemaVersion: ${schemaVersion}`)
  }
}

export function assertSafeManifestPath(value: string, operation = "manifest path"): void {
  if (value.trim() !== value) {
    throw new AsmrContractValidationError(operation, `path has leading or trailing whitespace: ${value}`)
  }
  if (value.startsWith("/") || value.startsWith("~") || value.includes("\\")) {
    throw new AsmrContractValidationError(operation, `path must be repo-relative and POSIX-style: ${value}`)
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    throw new AsmrContractValidationError(operation, `path must not be a URL: ${value}`)
  }
  if (value.split("/").some((part) => part === ".." || part === "")) {
    throw new AsmrContractValidationError(operation, `path must not contain empty or parent segments: ${value}`)
  }
}

function decodeContract<A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  operation: string,
  validate: (decoded: A, operation: string) => void,
): A {
  let decoded: A
  try {
    decoded = Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new AsmrContractValidationError(operation, `contract did not match required fields: ${message}`)
  }
  validate(decoded, operation)
  return decoded
}

function validateAnalysisTagsV1(manifest: AnalysisTagsV1, operation: string): void {
  assertIsoTimestamp(manifest.createdAt, operation, "createdAt")
  assertIsoTimestamp(manifest.sourceAsset.provenance.acquiredAt, operation, "sourceAsset.provenance.acquiredAt")
  assertIsoTimestamp(manifest.analyzer.analyzedAt, operation, "analyzer.analyzedAt")
  assertSha256(manifest.sourceAsset.hash, operation, "sourceAsset.hash")
  for (const copy of manifest.analysisCopies) {
    assertSafeManifestPath(copy.path, `${operation} analysisCopies.path`)
    assertSha256(copy.sourceHash, operation, `analysisCopies.${copy.path}.sourceHash`)
  }
  for (const input of manifest.generationInputs) {
    assertSha256(input.sourceHash, operation, `generationInputs.${input.sourceAssetId}.sourceHash`)
    if (input.kind === "provider_uri" && !input.providerUri) {
      throw new AsmrContractValidationError(operation, `provider_uri generation input requires providerUri for ${input.sourceAssetId}`)
    }
    if (input.providerUri) {
      assertProviderUri(input.providerUri, operation, `generationInputs.${input.sourceAssetId}.providerUri`)
    }
  }
  for (const sidecar of manifest.sidecars) {
    assertArtifact(sidecar, operation, `sidecars.${sidecar.path}`)
  }
}

function validateVoiceAssetsV1(manifest: VoiceAssetsV1, operation: string): void {
  assertIsoTimestamp(manifest.createdAt, operation, "createdAt")
  for (const voice of manifest.voices) {
    if (voice.consent.provenancePath) {
      assertSafeManifestPath(voice.consent.provenancePath, `${operation} consent.provenancePath`)
    }
    assertArtifact(voice.preview, operation, `voices.${voice.voiceAssetId}.preview`)
  }
}

function validateAsmrStemsV1(manifest: AsmrStemsV1, operation: string): void {
  assertIsoTimestamp(manifest.createdAt, operation, "createdAt")
  for (const stem of manifest.stems) {
    assertArtifact(stem.artifact, operation, `stems.${stem.stemId}.artifact`)
    assertTimelineRange(stem.timing.startSec, stem.timing.durationSec, manifest.timeline.durationSec, operation, `stems.${stem.stemId}.timing`)
    if (stem.provenance.sourceHash) {
      assertSha256(stem.provenance.sourceHash, operation, `stems.${stem.stemId}.provenance.sourceHash`)
    }
  }
}

function validateSpatialAudioManifestV1(manifest: SpatialAudioManifestV1, operation: string): void {
  assertIsoTimestamp(manifest.createdAt, operation, "createdAt")
  assertSafeManifestPath(manifest.stemsManifestPath, `${operation} stemsManifestPath`)
  assertSafeManifestPath(manifest.mix.outputPath, `${operation} mix.outputPath`)
  if (manifest.mix.outputHash) {
    assertSha256(manifest.mix.outputHash, operation, "mix.outputHash")
  }
  assertSha256(manifest.provenance.stemsManifestHash, operation, "provenance.stemsManifestHash")
  for (const object of manifest.objects) {
    for (const [index, point] of object.automation.entries()) {
      if (point.timeSec > manifest.durationSec) {
        throw new AsmrContractValidationError(operation, `objects.${object.stemId}.automation[${index}].timeSec exceeds durationSec`)
      }
    }
  }
}

function validateGeneratedVideoClipsV1(manifest: GeneratedVideoClipsV1, operation: string): void {
  assertIsoTimestamp(manifest.createdAt, operation, "createdAt")
  for (const clip of manifest.clips) {
    assertIsoTimestamp(clip.providerJob.submittedAt, operation, `clips.${clip.clipId}.providerJob.submittedAt`)
    if (clip.providerJob.completedAt) {
      assertIsoTimestamp(clip.providerJob.completedAt, operation, `clips.${clip.clipId}.providerJob.completedAt`)
      if (Date.parse(clip.providerJob.completedAt) < Date.parse(clip.providerJob.submittedAt)) {
        throw new AsmrContractValidationError(operation, `clips.${clip.clipId}.providerJob.completedAt is before submittedAt`)
      }
    }
    assertSha256(clip.prompt.promptHash, operation, `clips.${clip.clipId}.prompt.promptHash`)
    assertSha256(clip.firstFrame.originalHash, operation, `clips.${clip.clipId}.firstFrame.originalHash`)
    assertSha256(clip.firstFrame.conditionedHash, operation, `clips.${clip.clipId}.firstFrame.conditionedHash`)
    assertProviderUri(clip.firstFrame.providerUri, operation, `clips.${clip.clipId}.firstFrame.providerUri`)
    assertSafeManifestPath(clip.firstFrame.conditioningManifestPath, `${operation} clips.${clip.clipId}.firstFrame.conditioningManifestPath`)
    assertArtifact(clip.artifact, operation, `clips.${clip.clipId}.artifact`)
    assertSafeManifestPath(clip.provenance.requestPath, `${operation} clips.${clip.clipId}.provenance.requestPath`)
    assertSafeManifestPath(clip.provenance.responsePath, `${operation} clips.${clip.clipId}.provenance.responsePath`)
  }
}

function assertArtifact(artifact: ContractArtifact, operation: string, label: string): void {
  assertSafeManifestPath(artifact.path, `${operation} ${label}.path`)
  if (artifact.hash) {
    assertSha256(artifact.hash, operation, `${label}.hash`)
  }
}

function assertTimelineRange(startSec: number, durationSec: number, timelineDurationSec: number, operation: string, label: string): void {
  if (startSec + durationSec > timelineDurationSec + 0.000_001) {
    throw new AsmrContractValidationError(operation, `${label} exceeds timeline duration`)
  }
}

function assertSha256(hash: Sha256Hash, operation: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash.value)) {
    throw new AsmrContractValidationError(operation, `${label} must be a lowercase sha256 hex digest`)
  }
}

function assertIsoTimestamp(value: string, operation: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new AsmrContractValidationError(operation, `${label} must be an ISO-8601 UTC timestamp`)
  }
}

function assertProviderUri(value: string, operation: string, label: string): void {
  if (!/^[a-z][a-z0-9+.-]*:\/\/.+/i.test(value) && !/^[a-z][a-z0-9+.-]*:.+/i.test(value)) {
    throw new AsmrContractValidationError(operation, `${label} must be a provider URI`)
  }
}

function schemaVersionOf(value: unknown, operation: string): AsmrContractSchemaVersion | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AsmrContractValidationError(operation, "manifest must be an object")
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion
  if (typeof schemaVersion !== "string") {
    throw new AsmrContractValidationError(operation, "manifest requires string schemaVersion")
  }
  return schemaVersion
}
