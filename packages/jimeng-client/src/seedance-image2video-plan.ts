import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  assertSafeManifestPath,
  decodeAnalysisTagsV1,
  decodeGeneratedVideoClipsV1,
  type AnalysisTagsV1,
  type GeneratedVideoClipsV1,
} from "@wirebabel/media-contracts"
import {
  buildJimengVideoDirectPlan,
  summarizeJimengVideoDirectPlan,
  type JimengVideoDirectPlan,
  type JimengVideoPlanInput,
} from "./video-plan"
import { type JsonObject, type JsonValue } from "./reference-image"

const DEFAULT_SEEDANCE_MODEL_VERSION = "jimeng-video-seedance-2.0"
const DEFAULT_CREATED_AT = "2026-06-24T00:00:00.000Z"
const DEFAULT_CONDITIONING_METHOD = "dry-run-synthid-quality-conditioning-v1"

export interface SeedanceFirstFrameConditioningInput {
  sourceAssetId?: string
  firstFrameUri?: string
  firstFramePath?: string
  firstFrameHash?: string
  firstFrameProvenancePath?: string
  firstFrameProvenance?: AnalysisTagsV1
  synthIdMarked?: boolean
  conditioningParams?: JsonObject
  conditioningManifestPath: string
  conditionedFirstFrameUri?: string
  conditionedFirstFrameHash?: string
  repoRoot?: string
  createdAt?: string
}

export interface SeedanceImage2VideoPlanInput extends Omit<JimengVideoPlanInput, "firstFrameUri" | "modelVersion" | "nowMs"> {
  prompt: string
  negativePrompt?: string
  modelVersion?: string
  firstFrame: SeedanceFirstFrameConditioningInput
  manifestId?: string
  clipId?: string
  runId?: string
  requestPath: string
  responsePath: string
  artifactPath: string
  createdAt?: string
}

export interface SeedanceFirstFrameConditioningPlan {
  schemaVersion: "seedance-first-frame-conditioning.v1"
  dryRun: true
  createdAt: string
  sourceAssetId: string
  firstFrame: {
    canonicalUri: string
    canonicalPath?: string
    originalHash: string
    conditionedHash: string
    conditionedProviderUri: string
    provenanceSidecarPath?: string
  }
  synthId: {
    marked: boolean
    evidence: string[]
  }
  conditioning: {
    applied: boolean
    method: string
    params: JsonObject
    hashKind: "sha256-of-dry-run-conditioning-record" | "sha256-of-conditioned-first-frame"
  }
  provenance: {
    sidecarSchemaVersion?: "analysis-tags.v1"
    sidecarManifestId?: string
    sourceKind?: string
    sourceName?: string
    rightsSummary?: string
    aiOriginDisclosed: boolean
    disclosure: string
  }
}

export interface SeedanceImage2VideoDryRunPlan {
  command: "seedance-image2video-plan"
  liveSubmit: false
  videoPlan: JimengVideoDirectPlan
  videoPlanSummary: JsonObject
  conditioningManifest: SeedanceFirstFrameConditioningPlan
  generatedVideoClipsManifest: GeneratedVideoClipsV1
}

