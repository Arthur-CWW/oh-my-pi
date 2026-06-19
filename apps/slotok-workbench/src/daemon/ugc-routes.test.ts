import { mkdir, writeFile } from "node:fs/promises"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "./ugc-json-store"
import { routeUgc } from "./ugc-routes"
import type { CodexVideoFrameExtractor } from "./codex-video-frames"
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

  test("blocks live Codex video jobs from using local extracted frame URLs", async () => {
    const store = createStore()
    const mediaPath = resolve(store.config.workspaceDir, "incoming", "demo.mp4")
    const fakeExtractor: CodexVideoFrameExtractor = {
      async extract() {
        throw new Error("live local extraction must not run")
      },
    }

    await expect(routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "video-understand",
      mediaUrl: mediaPath,
      live: true,
      maxSpendUsd: 0.25,
      apiKey: "test-key",
    }), store, { codexFrameExtractor: fakeExtractor })).rejects.toThrow("externally reachable referenceFrameUrls")
  })


  test("rejects live Codex analysis jobs without an explicit API key", async () => {
    const store = createStore()

    await expect(routeUgc(jsonRequest("/api/ugc/codex/jobs", {
      operation: "image-understand",
      mediaUrl: "file:///tmp/slotok/hook-frame.jpg",
      live: true,
      maxSpendUsd: 0.25,
    }), store)).rejects.toThrow("explicit apiKey")
  })

  test("returns null for routes owned by other daemon handlers", async () => {
    const store = createStore()
    await expect(routeUgc(new Request("http://127.0.0.1/api/ugc/kie/capabilities"), store)).resolves.toBeNull()
    await expect(routeUgc(new Request("http://127.0.0.1/api/health"), store)).resolves.toBeNull()
  })
})

function createStore(): UgcJsonStore {
  const cwd = mkdtempSync(resolve(tmpdir(), "ugc-routes-"))
  return new UgcJsonStore({
    cwd,
    root: "ugc-workspaces",
    now: () => "2026-06-10T00:00:00.000Z",
    sqliteSync: false,
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

async function writeCatalogFixture(cwd: string, root: string): Promise<string> {
  const absoluteRoot = resolve(cwd, root)
  await mkdir(absoluteRoot, { recursive: true })
  await writeCatalogVideo(absoluteRoot, "2026-03-05_7613899553590234375", "7613899553590234375", 1200, 45)
  await writeCatalogVideo(absoluteRoot, "2026-03-08_7614988205481331976", "7614988205481331976", 2400, 67)
  return root
}

async function writeCatalogVideo(root: string, stem: string, id: string, views: number, likes: number): Promise<void> {
  await writeFile(resolve(root, `${stem}.info.json`), `${JSON.stringify({
    id,
    title: `Fixture TikTok ${id}`,
    uploader: "Fixture Creator",
    uploader_id: "pleometric",
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
