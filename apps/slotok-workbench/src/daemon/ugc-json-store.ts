import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  candidateById,
  createInitialLocalState,
  isLocalState,
  referenceProfileToArchive,
  summarizeLocalState,
  toJsonValue,
  type BranchPatch,
  type CandidateStatusPatch,
  type CreateExportManifestInput,
  type CreateProviderJobInput,
  type CreateReferenceArchiveInput,
  type CreateReviewNoteInput,
  type PersonaPatch,
  type UgcExportManifest,
  type UgcLocalState,
  type UgcProviderJob,
  type UgcReferenceArchive,
} from "../ugc/local-state"
import type { JsonValue, PersonaProfile, ReviewNote, UgcStudioWorkspace } from "../renderer/ugcStudioModel"

export interface UgcJsonStoreOptions {
  readonly cwd?: string
  readonly root?: string
  readonly workspaceId?: string
  readonly now?: () => string
}

export interface UgcJsonStoreConfig {
  readonly cwd: string
  readonly root: string
  readonly workspaceId: string
  readonly workspaceDir: string
  readonly statePath: string
}

type JsonSerializable = JsonValue | object

export class UgcJsonStore {
  readonly config: UgcJsonStoreConfig
  readonly now: () => string

  constructor(options: UgcJsonStoreOptions = {}) {
    const cwd = resolve(options.cwd ?? findProjectRoot(process.cwd()))
    const root = resolve(cwd, options.root ?? "data/ugc-studio/workspaces")
    const workspaceId = options.workspaceId ?? "workspace_protein_bar_ads"
    const workspaceDir = resolve(root, workspaceId)
    this.config = {
      cwd,
      root,
      workspaceId,
      workspaceDir,
      statePath: resolve(workspaceDir, "state.json"),
    }
    this.now = options.now ?? (() => new Date().toISOString())
  }

  summary() {
    return summarizeLocalState(this.read())
  }

  read(): UgcLocalState {
    const existing = readJsonFile(this.config.statePath)
    if (isLocalState(existing)) {
      const normalized = normalizeLocalState(existing)
      if (JSON.stringify(normalized) !== JSON.stringify(existing)) return this.write(normalized)
      return normalized
    }

    const created = createInitialLocalState(this.now())
    this.write(created)
    return created
  }

  write(state: UgcLocalState): UgcLocalState {
    const normalized = stampState(state, this.now())
    writeJsonAtomic(this.config.statePath, normalized)
    writeWorkspaceShards(this.config.workspaceDir, normalized)
    return normalized
  }

  reset(): UgcLocalState {
    rmSync(this.config.workspaceDir, { recursive: true, force: true })
    return this.write(createInitialLocalState(this.now()))
  }

  updatePersona(personaId: string, patch: PersonaPatch): UgcLocalState {
    return this.updateWorkspace((workspace) => {
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
    return this.updateWorkspace((workspace) => {
      const candidates = workspace.candidates.map((candidate) => (
        candidate.id === candidateId ? { ...candidate, status: patch.status } : candidate
      ))
      if (candidates.every((candidate, index) => candidate === workspace.candidates[index])) {
        throw new Error(`candidate not found: ${candidateId}`)
      }
      return { ...workspace, candidates }
    })
  }

  updateBranch(branchId: string, patch: BranchPatch): UgcLocalState {
    return this.updateWorkspace((workspace) => {
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
    return this.updateWorkspace((workspace) => {
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

  private updateWorkspace(update: (workspace: UgcStudioWorkspace) => UgcStudioWorkspace): UgcLocalState {
    const state = this.read()
    return this.write({ ...state, workspace: update(state.workspace) })
  }
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

function stampState(state: UgcLocalState, now: string): UgcLocalState {
  return {
    ...state,
    workspace: { ...state.workspace, updatedAt: now },
    updatedAt: now,
  }
}

function normalizeLocalState(state: UgcLocalState): UgcLocalState {
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
        }
      : defaultArchive
  })
  const orphanArchives = state.referenceArchives.filter((archive) => (
    !state.workspace.referenceProfiles.some((referenceProfile) => referenceProfile.id === archive.referenceProfileId)
  ))
  return { ...state, referenceArchives: [...referenceArchives, ...orphanArchives] }
}

function writeWorkspaceShards(workspaceDir: string, state: UgcLocalState): void {
  writeJsonAtomic(resolve(workspaceDir, "workspace.json"), state.workspace)
  writeCollection(resolve(workspaceDir, "personas"), state.workspace.personas)
  writeCollection(resolve(workspaceDir, "campaigns"), [state.workspace.productBrief])
  writeCollection(resolve(workspaceDir, "branches"), state.workspace.branchSnapshots)
  writeCollection(resolve(workspaceDir, "candidates"), state.workspace.candidates)
  writeCollection(resolve(workspaceDir, "notes"), state.workspace.reviewNotes)
  writeCollection(resolve(workspaceDir, "provider-jobs"), state.providerJobs)
  writeCollection(resolve(workspaceDir, "reference-archives"), state.referenceArchives)
  writeCollection(resolve(workspaceDir, "exports"), state.exportManifests)
  mkdirSync(resolve(workspaceDir, "assets/source"), { recursive: true })
  mkdirSync(resolve(workspaceDir, "assets/generated"), { recursive: true })
  mkdirSync(resolve(workspaceDir, "assets/exports"), { recursive: true })
}

function writeCollection<T extends { readonly id: string }>(dir: string, records: readonly T[]): void {
  mkdirSync(dir, { recursive: true })
  for (const record of records) writeJsonAtomic(resolve(dir, `${record.id}.json`), record)
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
