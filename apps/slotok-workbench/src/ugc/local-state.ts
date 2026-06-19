import {
  ugcStudioWorkspace,
  type BranchSnapshot,
  type CandidateStatus,
  type CreativeCandidate,
  type JsonValue,
  type PersonaProfile,
  type ReferenceProfile,
  type ReferenceRightsStatus,
  type ReviewAttachment,
  type ReviewVerdict,
  type UgcStudioWorkspace,
} from "../renderer/ugcStudioModel"

export type UgcProvider = "kie" | "jimeng" | "local" | "codex"
export type UgcProviderJobMode = "dry-run" | "live"
export type UgcProviderJobStatus = "planned" | "queued" | "running" | "succeeded" | "failed" | "blocked" | "completed"
export type UgcExportStatus = "draft" | "queued" | "rendered" | "failed"
export type UgcResearchPlatform = "tiktok" | "instagram" | "youtube-shorts" | "web" | "internal"
export type UgcResearchTargetStatus = "draft" | "queued" | "sampling" | "decomposed" | "blocked" | "done"
export type UgcTemplateMiningJobStatus = "planned" | "queued" | "running" | "ready" | "blocked" | "done"

export interface UgcWorkspaceSummary {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
  readonly personaCount: number
  readonly candidateCount: number
  readonly branchCount: number
  readonly providerJobCount: number
  readonly exportCount: number
  readonly researchTargetCount: number
  readonly templateMiningJobCount: number
}

export interface UgcWorkspaceBundle {
  readonly schemaVersion: "ugc-studio.workspace-bundle.v1"
  readonly id: string
  readonly workspaceId: string
  readonly label: string
  readonly exportedAt: string
  readonly sourceStateUpdatedAt: string
  readonly summary: UgcWorkspaceSummary
  readonly objectCounts: UgcWorkspaceBundleObjectCounts
  readonly shardManifest: UgcWorkspaceBundleShardManifest
  readonly state: UgcLocalState
}

export interface UgcWorkspaceBundleObjectCounts {
  readonly personas: number
  readonly referenceProfiles: number
  readonly branches: number
  readonly candidates: number
  readonly notes: number
  readonly providerJobs: number
  readonly referenceArchives: number
  readonly exportManifests: number
  readonly researchTargets: number
  readonly templateMiningJobs: number
}

export interface UgcReferenceCatalogVideoPaths {
  readonly mp4: string | null
  readonly infoJson: string
  readonly poster: string | null
}

export interface UgcReferenceCatalogEngagement {
  readonly views: number | null
  readonly likes: number | null
  readonly comments: number | null
  readonly shares: number | null
  readonly saves: number | null
}

export interface UgcReferenceCatalogVideo {
  readonly schemaVersion: "ugc-studio.reference-catalog-video.v1"
  readonly id: string
  readonly referenceProfileId: string
  readonly videoId: string
  readonly catalogueRoot: string
  readonly uploader: string
  readonly handle: string
  readonly title: string
  readonly durationSeconds: number | null
  readonly engagement: UgcReferenceCatalogEngagement
  readonly paths: UgcReferenceCatalogVideoPaths
  readonly sourcePolicy: "metadata-only"
  readonly guardrails: readonly string[]
}

export interface UgcReferenceManifestAsset {
  readonly schemaVersion: "ugc-studio.reference-manifest-asset.v1"
  readonly id: string
  readonly provider: string
  readonly title: string
  readonly mediaType: string
  readonly localPath: string | null
  readonly sourceUrl: string | null
  readonly assetUrl: string | null
  readonly manifestPath: string
  readonly byteLength: number | null
  readonly sha256: string | null
  readonly captureTimestamp: string | null
  readonly rights: string
  readonly provenance: string
  readonly sourcePolicy: "metadata-only" | "abstract-mechanics"
  readonly referenceOnly: boolean
  readonly directGenerationInput: boolean
  readonly guardrails: readonly string[]
}


export interface UgcReferenceCatalogImportInput {
  readonly roots?: readonly string[]
  readonly manifestPaths?: readonly string[]
}

