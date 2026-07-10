import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { Effect } from "effect"

import { queryFrontier, type FrontierAxis } from "../src/frontier"
import { migrateLedger, setDurabilityPragmas } from "../src/migrate"

const tmpDir = join(import.meta.dir, ".tmp")
const runId = Date.now()
const axes: readonly FrontierAxis[] = [
  { metricDefinitionId: "quality-v1", metricKey: "quality.score", unit: "score", direction: "maximize", reducer: "latest", boundsMode: "point" },
  { metricKey: "cost.usd", unit: "USD", direction: "minimize", reducer: "latest", boundsMode: "point" },
]

test("frontier preserves account, effort, advisor, and provenance while explaining dominance", async () => {
  const dbPath = makeFixture("dominance")
  const result = await Effect.runPromise(queryFrontier(dbPath, { workClass: "coding", axes, includeIncomplete: true }))

  expect(result.candidates.map((candidate) => candidate.status)).toEqual(["frontier", "frontier", "dominated", "incomplete"])
  const complete = result.candidates.filter((candidate) => candidate.status !== "incomplete")
  expect(complete.map((candidate) => candidate.identity.participants.map((participant) => [participant.role, participant.account, participant.effort, participant.model]))).toEqual([
    [["primary", "pro", "high", "model-a"], ["advisor", "pro", "low", "advisor-a"]],
    [["primary", "pro", "low", "model-a"]],
    [["primary", "free", "high", "model-a"]],
  ])
  const dominated = result.candidates.find((candidate) => candidate.status === "dominated")
  expect(dominated?.dominatedBy).toHaveLength(2)
  expect(dominated?.axes[0]?.runIds).toEqual(["run-c"])
  expect(dominated?.axes[0]?.sourceIds).toEqual(["source-primary"])
  expect(dominated?.axes[0]?.trustLabels).toEqual(["primary"])
  expect(result.candidates.at(-1)?.missingAxes).toEqual([1])
})

test("conservative graph OCR requires a directionally useful uncertainty bound", async () => {
  const dbPath = makeFixture("ocr")
  const conservativeAxes: readonly FrontierAxis[] = [
    { metricDefinitionId: "quality-v1", metricKey: "quality.score", unit: "score", direction: "maximize", reducer: "latest", boundsMode: "conservative" },
    { metricKey: "cost.usd", unit: "USD", direction: "minimize", reducer: "latest", boundsMode: "point" },
  ]
  const result = await Effect.runPromise(queryFrontier(dbPath, { workClass: "coding", axes: conservativeAxes, includeIncomplete: true }))
  const ocr = result.candidates.find((candidate) => candidate.identity.participants[0]?.model === "model-ocr")
  expect(ocr?.status).toBe("incomplete")
  expect(ocr?.missingAxes).toEqual([0])
})

function makeFixture(label: string): string {
  mkdirSync(tmpDir, { recursive: true })
  const dbPath = join(tmpDir, `frontier-${label}-${runId}.sqlite`)
  const sqlite = new Database(dbPath)
  try {
    setDurabilityPragmas(sqlite)
    migrateLedger(sqlite)
    sqlite.run("INSERT INTO evidence_sources (id, sourceKind, captureKind, trustLabel, publisher, title, retrievedAt, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["source-primary", "independent_eval", "web_text", "primary", "fixture", "Fixture", 1, "test"])
    sqlite.run("INSERT INTO evidence_sources (id, sourceKind, captureKind, trustLabel, publisher, title, retrievedAt, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["source-ocr", "independent_eval", "graph_ocr", "independent", "fixture", "Graph", 1, "test"])
    sqlite.run("INSERT INTO metric_definitions (id, definitionKind, definitionKey, version, metricKey, displayName, workClass, taskModality, unit, scoreDirection, scoringRule, contaminationStatus, methodologySourceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["quality-v1", "local_outcome", "fixture-quality", "1", "quality.score", "Quality", "coding", "task", "score", "maximize", "rubric-v1", "unknown", "source-primary"])
    insertRun(sqlite, "run-a", "source-primary", "model-a", "pro", "high", 9, 3, [{ role: "advisor", model: "advisor-a", account: "pro", effort: "low" }])
    insertRun(sqlite, "run-b", "source-primary", "model-a", "pro", "low", 8, 2, [])
    insertRun(sqlite, "run-c", "source-primary", "model-a", "free", "high", 7, 4, [])
    insertRun(sqlite, "run-d", "source-primary", "model-d", "pro", "high", 10, null, [])
    if (label === "ocr") insertRun(sqlite, "run-ocr", "source-ocr", "model-ocr", "pro", "high", 11, 1, [], null)
  } finally {
    sqlite.close()
  }
  return dbPath
}

function insertRun(
  sqlite: Database,
  id: string,
  sourceId: string,
  model: string,
  account: string,
  effort: string,
  quality: number,
  cost: number | null,
  advisors: readonly { readonly role: "advisor"; readonly model: string; readonly account: string; readonly effort: string }[],
  qualityLowerBound: number | null = 0,
): void {
  sqlite.run("INSERT INTO evaluation_runs (id, sourceId, evidenceKind, observedAt, workClass, taskModality, harnessProfile, toolProfile, contextProfile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, sourceId, "local_evaluation", 1, "coding", "task", "harness-1", "tool-1", "context-1"])
  sqlite.run("INSERT INTO evaluation_run_participants (runId, ordinal, role, provider, model, modelVersion, account, effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, 0, "primary", "provider-a", model, "v1", account, effort])
  advisors.forEach((advisor, index) => sqlite.run("INSERT INTO evaluation_run_participants (runId, ordinal, role, provider, model, modelVersion, account, effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, index + 1, advisor.role, "provider-a", advisor.model, "v1", advisor.account, advisor.effort]))
  sqlite.run("INSERT INTO evaluation_measurements (id, runId, metricDefinitionId, metricKey, value, unit, direction, statistic, axisRole, lowerConfidenceBound, upperConfidenceBound, derived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`${id}-quality`, id, "quality-v1", "quality.score", quality, "score", "maximize", "point", "reported", qualityLowerBound, quality + 1, 0])
  if (cost !== null) sqlite.run("INSERT INTO evaluation_measurements (id, runId, metricDefinitionId, metricKey, value, unit, direction, statistic, axisRole, derived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`${id}-cost`, id, null, "cost.usd", cost, "USD", "minimize", "point", "reported", 0])
}
