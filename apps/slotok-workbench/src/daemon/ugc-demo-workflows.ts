import { toJsonValue, type AppendWorkflowEventInput, type CreateWorkflowRunInput, type UgcLocalState, type UgcReferenceArchive, type UgcWorkflowImportInput } from "../ugc/local-state"

export type UgcDemoWorkflowLane = "brainrot" | "ugc-ads"
export type UgcDemoWorkflowRouteLane = UgcDemoWorkflowLane | "all"

export interface UgcDemoWorkflowHandoff {
  readonly lane: UgcDemoWorkflowLane
  readonly runInput: CreateWorkflowRunInput
  readonly queuedEvent: AppendWorkflowEventInput
  readonly phaseEvent: AppendWorkflowEventInput
  readonly messageEvent: AppendWorkflowEventInput
  readonly completedEvent: AppendWorkflowEventInput
  readonly importInput: UgcWorkflowImportInput
}

const BRAINROT_REFERENCE_PROFILE_ID = "reference_tiktok_pleometric"
const BRAINROT_REFERENCE_ARCHIVE_ID = "archive_reference_tiktok_pleometric"
const UGC_ADS_REFERENCE_PROFILE_ID = "reference_tiktok_mynameissico"
const UGC_ADS_CANDIDATE_ID = "candidate_soft_demo_01"

const DEMO_GUARDRAILS = [
  "Local deterministic Slotok demo; no live Pi, OMP, or provider call was made.",
  "Use reference IDs, counts, abstract mechanics, and metadata summaries only.",
  "Do not use public reference media, URLs, local files, faces, voices, exact captions, brand marks, or source audio as generation input.",
]

export function createUgcDemoWorkflowHandoff(state: UgcLocalState, lane: UgcDemoWorkflowLane): UgcDemoWorkflowHandoff {
  if (lane === "brainrot") return createBrainrotDemoWorkflowHandoff(state)
  return createUgcAdsDemoWorkflowHandoff(state)
}

