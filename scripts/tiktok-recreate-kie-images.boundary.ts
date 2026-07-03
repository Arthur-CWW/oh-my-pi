#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createKieTask,
  getKieTaskDetail,
  prepareKieTask,
  type KieGenerateRequest,
  type KiePreparedTask,
  type KieTaskDetail,
} from "../packages/ugc-cli/src/kie.ts"

const DEFAULT_MAX_PROMPTS = 3
const DEFAULT_MAX_SPEND_USD = 0.25
const DEFAULT_POLL_INTERVAL_SEC = 10
const DEFAULT_MAX_POLLS = 30
const OPERATION = "image-text" as const
const ASPECT_RATIO = "9:16" as const
const QUALITY = "basic" as const

interface Args {
  decomposition: string
  outDir: string
  manifest?: string
  maxPrompts: number
  live: boolean
  wait: boolean
  maxSpendUsd: number
  pollIntervalSec: number
  maxPolls: number
}

interface DecompositionJson {
  source_video_id?: string
  transcript?: unknown
  recreation_recipe?: {
    slide_visual_prompts?: string[]
  }
  format_decomposition?: {
    recreation_recipe?: {
      slide_visual_prompts?: string[]
    }
  }
  [key: string]: unknown
}

interface SourceManifestVideo {
  id?: string
  title?: string
  description?: string
  [key: string]: unknown
}

interface SourceManifest {
  videos?: SourceManifestVideo[]
  [key: string]: unknown
}

interface ImageJob {
  provider: "kie"
  lane: "image"
  jobId: string
  videoId: string
  videoTitle?: string
  videoDescription?: string
  slideIndex: number
  slideVisualPrompt: string
  prefixedPrompt: string
  negativePrompt: string
  operation: "image-text"
  aspectRatio: string
  quality: string
  prepared: KiePreparedTask
  preparedPayloadPath: string
  createResponsePath?: string
  taskId?: string
  pollDetail?: KieTaskDetail
  resultUrls: string[]
  resultPlatePaths: string[]
  state: "prepared" | "submitted" | "completed" | "failed" | "skipped"
  error?: string
}

interface RunManifest {
  schemaVersion: "tiktok-recreate.kie-images.v1"
  decompositionPath: string
  sourceManifestPath?: string
  outDir: string
  live: boolean
  wait: boolean
  maxSpendUsd: number
  totalEstimatedCostUsd: number
  pollIntervalSec: number
  maxPolls: number
  jobs: ImageJob[]
  summary: {
    total: number
    prepared: number
    submitted: number
    completed: number
    failed: number
    skipped: number
  }
}

const DOCUMENTARY_PREFIX = `Documentary finance short-form still image for editorial-style vertical video. Clean-room original asset: use public/reference material only as inspiration, never as direct generation input. Style: high-contrast black-and-white or muted archival documentary grade, cinematic, suitable for text overlay.`

const CLEAN_ROOM_SUFFIX = `Composition: vertical 9:16. No source creator likeness, no source faces, no source logos, no watermarks, no readable generated text, no copyrighted text, no brand marks, no identifiable private individuals.`

const NEGATIVE_PROMPT = `source creator likeness, source faces, source logos, watermarks, readable text, copyrighted text, brand marks, identifiable private individuals, low resolution, blurry, malformed anatomy`