export interface UgcReferenceCatalogImportResult {
  readonly schemaVersion: "ugc-studio.reference-catalog-import-result.v1"
  readonly dryRun: boolean
  readonly valid: boolean
  readonly imported: boolean
  readonly checkedAt: string
  readonly roots: readonly string[]
  readonly manifestPaths: readonly string[]
  readonly videosPlanned: number
  readonly assetsPlanned: number
  readonly referenceProfileIds: readonly string[]
  readonly archiveIds: readonly string[]
  readonly providerJobIds: readonly string[]
  readonly researchTargetIds: readonly string[]
  readonly templateMiningJobIds: readonly string[]
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly state: UgcLocalState | null
}

export interface UgcWorkspaceBundleShardManifest {
  readonly workspace: string
  readonly collections: {
    readonly personas: readonly string[]
    readonly campaigns: readonly string[]
    readonly referenceProfiles: readonly string[]
    readonly branches: readonly string[]
    readonly candidates: readonly string[]
    readonly notes: readonly string[]
    readonly providerJobs: readonly string[]
    readonly referenceArchives: readonly string[]
    readonly exports: readonly string[]
    readonly researchTargets: readonly string[]
    readonly templateMiningJobs: readonly string[]
    readonly bundles: readonly string[]
  }
  readonly assets: {
    readonly source: string
    readonly generated: string
    readonly exports: string
  }
  readonly localAssets: {
    readonly source: readonly string[]
    readonly generated: readonly string[]
    readonly exports: readonly string[]
    readonly referenceCatalog: readonly string[]
  }
}

export interface UgcWorkspaceBundleImportResult {
  readonly schemaVersion: "ugc-studio.workspace-bundle-import-result.v1"
  readonly dryRun: boolean
  readonly valid: boolean
  readonly imported: boolean
  readonly checkedAt: string
  readonly bundleId: string | null
  readonly workspaceId: string | null
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly objectCounts: UgcWorkspaceBundleObjectCounts | null
  readonly importedState: UgcLocalState | null
}

export interface UgcProviderJob {
  readonly schemaVersion: "ugc-studio.provider-job.v1"
  readonly id: string
  readonly workspaceId: string
  readonly provider: UgcProvider
  readonly operation: string
  readonly mode: UgcProviderJobMode
  readonly status: UgcProviderJobStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly targetIds: readonly string[]
  readonly spendCapUsd: number
  readonly estimatedCostUsd: number | null
  readonly request: JsonValue
  readonly response: JsonValue | null
  readonly artifactPaths: readonly string[]
  readonly error: string | null
}

export interface UgcExportManifest {
  readonly schemaVersion: "ugc-studio.export-manifest.v1"
  readonly id: string
  readonly workspaceId: string
  readonly label: string
  readonly selectedCandidateId: string
  readonly presetId: string
  readonly status: UgcExportStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly timelineJson: JsonValue
  readonly outputPath: string | null
  readonly notes: readonly string[]
}

export interface UgcReferenceArchive {
  readonly schemaVersion: "ugc-studio.reference-archive.v1"
  readonly id: string
  readonly workspaceId: string
  readonly referenceProfileId: string
  readonly title: string
  readonly rightsStatus: ReferenceRightsStatus
  readonly archiveStatus: ReferenceProfile["archiveStatus"]
  readonly createdAt: string
  readonly updatedAt: string
  readonly sourcePolicy: "metadata-only" | "abstract-mechanics" | "rights-cleared-source"
  readonly preservedMechanics: JsonValue
  readonly sampleClipIds: readonly string[]
  readonly swappedFields: readonly string[]
  readonly blockedFields: readonly string[]
  readonly guardrails: readonly string[]
  readonly candidateFormatOutputs: readonly ReferenceArchiveFormatOutput[]
  readonly notes: readonly string[]
  readonly catalogVideos: readonly UgcReferenceCatalogVideo[]
  readonly referenceAssets: readonly UgcReferenceManifestAsset[]
}

export interface ReferenceArchiveFormatOutput {
  readonly id: string
  readonly title: string
  readonly kind: "format-template" | "pose-plan" | "caption-template" | "hook-family" | "cta-pattern"
  readonly summary: string
  readonly stageIds: readonly string[]
  readonly candidateIds: readonly string[]
  readonly manifestJson: JsonValue
}

export interface UgcResearchTarget {
  readonly schemaVersion: "ugc-studio.research-target.v1"
  readonly id: string
  readonly workspaceId: string
  readonly platform: UgcResearchPlatform
  readonly niche: string
  readonly query: string
  readonly status: UgcResearchTargetStatus
  readonly priority: number
  readonly sourcePolicy: "metadata-only" | "abstract-mechanics"
  readonly createdAt: string
  readonly updatedAt: string
  readonly templateJobIds: readonly string[]
  readonly notes: readonly string[]
}

