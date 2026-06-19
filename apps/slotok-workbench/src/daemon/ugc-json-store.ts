import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, relative, resolve } from "node:path"
import {
  candidateById,
  createInitialLocalState,
  createInitialResearchTargets,
  createInitialTemplateMiningJobs,
  isLocalState,
  isRecord,
  referenceProfileToArchive,
  summarizeLocalState,
  toJsonValue,
  type BranchPatch,
  type BulkCandidateStatusPatch,
  type CandidateStatusPatch,
  type CleanRoomTemplateSpec,
  type CreateBranchInput,
  type CreateExportManifestInput,
  type CreateProviderJobInput,
  type CreateReferenceArchiveInput,
  type CreateResearchTargetInput,
  type CreateReviewNoteInput,
  type CreateTemplateMiningJobInput,
  type CreateWorkspaceBundleInput,
  type FinalEditorPatch,
  type ImportWorkspaceBundleInput,
  type UgcReferenceCatalogImportInput,
  type UgcReferenceCatalogImportResult,
  type UgcReferenceCatalogVideo,
  type PersonaPatch,
  type ProviderJobPatch,
  type ResearchTargetPatch,
  type TemplateMiningJobPatch,
  type UgcExportManifest,
  type UgcLocalState,
  type UgcProviderJob,
  type UgcReferenceArchive,
  type UgcResearchTarget,
  type UgcTemplateMiningJob,
  type UgcWorkspaceBundle,
  type UgcWorkspaceBundleImportResult,
  type UgcWorkspaceBundleObjectCounts,
  type UgcWorkspaceBundleShardManifest,
} from "../ugc/local-state"
import { UgcSqliteStore } from "./ugc-sqlite-store"
import type { BranchSnapshot, JsonValue, PersonaProfile, ReferenceProfile, ReviewNote, UgcStudioWorkspace } from "../renderer/ugcStudioModel"

export interface UgcJsonStoreOptions {
  readonly cwd?: string
  readonly root?: string
  readonly workspaceId?: string
  readonly now?: () => string
  readonly sqliteSync?: boolean | UgcSqliteStore
}

export interface UgcJsonStoreConfig {
  readonly cwd: string
  readonly root: string
  readonly workspaceId: string
  readonly workspaceDir: string
  readonly statePath: string
  readonly sqlitePath: string
}

type JsonSerializable = JsonValue | object

export class UgcJsonStore {
  readonly config: UgcJsonStoreConfig
  readonly now: () => string
  readonly sqliteStore: UgcSqliteStore | null

  constructor(options: UgcJsonStoreOptions = {}) {
    const cwd = resolve(options.cwd ?? findProjectRoot(process.cwd()))
    const root = resolve(cwd, options.root ?? "data/ugc-studio/workspaces")
    const workspaceId = options.workspaceId ?? "workspace_protein_bar_ads"
    const workspaceDir = resolve(root, workspaceId)
    const statePath = resolve(workspaceDir, "state.json")
    const sqlitePath = resolve(workspaceDir, "workspace.sqlite")
    this.config = {
      cwd,
      root,
      workspaceId,
      workspaceDir,
      statePath,
      sqlitePath,
    }
    this.sqliteStore = options.sqliteSync === false
      ? null
      : options.sqliteSync instanceof UgcSqliteStore
        ? options.sqliteSync
        : new UgcSqliteStore({ workspaceDir, sqlitePath })
    this.now = options.now ?? (() => new Date().toISOString())
  }

  summary() {
    return summarizeLocalState(this.read())
  }

  read(): UgcLocalState {
    const sqliteState = this.sqliteStore?.readValidState()
    const existing = readJsonFile(this.config.statePath)
    const jsonState = isLocalState(existing) ? normalizeLocalState(existing) : null

    if (sqliteState && jsonState && stateUpdatedAfter(jsonState, sqliteState)) {
      return this.write(jsonState)
    }

    if (sqliteState) {
      this.#repairJsonArtifacts(sqliteState)
      return sqliteState
    }

    if (jsonState) {
      if (JSON.stringify(jsonState) !== JSON.stringify(existing)) return this.write(jsonState)
      this.sqliteStore?.writeState(jsonState)
      return jsonState
    }

    const created = createInitialLocalState(this.now())
    this.write(created)
    return created
  }

  write(state: UgcLocalState): UgcLocalState {
    const normalized = stampState(state, this.now())
    writeJsonAtomic(this.config.statePath, normalized)
    writeWorkspaceShards(this.config.workspaceDir, normalized)
    this.sqliteStore?.writeState(normalized)
    return normalized
  }

  reset(): UgcLocalState {
    rmSync(this.config.workspaceDir, { recursive: true, force: true })
    return this.write(createInitialLocalState(this.now()))
  }

