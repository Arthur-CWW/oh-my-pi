export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface EvalRunRow {
  run_id: string
  created_at: string
  live: number
  providers_json: string
  videos_json: string
  video_count: number
  limit_count: number
  max_frames: number
  frame_every_seconds: number
  max_output_tokens?: number | null
  prompt_hash: string
  google_model?: string | null
  kie_model?: string | null
  out_dir: string
  cache_dir: string
  result_count?: number
  completed_count?: number
  cache_hit_count?: number
  failed_count?: number
  dry_run_count?: number
  billed_cost_usd?: number | null
  avoided_cost_usd?: number | null
  avg_latency_ms?: number | null
}

export interface EvalResultRow {
  id: string
  run_id: string
  created_at: string
  video_id: string
  video_path: string
  duration_seconds?: number | null
  width?: number | null
  height?: number | null
  frame_count: number
  frames_json: string
  provider: string
  model: string
  status: string
  request_hash: string
  cache_status: string
  cache_path: string
  response_path?: string | null
  parsed_path?: string | null
  error?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  thoughts_tokens?: number | null
  usage_json?: string | null
  latency_ms?: number | null
  estimated_cost_usd?: number | null
  avoided_cost_usd?: number | null
  raw_credits_consumed?: number | null
  finish_reason?: string | null
  output_chars?: number | null
  parsed_ok?: number | null
}

export interface FrameRecord {
  path: string
  sha256: string
  mimeType: string
  timestampSeconds: number
  index: number
  url?: string
}

export interface EvalElementSummary {
  id: string
  kind: "video_eval_result"
  title: string
  subtitle: string
  runId: string
  createdAt: string
  videoId: string
  videoPath: string
  provider: string
  model: string
  status: string
  cacheStatus: string
  stage: "video_understanding"
  version: string
  metrics: {
    latencyMs?: number | null
    estimatedCostUsd?: number | null
    avoidedCostUsd?: number | null
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    thoughtsTokens?: number | null
    rawCreditsConsumed?: number | null
    finishReason?: string | null
    outputChars?: number | null
    parsedOk?: boolean | null
  }
  paths: {
    video: string
    response?: string | null
    parsed?: string | null
    cache: string
  }
}

export interface EvalElementDetail extends EvalElementSummary {
  run?: EvalRunRow
  result: EvalResultRow
  frames: FrameRecord[]
  parsed: JsonValue | null
  rawPreview?: string
  sectionAnnotations: Record<string, AnnotationRecord>
}

export type AnnotationStatus = "untriaged" | "interesting" | "good" | "bad" | "needs_rerun" | "follow_up"
export type AnnotationRating = -2 | -1 | 0 | 1 | 2

export interface AnnotationWriteInput {
  targetId: string
  targetKind: string
  title?: string
  note: string
  tags: string[]
  status: AnnotationStatus
  rating: AnnotationRating
}

export interface AnnotationRecord extends AnnotationWriteInput {
  createdAt: string
  updatedAt: string
}

export interface AnnotationStore {
  schemaVersion: "slotok-workbench.annotations/v1"
  updatedAt: string
  annotations: Record<string, AnnotationRecord>
}

export interface BootstrapPayload {
  server: {
    cwd: string
    evalRoot: string
    sqlitePath: string
    annotationsPath: string
    startedAt: string
  }
  runs: EvalRunRow[]
  elements: EvalElementSummary[]
  annotations: Record<string, AnnotationRecord>
  shortcuts: Array<{ key: string; description: string }>
}

export interface ActionJobRequest {
  targetId: string
  targetKind: "video_eval_result"
  action: "rerun-video-eval"
  scope: "selected" | "descendants"
  provider?: string
  maxFrames?: number
  maxOutputTokens?: number
}

export interface ActionJob {
  id: string
  type: "rerun-video-eval"
  status: "queued" | "running" | "completed" | "failed"
  dryRun: true
  targetId: string
  targetKind: "video_eval_result"
  scope: "selected" | "descendants"
  createdAt: string
  updatedAt: string
  command: string[]
  cwd: string
  exitCode?: number | null
  stdout: string
  stderr: string
  outputDir?: string
  error?: string
}
