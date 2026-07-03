#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { Database } from "bun:sqlite"
import { basename, dirname, extname, join, resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import {
  appendProviderRunLog,
  createProviderRunLogEntry,
  stableProviderRequestHash,
  type ProviderRunLogEntry,
} from "../packages/twitter-archive/src/provider-log"

const execFileAsync = promisify(execFile)

const GOOGLE_PRICE_USD_PER_M: Record<string, { input: number; output: number; cachedInput?: number }> = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cachedInput: 0.01 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cachedInput: 0.125 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cachedInput: 0.025 },
  "gemini-3.5-flash": { input: 1.5, output: 9, cachedInput: 0.15 },
}

const KIE_PRICE_USD_PER_M: Record<string, { input?: number; output?: number }> = {
  // Kie pricing page, captured 2026-06-08: Gemini 3.5 Flash input $0.45/M, output $2.70/M.
  "gemini-3-5-flash-openai": { input: 0.45, output: 2.7 },
  "gemini-3-5-flash": { input: 0.45, output: 2.7 },
}

const DEFAULT_PROMPT_FILE = "docs/prompts/pleometric-video-layer-decomposition.md"

const FALLBACK_PROMPT = `You are analyzing shortform AI/TikTok videos for a creative reveng archive.
Return compact JSON only. Decompose the sampled keyframes into subject/background/motion/editing/audio/post-processing layers, reconstruct plausible generation prompts and editing steps, and propose a clean-room original workflow recipe.`

interface Args {
  videos: string[]
  providers: string[]
  limit: number
  maxFrames: number
  frameEverySeconds: number
  outDir: string
  cacheDir: string
  sqlitePath: string
  prompt: string
  live: boolean
  force: boolean
  googleModel: string
  kieModel: string
  kieCreditUsd: number
  maxOutputTokens: number
}

interface VideoSample {
  inputPath: string
  id: string
  durationSeconds?: number
  width?: number
  height?: number
  frames: Array<{ path: string; sha256: string; base64: string; mimeType: string; timestampSeconds: number; index: number }>
}

interface ProviderResult {
  provider: string
  model: string
  status: "dry_run" | "cache_hit" | "completed" | "failed" | "skipped"
  requestHash: string
  cachePath: string
  responsePath?: string
  parsedPath?: string
  error?: string
  usage?: Record<string, unknown>
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  thoughtsTokens?: number
  latencyMs?: number
  estimatedCostUsd?: number
  avoidedCostUsd?: number
  rawCreditsConsumed?: number
  finishReason?: string
  outputChars?: number
  parsedOk?: boolean
  raw?: unknown
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const outDir = resolve(args.outDir)
  const artifactsDir = join(outDir, "artifacts")
  const cacheDir = resolve(args.cacheDir)
  const sqlitePath = resolve(args.sqlitePath)
  const logPath = join(outDir, "provider-run-log.jsonl")
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await mkdir(dirname(sqlitePath), { recursive: true })
  const runId = `run_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${sha256(JSON.stringify({ outDir, cacheDir, providers: args.providers, prompt: args.prompt })).slice(0, 10)}`
  const metricsDb = openMetricsDb(sqlitePath)

  const inputVideos = (await collectVideos(args.videos)).slice(0, args.limit)
  if (inputVideos.length === 0) {
    throw new Error("No input videos found. Pass files/directories after --videos or as positional args.")
  }

  insertEvalRun(metricsDb, runId, args, outDir, cacheDir, inputVideos.length)

  const results: Array<{ video: string; sample: Omit<VideoSample, "frames"> & { frames: Array<Omit<VideoSample["frames"][number], "base64">> }; providers: ProviderResult[] }> = []

  for (const videoPath of inputVideos) {
    const sample = await prepareVideoSample(videoPath, artifactsDir, args)
    const providerResults: ProviderResult[] = []
    for (const provider of args.providers) {
      const providerResult = await runProvider(provider, sample, args, cacheDir, logPath)
      providerResults.push(providerResult)
      insertEvalResult(metricsDb, runId, sample, providerResult)
    }
    results.push({
      video: videoPath,
      sample: {
        inputPath: sample.inputPath,
        id: sample.id,
        durationSeconds: sample.durationSeconds,
        width: sample.width,
        height: sample.height,
        frames: sample.frames.map(({ base64: _base64, ...frame }) => frame),
      },
      providers: providerResults,
    })
  }