  updatePersona(personaId: string, patch: PersonaPatch): UgcLocalState {
    return this.#updateWorkspace((workspace) => {
      const personas = workspace.personas.map((persona) => {
        if (persona.id !== personaId) return persona
        return patchPersona(persona, patch)
      })
      if (personas.every((persona, index) => persona === workspace.personas[index])) {
        throw new Error(`persona not found: ${personaId}`)
      }
      return { ...workspace, personas }
    })
  }

  updateCandidate(candidateId: string, patch: CandidateStatusPatch): UgcLocalState {
    return this.#updateWorkspace((workspace) => {
      const candidates = workspace.candidates.map((candidate) => (
        candidate.id === candidateId ? { ...candidate, status: patch.status } : candidate
      ))
      if (candidates.every((candidate, index) => candidate === workspace.candidates[index])) {
        throw new Error(`candidate not found: ${candidateId}`)
      }
      return { ...workspace, candidates }
    })
  }

  updateCandidates(patch: BulkCandidateStatusPatch): UgcLocalState {
    const candidateIds = new Set(patch.candidateIds)
    if (candidateIds.size === 0) throw new Error("candidate bulk status patch requires candidateIds")
    return this.#updateWorkspace((workspace) => {
      let updatedCount = 0
      const candidates = workspace.candidates.map((candidate) => {
        if (!candidateIds.has(candidate.id)) return candidate
        updatedCount += 1
        return { ...candidate, status: patch.status }
      })
      if (updatedCount !== candidateIds.size) {
        const missing = [...candidateIds].filter((id) => !workspace.candidates.some((candidate) => candidate.id === id))
        throw new Error(`candidate not found: ${missing.join(", ")}`)
      }
      return { ...workspace, candidates }
    })
  }

  updateBranch(branchId: string, patch: BranchPatch): UgcLocalState {
    return this.#updateWorkspace((workspace) => {
      const branchSnapshots = workspace.branchSnapshots.map((branch) => {
        if (branch.id !== branchId) return branch
        return {
          ...branch,
          status: patch.status ?? branch.status,
          decisionNote: patch.decisionNote ?? branch.decisionNote,
        }
      })
      if (branchSnapshots.every((branch, index) => branch === workspace.branchSnapshots[index])) {
        throw new Error(`branch not found: ${branchId}`)
      }
      return { ...workspace, branchSnapshots }
    })
  }

  createBranch(input: CreateBranchInput): UgcLocalState {
    const state = this.read()
    const now = this.now()
    const parent = input.parentId ? state.workspace.branchSnapshots.find((branch) => branch.id === input.parentId) : null
    if (input.parentId && !parent) throw new Error(`parent branch not found: ${input.parentId}`)
    const branch: BranchSnapshot = {
      id: `branch_${slug(input.title ?? input.focus)}_${Date.now().toString(36)}`,
      parentId: parent?.id ?? null,
      title: input.title?.trim() || `Fork: ${input.focus}`,
      status: "active",
      createdAt: now,
      focus: input.focus,
      decisionNote: input.decisionNote ?? "Created as a local fork for creative exploration.",
      selectedPersonaIds: input.selectedPersonaIds ?? parent?.selectedPersonaIds ?? [],
      selectedCandidateIds: input.selectedCandidateIds ?? parent?.selectedCandidateIds ?? [],
      candidateBatchIds: input.candidateBatchIds ?? parent?.candidateBatchIds ?? [],
      childIds: [],
      metrics: parent?.metrics ?? [],
    }
    return this.write({
      ...state,
      workspace: {
        ...state.workspace,
        branchSnapshots: [
          branch,
          ...state.workspace.branchSnapshots.map((snapshot) => (
            snapshot.id === parent?.id ? { ...snapshot, childIds: [...snapshot.childIds, branch.id] } : snapshot
          )),
        ],
      },
    })
  }

  createReviewNote(input: CreateReviewNoteInput): UgcLocalState {
    const now = this.now()
    const note: ReviewNote = {
      id: `note_${slug(input.attachedTo.kind)}_${slug(input.attachedTo.id)}_${Date.now().toString(36)}`,
      author: input.author ?? "arthur",
      createdAt: now,
      attachedTo: input.attachedTo,
      verdict: input.verdict,
      body: input.body,
      requestedChange: input.requestedChange ?? null,
      followUpActionId: null,
    }
    return this.#updateWorkspace((workspace) => {
      const candidates = workspace.candidates.map((candidate) => {
        if (input.attachedTo.kind !== "candidate" || candidate.id !== input.attachedTo.id) return candidate
        return { ...candidate, reviewNoteIds: [...candidate.reviewNoteIds, note.id] }
      })
      const personas = workspace.personas.map((persona) => {
        if (input.attachedTo.kind !== "persona" || persona.id !== input.attachedTo.id) return persona
        return { ...persona, notes: [...persona.notes, note.body] }
      })
      return {
        ...workspace,
        candidates,
        personas,
        reviewNotes: [note, ...workspace.reviewNotes],
      }
    })
  }

  createProviderJob(input: CreateProviderJobInput): UgcLocalState {
    const state = this.read()
    const now = this.now()
    const job: UgcProviderJob = {
      schemaVersion: "ugc-studio.provider-job.v1",
      id: `job_${input.provider}_${slug(input.operation)}_${Date.now().toString(36)}`,
      workspaceId: state.workspace.id,
      provider: input.provider,
      operation: input.operation,
      mode: input.mode ?? "dry-run",
      status: input.status ?? "planned",
      createdAt: now,
      updatedAt: now,
      targetIds: input.targetIds ?? [],
      spendCapUsd: input.spendCapUsd ?? 0.5,
      estimatedCostUsd: input.estimatedCostUsd ?? null,
      request: input.request,
      response: input.response ?? null,
      artifactPaths: input.artifactPaths ?? [],
      error: input.error ?? null,
    }
    return this.write({ ...state, providerJobs: [job, ...state.providerJobs] })
  }

  updateProviderJob(jobId: string, patch: ProviderJobPatch): UgcLocalState {
    const state = this.read()
    const now = this.now()
    const providerJobs = state.providerJobs.map((job) => {
      if (job.id !== jobId) return job
      return {
        ...job,
        status: patch.status ?? job.status,
        response: patch.response === undefined ? job.response : patch.response,
        artifactPaths: patch.artifactPaths ?? job.artifactPaths,
        error: patch.error === undefined ? job.error : patch.error,
        updatedAt: now,
      }
    })
    if (providerJobs.every((job, index) => job === state.providerJobs[index])) {
      throw new Error(`provider job not found: ${jobId}`)
    }
    return this.write({ ...state, providerJobs })
  }

  createReferenceArchive(input: CreateReferenceArchiveInput): UgcLocalState {
    const state = this.read()
    const existing = state.referenceArchives.find((archive) => archive.referenceProfileId === input.referenceProfileId)
    const referenceProfile = state.workspace.referenceProfiles.find((reference) => reference.id === input.referenceProfileId)
    if (!referenceProfile) throw new Error(`reference profile not found: ${input.referenceProfileId}`)
    const now = this.now()
    const defaultArchive = referenceProfileToArchive(state.workspace.id, referenceProfile, now)
    const archive: UgcReferenceArchive = {
      ...defaultArchive,
      ...existing,
      archiveStatus: input.archiveStatus ?? existing?.archiveStatus ?? defaultArchive.archiveStatus,
      sourcePolicy: input.sourcePolicy ?? existing?.sourcePolicy ?? defaultArchive.sourcePolicy,
      preservedMechanics: input.preservedMechanics ?? existing?.preservedMechanics ?? defaultArchive.preservedMechanics,
      sampleClipIds: existing?.sampleClipIds ?? defaultArchive.sampleClipIds,
      swappedFields: input.swappedFields ?? existing?.swappedFields ?? defaultArchive.swappedFields,
      blockedFields: input.blockedFields ?? existing?.blockedFields ?? defaultArchive.blockedFields,
      guardrails: input.guardrails ?? existing?.guardrails ?? defaultArchive.guardrails,
      candidateFormatOutputs: input.candidateFormatOutputs ?? existing?.candidateFormatOutputs ?? defaultArchive.candidateFormatOutputs,
      notes: input.notes ?? existing?.notes ?? [],
      catalogVideos: existing?.catalogVideos ?? defaultArchive.catalogVideos,
      updatedAt: now,
    }
    return this.write({
      ...state,
      referenceArchives: [archive, ...state.referenceArchives.filter((item) => item.id !== archive.id)],
    })
  }

  deleteReferenceArchive(archiveId: string): UgcLocalState {
    const state = this.read()
    const referenceArchives = state.referenceArchives.filter((archive) => archive.id !== archiveId && archive.referenceProfileId !== archiveId)
    if (referenceArchives.length === state.referenceArchives.length) {
      throw new Error(`reference archive not found: ${archiveId}`)
    }
    return this.write({ ...state, referenceArchives })
  }

  planReferenceCatalogImport(input: UgcReferenceCatalogImportInput = {}): UgcReferenceCatalogImportResult {
    return this.#createReferenceCatalogImportResult(input, true)
  }

  importReferenceCatalog(input: UgcReferenceCatalogImportInput = {}): UgcReferenceCatalogImportResult {
    return this.#createReferenceCatalogImportResult(input, false)
  }

  createResearchTarget(input: CreateResearchTargetInput): UgcLocalState {
    const state = this.read()
    const now = this.now()
    const target: UgcResearchTarget = {
      schemaVersion: "ugc-studio.research-target.v1",
      id: `research_${slug(input.niche)}_${Date.now().toString(36)}`,
      workspaceId: state.workspace.id,
      platform: input.platform ?? "tiktok",
      niche: input.niche,
      query: input.query,
      status: "queued",
      priority: input.priority ?? 3,
      sourcePolicy: input.sourcePolicy ?? "metadata-only",
      createdAt: now,
      updatedAt: now,
      templateJobIds: [],
      notes: input.notes ?? [],
    }
    return this.write({ ...state, researchTargets: [target, ...state.researchTargets] })
  }

  updateResearchTarget(targetId: string, patch: ResearchTargetPatch): UgcLocalState {
    const state = this.read()
    const now = this.now()
    const researchTargets = state.researchTargets.map((target) => {
      if (target.id !== targetId) return target
      return {
        ...target,
        status: patch.status ?? target.status,
        priority: patch.priority ?? target.priority,
        notes: patch.notes ?? target.notes,
        updatedAt: now,
      }
    })
    if (researchTargets.every((target, index) => target === state.researchTargets[index])) {
      throw new Error(`research target not found: ${targetId}`)
    }
    return this.write({ ...state, researchTargets })
  }

  createTemplateMiningJob(input: CreateTemplateMiningJobInput): UgcLocalState {
    const state = this.read()
    const target = state.researchTargets.find((item) => item.id === input.researchTargetId)
    if (!target) throw new Error(`research target not found: ${input.researchTargetId}`)
    const now = this.now()
    const templateSpec = input.templateSpec ?? createTemplateSpecFromTarget(target)
    const job: UgcTemplateMiningJob = {
      schemaVersion: "ugc-studio.template-mining-job.v1",
      id: `template_job_${slug(templateSpec.title)}_${Date.now().toString(36)}`,
      workspaceId: state.workspace.id,
      researchTargetId: input.researchTargetId,
      status: input.status ?? "planned",
      createdAt: now,
      updatedAt: now,
      templateSpec,
      candidateIds: input.candidateIds ?? [],
      error: null,
    }
    const researchTargets = state.researchTargets.map((item) => (
      item.id === target.id ? { ...item, templateJobIds: [...item.templateJobIds, job.id], updatedAt: now } : item
    ))
    return this.write({ ...state, researchTargets, templateMiningJobs: [job, ...state.templateMiningJobs] })
  }

  updateTemplateMiningJob(jobId: string, patch: TemplateMiningJobPatch): UgcLocalState {
    const state = this.read()
    const now = this.now()
    const templateMiningJobs = state.templateMiningJobs.map((job) => {
      if (job.id !== jobId) return job
      return {
        ...job,
        status: patch.status ?? job.status,
        templateSpec: patch.templateSpec ?? job.templateSpec,
        candidateIds: patch.candidateIds ?? job.candidateIds,
        error: patch.error === undefined ? job.error : patch.error,
        updatedAt: now,
      }
    })
    if (templateMiningJobs.every((job, index) => job === state.templateMiningJobs[index])) {
      throw new Error(`template mining job not found: ${jobId}`)
    }
    return this.write({ ...state, templateMiningJobs })
  }

  updateFinalEditor(patch: FinalEditorPatch): UgcLocalState {
    return this.#updateWorkspace((workspace) => {
      if (patch.selectedCandidateId && !candidateById(workspace, patch.selectedCandidateId)) {
        throw new Error(`candidate not found: ${patch.selectedCandidateId}`)
      }
      const trackUpdates = new Map((patch.trackUpdates ?? []).map((trackPatch) => [trackPatch.id, trackPatch]))
      const clipUpdates = new Map((patch.clipUpdates ?? []).map((clipPatch) => [`${clipPatch.trackId}::${clipPatch.clipId}`, clipPatch]))
      const seenTracks = new Set<string>()
      const seenClips = new Set<string>()
      const tracks = workspace.finalEditor.tracks.map((track) => {
        const trackPatch = trackUpdates.get(track.id)
        if (trackPatch) seenTracks.add(track.id)
        const clips = track.clips.map((clip) => {
          const clipKey = `${track.id}::${clip.id}`
          const clipPatch = clipUpdates.get(clipKey)
          if (!clipPatch) return clip
          seenClips.add(clipKey)
          return {
            ...clip,
            label: clipPatch.label ?? clip.label,
            startSeconds: clipPatch.startSeconds ?? clip.startSeconds,
            durationSeconds: clipPatch.durationSeconds ?? clip.durationSeconds,
            payloadJson: clipPatch.payloadJson ?? clip.payloadJson,
          }
        })
        return {
          ...track,
          visible: trackPatch?.visible ?? track.visible,
          locked: trackPatch?.locked ?? track.locked,
          clips,
        }
      })
      const missingTrackIds = [...trackUpdates.keys()].filter((id) => !seenTracks.has(id))
      if (missingTrackIds.length > 0) throw new Error(`editor track not found: ${missingTrackIds.join(", ")}`)
      const missingClipKeys = [...clipUpdates.keys()].filter((key) => !seenClips.has(key))
      if (missingClipKeys.length > 0) throw new Error(`editor clip not found: ${missingClipKeys.join(", ")}`)
      return {
        ...workspace,
        finalEditor: {
          ...workspace.finalEditor,
          selectedCandidateId: patch.selectedCandidateId ?? workspace.finalEditor.selectedCandidateId,
          tracks,
        },
      }
    })
  }

  createExportManifest(input: CreateExportManifestInput): UgcLocalState {
    const state = this.read()
    const now = this.now()
    const selectedCandidateId = input.selectedCandidateId ?? state.workspace.finalEditor.selectedCandidateId
    const selectedCandidate = candidateById(state.workspace, selectedCandidateId)
    if (!selectedCandidate) throw new Error(`candidate not found: ${selectedCandidateId}`)
    const presetId = input.presetId ?? state.workspace.finalEditor.exportPresets[0]?.id ?? "local"
    const manifest: UgcExportManifest = {
      schemaVersion: "ugc-studio.export-manifest.v1",
      id: `export_${slug(selectedCandidateId)}_${Date.now().toString(36)}`,
      workspaceId: state.workspace.id,
      label: input.label ?? `${selectedCandidate.title} export`,
      selectedCandidateId,
      presetId,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      timelineJson: input.timelineJson ?? toJsonValue(state.workspace.finalEditor),
      outputPath: null,
      notes: input.notes ?? [],
    }
    return this.write({ ...state, exportManifests: [manifest, ...state.exportManifests] })
  }

  exportWorkspaceBundle(input: CreateWorkspaceBundleInput = {}): UgcWorkspaceBundle {
    const state = this.read()
    const now = this.now()
    const label = input.label?.trim() || `${state.workspace.title} workspace bundle`
    const id = `bundle_${slug(state.workspace.id)}_${Date.now().toString(36)}`
    const bundle: UgcWorkspaceBundle = {
      schemaVersion: "ugc-studio.workspace-bundle.v1",
      id,
      workspaceId: state.workspace.id,
      label,
      exportedAt: now,
      sourceStateUpdatedAt: state.updatedAt,
      summary: summarizeLocalState(state),
      objectCounts: bundleObjectCounts(state),
      shardManifest: createShardManifest(state, this.config.workspaceDir, `bundles/${id}.json`),
      state: cloneStateForBundle(state),
    }
    writeJsonAtomic(resolve(this.config.workspaceDir, "bundles", `${bundle.id}.json`), bundle)
    return bundle
  }

  importWorkspaceBundle(input: ImportWorkspaceBundleInput): UgcWorkspaceBundleImportResult {
    const now = this.now()
    const errors: string[] = []
    const warnings: string[] = []
    const dryRun = input.dryRun !== false
    const bundle = decodeWorkspaceBundle(input.bundle)

    if (!bundle) {
      errors.push("Bundle must be a ugc-studio.workspace-bundle.v1 object with a valid local state payload.")
    }

    if (bundle && bundle.workspaceId !== bundle.state.workspace.id) {
      errors.push("Bundle workspaceId does not match state.workspace.id.")
    }

    if (bundle && bundle.state.schemaVersion !== "ugc-studio.local-state.v1") {
      errors.push("Bundle state schema is not ugc-studio.local-state.v1.")
    }

    if (bundle) {
      const validation = validateWorkspaceBundle(bundle)
      errors.push(...validation.errors)
      warnings.push(...validation.warnings)
    }

    if (bundle && bundle.state.workspace.id !== this.config.workspaceId) {
      errors.push(`Bundle workspace ${bundle.state.workspace.id} does not match current workspace ${this.config.workspaceId}.`)
    }

    const valid = errors.length === 0 && Boolean(bundle)
    const importedState = valid && !dryRun && bundle ? this.write(bundle.state) : null

    return {
      schemaVersion: "ugc-studio.workspace-bundle-import-result.v1",
      dryRun,
      valid,
      imported: Boolean(importedState),
      checkedAt: now,
      bundleId: bundle?.id ?? null,
      workspaceId: bundle?.workspaceId ?? null,
      errors,
      warnings,
      objectCounts: bundle?.objectCounts ?? null,
      importedState,
    }
  }

  #createReferenceCatalogImportResult(input: UgcReferenceCatalogImportInput, dryRun: boolean): UgcReferenceCatalogImportResult {
    const now = this.now()
    const roots = (input.roots && input.roots.length > 0 ? input.roots : DEFAULT_REFERENCE_CATALOG_ROOTS)
      .map((root) => normalizeRelativePath(this.config.cwd, root))
    const errors: string[] = []
    const warnings: string[] = []
    const groups = readReferenceCatalogGroups(this.config.cwd, roots, warnings)
    if (groups.length === 0) errors.push("Reference catalog import found no readable metadata records.")
    const state = this.read()
    const plannedState = applyReferenceCatalogGroups(state, groups, now)
    const providerJobIds = groups.map((group) => referenceCatalogProviderJobId(group.handle))
    const valid = errors.length === 0
    const importedState = valid && !dryRun ? this.write(plannedState) : null

    return {
      schemaVersion: "ugc-studio.reference-catalog-import-result.v1",
      dryRun,
      valid,
      imported: Boolean(importedState),
      checkedAt: now,
      roots,
      videosPlanned: groups.reduce((count, group) => count + group.videos.length, 0),
      referenceProfileIds: groups.map((group) => referenceCatalogProfileId(group.handle)),
      archiveIds: groups.map((group) => referenceCatalogArchiveId(group.handle)),
      providerJobIds,
      researchTargetIds: groups.map((group) => referenceCatalogResearchTargetId(group.handle)),
      templateMiningJobIds: groups.map((group) => referenceCatalogTemplateJobId(group.handle)),
      errors,
      warnings,
      state: importedState,
    }
  }

  #repairJsonArtifacts(state: UgcLocalState): void {
    if (!jsonFileMatches(this.config.statePath, state)) writeJsonAtomic(this.config.statePath, state)
    if (!workspaceShardsMatch(this.config.workspaceDir, state)) writeWorkspaceShards(this.config.workspaceDir, state)
  }

  #updateWorkspace(update: (workspace: UgcStudioWorkspace) => UgcStudioWorkspace): UgcLocalState {
    const state = this.read()
    return this.write({ ...state, workspace: update(state.workspace) })
  }
}

