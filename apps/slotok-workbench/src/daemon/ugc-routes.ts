import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { decodeCodexAnalyzeInput, planKieFromAnalysis, prepareCodexAnalyze, prepareKieTask, runCodexAnalyze, type CodexAnalyzeInput, type CodexAnalyzeResult, type CodexLiveOptions, type CodexPreparedResult, type JsonValue as UgcCliJsonValue, type KieAnalysisPlanOperation, type KieAnalysisPlanTarget, type KieGenerateRequest, type KieProductLane } from "@wirebabel/ugc-cli"
import { UgcJsonStore } from "./ugc-json-store"
import { prepareCodexVideoFrames, type CodexFramePreparation, type CodexVideoFrameExtractor } from "./codex-video-frames"
import { createUgcDemoWorkflowHandoff, type UgcDemoWorkflowHandoff, type UgcDemoWorkflowLane, type UgcDemoWorkflowRouteLane } from "./ugc-demo-workflows"
import { isRecord, toJsonValue, type AppendWorkflowEventInput, type BranchPatch, type BulkCandidateStatusPatch, type CandidateStatusPatch, type CleanRoomTemplateSpec, type CreateBranchInput, type CreateExportManifestInput, type CreateProviderJobInput, type CreateReferenceArchiveInput, type CreateResearchTargetInput, type CreateReviewNoteInput, type CreateTemplateMiningJobInput, type CreateWorkflowRunInput, type CreateWorkspaceBundleInput, type FinalEditorClipPatch, type FinalEditorPatch, type FinalEditorTrackPatch, type ImportWorkspaceBundleInput, type PersonaPatch, type ProviderJobPatch, type ReferenceArchiveFormatOutput, type ResearchTargetPatch, type TemplateMiningJobPatch, type UgcLocalState, type UgcReferenceArchive, type UgcReferenceCatalogImportInput, type UgcResearchPlatform, type UgcResearchTargetStatus, type UgcTemplateMiningJobStatus, type UgcWorkflowCounters, type UgcWorkflowEvent, type UgcWorkflowEventType, type UgcWorkflowImportInput, type UgcWorkflowImportResult, type UgcWorkflowRun, type UgcWorkflowRunSource, type UgcWorkflowRunStatus } from "../ugc/local-state"
import type { BranchStatus, CandidateStatus, JsonValue, ReviewAttachment, ReviewVerdict } from "../renderer/ugcStudioModel"

interface CodexAnalysisJobRequest {
  readonly input: CodexAnalyzeInput
  readonly live: boolean
  readonly maxSpendUsd?: number
  readonly apiKey?: string
  readonly posterUrl?: string | null
  readonly candidateId?: string
}

interface CandidateCodexAnalysisJobRequest {
  readonly prompt?: string
  readonly model?: string
  readonly maxOutputTokens?: number
  readonly referenceFrameUrls?: readonly string[]
  readonly live: boolean
  readonly maxSpendUsd?: number
  readonly apiKey?: string
}

interface CodexFramePreparationContext {
  readonly posterUrl?: string | null
  readonly targetId?: string
  readonly candidateId?: string
}

interface AnalysisToKieJobRequest {
  readonly analysisJobId: string
  readonly lane: KieProductLane
  readonly targetId?: string
  readonly targetKind?: "candidate" | "reference"
  readonly operation?: KieAnalysisPlanOperation
  readonly aspectRatio?: string
  readonly durationSec?: number
  readonly resolution?: string
  readonly quality?: KieGenerateRequest["quality"]
}

type CodexAnalyzeRunner = (input: CodexAnalyzeInput, options: CodexLiveOptions) => Promise<CodexAnalyzeResult>

interface CodexLiveFailureRecord {
  readonly status: "failed" | "blocked"
  readonly statusCode: number
  readonly message: string
}

interface AnalysisTargetResolution {
  readonly target: KieAnalysisPlanTarget
  readonly targetIds: readonly string[]
}

interface AnalysisToKieMetadata {
  readonly sourceProvider: "codex"
  readonly sourceJobId: string
  readonly lane: KieProductLane
  readonly target: KieAnalysisPlanTarget
}

export interface RouteUgcOptions {
  readonly codexFrameExtractor?: CodexVideoFrameExtractor
  readonly codexAnalyzeRunner?: CodexAnalyzeRunner
}

interface WorkflowSseClient {
  readonly id: string
  lastEventId: number
  readonly controller: ReadableStreamDefaultController<Uint8Array>
  readonly heartbeatId: ReturnType<typeof setInterval>
  readonly pollId: ReturnType<typeof setInterval>
}

interface WorkflowImportRouteRequest {
  readonly payload: UgcWorkflowImportInput
  readonly dryRun: boolean
}

interface DemoWorkflowRouteRequest {
  readonly lane: UgcDemoWorkflowRouteLane
}

const WORKFLOW_SSE_MAX_CLIENTS = 16
const WORKFLOW_SSE_HEARTBEAT_MS = 15_000
const WORKFLOW_SSE_POLL_MS = 1_000
const workflowSseEncoder = new TextEncoder()
const workflowSseClients = new Set<WorkflowSseClient>()