export interface UgcTemplateMiningJob {
  readonly schemaVersion: "ugc-studio.template-mining-job.v1"
  readonly id: string
  readonly workspaceId: string
  readonly researchTargetId: string
  readonly status: UgcTemplateMiningJobStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly templateSpec: CleanRoomTemplateSpec
  readonly candidateIds: readonly string[]
  readonly error: string | null
}

export interface CleanRoomTemplateSpec {
  readonly schemaVersion: "ugc-studio.clean-room-template.v1"
  readonly id: string
  readonly title: string
  readonly category: "format" | "pose" | "caption" | "hook" | "cta" | "persona-building"
  readonly preservedMechanics: JsonValue
  readonly swapSlots: readonly string[]
  readonly blockedFields: readonly string[]
  readonly proofNotes: readonly string[]
}

export interface UgcLocalState {
  readonly schemaVersion: "ugc-studio.local-state.v1"
  readonly workspace: UgcStudioWorkspace
  readonly providerJobs: readonly UgcProviderJob[]
  readonly exportManifests: readonly UgcExportManifest[]
  readonly referenceArchives: readonly UgcReferenceArchive[]
  readonly researchTargets: readonly UgcResearchTarget[]
  readonly templateMiningJobs: readonly UgcTemplateMiningJob[]
  readonly updatedAt: string
}

export interface PersonaPatch {
  readonly status?: PersonaProfile["status"]
  readonly notes?: readonly string[]
  readonly avatarPrompt?: string
  readonly genreLane?: string
  readonly voice?: Partial<PersonaProfile["voice"]>
  readonly profileBible?: Partial<PersonaProfile["profileBible"]>
  readonly continuityManifest?: JsonValue
}

export interface BranchPatch {
  readonly status?: BranchSnapshot["status"]
  readonly decisionNote?: string
}

export interface CreateBranchInput {
  readonly parentId?: string | null
  readonly title?: string
  readonly focus: string
  readonly selectedPersonaIds?: readonly string[]
  readonly selectedCandidateIds?: readonly string[]
  readonly candidateBatchIds?: readonly string[]
  readonly decisionNote?: string
}

export interface CandidateStatusPatch {
  readonly status: CandidateStatus
}

export interface BulkCandidateStatusPatch {
  readonly candidateIds: readonly string[]
  readonly status: CandidateStatus
}

export interface CreateReviewNoteInput {
  readonly author?: "arthur" | "agent"
  readonly attachedTo: ReviewAttachment
  readonly verdict: ReviewVerdict
  readonly body: string
  readonly requestedChange?: string | null
}

export interface CreateProviderJobInput {
  readonly provider: UgcProvider
  readonly operation: string
  readonly mode?: UgcProviderJobMode
  readonly status?: UgcProviderJobStatus
  readonly targetIds?: readonly string[]
  readonly spendCapUsd?: number
  readonly estimatedCostUsd?: number | null
  readonly request: JsonValue
  readonly response?: JsonValue | null
  readonly artifactPaths?: readonly string[]
  readonly error?: string | null
}

export interface ProviderJobPatch {
  readonly status?: UgcProviderJobStatus
  readonly response?: JsonValue | null
  readonly artifactPaths?: readonly string[]
  readonly error?: string | null
}

export interface CreateReferenceArchiveInput {
  readonly referenceProfileId: string
  readonly sourcePolicy?: UgcReferenceArchive["sourcePolicy"]
  readonly archiveStatus?: UgcReferenceArchive["archiveStatus"]
  readonly preservedMechanics?: JsonValue
  readonly swappedFields?: readonly string[]
  readonly blockedFields?: readonly string[]
  readonly guardrails?: readonly string[]
  readonly candidateFormatOutputs?: readonly ReferenceArchiveFormatOutput[]
  readonly notes?: readonly string[]
}

export interface CreateResearchTargetInput {
  readonly platform?: UgcResearchPlatform
  readonly niche: string
  readonly query: string
  readonly priority?: number
  readonly sourcePolicy?: UgcResearchTarget["sourcePolicy"]
  readonly notes?: readonly string[]
}

export interface ResearchTargetPatch {
  readonly status?: UgcResearchTargetStatus
  readonly notes?: readonly string[]
  readonly priority?: number
}