const DEFAULT_REFERENCE_CATALOG_ROOTS = [
  "data/tiktok-catalogue/pleometric",
  "data/tiktok-catalogue/mynameissico",
]

const REFERENCE_CATALOG_GUARDRAILS = [
  "Metadata-only local catalogue import; do not open, copy, upload, or reuse source media.",
  "Do not persist expiring CDN URLs, request headers, cookies, or format URLs from info JSON.",
  "Use only abstract mechanics, local path provenance, duration, engagement counts, and rewritten hooks.",
  "Replace creator identity, face, voice, exact captions, source pixels, brand marks, and audio.",
]

interface ReferenceCatalogGroup {
  readonly root: string
  readonly handle: string
  readonly displayName: string
  readonly lane: "brainrot" | "ugc-ads"
  readonly videos: readonly UgcReferenceCatalogVideo[]
}

function readReferenceCatalogGroups(cwd: string, roots: readonly string[], warnings: string[]): readonly ReferenceCatalogGroup[] {
  const groups: ReferenceCatalogGroup[] = []
  for (const root of roots) {
    const absoluteRoot = resolve(cwd, root)
    if (!existsSync(absoluteRoot)) {
      warnings.push(`Reference catalog root not found: ${root}`)
      continue
    }
    const handle = slug(basename(absoluteRoot)).replace(/_/g, "")
    let infoJsonNames: string[]
    try {
      infoJsonNames = readdirSync(absoluteRoot)
        .filter((fileName) => fileName.endsWith(".info.json"))
        .sort()
    } catch {
      warnings.push(`Reference catalog root is unreadable: ${root}`)
      continue
    }
    if (infoJsonNames.length === 0) {
      warnings.push(`Reference catalog root has no info JSON files: ${root}`)
      continue
    }
    const videos: UgcReferenceCatalogVideo[] = []
    for (const fileName of infoJsonNames) {
      const video = readReferenceCatalogVideo(cwd, root, absoluteRoot, fileName, handle, warnings)
      if (video) videos.push(video)
    }
    if (videos.length === 0) {
      warnings.push(`Reference catalog root produced no readable videos: ${root}`)
      continue
    }
    groups.push({
      root,
      handle,
      displayName: `@${handle}`,
      lane: handle === "pleometric" ? "brainrot" : "ugc-ads",
      videos,
    })
  }
  return groups
}

