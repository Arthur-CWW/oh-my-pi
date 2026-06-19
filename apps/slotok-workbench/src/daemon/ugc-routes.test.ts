import { mkdir, writeFile } from "node:fs/promises"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import type { CodexAnalyzeInput, CodexAnalyzeResult, CodexLiveOptions } from "@wirebabel/ugc-cli"
import { UgcJsonStore } from "./ugc-json-store"
import { routeUgc } from "./ugc-routes"
import type { CodexVideoFrameExtractor } from "./codex-video-frames"
import { createSlotokWorkflowCallbacks, registerSlotokWorkflowRun, type SlotokWorkflowEventInput, type SlotokWorkflowRunInput } from "./ugc-workflow-adapter"
import type { UgcLocalState } from "../ugc/local-state"

describe("routeUgc", () => {
  test("serves workspace state and accepts local-first mutations", async () => {
    const store = createStore()
    const initialResponse = await routeUgc(new Request("http://127.0.0.1/api/ugc/workspace"), store)
    expect(initialResponse?.status).toBe(200)
    const initial = await readState(initialResponse)
    const personaId = initial.workspace.personas[0]?.id ?? ""
    const candidateId = initial.workspace.candidates[0]?.id ?? ""
    const referenceProfileId = initial.workspace.referenceProfiles[0]?.id ?? ""
    const branchId = initial.workspace.branchSnapshots[0]?.id ?? ""
    const editorTrack = initial.workspace.finalEditor.tracks[0]
    const editorClip = editorTrack?.clips[0]
    if (!editorTrack || !editorClip) throw new Error("missing editor track or clip")

    const personaResponse = await routeUgc(jsonRequest(`/api/ugc/personas/${personaId}`, {
      status: "selected",
      voice: { energy: 51, speakingStyle: "quiet confidence" },
    }), store)
    const personaState = await readState(personaResponse)
    expect(personaState.workspace.personas.find((persona) => persona.id === personaId)?.status).toBe("selected")
    expect(personaState.workspace.personas.find((persona) => persona.id === personaId)?.voice.energy).toBe(51)

    const statusResponse = await routeUgc(jsonRequest(`/api/ugc/candidates/${candidateId}/status`, { status: "rejected" }), store)
    const statusState = await readState(statusResponse)
    expect(statusState.workspace.candidates.find((candidate) => candidate.id === candidateId)?.status).toBe("rejected")

    const selectedSetIds = initial.workspace.candidates.slice(0, 2).map((candidate) => candidate.id)
    const bulkStatusResponse = await routeUgc(jsonRequest("/api/ugc/candidates/status", {
      candidateIds: selectedSetIds,
      status: "needs-revision",
    }), store)
    const bulkStatusState = await readState(bulkStatusResponse)
    expect(bulkStatusState.workspace.candidates.filter((candidate) => selectedSetIds.includes(candidate.id)).every((candidate) => candidate.status === "needs-revision")).toBe(true)

    const noteResponse = await routeUgc(jsonRequest("/api/ugc/notes", {
      attachedTo: { kind: "candidate", id: candidateId },
      verdict: "reject",
      body: "Dead end for this batch.",
    }), store)
    const noteState = await readState(noteResponse)
    expect(noteState.workspace.reviewNotes[0]?.verdict).toBe("reject")

    const branchResponse = await routeUgc(jsonRequest("/api/ugc/branches", {
      parentId: branchId,
      title: "Route fork",
      focus: "Route-created softer fork",
      selectedCandidateIds: [candidateId],
      selectedPersonaIds: [personaId],
      decisionNote: "Route fork proof.",
    }), store)
    const branchState = await readState(branchResponse)
    const fork = branchState.workspace.branchSnapshots[0]
    expect(fork?.parentId).toBe(branchId)
    expect(branchState.workspace.branchSnapshots.find((branch) => branch.id === branchId)?.childIds).toContain(fork?.id)

    const archiveResponse = await routeUgc(jsonRequest("/api/ugc/reference-archives", {
      referenceProfileId,
      archiveStatus: "decomposed",
      sourcePolicy: "abstract-mechanics",
      preservedMechanics: { poseTiming: "open with hand gesture, cut every two beats" },
      swappedFields: ["Synthetic persona"],
      blockedFields: ["Source face", "Source voice"],
      guardrails: ["No raw media storage"],
      candidateFormatOutputs: [
        {
          id: "format_route_caption",
          title: "Caption grammar",
          kind: "caption-template",
          summary: "Rewrite the hook and product claim while preserving caption cadence.",
          stageIds: ["stage_hook"],
          candidateIds: [],
          manifestJson: { lines: 2 },
        },
      ],
      notes: ["route archive proof"],
    }), store)
    const archiveState = await readState(archiveResponse)
    expect(archiveState.referenceArchives[0]?.candidateFormatOutputs[0]?.id).toBe("format_route_caption")

    const listResponse = await routeUgc(new Request("http://127.0.0.1/api/ugc/reference-archives"), store)
    const listPayload = await listResponse?.json() as { readonly referenceArchives?: readonly { readonly id: string }[] }
    const archiveId = listPayload.referenceArchives?.[0]?.id ?? ""
    expect(listPayload.referenceArchives?.length).toBeGreaterThan(0)

    const deleteResponse = await routeUgc(jsonRequest(`/api/ugc/reference-archives/${archiveId}/delete`, {}), store)
    const deleteState = await readState(deleteResponse)
    expect(deleteState.referenceArchives.some((archive) => archive.id === archiveId)).toBe(false)

    const researchResponse = await routeUgc(jsonRequest("/api/ugc/research-targets", {
      niche: "faceless SaaS founder UGC",
      query: "faceless founder UGC template hook CTA screen recording proof",
      platform: "tiktok",
      sourcePolicy: "metadata-only",
      notes: ["route research proof"],
    }), store)
    const researchState = await readState(researchResponse)
    const researchTargetId = researchState.researchTargets[0]?.id ?? ""
    expect(researchState.researchTargets[0]?.niche).toBe("faceless SaaS founder UGC")

    const patchResearchResponse = await routeUgc(jsonRequest(`/api/ugc/research-targets/${researchTargetId}`, {
      status: "sampling",
      priority: 1,
      notes: ["sample public metadata only"],
    }), store)
    const patchResearchState = await readState(patchResearchResponse)
    expect(patchResearchState.researchTargets.find((target) => target.id === researchTargetId)?.status).toBe("sampling")

    const templateJobResponse = await routeUgc(jsonRequest("/api/ugc/template-mining-jobs", {
      researchTargetId,
      status: "planned",
      templateSpec: {
        schemaVersion: "ugc-studio.clean-room-template.v1",
        id: "template_route_faceless_saas",
        title: "Faceless SaaS proof template",
        category: "format",
        preservedMechanics: { screenBeats: 4, captionBlocks: 2 },
        swapSlots: ["product", "hook", "CTA"],
        blockedFields: ["source pixels", "exact captions"],
        proofNotes: ["metadata-only route proof"],
      },
    }), store)
    const templateJobState = await readState(templateJobResponse)
    const templateJobId = templateJobState.templateMiningJobs[0]?.id ?? ""
    expect(templateJobState.researchTargets.find((target) => target.id === researchTargetId)?.templateJobIds).toContain(templateJobId)

    const patchTemplateJobResponse = await routeUgc(jsonRequest(`/api/ugc/template-mining-jobs/${templateJobId}`, {
      status: "ready",
      candidateIds: [candidateId],
    }), store)
    const patchTemplateJobState = await readState(patchTemplateJobResponse)
    expect(patchTemplateJobState.templateMiningJobs.find((job) => job.id === templateJobId)?.status).toBe("ready")

    const finalEditorResponse = await routeUgc(jsonRequest("/api/ugc/final-editor", {
      selectedCandidateId: candidateId,
      trackUpdates: [{ id: editorTrack.id, visible: false, locked: true }],
      clipUpdates: [
        {
          trackId: editorTrack.id,
          clipId: editorClip.id,
          label: "Route caption edit",
          startSeconds: 0.75,
          durationSeconds: 3.25,
          payloadJson: { text: "Route-layer softer caption.", cue: "hook" },
        },
      ],
    }), store)
    const finalEditorState = await readState(finalEditorResponse)
    const patchedTrack = finalEditorState.workspace.finalEditor.tracks.find((track) => track.id === editorTrack.id)
    const patchedClip = patchedTrack?.clips.find((clip) => clip.id === editorClip.id)

    expect(patchedTrack?.visible).toBe(false)
    expect(patchedTrack?.locked).toBe(true)
    expect(patchedClip?.label).toBe("Route caption edit")
    expect(patchedClip?.payloadJson).toEqual({ text: "Route-layer softer caption.", cue: "hook" })

    const bundleResponse = await routeUgc(jsonRequest("/api/ugc/workspace/bundles/export", { label: "Route bundle proof" }), store)
    const bundle = await bundleResponse?.json() as {
      readonly schemaVersion?: string
      readonly label?: string
      readonly state?: UgcLocalState
      readonly objectCounts?: { readonly personas?: number }
    }
    expect(bundle.schemaVersion).toBe("ugc-studio.workspace-bundle.v1")
    expect(bundle.label).toBe("Route bundle proof")
    expect(bundle.objectCounts?.personas).toBeGreaterThan(0)

    const importResponse = await routeUgc(jsonRequest("/api/ugc/workspace/bundles/import", {
      bundle,
      dryRun: true,
    }), store)
    const importResult = await importResponse?.json() as {
      readonly schemaVersion?: string
      readonly valid?: boolean
      readonly dryRun?: boolean
      readonly imported?: boolean
    }
    expect(importResult.schemaVersion).toBe("ugc-studio.workspace-bundle-import-result.v1")
    expect(importResult.valid).toBe(true)
    expect(importResult.dryRun).toBe(true)
    expect(importResult.imported).toBe(false)

    const createJobResponse = await routeUgc(jsonRequest("/api/ugc/provider-jobs", {
      provider: "kie",
      operation: "image-to-video",
      status: "queued",
      request: { prompt: "route job proof" },
      targetIds: [candidateId],
      spendCapUsd: 0.05,
    }), store)
    const createJobState = await readState(createJobResponse)
    const jobId = createJobState.providerJobs[0]?.id ?? ""
    const patchJobResponse = await routeUgc(jsonRequest(`/api/ugc/provider-jobs/${jobId}`, {
      status: "blocked",
      response: { taskId: "kie_task_route", code: 429 },
      artifactPaths: ["artifacts/provider/kie_task_route/manifest.json"],
      error: "credit cap or provider backoff",
    }), store)
    const patchJobState = await readState(patchJobResponse)
    const patchedJob = patchJobState.providerJobs.find((job) => job.id === jobId)

    expect(patchedJob?.status).toBe("blocked")
    expect(patchedJob?.artifactPaths).toContain("artifacts/provider/kie_task_route/manifest.json")
    expect(patchedJob?.error).toContain("credit cap")
  })

  test("surfaces mismatched workspace bundle dry-run errors without mutating route state", async () => {
    const store = createStore()
    const initial = store.read()
    const bundle = store.exportWorkspaceBundle({ label: "Route mismatched bundle" })
    const mismatchedBundle = {
      ...bundle,
      workspaceId: "workspace_other_route",
      state: {
        ...bundle.state,
        workspace: {
          ...bundle.state.workspace,
          id: "workspace_other_route",
          title: "Imported Other Route Workspace",
        },
      },
    }

    const dryRunResponse = await routeUgc(jsonRequest("/api/ugc/workspace/bundles/import", {
      bundle: mismatchedBundle,
      dryRun: true,
    }), store)
    const dryRun = await dryRunResponse?.json() as {
      readonly valid?: boolean
      readonly dryRun?: boolean
      readonly imported?: boolean
      readonly errors?: readonly string[]
    }

    expect(dryRun.valid).toBe(false)
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.imported).toBe(false)
    expect(dryRun.errors).toContain("Bundle workspace workspace_other_route does not match current workspace workspace_protein_bar_ads.")
    expect(store.read()).toEqual(initial)
  })

  test("plans and imports local TikTok reference catalog metadata through dry-run-first routes", async () => {
    const store = createStore()
    const root = await writeCatalogFixture(store.config.cwd, "data/tiktok-catalogue/pleometric")
    const initialReferenceProfileCount = store.read().workspace.referenceProfiles.length

    const planResponse = await routeUgc(jsonRequest("/api/ugc/reference-catalog/plan", { roots: [root] }), store)
    const plan = await planResponse?.json() as {
      readonly valid?: boolean
      readonly dryRun?: boolean
      readonly imported?: boolean
      readonly videosPlanned?: number
      readonly state?: UgcLocalState | null
    }

    expect(plan.valid).toBe(true)
    expect(plan.dryRun).toBe(true)
    expect(plan.imported).toBe(false)
    expect(plan.videosPlanned).toBe(2)
    expect(plan.state).toBeNull()
    expect(store.read().workspace.referenceProfiles.length).toBe(initialReferenceProfileCount)

    const importResponse = await routeUgc(jsonRequest("/api/ugc/reference-catalog/import", { roots: [root] }), store)
    const imported = await importResponse?.json() as {
      readonly valid?: boolean
      readonly imported?: boolean
      readonly state?: UgcLocalState | null
    }
    const archive = imported.state?.referenceArchives.find((item) => item.id === "archive_reference_tiktok_pleometric")
    const providerJob = imported.state?.providerJobs.find((job) => job.id === "job_local_reference_catalog_import_pleometric")

    expect(imported.valid).toBe(true)
    expect(imported.imported).toBe(true)
    expect(archive?.catalogVideos.length).toBe(2)
    expect(archive?.catalogVideos[0]?.paths.infoJson).toBe(`${root}/2026-03-05_7613899553590234375.info.json`)
    expect(archive?.catalogVideos[0]?.engagement.views).toBe(1200)
    expect(providerJob?.provider).toBe("local")
    expect(JSON.stringify(providerJob?.request)).not.toContain("https://cdn.example")
    expect(JSON.stringify(providerJob?.request)).not.toContain("Cookie")
  })

  test("plans and imports provider reference asset manifests through existing reference catalog routes", async () => {
    const store = createStore()
    const higgsfieldManifest = await writeProviderManifestFixture(store.config.cwd, "data/ugc-studio/reference-assets/higgsfield/manifest.json", "higgsfield")

    const planResponse = await routeUgc(jsonRequest("/api/ugc/reference-catalog/plan", { roots: [], manifestPaths: [higgsfieldManifest] }), store)
    const plan = await planResponse?.json() as {
      readonly valid?: boolean
      readonly dryRun?: boolean
      readonly videosPlanned?: number
      readonly assetsPlanned?: number
      readonly manifestPaths?: readonly string[]
      readonly state?: UgcLocalState | null
    }

    expect(plan.valid).toBe(true)
    expect(plan.dryRun).toBe(true)
    expect(plan.videosPlanned).toBe(0)
    expect(plan.assetsPlanned).toBe(1)
    expect(plan.manifestPaths).toEqual([higgsfieldManifest])
    expect(plan.state).toBeNull()

    const importResponse = await routeUgc(jsonRequest("/api/ugc/reference-catalog/import", { roots: [], manifestPaths: [higgsfieldManifest] }), store)
    const imported = await importResponse?.json() as {
      readonly valid?: boolean
      readonly imported?: boolean
      readonly state?: UgcLocalState | null
    }
    const archive = imported.state?.referenceArchives.find((item) => item.id === "archive_reference_provider_higgsfield_assets")
    const providerJob = imported.state?.providerJobs.find((job) => job.id === "job_local_reference_asset_manifest_import_higgsfield")

    expect(imported.valid).toBe(true)
    expect(imported.imported).toBe(true)
    expect(archive?.referenceAssets[0]?.localPath).toBe("data/ugc-studio/reference-assets/higgsfield/marketing-slides/hyper.mp4")
    expect(archive?.referenceAssets[0]?.referenceOnly).toBe(true)
    expect(archive?.referenceAssets[0]?.directGenerationInput).toBe(false)
    expect(providerJob?.artifactPaths).toEqual([higgsfieldManifest])

    const guardedResponse = await routeUgc(jsonRequest("/api/ugc/provider-jobs", {
      provider: "kie",
      operation: "image-to-video",
      targetIds: [archive?.id ?? ""],
      request: { imageUrl: archive?.referenceAssets[0]?.assetUrl ?? "", prompt: "copy this public reference" },
    }), store)
    const guarded = await guardedResponse?.json() as { readonly error?: string }
    expect(guardedResponse?.status).toBe(400)
    expect(guarded.error).toContain("metadata-only, abstract-mechanics, or public reference assets cannot be direct generation inputs")
    expect(store.read().providerJobs.some((job) => job.operation === "image-to-video")).toBe(false)

    const unknownTargetResponse = await routeUgc(jsonRequest("/api/ugc/provider-jobs", {
      provider: "kie",
      operation: "image-to-video",
      targetIds: ["foo"],
      request: { mediaUrl: "https://example.com/public-inspiration.mp4", prompt: "copy this unproven public reference" },
    }), store)
    const unknownTarget = await unknownTargetResponse?.json() as { readonly error?: string }
    expect(unknownTargetResponse?.status).toBe(400)
    expect(unknownTarget.error).toContain("metadata-only, abstract-mechanics, or public reference assets cannot be direct generation inputs")
    expect(store.read().providerJobs.some((job) => job.operation === "image-to-video")).toBe(false)
  })




  test("plans and persists Codex media analysis jobs as dry-run provider jobs", async () => {
    const store = createStore()

    const planResponse = await routeUgc(jsonRequest("/api/ugc/codex/plan", {
      operation: "image-understand",
      mediaUrl: "file:///tmp/slotok/hook-frame.jpg",
      prompt: "Identify product visibility and caption risk.",
      targetIds: ["candidate_route_codex"],
    }), store)
    const plan = await planResponse?.json() as {
      readonly provider?: string
      readonly operation?: string
      readonly payload?: {
        readonly metadata?: {
          readonly operation?: string
          readonly mediaUrl?: string
        }
      }
    }
    expect(plan.provider).toBe("codex")
    expect(plan.operation).toBe("image-understand")
    expect(plan.payload?.metadata?.mediaUrl).toBe("file:///tmp/slotok/hook-frame.jpg")

    const createResponse = await routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "video-understand",
      mediaUrl: "file:///tmp/slotok/demo.mp4",
      targetIds: ["candidate_route_codex"],
      maxSpendUsd: 0.12,
      referenceFrameUrls: [
        "file:///tmp/slotok/frames/demo-01.jpg",
        "file:///tmp/slotok/frames/demo-02.jpg",
      ],
    }), store)
    const created = await createResponse?.json() as {
      readonly job?: {
        readonly provider?: string
        readonly operation?: string
        readonly mode?: string
        readonly artifactPaths?: readonly string[]
        readonly request?: {
          readonly provider?: string
          readonly operation?: string
          readonly payload?: {
            readonly metadata?: {
              readonly mediaUrl?: string
              readonly referenceFrameUrls?: readonly string[]
            }
          }
          readonly framePreparation?: {
            readonly referenceFrameUrls?: readonly string[]
            readonly artifactPaths?: readonly string[]
            readonly extraction?: {
              readonly status?: string
              readonly source?: string
            }
          }
        }
      }
      readonly state?: UgcLocalState
    }

    expect(created.job?.provider).toBe("codex")
    expect(created.job?.operation).toBe("video-understand")
    expect(created.job?.mode).toBe("dry-run")
    expect(created.job?.request?.provider).toBe("codex")
    expect(created.job?.request?.payload?.metadata?.mediaUrl).toBe("file:///tmp/slotok/demo.mp4")
    expect(created.job?.request?.payload?.metadata?.referenceFrameUrls).toEqual([
      "file:///tmp/slotok/frames/demo-01.jpg",
      "file:///tmp/slotok/frames/demo-02.jpg",
    ])
    expect(created.job?.request?.framePreparation?.extraction?.status).toBe("supplied-reference-frames")
    expect(created.job?.request?.framePreparation?.extraction?.source).toBe("referenceFrameUrls")
    expect(created.job?.artifactPaths).toEqual([])
    expect(created.state?.providerJobs[0]?.provider).toBe("codex")
  })

  test("uses candidate fixture posters as skipped Codex video frame references", async () => {
    const store = createStore()
    const candidate = store.read().workspace.candidates.find((item) => item.preview.videoUrl?.startsWith("fixture://"))
    if (!candidate) throw new Error("missing fixture video candidate")

    const response = await routeUgc(jsonRequest(`/api/ugc/codex/candidates/${candidate.id}/analyze-video`, {
      prompt: "Analyze the fixture candidate from prepared still frames.",
    }), store)
    const created = await response?.json() as {
      readonly job?: {
        readonly artifactPaths?: readonly string[]
        readonly request?: {
          readonly payload?: {
            readonly metadata?: {
              readonly mediaUrl?: string
              readonly referenceFrameUrls?: readonly string[]
            }
          }
          readonly framePreparation?: {
            readonly referenceFrameUrls?: readonly string[]
            readonly artifactPaths?: readonly string[]
            readonly extraction?: {
              readonly status?: string
              readonly source?: string
              readonly reason?: string
            }
          }
        }
      }
    }

    expect(created.job?.request?.payload?.metadata?.mediaUrl).toBe(candidate.preview.videoUrl)
    expect(created.job?.request?.payload?.metadata?.referenceFrameUrls).toEqual([candidate.preview.posterUrl])
    expect(created.job?.request?.framePreparation?.referenceFrameUrls).toEqual([candidate.preview.posterUrl])
    expect(created.job?.request?.framePreparation?.artifactPaths).toEqual([])
    expect(created.job?.request?.framePreparation?.extraction?.status).toBe("skipped")
    expect(created.job?.request?.framePreparation?.extraction?.source).toBe("posterUrl")
    expect(created.job?.request?.framePreparation?.extraction?.reason).toBe("fixture-media")
    expect(created.job?.artifactPaths).toEqual([])
  })

  test("extracts local Codex video frames through an injected extractor", async () => {
    const store = createStore()
    const mediaPath = resolve(store.config.workspaceDir, "incoming", "demo.mp4")
    const extractedMediaPaths: string[] = []
    const fakeExtractor: CodexVideoFrameExtractor = {
      async extract(input) {
        extractedMediaPaths.push(input.mediaPath)
        const framePath = resolve(input.outputDir, "frame-01.jpg")
        await mkdir(input.outputDir, { recursive: true })
        await writeFile(framePath, "fake jpeg")
        return [framePath]
      },
    }

    const response = await routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "video-understand",
      mediaUrl: mediaPath,
      candidateId: "candidate_local_extract",
      targetIds: ["candidate_local_extract"],
    }), store, { codexFrameExtractor: fakeExtractor })
    const created = await response?.json() as {
      readonly job?: {
        readonly artifactPaths?: readonly string[]
        readonly request?: {
          readonly payload?: {
            readonly metadata?: {
              readonly mediaUrl?: string
              readonly referenceFrameUrls?: readonly string[]
            }
          }
          readonly framePreparation?: {
            readonly referenceFrameUrls?: readonly string[]
            readonly artifactPaths?: readonly string[]
            readonly extraction?: {
              readonly status?: string
              readonly source?: string
              readonly outputDir?: string
            }
          }
        }
      }
    }

    expect(extractedMediaPaths).toEqual([mediaPath])
    expect(created.job?.request?.payload?.metadata?.mediaUrl?.startsWith("file://")).toBe(true)
    expect(created.job?.request?.payload?.metadata?.referenceFrameUrls?.[0]?.startsWith("file://")).toBe(true)
    expect(created.job?.request?.framePreparation?.artifactPaths).toEqual([
      "assets/generated/codex-frames/candidate_local_extract/frame-01.jpg",
    ])
    expect(created.job?.request?.framePreparation?.extraction?.status).toBe("extracted")
    expect(created.job?.request?.framePreparation?.extraction?.source).toBe("ffmpeg")
    expect(created.job?.request?.framePreparation?.extraction?.outputDir).toBe("assets/generated/codex-frames/candidate_local_extract")
    expect(created.job?.artifactPaths).toEqual([
      "assets/generated/codex-frames/candidate_local_extract/frame-01.jpg",
    ])
  })

  test("persists blocked live Codex video jobs instead of sending local frame URLs", async () => {
    const store = createStore()
    const mediaPath = resolve(store.config.workspaceDir, "incoming", "demo.mp4")
    const fakeExtractor: CodexVideoFrameExtractor = {
      async extract() {
        throw new Error("live local extraction must not run")
      },
    }

    const response = await routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "video-understand",
      mediaUrl: mediaPath,
      referenceFrameUrls: ["file:///tmp/slotok/frames/frame-01.jpg"],
      live: true,
      maxSpendUsd: 0.25,
      apiKey: "test-key",
    }), store, { codexFrameExtractor: fakeExtractor })
    const payload = await response?.json() as {
      readonly job?: {
        readonly mode?: string
        readonly status?: string
        readonly error?: string | null
        readonly response?: { readonly phase?: string } | null
      }
      readonly state?: UgcLocalState
      readonly error?: string
    }

    expect(response?.status).toBe(400)
    expect(payload.job?.mode).toBe("live")
    expect(payload.job?.status).toBe("blocked")
    expect(payload.job?.error).toContain("externally reachable referenceFrameUrls")
    expect(payload.job?.response?.phase).toBe("live-preparation")
    expect(payload.state?.providerJobs[0]?.status).toBe("blocked")
  })

  test("persists failed live Codex requirement and provider errors as provider jobs", async () => {
    const store = createStore()

    const missingKeyResponse = await routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "image-understand",
      mediaUrl: "https://cdn.example/hook-frame.jpg",
      live: true,
      maxSpendUsd: 0.25,
    }), store)
    const missingKey = await missingKeyResponse?.json() as {
      readonly job?: {
        readonly status?: string
        readonly error?: string | null
        readonly request?: { readonly provider?: string }
        readonly response?: { readonly phase?: string } | null
      }
    }

    expect(missingKeyResponse?.status).toBe(400)
    expect(missingKey.job?.status).toBe("failed")
    expect(missingKey.job?.error).toContain("explicit apiKey")
    expect(missingKey.job?.request?.provider).toBe("codex")
    expect(missingKey.job?.response?.phase).toBe("live-requirements")

    const failingRunner = async (_input: CodexAnalyzeInput, _options: CodexLiveOptions): Promise<CodexAnalyzeResult> => {
      throw new Error("Codex HTTP 500: provider unavailable")
    }
    const providerErrorResponse = await routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "image-understand",
      mediaUrl: "https://cdn.example/hook-frame.jpg",
      live: true,
      maxSpendUsd: 0.25,
      apiKey: "test-key",
    }), store, { codexAnalyzeRunner: failingRunner })
    const providerError = await providerErrorResponse?.json() as {
      readonly job?: {
        readonly status?: string
        readonly error?: string | null
        readonly response?: { readonly phase?: string } | null
      }
      readonly state?: UgcLocalState
    }

    expect(providerErrorResponse?.status).toBe(502)
    expect(providerError.job?.status).toBe("failed")
    expect(providerError.job?.error).toContain("provider unavailable")
    expect(providerError.job?.response?.phase).toBe("live-execution")
    expect(providerError.state?.providerJobs[0]?.status).toBe("failed")
  })

  test("creates KIE dry-run plans from selected Codex analysis jobs", async () => {
    const store = createStore()
    const candidate = store.read().workspace.candidates[0]
    if (!candidate) throw new Error("missing candidate")
    const runner = async (input: CodexAnalyzeInput, _options: CodexLiveOptions): Promise<CodexAnalyzeResult> => ({
      mode: "live",
      prepared: {
        provider: "codex",
        endpoint: "POST /v1/chat/completions",
        operation: input.operation,
        model: input.model ?? "gpt-4.1-mini",
        estimatedCostUsd: 0.01,
        payload: {
          model: input.model ?? "gpt-4.1-mini",
          messages: [
            { role: "system", content: "stub" },
            { role: "user", content: [{ type: "text", text: input.prompt ?? "Analyze the hook" }, { type: "image_url", image_url: { url: input.mediaUrl } }] },
          ],
          max_tokens: input.maxOutputTokens ?? 900,
          metadata: {
            provider: "codex",
            operation: input.operation,
            mediaUrl: input.mediaUrl,
            targetIds: input.targetIds ?? [],
          },
        },
      },
      response: {
        choices: [{ message: { content: "Hook opens with a messy cold open, fast caption beat, then product proof." } }],
      },
    })
    const analysisResponse = await routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "image-understand",
      mediaUrl: "https://cdn.example/hook-frame.jpg",
      prompt: "Extract hook, caption, and proof mechanics.",
      targetIds: [candidate.id],
      live: true,
      maxSpendUsd: 0.25,
      apiKey: "test-key",
    }), store, { codexAnalyzeRunner: runner })
    const analysis = await analysisResponse?.json() as {
      readonly job?: { readonly id?: string }
    }
    const analysisJobId = analysis.job?.id ?? ""

    const kieResponse = await routeUgc(jsonRequest("/api/ugc/kie/analysis-to-kie", {
      analysisJobId,
      lane: "ugc-ads",
      targetId: candidate.id,
      targetKind: "candidate",
    }), store)
    const planned = await kieResponse?.json() as {
      readonly job?: {
        readonly provider?: string
        readonly operation?: string
        readonly mode?: string
        readonly status?: string
        readonly request?: {
          readonly operation?: string
          readonly kieRequest?: {
            readonly operation?: string
            readonly prompt?: string
            readonly imageUrl?: string
            readonly referenceImageUrls?: readonly string[]
          }
          readonly analysisToKie?: {
            readonly sourceJobId?: string
            readonly lane?: string
            readonly target?: { readonly id?: string; readonly kind?: string }
          }
        }
      }
      readonly prepared?: { readonly provider?: string; readonly operation?: string }
      readonly state?: UgcLocalState
    }

    expect(kieResponse?.status).toBe(200)
    expect(planned.job?.provider).toBe("kie")
    expect(planned.job?.operation).toBe("analysis-to-kie")
    expect(planned.job?.mode).toBe("dry-run")
    expect(planned.job?.status).toBe("planned")
    expect(planned.prepared?.provider).toBe("kie")
    expect(planned.prepared?.operation).toBe("video-text")
    expect(planned.job?.request?.kieRequest?.prompt).toContain("Product lane: ugc-ads")
    expect(planned.job?.request?.kieRequest?.prompt).toContain("Hook opens with a messy cold open")
    expect(planned.job?.request?.kieRequest?.imageUrl).toBeUndefined()
    expect(planned.job?.request?.kieRequest?.referenceImageUrls).toBeUndefined()
    expect(planned.job?.request?.analysisToKie?.sourceJobId).toBe(analysisJobId)
    expect(planned.job?.request?.analysisToKie?.target?.id).toBe(candidate.id)
    expect(planned.job?.request?.analysisToKie?.target?.kind).toBe("candidate")
    expect(planned.state?.providerJobs[0]?.provider).toBe("kie")
  })

  test("serves workflow runs, append-only event polling, and SSE startup", async () => {
    const store = createStore()
    const createdResponse = await routeUgc(jsonRequest("/api/ugc/workflows", {
      title: "Dynamic workflow proof",
      source: "dynamic-workflow",
      scriptId: "workflow-proof",
      args: { prompt: "safe", apiKey: "sk-test" },
      lane: "analysis",
    }), store)
    const created = await createdResponse?.json() as { readonly workflowRun?: { readonly id: string; readonly args: { readonly apiKey?: string } } }
    const runId = created.workflowRun?.id ?? ""

    expect(createdResponse?.status).toBe(201)
    expect(runId).not.toBe("")
    expect(created.workflowRun?.args.apiKey).toBe("[redacted]")

    const phaseResponse = await routeUgc(jsonRequest(`/api/ugc/workflows/${encodeURIComponent(runId)}/events`, {
      type: "phase",
      phase: "scouting",
      agentLabel: "Pi Scout",
      message: "Entered scouting",
      payload: { token: "secret-token", visible: true },
    }), store)
    const phase = await phaseResponse?.json() as { readonly event?: { readonly eventId: number; readonly payload: { readonly token?: string } } }
    const completedResponse = await routeUgc(jsonRequest(`/api/ugc/workflows/${encodeURIComponent(runId)}/events`, {
      type: "completed",
      message: "Done",
      payload: { importedRecordIds: ["candidate_1"] },
      artifactPaths: ["artifacts/workflows/result.json"],
    }), store)
    const completed = await completedResponse?.json() as { readonly event?: { readonly eventId: number }; readonly workflowRun?: { readonly status: string; readonly artifactPaths: readonly string[] } }

    expect(phaseResponse?.status).toBe(201)
    expect(phase.event?.payload.token).toBe("[redacted]")
    expect(completed.workflowRun?.status).toBe("succeeded")
    expect(completed.workflowRun?.artifactPaths).toContain("artifacts/workflows/result.json")

    const eventsResponse = await routeUgc(new Request(`http://127.0.0.1/api/ugc/workflows/${encodeURIComponent(runId)}/events?after=${phase.event?.eventId ?? 0}`), store)
    const events = await eventsResponse?.json() as { readonly events?: readonly { readonly eventId: number; readonly type: string }[] }
    expect(events.events?.map((event) => event.eventId)).toEqual([completed.event?.eventId])

    const emptyResponse = await routeUgc(new Request(`http://127.0.0.1/api/ugc/workflows/${encodeURIComponent(runId)}/events?after=${completed.event?.eventId ?? 0}`), store)
    const empty = await emptyResponse?.json() as { readonly events?: readonly object[] }
    expect(empty.events).toEqual([])

    const listResponse = await routeUgc(new Request("http://127.0.0.1/api/ugc/workflows"), store)
    const list = await listResponse?.json() as { readonly workflowRuns?: readonly { readonly id: string }[] }
    expect(list.workflowRuns?.[0]?.id).toBe(runId)

    const streamResponse = await routeUgc(new Request("http://127.0.0.1/api/ugc/workflows/events/stream?after=0"), store)
    expect(streamResponse?.headers.get("content-type")).toContain("text/event-stream")
    const reader = streamResponse?.body?.getReader()
    const startup = await reader?.read()
    expect(new TextDecoder().decode(startup?.value)).toContain("event: ready")
    await reader?.cancel()
  })

  test("imports workflow handoff payloads through dry-run default and apply true route bodies", async () => {
    const store = createStore()
    const createdResponse = await routeUgc(jsonRequest("/api/ugc/workflows", {
      title: "Workflow import route proof",
      source: "omp",
      lane: "ugc-ads",
    }), store)
    const created = await createdResponse?.json() as { readonly workflowRun?: { readonly id: string } }
    const runId = created.workflowRun?.id ?? ""
    const candidateId = store.read().workspace.candidates[0]?.id ?? ""
    if (!runId || !candidateId) throw new Error("missing route import fixture")

    const payload = {
      lane: "ugc-ads",
      sourcePolicy: "metadata-only",
      providerJobs: [{
        id: "job_route_workflow_import",
        provider: "local",
        operation: "route-workflow-import-plan",
        targetIds: [candidateId],
        request: { apiKey: "sk-route", summary: "route dry-run" },
      }],
      candidatePatches: [{ candidateId, status: "needs-revision", notes: ["Route candidate note."] }],
      artifactPaths: ["artifacts/workflows/route-import/result.json"],
      result: { token: "secret-route", ok: true },
    }

    const dryRunResponse = await routeUgc(jsonRequest(`/api/ugc/workflows/${encodeURIComponent(runId)}/import`, { payload }), store)
    const dryRun = await dryRunResponse?.json() as { readonly dryRun?: boolean; readonly imported?: boolean; readonly valid?: boolean }
    expect(dryRunResponse?.status).toBe(200)
    expect(dryRun).toMatchObject({ dryRun: true, imported: false, valid: true })
    expect(store.read().providerJobs.some((job) => job.id === "job_route_workflow_import")).toBe(false)

    const applyResponse = await routeUgc(jsonRequest(`/api/ugc/workflows/${encodeURIComponent(runId)}/import`, { payload, apply: true }), store)
    const applied = await applyResponse?.json() as { readonly imported?: boolean; readonly workflowRun?: { readonly status: string; readonly artifactPaths: readonly string[] }; readonly events?: readonly { readonly type: string }[] }
    const state = store.read()

    expect(applyResponse?.status).toBe(201)
    expect(applied.imported).toBe(true)
    expect(applied.workflowRun?.status).toBe("succeeded")
    expect(applied.workflowRun?.artifactPaths).toContain("artifacts/workflows/route-import/result.json")
    expect(applied.events?.map((event) => event.type)).toEqual(["import", "result"])
    expect(state.providerJobs.find((job) => job.id === "job_route_workflow_import")?.request).toEqual({ apiKey: "[redacted]", summary: "route dry-run" })
    expect(state.workflowEvents.filter((event) => event.runId === runId).map((event) => event.type)).toEqual(["created", "import", "result"])
  })

  test("creates a browser-visible brainrot demo workflow from safe reference mechanics", async () => {
    const store = createStore()
    await seedDemoWorkflowFixtures(store)

    const response = await routeUgc(jsonRequest("/api/ugc/workflows/demo", { lane: "brainrot" }), store)
    const launched = await response?.json() as DemoWorkflowRouteResponse
    const run = launched.workflowRuns?.[0]
    if (!run) throw new Error("missing brainrot demo workflow run")
    const state = store.read()
    const providerJob = state.providerJobs.find((job) => job.operation === "demo-brainrot-local-plan")
    const archive = state.referenceArchives.find((item) => item.id === "archive_reference_tiktok_pleometric")

    const handoffPath = resolve(store.config.cwd, "artifacts/workflows/demo/brainrot/handoff.json")
    expect(response?.status).toBe(201)
    expect(launched.importResults?.[0]).toMatchObject({ imported: true, valid: true, lane: "brainrot", sourcePolicy: "abstract-mechanics" })
    expect(run).toMatchObject({ lane: "brainrot", status: "succeeded", currentPhase: "completed" })
    expect(run.importedRecordIds).toEqual(expect.arrayContaining(["demo_handoff_brainrot", "archive_reference_tiktok_pleometric"]))
    expect(run.artifactPaths).toContain("artifacts/workflows/demo/brainrot/handoff.json")
    expect(state.workflowEvents.filter((event) => event.runId === run.id).map((event) => event.type)).toEqual(["created", "queued", "phase", "message", "import", "result", "completed"])
    expect(providerJob?.provider).toBe("local")
    expect(JSON.stringify(providerJob?.request)).not.toContain("https://cdn.example")
    expect(JSON.stringify(providerJob?.request)).not.toContain("Cookie")
    expect(archive?.sourcePolicy).toBe("abstract-mechanics")
    expect(JSON.stringify(archive?.candidateFormatOutputs)).not.toContain("https://cdn.example")
    expect(existsSync(handoffPath)).toBe(true)
    expect(JSON.parse(readFileSync(handoffPath, "utf8"))).toMatchObject({ lane: "brainrot" })
  })


  test("creates a UGC ads demo workflow from imported manifests and updates the demo candidate", async () => {
    const store = createStore()
    await seedDemoWorkflowFixtures(store)

    const response = await routeUgc(jsonRequest("/api/ugc/workflows/demo", { lane: "ugc-ads" }), store)
    const launched = await response?.json() as DemoWorkflowRouteResponse
    const run = launched.workflowRuns?.[0]
    if (!run) throw new Error("missing ugc-ads demo workflow run")
    const state = store.read()
    const providerJob = state.providerJobs.find((job) => job.operation === "demo-ugc-ads-local-plan")
    const candidate = state.workspace.candidates.find((item) => item.id === "candidate_soft_demo_01")
    const candidateNotes = state.workspace.reviewNotes.filter((note) => candidate?.reviewNoteIds.includes(note.id))

    const handoffPath = resolve(store.config.cwd, "artifacts/workflows/demo/ugc-ads/handoff.json")
    expect(response?.status).toBe(201)
    expect(launched.importResults?.[0]?.plannedChanges.candidateIds).toEqual(["candidate_soft_demo_01"])
    expect(run).toMatchObject({ lane: "ugc-ads", status: "succeeded", currentPhase: "completed" })
    expect(run.importedRecordIds).toEqual(expect.arrayContaining(["demo_handoff_ugc_ads", "candidate_soft_demo_01", "archive_reference_tiktok_mynameissico"]))
    expect(run.artifactPaths).toContain("artifacts/workflows/demo/ugc-ads/handoff.json")
    expect(providerJob?.provider).toBe("local")
    expect(providerJob?.targetIds).toEqual(expect.arrayContaining(["candidate_soft_demo_01", "reference_tiktok_mynameissico", "reference_provider_higgsfield_assets"]))
    expect(JSON.stringify(providerJob?.request)).not.toContain("localPath")
    expect(JSON.stringify(providerJob?.request)).not.toContain("assetUrl")
    expect(existsSync(handoffPath)).toBe(true)
    expect(JSON.parse(readFileSync(handoffPath, "utf8"))).toMatchObject({ lane: "ugc-ads" })
    expect(candidate?.status).toBe("ready")
    expect(candidateNotes.some((note) => note.body.includes("metadata-only UGC ads handoff"))).toBe(true)
  })

  test("creates both demo workflow lanes with the all launcher", async () => {
    const store = createStore()
    await seedDemoWorkflowFixtures(store)

    const response = await routeUgc(jsonRequest("/api/ugc/workflows/demo", { lane: "all" }), store)
    const launched = await response?.json() as DemoWorkflowRouteResponse
    const lanes = launched.workflowRuns?.map((run) => run.lane)
    const state = store.read()

    expect(response?.status).toBe(201)
    expect(lanes).toEqual(["brainrot", "ugc-ads"])
    expect(launched.importResults?.map((result) => result.imported)).toEqual([true, true])
    expect(launched.workflowRuns?.every((run) => run.status === "succeeded" && run.currentPhase === "completed")).toBe(true)
    expect(state.workflowRuns.filter((run) => run.scriptId === "slotok-demo-workflows").length).toBe(2)
    expect(state.providerJobs.some((job) => job.operation === "demo-brainrot-local-plan")).toBe(true)
    expect(state.providerJobs.some((job) => job.operation === "demo-ugc-ads-local-plan")).toBe(true)
  })

  test("returns null for routes owned by other daemon handlers", async () => {
    const store = createStore()
    await expect(routeUgc(new Request("http://127.0.0.1/api/ugc/kie/capabilities"), store)).resolves.toBeNull()
    await expect(routeUgc(new Request("http://127.0.0.1/api/health"), store)).resolves.toBeNull()
  })
})