function createBrainrotDemoWorkflowHandoff(state: UgcLocalState): UgcDemoWorkflowHandoff {
  requireReferenceProfile(state, BRAINROT_REFERENCE_PROFILE_ID, "brainrot")
  const archive = requireReferenceArchive(state, BRAINROT_REFERENCE_ARCHIVE_ID, "brainrot")
  const artifactPaths = ["artifacts/workflows/demo/brainrot/handoff.json"]
  const result = toJsonValue({
    demo: true,
    lane: "brainrot",
    sourcePolicy: "abstract-mechanics",
    summary: "Created a local clean-room brainrot handoff from Pleometric TikTok reference mechanics.",
    referenceProfileIds: [BRAINROT_REFERENCE_PROFILE_ID],
    archiveIds: [BRAINROT_REFERENCE_ARCHIVE_ID],
    sampleClipCount: archive.sampleClipIds.length,
    formatOutputIds: archive.candidateFormatOutputs.map((output) => output.id),
    mechanics: ["fast open loop", "caption rhythm ladder", "escalating reaction beat", "loopable final beat"],
    blockedFields: ["source pixels", "source audio", "creator likeness", "exact caption text", "public media as generation input"],
  })

  return {
    lane: "brainrot",
    runInput: {
      title: "Demo brainrot workflow",
      source: "local",
      lane: "brainrot",
      status: "queued",
      scriptId: "slotok-demo-workflows",
      args: toJsonValue({ lane: "brainrot", deterministic: true, providerCalls: false }),
      currentPhase: "queued",
      counters: { references: 1, providerJobs: 1, candidatePatches: 0 },
      artifactPaths,
    },
    queuedEvent: demoEvent("queued", "queued", "Queued local brainrot demo workflow.", { lane: "brainrot" }, artifactPaths),
    phaseEvent: demoEvent("phase", "planning", "Built clean-room mechanics from Pleometric reference metadata.", { referenceProfileId: BRAINROT_REFERENCE_PROFILE_ID, archiveId: BRAINROT_REFERENCE_ARCHIVE_ID }, artifactPaths),
    messageEvent: demoEvent("message", "planning", "Prepared an abstract-mechanics handoff without live provider execution.", { sourcePolicy: "abstract-mechanics" }, artifactPaths),
    completedEvent: demoEvent("completed", "completed", "Completed local brainrot demo workflow.", { result }, artifactPaths),
    importInput: {
      lane: "brainrot",
      sourcePolicy: "abstract-mechanics",
      records: [{
        id: "demo_handoff_brainrot",
        kind: "slotok-demo-workflow-handoff",
        lane: "brainrot",
        sourcePolicy: "abstract-mechanics",
        referenceProfileIds: [BRAINROT_REFERENCE_PROFILE_ID],
        archiveIds: [BRAINROT_REFERENCE_ARCHIVE_ID],
      }],
      providerJobs: [{
        provider: "local",
        operation: "demo-brainrot-local-plan",
        mode: "dry-run",
        status: "completed",
        targetIds: [BRAINROT_REFERENCE_PROFILE_ID, BRAINROT_REFERENCE_ARCHIVE_ID],
        spendCapUsd: 0,
        estimatedCostUsd: 0,
        request: toJsonValue({
          lane: "brainrot",
          sourcePolicy: "abstract-mechanics",
          providerCalls: false,
          referenceProfileIds: [BRAINROT_REFERENCE_PROFILE_ID],
          archiveIds: [BRAINROT_REFERENCE_ARCHIVE_ID],
          sampleClipCount: archive.sampleClipIds.length,
          requestedOutput: "browser-visible local workflow proof",
          cleanRoomInputs: ["timing", "hook family", "caption rhythm", "loop structure"],
        }),
        response: result,
        artifactPaths,
      }],
      referenceArchives: [{
        referenceProfileId: BRAINROT_REFERENCE_PROFILE_ID,
        sourcePolicy: "abstract-mechanics",
        archiveStatus: "decomposed",
        preservedMechanics: toJsonValue({
          lane: "brainrot",
          referenceProfileId: BRAINROT_REFERENCE_PROFILE_ID,
          archiveId: BRAINROT_REFERENCE_ARCHIVE_ID,
          sampleClipCount: archive.sampleClipIds.length,
          formatOutputCount: archive.candidateFormatOutputs.length,
          mechanics: ["open loop", "rapid caption cadence", "reaction escalation", "loopable payoff"],
        }),
        swappedFields: ["creator identity", "face", "voice", "exact captions", "music", "setting"],
        blockedFields: ["source pixels", "source audio", "creator likeness", "exact caption text", "public media as generation input"],
        guardrails: DEMO_GUARDRAILS,
        candidateFormatOutputs: [{
          id: "format_demo_brainrot_abstract_mechanics",
          title: "Demo brainrot abstract mechanics handoff",
          kind: "format-template",
          summary: "Clean-room brainrot structure derived from metadata and mechanics only.",
          stageIds: ["stage_reference_profile", "stage_hook", "stage_edit_style"],
          candidateIds: [],
          manifestJson: toJsonValue({
            lane: "brainrot",
            sourcePolicy: "abstract-mechanics",
            referenceProfileIds: [BRAINROT_REFERENCE_PROFILE_ID],
            archiveIds: [BRAINROT_REFERENCE_ARCHIVE_ID],
            sampleClipCount: archive.sampleClipIds.length,
            directGenerationInput: false,
          }),
        }],
        notes: ["Demo handoff imported locally from abstract Pleometric mechanics only.", ...DEMO_GUARDRAILS],
      }],
      artifactPaths,
      result,
      metadata: toJsonValue({ lane: "brainrot", demo: true, deterministic: true, liveProviderCalls: false }),
    },
  }
}