function readReferenceCatalogVideo(cwd: string, root: string, absoluteRoot: string, fileName: string, handle: string, warnings: string[]): UgcReferenceCatalogVideo | null {
  const infoJsonPath = resolve(absoluteRoot, fileName)
  const parsed = readJsonFile(infoJsonPath)
  if (!isRecord(parsed)) {
    warnings.push(`Reference catalog info JSON is unreadable: ${normalizeRelativePath(cwd, infoJsonPath)}`)
    return null
  }
  const stem = fileName.slice(0, -".info.json".length)
  const videoId = typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : stem.split("_").at(-1) ?? stem
  const referenceProfileId = referenceCatalogProfileId(handle)
  const mp4Path = normalizeRelativePath(cwd, resolve(absoluteRoot, `${stem}.mp4`))
  const posterPath = normalizeRelativePath(cwd, resolve(absoluteRoot, `${stem}.jpg`))
  const uploader = firstString(parsed.uploader, parsed.creator, parsed.channel, parsed.author, parsed.uploader_id) ?? `@${handle}`
  const metadataHandle = handleFromMetadata(handle, parsed)
  return {
    schemaVersion: "ugc-studio.reference-catalog-video.v1",
    id: referenceCatalogClipId(metadataHandle, videoId),
    referenceProfileId,
    videoId,
    catalogueRoot: root,
    uploader,
    handle: `@${metadataHandle}`,
    title: firstString(parsed.title, parsed.fulltitle, parsed.description) ?? `${metadataHandle} TikTok ${videoId}`,
    durationSeconds: firstFiniteNumber(parsed.duration, parsed.duration_seconds),
    engagement: {
      views: firstFiniteNumber(parsed.view_count, parsed.play_count),
      likes: firstFiniteNumber(parsed.like_count, parsed.digg_count),
      comments: firstFiniteNumber(parsed.comment_count),
      shares: firstFiniteNumber(parsed.share_count, parsed.repost_count),
      saves: firstFiniteNumber(parsed.save_count, parsed.collect_count),
    },
    paths: {
      mp4: existsSync(resolve(absoluteRoot, `${stem}.mp4`)) ? mp4Path : null,
      infoJson: normalizeRelativePath(cwd, infoJsonPath),
      poster: existsSync(resolve(absoluteRoot, `${stem}.jpg`)) ? posterPath : null,
    },
    sourcePolicy: "metadata-only",
    guardrails: REFERENCE_CATALOG_GUARDRAILS,
  }
}