describe("Slotok workflow adapter", () => {
  test("registers dynamic workflow runs and appends callback events without executing scripts", () => {
    const runs: SlotokWorkflowRunInput[] = []
    const events: { readonly runId: string; readonly input: SlotokWorkflowEventInput }[] = []
    const store: {
      readonly createWorkflowRun: (input: SlotokWorkflowRunInput) => { readonly id: string }
      readonly appendWorkflowEvent: (runId: string, input: SlotokWorkflowEventInput) => void
    } = {
      createWorkflowRun(input) {
        runs.push(input)
        return { id: `workflow_${runs.length}` }
      },
      appendWorkflowEvent(runId, input) {
        events.push({ runId, input })
      },
    }

    const run = registerSlotokWorkflowRun(store, {
      title: "Dynamic workflow proof",
      workflowName: "Proof workflow",
      scriptId: "workflow-proof",
      scriptPath: "workflows/proof.js",
      args: { prompt: "safe", token: "secret-token" },
      metadata: { workspace: "slotok" },
    })
    const result: { apiKey: string; count: bigint; child?: { readonly parent: object } } = {
      apiKey: "sk-test",
      count: 9n,
    }
    result.child = { parent: result }

    const callbacks = createSlotokWorkflowCallbacks(store, run.id)
    callbacks.onLog("planning complete")
    callbacks.onPhase("scouting")
    callbacks.onAgentStart({ label: "Pi Scout", phase: "scouting", prompt: "collect evidence" })
    callbacks.onAgentEnd({ label: "Pi Scout", phase: "scouting", result })

    expect(runs).toEqual([{
      title: "Dynamic workflow proof",
      source: "dynamic-workflow",
      scriptId: "workflow-proof",
      args: {
        workflowName: "Proof workflow",
        scriptId: "workflow-proof",
        scriptPath: "workflows/proof.js",
        args: { prompt: "safe", token: "[redacted]" },
        metadata: { workspace: "slotok" },
      },
    }])
    expect(events.map((event) => event.input.type)).toEqual(["message", "phase", "started", "message"])
    expect(events.map((event) => event.runId)).toEqual(["workflow_1", "workflow_1", "workflow_1", "workflow_1"])
    expect(events[1]?.input).toMatchObject({ type: "phase", phase: "scouting", message: "scouting" })
    expect(events[2]?.input).toMatchObject({
      type: "started",
      phase: "scouting",
      agentLabel: "Pi Scout",
      payload: { kind: "agent-start", prompt: "collect evidence" },
    })
    expect(events[3]?.input).toMatchObject({
      type: "message",
      phase: "scouting",
      agentLabel: "Pi Scout",
      payload: {
        kind: "agent-end",
        resultJson: {
          apiKey: "[redacted]",
          count: "9n",
          child: { parent: "[circular]" },
        },
      },
    })
  })
})

