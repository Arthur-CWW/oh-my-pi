import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"

import {
  LEDGER_SCHEMA_VERSION,
  migrateLedger,
  migration0001Sql,
  migration0002Sql,
  migration0003Sql,
  migration0004Sql,
  migration0005Sql,
  migration0006Sql,
} from "../src/migrate"

interface NameRow {
  readonly name: string
}

interface VersionRow {
  readonly user_version: number
}

interface ModelCallRow {
  readonly id: string
  readonly ttftMs: number | null
  readonly reasoningTokens: number | null
}

interface UsageRow {
  readonly calls: number
  readonly tokensPerSecond: number
  readonly avgTtftMs: number | null
  readonly reasoningTokens: number
}

interface MasterRow {
  readonly name: string
  readonly sql: string
}

const tmpDir = join(import.meta.dir, ".tmp", "evidence-migration")
const freshPath = join(tmpDir, "fresh.sqlite")
const upgradePath = join(tmpDir, "upgrade.sqlite")

const evidenceTableColumns = {
  evidence_sources: [
    "id", "sourceKind", "captureKind", "sourceSystem", "sourceRef", "trustLabel", "publisher", "author", "title", "url",
    "publishedAt", "retrievedAt", "effectiveFrom", "effectiveTo", "artifactId", "contentSha256", "scope", "methodologyUrl", "notes",
  ],
  benchmark_catalog: [
    "id", "benchmarkKey", "version", "readiness", "expectedAt", "releasedAt", "lastCheckedAt", "nextCheckAt",
    "sourceUrl", "dataUrl", "ingestMethod", "blocker", "notes",
  ],
  metric_definitions: [
    "id", "definitionKind", "definitionKey", "version", "metricKey", "displayName", "workClass", "taskModality", "unit",
    "scoreDirection", "scoringRule", "datasetSize", "hiddenEval", "contaminationStatus", "benchmarkCatalogId", "lowerBound",
    "upperBound", "methodologySourceId", "qualityNotes",
  ],
  commercial_facts: [
    "id", "sourceId", "effectiveFrom", "effectiveTo", "provider", "model", "account", "product", "pricingContext", "serviceTier",
    "component", "poolKey", "factKind", "subjectKind", "subjectKey", "windowKind", "value", "unit", "perValue", "perUnit",
    "limitKind", "periodSeconds", "scope", "notes",
  ],
  evaluation_runs: [
    "id", "sourceId", "evidenceKind", "observedAt", "workClass", "harnessProfile", "toolProfile", "contextProfile", "taskModality",
    "taskCount", "modelCallId", "sessionId", "packetId", "artifactId", "outcomeClass", "retryCount", "humanInterventionCount", "notes",
  ],
  evaluation_run_participants: ["runId", "ordinal", "role", "provider", "model", "modelVersion", "account", "effort"],
  benchmark_saturation_assessments: [
    "benchmarkCatalogId", "sourceId", "assessedAt", "cohortKey", "status", "topScore", "scoreSpread", "topK", "ceiling",
    "threshold", "expectedSaturationAt", "notes",
  ],
  evaluation_measurements: [
    "id", "runId", "metricDefinitionId", "metricKey", "value", "unit", "direction", "statistic", "axisRole",
    "lowerConfidenceBound", "upperConfidenceBound", "confidenceLevel", "sampleSize", "costBasis", "derived", "derivation", "notes",
  ],
} as const

const evidenceIndexes = [
  "evidence_sources_publisher_publishedAt_idx",
  "evidence_sources_trustLabel_publishedAt_idx",
  "evidence_sources_contentSha256_idx",
  "evidence_sources_sourceSystem_sourceRef_idx",
  "benchmark_catalog_key_version_unique_idx",
  "benchmark_catalog_readiness_nextCheckAt_idx",
  "metric_definitions_key_version_metric_unique_idx",
  "metric_definitions_kind_workClass_modality_idx",
  "metric_definitions_source_idx",
  "commercial_facts_provider_model_context_effective_idx",
  "commercial_facts_product_account_effective_idx",
  "metric_definitions_catalog_idx",
  "benchmark_saturation_assessments_catalog_cohort_assessedAt_idx",
  "benchmark_saturation_assessments_status_assessedAt_idx",
  "commercial_facts_source_idx",
  "commercial_facts_poolKey_idx",
  "commercial_facts_subject_idx",
  "evaluation_runs_workClass_observedAt_idx",
  "evaluation_runs_source_idx",
  "evaluation_runs_modelCall_idx",
  "evaluation_runs_packet_idx",
  "evaluation_runs_profiles_idx",
  "evaluation_run_participants_candidate_idx",
  "evaluation_run_participants_run_role_idx",
  "evaluation_measurements_run_metric_idx",
  "evaluation_measurements_metricDefinition_run_idx",
  "evaluation_measurements_metric_unit_direction_idx",
] as const