function applyReferenceCatalogGroups(state: UgcLocalState, groups: readonly ReferenceCatalogGroup[], now: string): UgcLocalState {
  if (groups.length === 0) return state
  const referenceProfiles = upsertById(state.workspace.referenceProfiles, groups.map((group) => referenceCatalogProfile(state.workspace.id, group)))
  const archives = upsertById(state.referenceArchives, groups.map((group) => referenceCatalogArchive(state.workspace.id, group, now)))
  const researchTargets = upsertById(state.researchTargets, groups.map((group) => referenceCatalogResearchTarget(state.workspace.id, group, now)))
  const templateMiningJobs = upsertById(state.templateMiningJobs, groups.map((group) => referenceCatalogTemplateJob(state.workspace.id, group, now)))
  const providerJobs = upsertById(state.providerJobs, groups.map((group) => referenceCatalogProviderJob(state.workspace.id, group, now)))
  return {
    ...state,
    workspace: {
      ...state.workspace,
      referenceProfiles,
    },
    referenceArchives: archives,
    researchTargets,
    templateMiningJobs,
    providerJobs,
  }
}

function referenceCatalogProfile(workspaceId: string, group: ReferenceCatalogGroup): ReferenceProfile {
  const referenceProfileId = referenceCatalogProfileId(group.handle)
  return {
    id: referenceProfileId,
    platform: "tiktok",
    handle: `@${group.handle}`,
    displayName: `${group.displayName} local ${group.lane === "brainrot" ? "brainrot" : "UGC ads"} catalogue`,
    rightsStatus: "public-research-target",
    archiveStatus: "sampled",
    styleLane: group.lane,
    useCase: group.lane === "brainrot"
      ? "Brainrot creation mechanics mined from local TikTok metadata."
      : "UGC ads mechanics mined from local TikTok metadata.",
    cleanRoomBoundary: REFERENCE_CATALOG_GUARDRAILS,
    sampleClips: group.videos.map((video) => ({
      id: video.id,
      title: video.title,
      sourceUrl: null,
      durationSeconds: video.durationSeconds ?? 0,
      storagePolicy: "store-metadata-only",
      extractedFields: [
        "local mp4 path",
        "info JSON path",
        "poster path",
        "duration",
        "engagement counts",
        "title",
      ],
    })),
    extractedMechanics: {
      poseTiming: "Derive timing only from metadata and later clean-room review; no source pixels are reused.",
      gestureRhythm: "Catalogue import preserves high-level pacing and engagement signals only.",
      shotStructure: [`workspace:${workspaceId}`, `lane:${group.lane}`, "metadata-only reference catalogue"],
      captionTemplate: "Rewrite all captions; imported titles are research labels, not reusable copy.",
      hookFamilies: group.lane === "brainrot"
        ? ["absurd contrast hook", "rapid curiosity loop", "format escalation"]
        : ["problem proof hook", "routine insert", "product payoff"],
      ctaPatterns: group.lane === "brainrot" ? ["non-ad retention loop"] : ["soft product CTA", "proof-led CTA"],
      nonAdPatterns: ["no source identity cloning", "no exact caption reuse", "no media reuse"],
    },
    remixFields: [
      {
        id: `remix_field_${group.handle}_metadata_timing`,
        label: "Metadata timing",
        mode: "abstract",
        sourceField: "reference.catalogVideos.durationSeconds",
        targetField: "candidate.recipe.editCadence",
        rationale: "Use duration distribution as a high-level editing constraint only.",
        confidence: 0.72,
      },
      {
        id: `remix_field_${group.handle}_creator_identity`,
        label: "Creator identity",
        mode: "blocked",
        sourceField: "reference.creatorIdentity",
        targetField: "persona.identity",
        rationale: "Reference creators remain research sources and are never copied.",
        confidence: 1,
      },
      {
        id: `remix_field_${group.handle}_local_media`,
        label: "Local source media",
        mode: "blocked",
        sourceField: "reference.catalogVideos.paths.mp4",
        targetField: "candidate.rawMedia",
        rationale: "Local mp4 paths prove provenance but are not opened or reused by catalog import.",
        confidence: 1,
      },
    ],
  }
}

function referenceCatalogArchive(workspaceId: string, group: ReferenceCatalogGroup, now: string): UgcReferenceArchive {
  const referenceProfileId = referenceCatalogProfileId(group.handle)
  return {
    schemaVersion: "ugc-studio.reference-archive.v1",
    id: referenceCatalogArchiveId(group.handle),
    workspaceId,
    referenceProfileId,
    title: `${group.displayName} clean-room ${group.lane} archive`,
    rightsStatus: "public-research-target",
    archiveStatus: "sampled",
    createdAt: now,
    updatedAt: now,
    sourcePolicy: "metadata-only",
    preservedMechanics: toJsonValue({
      lane: group.lane,
      videos: group.videos.length,
      durationSeconds: summarizeNullableNumbers(group.videos.map((video) => video.durationSeconds)),
      views: summarizeNullableNumbers(group.videos.map((video) => video.engagement.views)),
      catalogueRoots: [group.root],
      importedFields: ["mp4 path", "infoJson path", "poster path", "uploader", "handle", "title", "duration", "engagement counts"],
      excludedFields: ["formats", "formats.url", "url", "webpage_url", "http_headers", "cookies"],
    }),
    sampleClipIds: group.videos.map((video) => video.id),
    swappedFields: ["creator identity", "voice", "exact captions", "product", "CTA"],
    blockedFields: ["source pixels", "source audio", "source face", "expiring CDN URLs", "headers", "cookies", "formats[].url"],
    guardrails: REFERENCE_CATALOG_GUARDRAILS,
    candidateFormatOutputs: [
      {
        id: `format_${referenceProfileId}_metadata_template`,
        title: `${group.displayName} ${group.lane} metadata template`,
        kind: "format-template",
        summary: "Use local catalogue metadata to plan clean-room timing, hook families, and review targets without opening media files.",
        stageIds: ["stage_reference_profile", "stage_edit_style", "stage_hook"],
        candidateIds: [],
        manifestJson: toJsonValue({
          lane: group.lane,
          videoIds: group.videos.map((video) => video.videoId),
          localAssetPaths: group.videos.map((video) => video.paths),
        }),
      },
    ],
    notes: ["Seeded from local TikTok catalogue metadata only."],
    catalogVideos: group.videos,
  }
}

function referenceCatalogResearchTarget(workspaceId: string, group: ReferenceCatalogGroup, now: string): UgcResearchTarget {
  return {
    schemaVersion: "ugc-studio.research-target.v1",
    id: referenceCatalogResearchTargetId(group.handle),
    workspaceId,
    platform: "tiktok",
    niche: group.lane === "brainrot" ? "brainrot creation reference mechanics" : "UGC ads reference mechanics",
    query: `${group.displayName} local TikTok catalogue metadata clean-room ${group.lane} mechanics`,
    status: "decomposed",
    priority: group.lane === "brainrot" ? 1 : 2,
    sourcePolicy: "metadata-only",
    createdAt: now,
    updatedAt: now,
    templateJobIds: [referenceCatalogTemplateJobId(group.handle)],
    notes: [`Local metadata import from ${group.root}; no live scraping or media reads.`],
  }
}