export interface CreateTemplateMiningJobInput {
  readonly researchTargetId: string
  readonly status?: UgcTemplateMiningJobStatus
  readonly templateSpec?: CleanRoomTemplateSpec
  readonly candidateIds?: readonly string[]
}

export interface TemplateMiningJobPatch {
  readonly status?: UgcTemplateMiningJobStatus
  readonly templateSpec?: CleanRoomTemplateSpec
  readonly candidateIds?: readonly string[]
  readonly error?: string | null
}

export interface CreateExportManifestInput {
  readonly label?: string
  readonly selectedCandidateId?: string
  readonly presetId?: string
  readonly timelineJson?: JsonValue
  readonly notes?: readonly string[]
}

export interface FinalEditorPatch {
  readonly selectedCandidateId?: string
  readonly trackUpdates?: readonly FinalEditorTrackPatch[]
  readonly clipUpdates?: readonly FinalEditorClipPatch[]
}

export interface FinalEditorTrackPatch {
  readonly id: string
  readonly visible?: boolean
  readonly locked?: boolean
}

export interface FinalEditorClipPatch {
  readonly trackId: string
  readonly clipId: string
  readonly label?: string
  readonly startSeconds?: number
  readonly durationSeconds?: number
  readonly payloadJson?: JsonValue
}

export interface CreateWorkspaceBundleInput {
  readonly label?: string
}

export interface ImportWorkspaceBundleInput {
  readonly bundle: JsonValue | UgcWorkspaceBundle
  readonly dryRun?: boolean
}

export function createInitialLocalState(now = new Date().toISOString()): UgcLocalState {
  const workspace = clonePlain(ugcStudioWorkspace) as UgcStudioWorkspace
  return {
    schemaVersion: "ugc-studio.local-state.v1",
    workspace: { ...workspace, updatedAt: now },
    providerJobs: [],
    exportManifests: [],
    referenceArchives: workspace.referenceProfiles.map((referenceProfile) => referenceProfileToArchive(workspace.id, referenceProfile, now)),
    researchTargets: createInitialResearchTargets(workspace.id, now),
    templateMiningJobs: createInitialTemplateMiningJobs(workspace.id, now),
    updatedAt: now,
  }
}

export function summarizeLocalState(state: UgcLocalState): UgcWorkspaceSummary {
  return {
    id: state.workspace.id,
    title: state.workspace.title,
    updatedAt: state.updatedAt,
    personaCount: state.workspace.personas.length,
    candidateCount: state.workspace.candidates.length,
    branchCount: state.workspace.branchSnapshots.length,
    providerJobCount: state.providerJobs.length,
    exportCount: state.exportManifests.length,
    researchTargetCount: state.researchTargets.length,
    templateMiningJobCount: state.templateMiningJobs.length,
  }
}

export function createInitialResearchTargets(workspaceId: string, now: string): readonly UgcResearchTarget[] {
  return [
    {
      schemaVersion: "ugc-studio.research-target.v1",
      id: "research_kbeauty_fitness_ugc",
      workspaceId,
      platform: "tiktok",
      niche: "Korean beauty fitness UGC",
      query: "Korean beauty fitness creator protein snack soft routine proof hooks",
      status: "queued",
      priority: 1,
      sourcePolicy: "metadata-only",
      createdAt: now,
      updatedAt: now,
      templateJobIds: ["template_job_kbeauty_soft_proof"],
      notes: ["No live scraping. Queue public/rights-cleared research targets for later review."],
    },
  ]
}

export function createInitialTemplateMiningJobs(workspaceId: string, now: string): readonly UgcTemplateMiningJob[] {
  return [
    {
      schemaVersion: "ugc-studio.template-mining-job.v1",
      id: "template_job_kbeauty_soft_proof",
      workspaceId,
      researchTargetId: "research_kbeauty_fitness_ugc",
      status: "planned",
      createdAt: now,
      updatedAt: now,
      templateSpec: {
        schemaVersion: "ugc-studio.clean-room-template.v1",
        id: "template_kbeauty_soft_proof",
        title: "Soft routine proof hook",
        category: "hook",
        preservedMechanics: {
          structure: ["quiet problem beat", "routine insert", "product proof", "low-pressure CTA"],
          captionRhythm: "two short caption blocks, one proof line, one CTA line",
          editCadence: "calm jump cuts every 2-3 seconds",
        },
        swapSlots: ["synthetic persona", "product demo", "hook copy", "CTA copy", "voice"],
        blockedFields: ["source face", "source voice", "exact caption text", "source pixels", "brand marks"],
        proofNotes: ["Abstract mechanics only; no source media or identity cloning."],
      },
      candidateIds: [],
      error: null,
    },
  ]
}