function usage(): string {
  return `Usage: ${basename(fileURLToPath(import.meta.url))} --decomposition <path> --outDir <path> [options]

Turn a TikTok decomposition JSON into KIE text-to-image plate jobs.

Required:
  --decomposition <path>   Path to a single decomposition JSON.
  --outDir <path>          Directory to write manifest, requests, and plates.

Optional:
  --manifest <path>        Source manifest for video metadata enrichment.
  --maxPrompts <n>         Maximum slide prompts to process (default: ${DEFAULT_MAX_PROMPTS}).
  --live                   Submit prepared jobs to KIE (default dry-run).
  --wait                   Poll and download results when live (implies live).
  --maxSpendUsd <n>        Run-level spend cap in USD (default: ${DEFAULT_MAX_SPEND_USD}).
  --pollIntervalSec <n>    Seconds between polls when waiting (default: ${DEFAULT_POLL_INTERVAL_SEC}).
  --maxPolls <n>           Max polls per job when waiting (default: ${DEFAULT_MAX_POLLS}).

Environment:
  KIE_API_KEY              Required for --live. Read from process.env or .env if present.`
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const parsed: Partial<Args> = {
    maxPrompts: DEFAULT_MAX_PROMPTS,
    maxSpendUsd: DEFAULT_MAX_SPEND_USD,
    pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
    maxPolls: DEFAULT_MAX_POLLS,
  }

  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const next = (): string => {
      const value = args[++i]
      if (value === undefined) throw new Error(`Missing value for ${flag}`)
      return value
    }

    switch (flag) {
      case "--decomposition":
        parsed.decomposition = next()
        break
      case "--outDir":
        parsed.outDir = next()
        break
      case "--manifest":
        parsed.manifest = next()
        break
      case "--maxPrompts":
        parsed.maxPrompts = Number(next())
        break
      case "--maxSpendUsd":
        parsed.maxSpendUsd = Number(next())
        break
      case "--pollIntervalSec":
        parsed.pollIntervalSec = Number(next())
        break
      case "--maxPolls":
        parsed.maxPolls = Number(next())
        break
      case "--live":
        parsed.live = true
        break
      case "--wait":
        parsed.wait = true
        parsed.live = true
        break
      case "--help":
      case "-h":
        console.log(usage())
        process.exit(0)
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }

  if (!parsed.decomposition) throw new Error("Missing required --decomposition")
  if (!parsed.outDir) throw new Error("Missing required --outDir")
  if (Number.isNaN(parsed.maxPrompts) || parsed.maxPrompts < 1) throw new Error("--maxPrompts must be >= 1")
  if (Number.isNaN(parsed.maxSpendUsd) || parsed.maxSpendUsd < 0) throw new Error("--maxSpendUsd must be >= 0")
  if (Number.isNaN(parsed.pollIntervalSec) || parsed.pollIntervalSec < 1) throw new Error("--pollIntervalSec must be >= 1")
  if (Number.isNaN(parsed.maxPolls) || parsed.maxPolls < 1) throw new Error("--maxPolls must be >= 1")

  return parsed as Args
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf8")
  return JSON.parse(text) as T
}

async function readJsonOptional<T>(path: string | undefined): Promise<T | undefined> {
  if (!path) return undefined
  return readJson<T>(path)
}

function buildPrompt(slideVisualPrompt: string): string {
  return [DOCUMENTARY_PREFIX, slideVisualPrompt, CLEAN_ROOM_SUFFIX].filter(Boolean).join("\n\n")
}