function referenceCatalogTemplateJob(workspaceId: string, group: ReferenceCatalogGroup, now: string): UgcTemplateMiningJob {
  return {
    schemaVersion: "ugc-studio.template-mining-job.v1",
    id: referenceCatalogTemplateJobId(group.handle),
    workspaceId,
    researchTargetId: referenceCatalogResearchTargetId(group.handle),
    status: "ready",
    createdAt: now,
    updatedAt: now,
    templateSpec: {
      schemaVersion: "ugc-studio.clean-room-template.v1",
      id: `template_${group.handle}_reference_catalog`,
      title: `${group.displayName} ${group.lane} clean-room template`,
      category: group.lane === "brainrot" ? "format" : "hook",
      preservedMechanics: toJsonValue({
        lane: group.lane,
        sourcePolicy: "metadata-only",
        catalogueRoot: group.root,
        videoCount: group.videos.length,
        engagement: summarizeNullableNumbers(group.videos.map((video) => video.engagement.views)),
      }),
      swapSlots: ["synthetic persona", "product", "hook copy", "caption copy", "voice", "CTA"],
      blockedFields: ["source face", "source voice", "exact captions", "source pixels", "source audio", "brand marks"],
      proofNotes: REFERENCE_CATALOG_GUARDRAILS,
    },
    candidateIds: [],
    error: null,
  }
}

function referenceCatalogProviderJob(workspaceId: string, group: ReferenceCatalogGroup, now: string): UgcProviderJob {
  return {
    schemaVersion: "ugc-studio.provider-job.v1",
    id: referenceCatalogProviderJobId(group.handle),
    workspaceId,
    provider: "local",
    operation: "reference-catalog-import",
    mode: "dry-run",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    targetIds: [referenceCatalogProfileId(group.handle), referenceCatalogArchiveId(group.handle)],
    spendCapUsd: 0,
    estimatedCostUsd: 0,
    request: toJsonValue({
      sourcePolicy: "metadata-only",
      lane: group.lane,
      catalogueRoot: group.root,
      videoCount: group.videos.length,
      videos: group.videos.map((video) => ({
        id: video.id,
        videoId: video.videoId,
        uploader: video.uploader,
        handle: video.handle,
        title: video.title,
        durationSeconds: video.durationSeconds,
        engagement: video.engagement,
        paths: video.paths,
        sourcePolicy: video.sourcePolicy,
        guardrails: video.guardrails,
      })),
      excludedFields: ["formats", "formats.url", "url", "webpage_url", "http_headers", "cookies"],
    }),
    response: null,
    artifactPaths: group.videos.flatMap((video) => [video.paths.infoJson, video.paths.poster, video.paths.mp4].filter(isString)),
    error: null,
  }
}

function referenceCatalogProfileId(handle: string): string {
  return `reference_tiktok_${slug(handle)}`
}

function referenceCatalogArchiveId(handle: string): string {
  return `archive_${referenceCatalogProfileId(handle)}`
}

function referenceCatalogClipId(handle: string, videoId: string): string {
  return `clip_${slug(handle)}_${slug(videoId)}`
}

function referenceCatalogResearchTargetId(handle: string): string {
  return `research_tiktok_${slug(handle)}_reference_catalog`
}

function referenceCatalogTemplateJobId(handle: string): string {
  return `template_job_tiktok_${slug(handle)}_reference_catalog`
}

function referenceCatalogProviderJobId(handle: string): string {
  return `job_local_reference_catalog_import_${slug(handle)}`
}

function upsertById<T extends { readonly id: string }>(existing: readonly T[], incoming: readonly T[]): readonly T[] {
  const incomingIds = new Set(incoming.map((item) => item.id))
  return [...incoming, ...existing.filter((item) => !incomingIds.has(item.id))]
}

function normalizeRelativePath(cwd: string, path: string): string {
  const absolute = resolve(cwd, path)
  const relativePath = relative(cwd, absolute)
  return relativePath.startsWith("..") ? absolute : relativePath || "."
}

function handleFromMetadata(fallback: string, metadata: { readonly [key: string]: JsonValue }): string {
  const raw = firstString(metadata.uploader_id, metadata.channel_id, metadata.uploader, metadata.channel, metadata.creator, metadata.author) ?? fallback
  return slug(raw.replace(/^@/, "")).replace(/_/g, "") || fallback
}

function firstString(...values: readonly (JsonValue | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
  }
  return null
}

