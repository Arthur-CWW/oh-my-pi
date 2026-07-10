import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const packageDir = resolve(import.meta.dir, "..")
const rawReportPath = resolve(packageDir, "..", "..", "local", "gpt56-release-evidence.json")
const fixturePath = resolve(packageDir, "fixtures", "gpt56-release-2026-07-10.json")
const releaseObservedAt = Date.parse("2026-07-09T00:00:00Z")
const retrievedAt = Date.parse("2026-07-10T00:00:00Z")

interface RawPoint {
  readonly source_url: string
  readonly source_date: string
  readonly graph_source: "Aidan" | "scaling01"
  readonly graph_image_url: string
  readonly benchmark: string
  readonly benchmark_version?: string
  readonly metric: string
  readonly unit: string
  readonly task_count?: number
  readonly model: string
  readonly effort?: string
  readonly score?: number
  readonly score_uncertainty?: number
  readonly cost_per_task_usd?: number
  readonly tokens_per_task?: number
  readonly steps_per_task?: number
  readonly extraction_method: string
  readonly notes?: string
}

interface RawReport {
  readonly data_points: readonly RawPoint[]
  readonly gaps: readonly string[]
}

interface BenchmarkShape {
  readonly key: string
  readonly version: string
  readonly workClass: string
  readonly taskModality: string
  readonly sourceId: string
  readonly sourceUrl: string
  readonly metricKey: string
  readonly unit: string
  readonly displayName: string
  readonly scoringRule: string
}

const benchmarkShapes: Readonly<Record<string, BenchmarkShape>> = {
  "Agents' Last Exam": {
    key: "agents-last-exam", version: "2026-07", workClass: "agentic-evaluation", taskModality: "long-horizon-agent", sourceId: "source-openai-gpt-5-6", sourceUrl: "https://openai.com/index/gpt-5-6/", metricKey: "benchmark.agents-last-exam.score", unit: "%", displayName: "Agents' Last Exam score", scoringRule: "Published percentage score on the 55-task Agents' Last Exam table.",
  },
  "Artificial Analysis Coding Agent Index": {
    key: "artificial-analysis-coding-agent-index", version: "v1.1", workClass: "software-engineering", taskModality: "repository", sourceId: "source-openai-gpt-5-6", sourceUrl: "https://openai.com/index/gpt-5-6/", metricKey: "benchmark.artificial-analysis-coding-agent-index.score", unit: "index points", displayName: "Artificial Analysis Coding Agent Index score", scoringRule: "Published v1.1 index score across 321 tasks.",
  },
  BrowseComp: {
    key: "browsecomp", version: "2026-07", workClass: "web-research", taskModality: "browsing", sourceId: "source-openai-gpt-5-6", sourceUrl: "https://openai.com/index/gpt-5-6/", metricKey: "benchmark.browsecomp.accuracy", unit: "%", displayName: "BrowseComp accuracy", scoringRule: "Published percentage accuracy on 1,266 BrowseComp tasks.",
  },
  "GeneBench Pro": {
    key: "genebench-pro", version: "2026-07", workClass: "scientific-reasoning", taskModality: "biology", sourceId: "source-openai-gpt-5-6", sourceUrl: "https://openai.com/index/gpt-5-6/", metricKey: "benchmark.genebench-pro.pass-rate", unit: "%", displayName: "GeneBench Pro pass rate", scoringRule: "Published percentage pass rate on 129 GeneBench Pro tasks.",
  },
  DeepSWE: {
    key: "deepswe", version: "v1.1", workClass: "software-engineering", taskModality: "repository", sourceId: "source-deepswe-v1-1", sourceUrl: "https://deepswe.datacurve.ai/", metricKey: "benchmark.deepswe.pass-at-1", unit: "%", displayName: "DeepSWE pass@1", scoringRule: "Published v1.1 pass@1 percentage on 113 DeepSWE tasks.",
  },
  CursorBench: {
    key: "cursorbench", version: "3.2", workClass: "software-engineering", taskModality: "repository", sourceId: "source-cursorbench-3-2", sourceUrl: "https://cursor.com/cursorbench", metricKey: "benchmark.cursorbench.score", unit: "%", displayName: "CursorBench 3.2 score", scoringRule: "Published CursorBench 3.2 percentage score; task count is not published in the raw report.",
  },
}


