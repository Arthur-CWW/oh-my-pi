import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { decodeEvidenceBundleV1Json, type EvidenceBundleV1 } from "../src/evidence"
import { EvidenceStore, openEvidenceStore } from "../src/evidence-ingest"

const tmpDir = join(import.meta.dir, ".tmp")
const runId = Date.now()

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

function completeBundle(): EvidenceBundleV1 {
  return {
    version: 1,
    sources: [{
      id: "source-1",
      sourceKind: "official_benchmark",
      captureKind: "web_text",
      sourceSystem: "twitter_archive",
      sourceRef: "tweet-1",
      trustLabel: "official",
      publisher: "Benchmark Lab",
      title: "Benchmark methodology",
      retrievedAt: 1_000,
      scope: "Stable benchmark evidence",
    }],
    benchmarkCatalog: [{
      id: "catalog-1",
      benchmarkKey: "benchmark-x",
      version: "2026-01",
      readiness: "ingested",
      ingestMethod: "manual",
    }],
    benchmarkSaturationAssessments: [{
      benchmarkCatalogId: "catalog-1",
      sourceId: "source-1",
      assessedAt: 1_200,
      cohortKey: "frontier",
      status: "warning",
      topScore: 85,
      scoreSpread: 2,
      topK: 3,
    }],
    metricDefinitions: [{
      id: "definition-1",
      definitionKind: "benchmark",
      definitionKey: "benchmark-x",
      benchmarkCatalogId: "catalog-1",
      version: "2026-01",
      metricKey: "quality.score",
      displayName: "Quality",
      workClass: "coding",
      taskModality: "repository",
      unit: "percent",
      scoreDirection: "maximize",
      scoringRule: "Exact match",
      contaminationStatus: "declared_clean",
      methodologySourceId: "source-1",
    }],
    commercialFacts: [{
      id: "fact-1",
      sourceId: "source-1",
      effectiveFrom: 1_000,
      provider: "provider-a",
      product: "product-a",
      pricingContext: "subscription_allowance",
      component: "shared allowance",
      poolKey: "pool-a",
      factKind: "allowance",
      subjectKind: "pool",
      subjectKey: "pool-a",
      windowKind: "rolling",
      value: 100,
      unit: "requests",
      limitKind: "shared_pool",
      scope: "Team plan",
    }, {
      id: "fact-2",
      sourceId: "source-1",
      effectiveFrom: 1_000,
      provider: "provider-a",
      product: "product-a",
      pricingContext: "subscription_allowance",
      component: "model eligibility",
      poolKey: "pool-a",
      factKind: "eligibility",
      subjectKind: "model",
      subjectKey: "model-a",
      windowKind: "rolling",
      unit: "requests",
      limitKind: "shared_pool",
      scope: "Team plan",
    }],
    runs: [{
      id: "run-1",
      sourceId: "source-1",
      evidenceKind: "external_benchmark",
      observedAt: 1_100,
      workClass: "coding",
      taskModality: "repository",
    }],
    participants: [{
      runId: "run-1",
      ordinal: 0,
      role: "primary",
      provider: "provider-a",
      model: "model-a",
      modelVersion: "v1",
      account: "team",
      effort: "high",
    }, {
      runId: "run-1",
      ordinal: 1,
      role: "advisor",
      provider: "provider-b",
      model: "model-b",
    }],
    measurements: [{
      id: "measurement-1",
      runId: "run-1",
      metricDefinitionId: "definition-1",
      metricKey: "quality.score",
      value: 85,
      unit: "percent",
      direction: "maximize",
      statistic: "mean",
      axisRole: "reported",
      derived: false,
    }],
  }
}