function firstFiniteNumber(...values: readonly (JsonValue | undefined)[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function summarizeNullableNumbers(values: readonly (number | null)[]): JsonValue {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (numbers.length === 0) return { count: 0, min: null, max: null, average: null }
  const total = numbers.reduce((sum, value) => sum + value, 0)
  return {
    count: numbers.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    average: Math.round((total / numbers.length) * 100) / 100,
  }
}

function isString(value: string | null): value is string {
  return typeof value === "string"
}

function patchPersona(persona: PersonaProfile, patch: PersonaPatch): PersonaProfile {
  return {
    ...persona,
    status: patch.status ?? persona.status,
    notes: patch.notes ?? persona.notes,
    avatarPrompt: patch.avatarPrompt ?? persona.avatarPrompt,
    genreLane: patch.genreLane ?? persona.genreLane,
    voice: { ...persona.voice, ...patch.voice },
    profileBible: { ...persona.profileBible, ...patch.profileBible },
    continuity: patch.continuityManifest === undefined
      ? persona.continuity
      : { ...persona.continuity, jsonManifest: patch.continuityManifest },
  }
}

function createTemplateSpecFromTarget(target: UgcResearchTarget): CleanRoomTemplateSpec {
  return {
    schemaVersion: "ugc-studio.clean-room-template.v1",
    id: `template_${slug(target.niche)}`,
    title: `${target.niche} clean-room template`,
    category: "format",
    preservedMechanics: {
      query: target.query,
      sourcePolicy: target.sourcePolicy,
      extractionGoal: "Preserve abstract timing, structure, caption grammar, and CTA pattern only.",
    },
    swapSlots: ["synthetic persona", "product", "hook copy", "caption copy", "voice", "CTA"],
    blockedFields: ["source face", "source voice", "exact captions", "source pixels", "brand marks"],
    proofNotes: target.notes.length > 0 ? target.notes : ["Queued from local research target. No live scraping performed."],
  }
}

function stampState(state: UgcLocalState, now: string): UgcLocalState {
  return {
    ...state,
    workspace: { ...state.workspace, updatedAt: now },
    updatedAt: now,
  }
}

function stateUpdatedAfter(candidate: UgcLocalState, baseline: UgcLocalState): boolean {
  const candidateTime = Date.parse(candidate.updatedAt)
  const baselineTime = Date.parse(baseline.updatedAt)
  return Number.isFinite(candidateTime) && Number.isFinite(baselineTime) && candidateTime > baselineTime
}

function normalizeLocalState(state: UgcLocalState): UgcLocalState {
  const legacyState = state as UgcLocalState & {
    readonly researchTargets?: readonly UgcResearchTarget[]
    readonly templateMiningJobs?: readonly UgcTemplateMiningJob[]
  }
  const referenceArchives = state.workspace.referenceProfiles.map((referenceProfile) => {
    const defaultArchive = referenceProfileToArchive(state.workspace.id, referenceProfile, state.updatedAt)
    const existing = state.referenceArchives.find((archive) => archive.referenceProfileId === referenceProfile.id)
    return existing
      ? {
          ...defaultArchive,
          ...existing,
          sampleClipIds: existing.sampleClipIds ?? defaultArchive.sampleClipIds,
          candidateFormatOutputs: existing.candidateFormatOutputs ?? defaultArchive.candidateFormatOutputs,
          notes: existing.notes ?? defaultArchive.notes,
          catalogVideos: existing.catalogVideos ?? defaultArchive.catalogVideos,
        }
      : defaultArchive
  })
  const orphanArchives = state.referenceArchives.filter((archive) => (
    !state.workspace.referenceProfiles.some((referenceProfile) => referenceProfile.id === archive.referenceProfileId)
  ))
  return {
    ...state,
    referenceArchives: [...referenceArchives, ...orphanArchives],
    researchTargets: legacyState.researchTargets ?? createInitialResearchTargets(state.workspace.id, state.updatedAt),
    templateMiningJobs: legacyState.templateMiningJobs ?? createInitialTemplateMiningJobs(state.workspace.id, state.updatedAt),
  }
}

function writeWorkspaceShards(workspaceDir: string, state: UgcLocalState): void {
  writeJsonAtomic(resolve(workspaceDir, "workspace.json"), state.workspace)
  writeCollection(resolve(workspaceDir, "personas"), state.workspace.personas)
  writeCollection(resolve(workspaceDir, "campaigns"), [state.workspace.productBrief])
  writeCollection(resolve(workspaceDir, "reference-profiles"), state.workspace.referenceProfiles)
  writeCollection(resolve(workspaceDir, "branches"), state.workspace.branchSnapshots)
  writeCollection(resolve(workspaceDir, "candidates"), state.workspace.candidates)
  writeCollection(resolve(workspaceDir, "notes"), state.workspace.reviewNotes)
  writeCollection(resolve(workspaceDir, "provider-jobs"), state.providerJobs)
  writeCollection(resolve(workspaceDir, "reference-archives"), state.referenceArchives)
  writeCollection(resolve(workspaceDir, "exports"), state.exportManifests)
  writeCollection(resolve(workspaceDir, "research-targets"), state.researchTargets)
  writeCollection(resolve(workspaceDir, "template-mining-jobs"), state.templateMiningJobs)
  mkdirSync(resolve(workspaceDir, "assets/source"), { recursive: true })
  mkdirSync(resolve(workspaceDir, "assets/generated"), { recursive: true })
  mkdirSync(resolve(workspaceDir, "assets/exports"), { recursive: true })
  mkdirSync(resolve(workspaceDir, "bundles"), { recursive: true })
}

function writeCollection<T extends { readonly id: string }>(dir: string, records: readonly T[]): void {
  mkdirSync(dir, { recursive: true })
  const expectedFiles = new Set(records.map((record) => `${record.id}.json`))
  for (const fileName of readdirSync(dir)) {
    if (fileName.endsWith(".json") && !expectedFiles.has(fileName)) rmSync(resolve(dir, fileName), { force: true })
  }
  for (const record of records) writeJsonAtomic(resolve(dir, `${record.id}.json`), record)
}

function workspaceShardsMatch(workspaceDir: string, state: UgcLocalState): boolean {
  return jsonFileMatches(resolve(workspaceDir, "workspace.json"), state.workspace)
    && collectionMatches(resolve(workspaceDir, "personas"), state.workspace.personas)
    && collectionMatches(resolve(workspaceDir, "campaigns"), [state.workspace.productBrief])
    && collectionMatches(resolve(workspaceDir, "reference-profiles"), state.workspace.referenceProfiles)
    && collectionMatches(resolve(workspaceDir, "branches"), state.workspace.branchSnapshots)
    && collectionMatches(resolve(workspaceDir, "candidates"), state.workspace.candidates)
    && collectionMatches(resolve(workspaceDir, "notes"), state.workspace.reviewNotes)
    && collectionMatches(resolve(workspaceDir, "provider-jobs"), state.providerJobs)
    && collectionMatches(resolve(workspaceDir, "reference-archives"), state.referenceArchives)
    && collectionMatches(resolve(workspaceDir, "exports"), state.exportManifests)
    && collectionMatches(resolve(workspaceDir, "research-targets"), state.researchTargets)
    && collectionMatches(resolve(workspaceDir, "template-mining-jobs"), state.templateMiningJobs)
    && requiredWorkspaceDirsExist(workspaceDir)
}

function requiredWorkspaceDirsExist(workspaceDir: string): boolean {
  return existsSync(resolve(workspaceDir, "assets/source"))
    && existsSync(resolve(workspaceDir, "assets/generated"))
    && existsSync(resolve(workspaceDir, "assets/exports"))
    && existsSync(resolve(workspaceDir, "bundles"))
}

function collectionMatches<T extends { readonly id: string }>(dir: string, records: readonly T[]): boolean {
  if (!existsSync(dir)) return false
  const expectedFiles = new Set(records.map((record) => `${record.id}.json`))
  for (const fileName of readdirSync(dir)) {
    if (fileName.endsWith(".json") && !expectedFiles.has(fileName)) return false
  }
  return records.every((record) => jsonFileMatches(resolve(dir, `${record.id}.json`), record))
}

function jsonFileMatches(path: string, value: JsonSerializable): boolean {
  const existing = readJsonFile(path)
  return existing !== null && JSON.stringify(existing) === JSON.stringify(value)
}

function readJsonFile(path: string): JsonValue | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonValue
  } catch {
    return null
  }
}

function writeJsonAtomic(path: string, value: JsonSerializable): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tmpPath, path)
}

function findProjectRoot(start: string): string {
  let current = resolve(start)
  while (current !== dirname(current)) {
    if (existsSync(resolve(current, "package.json")) && existsSync(resolve(current, "apps/slotok-workbench"))) {
      return current
    }
    current = dirname(current)
  }
  return resolve(start)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item"
}

function bundleObjectCounts(state: UgcLocalState): UgcWorkspaceBundleObjectCounts {
  return {
    personas: state.workspace.personas.length,
    referenceProfiles: state.workspace.referenceProfiles.length,
    branches: state.workspace.branchSnapshots.length,
    candidates: state.workspace.candidates.length,
    notes: state.workspace.reviewNotes.length,
    providerJobs: state.providerJobs.length,
    referenceArchives: state.referenceArchives.length,
    exportManifests: state.exportManifests.length,
    researchTargets: state.researchTargets.length,
    templateMiningJobs: state.templateMiningJobs.length,
  }
}

