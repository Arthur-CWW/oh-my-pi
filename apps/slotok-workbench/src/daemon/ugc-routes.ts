import { decodeCodexAnalyzeInput, prepareCodexAnalyze, runCodexAnalyze, type CodexAnalyzeInput } from "@wirebabel/ugc-cli"
import { UgcJsonStore } from "./ugc-json-store"
import { isRecord, toJsonValue, type BranchPatch, type BulkCandidateStatusPatch, type CandidateStatusPatch, type CleanRoomTemplateSpec, type CreateBranchInput, type CreateExportManifestInput, type CreateProviderJobInput, type CreateReferenceArchiveInput, type CreateResearchTargetInput, type CreateReviewNoteInput, type CreateTemplateMiningJobInput, type CreateWorkspaceBundleInput, type FinalEditorClipPatch, type FinalEditorPatch, type FinalEditorTrackPatch, type ImportWorkspaceBundleInput, type PersonaPatch, type ProviderJobPatch, type ReferenceArchiveFormatOutput, type ResearchTargetPatch, type TemplateMiningJobPatch, type UgcReferenceArchive, type UgcResearchPlatform, type UgcResearchTargetStatus, type UgcTemplateMiningJobStatus } from "../ugc/local-state"
import type { BranchStatus, CandidateStatus, JsonValue, ReviewAttachment, ReviewVerdict } from "../renderer/ugcStudioModel"

interface CodexAnalysisJobRequest {
  readonly input: CodexAnalyzeInput
  readonly live: boolean
  readonly maxSpendUsd?: number
  readonly apiKey?: string
}