interface DemoWorkflowRouteResponse {
  readonly workflowRuns?: readonly {
    readonly id: string
    readonly lane: string
    readonly status: string
    readonly currentPhase: string | null
    readonly scriptId: string | null
    readonly importedRecordIds: readonly string[]
    readonly artifactPaths: readonly string[]
  }[]
  readonly importResults?: readonly {
    readonly imported: boolean
    readonly valid: boolean
    readonly lane: string
    readonly sourcePolicy: string
    readonly plannedChanges: {
      readonly candidateIds: readonly string[]
    }
  }[]
}

function createStore(): UgcJsonStore {
  const cwd = mkdtempSync(resolve(tmpdir(), "ugc-routes-"))
  return new UgcJsonStore({
    cwd,
    root: "ugc-workspaces",
    now: () => "2026-06-10T00:00:00.000Z",
    sqliteSync: false,
  })
}

function createSqliteStore(cwd = mkdtempSync(resolve(tmpdir(), "ugc-routes-sqlite-"))): UgcJsonStore {
  return new UgcJsonStore({
    cwd,
    root: "ugc-workspaces",
    now: () => "2026-06-10T00:00:00.000Z",
  })
}

function jsonRequest(path: string, body: object): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function readState(response: Response | null): Promise<UgcLocalState> {
  if (!response) throw new Error("missing response")
  return await response.json() as UgcLocalState
}