function createShardManifest(state: UgcLocalState, workspaceDir: string, currentBundlePath: string): UgcWorkspaceBundleShardManifest {
  const bundlePaths = new Set([...listJsonFiles(resolve(workspaceDir, "bundles"), "bundles"), currentBundlePath])
  return {
    workspace: "workspace.json",
    collections: {
      personas: state.workspace.personas.map((item) => `personas/${item.id}.json`),
      campaigns: [`campaigns/${state.workspace.productBrief.id}.json`],
      referenceProfiles: state.workspace.referenceProfiles.map((item) => `reference-profiles/${item.id}.json`),
      branches: state.workspace.branchSnapshots.map((item) => `branches/${item.id}.json`),
      candidates: state.workspace.candidates.map((item) => `candidates/${item.id}.json`),
      notes: state.workspace.reviewNotes.map((item) => `notes/${item.id}.json`),
      providerJobs: state.providerJobs.map((item) => `provider-jobs/${item.id}.json`),
      referenceArchives: state.referenceArchives.map((item) => `reference-archives/${item.id}.json`),
      exports: state.exportManifests.map((item) => `exports/${item.id}.json`),
      researchTargets: state.researchTargets.map((item) => `research-targets/${item.id}.json`),
      templateMiningJobs: state.templateMiningJobs.map((item) => `template-mining-jobs/${item.id}.json`),
      bundles: [...bundlePaths].sort(),
    },
    assets: {
      source: "assets/source",
      generated: "assets/generated",
      exports: "assets/exports",
    },
    localAssets: {
      source: listFilesRecursive(resolve(workspaceDir, "assets/source"), "assets/source"),
      generated: listFilesRecursive(resolve(workspaceDir, "assets/generated"), "assets/generated"),
      exports: listFilesRecursive(resolve(workspaceDir, "assets/exports"), "assets/exports"),
      referenceCatalog: referenceCatalogAssetPaths(state),
    },
  }
}

function listJsonFiles(dir: string, relativePrefix: string): readonly string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `${relativePrefix}/${entry.name}`)
    .sort()
}

function listFilesRecursive(dir: string, relativePrefix: string): readonly string[] {
  if (!existsSync(dir)) return []
  const paths: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relativePath = `${relativePrefix}/${entry.name}`
    const absolutePath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      paths.push(...listFilesRecursive(absolutePath, relativePath))
    } else if (entry.isFile()) {
      paths.push(relativePath)
    }
  }
  return paths.sort()
}

function referenceCatalogAssetPaths(state: UgcLocalState): readonly string[] {
  const paths = new Set<string>()
  for (const archive of state.referenceArchives) {
    const catalogVideos = archive.catalogVideos ?? []
    for (const video of catalogVideos) {
      paths.add(video.paths.infoJson)
      if (video.paths.poster) paths.add(video.paths.poster)
      if (video.paths.mp4) paths.add(video.paths.mp4)
    }
  }
  return [...paths].sort()
}

function cloneStateForBundle(state: UgcLocalState): UgcLocalState {
  return JSON.parse(JSON.stringify(state)) as UgcLocalState
}

function decodeWorkspaceBundle(value: JsonValue | UgcWorkspaceBundle): UgcWorkspaceBundle | null {
  if (!isRecord(value) || value.schemaVersion !== "ugc-studio.workspace-bundle.v1") return null
  if (typeof value.id !== "string" || typeof value.workspaceId !== "string" || typeof value.label !== "string") return null
  if (typeof value.exportedAt !== "string" || typeof value.sourceStateUpdatedAt !== "string") return null
  if (!isLocalState(value.state)) return null
  if (!isObjectCounts(value.objectCounts) || !isShardManifest(value.shardManifest)) return null
  return {
    schemaVersion: "ugc-studio.workspace-bundle.v1",
    id: value.id,
    workspaceId: value.workspaceId,
    label: value.label,
    exportedAt: value.exportedAt,
    sourceStateUpdatedAt: value.sourceStateUpdatedAt,
    summary: summarizeLocalState(value.state),
    objectCounts: value.objectCounts,
    shardManifest: value.shardManifest,
    state: value.state,
  }
}

function validateWorkspaceBundle(bundle: UgcWorkspaceBundle): { readonly errors: readonly string[]; readonly warnings: readonly string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const expectedCounts = bundleObjectCounts(bundle.state)
  for (const key of Object.keys(expectedCounts) as readonly (keyof UgcWorkspaceBundleObjectCounts)[]) {
    if (bundle.objectCounts[key] !== expectedCounts[key]) {
      errors.push(`Bundle objectCounts.${key} does not match state payload.`)
    }
  }
  if (bundle.shardManifest.collections.referenceProfiles.length !== bundle.state.workspace.referenceProfiles.length) {
    errors.push("Bundle shardManifest.collections.referenceProfiles does not match state payload.")
  }
  const expectedReferenceAssets = referenceCatalogAssetPaths(bundle.state)
  if (JSON.stringify(bundle.shardManifest.localAssets.referenceCatalog) !== JSON.stringify(expectedReferenceAssets)) {
    errors.push("Bundle localAssets.referenceCatalog does not match reference archive local paths.")
  }
  const blockedRemoteAsset = bundle.shardManifest.localAssets.referenceCatalog.find((path) => path.startsWith("http://") || path.startsWith("https://"))
  if (blockedRemoteAsset) {
    errors.push(`Bundle reference catalog asset must be local, got ${blockedRemoteAsset}.`)
  }
  for (const archive of bundle.state.referenceArchives) {
    const catalogVideos = archive.catalogVideos ?? []
    for (const video of catalogVideos) {
      if (video.sourcePolicy !== "metadata-only") errors.push(`Reference catalog video ${video.id} must be metadata-only.`)
      if (video.paths.infoJson.startsWith("http://") || video.paths.infoJson.startsWith("https://")) {
        errors.push(`Reference catalog video ${video.id} infoJson path must be local.`)
      }
      if (video.paths.mp4 && (video.paths.mp4.startsWith("http://") || video.paths.mp4.startsWith("https://"))) {
        errors.push(`Reference catalog video ${video.id} mp4 path must be local.`)
      }
      if (video.paths.poster && (video.paths.poster.startsWith("http://") || video.paths.poster.startsWith("https://"))) {
        errors.push(`Reference catalog video ${video.id} poster path must be local.`)
      }
    }
  }
  if (bundle.shardManifest.localAssets.source.length === 0) warnings.push("Bundle has no workspace source asset files.")
  return { errors, warnings }
}

function isObjectCounts(value: unknown): value is UgcWorkspaceBundleObjectCounts {
  if (!isRecord(value)) return false
  return typeof value.personas === "number"
    && typeof value.referenceProfiles === "number"
    && typeof value.branches === "number"
    && typeof value.candidates === "number"
    && typeof value.notes === "number"
    && typeof value.providerJobs === "number"
    && typeof value.referenceArchives === "number"
    && typeof value.exportManifests === "number"
    && typeof value.researchTargets === "number"
    && typeof value.templateMiningJobs === "number"
}

function isShardManifest(value: unknown): value is UgcWorkspaceBundleShardManifest {
  if (!isRecord(value) || typeof value.workspace !== "string" || !isRecord(value.collections) || !isRecord(value.assets) || !isRecord(value.localAssets)) return false
  return isStringArray(value.collections.personas)
    && isStringArray(value.collections.campaigns)
    && isStringArray(value.collections.referenceProfiles)
    && isStringArray(value.collections.branches)
    && isStringArray(value.collections.candidates)
    && isStringArray(value.collections.notes)
    && isStringArray(value.collections.providerJobs)
    && isStringArray(value.collections.referenceArchives)
    && isStringArray(value.collections.exports)
    && isStringArray(value.collections.researchTargets)
    && isStringArray(value.collections.templateMiningJobs)
    && isStringArray(value.collections.bundles)
    && typeof value.assets.source === "string"
    && typeof value.assets.generated === "string"
    && typeof value.assets.exports === "string"
    && isStringArray(value.localAssets.source)
    && isStringArray(value.localAssets.generated)
    && isStringArray(value.localAssets.exports)
    && isStringArray(value.localAssets.referenceCatalog)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}
