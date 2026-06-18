import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "./ugc-json-store"
import { UgcSqliteStore } from "./ugc-sqlite-store"
import type { UgcLocalState } from "../ugc/local-state"

describe("UgcSqliteStore", () => {
  test("writes the workspace database under the local-first workspace directory", () => {
    const store = createStore()
    const state = store.read()

    expect(store.config.sqlitePath).toBe(resolve(store.config.workspaceDir, "workspace.sqlite"))
    expect(existsSync(store.config.sqlitePath)).toBe(true)
    expect(store.sqliteStore?.readState()?.workspace.id).toBe(state.workspace.id)
  })

  test("imports JSON state once when a SQLite database does not exist", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "ugc-sqlite-import-"))
    const jsonOnly = createStore(cwd, false)
    const importedState = jsonOnly.createProviderJob({
      provider: "kie",
      operation: "video-text",
      request: { prompt: "json import proof" },
    })

    const sqliteSynced = createStore(cwd)
    sqliteSynced.read()
    const sqlite = new UgcSqliteStore({ workspaceDir: sqliteSynced.config.workspaceDir })
    expect(sqlite.readObjects("provider-jobs")).toHaveLength(1)

    const staleState: UgcLocalState = {
      ...importedState,
      providerJobs: [],
    }
    writeFileSync(sqliteSynced.config.statePath, `${JSON.stringify(staleState, null, 2)}\n`)
    createStore(cwd).read()

    expect(sqlite.readObjects("provider-jobs")).toHaveLength(1)
  })

  test("keeps per-collection SQLite rows in sync after JSON store mutations", () => {
    const store = createStore()
    let state = store.read()
    const candidateId = state.workspace.candidates[0]?.id ?? ""
    const referenceProfileId = state.workspace.referenceProfiles[0]?.id ?? ""

    state = store.createBranch({ focus: "SQLite consolidation proof branch" })
    state = store.createReviewNote({
      attachedTo: { kind: "candidate", id: candidateId },
      verdict: "revise",
      body: "Tighten the opening frame before provider analysis.",
    })
    state = store.createProviderJob({
      provider: "codex",
      operation: "image-understand",
      request: { provider: "codex", operation: "image-understand" },
      targetIds: [candidateId],
    })
    state = store.createReferenceArchive({
      referenceProfileId,
      notes: ["SQLite mutation proof"],
    })
    state = store.createExportManifest({
      selectedCandidateId: candidateId,
      label: "SQLite export proof",
    })
    state = store.createResearchTarget({
      niche: "sqlite local-first proof",
      query: "ugc sqlite local state",
    })
    state = store.createTemplateMiningJob({
      researchTargetId: state.researchTargets[0]?.id ?? "",
    })

    const counts = store.sqliteStore?.countObjectsByCollection()
    expect(counts).toEqual({
      workspace: 1,
      personas: state.workspace.personas.length,
      campaigns: 1,
      branches: state.workspace.branchSnapshots.length,
      candidates: state.workspace.candidates.length,
      notes: state.workspace.reviewNotes.length,
      "provider-jobs": state.providerJobs.length,
      "reference-archives": state.referenceArchives.length,
      exports: state.exportManifests.length,
      "research-targets": state.researchTargets.length,
      "template-mining-jobs": state.templateMiningJobs.length,
    })

    const rawState = JSON.parse(readFileSync(store.config.statePath, "utf8")) as UgcLocalState
    expect(rawState.providerJobs[0]?.provider).toBe("codex")
  })
})

function createStore(cwd = mkdtempSync(resolve(tmpdir(), "ugc-sqlite-store-")), sqliteSync: boolean | UgcSqliteStore = true): UgcJsonStore {
  return new UgcJsonStore({
    cwd,
    root: "data/ugc-studio/workspaces",
    workspaceId: "workspace_sqlite_test",
    now: () => "2026-06-10T00:00:00.000Z",
    sqliteSync,
  })
}