function createUgcAdsDemoWorkflowHandoff(state: UgcLocalState): UgcDemoWorkflowHandoff {
  requireReferenceProfile(state, UGC_ADS_REFERENCE_PROFILE_ID, "ugc-ads")
  const archive = requireReferenceArchiveByProfileId(state, UGC_ADS_REFERENCE_PROFILE_ID, "ugc-ads")
  requireCandidate(state, UGC_ADS_CANDIDATE_ID, "ugc-ads")
  const vendorArchives = importedVendorArchives(state)
  if (vendorArchives.length === 0) {
    throw new Error("demo workflow ugc-ads requires at least one imported provider reference asset manifest")
  }
  const artifactPaths = ["artifacts/workflows/demo/ugc-ads/handoff.json"]
  const vendorArchiveIds = vendorArchives.map((item) => item.id)
  const vendorReferenceProfileIds = vendorArchives.map((item) => item.referenceProfileId)
  const vendorAssetCount = vendorArchives.reduce((count, item) => count + item.referenceAssets.length, 0)
  const result = toJsonValue({
    demo: true,
    lane: "ugc-ads",
    sourcePolicy: "metadata-only",
    summary: "Created a local UGC ads handoff from MyNameIsSico reference metadata, imported provider manifest summaries, and the soft demo candidate.",
    candidateIds: [UGC_ADS_CANDIDATE_ID],
    referenceProfileIds: [UGC_ADS_REFERENCE_PROFILE_ID],
    archiveIds: [archive.id],
    vendorReferenceProfileIds,
    vendorArchiveIds,
    vendorAssetCount,
    candidateUpdate: "ready",
    blockedFields: ["public media as generation input", "provider demo reuse", "source face", "source voice", "exact captions", "brand marks"],
  })

  return {
    lane: "ugc-ads",
    runInput: {
      title: "Demo UGC ads workflow",
      source: "local",
      lane: "ugc-ads",
      status: "queued",
      scriptId: "slotok-demo-workflows",
      args: toJsonValue({ lane: "ugc-ads", deterministic: true, providerCalls: false, candidateId: UGC_ADS_CANDIDATE_ID }),
      currentPhase: "queued",
      counters: { references: 1 + vendorArchives.length, providerJobs: 1, candidatePatches: 1 },
      artifactPaths,
    },
    queuedEvent: demoEvent("queued", "queued", "Queued local UGC ads demo workflow.", { lane: "ugc-ads" }, artifactPaths),
    phaseEvent: demoEvent("phase", "planning", "Built metadata-only UGC ad plan from MyNameIsSico and imported provider manifest summaries.", { referenceProfileId: UGC_ADS_REFERENCE_PROFILE_ID, candidateId: UGC_ADS_CANDIDATE_ID }, artifactPaths),
    messageEvent: demoEvent("message", "planning", "Prepared candidate update and local planning job without direct generation inputs.", { sourcePolicy: "metadata-only", vendorArchiveIds }, artifactPaths),
    completedEvent: demoEvent("completed", "completed", "Completed local UGC ads demo workflow.", { result }, artifactPaths),
    importInput: {
      lane: "ugc-ads",
      sourcePolicy: "metadata-only",
      records: [{
        id: "demo_handoff_ugc_ads",
        kind: "slotok-demo-workflow-handoff",
        lane: "ugc-ads",
        sourcePolicy: "metadata-only",
        candidateIds: [UGC_ADS_CANDIDATE_ID],
        referenceProfileIds: [UGC_ADS_REFERENCE_PROFILE_ID],
        archiveIds: [archive.id],
        vendorReferenceProfileIds,
        vendorArchiveIds,
      }],
      providerJobs: [{
        provider: "local",
        operation: "demo-ugc-ads-local-plan",
        mode: "dry-run",
        status: "completed",
        targetIds: [UGC_ADS_CANDIDATE_ID, UGC_ADS_REFERENCE_PROFILE_ID, archive.id, ...vendorReferenceProfileIds, ...vendorArchiveIds],
        spendCapUsd: 0,
        estimatedCostUsd: 0,
        request: toJsonValue({
          lane: "ugc-ads",
          sourcePolicy: "metadata-only",
          providerCalls: false,
          candidateIds: [UGC_ADS_CANDIDATE_ID],
          referenceProfileIds: [UGC_ADS_REFERENCE_PROFILE_ID],
          archiveIds: [archive.id],
          vendorReferenceProfileIds,
          vendorArchiveIds,
          vendorAssetCount,
          requestedOutput: "browser-visible local workflow proof",
          cleanRoomInputs: ["hook angle", "proof beat", "caption cadence", "edit layer plan"],
        }),
        response: result,
        artifactPaths,
      }],
      referenceArchives: [{
        referenceProfileId: UGC_ADS_REFERENCE_PROFILE_ID,
        sourcePolicy: "metadata-only",
        archiveStatus: "decomposed",
        preservedMechanics: toJsonValue({
          lane: "ugc-ads",
          referenceProfileId: UGC_ADS_REFERENCE_PROFILE_ID,
          archiveId: archive.id,
          sampleClipCount: archive.sampleClipIds.length,
          vendorReferenceProfileIds,
          vendorArchiveIds,
          vendorAssetCount,
          mechanics: ["soft direct-address hook", "product proof insert", "low-pressure CTA", "editable captions"],
        }),
        swappedFields: ["creator identity", "face", "voice", "exact captions", "product", "CTA"],
        blockedFields: ["source pixels", "source audio", "provider demo reuse", "actor cloning", "brand marks", "public media as generation input"],
        guardrails: DEMO_GUARDRAILS,
        candidateFormatOutputs: [{
          id: "format_demo_ugc_ads_metadata_handoff",
          title: "Demo UGC ads metadata handoff",
          kind: "format-template",
          summary: "Metadata-only UGC ads handoff combining TikTok reference mechanics, provider manifest summaries, and the soft demo candidate.",
          stageIds: ["stage_reference_profile", "stage_hook", "stage_proof_demo", "stage_cta"],
          candidateIds: [UGC_ADS_CANDIDATE_ID],
          manifestJson: toJsonValue({
            lane: "ugc-ads",
            sourcePolicy: "metadata-only",
            candidateIds: [UGC_ADS_CANDIDATE_ID],
            referenceProfileIds: [UGC_ADS_REFERENCE_PROFILE_ID],
            archiveIds: [archive.id],
            vendorReferenceProfileIds,
            vendorArchiveIds,
            vendorAssetCount,
            directGenerationInput: false,
          }),
        }],
        notes: ["Demo handoff imported locally from metadata and abstract mechanics only.", ...DEMO_GUARDRAILS],
      }],
      candidatePatches: [{
        candidateId: UGC_ADS_CANDIDATE_ID,
        status: "ready",
        notes: [{
          verdict: "keep",
          body: "Demo workflow marked this candidate ready after a local metadata-only UGC ads handoff import.",
          requestedChange: null,
        }],
      }],
      artifactPaths,
      result,
      metadata: toJsonValue({ lane: "ugc-ads", demo: true, deterministic: true, liveProviderCalls: false, vendorAssetCount }),
    },
  }
}