export function referenceProfileToArchive(workspaceId: string, referenceProfile: ReferenceProfile, now: string): UgcReferenceArchive {
  return {
    schemaVersion: "ugc-studio.reference-archive.v1",
    id: `archive_${referenceProfile.id}`,
    workspaceId,
    referenceProfileId: referenceProfile.id,
    title: referenceProfile.displayName,
    rightsStatus: referenceProfile.rightsStatus,
    archiveStatus: referenceProfile.archiveStatus,
    createdAt: now,
    updatedAt: now,
    sourcePolicy: referenceProfile.rightsStatus === "rights-cleared" || referenceProfile.rightsStatus === "user-owned"
      ? "rights-cleared-source"
      : "abstract-mechanics",
    preservedMechanics: toJsonValue(referenceProfile.extractedMechanics),
    sampleClipIds: referenceProfile.sampleClips.map((clip) => clip.id),
    swappedFields: referenceProfile.remixFields.filter((field) => field.mode === "swap").map((field) => field.label),
    blockedFields: referenceProfile.remixFields.filter((field) => field.mode === "blocked").map((field) => field.label),
    guardrails: referenceProfile.cleanRoomBoundary,
    candidateFormatOutputs: referenceProfileToFormatOutputs(referenceProfile),
    notes: [],
    catalogVideos: [],
    referenceAssets: [],
  }
}

export function referenceProfileToFormatOutputs(referenceProfile: ReferenceProfile): readonly ReferenceArchiveFormatOutput[] {
  return [
    {
      id: `format_${referenceProfile.id}_pose_timing`,
      title: "Pose and timing plan",
      kind: "pose-plan",
      summary: referenceProfile.extractedMechanics.poseTiming,
      stageIds: ["stage_reference_profile", "stage_edit_style"],
      candidateIds: [],
      manifestJson: {
        gestureRhythm: referenceProfile.extractedMechanics.gestureRhythm,
        shotStructure: referenceProfile.extractedMechanics.shotStructure,
        sampleClipIds: referenceProfile.sampleClips.map((clip) => clip.id),
      },
    },
    {
      id: `format_${referenceProfile.id}_caption_template`,
      title: "Caption template grammar",
      kind: "caption-template",
      summary: referenceProfile.extractedMechanics.captionTemplate,
      stageIds: ["stage_hook", "stage_cta"],
      candidateIds: [],
      manifestJson: {
        hookFamilies: referenceProfile.extractedMechanics.hookFamilies,
        ctaPatterns: referenceProfile.extractedMechanics.ctaPatterns,
        nonAdPatterns: referenceProfile.extractedMechanics.nonAdPatterns,
      },
    },
  ]
}

export function isLocalState(value: unknown): value is UgcLocalState {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== "ugc-studio.local-state.v1") return false
  if (!isWorkspace(value.workspace)) return false
  if (!Array.isArray(value.providerJobs) || !Array.isArray(value.exportManifests) || !Array.isArray(value.referenceArchives)) return false
  if ("researchTargets" in value && !Array.isArray(value.researchTargets)) return false
  if ("templateMiningJobs" in value && !Array.isArray(value.templateMiningJobs)) return false
  return typeof value.updatedAt === "string"
}

export function isWorkspace(value: unknown): value is UgcStudioWorkspace {
  if (!isRecord(value)) return false
  return value.schemaVersion === "ugc-studio.workspace.v1"
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.updatedAt === "string"
    && Array.isArray(value.personas)
    && Array.isArray(value.candidates)
    && Array.isArray(value.branchSnapshots)
    && Array.isArray(value.referenceProfiles)
    && isRecord(value.productBrief)
    && isRecord(value.agent)
    && isRecord(value.finalEditor)
    && isRecord(value.developerGraph)
}

export function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function toJsonValue(value: object): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function candidateById(workspace: UgcStudioWorkspace, id: string): CreativeCandidate | undefined {
  return workspace.candidates.find((candidate) => candidate.id === id)
}
