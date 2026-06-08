#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
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

const DEFAULT_PROMPT = `You are analyzing shortform AI/TikTok videos for a creative reverse-engineering archive.
Return compact JSON only. Do not include markdown.

Analyze the sampled keyframes and metadata. Focus on reusable structure, not copying identities.

Return this shape:
{
  "one_sentence_summary": string,
  "visual_tags": string[],
  "vibe_tags": string[],
  "format_family": string,
  "pacing": string,
  "scene_structure": string[],
  "probable_generation_workflow": string[],
  "model_or_tool_clues": string[],
  "audio_or_caption_notes": string,
  "reusable_recipe_notes": string,
  "confidence": number
}`

interface Args {
  videos: string[]
  providers: string[]
  limit: number
  maxFrames: number
  frameEverySeconds: number
  outDir: string
  prompt: string
  live: boolean
  force: boolean
  googleModel: string
  kieModel: string
  kieCreditUsd: number
}

interface VideoSample {
  inputPath: string
  id: string
  durationSeconds?: number
  width?: number
  height?: number
  frames: Array<{ path: string; sha256: string; base64: string; mimeType: string }>
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
  estimatedCostUsd?: number
  rawCreditsConsumed?: number
  raw?: unknown
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const outDir = resolve(args.outDir)
  const artifactsDir = join(outDir, "artifacts")
  const cacheDir = join(outDir, "cache")
  const logPath = join(outDir, "provider-run-log.jsonl")
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })

  const inputVideos = (await collectVideos(args.videos)).slice(0, args.limit)
  if (inputVideos.length === 0) {
    throw new Error("No input videos found. Pass files/directories after --videos or as positional args.")
  }

  const results: Array<{ video: string; sample: Omit<VideoSample, "frames"> & { frames: Array<Omit<VideoSample["frames"][number], "base64">> }; providers: ProviderResult[] }> = []

  for (const videoPath of inputVideos) {
    const sample = await prepareVideoSample(videoPath, artifactsDir, args)
    const providerResults: ProviderResult[] = []
    for (const provider of args.providers) {
      providerResults.push(await runProvider(provider, sample, args, cacheDir, logPath))
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

  const summary = summarize(results, args)
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2))
  await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    videos: [],
    providers: ["google", "kie"],
    limit: 3,
    maxFrames: 6,
    frameEverySeconds: 3,
    outDir: `data/provider-evals/video-understanding/${new Date().toISOString().replace(/[:.]/g, "-")}`,
    prompt: DEFAULT_PROMPT,
    live: false,
    force: false,
    googleModel: process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.5-flash",
    kieModel: process.env.KIE_GEMINI_MODEL ?? "gemini-2.5-flash",
    kieCreditUsd: Number(process.env.KIE_CREDIT_USD ?? "0.005"),
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
    } else if (arg === "--prompt-file" && next) {
      args.prompt = require("node:fs").readFileSync(next, "utf8")
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
  for (const framePath of frameFiles) {
    const bytes = await readFile(framePath)
    frames.push({ path: framePath, sha256: sha256(bytes), base64: bytes.toString("base64"), mimeType: "image/jpeg" })
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
    frames: sample.frames.map((frame) => ({ sha256: frame.sha256, mimeType: frame.mimeType })),
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
    return { provider, model, status: "cache_hit", requestHash, cachePath, raw: JSON.parse(await readFile(cachePath, "utf8")) }
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
    return { provider, model, status: "dry_run", requestHash, cachePath }
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

    return { provider, model, status: "completed", requestHash, cachePath, responsePath: cachePath, parsedPath, usage, estimatedCostUsd, rawCreditsConsumed }
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "video_understanding_tags",
        strict: false,
        schema: { type: "object" },
      },
    },
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
      sampledFrames: sample.frames.length,
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

function extractUsage(raw: unknown): Record<string, unknown> {
  const value = raw as any
  return value?.usageMetadata ?? value?.usage ?? {}
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

function summarize(results: Array<{ providers: ProviderResult[] }>, args: Args): Record<string, unknown> {
  const byProvider = new Map<string, { calls: number; completed: number; failed: number; cacheHits: number; dryRuns: number; estimatedCostUsd: number }>()
  for (const row of results) {
    for (const result of row.providers) {
      const key = `${result.provider}:${result.model}`
      const current = byProvider.get(key) ?? { calls: 0, completed: 0, failed: 0, cacheHits: 0, dryRuns: 0, estimatedCostUsd: 0 }
      current.calls += 1
      if (result.status === "completed") current.completed += 1
      if (result.status === "failed") current.failed += 1
      if (result.status === "cache_hit") current.cacheHits += 1
      if (result.status === "dry_run") current.dryRuns += 1
      current.estimatedCostUsd += result.estimatedCostUsd ?? 0
      byProvider.set(key, current)
    }
  }
  return {
    live: args.live,
    videos: results.length,
    providers: Object.fromEntries(byProvider),
    notes: args.live
      ? "Costs are estimated from provider usage/credits where available. Check provider dashboards for final billing."
      : "Dry run only; no provider calls made. Re-run with --live after setting keys.",
  }
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
