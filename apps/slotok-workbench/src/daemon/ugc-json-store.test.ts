import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "./ugc-json-store"
import { UgcSqliteStore } from "./ugc-sqlite-store"
import type { UgcLocalState } from "../ugc/local-state"

describe("UgcJsonStore", () => {
  test("bootstraps a repo-local workspace and writes JSON object shards", () => {
    const store = createStore()
    const state = store.read()

    expect(state.schemaVersion).toBe("ugc-studio.local-state.v1")
    expect(state.workspace.personas.length).toBeGreaterThan(0)
    expect(state.referenceArchives.length).toBe(state.workspace.referenceProfiles.length)
    expect(state.researchTargets.length).toBeGreaterThan(0)
    expect(state.templateMiningJobs.length).toBeGreaterThan(0)
    expect(existsSync(resolve(store.config.workspaceDir, "workspace.json"))).toBe(true)
    expect(existsSync(resolve(store.config.workspaceDir, "personas", `${state.workspace.personas[0]?.id}.json`))).toBe(true)
    expect(existsSync(resolve(store.config.workspaceDir, "research-targets", `${state.researchTargets[0]?.id}.json`))).toBe(true)
    expect(existsSync(resolve(store.config.workspaceDir, "assets", "generated"))).toBe(true)
  })

  test("defaults legacy local state without workflow telemetry arrays", () => {
    const store = createStore()
    const state = store.read()
    const payload = JSON.parse(JSON.stringify(state)) as {
      workflowRuns?: readonly object[]
      workflowEvents?: readonly object[]
    }
    delete payload.workflowRuns
    delete payload.workflowEvents
    writeFileSync(store.config.statePath, JSON.stringify(payload, null, 2))

    const reloaded = new UgcJsonStore({
      cwd: store.config.cwd,
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
      sqliteSync: false,
    }).read()

    expect(reloaded.workflowRuns).toEqual([])
    expect(reloaded.workflowEvents).toEqual([])
    expect(reloaded.workflowRuns.length).toBe(0)
  })

  test("plans and imports local TikTok reference catalog metadata without CDN fields", () => {
    const store = createStore()
    const root = writeCatalogFixture(store.config.cwd, "data/tiktok-catalogue/pleometric")
    const initialReferenceProfileCount = store.read().workspace.referenceProfiles.length

    const plan = store.planReferenceCatalogImport({ roots: [root] })

    expect(plan.valid).toBe(true)
    expect(plan.dryRun).toBe(true)
    expect(plan.imported).toBe(false)
    expect(plan.videosPlanned).toBe(2)
    expect(store.read().workspace.referenceProfiles.length).toBe(initialReferenceProfileCount)

    const imported = store.importReferenceCatalog({ roots: [root] })
    const state = imported.state
    const referenceProfile = state?.workspace.referenceProfiles.find((profile) => profile.id === "reference_tiktok_pleometric")
    const archive = state?.referenceArchives.find((item) => item.id === "archive_reference_tiktok_pleometric")
    const providerJob = state?.providerJobs.find((job) => job.id === "job_local_reference_catalog_import_pleometric")

    expect(imported.valid).toBe(true)
    expect(imported.imported).toBe(true)
    expect(referenceProfile?.styleLane).toBe("brainrot")
    expect(referenceProfile?.sampleClips[0]?.sourceUrl).toBeNull()
    expect(archive?.sourcePolicy).toBe("metadata-only")
    expect(archive?.catalogVideos[0]?.paths.infoJson).toBe(`${root}/2026-03-05_7613899553590234375.info.json`)
    expect(archive?.catalogVideos[0]?.paths.mp4).toBe(`${root}/2026-03-05_7613899553590234375.mp4`)
    expect(archive?.catalogVideos[0]?.paths.poster).toBe(`${root}/2026-03-05_7613899553590234375.jpg`)
    expect(archive?.catalogVideos[0]?.engagement.views).toBe(1200)
    expect(providerJob?.mode).toBe("dry-run")
    expect(providerJob?.status).toBe("completed")
    expect(JSON.stringify(providerJob?.request)).not.toContain("https://cdn.example")
    expect(JSON.stringify(providerJob?.request)).not.toContain("Cookie")
  })

  test("plans and imports provider reference asset manifests as metadata-only guardrail records", () => {
    const store = createStore()
    const higgsfieldManifest = writeProviderManifestFixture(store.config.cwd, "data/ugc-studio/reference-assets/higgsfield/manifest.json", "higgsfield")
    const arcadsManifest = writeProviderManifestFixture(store.config.cwd, "data/ugc-studio/reference-assets/arcads/manifest.json", "arcads")
    const initialReferenceProfileCount = store.read().workspace.referenceProfiles.length

    const plan = store.planReferenceCatalogImport({ roots: [], manifestPaths: [higgsfieldManifest, arcadsManifest] })

    expect(plan.valid).toBe(true)
    expect(plan.dryRun).toBe(true)
    expect(plan.imported).toBe(false)
    expect(plan.roots).toEqual([])
    expect(plan.manifestPaths).toEqual([higgsfieldManifest, arcadsManifest])
    expect(plan.videosPlanned).toBe(0)
    expect(plan.assetsPlanned).toBe(2)
    expect(store.read().workspace.referenceProfiles.length).toBe(initialReferenceProfileCount)

    const imported = store.importReferenceCatalog({ roots: [], manifestPaths: [higgsfieldManifest, arcadsManifest] })
    const state = imported.state
    const higgsfieldArchive = state?.referenceArchives.find((item) => item.id === "archive_reference_provider_higgsfield_assets")
    const arcadsArchive = state?.referenceArchives.find((item) => item.id === "archive_reference_provider_arcads_assets")
    const providerJob = state?.providerJobs.find((job) => job.id === "job_local_reference_asset_manifest_import_higgsfield")
    const bundle = store.exportWorkspaceBundle({ label: "Provider reference manifest bundle" })

    expect(imported.valid).toBe(true)
    expect(imported.imported).toBe(true)
    expect(higgsfieldArchive?.sourcePolicy).toBe("metadata-only")
    expect(higgsfieldArchive?.catalogVideos).toEqual([])
    expect(higgsfieldArchive?.referenceAssets[0]?.localPath).toBe("data/ugc-studio/reference-assets/higgsfield/marketing-slides/hyper.mp4")
    expect(higgsfieldArchive?.referenceAssets[0]?.sourceUrl).toBe("https://higgsfield.ai/marketing-studio-intro")
    expect(higgsfieldArchive?.referenceAssets[0]?.assetUrl).toBe("https://static.higgsfield.ai/marketing/slides/hyper-mini.mp4")
    expect(higgsfieldArchive?.referenceAssets[0]?.referenceOnly).toBe(true)
    expect(higgsfieldArchive?.referenceAssets[0]?.directGenerationInput).toBe(false)
    expect(arcadsArchive?.referenceAssets[0]?.localPath).toBe("data/ugc-studio/reference-assets/arcads/arcads-og-image.png")
    expect(arcadsArchive?.referenceAssets[0]?.sourceUrl).toBe("https://www.arcads.ai/")
    expect(providerJob?.artifactPaths).toEqual([higgsfieldManifest])
    expect(JSON.stringify(providerJob?.request)).toContain("https://static.higgsfield.ai/marketing/slides/hyper-mini.mp4")
    expect(bundle.shardManifest.localAssets.referenceCatalog).toEqual([])
  })


  test("default reference catalog roots warn on missing roots and import readable records", () => {
    const store = createStore()
    const root = writeCatalogFixture(store.config.cwd, "data/tiktok-catalogue/mynameissico")
    const initialReferenceProfileCount = store.read().workspace.referenceProfiles.length
    const missingRootWarning = "Reference catalog root not found: data/tiktok-catalogue/pleometric"

    const plan = store.planReferenceCatalogImport()

    expect(plan.valid).toBe(true)
    expect(plan.dryRun).toBe(true)
    expect(plan.imported).toBe(false)
    expect(plan.roots).toEqual(["data/tiktok-catalogue/pleometric", "data/tiktok-catalogue/mynameissico"])
    expect(plan.videosPlanned).toBe(2)
    expect(plan.errors).toEqual([])
    expect(plan.warnings).toContain(missingRootWarning)
    expect(store.read().workspace.referenceProfiles.length).toBe(initialReferenceProfileCount)

    const imported = store.importReferenceCatalog()
    const state = imported.state
    const archive = state?.referenceArchives.find((item) => item.id === "archive_reference_tiktok_mynameissico")

    expect(imported.valid).toBe(true)
    expect(imported.imported).toBe(true)
    expect(imported.videosPlanned).toBe(2)
    expect(imported.errors).toEqual([])
    expect(imported.warnings).toContain(missingRootWarning)
    expect(archive?.catalogVideos[0]?.paths.infoJson).toBe(`${root}/2026-03-05_7613899553590234375.info.json`)
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
    const researchTargetState = store.createResearchTarget({
      niche: "faceless skincare UGC",
      query: "faceless skincare routine captions proof CTA template",
      platform: "tiktok",
      sourcePolicy: "metadata-only",
      notes: ["queue only"],
    })
    const researchTargetId = researchTargetState.researchTargets[0]?.id ?? ""
    store.updateResearchTarget(researchTargetId, { status: "sampling", priority: 2 })
    const templateJobState = store.createTemplateMiningJob({
      researchTargetId,
      templateSpec: {
        schemaVersion: "ugc-studio.clean-room-template.v1",
        id: "template_faceless_skin_proof",
        title: "Faceless skincare proof",
        category: "caption",
        preservedMechanics: { captionBlocks: 3, cue: "before-after-proof" },
        swapSlots: ["product", "hook", "CTA"],
        blockedFields: ["source audio", "exact captions"],
        proofNotes: ["clean-room test"],
      },
    })
    const templateJobId = templateJobState.templateMiningJobs[0]?.id ?? ""
    store.updateTemplateMiningJob(templateJobId, { status: "ready", candidateIds: [candidateId] })
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
    expect(updated.researchTargets[0]?.status).toBe("sampling")
    expect(updated.researchTargets[0]?.templateJobIds).toContain(templateJobId)
    expect(updated.templateMiningJobs[0]?.status).toBe("ready")
    expect(updated.templateMiningJobs[0]?.templateSpec.title).toBe("Faceless skincare proof")
    expect(updated.exportManifests[0]?.label).toBe("Proof export")

    const reloaded = new UgcJsonStore({
      cwd: store.config.cwd,
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
      sqliteSync: false,
    }).read()
    const archiveShard = JSON.parse(readFileSync(resolve(store.config.workspaceDir, "reference-archives", `${updated.referenceArchives[0]?.id}.json`), "utf8")) as {
      readonly candidateFormatOutputs?: readonly { readonly id: string }[]
    }
    expect(reloaded.referenceArchives[0]?.candidateFormatOutputs[0]?.id).toBe("format_test_pose")
    expect(reloaded.templateMiningJobs[0]?.templateSpec.title).toBe("Faceless skincare proof")
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

  test("exports workspace bundles and validates dry-run imports", () => {
    const store = createStore()
    const initial = store.read()
    const bundle = store.exportWorkspaceBundle({ label: "QA portable bundle" })
    const bundlePath = resolve(store.config.workspaceDir, "bundles", `${bundle.id}.json`)

    expect(bundle.schemaVersion).toBe("ugc-studio.workspace-bundle.v1")
    expect(bundle.label).toBe("QA portable bundle")
    expect(bundle.workspaceId).toBe(initial.workspace.id)
    expect(bundle.objectCounts.personas).toBe(initial.workspace.personas.length)
    expect(bundle.objectCounts.referenceProfiles).toBe(initial.workspace.referenceProfiles.length)
    expect(bundle.shardManifest.workspace).toBe("workspace.json")
    expect(bundle.shardManifest.collections.referenceProfiles.length).toBe(initial.workspace.referenceProfiles.length)
    expect(bundle.shardManifest.collections.referenceArchives.length).toBe(initial.referenceArchives.length)
    expect(bundle.shardManifest.collections.researchTargets.length).toBe(initial.researchTargets.length)
    expect(bundle.shardManifest.collections.templateMiningJobs.length).toBe(initial.templateMiningJobs.length)
    expect(bundle.shardManifest.collections.bundles).toContain(`bundles/${bundle.id}.json`)
    expect(bundle.shardManifest.assets.generated).toBe("assets/generated")
    expect(bundle.shardManifest.localAssets.referenceCatalog).toEqual([])
    expect(existsSync(bundlePath)).toBe(true)

    const persisted = JSON.parse(readFileSync(bundlePath, "utf8")) as { readonly schemaVersion?: string; readonly state?: { readonly schemaVersion?: string } }
    expect(persisted.schemaVersion).toBe("ugc-studio.workspace-bundle.v1")
    expect(persisted.state?.schemaVersion).toBe("ugc-studio.local-state.v1")

    const dryRun = store.importWorkspaceBundle({ bundle, dryRun: true })
    expect(dryRun.valid).toBe(true)
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.imported).toBe(false)
    expect(dryRun.objectCounts?.candidates).toBe(initial.workspace.candidates.length)

    const invalidDryRun = store.importWorkspaceBundle({
      bundle: {
        ...bundle,
        objectCounts: { ...bundle.objectCounts, personas: bundle.objectCounts.personas + 1 },
      },
      dryRun: true,
    })
    expect(invalidDryRun.valid).toBe(false)
    expect(invalidDryRun.imported).toBe(false)
    expect(store.read().workspace.title).toBe(initial.workspace.title)

    const applied = store.importWorkspaceBundle({
      bundle: {
        ...bundle,
        state: {
          ...bundle.state,
          workspace: { ...bundle.state.workspace, title: "Imported Workspace" },
        },
      },
      dryRun: false,
    })
    expect(applied.valid).toBe(true)
    expect(applied.imported).toBe(true)
    expect(store.read().workspace.title).toBe("Imported Workspace")
  })

  test("rejects workspace bundle imports for another configured workspace without mutating artifacts", () => {
    const store = new UgcJsonStore({
      cwd: mkdtempSync(resolve(tmpdir(), "ugc-json-store-")),
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
      sqliteSync: false,
    })
    const initial = store.read()
    const bundle = store.exportWorkspaceBundle({ label: "Mismatched workspace bundle" })
    const mismatchedBundle = {
      ...bundle,
      workspaceId: "workspace_other_ads",
      state: {
        ...bundle.state,
        workspace: {
          ...bundle.state.workspace,
          id: "workspace_other_ads",
          title: "Imported Other Workspace",
        },
      },
    }
    const stateJsonBefore = readFileSync(store.config.statePath, "utf8")
    const workspaceShardPath = resolve(store.config.workspaceDir, "workspace.json")
    const workspaceShardBefore = readFileSync(workspaceShardPath, "utf8")
    const dryRun = store.importWorkspaceBundle({ bundle: mismatchedBundle, dryRun: true })

    expect(dryRun.valid).toBe(false)
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.imported).toBe(false)
    expect(dryRun.errors).toContain("Bundle workspace workspace_other_ads does not match current workspace workspace_protein_bar_ads.")
    expect(readFileSync(store.config.statePath, "utf8")).toBe(stateJsonBefore)
    expect(readFileSync(workspaceShardPath, "utf8")).toBe(workspaceShardBefore)
    expect(store.read()).toEqual(initial)

    const applied = store.importWorkspaceBundle({ bundle: mismatchedBundle, dryRun: false })

    expect(applied.valid).toBe(false)
    expect(applied.imported).toBe(false)
    expect(applied.importedState).toBeNull()
    expect(applied.errors).toContain("Bundle workspace workspace_other_ads does not match current workspace workspace_protein_bar_ads.")
    expect(readFileSync(store.config.statePath, "utf8")).toBe(stateJsonBefore)
    expect(readFileSync(workspaceShardPath, "utf8")).toBe(workspaceShardBefore)
    expect(store.read()).toEqual(initial)
  })

  test("reloads imported reference catalog state from JSON artifacts", () => {
    const store = createStore()
    const root = writeCatalogFixture(store.config.cwd, "data/tiktok-catalogue/mynameissico")
    store.importReferenceCatalog({ roots: [root] })
    const importedProviderJobRequest = store.read().providerJobs.find((item) => item.id === "job_local_reference_catalog_import_mynameissico")?.request

    const reloaded = new UgcJsonStore({
      cwd: store.config.cwd,
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
      sqliteSync: false,
    }).read()
    const archive = reloaded.referenceArchives.find((item) => item.id === "archive_reference_tiktok_mynameissico")
    const job = reloaded.providerJobs.find((item) => item.id === "job_local_reference_catalog_import_mynameissico")

    expect(archive?.catalogVideos.length).toBe(2)
    expect(archive?.catalogVideos[0]?.paths.infoJson).toBe(`${root}/2026-03-05_7613899553590234375.info.json`)
    expect(job?.request).toEqual(importedProviderJobRequest)
  })

  test("patches provider job status, response, artifacts, and errors", () => {
    const store = createStore()
    const candidateId = store.read().workspace.candidates[0]?.id ?? ""
    const created = store.createProviderJob({
      provider: "kie",
      operation: "video-text",
      status: "queued",
      request: { prompt: "dry-run queue proof" },
      targetIds: [candidateId],
      spendCapUsd: 0.05,
    })
    const jobId = created.providerJobs[0]?.id ?? ""

    const updated = store.updateProviderJob(jobId, {
      status: "succeeded",
      response: { taskId: "kie_task_123", resultUrls: ["file:///tmp/out.mp4"] },
      artifactPaths: ["artifacts/provider/kie_task_123/out.mp4"],
      error: null,
    })
    const job = updated.providerJobs.find((item) => item.id === jobId)

    expect(job?.status).toBe("succeeded")
    expect(job?.artifactPaths).toContain("artifacts/provider/kie_task_123/out.mp4")
    expect(job?.response).toEqual({ taskId: "kie_task_123", resultUrls: ["file:///tmp/out.mp4"] })
    expect(job?.updatedAt).toBe("2026-06-10T00:00:00.000Z")
  })

  test("creates workflow runs with append-only events, bundle counts, and JSON shards", () => {
    const store = createStore()
    const run = store.createWorkflowRun({
      title: "Pi agent workflow",
      source: "pi",
      lane: "analysis",
      scriptId: "pi-workflow",
      args: { prompt: "inspect", apiKey: "sk-secret" },
    })
    const started = store.appendWorkflowEvent(run.id, {
      type: "phase",
      phase: "scouting",
      agentLabel: "Pi Scout",
      message: "Scouting references",
      payload: { authorization: "Bearer secret", visible: true },
    })
    const completed = store.appendWorkflowEvent(run.id, {
      type: "completed",
      message: "Imported records",
      payload: { result: "ok" },
      artifactPaths: ["artifacts/workflows/pi-workflow/result.json"],
    })
    const state = store.read()
    const summarized = state.workflowRuns.find((item) => item.id === run.id)
    const events = store.listWorkflowEvents(run.id, started.eventId)
    const bundle = store.exportWorkspaceBundle({ label: "Workflow telemetry bundle" })

    expect(run.args).toEqual({ prompt: "inspect", apiKey: "[redacted]" })
    expect(started.eventId).toBe(2)
    expect(completed.eventId).toBe(started.eventId + 1)
    expect(state.workflowEvents.map((event) => event.eventId)).toEqual([1, 2, 3])
    expect(summarized?.status).toBe("succeeded")
    expect(summarized?.currentPhase).toBe("scouting")
    expect(summarized?.artifactPaths).toContain("artifacts/workflows/pi-workflow/result.json")
    expect(state.workflowEvents.find((event) => event.eventId === started.eventId)?.payload).toEqual({ authorization: "[redacted]", visible: true })
    expect(events.map((event) => event.eventId)).toEqual([completed.eventId])
    expect(existsSync(resolve(store.config.workspaceDir, "workflow-runs", `${run.id}.json`))).toBe(true)
    expect(existsSync(resolve(store.config.workspaceDir, "workflow-events", `${completed.eventId}.json`))).toBe(true)
    expect(bundle.objectCounts.workflowRuns).toBe(1)
    expect(bundle.objectCounts.workflowEvents).toBe(3)
    expect(bundle.shardManifest.collections.workflowRuns).toEqual([`workflow-runs/${run.id}.json`])
    expect(bundle.shardManifest.collections.workflowEvents).toEqual(["workflow-events/1.json", "workflow-events/2.json", "workflow-events/3.json"])
  })

  test("reloads workflow telemetry from a SQLite workspace state source when JSON artifacts are absent", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "ugc-json-store-"))
    const sqliteStore = new CapturingSqliteStore({ workspaceDir: resolve(cwd, "ugc-workspaces", "workspace_protein_bar_ads") })
    const store = new UgcJsonStore({
      cwd,
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
      sqliteSync: sqliteStore,
    })
    const run = store.createWorkflowRun({ title: "SQLite workflow", source: "omp", args: { token: "secret" } })
    store.appendWorkflowEvent(run.id, { type: "completed", message: "Done", payload: { ok: true } })
    rmSync(store.config.statePath, { force: true })
    rmSync(resolve(store.config.workspaceDir, "workflow-runs"), { recursive: true, force: true })
    rmSync(resolve(store.config.workspaceDir, "workflow-events"), { recursive: true, force: true })

    const reloaded = new UgcJsonStore({
      cwd,
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
      sqliteSync: sqliteStore,
    }).read()

    expect(reloaded.workflowRuns.find((item) => item.id === run.id)?.status).toBe("succeeded")
    expect(reloaded.workflowRuns.find((item) => item.id === run.id)?.args).toEqual({ token: "[redacted]" })
    expect(reloaded.workflowEvents.filter((event) => event.runId === run.id).length).toBe(2)
    expect(existsSync(resolve(store.config.workspaceDir, "workflow-runs", `${run.id}.json`))).toBe(true)
  })

  test("updates selected candidate sets in one local transaction", () => {
    const store = createStore()
    const initial = store.read()
    const candidateIds = initial.workspace.candidates.slice(0, 2).map((candidate) => candidate.id)

    const updated = store.updateCandidates({ candidateIds, status: "needs-revision" })

    expect(updated.workspace.candidates.filter((candidate) => candidateIds.includes(candidate.id)).every((candidate) => candidate.status === "needs-revision")).toBe(true)
  })

  test("creates branch forks linked to parent snapshots", () => {
    const store = createStore()
    const initial = store.read()
    const parent = initial.workspace.branchSnapshots[0]
    if (!parent) throw new Error("missing parent branch")

    const updated = store.createBranch({
      parentId: parent.id,
      title: "Softer CTA fork",
      focus: "Lower pressure CTA variants",
      selectedPersonaIds: parent.selectedPersonaIds,
      selectedCandidateIds: parent.selectedCandidateIds,
      candidateBatchIds: parent.candidateBatchIds,
      decisionNote: "Fork proof.",
    })
    const branch = updated.workspace.branchSnapshots[0]
    const parentAfter = updated.workspace.branchSnapshots.find((item) => item.id === parent.id)

    expect(branch?.title).toBe("Softer CTA fork")
    expect(branch?.parentId).toBe(parent.id)
    expect(branch?.status).toBe("active")
    expect(parentAfter?.childIds).toContain(branch?.id)
  })

  test("persists final editor track and clip edits into export timeline JSON", () => {
    const store = createStore()
    const initial = store.read()
    const candidateId = initial.workspace.candidates[1]?.id ?? initial.workspace.candidates[0]?.id ?? ""
    const track = initial.workspace.finalEditor.tracks[0]
    const clip = track?.clips[0]
    if (!track || !clip) throw new Error("missing editor track or clip")

    const updated = store.updateFinalEditor({
      selectedCandidateId: candidateId,
      trackUpdates: [{ id: track.id, visible: false, locked: true }],
      clipUpdates: [
        {
          trackId: track.id,
          clipId: clip.id,
          label: "Hook caption revised",
          startSeconds: 1.25,
          durationSeconds: 4.5,
          payloadJson: { text: "This is the softer opening hook.", captionStyle: "low-pressure" },
        },
      ],
    })
    const updatedTrack = updated.workspace.finalEditor.tracks.find((item) => item.id === track.id)
    const updatedClip = updatedTrack?.clips.find((item) => item.id === clip.id)

    expect(updated.workspace.finalEditor.selectedCandidateId).toBe(candidateId)
    expect(updatedTrack?.visible).toBe(false)
    expect(updatedTrack?.locked).toBe(true)
    expect(updatedClip?.label).toBe("Hook caption revised")
    expect(updatedClip?.startSeconds).toBe(1.25)
    expect(updatedClip?.durationSeconds).toBe(4.5)
    expect(updatedClip?.payloadJson).toEqual({ text: "This is the softer opening hook.", captionStyle: "low-pressure" })

    const exported = store.createExportManifest({ label: "Editor persistence proof" })
    const timeline = exported.exportManifests[0]?.timelineJson

    expect(JSON.stringify(timeline)).toContain("Hook caption revised")
    expect(JSON.stringify(timeline)).toContain("softer opening hook")
  })
})

