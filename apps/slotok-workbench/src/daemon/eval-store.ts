import { Database } from "bun:sqlite"
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import type { BootstrapPayload, EvalElementDetail, EvalElementSummary, EvalResultRow, EvalRunRow, FrameRecord } from "../types"

export interface EvalStoreOptions {
  cwd?: string
  evalRoot?: string
  sqlitePath?: string
  annotationsPath?: string
  startedAt?: string
}

interface EvalStoreConfig {
  cwd: string
  evalRoot: string
  sqlitePath: string
  annotationsPath: string
  startedAt: string
}

interface EvalRunStatsRow extends EvalRunRow {
  result_count: number
  completed_count: number
  cache_hit_count: number
  failed_count: number
  dry_run_count: number
  billed_cost_usd: number | null
  avoided_cost_usd: number | null
  avg_latency_ms: number | null
}

export class EvalStore {
  readonly config: EvalStoreConfig

  constructor(options: EvalStoreOptions = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : findProjectRoot(process.cwd())
    const evalRoot = resolve(cwd, options.evalRoot ?? "data/provider-evals/video-understanding")
    this.config = {
      cwd,
      evalRoot,
      sqlitePath: resolve(cwd, options.sqlitePath ?? "data/provider-evals/video-understanding/evals.sqlite"),
      annotationsPath: resolve(cwd, options.annotationsPath ?? "data/slotok-workbench/annotations.json"),
      startedAt: options.startedAt ?? new Date().toISOString(),
    }
  }

  bootstrap(limit = 250): BootstrapPayload {
    return {
      server: {
        cwd: this.config.cwd,
        evalRoot: this.config.evalRoot,
        sqlitePath: this.config.sqlitePath,
        annotationsPath: this.config.annotationsPath,
        startedAt: this.config.startedAt,
      },
      runs: this.listRuns(100),
      elements: this.listElements(limit),
      annotations: {},
      shortcuts: [
        { key: "j/k", description: "Move selection down/up" },
        { key: "gg/G", description: "Jump to first/last" },
        { key: "g<letter>", description: "Switch Slotok view" },
        { key: "/", description: "Search/filter" },
        { key: "a", description: "Annotate selected element" },
        { key: "r/R", description: "Rerun stage / descendants" },
      ],
    }
  }

  listRuns(limit = 100): EvalRunRow[] {
    if (!existsSync(this.config.sqlitePath)) return []
    return withDb(this.config.sqlitePath, (db) => {
      const rows = db.query<EvalRunStatsRow, [number]>(`
        SELECT
          r.*,
          count(er.id) AS result_count,
          coalesce(sum(CASE WHEN er.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
          coalesce(sum(CASE WHEN er.status = 'cache_hit' THEN 1 ELSE 0 END), 0) AS cache_hit_count,
          coalesce(sum(CASE WHEN er.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
          coalesce(sum(CASE WHEN er.status = 'dry_run' THEN 1 ELSE 0 END), 0) AS dry_run_count,
          sum(er.estimated_cost_usd) AS billed_cost_usd,
          sum(er.avoided_cost_usd) AS avoided_cost_usd,
          avg(CASE WHEN er.latency_ms > 0 THEN er.latency_ms ELSE NULL END) AS avg_latency_ms
        FROM eval_runs r
        LEFT JOIN eval_results er ON er.run_id = r.run_id
        GROUP BY r.run_id
        ORDER BY r.created_at DESC
        LIMIT ?
      `).all(limit)

      return rows.map((row) => ({
        ...row,
        result_count: Number(row.result_count ?? 0),
        completed_count: Number(row.completed_count ?? 0),
        cache_hit_count: Number(row.cache_hit_count ?? 0),
        failed_count: Number(row.failed_count ?? 0),
        dry_run_count: Number(row.dry_run_count ?? 0),
        billed_cost_usd: nullableNumber(row.billed_cost_usd),
        avoided_cost_usd: nullableNumber(row.avoided_cost_usd),
        avg_latency_ms: nullableNumber(row.avg_latency_ms),
      }))
    })
  }

  listElements(limit = 250): EvalElementSummary[] {
    if (!existsSync(this.config.sqlitePath)) return []
    return withDb(this.config.sqlitePath, (db) => {
      const rows = db.query<EvalResultRow, [number]>(`
        SELECT *
        FROM eval_results
        ORDER BY created_at DESC, provider ASC
        LIMIT ?
      `).all(limit)

      return rows.map((row) => resultToElement(row))
    })
  }

