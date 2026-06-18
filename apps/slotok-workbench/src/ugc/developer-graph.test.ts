import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "../daemon/ugc-json-store"
import { deriveUgcDeveloperGraph } from "./developer-graph"

describe("deriveUgcDeveloperGraph", () => {
  test("derives nodes and edges from real local workspace state", () => {
    const store = new UgcJsonStore({
      cwd: mkdtempSync(resolve(tmpdir(), "ugc-dev-graph-")),
      root: "ugc-workspaces",
      now: () => "2026-06-10T00:00:00.000Z",
      sqliteSync: false,
    })
    const initial = store.read()
    const candidateId = initial.workspace.candidates[0]?.id ?? ""
    const researchTargetId = initial.researchTargets[0]?.id ?? ""

    store.createProviderJob({
      provider: "kie",
      operation: "video-text",
      status: "succeeded",
      request: { prompt: "developer graph proof" },
      response: { taskId: "task_dev_graph" },
      targetIds: [candidateId],
      artifactPaths: ["artifacts/provider/task_dev_graph/out.mp4"],
      spendCapUsd: 0.05,
    })
    store.createExportManifest({ selectedCandidateId: candidateId, label: "Developer graph export" })
    store.createTemplateMiningJob({ researchTargetId, status: "ready", candidateIds: [candidateId] })

    const graph = deriveUgcDeveloperGraph(store.read())
    const candidateNode = graph.nodes.find((node) => node.entityId === candidateId && node.family === "candidate")
    const providerNode = graph.nodes.find((node) => node.family === "provider-job")
    const exportNode = graph.nodes.find((node) => node.family === "export")
    const templateNode = graph.nodes.find((node) => node.family === "template" && node.outputs.includes(candidateId))

    expect(candidateNode).toBeTruthy()
    expect(providerNode?.artifactPaths).toContain("artifacts/provider/task_dev_graph/out.mp4")
    expect(exportNode?.inputs).toContain(candidateId)
    expect(templateNode?.status).toBe("ready")
    expect(graph.edges.some((edge) => edge.fromId === candidateNode?.id && edge.toId === providerNode?.id && edge.label === "provider target")).toBe(true)
    expect(graph.edges.some((edge) => edge.fromId === candidateNode?.id && edge.toId === exportNode?.id && edge.label === "exported")).toBe(true)
    expect(graph.edges.some((edge) => edge.fromId === templateNode?.id && edge.toId === candidateNode?.id && edge.label === "template output")).toBe(true)
  })
})