export async function routeUgc(request: Request, store: UgcJsonStore): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/ugc/")) return null

  if (request.method === "GET" && url.pathname === "/api/ugc/workspace") {
    return json(store.read())
  }

  if (request.method === "GET" && url.pathname === "/api/ugc/workspaces") {
    return json({ workspaces: [store.summary()] })
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/workspace/reset") {
    return json(store.reset())
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/workspace/bundles/export") {
    return json(store.exportWorkspaceBundle(decodeCreateWorkspaceBundle(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/workspace/bundles/import") {
    return json(store.importWorkspaceBundle(decodeImportWorkspaceBundle(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/personas/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/personas/".length))
    if (!id) return json({ error: "missing persona id" }, 400)
    return json(store.updatePersona(id, decodePersonaPatch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/candidates/status") {
    return json(store.updateCandidates(decodeBulkCandidateStatusPatch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/candidates/") && url.pathname.endsWith("/status")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/candidates/".length, -"/status".length))
    if (!id) return json({ error: "missing candidate id" }, 400)
    return json(store.updateCandidate(id, decodeCandidateStatusPatch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/branches") {
    return json(store.createBranch(decodeCreateBranch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/branches/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/branches/".length))
    if (!id) return json({ error: "missing branch id" }, 400)
    return json(store.updateBranch(id, decodeBranchPatch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/notes") {
    return json(store.createReviewNote(decodeCreateReviewNote(await readJson(request))))
  }

  if (request.method === "GET" && url.pathname === "/api/ugc/provider-jobs") {
    return json({ providerJobs: store.read().providerJobs })
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/provider-jobs") {
    return json(store.createProviderJob(decodeCreateProviderJob(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/codex/plan") {
    return json(prepareCodexAnalyze(decodeCodexAnalyzeInput(await readJson(request))))
  }

  if (request.method === "POST" && (url.pathname === "/api/ugc/codex/jobs" || url.pathname === "/api/ugc/codex/create")) {
    const decoded = decodeCodexAnalysisJobRequest(await readJson(request))
    const prepared = prepareCodexAnalyze(decoded.input)
    if (!decoded.live) {
      const state = store.createProviderJob({
        provider: "codex",
        operation: decoded.input.operation,
        mode: "dry-run",
        status: "planned",
        targetIds: decoded.input.targetIds ?? [],
        spendCapUsd: decoded.maxSpendUsd ?? prepared.estimatedCostUsd,
        estimatedCostUsd: prepared.estimatedCostUsd,
        request: toJsonValue(prepared),
      })
      return json({ job: state.providerJobs[0], prepared, state })
    }

    if (decoded.maxSpendUsd === undefined) throw new Error("Codex live analysis requires maxSpendUsd")
    if (!decoded.apiKey) throw new Error("Codex live analysis requires an explicit apiKey")
    const result = await runCodexAnalyze(decoded.input, {
      apiKey: decoded.apiKey,
      maxSpendUsd: decoded.maxSpendUsd,
    })
    const state = store.createProviderJob({
      provider: "codex",
      operation: decoded.input.operation,
      mode: "live",
      status: "succeeded",
      targetIds: decoded.input.targetIds ?? [],
      spendCapUsd: decoded.maxSpendUsd,
      estimatedCostUsd: result.prepared.estimatedCostUsd,
      request: toJsonValue(result.prepared),
      response: result.response,
    })
    return json({ job: state.providerJobs[0], result, state })
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/provider-jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/provider-jobs/".length))
    if (!id) return json({ error: "missing provider job id" }, 400)
    return json(store.updateProviderJob(id, decodeProviderJobPatch(await readJson(request))))
  }

  if (request.method === "GET" && url.pathname === "/api/ugc/reference-archives") {
    return json({ referenceArchives: store.read().referenceArchives })
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/reference-archives") {
    return json(store.createReferenceArchive(decodeCreateReferenceArchive(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/reference-archives/") && url.pathname.endsWith("/delete")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/reference-archives/".length, -"/delete".length))
    if (!id) return json({ error: "missing reference archive id" }, 400)
    return json(store.deleteReferenceArchive(id))
  }

  if (request.method === "GET" && url.pathname === "/api/ugc/research-targets") {
    const state = store.read()
    return json({ researchTargets: state.researchTargets, templateMiningJobs: state.templateMiningJobs })
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/research-targets") {
    return json(store.createResearchTarget(decodeCreateResearchTarget(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/research-targets/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/research-targets/".length))
    if (!id) return json({ error: "missing research target id" }, 400)
    return json(store.updateResearchTarget(id, decodeResearchTargetPatch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/template-mining-jobs") {
    return json(store.createTemplateMiningJob(decodeCreateTemplateMiningJob(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/template-mining-jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/template-mining-jobs/".length))
    if (!id) return json({ error: "missing template mining job id" }, 400)
    return json(store.updateTemplateMiningJob(id, decodeTemplateMiningJobPatch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/final-editor") {
    return json(store.updateFinalEditor(decodeFinalEditorPatch(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/exports") {
    return json(store.createExportManifest(decodeCreateExportManifest(await readJson(request))))
  }

  return null
}

async function readJson(request: Request): Promise<JsonValue> {
  return await request.json() as JsonValue
}

function decodePersonaPatch(value: JsonValue): PersonaPatch {
  if (!isRecord(value)) return {}
  const voice = isRecord(value.voice) ? {
    ...(typeof value.voice.accent === "string" ? { accent: value.voice.accent } : {}),
    ...(typeof value.voice.speakingStyle === "string" ? { speakingStyle: value.voice.speakingStyle } : {}),
    ...(typeof value.voice.energy === "number" ? { energy: value.voice.energy } : {}),
    ...(isStringArray(value.voice.catchphrases) ? { catchphrases: value.voice.catchphrases } : {}),
    ...(isStringArray(value.voice.avoid) ? { avoid: value.voice.avoid } : {}),
  } : undefined
  const profileBible = isRecord(value.profileBible) ? {
    ...(typeof value.profileBible.niche === "string" ? { niche: value.profileBible.niche } : {}),
    ...(typeof value.profileBible.audiencePromise === "string" ? { audiencePromise: value.profileBible.audiencePromise } : {}),
    ...(isStringArray(value.profileBible.specialInterests) ? { specialInterests: value.profileBible.specialInterests } : {}),
    ...(isStringArray(value.profileBible.influences) ? { influences: value.profileBible.influences } : {}),
    ...(isStringArray(value.profileBible.promotes) ? { promotes: value.profileBible.promotes } : {}),
    ...(isStringArray(value.profileBible.toneRules) ? { toneRules: value.profileBible.toneRules } : {}),
  } : undefined
  return {
    ...(isPersonaStatus(value.status) ? { status: value.status } : {}),
    ...(isStringArray(value.notes) ? { notes: value.notes } : {}),
    ...(typeof value.avatarPrompt === "string" ? { avatarPrompt: value.avatarPrompt } : {}),
    ...(typeof value.genreLane === "string" ? { genreLane: value.genreLane } : {}),
    ...(voice ? { voice } : {}),
    ...(profileBible ? { profileBible } : {}),
    ...(isJsonValue(value.continuityManifest) ? { continuityManifest: value.continuityManifest } : {}),
  }
}

function decodeCandidateStatusPatch(value: JsonValue): CandidateStatusPatch {
  if (!isRecord(value) || !isCandidateStatus(value.status)) throw new Error("candidate status patch requires a valid status")
  return { status: value.status }
}

function decodeBulkCandidateStatusPatch(value: JsonValue): BulkCandidateStatusPatch {
  if (!isRecord(value) || !isCandidateStatus(value.status)) throw new Error("candidate bulk status patch requires a valid status")
  if (!Array.isArray(value.candidateIds) || !value.candidateIds.every((item) => typeof item === "string")) {
    throw new Error("candidate bulk status patch requires candidateIds")
  }
  return { candidateIds: value.candidateIds, status: value.status }
}

function decodeBranchPatch(value: JsonValue): BranchPatch {
  if (!isRecord(value)) return {}
  return {
    ...(isBranchStatus(value.status) ? { status: value.status } : {}),
    ...(typeof value.decisionNote === "string" ? { decisionNote: value.decisionNote } : {}),
  }
}

function decodeCreateBranch(value: JsonValue): CreateBranchInput {
  if (!isRecord(value) || typeof value.focus !== "string" || value.focus.trim().length === 0) {
    throw new Error("branch create request requires focus")
  }
  return {
    parentId: typeof value.parentId === "string" ? value.parentId : null,
    title: typeof value.title === "string" ? value.title : undefined,
    focus: value.focus,
    selectedPersonaIds: isStringArray(value.selectedPersonaIds) ? value.selectedPersonaIds : undefined,
    selectedCandidateIds: isStringArray(value.selectedCandidateIds) ? value.selectedCandidateIds : undefined,
    candidateBatchIds: isStringArray(value.candidateBatchIds) ? value.candidateBatchIds : undefined,
    decisionNote: typeof value.decisionNote === "string" ? value.decisionNote : undefined,
  }
}

function decodeCreateReviewNote(value: JsonValue): CreateReviewNoteInput {
  if (!isRecord(value)) throw new Error("note request must be an object")
  const attachedTo = decodeReviewAttachment(value.attachedTo)
  if (!isReviewVerdict(value.verdict)) throw new Error("note request requires a verdict")
  if (typeof value.body !== "string" || value.body.trim().length === 0) throw new Error("note request requires a body")
  return {
    author: value.author === "agent" ? "agent" : "arthur",
    attachedTo,
    verdict: value.verdict,
    body: value.body,
    requestedChange: typeof value.requestedChange === "string" ? value.requestedChange : null,
  }
}

function decodeCreateProviderJob(value: JsonValue): CreateProviderJobInput {
  if (!isRecord(value)) throw new Error("provider job request must be an object")
  if (value.provider !== "kie" && value.provider !== "jimeng" && value.provider !== "local" && value.provider !== "codex") throw new Error("provider job requires provider")
  if (typeof value.operation !== "string") throw new Error("provider job requires operation")
  return {
    provider: value.provider,
    operation: value.operation,
    mode: value.mode === "live" ? "live" : "dry-run",
    status: isProviderJobStatus(value.status) ? value.status : "planned",
    targetIds: Array.isArray(value.targetIds) && value.targetIds.every((item) => typeof item === "string") ? value.targetIds : [],
    spendCapUsd: typeof value.spendCapUsd === "number" ? value.spendCapUsd : 0.5,
    estimatedCostUsd: typeof value.estimatedCostUsd === "number" ? value.estimatedCostUsd : null,
    request: isJsonValue(value.request) ? value.request : null,
    response: isJsonValue(value.response) ? value.response : null,
    artifactPaths: Array.isArray(value.artifactPaths) && value.artifactPaths.every((item) => typeof item === "string") ? value.artifactPaths : [],
    error: typeof value.error === "string" ? value.error : null,
  }
}

function decodeCodexAnalysisJobRequest(value: JsonValue): CodexAnalysisJobRequest {
  if (!isRecord(value)) throw new Error("Codex analysis job request must be an object")
  const input = decodeCodexAnalyzeInput({
    operation: value.operation,
    mediaUrl: value.mediaUrl,
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.maxOutputTokens === "number" ? { maxOutputTokens: value.maxOutputTokens } : {}),
    ...(typeof value.workspaceId === "string" ? { workspaceId: value.workspaceId } : {}),
    ...(isStringArray(value.targetIds) ? { targetIds: value.targetIds } : {}),
    ...(isStringArray(value.referenceFrameUrls) ? { referenceFrameUrls: value.referenceFrameUrls } : {}),
  })
  const live = value.live === true
  const maxSpendUsd = typeof value.maxSpendUsd === "number" ? value.maxSpendUsd : undefined
  const apiKey = typeof value.apiKey === "string" && value.apiKey.length > 0 ? value.apiKey : undefined
  return { input, live, maxSpendUsd, apiKey }
}

function decodeProviderJobPatch(value: JsonValue): ProviderJobPatch {
  if (!isRecord(value)) return {}
  return {
    status: isProviderJobStatus(value.status) ? value.status : undefined,
    response: value.response === undefined ? undefined : isJsonValue(value.response) ? value.response : null,
    artifactPaths: isStringArray(value.artifactPaths) ? value.artifactPaths : undefined,
    error: value.error === undefined ? undefined : typeof value.error === "string" ? value.error : null,
  }
}

function decodeCreateReferenceArchive(value: JsonValue): CreateReferenceArchiveInput {
  if (!isRecord(value) || typeof value.referenceProfileId !== "string") throw new Error("reference archive requires referenceProfileId")
  return {
    referenceProfileId: value.referenceProfileId,
    sourcePolicy: isReferenceSourcePolicy(value.sourcePolicy) ? value.sourcePolicy : undefined,
    archiveStatus: isReferenceArchiveStatus(value.archiveStatus) ? value.archiveStatus : undefined,
    preservedMechanics: isJsonValue(value.preservedMechanics) ? value.preservedMechanics : undefined,
    swappedFields: isStringArray(value.swappedFields) ? value.swappedFields : undefined,
    blockedFields: isStringArray(value.blockedFields) ? value.blockedFields : undefined,
    guardrails: isStringArray(value.guardrails) ? value.guardrails : undefined,
    candidateFormatOutputs: decodeReferenceArchiveFormatOutputs(value.candidateFormatOutputs),
    notes: Array.isArray(value.notes) && value.notes.every((item) => typeof item === "string") ? value.notes : undefined,
  }
}

function decodeCreateResearchTarget(value: JsonValue): CreateResearchTargetInput {
  if (!isRecord(value)) throw new Error("research target request must be an object")
  if (typeof value.niche !== "string" || value.niche.trim().length === 0) throw new Error("research target requires niche")
  if (typeof value.query !== "string" || value.query.trim().length === 0) throw new Error("research target requires query")
  return {
    platform: isResearchPlatform(value.platform) ? value.platform : "tiktok",
    niche: value.niche,
    query: value.query,
    priority: typeof value.priority === "number" ? value.priority : undefined,
    sourcePolicy: value.sourcePolicy === "abstract-mechanics" ? "abstract-mechanics" : "metadata-only",
    notes: isStringArray(value.notes) ? value.notes : undefined,
  }
}

function decodeResearchTargetPatch(value: JsonValue): ResearchTargetPatch {
  if (!isRecord(value)) return {}
  return {
    status: isResearchTargetStatus(value.status) ? value.status : undefined,
    priority: typeof value.priority === "number" ? value.priority : undefined,
    notes: isStringArray(value.notes) ? value.notes : undefined,
  }
}

function decodeCreateTemplateMiningJob(value: JsonValue): CreateTemplateMiningJobInput {
  if (!isRecord(value) || typeof value.researchTargetId !== "string") throw new Error("template mining job requires researchTargetId")
  return {
    researchTargetId: value.researchTargetId,
    status: isTemplateMiningJobStatus(value.status) ? value.status : undefined,
    templateSpec: decodeCleanRoomTemplateSpec(value.templateSpec),
    candidateIds: isStringArray(value.candidateIds) ? value.candidateIds : undefined,
  }
}

function decodeTemplateMiningJobPatch(value: JsonValue): TemplateMiningJobPatch {
  if (!isRecord(value)) return {}
  return {
    status: isTemplateMiningJobStatus(value.status) ? value.status : undefined,
    templateSpec: decodeCleanRoomTemplateSpec(value.templateSpec),
    candidateIds: isStringArray(value.candidateIds) ? value.candidateIds : undefined,
    error: value.error === undefined ? undefined : typeof value.error === "string" ? value.error : null,
  }
}

function decodeCleanRoomTemplateSpec(value: unknown): CleanRoomTemplateSpec | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("templateSpec must be an object")
  if (value.schemaVersion !== "ugc-studio.clean-room-template.v1") throw new Error("templateSpec schemaVersion is invalid")
  if (typeof value.id !== "string" || typeof value.title !== "string") throw new Error("templateSpec requires id and title")
  if (!isCleanRoomTemplateCategory(value.category)) throw new Error("templateSpec category is invalid")
  if (!isJsonValue(value.preservedMechanics)) throw new Error("templateSpec preservedMechanics must be JSON")
  if (!isStringArray(value.swapSlots) || !isStringArray(value.blockedFields) || !isStringArray(value.proofNotes)) {
    throw new Error("templateSpec requires swapSlots, blockedFields, and proofNotes")
  }
  return {
    schemaVersion: "ugc-studio.clean-room-template.v1",
    id: value.id,
    title: value.title,
    category: value.category,
    preservedMechanics: value.preservedMechanics,
    swapSlots: value.swapSlots,
    blockedFields: value.blockedFields,
    proofNotes: value.proofNotes,
  }
}

function decodeCreateExportManifest(value: JsonValue): CreateExportManifestInput {
  if (!isRecord(value)) return {}
  return {
    label: typeof value.label === "string" ? value.label : undefined,
    selectedCandidateId: typeof value.selectedCandidateId === "string" ? value.selectedCandidateId : undefined,
    presetId: typeof value.presetId === "string" ? value.presetId : undefined,
    timelineJson: isJsonValue(value.timelineJson) ? value.timelineJson : undefined,
    notes: Array.isArray(value.notes) && value.notes.every((item) => typeof item === "string") ? value.notes : undefined,
  }
}

function decodeFinalEditorPatch(value: JsonValue): FinalEditorPatch {
  if (!isRecord(value)) return {}
  return {
    selectedCandidateId: typeof value.selectedCandidateId === "string" ? value.selectedCandidateId : undefined,
    trackUpdates: decodeFinalEditorTrackPatches(value.trackUpdates),
    clipUpdates: decodeFinalEditorClipPatches(value.clipUpdates),
  }
}

function decodeFinalEditorTrackPatches(value: unknown): readonly FinalEditorTrackPatch[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("final editor trackUpdates must be an array")
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string") throw new Error("final editor track patch requires id")
    return {
      id: item.id,
      visible: typeof item.visible === "boolean" ? item.visible : undefined,
      locked: typeof item.locked === "boolean" ? item.locked : undefined,
    }
  })
}

function decodeFinalEditorClipPatches(value: unknown): readonly FinalEditorClipPatch[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("final editor clipUpdates must be an array")
  return value.map((item) => {
    if (!isRecord(item) || typeof item.trackId !== "string" || typeof item.clipId !== "string") {
      throw new Error("final editor clip patch requires trackId and clipId")
    }
    const startSeconds = decodeNonNegativeNumber(item.startSeconds, "startSeconds")
    const durationSeconds = decodePositiveNumber(item.durationSeconds, "durationSeconds")
    return {
      trackId: item.trackId,
      clipId: item.clipId,
      label: typeof item.label === "string" ? item.label : undefined,
      startSeconds,
      durationSeconds,
      payloadJson: isJsonValue(item.payloadJson) ? item.payloadJson : undefined,
    }
  })
}

function decodeNonNegativeNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`final editor ${label} must be a non-negative number`)
  return value
}

function decodePositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`final editor ${label} must be a positive number`)
  return value
}

function decodeCreateWorkspaceBundle(value: JsonValue): CreateWorkspaceBundleInput {
  if (!isRecord(value)) return {}
  return { label: typeof value.label === "string" ? value.label : undefined }
}

function decodeImportWorkspaceBundle(value: JsonValue): ImportWorkspaceBundleInput {
  if (isRecord(value) && "bundle" in value) {
    return {
      bundle: isJsonValue(value.bundle) ? value.bundle : null,
      dryRun: value.dryRun === false ? false : true,
    }
  }
  return { bundle: value, dryRun: true }
}

function decodeReviewAttachment(value: JsonValue | undefined): ReviewAttachment {
  if (!isRecord(value)) throw new Error("note request requires attachedTo")
  if (!isReviewAttachmentKind(value.kind) || typeof value.id !== "string") throw new Error("note request requires valid attachment")
  return { kind: value.kind, id: value.id }
}

function isPersonaStatus(value: unknown): value is PersonaPatch["status"] {
  return value === "draft" || value === "promising" || value === "selected" || value === "paused"
}

function isCandidateStatus(value: unknown): value is CandidateStatus {
  return value === "queued"
    || value === "generating"
    || value === "ready"
    || value === "starred"
    || value === "rejected"
    || value === "needs-revision"
    || value === "exported"
}

function isBranchStatus(value: unknown): value is BranchStatus {
  return value === "active" || value === "promising" || value === "dead-end" || value === "merged" || value === "archived"
}

function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return value === "keep" || value === "fork" || value === "revise" || value === "reject" || value === "watch-again"
}

function isReviewAttachmentKind(value: unknown): value is ReviewAttachment["kind"] {
  return value === "persona" || value === "candidate" || value === "batch" || value === "branch" || value === "stage" || value === "reference-profile"
}

function isProviderJobStatus(value: unknown): value is CreateProviderJobInput["status"] {
  return value === "planned"
    || value === "queued"
    || value === "running"
    || value === "succeeded"
    || value === "failed"
    || value === "blocked"
    || value === "completed"
}

function isReferenceSourcePolicy(value: unknown): value is UgcReferenceArchive["sourcePolicy"] {
  return value === "metadata-only" || value === "abstract-mechanics" || value === "rights-cleared-source"
}

function isReferenceArchiveStatus(value: unknown): value is UgcReferenceArchive["archiveStatus"] {
  return value === "not-started" || value === "queued" || value === "sampled" || value === "decomposed"
}

function isResearchPlatform(value: unknown): value is UgcResearchPlatform {
  return value === "tiktok" || value === "instagram" || value === "youtube-shorts" || value === "web" || value === "internal"
}

function isResearchTargetStatus(value: unknown): value is UgcResearchTargetStatus {
  return value === "draft" || value === "queued" || value === "sampling" || value === "decomposed" || value === "blocked" || value === "done"
}

function isTemplateMiningJobStatus(value: unknown): value is UgcTemplateMiningJobStatus {
  return value === "planned" || value === "queued" || value === "running" || value === "ready" || value === "blocked" || value === "done"
}

function isCleanRoomTemplateCategory(value: unknown): value is CleanRoomTemplateSpec["category"] {
  return value === "format" || value === "pose" || value === "caption" || value === "hook" || value === "cta" || value === "persona-building"
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function decodeReferenceArchiveFormatOutputs(value: unknown): readonly ReferenceArchiveFormatOutput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const outputs: ReferenceArchiveFormatOutput[] = []
  for (const item of value) {
    if (!isRecord(item)) return undefined
    if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.summary !== "string") return undefined
    if (!isReferenceArchiveFormatOutputKind(item.kind)) return undefined
    if (!isStringArray(item.stageIds) || !isStringArray(item.candidateIds)) return undefined
    if (!isJsonValue(item.manifestJson)) return undefined
    outputs.push({
      id: item.id,
      title: item.title,
      kind: item.kind,
      summary: item.summary,
      stageIds: item.stageIds,
      candidateIds: item.candidateIds,
      manifestJson: item.manifestJson,
    })
  }
  return outputs
}

function isReferenceArchiveFormatOutputKind(value: unknown): value is ReferenceArchiveFormatOutput["kind"] {
  return value === "format-template" || value === "pose-plan" || value === "caption-template" || value === "hook-family" || value === "cta-pattern"
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!isRecord(value)) return false
  return Object.values(value).every(isJsonValue)
}

function json(value: object, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: corsHeaders({ "content-type": "application/json; charset=utf-8" }),
  })
}

function corsHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    ...extra,
  })
}
