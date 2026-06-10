import { mkdtempSync, readFileSync } from "node:fs"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "./ugc-json-store"

describe("UgcJsonStore", () => {
  test("bootstraps a repo-local workspace and writes JSON object shards", () => {
    const store = createStore()
    const state = store.read()

    expect(state.schemaVersion).toBe("ugc-studio.local-state.v1")
    expect(state.workspace.personas.length).toBeGreaterThan(0)
    expect(state.referenceArchives.length).toBe(state.workspace.referenceProfiles.length)
    expect(existsSync(resolve(store.config.workspaceDir, "workspace.json"))).toBe(true)
    expect(existsSync(resolve(store.config.workspaceDir, "personas", `${state.workspace.personas[0]?.id}.json`))).toBe(true)
    expect(existsSync(resolve(store.config.workspaceDir, "assets", "generated"))).toBe(true)
  })

  test("persists persona, candidate, branch, notes, provider job, reference archive, and export mutations", () => {
    const store = createStore()
    const initial = store.read()
    const personaId = initial.workspace.personas[0]?.id ?? ""
    const candidateId = initial.workspace.candidates[0]?.id ?? ""
    const branchId = initial.workspace.branchSnapshots[0]?.id ?? ""
    const referenceProfileId = initial.workspace.referenceProfiles[0]?.id ?? ""

    store.updatePersona(personaId, {
      status: "selected",
      voice: { energy: 42 },
      profileBible: { niche: "quiet Korean-beauty fitness proof" },
    })
    store.updateCandidate(candidateId, { status: "starred" })
    store.updateBranch(branchId, { status: "dead-end", decisionNote: "Too generic; fork softer hook branch." })
    store.createReviewNote({
      attachedTo: { kind: "candidate", id: candidateId },
      verdict: "revise",
      body: "Make the middle less scripted.",
      requestedChange: "Regenerate with more casual delivery.",
    })
    store.createProviderJob({
      provider: "kie",
      operation: "image-text",
      request: { prompt: "dry run only" },
      targetIds: [candidateId],
      spendCapUsd: 0.05,
    })
    store.createReferenceArchive({
      referenceProfileId,
      archiveStatus: "decomposed",
      preservedMechanics: { poseTiming: "hold product on beat three", captionTemplate: "two-line hook" },
      swappedFields: ["Synthetic persona", "Product offer"],
      blockedFields: ["Source pixels and audio"],
      guardrails: ["Use abstract mechanics only"],
      candidateFormatOutputs: [
        {
          id: "format_test_pose",
          title: "Pose timing test",
          kind: "pose-plan",
          summary: "Keep gesture rhythm while replacing identity.",
          stageIds: ["stage_reference_profile"],
          candidateIds: [candidateId],
          manifestJson: { beats: [0, 2, 4] },
        },
      ],
      notes: ["abstract mechanics only"],
    })
    store.createExportManifest({ selectedCandidateId: candidateId, label: "Proof export", notes: ["draft manifest"] })

    const updated = store.read()
    const persona = updated.workspace.personas.find((item) => item.id === personaId)
    const candidate = updated.workspace.candidates.find((item) => item.id === candidateId)
    const branch = updated.workspace.branchSnapshots.find((item) => item.id === branchId)

    expect(persona?.status).toBe("selected")
    expect(persona?.voice.energy).toBe(42)
    expect(persona?.profileBible.niche).toBe("quiet Korean-beauty fitness proof")
    expect(candidate?.status).toBe("starred")
    expect(candidate?.reviewNoteIds.length).toBeGreaterThan(0)
    expect(branch?.status).toBe("dead-end")
    expect(branch?.decisionNote).toContain("Too generic")
    expect(updated.workspace.reviewNotes[0]?.body).toContain("less scripted")
    expect(updated.providerJobs[0]?.mode).toBe("dry-run")
    expect(updated.referenceArchives[0]?.notes).toContain("abstract mechanics only")
    expect(updated.referenceArchives[0]?.archiveStatus).toBe("decomposed")
    expect(updated.referenceArchives[0]?.candidateFormatOutputs[0]?.id).toBe("format_test_pose")
    expect(updated.exportManifests[0]?.label).toBe("Proof export")

    const reloaded = new UgcJsonStore({
      cwd: store.config.cwd,
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
    }).read()
    const archiveShard = JSON.parse(readFileSync(resolve(store.config.workspaceDir, "reference-archives", `${updated.referenceArchives[0]?.id}.json`), "utf8")) as {
      readonly candidateFormatOutputs?: readonly { readonly id: string }[]
    }
    expect(reloaded.referenceArchives[0]?.candidateFormatOutputs[0]?.id).toBe("format_test_pose")
    expect(archiveShard.candidateFormatOutputs?.[0]?.id).toBe("format_test_pose")
  })

  test("deletes reference archive records without touching source profiles", () => {
    const store = createStore()
    const initial = store.read()
    const referenceProfileId = initial.workspace.referenceProfiles[0]?.id ?? ""
    const archive = store.createReferenceArchive({ referenceProfileId, notes: ["temporary archive"] }).referenceArchives[0]

    expect(archive?.referenceProfileId).toBe(referenceProfileId)

    const updated = store.deleteReferenceArchive(archive?.id ?? "")

    expect(updated.referenceArchives.some((item) => item.id === archive?.id)).toBe(false)
    expect(updated.workspace.referenceProfiles.some((item) => item.id === referenceProfileId)).toBe(true)
  })
})

function createStore(): UgcJsonStore {
  const cwd = mkdtempSync(resolve(tmpdir(), "ugc-json-store-"))
  return new UgcJsonStore({
    cwd,
    root: "ugc-workspaces",
    now: () => "2026-06-10T00:00:00.000Z",
  })
}