function demoEvent(type: AppendWorkflowEventInput["type"], phase: string, message: string, payload: object, artifactPaths: readonly string[]): AppendWorkflowEventInput {
  return {
    type,
    phase,
    message,
    payload: toJsonValue(payload),
    artifactPaths,
  }
}

function requireReferenceProfile(state: UgcLocalState, referenceProfileId: string, lane: UgcDemoWorkflowLane): void {
  if (!state.workspace.referenceProfiles.some((profile) => profile.id === referenceProfileId)) {
    throw new Error(`demo workflow ${lane} requires reference profile ${referenceProfileId}; import the local reference catalog first`)
  }
}

function requireReferenceArchive(state: UgcLocalState, archiveId: string, lane: UgcDemoWorkflowLane): UgcReferenceArchive {
  const archive = state.referenceArchives.find((item) => item.id === archiveId)
  if (!archive) throw new Error(`demo workflow ${lane} requires reference archive ${archiveId}; import the local reference catalog first`)
  return archive
}

function requireReferenceArchiveByProfileId(state: UgcLocalState, referenceProfileId: string, lane: UgcDemoWorkflowLane): UgcReferenceArchive {
  const archive = state.referenceArchives.find((item) => item.referenceProfileId === referenceProfileId)
  if (!archive) throw new Error(`demo workflow ${lane} requires an imported reference archive for ${referenceProfileId}`)
  return archive
}

function requireCandidate(state: UgcLocalState, candidateId: string, lane: UgcDemoWorkflowLane): void {
  if (!state.workspace.candidates.some((candidate) => candidate.id === candidateId)) {
    throw new Error(`demo workflow ${lane} requires candidate ${candidateId}`)
  }
}

function importedVendorArchives(state: UgcLocalState): readonly UgcReferenceArchive[] {
  return state.referenceArchives
    .filter((archive) => archive.referenceProfileId.startsWith("reference_provider_") && archive.referenceAssets.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
}