export async function routeUgc(request: Request, store: UgcJsonStore, options: RouteUgcOptions = {}): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/ugc/")) return null

  if (request.method === "GET" && url.pathname === "/api/ugc/workspace") {
    return json(store.read())
  }

  if (request.method === "GET" && url.pathname === "/api/ugc/workspaces") {
    return json({ workspaces: [store.summary()] })
  }

  if (request.method === "GET" && url.pathname === "/api/ugc/workflows/events/stream") {
    const afterEventId = decodeAfterEventId(url.searchParams.get("after"))
    return workflowEventsStream(store, afterEventId)
  }

  if (request.method === "GET" && url.pathname === "/api/ugc/workflows") {
    return json({ workflowRuns: store.listWorkflowRuns() })
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/workflows/demo") {
    const decoded = decodeDemoWorkflowRouteRequest(await readJson(request))
    try {
      return json(launchDemoWorkflows(store, decoded), 201)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "demo workflow launch failed" }, 409)
    }
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/workflows") {
    return json({ workflowRun: store.createWorkflowRun(decodeCreateWorkflowRun(await readJson(request))) }, 201)
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/workflows/") && url.pathname.endsWith("/import")) {
    const runId = decodeURIComponent(url.pathname.slice("/api/ugc/workflows/".length, -"/import".length))
    if (!runId) return json({ error: "missing workflow run id" }, 400)
    const decoded = decodeWorkflowImportRequest(await readJson(request))
    const result = store.importWorkflowHandoff(runId, decoded.payload, decoded.dryRun)
    for (const event of result.events) broadcastWorkflowEvent(event)
    return json(result, result.imported ? 201 : 200)
  }

  if (url.pathname.startsWith("/api/ugc/workflows/") && url.pathname.endsWith("/events")) {
    const runId = decodeURIComponent(url.pathname.slice("/api/ugc/workflows/".length, -"/events".length))
    if (!runId) return json({ error: "missing workflow run id" }, 400)
    if (request.method === "GET") {
      return json({ events: store.listWorkflowEvents(runId, decodeAfterEventId(url.searchParams.get("after"))) })
    }
    if (request.method === "POST") {
      const event = store.appendWorkflowEvent(runId, decodeAppendWorkflowEvent(await readJson(request)))
      broadcastWorkflowEvent(event)
      return json({ event, workflowRun: store.listWorkflowRuns().find((run) => run.id === runId) ?? null }, 201)
    }
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

  if (request.method === "POST" && url.pathname === "/api/ugc/reference-catalog/plan") {
    return json(store.planReferenceCatalogImport(decodeReferenceCatalogImport(await readJson(request))))
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/reference-catalog/import") {
    return json(store.importReferenceCatalog(decodeReferenceCatalogImport(await readJson(request))))
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

  if (request.method === "POST" && url.pathname.startsWith("/api/ugc/codex/candidates/") && url.pathname.endsWith("/analyze-video")) {
    const candidateId = decodeURIComponent(url.pathname.slice("/api/ugc/codex/candidates/".length, -"/analyze-video".length))
    if (!candidateId) return json({ error: "missing candidate id" }, 400)
    const state = store.read()
    const candidate = state.workspace.candidates.find((item) => item.id === candidateId)
    if (!candidate) throw new Error(`candidate not found: ${candidateId}`)
    if (!candidate.preview.videoUrl) throw new Error(`candidate has no preview video: ${candidateId}`)
    const decoded = decodeCandidateCodexAnalysisJobRequest(await readJson(request))
    const input: CodexAnalyzeInput = {
      operation: "video-understand",
      mediaUrl: candidate.preview.videoUrl,
      workspaceId: state.workspace.id,
      targetIds: [candidateId],
      ...(decoded.prompt ? { prompt: decoded.prompt } : {}),
      ...(decoded.model ? { model: decoded.model } : {}),
      ...(decoded.maxOutputTokens === undefined ? {} : { maxOutputTokens: decoded.maxOutputTokens }),
      ...(decoded.referenceFrameUrls ? { referenceFrameUrls: decoded.referenceFrameUrls } : {}),
    }
    return await createCodexProviderJob(store, options, {
      input,
      live: decoded.live,
      maxSpendUsd: decoded.maxSpendUsd,
      apiKey: decoded.apiKey,
    }, {
      posterUrl: candidate.preview.posterUrl,
      targetId: candidateId,
      candidateId,
    })
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
    const decoded = decodeCodexAnalysisJobRequest(await readJson(request))
    const framePreparation = await prepareCodexVideoFrames({
      workspaceDir: store.config.workspaceDir,
      operation: decoded.input.operation,
      mediaUrl: decoded.input.mediaUrl,
      posterUrl: decoded.posterUrl,
      referenceFrameUrls: decoded.input.referenceFrameUrls,
      targetId: decoded.candidateId ?? decoded.input.targetIds?.[0],
      candidateId: decoded.candidateId,
      frameExtractor: options.codexFrameExtractor,
      extractLocalFrames: false,
    })
    const prepared = prepareCodexAnalyze({
      ...decoded.input,
      mediaUrl: framePreparation.mediaUrl,
      referenceFrameUrls: framePreparation.referenceFrameUrls,
    })
    return json(decoded.input.operation === "video-understand" ? { ...prepared, framePreparation } : prepared)
  }

  if (request.method === "POST" && (url.pathname === "/api/ugc/codex/jobs" || url.pathname === "/api/ugc/codex/create")) {
    const decoded = decodeCodexAnalysisJobRequest(await readJson(request))
    return await createCodexProviderJob(store, options, decoded, {
      posterUrl: decoded.posterUrl,
      targetId: decoded.candidateId ?? decoded.input.targetIds?.[0],
      candidateId: decoded.candidateId,
    })
  }

  if (request.method === "POST" && url.pathname === "/api/ugc/kie/analysis-to-kie") {
    return createKieProviderJobFromAnalysis(store, decodeAnalysisToKieJobRequest(await readJson(request)))
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

async function createCodexProviderJob(store: UgcJsonStore, options: RouteUgcOptions, decoded: CodexAnalysisJobRequest, context: CodexFramePreparationContext): Promise<Response> {
  const framePreparation = await prepareCodexVideoFrames({
    workspaceDir: store.config.workspaceDir,
    operation: decoded.input.operation,
    mediaUrl: decoded.input.mediaUrl,
    posterUrl: context.posterUrl,
    referenceFrameUrls: decoded.input.referenceFrameUrls,
    targetId: context.targetId,
    candidateId: context.candidateId,
    frameExtractor: options.codexFrameExtractor,
    extractLocalFrames: !decoded.live,
  })
  const preparedInput: CodexAnalyzeInput = {
    ...decoded.input,
    mediaUrl: framePreparation.mediaUrl,
    referenceFrameUrls: framePreparation.referenceFrameUrls,
  }

  let prepared: CodexPreparedResult
  try {
    if (decoded.live) assertLiveCodexFrameRefsReachable(preparedInput, framePreparation)
    prepared = prepareCodexAnalyze(preparedInput)
  } catch (error) {
    if (!decoded.live) throw error
    const failure = codexLiveFailure(error instanceof Error ? error : new Error(String(error)), "blocked")
    const state = store.createProviderJob({
      provider: "codex",
      operation: preparedInput.operation,
      mode: "live",
      status: failure.status,
      targetIds: preparedInput.targetIds ?? [],
      spendCapUsd: decoded.maxSpendUsd ?? 0,
      estimatedCostUsd: null,
      request: encodeUnpreparedCodexRequest(preparedInput, framePreparation),
      response: toJsonValue({ phase: "live-preparation", error: { message: failure.message } }),
      error: failure.message,
      artifactPaths: framePreparation.artifactPaths,
    })
    return json({ job: state.providerJobs[0], error: failure.message, framePreparation, state }, failure.statusCode)
  }

  const request = encodePreparedCodexRequest(prepared, framePreparation)
  if (!decoded.live) {
    const state = store.createProviderJob({
      provider: "codex",
      operation: preparedInput.operation,
      mode: "dry-run",
      status: "planned",
      targetIds: preparedInput.targetIds ?? [],
      spendCapUsd: decoded.maxSpendUsd ?? prepared.estimatedCostUsd,
      estimatedCostUsd: prepared.estimatedCostUsd,
      request,
      artifactPaths: framePreparation.artifactPaths,
    })
    return json({ job: state.providerJobs[0], prepared, framePreparation, state })
  }

  const liveMaxSpendUsd = decoded.maxSpendUsd
  const liveApiKey = decoded.apiKey
  if (liveMaxSpendUsd === undefined || !liveApiKey) {
    const message = liveMaxSpendUsd === undefined ? "Codex live analysis requires maxSpendUsd" : "Codex live analysis requires an explicit apiKey"
    const state = store.createProviderJob({
      provider: "codex",
      operation: preparedInput.operation,
      mode: "live",
      status: "failed",
      targetIds: preparedInput.targetIds ?? [],
      spendCapUsd: liveMaxSpendUsd ?? 0,
      estimatedCostUsd: prepared.estimatedCostUsd,
      request,
      response: toJsonValue({ phase: "live-requirements", error: { message } }),
      error: message,
      artifactPaths: framePreparation.artifactPaths,
    })
    return json({ job: state.providerJobs[0], prepared, error: message, framePreparation, state }, 400)
  }

  try {
    const runner = options.codexAnalyzeRunner ?? runCodexAnalyze
    const result = await runner(preparedInput, {
      apiKey: liveApiKey,
      maxSpendUsd: liveMaxSpendUsd,
    })
    const state = store.createProviderJob({
      provider: "codex",
      operation: preparedInput.operation,
      mode: "live",
      status: "succeeded",
      targetIds: preparedInput.targetIds ?? [],
      spendCapUsd: liveMaxSpendUsd,
      estimatedCostUsd: result.prepared.estimatedCostUsd,
      request: encodePreparedCodexRequest(result.prepared, framePreparation),
      response: result.response,
      artifactPaths: framePreparation.artifactPaths,
    })
    return json({ job: state.providerJobs[0], result, framePreparation, state })
  } catch (error) {
    const failure = codexLiveFailure(error instanceof Error ? error : new Error(String(error)), "failed")
    const state = store.createProviderJob({
      provider: "codex",
      operation: preparedInput.operation,
      mode: "live",
      status: failure.status,
      targetIds: preparedInput.targetIds ?? [],
      spendCapUsd: liveMaxSpendUsd,
      estimatedCostUsd: prepared.estimatedCostUsd,
      request,
      response: toJsonValue({ phase: "live-execution", error: { message: failure.message } }),
      error: failure.message,
      artifactPaths: framePreparation.artifactPaths,
    })
    return json({ job: state.providerJobs[0], prepared, error: failure.message, framePreparation, state }, failure.statusCode)
  }
}

function createKieProviderJobFromAnalysis(store: UgcJsonStore, decoded: AnalysisToKieJobRequest): Response {
  const state = store.read()
  const sourceJob = state.providerJobs.find((job) => job.id === decoded.analysisJobId)
  if (!sourceJob) return json({ error: `analysis job not found: ${decoded.analysisJobId}` }, 404)
  if (sourceJob.provider !== "codex") return json({ error: `analysis-to-kie requires a Codex provider job: ${decoded.analysisJobId}` }, 400)

  const resolved = resolveAnalysisTarget(state, sourceJob.targetIds, decoded)
  const kieRequest = planKieFromAnalysis({
    lane: decoded.lane,
    target: resolved.target,
    codexRequest: toUgcCliJsonValue(sourceJob.request),
    codexResponse: sourceJob.response === null ? null : toUgcCliJsonValue(sourceJob.response),
    ...(decoded.operation ? { operation: decoded.operation } : {}),
    ...(decoded.aspectRatio ? { aspectRatio: decoded.aspectRatio } : {}),
    ...(decoded.durationSec === undefined ? {} : { durationSec: decoded.durationSec }),
    ...(decoded.resolution ? { resolution: decoded.resolution } : {}),
    ...(decoded.quality ? { quality: decoded.quality } : {}),
  })
  const prepared = prepareKieTask(kieRequest)
  const analysisToKie: AnalysisToKieMetadata = {
    sourceProvider: "codex",
    sourceJobId: sourceJob.id,
    lane: decoded.lane,
    target: resolved.target,
  }
  const updatedState = store.createProviderJob({
    provider: "kie",
    operation: "analysis-to-kie",
    mode: "dry-run",
    status: "planned",
    targetIds: resolved.targetIds.length > 0 ? resolved.targetIds : [sourceJob.id],
    spendCapUsd: prepared.estimatedCostUsd,
    estimatedCostUsd: prepared.estimatedCostUsd,
    request: toJsonValue({ ...prepared, kieRequest, analysisToKie }),
    artifactPaths: [],
  })
  return json({ job: updatedState.providerJobs[0], kieRequest, prepared, sourceJob, target: resolved.target, state: updatedState })
}

function launchDemoWorkflows(store: UgcJsonStore, request: DemoWorkflowRouteRequest): { readonly workflowRuns: readonly UgcWorkflowRun[]; readonly importResults: readonly UgcWorkflowImportResult[] } {
  const lanes: readonly UgcDemoWorkflowLane[] = request.lane === "all" ? ["brainrot", "ugc-ads"] : [request.lane]
  const workflowRuns: UgcWorkflowRun[] = []
  const importResults: UgcWorkflowImportResult[] = []

  for (const lane of lanes) {
    const handoff = createUgcDemoWorkflowHandoff(store.read(), lane)
    writeDemoWorkflowArtifacts(store, handoff)
    const created = store.createWorkflowRun(handoff.runInput)
    const queuedEvent = store.appendWorkflowEvent(created.id, handoff.queuedEvent)
    const phaseEvent = store.appendWorkflowEvent(created.id, handoff.phaseEvent)
    const messageEvent = store.appendWorkflowEvent(created.id, handoff.messageEvent)
    for (const event of [queuedEvent, phaseEvent, messageEvent]) broadcastWorkflowEvent(event)

    const importResult = store.importWorkflowHandoff(created.id, handoff.importInput, false)
    for (const event of importResult.events) broadcastWorkflowEvent(event)
    if (!importResult.valid || !importResult.imported) {
      throw new Error(importResult.errors[0] ?? `demo workflow ${lane} import failed`)
    }

    const completedEvent = store.appendWorkflowEvent(created.id, {
      ...handoff.completedEvent,
      payload: toJsonValue({ completion: handoff.completedEvent.payload ?? null, plannedChanges: importResult.plannedChanges }),
    })
    broadcastWorkflowEvent(completedEvent)
    const workflowRun = store.listWorkflowRuns().find((run) => run.id === created.id)
    if (!workflowRun) throw new Error(`demo workflow ${lane} run disappeared after launch`)
    workflowRuns.push(workflowRun)
    importResults.push(importResult)
  }
  return { workflowRuns, importResults }
}

function writeDemoWorkflowArtifacts(store: UgcJsonStore, handoff: UgcDemoWorkflowHandoff): void {
  const artifactPath = handoff.runInput.artifactPaths?.[0]
  if (typeof artifactPath !== "string" || artifactPath.trim().length === 0) return
  const absolutePath = resolve(store.config.cwd, artifactPath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, `${JSON.stringify(handoff.importInput, null, 2)}\n`)
}


function resolveAnalysisTarget(state: UgcLocalState, sourceTargetIds: readonly string[], decoded: AnalysisToKieJobRequest): AnalysisTargetResolution {
  const targetId = decoded.targetId ?? sourceTargetIds[0]
  const candidate = targetId ? state.workspace.candidates.find((item) => item.id === targetId) : undefined
  if (candidate && decoded.targetKind !== "reference") {
    const transcript = candidate.preview.transcript.map((line) => line.text).join(" ")
    const visibleInputs = candidate.preview.visibleInputs.map((item) => `${item.label}: ${item.value}`)
    return {
      targetIds: [candidate.id],
      target: {
        kind: "candidate",
        id: candidate.id,
        title: candidate.title,
        summary: transcript || visibleInputs.join("; ") || undefined,
        lane: candidate.kind,
        notes: [...candidate.scorecard.issues, ...candidate.tags],
        metadata: toUgcCliJsonValue(toJsonValue({
          stageId: candidate.stageId,
          batchId: candidate.batchId,
          personaId: candidate.personaId,
          referenceProfileId: candidate.referenceProfileId,
          visibleInputs,
          scorecard: candidate.scorecard,
        })),
      },
    }
  }

  const referenceProfile = targetId ? state.workspace.referenceProfiles.find((item) => item.id === targetId) : undefined
  if (referenceProfile) {
    return {
      targetIds: [referenceProfile.id],
      target: {
        kind: "reference",
        id: referenceProfile.id,
        title: referenceProfile.displayName,
        summary: referenceProfile.useCase,
        lane: referenceProfile.styleLane,
        notes: referenceProfile.cleanRoomBoundary,
        metadata: toUgcCliJsonValue(toJsonValue({
          platform: referenceProfile.platform,
          handle: referenceProfile.handle,
          rightsStatus: referenceProfile.rightsStatus,
          archiveStatus: referenceProfile.archiveStatus,
          extractedMechanics: referenceProfile.extractedMechanics,
        })),
      },
    }
  }

  const referenceArchive = targetId ? state.referenceArchives.find((item) => item.id === targetId || item.referenceProfileId === targetId) : undefined
  if (referenceArchive) {
    return {
      targetIds: [referenceArchive.referenceProfileId],
      target: {
        kind: "reference",
        id: referenceArchive.referenceProfileId,
        title: referenceArchive.title,
        summary: referenceArchive.notes.join("; ") || undefined,
        lane: referenceArchive.sourcePolicy,
        notes: referenceArchive.guardrails,
        metadata: toUgcCliJsonValue(toJsonValue({
          archiveStatus: referenceArchive.archiveStatus,
          preservedMechanics: referenceArchive.preservedMechanics,
          candidateFormatOutputs: referenceArchive.candidateFormatOutputs.map((item) => ({ id: item.id, title: item.title, kind: item.kind, summary: item.summary })),
        })),
      },
    }
  }

  const fallbackKind = decoded.targetKind ?? "candidate"
  const fallbackId = targetId ?? decoded.analysisJobId
  return {
    targetIds: targetId ? [targetId] : [],
    target: {
      kind: fallbackKind,
      id: fallbackId,
      title: fallbackId,
      summary: `Codex ${sourceTargetIds.length > 0 ? "target" : "analysis job"} ${decoded.analysisJobId}`,
    },
  }
}

function encodeUnpreparedCodexRequest(input: CodexAnalyzeInput, framePreparation: CodexFramePreparation): JsonValue {
  return toJsonValue({ provider: "codex", operation: input.operation, input, framePreparation })
}

function codexLiveFailure(error: Error, defaultStatus: "failed" | "blocked"): CodexLiveFailureRecord {
  const message = error.message
  const blocked = defaultStatus === "blocked" || message.includes("exceeds max") || message.includes("non-negative maxSpendUsd")
  return {
    status: blocked ? "blocked" : "failed",
    statusCode: blocked ? 400 : 502,
    message,
  }
}

function encodePreparedCodexRequest(prepared: CodexPreparedResult, framePreparation: CodexFramePreparation): JsonValue {
  return toJsonValue({ ...prepared, framePreparation })
}

function assertLiveCodexFrameRefsReachable(input: CodexAnalyzeInput, framePreparation: CodexFramePreparation): void {
  if (input.operation !== "video-understand") return
  if (framePreparation.referenceFrameUrls.length === 0) {
    throw new Error("Codex live video analysis requires externally reachable referenceFrameUrls; local frame extraction is dry-run only.")
  }
  const blockedUrl = framePreparation.referenceFrameUrls.find((url) => !isReachableCodexImageUrl(url))
  if (blockedUrl) {
    throw new Error(`Codex live video analysis requires externally reachable referenceFrameUrls; ${blockedUrl} is local or unsupported.`)
  }
}

function isReachableCodexImageUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("data:image/")
}

async function readJson(request: Request): Promise<JsonValue> {
  return await request.json() as JsonValue
}

function toUgcCliJsonValue(value: JsonValue): UgcCliJsonValue {
  return JSON.parse(JSON.stringify(value)) as UgcCliJsonValue
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
  const posterUrl = typeof value.posterUrl === "string" ? value.posterUrl : null
  const candidateId = typeof value.candidateId === "string" && value.candidateId.length > 0 ? value.candidateId : undefined
  return { input, live, maxSpendUsd, apiKey, posterUrl, candidateId }
}

function decodeCandidateCodexAnalysisJobRequest(value: JsonValue): CandidateCodexAnalysisJobRequest {
  if (!isRecord(value)) return { live: false }
  return {
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.maxOutputTokens === "number" ? { maxOutputTokens: value.maxOutputTokens } : {}),
    ...(isStringArray(value.referenceFrameUrls) ? { referenceFrameUrls: value.referenceFrameUrls } : {}),
    live: value.live === true,
    maxSpendUsd: typeof value.maxSpendUsd === "number" ? value.maxSpendUsd : undefined,
    apiKey: typeof value.apiKey === "string" && value.apiKey.length > 0 ? value.apiKey : undefined,
  }
}

function decodeAnalysisToKieJobRequest(value: JsonValue): AnalysisToKieJobRequest {
  if (!isRecord(value)) throw new Error("analysis-to-kie request must be an object")
  if (typeof value.analysisJobId !== "string" || value.analysisJobId.trim().length === 0) throw new Error("analysis-to-kie requires analysisJobId")
  if (!isKieProductLane(value.lane)) throw new Error("analysis-to-kie requires lane: brainrot or ugc-ads")
  if (value.live === true) throw new Error("analysis-to-kie only creates dry-run KIE plans")
  if (value.operation !== undefined && !isKieAnalysisPlanOperation(value.operation)) throw new Error("analysis-to-kie operation must be video-text or image-text")
  if (value.targetKind !== undefined && !isAnalysisTargetKind(value.targetKind)) throw new Error("analysis-to-kie targetKind must be candidate or reference")
  if (value.quality !== undefined && !isKieQuality(value.quality)) throw new Error("analysis-to-kie quality must be basic, standard, or pro")
  return {
    analysisJobId: value.analysisJobId,
    lane: value.lane,
    targetId: typeof value.targetId === "string" && value.targetId.length > 0 ? value.targetId : undefined,
    targetKind: isAnalysisTargetKind(value.targetKind) ? value.targetKind : undefined,
    operation: isKieAnalysisPlanOperation(value.operation) ? value.operation : undefined,
    aspectRatio: typeof value.aspectRatio === "string" && value.aspectRatio.length > 0 ? value.aspectRatio : undefined,
    durationSec: decodePositiveNumber(value.durationSec, "durationSec"),
    resolution: typeof value.resolution === "string" && value.resolution.length > 0 ? value.resolution : undefined,
    quality: isKieQuality(value.quality) ? value.quality : undefined,
  }
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

function decodeDemoWorkflowRouteRequest(value: JsonValue): DemoWorkflowRouteRequest {
  if (!isJsonRecord(value)) throw new Error("demo workflow request must be an object")
  assertAllowedKeys(value, ["lane"], "demo workflow request")
  if (!isDemoWorkflowRouteLane(value.lane)) throw new Error("demo workflow lane must be brainrot, ugc-ads, or all")
  return { lane: value.lane }
}

function decodeCreateWorkflowRun(value: JsonValue): CreateWorkflowRunInput {
  if (!isRecord(value)) throw new Error("workflow run request must be an object")
  if (typeof value.title !== "string" || value.title.trim().length === 0) throw new Error("workflow run requires title")
  return {
    title: value.title,
    lane: typeof value.lane === "string" ? value.lane : undefined,
    status: isWorkflowRunStatus(value.status) ? value.status : undefined,
    source: isWorkflowRunSource(value.source) ? value.source : "slotok",
    scriptId: typeof value.scriptId === "string" ? value.scriptId : null,
    args: isJsonValue(value.args) ? value.args : null,
    currentPhase: typeof value.currentPhase === "string" ? value.currentPhase : null,
    counters: decodeWorkflowCounters(value.counters),
    importedRecordIds: isStringArray(value.importedRecordIds) ? value.importedRecordIds : undefined,
    artifactPaths: isStringArray(value.artifactPaths) ? value.artifactPaths : undefined,
  }
}

function decodeAppendWorkflowEvent(value: JsonValue): AppendWorkflowEventInput {
  if (!isRecord(value)) throw new Error("workflow event request must be an object")
  if (!isWorkflowEventType(value.type)) throw new Error("workflow event requires valid type")
  return {
    type: value.type,
    phase: typeof value.phase === "string" ? value.phase : null,
    agentLabel: typeof value.agentLabel === "string" ? value.agentLabel : null,
    message: typeof value.message === "string" ? value.message : null,
    payload: isJsonValue(value.payload) ? value.payload : null,
    artifactPaths: isStringArray(value.artifactPaths) ? value.artifactPaths : undefined,
    error: typeof value.error === "string" ? value.error : null,
  }
}

function decodeWorkflowImportRequest(value: JsonValue): WorkflowImportRouteRequest {
  if (!isJsonRecord(value)) throw new Error("workflow import request must be an object")
  assertAllowedKeys(value, ["payload", "apply"], "workflow import request")
  if (value.apply !== undefined && typeof value.apply !== "boolean") throw new Error("workflow import apply must be a boolean")
  if (!isJsonRecord(value.payload)) throw new Error("workflow import request requires payload")
  return {
    payload: decodeWorkflowImportPayload(value.payload),
    dryRun: value.apply === true ? false : true,
  }
}

function decodeWorkflowImportPayload(value: JsonValue): UgcWorkflowImportInput {
  if (!isJsonRecord(value)) throw new Error("workflow import payload must be an object")
  assertAllowedKeys(value, ["lane", "sourcePolicy", "records", "providerJobs", "candidatePatches", "referenceArchives", "notes", "artifactPaths", "result", "metadata", "resultMetadata"], "workflow import payload")
  if (!isKieProductLane(value.lane)) throw new Error("workflow import payload requires lane: brainrot or ugc-ads")
  if (!isReferenceSourcePolicy(value.sourcePolicy)) throw new Error("workflow import payload requires sourcePolicy")
  return {
    lane: value.lane,
    sourcePolicy: value.sourcePolicy,
    records: decodeJsonArray(value.records, "workflow import records"),
    providerJobs: decodeWorkflowProviderJobImports(value.providerJobs),
    candidatePatches: decodeWorkflowCandidatePatches(value.candidatePatches),
    referenceArchives: decodeWorkflowReferenceArchiveImports(value.referenceArchives),
    notes: decodeWorkflowNoteImports(value.notes),
    artifactPaths: isStringArray(value.artifactPaths) ? value.artifactPaths : undefined,
    result: value.result === undefined ? undefined : requireJsonValue(value.result, "workflow import result"),
    metadata: value.metadata === undefined ? undefined : requireJsonValue(value.metadata, "workflow import metadata"),
    resultMetadata: value.resultMetadata === undefined ? undefined : requireJsonValue(value.resultMetadata, "workflow import resultMetadata"),
  }
}

function decodeWorkflowProviderJobImports(value: JsonValue | undefined): UgcWorkflowImportInput["providerJobs"] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("workflow import providerJobs must be an array")
  return value.map((item) => {
    if (!isJsonRecord(item)) throw new Error("workflow import providerJobs entries must be objects")
    assertAllowedKeys(item, ["id", "provider", "operation", "mode", "status", "targetIds", "spendCapUsd", "estimatedCostUsd", "request", "response", "artifactPaths", "error"], "workflow import providerJobs entry")
    if (!isUgcProvider(item.provider)) throw new Error("workflow import provider job requires provider")
    if (typeof item.operation !== "string" || item.operation.trim().length === 0) throw new Error("workflow import provider job requires operation")
    if (item.mode !== undefined && item.mode !== "dry-run" && item.mode !== "live") throw new Error("workflow import provider job mode must be dry-run or live")
    if (item.status !== undefined && !isProviderJobStatus(item.status)) throw new Error("workflow import provider job status is invalid")
    const provider = item.provider
    const operation = item.operation
    const mode = item.mode === "live" || item.mode === "dry-run" ? item.mode : undefined
    return {
      id: typeof item.id === "string" && item.id.trim().length > 0 ? item.id : undefined,
      provider,
      operation,
      mode,
      status: isProviderJobStatus(item.status) ? item.status : undefined,
      targetIds: isStringArray(item.targetIds) ? item.targetIds : undefined,
      spendCapUsd: decodeOptionalFiniteNumber(item.spendCapUsd, "workflow import provider job spendCapUsd"),
      estimatedCostUsd: item.estimatedCostUsd === null ? null : decodeOptionalFiniteNumber(item.estimatedCostUsd, "workflow import provider job estimatedCostUsd"),
      request: item.request === undefined ? null : requireJsonValue(item.request, "workflow import provider job request"),
      response: item.response === undefined || item.response === null ? null : requireJsonValue(item.response, "workflow import provider job response"),
      artifactPaths: isStringArray(item.artifactPaths) ? item.artifactPaths : undefined,
      error: item.error === undefined || item.error === null ? null : requireString(item.error, "workflow import provider job error"),
    }
  })
}

function decodeWorkflowReferenceArchiveImports(value: JsonValue | undefined): UgcWorkflowImportInput["referenceArchives"] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("workflow import referenceArchives must be an array")
  return value.map((item) => {
    if (!isJsonRecord(item)) throw new Error("workflow import referenceArchives entries must be objects")
    assertAllowedKeys(item, ["referenceProfileId", "sourcePolicy", "archiveStatus", "preservedMechanics", "swappedFields", "blockedFields", "guardrails", "candidateFormatOutputs", "notes"], "workflow import referenceArchives entry")
    if (typeof item.referenceProfileId !== "string" || item.referenceProfileId.trim().length === 0) throw new Error("workflow import reference archive requires referenceProfileId")
    if (item.sourcePolicy !== undefined && !isReferenceSourcePolicy(item.sourcePolicy)) throw new Error("workflow import reference archive sourcePolicy is invalid")
    if (item.archiveStatus !== undefined && !isReferenceArchiveStatus(item.archiveStatus)) throw new Error("workflow import reference archive archiveStatus is invalid")
    return {
      referenceProfileId: item.referenceProfileId,
      sourcePolicy: isReferenceSourcePolicy(item.sourcePolicy) ? item.sourcePolicy : undefined,
      archiveStatus: isReferenceArchiveStatus(item.archiveStatus) ? item.archiveStatus : undefined,
      preservedMechanics: item.preservedMechanics === undefined ? undefined : requireJsonValue(item.preservedMechanics, "workflow import reference archive preservedMechanics"),
      swappedFields: isStringArray(item.swappedFields) ? item.swappedFields : undefined,
      blockedFields: isStringArray(item.blockedFields) ? item.blockedFields : undefined,
      guardrails: isStringArray(item.guardrails) ? item.guardrails : undefined,
      candidateFormatOutputs: decodeReferenceArchiveFormatOutputs(item.candidateFormatOutputs),
      notes: isStringArray(item.notes) ? item.notes : undefined,
    }
  })
}