  const summary = summarize(results, args, { runId, outDir, cacheDir, sqlitePath })
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2))
  await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2))
  metricsDb.close()
  console.log(JSON.stringify(summary, null, 2))
}

function loadDefaultPrompt(): string {
  if (existsSync(DEFAULT_PROMPT_FILE)) {
    return readFileSync(DEFAULT_PROMPT_FILE, "utf8")
  }
  return FALLBACK_PROMPT
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    videos: [],
    providers: ["google", "kie"],
    limit: 3,
    maxFrames: 6,
    frameEverySeconds: 3,
    outDir: `data/provider-evals/video-understanding/runs/${new Date().toISOString().replace(/[:.]/g, "-")}`,
    cacheDir: process.env.VIDEO_EVAL_CACHE_DIR ?? "data/provider-evals/video-understanding/cache",
    sqlitePath: process.env.VIDEO_EVAL_SQLITE ?? "data/provider-evals/video-understanding/evals.sqlite",
    prompt: loadDefaultPrompt(),
    live: false,
    force: false,
    googleModel: process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.5-flash",
    kieModel: process.env.KIE_GEMINI_MODEL ?? "gemini-2.5-flash",
    kieCreditUsd: Number(process.env.KIE_CREDIT_USD ?? "0.005"),
    maxOutputTokens: Number(process.env.VIDEO_EVAL_MAX_OUTPUT_TOKENS ?? "4096"),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === "--videos" && next) {
      args.videos.push(...next.split(",").filter(Boolean))
      index += 1
    } else if (arg === "--providers" && next) {
      args.providers = next.split(",").map((item) => item.trim()).filter(Boolean)
      index += 1
    } else if (arg === "--limit" && next) {
      args.limit = Number(next)
      index += 1
    } else if (arg === "--max-frames" && next) {
      args.maxFrames = Number(next)
      index += 1
    } else if (arg === "--frame-every" && next) {
      args.frameEverySeconds = Number(next)
      index += 1
    } else if (arg === "--out" && next) {
      args.outDir = next
      index += 1
    } else if (arg === "--cache-dir" && next) {
      args.cacheDir = next
      index += 1
    } else if (arg === "--sqlite" && next) {
      args.sqlitePath = next
      index += 1
    } else if (arg === "--prompt-file" && next) {
      args.prompt = readFileSync(next, "utf8")
      index += 1
    } else if (arg === "--google-model" && next) {
      args.googleModel = next
      index += 1
    } else if (arg === "--kie-model" && next) {
      args.kieModel = next
      index += 1
    } else if (arg === "--kie-credit-usd" && next) {
      args.kieCreditUsd = Number(next)
      index += 1
    } else if (arg === "--max-output-tokens" && next) {
      args.maxOutputTokens = Number(next)
      index += 1
    } else if (arg === "--live") {
      args.live = true
    } else if (arg === "--force") {
      args.force = true
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`)
    } else {
      args.videos.push(arg)
    }
  }

  if (args.videos.length === 0) {
    args.videos = ["data/tiktok-catalogue/pleometric"]
  }

  return args
}

async function collectVideos(inputs: string[]): Promise<string[]> {
  const out: string[] = []
  for (const input of inputs) {
    const path = resolve(input)
    if (!existsSync(path)) {
      continue
    }
    const info = await stat(path)
    if (info.isDirectory()) {
      for (const child of await walk(path)) {
        if (isVideoPath(child)) out.push(child)
      }
    } else if (isVideoPath(path)) {
      out.push(path)
    }
  }
  return out.sort()
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(path)))
    } else {
      files.push(path)
    }
  }
  return files
}

function isVideoPath(path: string): boolean {
  return [".mp4", ".mov", ".m4v", ".webm"].includes(extname(path).toLowerCase())
}

async function prepareVideoSample(videoPath: string, artifactsDir: string, args: Args): Promise<VideoSample> {
  const fileBytes = await readFile(videoPath)
  const fileHash = sha256(fileBytes).slice(0, 16)
  const id = `${basename(videoPath, extname(videoPath)).replace(/[^a-zA-Z0-9_.-]/g, "_")}_${fileHash}`
  const sampleDir = join(artifactsDir, id)
  await mkdir(sampleDir, { recursive: true })

  const metadata = await ffprobe(videoPath).catch(() => ({} as Record<string, unknown>))
  const durationSeconds = Number((metadata.format as { duration?: string } | undefined)?.duration)
  const videoStream = ((metadata.streams as Array<Record<string, unknown>> | undefined) ?? []).find(
    (stream) => stream.codec_type === "video",
  )

  const framePattern = join(sampleDir, "frame_%03d.jpg")
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=1/${args.frameEverySeconds},scale=640:-1`,
    "-frames:v",
    String(args.maxFrames),
    framePattern,
  ])

  const frameFiles = (await readdir(sampleDir))
    .filter((name) => name.endsWith(".jpg"))
    .sort()
    .map((name) => join(sampleDir, name))

  const frames = []
  for (const [index, framePath] of frameFiles.entries()) {
    const bytes = await readFile(framePath)
    frames.push({
      path: framePath,
      sha256: sha256(bytes),
      base64: bytes.toString("base64"),
      mimeType: "image/jpeg",
      timestampSeconds: index * args.frameEverySeconds,
      index,
    })
  }

  await writeFile(join(sampleDir, "metadata.json"), JSON.stringify(metadata, null, 2))

  return {
    inputPath: videoPath,
    id,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
    width: typeof videoStream?.width === "number" ? videoStream.width : undefined,
    height: typeof videoStream?.height === "number" ? videoStream.height : undefined,
    frames,
  }
}