function columnNames(sqlite: Database, table: string): readonly string[] {
  return sqlite.query<NameRow, []>(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).all().map((row) => row.name)
}

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("fresh ledger reaches v10 with additive evidence and operational schemas", () => {
  const sqlite = new Database(freshPath)
  try {
    migrateLedger(sqlite)

    expect(LEDGER_SCHEMA_VERSION).toBe(10)
    expect(sqlite.query<VersionRow, []>("PRAGMA user_version").get()?.user_version).toBe(10)

    const freshTableNames = sqlite.query<NameRow, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name)
    const freshIndexNames = sqlite.query<NameRow, []>("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all().map((row) => row.name)
    for (const [table, columns] of Object.entries(evidenceTableColumns)) {
      expect(freshTableNames).toContain(table)
      expect(columnNames(sqlite, table)).toEqual(columns)
    }
    for (const index of evidenceIndexes) {
      expect(freshIndexNames).toContain(index)
    }
    sqlite.exec(`
      INSERT INTO evaluation_run_participants (runId, ordinal, role, provider, model)
      VALUES ('run-1', 0, 'primary', 'provider', 'model')
    `)
    expect(() => sqlite.exec(`
      INSERT INTO evaluation_run_participants (runId, ordinal, role, provider, model)
      VALUES ('run-1', 0, 'advisor', 'provider', 'model')
    `)).toThrow()
    sqlite.exec(`
      INSERT INTO benchmark_saturation_assessments (benchmarkCatalogId, sourceId, assessedAt, cohortKey, status)
      VALUES ('catalog-1', 'source-1', 1000, 'frontier', 'active')
    `)
    sqlite.exec(`
      INSERT INTO benchmark_saturation_assessments (benchmarkCatalogId, sourceId, assessedAt, cohortKey, status)
      VALUES ('catalog-1', 'source-1', 1000, 'small-variants', 'warning')
    `)
    expect(() => sqlite.exec(`
      INSERT INTO benchmark_saturation_assessments (benchmarkCatalogId, sourceId, assessedAt, cohortKey, status)
      VALUES ('catalog-1', 'source-1', 1000, 'frontier', 'saturated')
    `)).toThrow()
  } finally {
    sqlite.close()
  }
})

test("v5 ledger preserves legacy rows and views through the v10 operational migration", () => {
  const sqlite = new Database(upgradePath)
  try {
    sqlite.exec(migration0001Sql)
    sqlite.exec(migration0002Sql)
    sqlite.exec(migration0003Sql)
    sqlite.exec(migration0004Sql)
    sqlite.exec(migration0005Sql)
    sqlite.exec(`
      INSERT INTO model_calls (
        id, ts, machine, session, branchId, agent, model, provider, effort,
        promptHash, systemPromptHash, skillProfile, contextManifest, packetId,
        tokensIn, tokensOut, cacheRead, cacheWrite, cost, latencyMs, ttftMs, reasoningTokens, outcome,
        rawRequestArtifact, rawResponseArtifact
      ) VALUES (
        'legacy-call', 1000, 'machine', 'legacy-session', 'legacy-branch', 'LegacyAgent', 'legacy-model', 'legacy-provider', 'medium',
        'prompt', 'system', 'skills', 'context', 'legacy-packet',
        120, 30, 4, 2, 0.25, 300, 20, 7, 'ok',
        'request-artifact', 'response-artifact'
      )
    `)

    const legacyRow = sqlite.query<ModelCallRow, []>("SELECT * FROM model_calls WHERE id = 'legacy-call'").get()
    const legacyUsage = sqlite.query<UsageRow, []>("SELECT calls, tokensPerSecond, avgTtftMs, reasoningTokens FROM usage_by_session WHERE session = 'legacy-session'").get()
    const legacyViews = sqlite.query<MasterRow, []>("SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name").all()

    expect(sqlite.query<VersionRow, []>("PRAGMA user_version").get()?.user_version).toBe(5)
    sqlite.exec(migration0006Sql)

    expect(sqlite.query<VersionRow, []>("PRAGMA user_version").get()?.user_version).toBe(6)
    expect(sqlite.query<ModelCallRow, []>("SELECT * FROM model_calls WHERE id = 'legacy-call'").get()).toEqual(legacyRow)
    expect(sqlite.query<UsageRow, []>("SELECT calls, tokensPerSecond, avgTtftMs, reasoningTokens FROM usage_by_session WHERE session = 'legacy-session'").get()).toEqual(legacyUsage)
    expect(sqlite.query<MasterRow, []>("SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name").all()).toEqual(legacyViews)

    migrateLedger(sqlite)

    expect(sqlite.query<VersionRow, []>("PRAGMA user_version").get()?.user_version).toBe(10)

    const upgradeIndexNames = sqlite.query<NameRow, []>("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all().map((row) => row.name)
    for (const [table, columns] of Object.entries(evidenceTableColumns)) {
      expect(columnNames(sqlite, table)).toEqual(columns)
    }
    for (const index of evidenceIndexes) {
      expect(upgradeIndexNames).toContain(index)
    }
  } finally {
    sqlite.close()
  }
})
