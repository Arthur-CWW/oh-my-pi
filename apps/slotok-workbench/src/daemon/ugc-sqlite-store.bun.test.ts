import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

  test("imports JSON state when a SQLite database does not exist", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "ugc-sqlite-import-"))
    const jsonOnly = createStore(cwd, false)
    const importedState = jsonOnly.createProviderJob({
      provider: "kie",
      operation: "video-text",
      request: { prompt: "json import proof" },
    })

    const sqliteSynced = createStore(cwd)
    const readState = sqliteSynced.read()
    const sqlite = new UgcSqliteStore({ workspaceDir: sqliteSynced.config.workspaceDir })

    expect(readState.providerJobs[0]?.id).toBe(importedState.providerJobs[0]?.id)
    expect(sqlite.readValidState()?.providerJobs[0]?.id).toBe(importedState.providerJobs[0]?.id)
    expect(sqlite.readObjects("provider-jobs")).toHaveLength(1)
  })

  test("reads existing valid SQLite before stale state JSON", () => {
    const store = createStore()
    const sqliteState = store.createProviderJob({
      provider: "kie",
      operation: "video-text",
      request: { prompt: "sqlite wins proof" },
    })
    const staleState: UgcLocalState = {
      ...sqliteState,
      workspace: { ...sqliteState.workspace, title: "Stale JSON Workspace" },
      providerJobs: [],
    }
    writeFileSync(store.config.statePath, `${JSON.stringify(staleState, null, 2)}\n`)

    const readState = createStore(store.config.cwd).read()
    const repairedState = readLocalState(store.config.statePath)

    expect(readState.workspace.title).toBe(sqliteState.workspace.title)
    expect(readState.providerJobs[0]?.id).toBe(sqliteState.providerJobs[0]?.id)
    expect(repairedState.workspace.title).toBe(sqliteState.workspace.title)
    expect(repairedState.providerJobs[0]?.id).toBe(sqliteState.providerJobs[0]?.id)
  })

  test("falls back to JSON and rewrites invalid SQLite", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "ugc-sqlite-corrupt-"))
    const jsonOnly = createStore(cwd, false)
    const jsonState = jsonOnly.createProviderJob({
      provider: "kie",
      operation: "video-text",
      request: { prompt: "corrupt sqlite fallback proof" },
    })
    const sqlite = new UgcSqliteStore({ workspaceDir: jsonOnly.config.workspaceDir })
    writeFileSync(jsonOnly.config.sqlitePath, "not a sqlite database")

    expect(sqlite.readValidState()).toBeNull()

    const readState = createStore(cwd).read()
    const rewrittenState = sqlite.readValidState()

    expect(readState.providerJobs[0]?.id).toBe(jsonState.providerJobs[0]?.id)
    expect(rewrittenState?.providerJobs[0]?.id).toBe(jsonState.providerJobs[0]?.id)
    expect(sqlite.readObjects("provider-jobs")).toHaveLength(1)
  })

  test("SQLite primary reads repair missing JSON shards", () => {
    const store = createStore()
    const sqliteState = store.createProviderJob({
      provider: "codex",
      operation: "image-understand",
      request: { prompt: "missing shard repair proof" },
    })
    const jobId = sqliteState.providerJobs[0]?.id ?? ""
    rmSync(store.config.statePath, { force: true })
    rmSync(resolve(store.config.workspaceDir, "workspace.json"), { force: true })
    rmSync(resolve(store.config.workspaceDir, "provider-jobs", `${jobId}.json`), { force: true })
    const staleJobPath = resolve(store.config.workspaceDir, "provider-jobs", "job_removed.json")
    writeFileSync(staleJobPath, "{\"id\":\"job_removed\"}\n")

    const readState = createStore(store.config.cwd).read()
    const repairedState = readLocalState(store.config.statePath)
    const repairedWorkspace = JSON.parse(readFileSync(resolve(store.config.workspaceDir, "workspace.json"), "utf8")) as { readonly id?: string }
    const repairedJob = JSON.parse(readFileSync(resolve(store.config.workspaceDir, "provider-jobs", `${jobId}.json`), "utf8")) as { readonly id?: string }

    expect(readState.providerJobs[0]?.id).toBe(jobId)
    expect(repairedState.providerJobs[0]?.id).toBe(jobId)
    expect(repairedWorkspace.id).toBe(sqliteState.workspace.id)
    expect(repairedJob.id).toBe(jobId)
    expect(existsSync(staleJobPath)).toBe(false)
  })

  test("older stale JSON never overwrites valid SQLite", () => {
    const store = createStore()
    const sqliteState = store.createProviderJob({
      provider: "codex",
      operation: "image-understand",
      request: { prompt: "stale json must not overwrite sqlite" },
    })
    const staleState: UgcLocalState = {
      ...sqliteState,
      workspace: { ...sqliteState.workspace, title: "Older Stale JSON", updatedAt: "2025-01-01T00:00:00.000Z" },
      providerJobs: [],
      updatedAt: "2025-01-01T00:00:00.000Z",
    }
    writeFileSync(store.config.statePath, `${JSON.stringify(staleState, null, 2)}\n`)

    const readState = createStore(store.config.cwd).read()
    const sqlite = new UgcSqliteStore({ workspaceDir: store.config.workspaceDir })
    const persistedSqliteState = sqlite.readValidState()

    expect(readState.workspace.title).toBe(sqliteState.workspace.title)
    expect(readState.providerJobs[0]?.id).toBe(sqliteState.providerJobs[0]?.id)
    expect(persistedSqliteState?.workspace.title).toBe(sqliteState.workspace.title)
    expect(persistedSqliteState?.providerJobs[0]?.id).toBe(sqliteState.providerJobs[0]?.id)
  })

  test("newer JSON imports over existing valid SQLite", () => {
    const store = createStore()
    const sqliteState = store.createProviderJob({
      provider: "codex",
      operation: "image-understand",
      request: { prompt: "newer json import baseline" },
    })
    const newerState: UgcLocalState = {
      ...sqliteState,
      workspace: { ...sqliteState.workspace, title: "Newer JSON Workspace", updatedAt: "2099-01-01T00:00:00.000Z" },
      providerJobs: [],
      updatedAt: "2099-01-01T00:00:00.000Z",
    }
    writeFileSync(store.config.statePath, `${JSON.stringify(newerState, null, 2)}\n`)

    const readState = createStore(store.config.cwd).read()
    const sqlite = new UgcSqliteStore({ workspaceDir: store.config.workspaceDir })
    const persistedSqliteState = sqlite.readValidState()

    expect(readState.workspace.title).toBe("Newer JSON Workspace")
    expect(readState.providerJobs).toHaveLength(0)
    expect(persistedSqliteState?.workspace.title).toBe("Newer JSON Workspace")
    expect(persistedSqliteState?.providerJobs).toHaveLength(0)
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

function readLocalState(path: string): UgcLocalState {
  return JSON.parse(readFileSync(path, "utf8")) as UgcLocalState
}

function createStore(cwd = mkdtempSync(resolve(tmpdir(), "ugc-sqlite-store-")), sqliteSync: boolean | UgcSqliteStore = true): UgcJsonStore {
  return new UgcJsonStore({
    cwd,
    root: "data/ugc-studio/workspaces",
    workspaceId: "workspace_sqlite_test",
    now: () => "2026-06-10T00:00:00.000Z",
    sqliteSync,
  })
}