async function ffprobe(videoPath: string): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", videoPath])
  return JSON.parse(stdout)
}

async function runProvider(
  provider: string,
  sample: VideoSample,
  args: Args,
  cacheDir: string,
  logPath: string,
): Promise<ProviderResult> {
  const model = provider === "google" ? args.googleModel : provider === "kie" ? args.kieModel : provider
  const requestDescriptor = {
    provider,
    model,
    prompt: args.prompt,
    video: { path: sample.inputPath, id: sample.id, durationSeconds: sample.durationSeconds, width: sample.width, height: sample.height },
    frames: sample.frames.map((frame) => ({ sha256: frame.sha256, mimeType: frame.mimeType, timestampSeconds: frame.timestampSeconds, index: frame.index })),
    maxOutputTokens: args.maxOutputTokens,
  }
  const requestHash = stableProviderRequestHash(requestDescriptor)
  const providerCacheDir = join(cacheDir, provider)
  await mkdir(providerCacheDir, { recursive: true })
  const cachePath = join(providerCacheDir, `${requestHash}.json`)

  if (!args.force && existsSync(cachePath)) {
    await logProvider(logPath, {
      task: "video-understanding-eval",
      provider,
      model,
      modality: "video-keyframes->text",
      status: "cache_hit",
      requestHash,
      cache: { status: "hit", key: cachePath },
      inputArtifactPaths: [sample.inputPath, ...sample.frames.map((frame) => frame.path)],
    })
    const raw = JSON.parse(await readFile(cachePath, "utf8"))
    const usage = extractUsage(raw)
    const tokenUsage = normalizeUsage(usage)
    const avoidedCostUsd = estimateCostUsd(provider, model, usage, raw, args)
    const analysisText = extractAnalysisText(raw)
    const parsed = tryParseJsonObject(analysisText)
    return { provider, model, status: "cache_hit", requestHash, cachePath, raw, usage, ...tokenUsage, latencyMs: 0, estimatedCostUsd: 0, avoidedCostUsd, rawCreditsConsumed: extractCreditsConsumed(raw), finishReason: extractFinishReason(raw), outputChars: analysisText.length, parsedOk: isUsefulParsedObject(parsed) }
  }

  await logProvider(logPath, {
    task: "video-understanding-eval",
    provider,
    model,
    modality: "video-keyframes->text",
    status: "cache_miss",
    requestHash,
    cache: { status: "miss", key: cachePath },
    inputArtifactPaths: [sample.inputPath, ...sample.frames.map((frame) => frame.path)],
  })

  if (!args.live) {
    return { provider, model, status: "dry_run", requestHash, cachePath, latencyMs: 0 }
  }

  try {
    const started = Date.now()
    const raw = provider === "google" ? await callGoogle(sample, args) : provider === "kie" ? await callKie(sample, args) : (() => { throw new Error(`Unsupported provider: ${provider}`) })()
    const elapsedMs = Date.now() - started
    await writeFile(cachePath, JSON.stringify(raw, null, 2))
    const analysisText = extractAnalysisText(raw)
    const parsed = tryParseJsonObject(analysisText)
    const parsedPath = cachePath.replace(/\.json$/, ".parsed.json")
    await writeFile(parsedPath, JSON.stringify(parsed ?? { rawText: analysisText }, null, 2))
    const usage = extractUsage(raw)
    const tokenUsage = normalizeUsage(usage)
    const estimatedCostUsd = estimateCostUsd(provider, model, usage, raw, args)
    const rawCreditsConsumed = extractCreditsConsumed(raw)

    await logProvider(logPath, {
      task: "video-understanding-eval",
      provider,
      model,
      modality: "video-keyframes->text",
      status: "completed",
      requestHash,
      cache: { status: "write", key: cachePath },
      pricing: { estimatedCostUsd, rawPricing: { usage, rawCreditsConsumed, elapsedMs } },
      inputArtifactPaths: [sample.inputPath, ...sample.frames.map((frame) => frame.path)],
      outputArtifactPaths: [cachePath, parsedPath],
    })

    return { provider, model, status: "completed", requestHash, cachePath, responsePath: cachePath, parsedPath, usage, ...tokenUsage, latencyMs: elapsedMs, estimatedCostUsd, rawCreditsConsumed, finishReason: extractFinishReason(raw), outputChars: analysisText.length, parsedOk: isUsefulParsedObject(parsed) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logProvider(logPath, {
      task: "video-understanding-eval",
      provider,
      model,
      modality: "video-keyframes->text",
      status: "failed",
      requestHash,
      cache: { status: "miss", key: cachePath },
      inputArtifactPaths: [sample.inputPath, ...sample.frames.map((frame) => frame.path)],
      error: { message },
    })
    return { provider, model, status: "failed", requestHash, cachePath, error: message }
  }
}

async function callGoogle(sample: VideoSample, args: Args): Promise<unknown> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("Missing GOOGLE_API_KEY or GEMINI_API_KEY")
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt(sample, args) },
          ...sample.frames.map((frame) => ({ inlineData: { mimeType: frame.mimeType, data: frame.base64 } })),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      maxOutputTokens: args.maxOutputTokens,
    },
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.googleModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  )
  return readJsonOrThrow(response)
}