export function buildSeedanceImage2VideoDryRunPlan(input: SeedanceImage2VideoPlanInput): SeedanceImage2VideoDryRunPlan {
  const createdAt = input.createdAt ?? input.firstFrame.createdAt ?? DEFAULT_CREATED_AT
  const runId = input.runId?.trim() || deterministicLabel("seedance-dry-run", input.prompt, createdAt)
  const conditioningManifest = buildSeedanceFirstFrameConditioningPlan({
    ...input.firstFrame,
    createdAt,
  })
  const sourceAssetId = conditioningManifest.sourceAssetId
  const submitId = input.submitId?.trim() || runId
  const idFactory = deterministicUuidFactory(`${runId}:${conditioningManifest.firstFrame.conditionedHash}`)
  const videoPlan = buildJimengVideoDirectPlan({
    prompt: input.prompt,
    modelVersion: input.modelVersion ?? DEFAULT_SEEDANCE_MODEL_VERSION,
    modelReqKey: input.modelReqKey,
    ratio: input.ratio,
    videoResolution: input.videoResolution,
    durationSec: input.durationSec,
    fps: input.fps,
    videoMode: input.videoMode,
    seed: input.seed,
    submitId,
    nowMs: Date.parse(createdAt),
    firstFrameUri: conditioningManifest.firstFrame.conditionedProviderUri,
    idFactory,
  })
  const generatedVideoClipsManifest = decodeGeneratedVideoClipsV1({
    schemaVersion: "generated-video-clips.v1",
    manifestId: input.manifestId?.trim() || `${runId}-generated-video-clips`,
    createdAt,
    clips: [{
      clipId: input.clipId?.trim() || `${sourceAssetId}-seedance-dry-run`,
      providerJob: {
        provider: "jimeng-seedance",
        model: videoPlan.modelVersion,
        jobId: `${runId}-dry-run-no-provider-job`,
        submittedAt: createdAt,
        accountClass: "dry-run-no-spend",
      },
      prompt: {
        text: input.prompt.trim(),
        negativePrompt: input.negativePrompt?.trim() || undefined,
        promptHash: sha256Contract(sha256Hex(input.prompt.trim())),
      },
      firstFrame: {
        sourceAssetId,
        originalHash: sha256Contract(conditioningManifest.firstFrame.originalHash),
        conditionedHash: sha256Contract(conditioningManifest.firstFrame.conditionedHash),
        providerUri: conditioningManifest.firstFrame.conditionedProviderUri,
        conditioningManifestPath: input.firstFrame.conditioningManifestPath,
      },
      generation: {
        seed: input.seed && input.seed > 0 ? input.seed : undefined,
        durationSec: videoPlan.durationSec,
        ratio: videoPlan.ratio,
        fps: videoPlan.fps,
        dryRun: true,
      },
      artifact: {
        path: input.artifactPath,
        mediaType: "video/mp4",
      },
      provenance: {
        runId,
        requestPath: input.requestPath,
        responsePath: input.responsePath,
        providerWatermark: "dry-run plan only; no provider video was submitted, polled, downloaded, or watermark-inspected.",
      },
    }],
  })

  return {
    command: "seedance-image2video-plan",
    liveSubmit: false,
    videoPlan,
    videoPlanSummary: summarizeJimengVideoDirectPlan(videoPlan),
    conditioningManifest,
    generatedVideoClipsManifest,
  }
}

export function buildSeedanceFirstFrameConditioningPlan(input: SeedanceFirstFrameConditioningInput): SeedanceFirstFrameConditioningPlan {
  const createdAt = input.createdAt ?? DEFAULT_CREATED_AT
  const repoRoot = input.repoRoot ?? process.cwd()
  const provenance = loadAnalysisTags(input.firstFrameProvenance, input.firstFrameProvenancePath, repoRoot)
  const sourceAssetId = input.sourceAssetId?.trim() || provenance?.sourceAsset.assetId || "first-frame-candidate"
  const originalHash = resolveFirstFrameHash(input, provenance, repoRoot)
  const synthIdEvidence = synthIdEvidenceFor(input, provenance)
  const synthIdMarked = input.synthIdMarked === true || synthIdEvidence.length > 0
  const params = normalizeConditioningParams(input.conditioningParams, synthIdMarked)
  assertSafeManifestPath(input.conditioningManifestPath, "seedance conditioning manifest path")
  if (input.firstFramePath) assertSafeManifestPath(input.firstFramePath, "seedance first-frame path")
  if (input.firstFrameProvenancePath) assertSafeManifestPath(input.firstFrameProvenancePath, "seedance first-frame provenance path")
  const canonicalUri = input.firstFrameUri?.trim() || providerUriPlaceholder(sourceAssetId, originalHash, "original")
  const conditionedHash = input.conditionedFirstFrameHash?.trim() || (synthIdMarked
    ? sha256Hex(stableJson({ method: DEFAULT_CONDITIONING_METHOD, originalHash, params }))
    : originalHash)
  assertSha256Hex(originalHash, "firstFrameHash")
  assertSha256Hex(conditionedHash, "conditionedFirstFrameHash")
  const conditionedProviderUri = input.conditionedFirstFrameUri?.trim()
    || (!synthIdMarked && input.firstFrameUri?.trim())
    || providerUriPlaceholder(sourceAssetId, conditionedHash, synthIdMarked ? "conditioned" : "original")

  const provenanceDisclosure = buildProvenanceDisclosure(provenance, synthIdMarked)
  return {
    schemaVersion: "seedance-first-frame-conditioning.v1",
    dryRun: true,
    createdAt,
    sourceAssetId,
    firstFrame: {
      canonicalUri,
      ...(input.firstFramePath ? { canonicalPath: input.firstFramePath } : {}),
      originalHash,
      conditionedHash,
      conditionedProviderUri,
      ...(input.firstFrameProvenancePath ? { provenanceSidecarPath: input.firstFrameProvenancePath } : {}),
    },
    synthId: {
      marked: synthIdMarked,
      evidence: synthIdEvidence,
    },
    conditioning: {
      applied: synthIdMarked,
      method: DEFAULT_CONDITIONING_METHOD,
      params,
      hashKind: input.conditionedFirstFrameHash ? "sha256-of-conditioned-first-frame" : "sha256-of-dry-run-conditioning-record",
    },
    provenance: provenanceDisclosure,
  }
}