function decodeWorkflowCandidatePatches(value: JsonValue | undefined): UgcWorkflowImportInput["candidatePatches"] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("workflow import candidatePatches must be an array")
  return value.map((item) => {
    if (!isJsonRecord(item)) throw new Error("workflow import candidatePatches entries must be objects")
    assertAllowedKeys(item, ["candidateId", "status", "notes"], "workflow import candidatePatches entry")
    if (typeof item.candidateId !== "string" || item.candidateId.trim().length === 0) throw new Error("workflow import candidate patch requires candidateId")
    if (item.status !== undefined && !isCandidateStatus(item.status)) throw new Error("workflow import candidate patch status is invalid")
    return {
      candidateId: item.candidateId,
      status: isCandidateStatus(item.status) ? item.status : undefined,
      notes: decodeWorkflowCandidatePatchNotes(item.notes),
    }
  })
}

function decodeWorkflowCandidatePatchNotes(value: JsonValue | undefined): NonNullable<NonNullable<UgcWorkflowImportInput["candidatePatches"]>[number]["notes"]> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("workflow import candidate patch notes must be an array")
  return value.map((item) => {
    if (typeof item === "string") return { body: item }
    if (!isJsonRecord(item)) throw new Error("workflow import candidate patch note entries must be strings or objects")
    assertAllowedKeys(item, ["body", "verdict", "requestedChange"], "workflow import candidate patch note")
    if (typeof item.body !== "string" || item.body.trim().length === 0) throw new Error("workflow import candidate patch note requires body")
    if (item.verdict !== undefined && !isReviewVerdict(item.verdict)) throw new Error("workflow import candidate patch note verdict is invalid")
    return {
      body: item.body,
      verdict: isReviewVerdict(item.verdict) ? item.verdict : undefined,
      requestedChange: item.requestedChange === undefined || item.requestedChange === null ? null : requireString(item.requestedChange, "workflow import candidate patch note requestedChange"),
    }
  })
}