  getElement(id: string): EvalElementDetail | null {
    if (!existsSync(this.config.sqlitePath)) return null
    return withDb(this.config.sqlitePath, (db) => {
      const result = db.query<EvalResultRow, [string]>("SELECT * FROM eval_results WHERE id = ? LIMIT 1").get(id)
      if (!result) return null
      const run = db.query<EvalRunRow, [string]>("SELECT * FROM eval_runs WHERE run_id = ? LIMIT 1").get(result.run_id) ?? undefined
      const parsedPath = parsedPathFor(result)
      const parsed = readJsonFile(parsedPath ?? undefined)
      const rawPreview = readTextPreview(result.response_path ?? result.cache_path)
      return {
        ...resultToElement(result),
        run,
        result,
        frames: parseFrames(result.frames_json),
        parsed,
        rawPreview,
        sectionAnnotations: {},
      }
    })
  }
}

function findProjectRoot(start: string): string {
  let current = resolve(start)
  while (true) {
    if (existsSync(resolve(current, "AGENTS.md")) || existsSync(resolve(current, "data/provider-evals/video-understanding/evals.sqlite"))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(start)
    current = parent
  }
}

function withDb<T>(sqlitePath: string, fn: (db: Database) => T): T {
  const db = new Database(sqlitePath)
  try {
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA query_only = ON")
    return fn(db)
  } finally {
    db.close()
  }
}

function resultToElement(row: EvalResultRow): EvalElementSummary {
  const videoName = basename(row.video_path)
  const parsedOk = row.parsed_ok === null || row.parsed_ok === undefined ? null : Boolean(row.parsed_ok)
  return {
    id: row.id,
    kind: "video_eval_result",
    title: `${videoName} · ${row.provider}`,
    subtitle: `${row.status} / ${row.cache_status} / ${row.model}`,
    runId: row.run_id,
    createdAt: row.created_at,
    videoId: row.video_id,
    videoPath: row.video_path,
    provider: row.provider,
    model: row.model,
    status: row.status,
    cacheStatus: row.cache_status,
    stage: "video_understanding",
    version: row.request_hash.slice(0, 12),
    metrics: {
      latencyMs: nullableNumber(row.latency_ms),
      estimatedCostUsd: nullableNumber(row.estimated_cost_usd),
      avoidedCostUsd: nullableNumber(row.avoided_cost_usd),
      promptTokens: nullableNumber(row.prompt_tokens),
      completionTokens: nullableNumber(row.completion_tokens),
      totalTokens: nullableNumber(row.total_tokens),
      thoughtsTokens: nullableNumber(row.thoughts_tokens),
      rawCreditsConsumed: nullableNumber(row.raw_credits_consumed),
      finishReason: row.finish_reason ?? null,
      outputChars: nullableNumber(row.output_chars),
      parsedOk,
    },
    paths: {
      video: row.video_path,
      response: row.response_path ?? row.cache_path,
      parsed: parsedPathFor(row),
      cache: row.cache_path,
    },
  }
}

function parsedPathFor(row: Pick<EvalResultRow, "cache_path" | "parsed_path">): string | null {
  if (row.parsed_path) return row.parsed_path
  if (!row.cache_path.endsWith(".json")) return null
  const candidate = row.cache_path.replace(/\.json$/, ".parsed.json")
  return existsSync(candidate) ? candidate : null
}

function parseFrames(value: string): FrameRecord[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): FrameRecord[] => {
      if (!item || typeof item !== "object") return []
      const record = item as Partial<FrameRecord>
      if (typeof record.path !== "string" || typeof record.sha256 !== "string") return []
      return [{
        path: record.path,
        sha256: record.sha256,
        mimeType: typeof record.mimeType === "string" ? record.mimeType : "image/jpeg",
        timestampSeconds: typeof record.timestampSeconds === "number" ? record.timestampSeconds : 0,
        index: typeof record.index === "number" ? record.index : 0,
      }]
    })
  } catch {
    return []
  }
}

function readJsonFile(path: string | undefined): unknown {
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function readTextPreview(path: string | undefined, maxChars = 12000): string | undefined {
  if (!path || !existsSync(path)) return undefined
  try {
    const text = readFileSync(path, "utf8")
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text
  } catch {
    return undefined
  }
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
