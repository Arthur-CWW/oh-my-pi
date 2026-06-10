import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "./ugc-json-store"
import { routeUgc } from "./ugc-routes"
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