async function seedDemoWorkflowFixtures(store: UgcJsonStore): Promise<void> {
  const pleometricRoot = await writeCatalogFixture(store.config.cwd, "data/tiktok-catalogue/pleometric", "pleometric")
  const mynameissicoRoot = await writeCatalogFixture(store.config.cwd, "data/tiktok-catalogue/mynameissico", "mynameissico")
  const higgsfieldManifest = await writeProviderManifestFixture(store.config.cwd, "data/ugc-studio/reference-assets/higgsfield/manifest.json", "higgsfield")
  const importResponse = await routeUgc(jsonRequest("/api/ugc/reference-catalog/import", {
    roots: [pleometricRoot, mynameissicoRoot],
    manifestPaths: [higgsfieldManifest],
  }), store)
  const imported = await importResponse?.json() as { readonly valid?: boolean; readonly imported?: boolean }
  if (!imported.valid || !imported.imported) throw new Error("missing demo workflow fixture imports")
}

async function writeCatalogFixture(cwd: string, root: string, handle = "pleometric"): Promise<string> {
  const absoluteRoot = resolve(cwd, root)
  await mkdir(absoluteRoot, { recursive: true })
  await writeCatalogVideo(absoluteRoot, "2026-03-05_7613899553590234375", "7613899553590234375", 1200, 45, handle)
  await writeCatalogVideo(absoluteRoot, "2026-03-08_7614988205481331976", "7614988205481331976", 2400, 67, handle)
  return root
}