export function summarizeSeedanceImage2VideoDryRunPlan(plan: SeedanceImage2VideoDryRunPlan): JsonObject {
  const clip = plan.generatedVideoClipsManifest.clips[0]
  return {
    command: plan.command,
    live_submit: false,
    provider: clip.providerJob.provider,
    model: clip.providerJob.model,
    job_id: clip.providerJob.jobId,
    duration_sec: clip.generation.durationSec,
    ratio: clip.generation.ratio,
    fps: clip.generation.fps,
    first_frame_source_asset_id: clip.firstFrame.sourceAssetId,
    first_frame_original_hash: clip.firstFrame.originalHash.value,
    first_frame_conditioned_hash: clip.firstFrame.conditionedHash.value,
    first_frame_provider_uri: clip.firstFrame.providerUri,
    conditioning_manifest_path: clip.firstFrame.conditioningManifestPath,
    synthid_marked: plan.conditioningManifest.synthId.marked,
    conditioning_applied: plan.conditioningManifest.conditioning.applied,
    generated_video_clips_schema_version: plan.generatedVideoClipsManifest.schemaVersion,
    request_path: clip.provenance.requestPath,
    response_path: clip.provenance.responsePath,
    artifact_path: clip.artifact.path,
  }
}

export function assertSeedanceSafeManifestPath(value: string, operation = "seedance manifest path"): void {
  assertSafeManifestPath(value, operation)
}

function loadAnalysisTags(provenance: AnalysisTagsV1 | undefined, provenancePath: string | undefined, repoRoot: string): AnalysisTagsV1 | undefined {
  if (provenance) return decodeAnalysisTagsV1(provenance, "seedance first-frame provenance")
  if (!provenancePath) return undefined
  assertSafeManifestPath(provenancePath, "seedance first-frame provenance path")
  const file = resolveSafePath(repoRoot, provenancePath, "seedance first-frame provenance path")
  return decodeAnalysisTagsV1(JSON.parse(readFileSync(file, "utf8")), "seedance first-frame provenance")
}

function resolveFirstFrameHash(input: SeedanceFirstFrameConditioningInput, provenance: AnalysisTagsV1 | undefined, repoRoot: string): string {
  const expectedHash = input.firstFrameHash?.trim() || provenance?.sourceAsset.hash.value
  if (input.firstFramePath) {
    const file = resolveSafePath(repoRoot, input.firstFramePath, "seedance first-frame path")
    if (existsSync(file)) {
      const fileHash = sha256Hex(readFileSync(file))
      if (expectedHash && expectedHash !== fileHash) {
        throw new Error(`first-frame hash mismatch: ${input.firstFramePath} is ${fileHash}, expected ${expectedHash}`)
      }
      return fileHash
    }
    if (!expectedHash) throw new Error(`first-frame path does not exist and --firstFrameHash was not provided: ${input.firstFramePath}`)
  }
  if (!expectedHash) throw new Error("seedance-image2video-plan requires --firstFrameHash, --firstFramePath, or an analysis-tags.v1 sidecar with sourceAsset.hash")
  assertSha256Hex(expectedHash, "firstFrameHash")
  return expectedHash
}