class CapturingSqliteStore extends UgcSqliteStore {
  state: UgcLocalState | null = null

  override writeState(state: UgcLocalState): void {
    this.state = JSON.parse(JSON.stringify(state)) as UgcLocalState
  }

  override readValidState(): UgcLocalState | null {
    return this.state
  }
}

function createStore(): UgcJsonStore {
  const cwd = mkdtempSync(resolve(tmpdir(), "ugc-json-store-"))
  return new UgcJsonStore({
    cwd,
    root: "ugc-workspaces",
    now: () => "2026-06-10T00:00:00.000Z",
    sqliteSync: false,
  })
}

function writeCatalogFixture(cwd: string, root: string): string {
  const absoluteRoot = resolve(cwd, root)
  mkdirSync(absoluteRoot, { recursive: true })
  writeCatalogVideo(absoluteRoot, "2026-03-05_7613899553590234375", "7613899553590234375", 1200, 45)
  writeCatalogVideo(absoluteRoot, "2026-03-08_7614988205481331976", "7614988205481331976", 2400, 67)
  return root
}

function writeCatalogVideo(root: string, stem: string, id: string, views: number, likes: number): void {
  writeFileSync(resolve(root, `${stem}.info.json`), `${JSON.stringify({
    id,
    title: `Fixture TikTok ${id}`,
    uploader: "Fixture Creator",
    uploader_id: basenameForRoot(root),
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
  writeFileSync(resolve(root, `${stem}.jpg`), "poster")
  writeFileSync(resolve(root, `${stem}.mp4`), "video")
}

function writeProviderManifestFixture(cwd: string, manifestPath: string, provider: "higgsfield" | "arcads"): string {
  const absoluteManifestPath = resolve(cwd, manifestPath)
  mkdirSync(resolve(absoluteManifestPath, ".."), { recursive: true })
  if (provider === "higgsfield") {
    writeFileSync(absoluteManifestPath, `${JSON.stringify({
      provider,
      captureTimestamp: "2026-06-19T00:00:00.000Z",
      manifestPath,
      sourcePages: ["https://higgsfield.ai/marketing-studio-intro"],
      rightsSummary: "Public Higgsfield fixture asset for reference/inspiration only; no rights grant.",
      useGuidance: "Metadata only; not a direct generation input.",
      assets: [
        {
          id: "marketing-slide-hyper-video",
          title: "Hyper Motion",
          assetUrl: "https://static.higgsfield.ai/marketing/slides/hyper-mini.mp4",
          local: "marketing-slides/hyper.mp4",
          localPath: "data/ugc-studio/reference-assets/higgsfield/marketing-slides/hyper.mp4",
          mediaType: "video/mp4",
          sourcePageUrl: "https://higgsfield.ai/marketing-studio-intro",
          bytes: 123,
          sha256: "fixture-higgsfield-sha",
          rights: "Public fixture; reference-only.",
        },
      ],
      blockedAssets: [{ id: "blocked-higgsfield-demo" }],
    })}\n`)
    return manifestPath
  }
  writeFileSync(absoluteManifestPath, `${JSON.stringify({
    provider,
    capture_timestamp: "2026-06-19T00:00:00.000Z",
    source_pages: ["https://www.arcads.ai/"],
    robots_and_rights_notes: {
      terms: "Arcads fixture terms note; reference/inspiration only.",
      usage_boundary: "Do not use as a direct generation input.",
    },
    assets: [
      {
        id: "arcads-og-image",
        source_url: "https://www.arcads.ai/",
        asset_url: "https://cdn.example.invalid/arcads-og-image.png",
        local_path: "data/ugc-studio/reference-assets/arcads/arcads-og-image.png",
        media_type: "image/png",
        title_label: "Arcads OpenGraph marketing image",
        byte_length: 456,
        rights_notes: "Public fixture; reference-only.",
      },
    ],
    blocked_assets: [{ id: "blocked-arcads-avatar" }],
    failed_downloads: [{ id: "forbidden-demo" }],
    evidence_files: [{ id: "page-evidence" }],
  })}\n`)
  return manifestPath
}

function basenameForRoot(root: string): string {
  return root.endsWith("mynameissico") ? "mynameissico" : "pleometric"
}