function modelProvider(model: string): string {
  if (model.startsWith("GPT")) return "OpenAI"
  if (model.startsWith("Claude")) return "Anthropic"
  if (model.startsWith("Gemini")) return "Google"
  throw new Error(`No provider mapping for ${model}`)
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll("@", "at").replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")
}

function canonicalEffort(effort: string | undefined): string | null {
  return effort === undefined ? null : effort.trim().toLowerCase().replaceAll(/\s+/g, "-")
}


function buildBundle(report: RawReport) {
  const points = report.data_points.filter((point) => point.benchmark !== "Agents' Last Exam" || point.model !== "GPT-5.6 Sol" || point.score !== 53.6)
  const presentBenchmarks = [...new Set(points.map((point) => point.benchmark))]
  const sources = [
    {
      id: "source-openai-gpt-5-6", sourceKind: "official_benchmark", captureKind: "web_text", trustLabel: "official", publisher: "OpenAI", author: null, title: "GPT-5.6 release benchmark tables", url: "https://openai.com/index/gpt-5-6/", publishedAt: releaseObservedAt, retrievedAt, scope: "Official release-window benchmark tables for Agents' Last Exam, Artificial Analysis Coding Agent Index v1.1, BrowseComp, and GeneBench Pro.", methodologyUrl: "https://openai.com/index/gpt-5-6/", notes: "Exact table values curated from the local release-evidence report. Agents' Last Exam GPT-5.6 Sol uses the table-backed 52.7 max-effort value; the same page's 53.6 narrative claim has unspecified configuration and is retained as a discrepancy note, not a second comparable run.",
    },
    {
      id: "source-deepswe-v1-1", sourceKind: "official_benchmark", captureKind: "web_text", trustLabel: "official", publisher: "DataCurve", author: null, title: "DeepSWE benchmark v1.1", url: "https://deepswe.datacurve.ai/", publishedAt: releaseObservedAt, retrievedAt, scope: "Official DeepSWE v1.1 release-window results, including reported pass@1, cost per task, output tokens per task, and steps per task.", methodologyUrl: "https://deepswe.datacurve.ai/", notes: "The report records output-token figures in thousands and converts them to whole-token values.",
    },
    {
      id: "source-cursorbench-3-2", sourceKind: "official_benchmark", captureKind: "web_text", trustLabel: "official", publisher: "Cursor", author: null, title: "CursorBench 3.2", url: "https://cursor.com/cursorbench", publishedAt: releaseObservedAt, retrievedAt, scope: "Official CursorBench 3.2 release-window results, including score, cost per task, tokens per task, and steps per task.", methodologyUrl: "https://cursor.com/cursorbench", notes: "The raw report does not publish a CursorBench 3.2 task count.",
    },
    {
      id: "source-aidan-release-graphs", sourceKind: "independent_eval", captureKind: "web_text", sourceSystem: "twitter_archive", sourceRef: "2075338197144588647", trustLabel: "independent", publisher: "X", author: "Aidan McLaughlin", title: "GPT-5.6 release-window benchmark graphs", url: "https://x.com/aidan_mclau/status/2075338197144588647", publishedAt: retrievedAt, retrievedAt, scope: "Independent graph index for official GPT-5.6 release benchmark pages: Agents' Last Exam, Artificial Analysis Coding Agent Index v1.1, BrowseComp, and GeneBench Pro.", notes: "Provenance only: the fixture uses exact primary-table values rather than graph OCR. Image URLs are preserved in the raw local report.",
    },
    {
      id: "source-scaling01-release-graphs", sourceKind: "independent_eval", captureKind: "web_text", sourceSystem: "twitter_archive", sourceRef: "2075366415964451244", trustLabel: "independent", publisher: "X", author: "scaling01", title: "GPT-5.6 release-day DeepSWE and CursorBench graphs", url: "https://x.com/scaling01/status/2075366415964451244", publishedAt: retrievedAt, retrievedAt, scope: "Independent graph index for the official DeepSWE v1.1 and CursorBench 3.2 pages.", notes: "Provenance only: exact values are curated from the local report's named official extraction methods, not numeric graph OCR.",
    },
    {
      id: "source-openai-codex-rate-card-2026-07-10", sourceKind: "official_rate_card", captureKind: "web_text", trustLabel: "official", publisher: "OpenAI", author: null, title: "Codex rate card", url: "https://help.openai.com/en/articles/20001106-codex-rate-card", publishedAt: retrievedAt, retrievedAt, effectiveFrom: retrievedAt, scope: "Official token-based Codex credit rates per one million tokens, updated 2026-07-10.", notes: "Tasks share an agentic credit pool and actual usage depends on token mix. The source does not establish a fixed message limit, Pro pool size, or reset limit.",
    }
  ]

  const benchmarkCatalog = presentBenchmarks.map((benchmark) => {
    const shape = benchmarkShapes[benchmark]
    return {
      id: `catalog-${shape.key}-${slug(shape.version)}`, benchmarkKey: shape.key, version: shape.version, readiness: "ingested", lastCheckedAt: retrievedAt, sourceUrl: shape.sourceUrl, ingestMethod: "manual", notes: "Curated from exact numeric release-window values in local/gpt56-release-evidence.json; the report does not provide this benchmark version's release date.",
    }
  })


  const metricDefinitions = presentBenchmarks.flatMap((benchmark) => {
    const shape = benchmarkShapes[benchmark]
    const taskCount = points.find((point) => point.benchmark === benchmark)?.task_count
    const scoreDefinition = {
      id: `definition-${shape.key}-${slug(shape.version)}`, definitionKind: "benchmark", definitionKey: shape.key, version: shape.version, benchmarkCatalogId: `catalog-${shape.key}-${slug(shape.version)}`, metricKey: shape.metricKey, displayName: shape.displayName, workClass: shape.workClass, taskModality: shape.taskModality, unit: shape.unit, scoreDirection: "maximize", scoringRule: shape.scoringRule, datasetSize: taskCount, hiddenEval: null, contaminationStatus: "unknown", methodologySourceId: shape.sourceId, qualityNotes: benchmark === "Agents' Last Exam" ? "GPT-5.6 Sol 53.6 narrative value is excluded because its configuration is unspecified; 52.7 table max-effort value is the comparable observation." : null,
    }
    if (benchmark !== "DeepSWE" && benchmark !== "CursorBench") return [scoreDefinition]
    return [scoreDefinition, {
      id: `definition-${shape.key}-${slug(shape.version)}-steps`, definitionKind: "benchmark", definitionKey: shape.key, version: shape.version, benchmarkCatalogId: `catalog-${shape.key}-${slug(shape.version)}`, metricKey: "steps.count", displayName: `${shape.displayName} steps per task`, workClass: shape.workClass, taskModality: shape.taskModality, unit: "steps", scoreDirection: "minimize", scoringRule: "Reported steps per task for the configured benchmark observation.", datasetSize: taskCount, hiddenEval: null, contaminationStatus: "unknown", methodologySourceId: shape.sourceId, qualityNotes: "Only emitted where the raw report supplies an exact numeric value.",
    }]
  })

  const runs = points.map((point) => {
    const shape = benchmarkShapes[point.benchmark]
    const effort = canonicalEffort(point.effort) ?? "unspecified"
    return {
      id: `run-${shape.key}-${slug(shape.version)}-${slug(point.model)}-${slug(effort)}`, sourceId: shape.sourceId, evidenceKind: "external_benchmark", observedAt: Date.parse(`${point.source_date}T00:00:00Z`), workClass: shape.workClass, harnessProfile: null, toolProfile: null, contextProfile: null, taskModality: shape.taskModality, taskCount: point.task_count, notes: [point.notes, point.effort === undefined ? undefined : `Source effort label: ${point.effort}.`, `Extraction method: ${point.extraction_method}.`, `Graph provenance: ${point.graph_source}; ${point.graph_image_url}`].filter((note) => note !== undefined).join(" "),
    }
  })

  const participants = points.map((point) => {
    const shape = benchmarkShapes[point.benchmark]
    const effort = canonicalEffort(point.effort) ?? "unspecified"
    return {
      runId: `run-${shape.key}-${slug(shape.version)}-${slug(point.model)}-${slug(effort)}`, ordinal: 0, role: "primary", provider: modelProvider(point.model), model: point.model, modelVersion: null, account: null, effort: canonicalEffort(point.effort),
    }
  })

  const measurements = points.flatMap((point) => {
    const shape = benchmarkShapes[point.benchmark]
    const effort = canonicalEffort(point.effort) ?? "unspecified"
    const runId = `run-${shape.key}-${slug(shape.version)}-${slug(point.model)}-${slug(effort)}`
    const definitionId = `definition-${shape.key}-${slug(shape.version)}`
    const shared = { runId, statistic: "reported", axisRole: "reported", derived: false }
    const score = point.score === undefined ? [] : [{
      id: `measurement-${slug(runId)}-score`, ...shared, metricDefinitionId: definitionId, metricKey: shape.metricKey, value: point.score, unit: shape.unit, direction: "maximize", notes: point.score_uncertainty === undefined ? null : `Reported uncertainty: ±${point.score_uncertainty} percentage points.`,
    }]
    const cost = point.cost_per_task_usd === undefined ? [] : [{
      id: `measurement-${slug(runId)}-cost`, ...shared, metricKey: "cost.usd", value: point.cost_per_task_usd, unit: "USD", direction: "minimize", costBasis: "reported_other", notes: "Reported cost per task.",
    }]
    const tokens = point.tokens_per_task === undefined ? [] : [{
      id: `measurement-${slug(runId)}-tokens-output`, ...shared, metricKey: "tokens.output", value: point.tokens_per_task, unit: "tokens", direction: "minimize", notes: "Reported output tokens per task; DeepSWE values were converted from thousands by the raw report.",
    }]
    const steps = point.steps_per_task === undefined ? [] : [{
      id: `measurement-${slug(runId)}-steps`, ...shared, metricDefinitionId: `definition-${shape.key}-${slug(shape.version)}-steps`, metricKey: "steps.count", value: point.steps_per_task, unit: "steps", direction: "minimize", notes: "Reported steps per task.",
    }]
    return [...score, ...cost, ...tokens, ...steps]
  })

  const benchmarkSaturationAssessments = presentBenchmarks.map((benchmark) => {
    const shape = benchmarkShapes[benchmark]
    const scores = points.filter((point) => point.benchmark === benchmark && point.score !== undefined).map((point) => point.score)
    const topScore = Math.max(...scores)
    const scoreSpread = Number((topScore - Math.min(...scores)).toFixed(6))
    return {
      benchmarkCatalogId: `catalog-${shape.key}-${slug(shape.version)}`, sourceId: shape.sourceId, assessedAt: retrievedAt, cohortKey: "gpt-5-6-release-window-published-comparators", status: "unknown", topScore, scoreSpread, topK: scores.length, notes: "Numeric spread is descriptive only. The release-window report does not establish a saturation threshold, ceiling, or forecast.",
    }
  })
  const commercialFacts = [
    { model: "GPT-5.6 Sol", rates: { input: 125, "cached-input": 12.5, output: 750 } },
    { model: "GPT-5.6 Terra", rates: { input: 62.5, "cached-input": 6.25, output: 375 } },
    { model: "GPT-5.6 Luna", rates: { input: 25, "cached-input": 2.5, output: 150 } },
    { model: "GPT-5.5", rates: { input: 125, "cached-input": 12.5, output: 750 } },
  ].flatMap(({ model, rates }) => Object.entries(rates).map(([component, value]) => ({
    id: `commercial-codex-credit-${slug(model)}-${component}`, sourceId: "source-openai-codex-rate-card-2026-07-10", effectiveFrom: retrievedAt, provider: "OpenAI", model, product: "Codex", pricingContext: "codex_credit", component, factKind: "price", subjectKind: "model", subjectKey: slug(model), windowKind: "fixed", value, unit: "USD", perValue: 1_000_000, perUnit: "tokens", limitKind: "metered", scope: "Token-based Codex credit rate per one million tokens; actual task usage depends on token mix within a shared agentic credit pool.", notes: "Not an API-token price, subscription allowance, fixed message limit, or subscription frontier cost."
  })))

  return { version: 1, sources, benchmarkCatalog, benchmarkSaturationAssessments, metricDefinitions, commercialFacts, runs, participants, measurements }
}

export function curateGpt56Release(raw: string): string {
  return `${JSON.stringify(buildBundle(JSON.parse(raw) as RawReport), null, 2)}\n`
}

export function curateGpt56ReleaseFixture(): void {
  const fixture = curateGpt56Release(readFileSync(rawReportPath, "utf8"))
  mkdirSync(dirname(fixturePath), { recursive: true })
  writeFileSync(fixturePath, fixture)
}

if (import.meta.main) curateGpt56ReleaseFixture()