function decodeWorkflowNoteImports(value: JsonValue | undefined): UgcWorkflowImportInput["notes"] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("workflow import notes must be an array")
  return value.map((item) => {
    if (!isJsonRecord(item)) throw new Error("workflow import notes entries must be objects")
    assertAllowedKeys(item, ["author", "attachedTo", "verdict", "body", "requestedChange"], "workflow import notes entry")
    if (item.author !== undefined && item.author !== "arthur" && item.author !== "agent") throw new Error("workflow import note author is invalid")
    if (!isReviewVerdict(item.verdict)) throw new Error("workflow import note requires verdict")
    if (typeof item.body !== "string" || item.body.trim().length === 0) throw new Error("workflow import note requires body")
    return {
      author: item.author === "arthur" ? "arthur" : "agent",
      attachedTo: decodeReviewAttachment(item.attachedTo),
      verdict: item.verdict,
      body: item.body,
      requestedChange: item.requestedChange === undefined || item.requestedChange === null ? null : requireString(item.requestedChange, "workflow import note requestedChange"),
    }
  })
}
function isJsonRecord(value: JsonValue | undefined | null): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertAllowedKeys(value: { readonly [key: string]: JsonValue }, allowedKeys: readonly string[], label: string): void {
  const allowed = new Set(allowedKeys)
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknownKeys.length > 0) throw new Error(`${label} has unsupported fields: ${unknownKeys.join(", ")}`)
}