function synthIdEvidenceFor(input: SeedanceFirstFrameConditioningInput, provenance: AnalysisTagsV1 | undefined): string[] {
  const evidence: string[] = []
  if (input.synthIdMarked) evidence.push("explicit --synthIdMarked flag")
  if (!provenance) return evidence
  if (/gemini|synthid/i.test(provenance.sourceAsset.provenance.sourceName)) {
    evidence.push(`source provenance: ${provenance.sourceAsset.provenance.sourceName}`)
  }
  for (const tag of provenance.tags) {
    if (/gemini|synthid|watermark|ai-origin/i.test(`${tag.namespace}:${tag.value}`)) {
      evidence.push(`analysis tag: ${tag.namespace}:${tag.value}`)
    }
  }
  for (const sidecar of provenance.sidecars) {
    if (/gemini|synthid|c2pa|provenance/i.test(sidecar.path)) evidence.push(`sidecar: ${sidecar.path}`)
  }
  return Array.from(new Set(evidence)).sort()
}

function buildProvenanceDisclosure(provenance: AnalysisTagsV1 | undefined, synthIdMarked: boolean): SeedanceFirstFrameConditioningPlan["provenance"] {
  const source = provenance?.sourceAsset.provenance
  return {
    ...(provenance ? { sidecarSchemaVersion: provenance.schemaVersion, sidecarManifestId: provenance.manifestId } : {}),
    ...(source ? {
      sourceKind: source.kind,
      sourceName: source.sourceName,
      rightsSummary: source.rightsSummary,
    } : {}),
    aiOriginDisclosed: true,
    disclosure: synthIdMarked
      ? "Gemini/SynthID or AI-origin evidence is disclosed; dry-run requires a conditioning/removal step before Jimeng/Seedance provider upload and preserves pre/post hashes."
      : "First-frame provenance is disclosed; no SynthID-specific pixel conditioning is planned for this dry-run handoff.",
  }
}

function normalizeConditioningParams(params: JsonObject | undefined, synthIdMarked: boolean): JsonObject {
  return {
    planned_only: true,
    no_spend: true,
    deterministic: true,
    source_signal: synthIdMarked ? "gemini-or-synthid-marked" : "unmarked-first-frame",
    operations: synthIdMarked
      ? ["metadata_disclosure_preserved", "pixel_conditioning_required_before_live_upload", "provider_upload_after_conditioning"]
      : ["metadata_disclosure_preserved", "no_pixel_conditioning_needed_for_dry_run"],
    ...(params ?? {}),
  }
}

function providerUriPlaceholder(sourceAssetId: string, hash: string, stage: string): string {
  return `tos://dry-run/seedance/${slug(sourceAssetId)}/${stage}-${hash.slice(0, 16)}.png`
}

function resolveSafePath(repoRoot: string, relativePath: string, operation: string): string {
  assertSafeManifestPath(relativePath, operation)
  const root = path.resolve(repoRoot)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${operation} escapes repo root: ${relativePath}`)
  }
  return resolved
}

function deterministicUuidFactory(seed: string): () => string {
  let index = 0
  return () => {
    index += 1
    const hex = sha256Hex(`${seed}:${index}`)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }
}

function deterministicLabel(prefix: string, text: string, createdAt: string): string {
  return `${prefix}-${sha256Hex(`${createdAt}:${text}`).slice(0, 16)}`
}

function sha256Contract(value: string) {
  return { algorithm: "sha256" as const, value }
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === "object") {
    const sorted: JsonObject = {}
    for (const key of Object.keys(value).sort()) sorted[key] = sortJson(value[key])
    return sorted
  }
  return value
}

function assertSha256Hex(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase sha256 hex digest`)
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "asset"
}
