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
  type AppendWorkflowEventInput,
  type CreateBranchInput,
  type CreateExportManifestInput,
  type CreateProviderJobInput,
  type CreateReferenceArchiveInput,
  type CreateResearchTargetInput,
  type CreateReviewNoteInput,
  type CreateTemplateMiningJobInput,
  type CreateWorkflowRunInput,
  type CreateWorkspaceBundleInput,
  type FinalEditorPatch,
  type ImportWorkspaceBundleInput,
  type UgcReferenceCatalogImportInput,
  type UgcReferenceCatalogImportResult,
  type UgcReferenceCatalogVideo,
  type UgcReferenceManifestAsset,
  type PersonaPatch,
  type ProviderJobPatch,
  type ResearchTargetPatch,
  type TemplateMiningJobPatch,
  type UgcWorkflowEvent,
  type UgcWorkflowEventType,
  type UgcExportManifest,
  type UgcLocalState,
  type UgcProviderJob,
  type UgcReferenceArchive,
  type UgcResearchTarget,
  type UgcTemplateMiningJob,
  type UgcWorkflowRun,
  type UgcWorkflowRunStatus,
  type UgcWorkspaceBundle,
  type UgcWorkspaceBundleImportResult,
  type UgcWorkspaceBundleObjectCounts,
  type UgcWorkspaceBundleShardManifest,
  type WorkflowRunPatch,
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
    const normalizedSqliteState = sqliteState ? normalizeLocalState(sqliteState) : null
    const existing = readJsonFile(this.config.statePath)
    const jsonState = isLocalState(existing) ? normalizeLocalState(existing) : null

    if (normalizedSqliteState && jsonState && stateUpdatedAfter(jsonState, normalizedSqliteState)) {
      return this.write(jsonState)
    }

    if (normalizedSqliteState) {
      this.#repairJsonArtifacts(normalizedSqliteState)
      return normalizedSqliteState
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
      referenceAssets: existing?.referenceAssets ?? defaultArchive.referenceAssets,
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

  listWorkflowRuns(): readonly UgcWorkflowRun[] {
    const state = this.read()
    return state.workflowRuns.map((run) => summarizeWorkflowRun(run, state.workflowEvents.filter((event) => event.runId === run.id)))
  }

  listWorkflowEvents(runId: string, afterEventId = 0): readonly UgcWorkflowEvent[] {
    const state = this.read()
    if (!state.workflowRuns.some((run) => run.id === runId)) throw new Error(`workflow run not found: ${runId}`)
    return state.workflowEvents
      .filter((event) => event.runId === runId && event.eventId > afterEventId)
      .sort((left, right) => left.eventId - right.eventId)
  }

  listWorkflowEventsAfter(afterEventId = 0): readonly UgcWorkflowEvent[] {
    return this.read().workflowEvents
      .filter((event) => event.eventId > afterEventId)
      .sort((left, right) => left.eventId - right.eventId)
  }

  createWorkflowRun(input: CreateWorkflowRunInput): UgcWorkflowRun {
    const state = this.read()
    const now = this.now()
    const title = input.title.trim() || "Workflow run"
    const run: UgcWorkflowRun = {
      schemaVersion: "ugc-studio.workflow-run.v1",
      id: `workflow_${input.source ?? "slotok"}_${slug(title)}_${Date.now().toString(36)}`,
      workspaceId: state.workspace.id,
      lane: input.lane?.trim() || "default",
      status: input.status ?? "queued",
      title,
      source: input.source ?? "slotok",
      scriptId: input.scriptId ?? null,
      args: sanitizeWorkflowJsonValue(input.args ?? null),
      result: null,
      error: null,
      currentPhase: input.currentPhase ?? null,
      counters: input.counters ?? {},
      importedRecordIds: input.importedRecordIds ?? [],
      artifactPaths: input.artifactPaths ?? [],
      createdAt: now,
      updatedAt: now,
    }
    const event: UgcWorkflowEvent = {
      schemaVersion: "ugc-studio.workflow-event.v1",
      eventId: nextWorkflowEventId(state),
      runId: run.id,
      type: "created",
      phase: run.currentPhase,
      agentLabel: null,
      message: `Created ${run.title}`,
      payload: { status: run.status },
      artifactPaths: run.artifactPaths,
      error: null,
      createdAt: now,
    }
    const summarized = summarizeWorkflowRun(run, [event])
    this.write({
      ...state,
      workflowRuns: [summarized, ...state.workflowRuns],
      workflowEvents: [...state.workflowEvents, event],
    })
    return summarized
  }

  appendWorkflowEvent(runId: string, input: AppendWorkflowEventInput): UgcWorkflowEvent {
    const state = this.read()
    const run = state.workflowRuns.find((item) => item.id === runId)
    if (!run) throw new Error(`workflow run not found: ${runId}`)
    const now = this.now()
    const event: UgcWorkflowEvent = {
      schemaVersion: "ugc-studio.workflow-event.v1",
      eventId: nextWorkflowEventId(state),
      runId,
      type: input.type,
      phase: input.phase ?? null,
      agentLabel: input.agentLabel ?? null,
      message: input.message ?? null,
      payload: input.payload === undefined ? null : sanitizeWorkflowJsonValue(input.payload),
      artifactPaths: input.artifactPaths ?? [],
      error: input.error ?? null,
      createdAt: now,
    }
    const workflowEvents = [...state.workflowEvents, event]
    const workflowRuns = state.workflowRuns.map((item) => (
      item.id === runId ? summarizeWorkflowRun(item, workflowEvents.filter((candidate) => candidate.runId === runId)) : item
    ))
    this.write({ ...state, workflowRuns, workflowEvents })
    return event
  }

  updateWorkflowRun(runId: string, patch: WorkflowRunPatch): UgcWorkflowRun {
    const state = this.read()
    const run = state.workflowRuns.find((item) => item.id === runId)
    if (!run) throw new Error(`workflow run not found: ${runId}`)
    const now = this.now()
    const statusEvent: UgcWorkflowEvent | null = patch.status === undefined ? null : {
      schemaVersion: "ugc-studio.workflow-event.v1",
      eventId: nextWorkflowEventId(state),
      runId,
      type: eventTypeForStatus(patch.status),
      phase: patch.currentPhase ?? run.currentPhase,
      agentLabel: null,
      message: null,
      payload: { status: patch.status },
      artifactPaths: patch.artifactPaths ?? [],
      error: patch.error ?? null,
      createdAt: now,
    }
    const patched: UgcWorkflowRun = {
      ...run,
      title: patch.title?.trim() || run.title,
      status: patch.status ?? run.status,
      result: patch.result === undefined ? run.result : sanitizeWorkflowJsonValue(patch.result),
      error: patch.error === undefined ? run.error : patch.error,
      currentPhase: patch.currentPhase === undefined ? run.currentPhase : patch.currentPhase,
      counters: patch.counters ?? run.counters,
      importedRecordIds: patch.importedRecordIds ?? run.importedRecordIds,
      artifactPaths: patch.artifactPaths ?? run.artifactPaths,
      updatedAt: now,
    }
    const workflowEvents = statusEvent ? [...state.workflowEvents, statusEvent] : state.workflowEvents
    const summarized = summarizeWorkflowRun(patched, workflowEvents.filter((event) => event.runId === runId))
    const workflowRuns = state.workflowRuns.map((item) => (item.id === runId ? summarized : item))
    this.write({ ...state, workflowRuns, workflowEvents })
    return summarized
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
    const useDefaultInputs = input.roots === undefined && input.manifestPaths === undefined
    const roots = (useDefaultInputs ? DEFAULT_REFERENCE_CATALOG_ROOTS : input.roots ?? [])
      .map((root) => normalizeRelativePath(this.config.cwd, root))
    const manifestPaths = (useDefaultInputs ? DEFAULT_REFERENCE_ASSET_MANIFEST_PATHS : input.manifestPaths ?? [])
      .map((manifestPath) => normalizeRelativePath(this.config.cwd, manifestPath))
    const errors: string[] = []
    const warnings: string[] = []
    const catalogGroups = readReferenceCatalogGroups(this.config.cwd, roots, warnings)
    const manifestGroups = readReferenceAssetManifestGroups(this.config.cwd, manifestPaths, warnings)
    if (catalogGroups.length === 0 && manifestGroups.length === 0) {
      errors.push("Reference catalog import found no readable metadata records or asset manifests.")
    }
    const state = this.read()
    const plannedState = applyReferenceCatalogImports(state, catalogGroups, manifestGroups, now)
    const valid = errors.length === 0
    const importedState = valid && !dryRun ? this.write(plannedState) : null

    return {
      schemaVersion: "ugc-studio.reference-catalog-import-result.v1",
      dryRun,
      valid,
      imported: Boolean(importedState),
      checkedAt: now,
      roots,
      manifestPaths,
      videosPlanned: catalogGroups.reduce((count, group) => count + group.videos.length, 0),
      assetsPlanned: manifestGroups.reduce((count, group) => count + group.assets.length, 0),
      referenceProfileIds: [
        ...catalogGroups.map((group) => referenceCatalogProfileId(group.handle)),
        ...manifestGroups.map((group) => referenceAssetProfileId(group.provider)),
      ],
      archiveIds: [
        ...catalogGroups.map((group) => referenceCatalogArchiveId(group.handle)),
        ...manifestGroups.map((group) => referenceAssetArchiveId(group.provider)),
      ],
      providerJobIds: [
        ...catalogGroups.map((group) => referenceCatalogProviderJobId(group.handle)),
        ...manifestGroups.map((group) => referenceAssetProviderJobId(group.provider)),
      ],
      researchTargetIds: [
        ...catalogGroups.map((group) => referenceCatalogResearchTargetId(group.handle)),
        ...manifestGroups.map((group) => referenceAssetResearchTargetId(group.provider)),
      ],
      templateMiningJobIds: [
        ...catalogGroups.map((group) => referenceCatalogTemplateJobId(group.handle)),
        ...manifestGroups.map((group) => referenceAssetTemplateJobId(group.provider)),
      ],
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

const DEFAULT_REFERENCE_ASSET_MANIFEST_PATHS = [
  "data/ugc-studio/reference-assets/higgsfield/manifest.json",
  "data/ugc-studio/reference-assets/arcads/manifest.json",
]

const REFERENCE_CATALOG_GUARDRAILS = [
  "Metadata-only local catalogue import; do not open, copy, upload, or reuse source media.",
  "Do not persist expiring CDN URLs, request headers, cookies, or format URLs from info JSON.",
  "Use only abstract mechanics, local path provenance, duration, engagement counts, and rewritten hooks.",
  "Replace creator identity, face, voice, exact captions, source pixels, brand marks, and audio.",
]

const REFERENCE_ASSET_MANIFEST_GUARDRAILS = [
  "Manifest JSON import only; do not open, copy, upload, or reuse downloaded media bytes.",
  "Public provider assets are inspiration/reference only and are not direct generation inputs.",
  "Retain local paths, source pages, asset URLs, rights notes, and byte/hash metadata for provenance.",
  "Use abstract mechanics and clean-room summaries only unless a manifest explicitly records cleared rights.",
  "Replace provider demos, creator identity, product pixels, actor likeness, voice, copy, brand marks, and audio.",
]

interface ReferenceCatalogGroup {
  readonly root: string
  readonly handle: string
  readonly displayName: string
  readonly lane: "brainrot" | "ugc-ads"
  readonly videos: readonly UgcReferenceCatalogVideo[]
}

interface ReferenceAssetManifestGroup {
  readonly manifestPath: string
  readonly provider: string
  readonly displayName: string
  readonly lane: "ugc-ads"
  readonly sourcePages: readonly string[]
  readonly rightsSummary: string
  readonly useGuidance: string
  readonly captureTimestamp: string | null
  readonly assets: readonly UgcReferenceManifestAsset[]
  readonly blockedAssetCount: number
  readonly failedDownloadCount: number
  readonly evidenceFileCount: number
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

function readReferenceAssetManifestGroups(cwd: string, manifestPaths: readonly string[], warnings: string[]): readonly ReferenceAssetManifestGroup[] {
  const groups: ReferenceAssetManifestGroup[] = []
  for (const manifestPath of manifestPaths) {
    const absoluteManifestPath = resolve(cwd, manifestPath)
    const parsed = readJsonFile(absoluteManifestPath)
    if (!isRecord(parsed)) {
      warnings.push(`Reference asset manifest is unreadable: ${manifestPath}`)
      continue
    }
    const provider = slug(firstString(parsed.provider) ?? basename(dirname(absoluteManifestPath)))
    const sourcePages = stringArray(parsed.sourcePages).length > 0 ? stringArray(parsed.sourcePages) : stringArray(parsed.source_pages)
    const rightsSummary = firstString(parsed.rightsSummary, parsed.rights_notes, parsed.usage_boundary)
      ?? summarizeRightsRecord(parsed.robots_and_rights_notes)
      ?? `${provider} public provider asset manifest; reference/inspiration metadata only.`
    const useGuidance = firstString(parsed.useGuidance)
      ?? summarizeRightsRecord(parsed.robots_and_rights_notes)
      ?? "Reference/inspiration only; do not use as a direct generation input or reusable output asset."
    const rawAssets = Array.isArray(parsed.assets) ? parsed.assets : []
    const assets = rawAssets
      .map((asset, index) => readReferenceManifestAsset(cwd, manifestPath, provider, rightsSummary, asset, index, warnings))
      .filter(isReferenceManifestAsset)
    if (assets.length === 0) {
      warnings.push(`Reference asset manifest has no readable assets: ${manifestPath}`)
      continue
    }
    groups.push({
      manifestPath,
      provider,
      displayName: providerDisplayName(provider),
      lane: "ugc-ads",
      sourcePages,
      rightsSummary,
      useGuidance,
      captureTimestamp: firstString(parsed.captureTimestamp, parsed.capture_timestamp),
      assets,
      blockedAssetCount: arrayLength(parsed.blockedAssets) + arrayLength(parsed.blocked_assets),
      failedDownloadCount: arrayLength(parsed.failedDownloads) + arrayLength(parsed.failed_downloads),
      evidenceFileCount: arrayLength(parsed.evidenceFiles) + arrayLength(parsed.evidence_files),
    })
  }
  return groups
}

function readReferenceManifestAsset(
  cwd: string,
  manifestPath: string,
  provider: string,
  manifestRights: string,
  value: JsonValue,
  index: number,
  warnings: string[],
): UgcReferenceManifestAsset | null {
  if (!isRecord(value)) {
    warnings.push(`Reference asset manifest ${manifestPath} has a non-object asset at index ${index}.`)
    return null
  }
  const rawId = firstString(value.id) ?? `asset-${index + 1}`
  const sourceUrl = firstString(value.sourcePageUrl, value.source_page_url, value.sourceUrl, value.source_url)
  const assetUrl = firstString(value.assetUrl, value.asset_url, value.finalUrl, value.final_url)
  const localPath = normalizeManifestLocalPath(cwd, manifestPath, firstString(value.localPath, value.local_path, value.local))
  const title = firstString(value.title, value.title_label, value.label, value.notes) ?? rawId
  const mediaType = firstString(value.mediaType, value.media_type, value.contentType, value.content_type) ?? "application/octet-stream"
  const rights = firstString(value.rights, value.rights_notes) ?? manifestRights
  const directGenerationInput = manifestAllowsDirectGeneration(value)
  return {
    schemaVersion: "ugc-studio.reference-manifest-asset.v1",
    id: `reference_asset_${slug(provider)}_${slug(rawId)}`,
    provider,
    title,
    mediaType,
    localPath,
    sourceUrl,
    assetUrl,
    manifestPath,
    byteLength: firstFiniteNumber(value.bytes, value.byte_length, value.byteLength),
    sha256: firstString(value.sha256),
    captureTimestamp: firstString(value.captureTimestamp, value.capture_timestamp),
    rights,
    provenance: `Imported from ${manifestPath}; source page and asset URLs are retained as metadata only.`,
    sourcePolicy: "metadata-only",
    referenceOnly: !directGenerationInput,
    directGenerationInput,
    guardrails: REFERENCE_ASSET_MANIFEST_GUARDRAILS,
  }
}


function applyReferenceCatalogImports(
  state: UgcLocalState,
  catalogGroups: readonly ReferenceCatalogGroup[],
  manifestGroups: readonly ReferenceAssetManifestGroup[],
  now: string,
): UgcLocalState {
  if (catalogGroups.length === 0 && manifestGroups.length === 0) return state
  const catalogReferenceProfiles = catalogGroups.map((group) => referenceCatalogProfile(state.workspace.id, group))
  const manifestReferenceProfiles = manifestGroups.map((group) => referenceAssetProfile(state.workspace.id, group))
  const catalogArchives = catalogGroups.map((group) => referenceCatalogArchive(state.workspace.id, group, now))
  const manifestArchives = manifestGroups.map((group) => referenceAssetArchive(state.workspace.id, group, now))
  const catalogResearchTargets = catalogGroups.map((group) => referenceCatalogResearchTarget(state.workspace.id, group, now))
  const manifestResearchTargets = manifestGroups.map((group) => referenceAssetResearchTarget(state.workspace.id, group, now))
  const catalogTemplateJobs = catalogGroups.map((group) => referenceCatalogTemplateJob(state.workspace.id, group, now))
  const manifestTemplateJobs = manifestGroups.map((group) => referenceAssetTemplateJob(state.workspace.id, group, now))
  const catalogProviderJobs = catalogGroups.map((group) => referenceCatalogProviderJob(state.workspace.id, group, now))
  const manifestProviderJobs = manifestGroups.map((group) => referenceAssetProviderJob(state.workspace.id, group, now))
  return {
    ...state,
    workspace: {
      ...state.workspace,
      referenceProfiles: upsertById(state.workspace.referenceProfiles, [...catalogReferenceProfiles, ...manifestReferenceProfiles]),
    },
    referenceArchives: upsertById(state.referenceArchives, [...catalogArchives, ...manifestArchives]),
    researchTargets: upsertById(state.researchTargets, [...catalogResearchTargets, ...manifestResearchTargets]),
    templateMiningJobs: upsertById(state.templateMiningJobs, [...catalogTemplateJobs, ...manifestTemplateJobs]),
    providerJobs: upsertById(state.providerJobs, [...catalogProviderJobs, ...manifestProviderJobs]),
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
    referenceAssets: [],
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

function referenceAssetProfile(workspaceId: string, group: ReferenceAssetManifestGroup): ReferenceProfile {
  const referenceProfileId = referenceAssetProfileId(group.provider)
  return {
    id: referenceProfileId,
    platform: "internal-pack",
    handle: group.provider,
    displayName: `${group.displayName} public inspiration asset manifest`,
    rightsStatus: "public-research-target",
    archiveStatus: "sampled",
    styleLane: group.lane,
    useCase: "UGC ads inspiration mechanics from public provider demo asset metadata.",
    cleanRoomBoundary: REFERENCE_ASSET_MANIFEST_GUARDRAILS,
    sampleClips: group.assets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      sourceUrl: asset.sourceUrl ?? asset.assetUrl,
      durationSeconds: 0,
      storagePolicy: "store-metadata-only",
      extractedFields: [
        "manifest path",
        "local path",
        "source URL",
        "asset URL",
        "media type",
        "rights notes",
        "hash and byte length",
      ],
    })),
    extractedMechanics: {
      poseTiming: "Use only abstract motion, framing, and editing mechanics observed from manifest metadata or later clean-room review.",
      gestureRhythm: "Provider demo assets remain provenance references; local media files are not opened by import.",
      shotStructure: [`workspace:${workspaceId}`, `provider:${group.provider}`, "reference-only provider asset manifest"],
      captionTemplate: "Rewrite all captions and copy; provider demo text is not reusable source copy.",
      hookFamilies: ["AI UGC demo proof", "product transformation", "creator-style ad setup"],
      ctaPatterns: ["proof-led CTA", "tool capability CTA", "product outcome CTA"],
      nonAdPatterns: ["no direct media reuse", "no provider demo cloning", "no actor likeness reuse"],
    },
    remixFields: [
      {
        id: `remix_field_${group.provider}_manifest_mechanics`,
        label: "Provider demo mechanics",
        mode: "abstract",
        sourceField: "reference.referenceAssets.provenance",
        targetField: "candidate.recipe.shotStructure",
        rationale: "Use public provider demos only as abstract inspiration for clean-room shot planning.",
        confidence: 0.7,
      },
      {
        id: `remix_field_${group.provider}_local_assets`,
        label: "Provider local media",
        mode: "blocked",
        sourceField: "reference.referenceAssets.localPath",
        targetField: "candidate.rawMedia",
        rationale: "Local paths prove provenance but imported assets are reference-only and not direct generation inputs.",
        confidence: 1,
      },
    ],
  }
}

function referenceAssetArchive(workspaceId: string, group: ReferenceAssetManifestGroup, now: string): UgcReferenceArchive {
  const referenceProfileId = referenceAssetProfileId(group.provider)
  return {
    schemaVersion: "ugc-studio.reference-archive.v1",
    id: referenceAssetArchiveId(group.provider),
    workspaceId,
    referenceProfileId,
    title: `${group.displayName} provider inspiration asset archive`,
    rightsStatus: "public-research-target",
    archiveStatus: "sampled",
    createdAt: now,
    updatedAt: now,
    sourcePolicy: "metadata-only",
    preservedMechanics: toJsonValue({
      lane: group.lane,
      provider: group.provider,
      manifestPath: group.manifestPath,
      sourcePages: group.sourcePages,
      assets: group.assets.length,
      blockedAssets: group.blockedAssetCount,
      failedDownloads: group.failedDownloadCount,
      evidenceFiles: group.evidenceFileCount,
      importedFields: ["manifest path", "localPath", "sourceUrl", "assetUrl", "mediaType", "rights", "byteLength", "sha256"],
      excludedFields: ["media bytes", "cookies", "headers", "direct generation inputs"],
    }),
    sampleClipIds: group.assets.map((asset) => asset.id),
    swappedFields: ["provider demo", "actor likeness", "voice", "exact copy", "product", "CTA"],
    blockedFields: ["source pixels", "source audio", "provider demo reuse", "actor cloning", "brand marks", "direct generation input"],
    guardrails: REFERENCE_ASSET_MANIFEST_GUARDRAILS,
    candidateFormatOutputs: [
      {
        id: `format_${referenceProfileId}_manifest_template`,
        title: `${group.displayName} reference-only provider mechanics template`,
        kind: "format-template",
        summary: "Use provider asset manifest metadata to plan clean-room UGC ad mechanics without reading or uploading media bytes.",
        stageIds: ["stage_reference_profile", "stage_format", "stage_hook"],
        candidateIds: [],
        manifestJson: toJsonValue({
          lane: group.lane,
          provider: group.provider,
          sourcePolicy: "metadata-only",
          referenceOnly: group.assets.every((asset) => asset.referenceOnly),
          directGenerationInput: group.assets.some((asset) => asset.directGenerationInput),
          manifestPath: group.manifestPath,
          assets: group.assets.map((asset) => referenceAssetManifestSummary(asset)),
        }),
      },
    ],
    notes: [group.rightsSummary, group.useGuidance],
    catalogVideos: [],
    referenceAssets: group.assets,
  }
}

function referenceAssetResearchTarget(workspaceId: string, group: ReferenceAssetManifestGroup, now: string): UgcResearchTarget {
  return {
    schemaVersion: "ugc-studio.research-target.v1",
    id: referenceAssetResearchTargetId(group.provider),
    workspaceId,
    platform: "web",
    niche: `${group.displayName} public provider inspiration mechanics`,
    query: `${group.displayName} public demo asset manifest clean-room UGC ads mechanics`,
    status: "decomposed",
    priority: 2,
    sourcePolicy: "metadata-only",
    createdAt: now,
    updatedAt: now,
    templateJobIds: [referenceAssetTemplateJobId(group.provider)],
    notes: [
      `Local manifest import from ${group.manifestPath}; manifest JSON only, media bytes not read.`,
      group.rightsSummary,
      "Reference-only public inspiration assets; not direct generation inputs.",
    ],
  }
}

function referenceAssetTemplateJob(workspaceId: string, group: ReferenceAssetManifestGroup, now: string): UgcTemplateMiningJob {
  return {
    schemaVersion: "ugc-studio.template-mining-job.v1",
    id: referenceAssetTemplateJobId(group.provider),
    workspaceId,
    researchTargetId: referenceAssetResearchTargetId(group.provider),
    status: "ready",
    createdAt: now,
    updatedAt: now,
    templateSpec: {
      schemaVersion: "ugc-studio.clean-room-template.v1",
      id: `template_${group.provider}_reference_assets`,
      title: `${group.displayName} reference-only provider asset template`,
      category: "format",
      preservedMechanics: toJsonValue({
        lane: group.lane,
        provider: group.provider,
        sourcePolicy: "metadata-only",
        referenceOnly: group.assets.every((asset) => asset.referenceOnly),
        directGenerationInput: group.assets.some((asset) => asset.directGenerationInput),
        manifestPath: group.manifestPath,
        assetCount: group.assets.length,
      }),
      swapSlots: ["synthetic persona", "product", "hook copy", "caption copy", "voice", "CTA", "brand visuals"],
      blockedFields: ["source face", "source voice", "exact captions", "source pixels", "source audio", "provider brand marks"],
      proofNotes: REFERENCE_ASSET_MANIFEST_GUARDRAILS,
    },
    candidateIds: [],
    error: null,
  }
}

function referenceAssetProviderJob(workspaceId: string, group: ReferenceAssetManifestGroup, now: string): UgcProviderJob {
  return {
    schemaVersion: "ugc-studio.provider-job.v1",
    id: referenceAssetProviderJobId(group.provider),
    workspaceId,
    provider: "local",
    operation: "reference-asset-manifest-import",
    mode: "dry-run",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    targetIds: [referenceAssetProfileId(group.provider), referenceAssetArchiveId(group.provider)],
    spendCapUsd: 0,
    estimatedCostUsd: 0,
    request: toJsonValue({
      sourcePolicy: "metadata-only",
      referenceOnly: group.assets.every((asset) => asset.referenceOnly),
      directGenerationInput: group.assets.some((asset) => asset.directGenerationInput),
      lane: group.lane,
      provider: group.provider,
      manifestPath: group.manifestPath,
      sourcePages: group.sourcePages,
      rightsSummary: group.rightsSummary,
      useGuidance: group.useGuidance,
      assetCount: group.assets.length,
      blockedAssetCount: group.blockedAssetCount,
      failedDownloadCount: group.failedDownloadCount,
      evidenceFileCount: group.evidenceFileCount,
      assets: group.assets.map((asset) => referenceAssetManifestSummary(asset)),
      excludedFields: ["media bytes", "cookies", "headers", "direct generation inputs"],
    }),
    response: null,
    artifactPaths: [group.manifestPath],
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

function referenceAssetProfileId(provider: string): string {
  return `reference_provider_${slug(provider)}_assets`
}

function referenceAssetArchiveId(provider: string): string {
  return `archive_${referenceAssetProfileId(provider)}`
}

function referenceAssetResearchTargetId(provider: string): string {
  return `research_provider_${slug(provider)}_reference_assets`
}

function referenceAssetTemplateJobId(provider: string): string {
  return `template_job_provider_${slug(provider)}_reference_assets`
}

function referenceAssetProviderJobId(provider: string): string {
  return `job_local_reference_asset_manifest_import_${slug(provider)}`
}

function referenceAssetManifestSummary(asset: UgcReferenceManifestAsset): JsonValue {
  return toJsonValue({
    id: asset.id,
    provider: asset.provider,
    title: asset.title,
    mediaType: asset.mediaType,
    localPath: asset.localPath,
    sourceUrl: asset.sourceUrl,
    assetUrl: asset.assetUrl,
    manifestPath: asset.manifestPath,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    rights: asset.rights,
    sourcePolicy: asset.sourcePolicy,
    referenceOnly: asset.referenceOnly,
    directGenerationInput: asset.directGenerationInput,
  })
}

function providerDisplayName(provider: string): string {
  if (provider === "higgsfield") return "Higgsfield"
  if (provider === "arcads") return "Arcads"
  return provider
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function stringArray(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function arrayLength(value: JsonValue | undefined): number {
  return Array.isArray(value) ? value.length : 0
}

function summarizeRightsRecord(value: JsonValue | undefined): string | null {
  if (!isRecord(value)) return null
  const parts = Object.values(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  return parts.length > 0 ? parts.join(" ") : null
}

function normalizeManifestLocalPath(cwd: string, manifestPath: string, localPath: string | null): string | null {
  if (!localPath) return null
  if (localPath.startsWith("http://") || localPath.startsWith("https://")) return null
  if (localPath.startsWith("data/")) return normalizeRelativePath(cwd, localPath)
  return normalizeRelativePath(cwd, resolve(dirname(resolve(cwd, manifestPath)), localPath))
}

function manifestAllowsDirectGeneration(value: JsonValue): boolean {
  if (!isRecord(value)) return false
  return value.directGenerationInput === true
    || value.direct_generation_input === true
    || value.generationInputAllowed === true
    || value.generation_input_allowed === true
}

function isReferenceManifestAsset(value: UgcReferenceManifestAsset | null): value is UgcReferenceManifestAsset {
  return value !== null
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

function nextWorkflowEventId(state: UgcLocalState): number {
  return state.workflowEvents.reduce((max, event) => Math.max(max, event.eventId), 0) + 1
}

function summarizeWorkflowRun(run: UgcWorkflowRun, events: readonly UgcWorkflowEvent[]): UgcWorkflowRun {
  let status = run.status
  let result = run.result
  let error = run.error
  let currentPhase = run.currentPhase
  let updatedAt = run.updatedAt
  let artifactPaths = run.artifactPaths
  for (const event of [...events].sort((left, right) => left.eventId - right.eventId)) {
    const eventStatus = workflowStatusForEvent(event)
    if (eventStatus) status = eventStatus
    if (event.phase) currentPhase = event.phase
    if (event.artifactPaths.length > 0) artifactPaths = mergeStrings(artifactPaths, event.artifactPaths)
    if (event.error) error = event.error
    if ((event.type === "result" || event.type === "completed") && event.payload !== null) result = event.payload
    updatedAt = event.createdAt
  }
  return { ...run, status, result, error, currentPhase, artifactPaths, updatedAt }
}

function workflowStatusForEvent(event: UgcWorkflowEvent): UgcWorkflowRunStatus | null {
  if (event.type === "queued") return "queued"
  if (event.type === "started" || event.type === "phase" || event.type === "message" || event.type === "artifact") return "running"
  if (event.type === "result" || event.type === "completed") return "succeeded"
  if (event.type === "error") return "failed"
  if (event.type === "blocked") return "blocked"
  if (event.type === "canceled") return "canceled"
  if ((event.type === "status" || event.type === "created") && isRecord(event.payload) && isWorkflowRunStatus(event.payload.status)) return event.payload.status
  return null
}

function eventTypeForStatus(status: UgcWorkflowRunStatus): UgcWorkflowEventType {
  if (status === "queued") return "queued"
  if (status === "running") return "started"
  if (status === "succeeded") return "completed"
  if (status === "failed") return "error"
  if (status === "blocked") return "blocked"
  if (status === "canceled") return "canceled"
  return "status"
}

function isWorkflowRunStatus(value: JsonValue | undefined): value is UgcWorkflowRunStatus {
  return value === "planned"
    || value === "queued"
    || value === "running"
    || value === "succeeded"
    || value === "failed"
    || value === "blocked"
    || value === "canceled"
}

function mergeStrings(existing: readonly string[], incoming: readonly string[]): readonly string[] {
  return [...new Set([...existing, ...incoming])]
}

function sanitizeWorkflowRun(run: UgcWorkflowRun): UgcWorkflowRun {
  return {
    ...run,
    args: sanitizeWorkflowJsonValue(run.args),
    result: run.result === null ? null : sanitizeWorkflowJsonValue(run.result),
  }
}

function sanitizeWorkflowEvent(event: UgcWorkflowEvent): UgcWorkflowEvent {
  return {
    ...event,
    payload: event.payload === null ? null : sanitizeWorkflowJsonValue(event.payload),
  }
}

function sanitizeWorkflowJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((item) => sanitizeWorkflowJsonValue(item))
  const sanitized: { [key: string]: JsonValue } = {}
  const record = value as { readonly [key: string]: JsonValue }
  for (const key of Object.keys(record)) {
    sanitized[key] = isSensitiveWorkflowKey(key) ? "[redacted]" : sanitizeWorkflowJsonValue(record[key] ?? null)
  }
  return sanitized
}

function isSensitiveWorkflowKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "")
  return normalized === "apikey"
    || normalized === "token"
    || normalized === "accesstoken"
    || normalized === "refreshtoken"
    || normalized === "secret"
    || normalized === "clientsecret"
    || normalized === "password"
    || normalized === "credential"
    || normalized === "credentials"
    || normalized === "authorization"
    || normalized === "authheader"
    || normalized === "cookie"
    || normalized === "cookies"
    || normalized === "session"
    || normalized === "sessiontoken"
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
    readonly workflowRuns?: readonly UgcWorkflowRun[]
    readonly workflowEvents?: readonly UgcWorkflowEvent[]
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
          referenceAssets: existing.referenceAssets ?? defaultArchive.referenceAssets,
        }
      : defaultArchive
  })
  const orphanArchives = state.referenceArchives
    .filter((archive) => !state.workspace.referenceProfiles.some((referenceProfile) => referenceProfile.id === archive.referenceProfileId))
    .map((archive) => ({ ...archive, referenceAssets: archive.referenceAssets ?? [] }))
  const workflowEvents = [...(legacyState.workflowEvents ?? [])]
    .map((event) => sanitizeWorkflowEvent(event))
    .sort((left, right) => left.eventId - right.eventId)
  return {
    ...state,
    referenceArchives: [...referenceArchives, ...orphanArchives],
    researchTargets: legacyState.researchTargets ?? createInitialResearchTargets(state.workspace.id, state.updatedAt),
    templateMiningJobs: legacyState.templateMiningJobs ?? createInitialTemplateMiningJobs(state.workspace.id, state.updatedAt),
    workflowEvents,
    workflowRuns: (legacyState.workflowRuns ?? [])
      .map((run) => sanitizeWorkflowRun(run))
      .map((run) => summarizeWorkflowRun(run, workflowEvents.filter((event) => event.runId === run.id))),
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
  writeCollection(resolve(workspaceDir, "workflow-runs"), state.workflowRuns)
  writeWorkflowEventCollection(resolve(workspaceDir, "workflow-events"), state.workflowEvents)
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

function writeWorkflowEventCollection(dir: string, records: readonly UgcWorkflowEvent[]): void {
  mkdirSync(dir, { recursive: true })
  const expectedFiles = new Set(records.map((record) => `${record.eventId}.json`))
  for (const fileName of readdirSync(dir)) {
    if (fileName.endsWith(".json") && !expectedFiles.has(fileName)) rmSync(resolve(dir, fileName), { force: true })
  }
  for (const record of records) writeJsonAtomic(resolve(dir, `${record.eventId}.json`), record)
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
    && collectionMatches(resolve(workspaceDir, "workflow-runs"), state.workflowRuns)
    && workflowEventCollectionMatches(resolve(workspaceDir, "workflow-events"), state.workflowEvents)
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

function workflowEventCollectionMatches(dir: string, records: readonly UgcWorkflowEvent[]): boolean {
  if (!existsSync(dir)) return false
  const expectedFiles = new Set(records.map((record) => `${record.eventId}.json`))
  for (const fileName of readdirSync(dir)) {
    if (fileName.endsWith(".json") && !expectedFiles.has(fileName)) return false
  }
  return records.every((record) => jsonFileMatches(resolve(dir, `${record.eventId}.json`), record))
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
    workflowRuns: state.workflowRuns.length,
    workflowEvents: state.workflowEvents.length,
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
      workflowRuns: state.workflowRuns.map((item) => `workflow-runs/${item.id}.json`),
      workflowEvents: state.workflowEvents.map((item) => `workflow-events/${item.eventId}.json`),
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
  const state = normalizeLocalState(value.state)
  return {
    schemaVersion: "ugc-studio.workspace-bundle.v1",
    id: value.id,
    workspaceId: value.workspaceId,
    label: value.label,
    exportedAt: value.exportedAt,
    sourceStateUpdatedAt: value.sourceStateUpdatedAt,
    summary: summarizeLocalState(state),
    objectCounts: value.objectCounts,
    shardManifest: value.shardManifest,
    state,
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
  if (bundle.shardManifest.collections.workflowRuns.length !== bundle.state.workflowRuns.length) {
    errors.push("Bundle shardManifest.collections.workflowRuns does not match state payload.")
  }
  if (bundle.shardManifest.collections.workflowEvents.length !== bundle.state.workflowEvents.length) {
    errors.push("Bundle shardManifest.collections.workflowEvents does not match state payload.")
  }
  for (const event of bundle.state.workflowEvents) {
    if (!bundle.state.workflowRuns.some((run) => run.id === event.runId)) {
      errors.push(`Workflow event ${event.eventId} references missing run ${event.runId}.`)
    }
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
    const referenceAssets = archive.referenceAssets ?? []
    for (const asset of referenceAssets) {
      if (asset.sourcePolicy !== "metadata-only" && asset.sourcePolicy !== "abstract-mechanics") {
        errors.push(`Reference manifest asset ${asset.id} must be metadata-only or abstract-mechanics.`)
      }
      if (asset.referenceOnly === asset.directGenerationInput) {
        errors.push(`Reference manifest asset ${asset.id} must be either reference-only or explicitly direct-generation allowed.`)
      }
      if (asset.localPath && (asset.localPath.startsWith("http://") || asset.localPath.startsWith("https://"))) {
        errors.push(`Reference manifest asset ${asset.id} localPath must be local.`)
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
    && typeof value.workflowRuns === "number"
    && typeof value.workflowEvents === "number"
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
    && isStringArray(value.collections.workflowRuns)
    && isStringArray(value.collections.workflowEvents)
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