function decodeJsonArray(value: JsonValue | undefined, label: string): readonly JsonValue[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(isJsonValue)) throw new Error(`${label} must be an array of JSON values`)
  return value
}

function requireJsonValue(value: JsonValue | undefined, label: string): JsonValue {
  if (!isJsonValue(value)) throw new Error(`${label} must be JSON-safe`)
  return value
}

function requireString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  return value
}

function decodeOptionalFiniteNumber(value: JsonValue | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function decodeWorkflowCounters(value: JsonValue | undefined): UgcWorkflowCounters | undefined {
  if (!isRecord(value)) return undefined
  const counters: { [key: string]: number } = {}
  for (const key of Object.keys(value)) {
    const count = value[key]
    if (typeof count === "number" && Number.isFinite(count)) counters[key] = count
  }
  return counters
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

function decodeReferenceCatalogImport(value: JsonValue): UgcReferenceCatalogImportInput {
  if (!isRecord(value)) return {}
  return {
    roots: isStringArray(value.roots) ? value.roots : undefined,
    manifestPaths: isStringArray(value.manifestPaths) ? value.manifestPaths : undefined,
  }
}

function decodeReviewAttachment(value: JsonValue | undefined): ReviewAttachment {
  if (!isJsonRecord(value)) throw new Error("note request requires attachedTo")
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

function isUgcProvider(value: JsonValue | undefined): value is CreateProviderJobInput["provider"] {
  return value === "kie" || value === "jimeng" || value === "local" || value === "codex"
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

function isKieProductLane(value: JsonValue | undefined): value is KieProductLane {
  return value === "brainrot" || value === "ugc-ads"
}

function isAnalysisTargetKind(value: JsonValue | undefined): value is AnalysisToKieJobRequest["targetKind"] {
  return value === "candidate" || value === "reference"
}

function isKieAnalysisPlanOperation(value: JsonValue | undefined): value is KieAnalysisPlanOperation {
  return value === "video-text" || value === "image-text"
}

function isKieQuality(value: JsonValue | undefined): value is KieGenerateRequest["quality"] {
  return value === "basic" || value === "standard" || value === "pro"
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

function isDemoWorkflowRouteLane(value: JsonValue | undefined): value is UgcDemoWorkflowRouteLane {
  return value === "brainrot" || value === "ugc-ads" || value === "all"
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

function isWorkflowRunSource(value: JsonValue | undefined): value is UgcWorkflowRunSource {
  return value === "slotok" || value === "pi" || value === "omp" || value === "dynamic-workflow" || value === "local"
}

function isWorkflowEventType(value: JsonValue | undefined): value is UgcWorkflowEventType {
  return value === "created"
    || value === "queued"
    || value === "started"
    || value === "phase"
    || value === "message"
    || value === "artifact"
    || value === "status"
    || value === "result"
    || value === "import"
    || value === "error"
    || value === "completed"
    || value === "blocked"
    || value === "canceled"
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

function decodeAfterEventId(value: string | null): number {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function workflowEventsStream(store: UgcJsonStore, afterEventId: number): Response {
  if (workflowSseClients.size >= WORKFLOW_SSE_MAX_CLIENTS) {
    return json({ error: "too many workflow event stream clients" }, 503)
  }
  let client: WorkflowSseClient | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const nextClient: WorkflowSseClient = {
        id: `workflow_sse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
        lastEventId: afterEventId,
        controller,
        heartbeatId: setInterval(() => {
          if (client) sendWorkflowSse(client, "heartbeat", { lastEventId: client.lastEventId })
        }, WORKFLOW_SSE_HEARTBEAT_MS),
        pollId: setInterval(() => {
          if (client) pollWorkflowSseClient(client, store)
        }, WORKFLOW_SSE_POLL_MS),
      }
      client = nextClient
      workflowSseClients.add(nextClient)
      const currentLastEventId = store.read().workflowEvents.reduce((max, event) => Math.max(max, event.eventId), afterEventId)
      sendWorkflowSse(nextClient, "ready", { lastEventId: currentLastEventId })
      pollWorkflowSseClient(nextClient, store)
    },
    cancel() {
      if (client) closeWorkflowSseClient(client, false)
    },
  })
  return new Response(stream, {
    headers: corsHeaders({
      "content-type": "text/event-stream; charset=utf-8",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    }),
  })
}

function pollWorkflowSseClient(client: WorkflowSseClient, store: UgcJsonStore): void {
  try {
    for (const event of store.listWorkflowEventsAfter(client.lastEventId)) {
      sendWorkflowSse(client, "workflow-event", { event })
      client.lastEventId = Math.max(client.lastEventId, event.eventId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "workflow event stream failed"
    sendWorkflowSse(client, "error", { message })
    closeWorkflowSseClient(client, true)
  }
}

function broadcastWorkflowEvent(event: UgcWorkflowEvent): void {
  for (const client of workflowSseClients) {
    if (event.eventId <= client.lastEventId) continue
    sendWorkflowSse(client, "workflow-event", { event })
    client.lastEventId = event.eventId
  }
}

function sendWorkflowSse(client: WorkflowSseClient, eventName: string, data: object): void {
  client.controller.enqueue(workflowSseEncoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`))
}

function closeWorkflowSseClient(client: WorkflowSseClient, closeController: boolean): void {
  clearInterval(client.heartbeatId)
  clearInterval(client.pollId)
  workflowSseClients.delete(client)
  if (closeController) {
    try {
      client.controller.close()
    } catch {
      return
    }
  }
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
