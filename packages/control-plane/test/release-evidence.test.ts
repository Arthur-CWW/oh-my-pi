import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import { decodeEvidenceBundleV1Json, type EvidenceBundleV1 } from "../src/evidence"
import { EvidenceStore, openEvidenceStore } from "../src/evidence-ingest"
import { exportFrontierSvg } from "../src/evidence-export"
import { frontierAxisId, queryFrontier, type FrontierAxis } from "../src/frontier"

const fixturePath = join(import.meta.dir, "..", "fixtures", "gpt56-release-2026-07-10.json")
const temporaryDirectory = join(import.meta.dir, ".tmp")
const deepSweScoreAxis: FrontierAxis = {
  metricDefinitionId: "definition-deepswe-v1-1",
  metricKey: "benchmark.deepswe.pass-at-1",
  unit: "%",
  direction: "maximize",
  reducer: "latest",
  boundsMode: "point",
}
const costPerTaskAxis: FrontierAxis = {
  metricKey: "cost.usd",
  unit: "USD",
  direction: "minimize",
  reducer: "latest",
  boundsMode: "point",
}

test("GPT-5.6 release fixture is decodable, idempotent, and exports a stable DeepSWE frontier", async () => {
  mkdirSync(temporaryDirectory, { recursive: true })
  const fixture = decodeEvidenceBundleV1Json(await Bun.file(fixturePath).text())
  expect(fixture.benchmarkCatalog.every((catalog) => catalog.releasedAt === undefined || catalog.releasedAt === null)).toBe(true)
  const cursorMaxRun = fixture.runs.find((run) => run.id === "run-cursorbench-3-2-gpt-5-6-sol-max")
  expect(cursorMaxRun?.notes).toContain("Source effort label: Max.")
  expect(fixture.participants.find((participant) => participant.runId === cursorMaxRun?.id)?.effort).toBe("max")
  const codexRates = fixture.commercialFacts.filter((fact) => fact.pricingContext === "codex_credit")
  expect(codexRates).toHaveLength(12)
  expect(codexRates.every((fact) => fact.factKind === "price" && fact.subjectKind === "model" && fact.windowKind === "fixed" && fact.limitKind === "metered" && fact.perValue === 1_000_000 && fact.perUnit === "tokens")).toBe(true)
  expect(codexRates.find((fact) => fact.model === "GPT-5.6 Sol" && fact.component === "input")?.value).toBe(125)
  expect(codexRates.find((fact) => fact.model === "GPT-5.6 Terra" && fact.component === "output")?.value).toBe(375)
  expect(codexRates.some((fact) => fact.factKind === "allowance")).toBe(false)
  for (const component of ["input", "cached-input", "output"]) {
    const solRate = codexRates.find((fact) => fact.model === "GPT-5.6 Sol" && fact.component === component)?.value
    const terraRate = codexRates.find((fact) => fact.model === "GPT-5.6 Terra" && fact.component === component)?.value
    const gpt55Rate = codexRates.find((fact) => fact.model === "GPT-5.5" && fact.component === component)?.value
    expect(solRate).toBe(gpt55Rate)
    expect(terraRate).toBe((solRate ?? 0) / 2)
  }
  const pendingCatalogId = "catalog-test-pending-named-benchmark"
  const bundle: EvidenceBundleV1 = {
    ...fixture,
    benchmarkCatalog: [...fixture.benchmarkCatalog, {
      id: pendingCatalogId,
      benchmarkKey: "named-future-benchmark",
      version: "2026-07",
      readiness: "unreleased",
      expectedAt: 1_784_073_600_000,
      lastCheckedAt: 1_783_641_600_000,
      nextCheckAt: 1_784_073_600_000,
      ingestMethod: "unknown",
      notes: "Synthetic pending catalog row proving that unreleased entries carry no release measurements.",
    }],
  }
  const databasePath = join(temporaryDirectory, `gpt56-release-${Date.now()}.sqlite`)
  const program = Effect.gen(function*() {
    const store = yield* EvidenceStore
    const first = yield* store.ingestBundle(bundle)
    const second = yield* store.ingestBundle(bundle)
    expect(first.sources.inserted).toBe(bundle.sources.length)
    expect(first.runs.inserted).toBe(bundle.runs.length)
    expect(second.sources).toEqual({ inserted: 0, ignored: bundle.sources.length })
    expect(second.runs).toEqual({ inserted: 0, ignored: bundle.runs.length })
    expect((yield* store.listBenchmarkCatalog({ readiness: "unreleased", limit: 10 })).map((catalog) => catalog.id)).toEqual([pendingCatalogId])
    expect(bundle.metricDefinitions.some((definition) => definition.benchmarkCatalogId === pendingCatalogId)).toBe(false)
    expect(bundle.measurements.some((measurement) => measurement.runId.includes("pending-named-benchmark"))).toBe(false)
  })
  await Effect.runPromise(program.pipe(Effect.provide(openEvidenceStore(databasePath))))

  const frontier = await Effect.runPromise(queryFrontier(databasePath, {
    workClass: "software-engineering",
    taskModality: "repository",
    axes: [deepSweScoreAxis, costPerTaskAxis],
  }))
  expect(frontier.candidates.length).toBeGreaterThan(1)
  expect(frontier.candidates.every((candidate) => candidate.axes.length === 2)).toBe(true)
  const svg = exportFrontierSvg(frontier, {
    xAxis: frontierAxisId(costPerTaskAxis),
    yAxis: frontierAxisId(deepSweScoreAxis),
  })
  expect(exportFrontierSvg(frontier, {
    xAxis: frontierAxisId(costPerTaskAxis),
    yAxis: frontierAxisId(deepSweScoreAxis),
  })).toBe(svg)
  expect(svg).toContain("Two-dimensional projection")
})