async function callKie(sample: VideoSample, args: Args): Promise<unknown> {
  const apiKey = process.env.KIE_API_KEY
  if (!apiKey) throw new Error("Missing KIE_API_KEY")
  const content = [
    { type: "text", text: buildPrompt(sample, args) },
    ...sample.frames.map((frame) => ({ type: "image_url", image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` } })),
  ]
  const body = {
    messages: [{ role: "user", content }],
    stream: false,
    temperature: 0.2,
    max_tokens: args.maxOutputTokens,
  }
  const response = await fetch(`https://api.kie.ai/${args.kieModel}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return readJsonOrThrow(response)
}

async function readJsonOrThrow(response: Response): Promise<unknown> {
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { rawText: text }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(parsed).slice(0, 1500)}`)
  }
  return parsed
}

function buildPrompt(sample: VideoSample, args: Args): string {
  return `${args.prompt}\n\nVideo metadata:\n${JSON.stringify(
    {
      file: basename(sample.inputPath),
      durationSeconds: sample.durationSeconds,
      width: sample.width,
      height: sample.height,
      sampledFrames: sample.frames.map((frame) => ({ index: frame.index, timestampSeconds: frame.timestampSeconds, sha256: frame.sha256 })),
    },
    null,
    2,
  )}`
}

function extractAnalysisText(raw: unknown): string {
  const value = raw as any
  const googleText = value?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).filter(Boolean).join("\n")
  if (googleText) return googleText
  const openAiText = value?.choices?.[0]?.message?.content
  if (typeof openAiText === "string") return openAiText
  if (Array.isArray(openAiText)) return openAiText.map((part: any) => part.text ?? part.content ?? "").join("\n")
  return JSON.stringify(raw)
}

function tryParseJsonObject(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return undefined
    try {
      return JSON.parse(match[0])
    } catch {
      return undefined
    }
  }
}

function isUsefulParsedObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.keys(value as Record<string, unknown>).length > 0
}

function extractFinishReason(raw: unknown): string | undefined {
  const value = raw as any
  return value?.candidates?.[0]?.finishReason ?? value?.choices?.[0]?.finish_reason
}

function extractUsage(raw: unknown): Record<string, unknown> {
  const value = raw as any
  return value?.usageMetadata ?? value?.usage ?? {}
}

function normalizeUsage(usage: Record<string, unknown>): {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  thoughtsTokens?: number
} {
  const promptTokens = asNumber(usage.promptTokenCount ?? usage.prompt_tokens)
  const completionTokens = asNumber(usage.candidatesTokenCount ?? usage.completion_tokens)
  const totalTokens = asNumber(usage.totalTokenCount ?? usage.total_tokens)
  const thoughtsTokens = asNumber(usage.thoughtsTokenCount ?? usage.thoughts_tokens)
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(thoughtsTokens !== undefined ? { thoughtsTokens } : {}),
  }
}

function asNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function extractCreditsConsumed(raw: unknown): number | undefined {
  const value = raw as any
  const credits = value?.credits_consumed ?? value?.creditsConsumed
  return typeof credits === "number" ? credits : undefined
}

function estimateCostUsd(provider: string, model: string, usage: Record<string, unknown>, raw: unknown, args: Args): number | undefined {
  const promptTokens = Number(usage.promptTokenCount ?? usage.prompt_tokens ?? 0)
  const completionTokens = Number(usage.candidatesTokenCount ?? usage.completion_tokens ?? 0)
  const credits = extractCreditsConsumed(raw)
  if (provider === "kie" && typeof credits === "number") {
    return credits * args.kieCreditUsd
  }
  const price = provider === "google" ? GOOGLE_PRICE_USD_PER_M[model] : provider === "kie" ? KIE_PRICE_USD_PER_M[model] : undefined
  if (!price) return undefined
  return ((promptTokens * (price.input ?? 0)) + (completionTokens * (price.output ?? 0))) / 1_000_000
}

async function logProvider(logPath: string, input: Omit<ProviderRunLogEntry, "id" | "createdAt">): Promise<void> {
  await appendProviderRunLog(logPath, createProviderRunLogEntry(input))
}

function summarize(
  results: Array<{ providers: ProviderResult[] }>,
  args: Args,
  runInfo: { runId: string; outDir: string; cacheDir: string; sqlitePath: string },
): Record<string, unknown> {
  const byProvider = new Map<string, { calls: number; completed: number; failed: number; cacheHits: number; dryRuns: number; estimatedCostUsd: number; avoidedCostUsd: number; totalLatencyMs: number; avgLatencyMs: number; completedPerMinute: number }>()
  for (const row of results) {
    for (const result of row.providers) {
      const key = `${result.provider}:${result.model}`
      const current = byProvider.get(key) ?? { calls: 0, completed: 0, failed: 0, cacheHits: 0, dryRuns: 0, estimatedCostUsd: 0, avoidedCostUsd: 0, totalLatencyMs: 0, avgLatencyMs: 0, completedPerMinute: 0 }
      current.calls += 1
      if (result.status === "completed") current.completed += 1
      if (result.status === "failed") current.failed += 1
      if (result.status === "cache_hit") current.cacheHits += 1
      if (result.status === "dry_run") current.dryRuns += 1
      current.estimatedCostUsd += result.estimatedCostUsd ?? 0
      current.avoidedCostUsd += result.avoidedCostUsd ?? 0
      current.totalLatencyMs += result.latencyMs ?? 0
      current.avgLatencyMs = current.completed > 0 ? current.totalLatencyMs / current.completed : 0
      current.completedPerMinute = current.totalLatencyMs > 0 ? current.completed / (current.totalLatencyMs / 60000) : 0
      byProvider.set(key, current)
    }
  }
  return {
    live: args.live,
    runId: runInfo.runId,
    outDir: runInfo.outDir,
    cacheDir: runInfo.cacheDir,
    sqlitePath: runInfo.sqlitePath,
    videos: results.length,
    providers: Object.fromEntries(byProvider),
    notes: args.live
      ? "Costs are estimated from provider usage/credits where available. Check provider dashboards for final billing."
      : "Dry run only; no provider calls made. Re-run with --live after setting keys.",
  }
}

function openMetricsDb(sqlitePath: string): Database {
  const db = new Database(sqlitePath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS eval_runs (
      run_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      live INTEGER NOT NULL,
      providers_json TEXT NOT NULL,
      videos_json TEXT NOT NULL,
      video_count INTEGER NOT NULL,
      limit_count INTEGER NOT NULL,
      max_frames INTEGER NOT NULL,
      frame_every_seconds REAL NOT NULL,
      max_output_tokens INTEGER,
      prompt_hash TEXT NOT NULL,
      google_model TEXT,
      kie_model TEXT,
      out_dir TEXT NOT NULL,
      cache_dir TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      duration_seconds REAL,
      width INTEGER,
      height INTEGER,
      frame_count INTEGER NOT NULL,
      frames_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      cache_status TEXT NOT NULL,
      cache_path TEXT NOT NULL,
      response_path TEXT,
      parsed_path TEXT,
      error TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      thoughts_tokens INTEGER,
      usage_json TEXT,
      latency_ms REAL,
      estimated_cost_usd REAL,
      avoided_cost_usd REAL,
      raw_credits_consumed REAL,
      finish_reason TEXT,
      output_chars INTEGER,
      parsed_ok INTEGER,
      FOREIGN KEY(run_id) REFERENCES eval_runs(run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eval_results_run_provider ON eval_results(run_id, provider, model);
    CREATE INDEX IF NOT EXISTS idx_eval_results_request_hash ON eval_results(request_hash);
    CREATE INDEX IF NOT EXISTS idx_eval_results_video ON eval_results(video_id);
  `)
  ensureColumn(db, "eval_runs", "max_output_tokens", "INTEGER")
  ensureColumn(db, "eval_results", "avoided_cost_usd", "REAL")
  ensureColumn(db, "eval_results", "finish_reason", "TEXT")
  ensureColumn(db, "eval_results", "output_chars", "INTEGER")
  ensureColumn(db, "eval_results", "parsed_ok", "INTEGER")
  return db
}

function ensureColumn(db: Database, tableName: string, columnName: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  if (rows.some((row) => row.name === columnName)) {
    return
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
}

function insertEvalRun(
  db: Database,
  runId: string,
  args: Args,
  outDir: string,
  cacheDir: string,
  videoCount: number,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO eval_runs (
      run_id, created_at, live, providers_json, videos_json, video_count, limit_count,
      max_frames, frame_every_seconds, max_output_tokens, prompt_hash, google_model, kie_model, out_dir, cache_dir
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    new Date().toISOString(),
    args.live ? 1 : 0,
    JSON.stringify(args.providers),
    JSON.stringify(args.videos),
    videoCount,
    args.limit,
    args.maxFrames,
    args.frameEverySeconds,
    args.maxOutputTokens,
    sha256(args.prompt),
    args.googleModel,
    args.kieModel,
    outDir,
    cacheDir,
  )
}

function insertEvalResult(db: Database, runId: string, sample: VideoSample, result: ProviderResult): void {
  const id = sha256([runId, sample.id, result.provider, result.model, result.requestHash, result.status].join("\u001f"))
  const cacheStatus = result.status === "cache_hit" ? "hit" : result.status === "dry_run" ? "miss_dry_run" : result.status === "completed" ? "write" : "miss_failed"
  db.prepare(`
    INSERT OR REPLACE INTO eval_results (
      id, run_id, created_at, video_id, video_path, duration_seconds, width, height,
      frame_count, frames_json, provider, model, status, request_hash, cache_status,
      cache_path, response_path, parsed_path, error, prompt_tokens, completion_tokens,
      total_tokens, thoughts_tokens, usage_json, latency_ms, estimated_cost_usd,
      avoided_cost_usd, raw_credits_consumed, finish_reason, output_chars, parsed_ok
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    runId,
    new Date().toISOString(),
    sample.id,
    sample.inputPath,
    sample.durationSeconds ?? null,
    sample.width ?? null,
    sample.height ?? null,
    sample.frames.length,
    JSON.stringify(sample.frames.map(({ base64: _base64, ...frame }) => frame)),
    result.provider,
    result.model,
    result.status,
    result.requestHash,
    cacheStatus,
    result.cachePath,
    result.responsePath ?? null,
    result.parsedPath ?? null,
    result.error ?? null,
    result.promptTokens ?? null,
    result.completionTokens ?? null,
    result.totalTokens ?? null,
    result.thoughtsTokens ?? null,
    result.usage ? JSON.stringify(result.usage) : null,
    result.latencyMs ?? null,
    result.estimatedCostUsd ?? null,
    result.avoidedCostUsd ?? null,
    result.rawCreditsConsumed ?? null,
    result.finishReason ?? null,
    result.outputChars ?? null,
    result.parsedOk === undefined ? null : result.parsedOk ? 1 : 0,
  )
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
