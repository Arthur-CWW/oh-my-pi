import { UgcJsonStore } from "./ugc-json-store"
import { isRecord, type BranchPatch, type CandidateStatusPatch, type CreateExportManifestInput, type CreateProviderJobInput, type CreateReferenceArchiveInput, type CreateReviewNoteInput, type CreateWorkspaceBundleInput, type ImportWorkspaceBundleInput, type PersonaPatch, type ReferenceArchiveFormatOutput, type UgcReferenceArchive } from "../ugc/local-state"
import type { BranchStatus, CandidateStatus, JsonValue, ReviewAttachment, ReviewVerdict } from "../renderer/ugcStudioModel"

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

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/candidates/") && url.pathname.endsWith("/status")) {
    const id = decodeURIComponent(url.pathname.slice("/api/ugc/candidates/".length, -"/status".length))
    if (!id) return json({ error: "missing candidate id" }, 400)
    return json(store.updateCandidate(id, decodeCandidateStatusPatch(await readJson(request))))
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

function decodeBranchPatch(value: JsonValue): BranchPatch {
  if (!isRecord(value)) return {}
  return {
    ...(isBranchStatus(value.status) ? { status: value.status } : {}),
    ...(typeof value.decisionNote === "string" ? { decisionNote: value.decisionNote } : {}),
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
  if (value.provider !== "kie" && value.provider !== "jimeng" && value.provider !== "local") throw new Error("provider job requires provider")
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
  return value === "queued" || value === "planned" || value === "running" || value === "completed" || value === "failed"
}

function isReferenceSourcePolicy(value: unknown): value is UgcReferenceArchive["sourcePolicy"] {
  return value === "metadata-only" || value === "abstract-mechanics" || value === "rights-cleared-source"
}

function isReferenceArchiveStatus(value: unknown): value is UgcReferenceArchive["archiveStatus"] {
  return value === "not-started" || value === "queued" || value === "sampled" || value === "decomposed"
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