test("evidence bundle decoding and ingest are atomic and idempotent", async () => {
  const dbPath = join(tmpDir, `evidence-${runId}.sqlite`)
  const bundle = completeBundle()
  const program = Effect.gen(function* () {
    const store = yield* EvidenceStore
    expect(yield* store.ingestBundle(bundle)).toMatchObject({
      sources: { inserted: 1, ignored: 0 },
      benchmarkCatalog: { inserted: 1, ignored: 0 },
      benchmarkSaturationAssessments: { inserted: 1, ignored: 0 },
      metricDefinitions: { inserted: 1, ignored: 0 },
      commercialFacts: { inserted: 2, ignored: 0 },
      runs: { inserted: 1, ignored: 0 },
      participants: { inserted: 2, ignored: 0 },
      measurements: { inserted: 1, ignored: 0 },
    })
    expect(yield* store.ingestBundle(bundle)).toMatchObject({
      sources: { inserted: 0, ignored: 1 },
      benchmarkCatalog: { inserted: 0, ignored: 1 },
      benchmarkSaturationAssessments: { inserted: 0, ignored: 1 },
      metricDefinitions: { inserted: 0, ignored: 1 },
      commercialFacts: { inserted: 0, ignored: 2 },
      runs: { inserted: 0, ignored: 1 },
      participants: { inserted: 0, ignored: 2 },
      measurements: { inserted: 0, ignored: 1 },
    })
    expect((yield* store.listRuns({ provider: "provider-a", limit: 1 })).map((row) => row.id)).toEqual(["run-1"])
    expect((yield* store.listMeasurements({ metricDefinitionId: "definition-1", limit: 1 })).map((row) => row.id)).toEqual(["measurement-1"])
    expect((yield* store.listBenchmarkSaturationAssessments({ benchmarkCatalogId: "catalog-1", cohortKey: "frontier", limit: 1 })).map((row) => row.status)).toEqual(["warning"])
  })
  await Effect.runPromise(program.pipe(Effect.provide(openEvidenceStore(dbPath))))
})

test("evidence rejects semantic mismatches and leaves no partial rows", async () => {
  const dbPath = join(tmpDir, `evidence-invalid-${runId}.sqlite`)
  const bundle = completeBundle()
  const invalid: EvidenceBundleV1 = { ...bundle, measurements: [{ ...bundle.measurements[0]!, metricDefinitionId: undefined, unit: "score" }] }
  const program = Effect.gen(function* () {
    const store = yield* EvidenceStore
    const result = yield* Effect.exit(store.ingestBundle(invalid))
    expect(result._tag).toBe("Failure")
    expect((yield* store.listSources({ limit: 10 }))).toEqual([])
    expect((yield* store.listRuns({ limit: 10 }))).toEqual([])
  })
  await Effect.runPromise(program.pipe(Effect.provide(openEvidenceStore(dbPath))))
})

test("shared pool facts require eligibility and null dynamic quantities", async () => {
  const dbPath = join(tmpDir, `evidence-pool-${runId}.sqlite`)
  const bundle = completeBundle()
  const missingEligibility: EvidenceBundleV1 = { ...bundle, commercialFacts: [bundle.commercialFacts[0]!] }
  const illegalDynamic: EvidenceBundleV1 = { ...bundle, commercialFacts: [{ ...bundle.commercialFacts[0]!, windowKind: "dynamic" }, bundle.commercialFacts[1]!] }
  const program = Effect.gen(function* () {
    const store = yield* EvidenceStore
    expect((yield* Effect.exit(store.ingestBundle(missingEligibility)))._tag).toBe("Failure")
    expect((yield* store.listSources({ limit: 10 }))).toEqual([])
    expect((yield* Effect.exit(store.ingestBundle(illegalDynamic)))._tag).toBe("Failure")
    expect((yield* store.listCommercialFacts({ limit: 10 }))).toEqual([])
  })
  await Effect.runPromise(program.pipe(Effect.provide(openEvidenceStore(dbPath))))
})

test("graph OCR requires calibration evidence and uncertainty bounds", async () => {
  const bundle = completeBundle()
  const ocrBundle: EvidenceBundleV1 = {
    ...bundle,
    sources: [{ ...bundle.sources[0]!, captureKind: "graph_ocr", notes: "calibration and extraction method recorded with precision" }],
    measurements: [{ ...bundle.measurements[0]!, lowerConfidenceBound: 84, upperConfidenceBound: 86 }],
  }
  expect(decodeEvidenceBundleV1Json(JSON.stringify(ocrBundle))).toEqual(ocrBundle)
  const dbPath = join(tmpDir, `evidence-ocr-${runId}.sqlite`)
  const program = Effect.gen(function* () {
    const store = yield* EvidenceStore
    expect((yield* store.ingestBundle(ocrBundle)).measurements.inserted).toBe(1)
    const unbounded = { ...ocrBundle, measurements: [{ ...ocrBundle.measurements[0]!, id: "measurement-2", lowerConfidenceBound: undefined, upperConfidenceBound: undefined }] }
    expect((yield* Effect.exit(store.ingestBundle(unbounded)))._tag).toBe("Failure")
  })
  await Effect.runPromise(program.pipe(Effect.provide(openEvidenceStore(dbPath))))
})
