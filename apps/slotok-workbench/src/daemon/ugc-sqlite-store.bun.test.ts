import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "./ugc-json-store"
import { UgcSqliteStore } from "./ugc-sqlite-store"
import { routeUgc } from "./ugc-routes"
import { deriveUgcDeveloperGraph } from "../ugc/developer-graph"
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

  test("rejects mismatched bundle imports without mutating SQLite", () => {
    const store = createStore()
    const bundle = store.exportWorkspaceBundle({ label: "Mismatched SQLite bundle" })
    const stateBefore = store.read()
    const sqliteStateBefore = store.sqliteStore?.readState()
    if (!sqliteStateBefore) throw new Error("missing SQLite state")
    const mismatchedBundle = {
      ...bundle,
      workspaceId: "workspace_other_sqlite",
      state: {
        ...bundle.state,
        workspace: {
          ...bundle.state.workspace,
          id: "workspace_other_sqlite",
          title: "Imported Other SQLite Workspace",
        },
      },
    }

    const dryRun = store.importWorkspaceBundle({ bundle: mismatchedBundle, dryRun: true })

    expect(dryRun.valid).toBe(false)
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.imported).toBe(false)
    expect(dryRun.errors).toContain("Bundle workspace workspace_other_sqlite does not match current workspace workspace_sqlite_test.")
    expect(store.sqliteStore?.readState()).toEqual(sqliteStateBefore)
    expect(store.read()).toEqual(stateBefore)

    const applied = store.importWorkspaceBundle({ bundle: mismatchedBundle, dryRun: false })

    expect(applied.valid).toBe(false)
    expect(applied.imported).toBe(false)
    expect(applied.importedState).toBeNull()
    expect(store.sqliteStore?.readState()).toEqual(sqliteStateBefore)
    expect(store.read()).toEqual(stateBefore)
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
    const workflowRun = store.createWorkflowRun({
      title: "SQLite object mirror workflow proof",
      source: "local",
      lane: "brainrot",
      currentPhase: "queued",
    })
    store.appendWorkflowEvent(workflowRun.id, {
      type: "completed",
      phase: "completed",
      message: "SQLite object mirror workflow completed.",
    })
    for (let index = 0; index < 9; index += 1) {
      store.appendWorkflowEvent(workflowRun.id, {
        type: "message",
        phase: "proof",
        message: `SQLite object mirror message ${index + 1}.`,
      })
    }
    state = store.read()

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
      "workflow-runs": state.workflowRuns.length,
      "workflow-events": state.workflowEvents.length,
    })

    const sqliteWorkflowRuns = store.sqliteStore?.readObjects("workflow-runs") as readonly { readonly id?: string }[] | undefined
    const sqliteWorkflowEvents = store.sqliteStore?.readObjects("workflow-events") as readonly { readonly eventId?: number; readonly runId?: string; readonly type?: string }[] | undefined
    const workflowEvents = state.workflowEvents.filter((event) => event.runId === workflowRun.id)
    expect(sqliteWorkflowRuns?.map((run) => run.id)).toContain(workflowRun.id)
    expect(sqliteWorkflowEvents?.filter((event) => event.runId === workflowRun.id).map((event) => event.eventId)).toEqual(workflowEvents.map((event) => event.eventId))
    expect(sqliteWorkflowEvents?.filter((event) => event.runId === workflowRun.id).map((event) => event.type)).toEqual(workflowEvents.map((event) => event.type))

    const rawState = JSON.parse(readFileSync(store.config.statePath, "utf8")) as UgcLocalState
    expect(rawState.providerJobs[0]?.provider).toBe("codex")
  })

  test("reloads workflow import, review, branch, editor, and export state from SQLite", () => {
    const store = createStore()
    const initialState = store.read()
    const candidateId = initialState.workspace.candidates[0]?.id ?? ""
    const selectedCandidateId = initialState.workspace.candidates[1]?.id ?? candidateId
    const editorTrack = initialState.workspace.finalEditor.tracks[0]
    const editorClip = editorTrack?.clips[0]
    if (!candidateId || !selectedCandidateId || !editorTrack || !editorClip) throw new Error("missing SQLite reload fixture")

    const branchedState = store.createBranch({
      focus: "SQLite reload branch persistence",
      selectedCandidateIds: [candidateId],
      decisionNote: "Created before SQLite-only reload.",
    })
    const branchId = branchedState.workspace.branchSnapshots[0]?.id ?? ""
    store.updateBranch(branchId, {
      status: "promising",
      decisionNote: "Promising after SQLite reload.",
    })
    store.createReviewNote({
      attachedTo: { kind: "candidate", id: candidateId },
      verdict: "keep",
      body: "Review verdict should survive SQLite-only reload.",
    })
    store.updateFinalEditor({
      selectedCandidateId,
      trackUpdates: [{ id: editorTrack.id, visible: false, locked: true }],
      clipUpdates: [{
        trackId: editorTrack.id,
        clipId: editorClip.id,
        label: "SQLite reload clip",
        startSeconds: 1.25,
        durationSeconds: 2.5,
        payloadJson: { caption: "SQLite reload caption", text: "Durable editor payload" },
      }],
    })
    store.createExportManifest({
      selectedCandidateId,
      label: "SQLite reload export manifest",
      notes: ["Export manifest should survive SQLite-only reload."],
    })
    const workflowRun = store.createWorkflowRun({
      title: "SQLite reload workflow import",
      source: "local",
      lane: "ugc-ads",
      currentPhase: "queued",
      artifactPaths: ["artifacts/workflows/sqlite-reload/input.json"],
    })
    const importResult = store.importWorkflowHandoff(workflowRun.id, {
      lane: "ugc-ads",
      sourcePolicy: "metadata-only",
      providerJobs: [{
        id: "job_sqlite_reload_workflow_import",
        provider: "local",
        operation: "sqlite-reload-import",
        targetIds: [candidateId],
        request: { summary: "sqlite reload import", apiKey: "secret" },
        response: { ok: true },
        artifactPaths: ["artifacts/workflows/sqlite-reload/result.json"],
      }],
      candidatePatches: [{
        candidateId,
        status: "ready",
        notes: [{ body: "Workflow import candidate note should reload.", verdict: "keep" }],
      }],
      notes: [{
        attachedTo: { kind: "candidate", id: candidateId },
        verdict: "revise",
        body: "Workflow import note history should reload.",
      }],
      artifactPaths: ["artifacts/workflows/sqlite-reload/result.json"],
      result: { ok: true },
    }, false)
    store.appendWorkflowEvent(workflowRun.id, {
      type: "completed",
      phase: "completed",
      message: "SQLite reload workflow completed.",
    })
    rmSync(store.config.statePath, { force: true })

    const reloadedStore = createStore(store.config.cwd)
    const reloaded = reloadedStore.read()
    const reloadedRun = reloadedStore.listWorkflowRuns().find((run) => run.id === workflowRun.id)
    const reloadedEvents = reloadedStore.listWorkflowEvents(workflowRun.id)
    const reloadedBranch = reloaded.workspace.branchSnapshots.find((branch) => branch.id === branchId)
    const reloadedEditorTrack = reloaded.workspace.finalEditor.tracks.find((track) => track.id === editorTrack.id)
    const reloadedEditorClip = reloadedEditorTrack?.clips.find((clip) => clip.id === editorClip.id)
    const reloadedCandidate = reloaded.workspace.candidates.find((candidate) => candidate.id === candidateId)
    const reloadedGraph = deriveUgcDeveloperGraph(reloaded)
    const graphBranch = reloadedGraph.nodes.find((node) => node.entityId === branchId && node.family === "branch")
    const graphProviderJob = reloadedGraph.nodes.find((node) => node.entityId === "job_sqlite_reload_workflow_import" && node.family === "provider-job")
    const graphExport = reloadedGraph.nodes.find((node) => node.family === "export" && node.inputs.includes(selectedCandidateId))


    expect(importResult.imported).toBe(true)
    expect(reloadedBranch).toMatchObject({ status: "promising", decisionNote: "Promising after SQLite reload." })
    expect(reloaded.workspace.reviewNotes.some((note) => note.verdict === "keep" && note.body.includes("Review verdict"))).toBe(true)
    expect(reloaded.workspace.reviewNotes.some((note) => note.body.includes("Workflow import note history"))).toBe(true)
    expect(reloadedCandidate?.status).toBe("ready")
    expect(reloaded.workspace.finalEditor.selectedCandidateId).toBe(selectedCandidateId)
    expect(reloadedEditorTrack).toMatchObject({ visible: false, locked: true })
    expect(reloadedEditorClip).toMatchObject({ label: "SQLite reload clip", startSeconds: 1.25, durationSeconds: 2.5 })
    expect(reloadedEditorClip?.payloadJson).toEqual({ caption: "SQLite reload caption", text: "Durable editor payload" })
    expect(reloaded.exportManifests[0]).toMatchObject({ label: "SQLite reload export manifest", selectedCandidateId })
    expect(reloaded.providerJobs.find((job) => job.id === "job_sqlite_reload_workflow_import")?.request).toEqual({ summary: "sqlite reload import", apiKey: "[redacted]" })
    expect(reloadedRun).toMatchObject({ status: "succeeded", currentPhase: "completed" })
    expect(reloadedRun?.artifactPaths).toContain("artifacts/workflows/sqlite-reload/result.json")
    expect(reloadedEvents.map((event) => event.type)).toEqual(["created", "import", "result", "completed"])
    expect(reloadedStore.sqliteStore?.readObjects("workflow-runs")).toHaveLength(reloaded.workflowRuns.length)
    expect(reloadedStore.sqliteStore?.readObjects("workflow-events")).toHaveLength(reloaded.workflowEvents.length)
    expect(graphBranch?.status).toBe("promising")
    expect(graphProviderJob?.artifactPaths).toContain("artifacts/workflows/sqlite-reload/result.json")
    expect(graphExport?.title).toBe("SQLite reload export manifest")
  })

  test("reloads browser-visible demo workflow state from SQLite routes", async () => {
    const store = createStore()
    writeDemoReferenceFixtures(store.config.cwd)
    const importResponse = await routeUgc(jsonRequest("/api/ugc/reference-catalog/import", {
      roots: ["data/tiktok-catalogue/pleometric", "data/tiktok-catalogue/mynameissico"],
      manifestPaths: ["data/ugc-studio/reference-assets/higgsfield/manifest.json"],
    }), store)
    const imported = await importResponse?.json() as { readonly valid?: boolean; readonly imported?: boolean }
    if (!imported.valid || !imported.imported) throw new Error("missing demo workflow fixture imports")

    const response = await routeUgc(jsonRequest("/api/ugc/workflows/demo", { lane: "brainrot" }), store)
    const launched = await response?.json() as { readonly workflowRuns?: readonly { readonly id: string; readonly status: string; readonly currentPhase: string | null }[] }
    const run = launched.workflowRuns?.[0]
    if (!run) throw new Error("missing SQLite-backed demo workflow run")
    rmSync(store.config.statePath, { force: true })

    const reloadedStore = createStore(store.config.cwd)
    const workspaceResponse = await routeUgc(new Request("http://127.0.0.1/api/ugc/workspace"), reloadedStore)
    const state = await workspaceResponse?.json() as UgcLocalState
    const workflowsResponse = await routeUgc(new Request("http://127.0.0.1/api/ugc/workflows"), reloadedStore)
    const workflows = await workflowsResponse?.json() as { readonly workflowRuns?: readonly { readonly id: string; readonly status: string; readonly currentPhase: string | null }[] }
    const eventsResponse = await routeUgc(new Request(`http://127.0.0.1/api/ugc/workflows/${encodeURIComponent(run.id)}/events`), reloadedStore)
    const events = await eventsResponse?.json() as { readonly events?: readonly { readonly type: string }[] }

    expect(response?.status).toBe(201)
    expect(state.providerJobs.some((job) => job.operation === "demo-brainrot-local-plan")).toBe(true)
    expect(state.referenceArchives.find((archive) => archive.id === "archive_reference_tiktok_pleometric")?.sourcePolicy).toBe("abstract-mechanics")
    expect(workflows.workflowRuns?.find((item) => item.id === run.id)).toMatchObject({ status: "succeeded", currentPhase: "completed" })
    expect(events.events?.map((event) => event.type)).toEqual(["created", "queued", "phase", "message", "import", "result", "completed"])
    expect(reloadedStore.sqliteStore?.readObjects("workflow-runs")).toHaveLength(state.workflowRuns.length)
    expect(reloadedStore.sqliteStore?.readObjects("workflow-events")).toHaveLength(state.workflowEvents.length)
  })

  test("normalizes legacy SQLite states without workflow arrays", () => {
    const store = createStore()
    const state = store.read()
    const legacyState: { -readonly [K in keyof UgcLocalState]?: UgcLocalState[K] } = { ...state }
    delete legacyState.workflowRuns
    delete legacyState.workflowEvents

    rewriteSqliteStatePayload(store.config.sqlitePath, legacyState)

    const reloaded = createStore(store.config.cwd).read()
    expect(reloaded.workflowRuns).toEqual([])
    expect(reloaded.workflowEvents).toEqual([])
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

function jsonRequest(path: string, body: object): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function writeDemoReferenceFixtures(cwd: string): void {
  writeCatalogFixture(cwd, "data/tiktok-catalogue/pleometric", "pleometric")
  writeCatalogFixture(cwd, "data/tiktok-catalogue/mynameissico", "mynameissico")
  writeProviderManifestFixture(cwd, "data/ugc-studio/reference-assets/higgsfield/manifest.json")
}

function writeCatalogFixture(cwd: string, root: string, handle: string): void {
  const absoluteRoot = resolve(cwd, root)
  mkdirSync(absoluteRoot, { recursive: true })
  writeCatalogVideo(absoluteRoot, "2026-03-05_7613899553590234375", "7613899553590234375", handle)
}

function writeCatalogVideo(root: string, stem: string, id: string, handle: string): void {
  writeFileSync(resolve(root, `${stem}.info.json`), `${JSON.stringify({
    id,
    title: `Fixture TikTok ${id}`,
    uploader: "Fixture Creator",
    uploader_id: handle,
    duration: 12.5,
    view_count: 1200,
    like_count: 45,
    comment_count: 6,
    share_count: 3,
    save_count: 2,
    webpage_url: `https://www.tiktok.com/@fixture/video/${id}`,
    http_headers: { Cookie: "session=secret" },
    formats: [{ url: `https://cdn.example/${id}.mp4`, cookies: "secret" }],
  })}\n`)
  writeFileSync(resolve(root, `${stem}.jpg`), "poster")
  writeFileSync(resolve(root, `${stem}.mp4`), "video")
}

function writeProviderManifestFixture(cwd: string, manifestPath: string): void {
  const absoluteManifestPath = resolve(cwd, manifestPath)
  mkdirSync(resolve(absoluteManifestPath, ".."), { recursive: true })
  writeFileSync(absoluteManifestPath, `${JSON.stringify({
    provider: "higgsfield",
    captureTimestamp: "2026-06-19T00:00:00.000Z",
    manifestPath,
    sourcePages: ["https://higgsfield.ai/marketing-studio-intro"],
    rightsSummary: "Public Higgsfield fixture asset for reference/inspiration only; no rights grant.",
    useGuidance: "Metadata only; not a direct generation input.",
    assets: [{
      id: "marketing-slide-hyper-video",
      title: "Hyper Motion",
      assetUrl: "https://static.higgsfield.ai/marketing/slides/hyper-mini.mp4",
      local: "marketing-slides/hyper.mp4",
      mediaType: "video/mp4",
      sourcePageUrl: "https://higgsfield.ai/marketing-studio-intro",
      bytes: 123,
      sha256: "fixture-higgsfield-sha",
      rights: "Public fixture; reference-only.",
      provenance: "Captured from the Higgsfield public marketing page for local reference audit.",
    }],
  })}\n`)
}

function rewriteSqliteStatePayload(sqlitePath: string, payload: object): void {
  const Database = import.meta.require("bun:sqlite").Database as typeof import("bun:sqlite").Database
  const db = new Database(sqlitePath)
  try {
    db.query("UPDATE workspace_state SET payload_json = ?").run(JSON.stringify(payload))
  } finally {
    db.close()
  }
}