function buildGenerateRequest(slideVisualPrompt: string): KieGenerateRequest {
  return {
    operation: OPERATION,
    prompt: buildPrompt(slideVisualPrompt),
    aspectRatio: ASPECT_RATIO,
    quality: QUALITY,
    negativePrompt: NEGATIVE_PROMPT,
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

async function downloadUrl(url: string, destPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, buffer)
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv)
  const outDir = resolve(args.outDir)
  const requestsDir = join(outDir, "requests")
  const responsesDir = join(outDir, "responses")
  const platesDir = join(outDir, "plates")

  const decomposition = await readJson<DecompositionJson>(resolve(args.decomposition))
  const sourceManifest = await readJsonOptional<SourceManifest>(args.manifest ? resolve(args.manifest) : undefined)

  const videoId = decomposition.source_video_id ?? basename(args.decomposition, extname(args.decomposition))
  const sourceVideo = sourceManifest?.videos?.find((video) => video.id === videoId)

  const rawPrompts =
    decomposition.recreation_recipe?.slide_visual_prompts ??
    decomposition.format_decomposition?.recreation_recipe?.slide_visual_prompts ??
    []
  const slidePrompts = rawPrompts.slice(0, args.maxPrompts)

  if (slidePrompts.length === 0) {
    console.error("No slide_visual_prompts found in decomposition.")
    process.exit(1)
  }

  await mkdir(requestsDir, { recursive: true })
  if (args.live) await mkdir(responsesDir, { recursive: true })
  if (args.wait) await mkdir(platesDir, { recursive: true })

  const jobs: ImageJob[] = slidePrompts.map((slideVisualPrompt, index) => {
    const request = buildGenerateRequest(slideVisualPrompt)
    const prepared = prepareKieTask(request)
    const jobId = `${videoId}_slide_${index}`
    return {
      provider: "kie",
      lane: "image",
      jobId,
      videoId,
      videoTitle: sourceVideo?.title,
      videoDescription: sourceVideo?.description,
      slideIndex: index,
      slideVisualPrompt,
      prefixedPrompt: request.prompt,
      negativePrompt: request.negativePrompt ?? "",
      operation: OPERATION,
      aspectRatio: ASPECT_RATIO,
      quality: QUALITY,
      prepared,
      preparedPayloadPath: join("requests", `${jobId}_request.json`),
      resultUrls: [],
      resultPlatePaths: [],
      state: "prepared",
    }
  })

  const totalEstimatedCostUsd = jobs.reduce((sum, job) => sum + job.prepared.estimatedCostUsd, 0)

  if (args.live && totalEstimatedCostUsd > args.maxSpendUsd) {
    throw new Error(
      `Run-level spend cap exceeded: ${jobs.length} jobs estimate $${totalEstimatedCostUsd.toFixed(2)}, cap is $${args.maxSpendUsd.toFixed(2)}.`
    )
  }

  await Promise.all(
    jobs.map(async (job) => {
      const payloadPath = join(outDir, job.preparedPayloadPath)
      await mkdir(dirname(payloadPath), { recursive: true })
      await writeFile(payloadPath, JSON.stringify(stripSecrets(job.prepared.payload), null, 2))
    })
  )

  if (args.live) {
    for (const job of jobs) {
      try {
        const result = await createKieTask(
          {
            operation: job.operation,
            prompt: job.prefixedPrompt,
            aspectRatio: job.aspectRatio,
            quality: job.quality,
            negativePrompt: job.negativePrompt,
          },
          { live: true, maxSpendUsd: args.maxSpendUsd }
        )
        job.state = "submitted"
        job.taskId = result.taskId
        job.createResponsePath = join("responses", `${job.jobId}_response.json`)
        if (result.response) {
          const responsePath = join(outDir, job.createResponsePath)
          await mkdir(dirname(responsePath), { recursive: true })
          await writeFile(responsePath, JSON.stringify(result.response, null, 2))
        }
      } catch (error) {
        job.state = "failed"
        job.error = error instanceof Error ? error.message : String(error)
      }
    }

    if (args.wait) {
      for (const job of jobs) {
        if (!job.taskId || job.state === "failed") continue
        try {
          const detail = await pollTask(job.taskId, args.pollIntervalSec, args.maxPolls)
          job.pollDetail = detail
          job.resultUrls = detail.resultUrls
          job.state = detail.resultUrls.length > 0 ? "completed" : "failed"
          if (job.state === "failed") {
            job.error = `Task finished without result URLs. State: ${detail.response.data?.state ?? "unknown"}`
          }
        } catch (error) {
          job.state = "failed"
          job.error = error instanceof Error ? error.message : String(error)
        }
      }

      for (const job of jobs) {
        if (job.state !== "completed") continue
        const jobPlateDir = join(platesDir, job.jobId)
        await mkdir(jobPlateDir, { recursive: true })
        for (let i = 0; i < job.resultUrls.length; i++) {
          const url = job.resultUrls[i]
          const ext = extname(new URL(url).pathname) || ".png"
          const destPath = join(jobPlateDir, `${i}${ext}`)
          try {
            await downloadUrl(url, destPath)
            job.resultPlatePaths.push(join("plates", job.jobId, `${i}${ext}`))
          } catch (error) {
            job.state = "failed"
            job.error = error instanceof Error ? error.message : String(error)
            break
          }
        }
      }
    }
  }

  const manifest: RunManifest = {
    schemaVersion: "tiktok-recreate.kie-images.v1",
    decompositionPath: resolve(args.decomposition),
    ...(args.manifest ? { sourceManifestPath: resolve(args.manifest) } : {}),
    outDir,
    live: args.live,
    wait: args.wait,
    maxSpendUsd: args.maxSpendUsd,
    totalEstimatedCostUsd,
    pollIntervalSec: args.pollIntervalSec,
    maxPolls: args.maxPolls,
    jobs: jobs.map((job) => stripSecretsFromJob(job)),
    summary: {
      total: jobs.length,
      prepared: jobs.filter((job) => ["prepared", "submitted", "completed"].includes(job.state)).length,
      submitted: jobs.filter((job) => job.state === "submitted" || job.state === "completed").length,
      completed: jobs.filter((job) => job.state === "completed").length,
      failed: jobs.filter((job) => job.state === "failed").length,
      skipped: jobs.filter((job) => job.state === "skipped").length,
    },
  }

  const manifestPath = join(outDir, "manifest.json")
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ manifestPath, summary: manifest.summary }, null, 2))
}

async function pollTask(taskId: string, intervalSec: number, maxPolls: number): Promise<KieTaskDetail> {
  for (let poll = 0; poll < maxPolls; poll++) {
    const detail = await getKieTaskDetail(taskId)
    const state = detail.response.data?.state
    if (state === "success") return detail
    if (state === "fail") throw new Error(`KIE task ${taskId} failed: ${detail.response.data?.failMsg ?? "unknown"}`)
    if (poll < maxPolls - 1) await sleep(intervalSec * 1000)
  }
  throw new Error(`KIE task ${taskId} did not complete within ${maxPolls} polls.`)
}

function stripSecrets(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(stripSecrets)
  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(record)) {
    if (/api[_-]?key|authorization|token|secret|password/i.test(key)) continue
    result[key] = stripSecrets(val)
  }
  return result
}

function stripSecretsFromJob(job: ImageJob): ImageJob {
  return {
    ...job,
    prepared: {
      ...job.prepared,
      payload: stripSecrets(job.prepared.payload) as KiePreparedTask["payload"],
    },
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
