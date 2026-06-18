import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import type { ActionJob, ActionJobRequest, AnnotationRecord, AnnotationStore, AnnotationWriteInput, BootstrapPayload, EvalElementDetail, EvalElementSummary, EvalResultRow, EvalRunRow, FrameRecord, JsonValue } from "../types"

type JsonRecord = { [key: string]: JsonValue }

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
      annotations: this.readAnnotations(),
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

  readAnnotations(): Record<string, AnnotationRecord> {
    return decodeAnnotationStore(readJsonFile(this.config.annotationsPath))?.annotations ?? {}
  }

  getAnnotation(key: string): AnnotationRecord | null {
    return this.readAnnotations()[key] ?? null
  }

  writeAnnotation(input: AnnotationWriteInput, key = annotationKey(input.targetKind, input.targetId)): { key: string; annotation: AnnotationRecord; annotations: Record<string, AnnotationRecord> } {
    const store = this.readAnnotationStore()
    const now = new Date().toISOString()
    const existing = store.annotations[key]
    const annotation: AnnotationRecord = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    store.annotations[key] = annotation
    const nextStore: AnnotationStore = {
      schemaVersion: "slotok-workbench.annotations/v1",
      updatedAt: now,
      annotations: store.annotations,
    }
    writeJsonFile(this.config.annotationsPath, nextStore)
    return { key, annotation, annotations: nextStore.annotations }
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
        sectionAnnotations: annotationsForTarget(this.readAnnotations(), result.id),
      }
    })
  }

  createDryRunActionJob(input: ActionJobRequest): ActionJob | null {
    if (!existsSync(this.config.sqlitePath)) return null
    return withDb(this.config.sqlitePath, (db) => {
      const result = db.query<EvalResultRow, [string]>("SELECT * FROM eval_results WHERE id = ? LIMIT 1").get(input.targetId)
      if (!result) return null
      const run = db.query<EvalRunRow, [string]>("SELECT * FROM eval_runs WHERE run_id = ? LIMIT 1").get(result.run_id) ?? undefined
      const provider = input.provider ?? result.provider
      const maxFrames = input.maxFrames ?? run?.max_frames ?? result.frame_count
      const normalized: JsonRecord = {
        action: input.action,
        targetId: input.targetId,
        targetKind: input.targetKind,
        scope: input.scope,
        provider,
        maxFrames,
      }
      const maxOutputTokens = input.maxOutputTokens ?? run?.max_output_tokens ?? undefined
      if (typeof maxOutputTokens === "number") normalized.maxOutputTokens = maxOutputTokens
      const id = `action_${sha256(stableStringify(normalized)).slice(0, 16)}`
      const outputDir = `data/provider-evals/video-understanding/reruns/${id}`
      const command = [
        "bun",
        "scripts/eval-video-understanding.ts",
        "--videos",
        result.video_path,
        "--providers",
        provider,
        "--limit",
        "1",
        "--max-frames",
        String(maxFrames),
        "--out",
        outputDir,
        "--cache-dir",
        run?.cache_dir ?? "data/provider-evals/video-understanding/cache",
        "--sqlite",
        this.config.sqlitePath,
      ]
      if (typeof maxOutputTokens === "number") {
        command.push("--max-output-tokens", String(maxOutputTokens))
      }
      const now = this.config.startedAt
      return {
        id,
        type: "rerun-video-eval",
        status: "completed",
        dryRun: true,
        targetId: input.targetId,
        targetKind: input.targetKind,
        scope: input.scope,
        createdAt: now,
        updatedAt: now,
        command,
        cwd: this.config.cwd,
        exitCode: 0,
        stdout: "Dry run only; provider command was planned but not executed.",
        stderr: "",
        outputDir,
      }
    })
  }

  private readAnnotationStore(): AnnotationStore {
    return decodeAnnotationStore(readJsonFile(this.config.annotationsPath)) ?? {
      schemaVersion: "slotok-workbench.annotations/v1",
      updatedAt: this.config.startedAt,
      annotations: {},
    }
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
    const parsed = JSON.parse(value) as JsonValue
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): FrameRecord[] => {
      if (!isRecord(item)) return []
      const record = item
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

function readJsonFile(path: string | undefined): JsonValue | null {
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonValue
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

function writeJsonFile(path: string, value: JsonValue | AnnotationStore): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  renameSync(tmpPath, path)
}

function annotationsForTarget(annotations: Record<string, AnnotationRecord>, targetId: string): Record<string, AnnotationRecord> {
  const matches: Record<string, AnnotationRecord> = {}
  for (const [key, annotation] of Object.entries(annotations)) {
    if (annotation.targetId === targetId) matches[key] = annotation
  }
  return matches
}

function annotationKey(targetKind: string, targetId: string): string {
  return `${targetKind}:${targetId}`
}

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function decodeAnnotationStore(value: JsonValue | null): AnnotationStore | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion !== "slotok-workbench.annotations/v1") return null
  if (typeof value.updatedAt !== "string") return null
  if (!isRecord(value.annotations)) return null
  const annotations: Record<string, AnnotationRecord> = {}
  for (const [key, rawAnnotation] of Object.entries(value.annotations)) {
    const annotation = decodeAnnotationRecord(rawAnnotation)
    if (!annotation) return null
    annotations[key] = annotation
  }
  return { schemaVersion: "slotok-workbench.annotations/v1", updatedAt: value.updatedAt, annotations }
}

function decodeAnnotationRecord(value: JsonValue): AnnotationRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.targetId !== "string") return null
  if (typeof value.targetKind !== "string") return null
  if (typeof value.note !== "string") return null
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) return null
  if (!isAnnotationStatus(value.status)) return null
  if (!isAnnotationRating(value.rating)) return null
  if (typeof value.createdAt !== "string") return null
  if (typeof value.updatedAt !== "string") return null
  const record: AnnotationRecord = {
    targetId: value.targetId,
    targetKind: value.targetKind,
    note: value.note,
    tags: value.tags,
    status: value.status,
    rating: value.rating,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
  if (typeof value.title === "string") record.title = value.title
  return record
}

function isAnnotationStatus(value: JsonValue | undefined): value is AnnotationRecord["status"] {
  return (
    value === "untriaged"
    || value === "interesting"
    || value === "good"
    || value === "bad"
    || value === "needs_rerun"
    || value === "follow_up"
  )
}

function isAnnotationRating(value: JsonValue | undefined): value is AnnotationRecord["rating"] {
  return value === -2 || value === -1 || value === 0 || value === 1 || value === 2
}

function isRecord(value: JsonValue | undefined | null): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