async function writeCatalogVideo(root: string, stem: string, id: string, views: number, likes: number, handle: string): Promise<void> {
  await writeFile(resolve(root, `${stem}.info.json`), `${JSON.stringify({
    id,
    title: `Fixture TikTok ${id}`,
    uploader: "Fixture Creator",
    uploader_id: handle,
    duration: 12.5,
    view_count: views,
    like_count: likes,
    comment_count: 6,
    share_count: 3,
    save_count: 2,
    webpage_url: `https://www.tiktok.com/@fixture/video/${id}`,
    http_headers: { Cookie: "session=secret" },
    formats: [{ url: `https://cdn.example/${id}.mp4`, cookies: "secret" }],
  })}\n`)
  await writeFile(resolve(root, `${stem}.jpg`), "poster")
  await writeFile(resolve(root, `${stem}.mp4`), "video")
}

async function writeProviderManifestFixture(cwd: string, manifestPath: string, provider: "higgsfield" | "arcads"): Promise<string> {
  const absoluteManifestPath = resolve(cwd, manifestPath)
  await mkdir(resolve(absoluteManifestPath, ".."), { recursive: true })
  await writeFile(absoluteManifestPath, `${JSON.stringify({
    provider,
    captureTimestamp: "2026-06-19T00:00:00.000Z",
    manifestPath,
    sourcePages: [`https://${provider}.example/reference-assets`],
    rightsSummary: `Public ${provider} fixture asset for reference/inspiration only; no rights grant.`,
    useGuidance: "Metadata only; not a direct generation input.",
    assets: [
      {
        id: "marketing-slide-hyper-video",
        title: "Hyper Motion",
        assetUrl: `https://static.${provider}.example/marketing/slides/hyper-mini.mp4`,
        localPath: `data/ugc-studio/reference-assets/${provider}/marketing-slides/hyper.mp4`,
        mediaType: "video/mp4",
        sourcePageUrl: `https://${provider}.example/reference-assets`,
        bytes: 123,
        rights: "Public fixture; reference-only.",
      },
    ],
  })}\n`)
  return manifestPath
}
