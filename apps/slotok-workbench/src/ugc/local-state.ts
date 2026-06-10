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

export type UgcProvider = "kie" | "jimeng" | "local"
export type UgcProviderJobMode = "dry-run" | "live"
export type UgcProviderJobStatus = "planned" | "queued" | "running" | "succeeded" | "failed" | "blocked" | "completed"
export type UgcExportStatus = "draft" | "queued" | "rendered" | "failed"

export interface UgcWorkspaceSummary {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
  readonly personaCount: number
  readonly candidateCount: number
  readonly branchCount: number
  readonly providerJobCount: number
  readonly exportCount: number
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
  readonly branches: number
  readonly candidates: number
  readonly notes: number
  readonly providerJobs: number
  readonly referenceArchives: number
  readonly exportManifests: number
}

export interface UgcWorkspaceBundleShardManifest {
  readonly workspace: string
  readonly collections: {
    readonly personas: readonly string[]
    readonly campaigns: readonly string[]
    readonly branches: readonly string[]
    readonly candidates: readonly string[]
    readonly notes: readonly string[]
    readonly providerJobs: readonly string[]
    readonly referenceArchives: readonly string[]
    readonly exports: readonly string[]
    readonly bundles: readonly string[]
  }
  readonly assets: {
    readonly source: string
    readonly generated: string
    readonly exports: string
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

export interface UgcLocalState {
  readonly schemaVersion: "ugc-studio.local-state.v1"
  readonly workspace: UgcStudioWorkspace
  readonly providerJobs: readonly UgcProviderJob[]
  readonly exportManifests: readonly UgcExportManifest[]
  readonly referenceArchives: readonly UgcReferenceArchive[]
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

export interface CandidateStatusPatch {
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

export interface CreateExportManifestInput {
  readonly label?: string
  readonly selectedCandidateId?: string
  readonly presetId?: string
  readonly timelineJson?: JsonValue
  readonly notes?: readonly string[]
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
  }
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
