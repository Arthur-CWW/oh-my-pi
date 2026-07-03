#!/usr/bin/env bun
/**
 * TikTok recreation MiniMax TTS boundary.
 *
 * Reads a decomposition JSON, extracts the clean transcript, and generates
 * synthetic narration audio via MiniMax T2A v2 over HTTP.
 *
 * Usage:
 *   bun scripts/tiktok-recreate-tts.boundary.ts \
 *     --decomposition data/video-recreation/.../2026-05-20_7641985194186001678.json \
 *     --outDir data/video-recreation/.../audio \
 *     [--manifest data/video-recreation/.../manifest.json] \
 *     [--voice male-qn-qingse] \
 *     [--model speech-2.8-hd] \
 *     [--language en] \
 *     [--dry-run] \
 *     [--timeoutSec 90]
 */
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_ENDPOINT = "https://api.minimax.io/v1/t2a_v2"
const DEFAULT_MODEL = "speech-2.8-hd"
const DEFAULT_VOICE = "male-qn-qingse"
const DEFAULT_LANGUAGE = "en"
const DEFAULT_TIMEOUT_SEC = 90

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/hsk-deck/.env")

const ENV_KEYS = [
  "MINIMAX_API_KEY_2",
  "MINIMAX_API_KEY",
  "MINIMAX_API_MODEL",
  "MINIMAX_API_T2A_URL",
  "MINIMAX_TTS_VOICE_ID",
] as const

type EnvKey = (typeof ENV_KEYS)[number]

interface Args {
  decomposition: string
  outDir: string
  manifest?: string
  voice?: string
  model?: string
  language: string
  dryRun: boolean
  timeoutSec: number
}

interface DecompositionFile {
  source_video_id?: string
  transcript?: {
    verbatim_or_vtt_cleaned?: string
  }
}

interface ManifestFile {
  videos?: Array<{
    id: string
  }>
}

interface TtsManifest {
  schemaVersion: "tiktok-recreate.tts.v1"
  videoId: string
  transcriptLength: number
  textHash: string
  model: string
  voice: string
  language: string
  endpoint: string
  dryRun: boolean
  audioPaths?: {
    mp3: string
    responseJson: string
  }
  durationMs?: number
  byteSize?: number
  sampleRate?: number
  bitrate?: number
  usageCharacters?: number
  traceId?: string
  statusCode: number
  statusMsg: string
  generatedAt: string
}

interface MiniMaxT2aRequest {
  model: string
  text: string
  stream: false
  language_boost: string
  output_format: "hex"
  voice_setting: {
    voice_id: string
    speed: number
    vol: number
    pitch: number
  }
  audio_setting: {
    sample_rate: number
    bitrate: number
    format: "mp3"
    channel: number
  }
}

interface MiniMaxT2aResponse {
  data?: {
    audio?: string
    status?: number
  } | null
  extra_info?: {
    audio_length?: number
    audio_sample_rate?: number
    audio_size?: number
    bitrate?: number
    word_count?: number
    usage_characters?: number
    audio_format?: string
    audio_channel?: number
  }
  trace_id?: string
  base_resp?: {
    status_code: number
    status_msg: string
  }
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  validateArgs(args)

  const env = loadEnv()
  const decomposition = readJsonFile<DecompositionFile>(args.decomposition, "decomposition")
  const videoId = resolveVideoId(args, decomposition)
  const transcript = decomposition.transcript?.verbatim_or_vtt_cleaned?.trim()

  if (!transcript) {
    throw new Error(`Missing or empty decomposition.transcript.verbatim_or_vtt_cleaned in ${args.decomposition}`)
  }

  const config = {
    apiKey: env.MINIMAX_API_KEY_2 || env.MINIMAX_API_KEY,
    endpoint: env.MINIMAX_API_T2A_URL || DEFAULT_ENDPOINT,
    model: args.model || env.MINIMAX_API_MODEL || DEFAULT_MODEL,
    voice: args.voice || env.MINIMAX_TTS_VOICE_ID || DEFAULT_VOICE,
    language: args.language,
  }
  const videoOutDir = join(resolve(args.outDir), videoId)
  const audioDir = join(videoOutDir, "audio")
  mkdirSync(audioDir, { recursive: true })

  const textHash = createHash("sha256").update(transcript).digest("hex")
  const mp3Path = join(audioDir, "narration.mp3")
  const responsePath = join(audioDir, "narration.response.json")
  const manifestPath = join(videoOutDir, "tts-manifest.json")

  const languageBoost = config.language

  const request: MiniMaxT2aRequest = {
    model: config.model,
    text: transcript,
    stream: false,
    language_boost: languageBoost,
    output_format: "hex",
    voice_setting: {
      voice_id: config.voice,
      speed: 1,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1,
    },
  }

  if (args.dryRun) {
    const dryRunResponse: MiniMaxT2aResponse = {
      data: null,
      extra_info: {
        audio_length: 0,
        audio_sample_rate: 32000,
        audio_size: 0,
        bitrate: 128000,
        word_count: 0,
        usage_characters: 0,
        audio_format: "mp3",
        audio_channel: 1,
      },
      trace_id: `dry-run-${randomUUID()}`,
      base_resp: { status_code: 0, status_msg: "dry-run" },
    }

    writeJson(responsePath, redactAudio(dryRunResponse))
    writeJson(manifestPath, buildManifest({
      args,
      videoId,
      transcript,
      textHash,
      config,
      response: dryRunResponse,
      mp3Path,
      responsePath,
      dryRun: true,
    }))
    writeJson(join(videoOutDir, "tts-request.json"), request)

    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      videoId,
      manifest: manifestPath,
      request: request,
    }, null, 2))
    return
  }

  if (!config.apiKey) {
    throw new Error(
      "MiniMax API key is required for live mode. " +
      "Set MINIMAX_API_KEY (or MINIMAX_API_KEY_2) in the environment or in apps/hsk-deck/.env.",
    )
  }

  const response = await generateAudio({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    request,
    timeoutSec: args.timeoutSec,
  })

  const baseResp = response.base_resp ?? { status_code: -1, status_msg: "missing base_resp" }

  if (baseResp.status_code === 2056) {
    throw new Error(`MiniMax usage exceeded (status_code 2056): ${baseResp.status_msg}`)
  }

  if (baseResp.status_code !== 0) {
    throw new Error(`MiniMax T2A failed (status_code ${baseResp.status_code}): ${baseResp.status_msg}`)
  }

  const audioHex = response.data?.audio
  if (!audioHex) {
    throw new Error("MiniMax T2A response did not include data.audio")
  }

  const audioBuffer = Buffer.from(audioHex, "hex")
  if (audioBuffer.length === 0) {
    throw new Error("MiniMax T2A returned empty audio buffer")
  }

  writeFileSync(mp3Path, audioBuffer)
  writeJson(responsePath, redactAudio(response))

  const manifest = buildManifest({
    args,
    videoId,
    transcript,
    textHash,
    config,
    response,
    mp3Path,
    responsePath,
    dryRun: false,
  })
  writeJson(manifestPath, manifest)

  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    videoId,
    manifest: manifestPath,
    mp3: mp3Path,
    responseJson: responsePath,
    durationMs: manifest.durationMs,
    byteSize: manifest.byteSize,
    usageCharacters: manifest.usageCharacters,
    traceId: manifest.traceId,
    statusCode: manifest.statusCode,
  }, null, 2))
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    decomposition: "",
    outDir: "",
    language: DEFAULT_LANGUAGE,
    dryRun: false,
    timeoutSec: DEFAULT_TIMEOUT_SEC,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    const next = argv[i + 1]

    switch (current) {
      case "--decomposition":
        if (!next) throw new Error("--decomposition requires a value")
        args.decomposition = next
        i += 1
        break
      case "--outDir":
        if (!next) throw new Error("--outDir requires a value")
        args.outDir = next
        i += 1
        break
      case "--manifest":
        if (!next) throw new Error("--manifest requires a value")
        args.manifest = next
        i += 1
        break
      case "--voice":
        if (!next) throw new Error("--voice requires a value")
        args.voice = next
        i += 1
        break
      case "--model":
        if (!next) throw new Error("--model requires a value")
        args.model = next
        i += 1
        break
      case "--language":
        if (!next) throw new Error("--language requires a value")
        args.language = next
        i += 1
        break
      case "--timeoutSec":
        if (!next) throw new Error("--timeoutSec requires a value")
        args.timeoutSec = Number(next)
        if (!Number.isFinite(args.timeoutSec) || args.timeoutSec < 1) {
          throw new Error("--timeoutSec must be a positive number")
        }
        i += 1
        break
      case "--dry-run":
        args.dryRun = true
        break
      case "--help":
      case "-h":
        console.log(usageText())
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${current}`)
    }
  }

  return args
}

function validateArgs(args: Args): void {
  if (!args.decomposition) {
    throw new Error("--decomposition is required")
  }
  if (!args.outDir) {
    throw new Error("--outDir is required")
  }
}

function usageText(): string {
  return `
Generate synthetic narration audio for a TikTok recreation using MiniMax T2A v2.

Usage:
  bun scripts/tiktok-recreate-tts.boundary.ts --decomposition <path> --outDir <path> [options]

Required:
  --decomposition <path>   Path to the Antigravity decomposition JSON.
  --outDir <path>          Base output directory. Audio is written to <outDir>/<videoId>/audio/.

Optional:
  --manifest <path>        Bootstrap manifest used to resolve the video id.
  --voice <id>             MiniMax voice id (default: ${DEFAULT_VOICE}).
  --model <name>           MiniMax TTS model (default: ${DEFAULT_MODEL}).
  --language <name>        Language boost, e.g. en, auto (default: ${DEFAULT_LANGUAGE}).
  --dry-run                Skip the live API call and write request metadata only.
  --timeoutSec <n>         Request timeout in seconds (default: ${DEFAULT_TIMEOUT_SEC}).
  -h, --help               Show this help text.

Env resolution order:
  1. process.env
  2. apps/hsk-deck/.env

Keys: MINIMAX_API_KEY_2, MINIMAX_API_KEY, MINIMAX_API_MODEL, MINIMAX_API_T2A_URL, MINIMAX_TTS_VOICE_ID
`.trim()
}

function loadEnv(): Partial<Record<EnvKey, string>> {
  const result: Partial<Record<EnvKey, string>> = {}

  for (const key of ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined && value !== "") {
      result[key] = value
    }
  }

  if (!existsSync(ENV_PATH)) {
    return result
  }

  const content = readFileSync(ENV_PATH, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf("=")
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    if (!ENV_KEYS.includes(key as EnvKey)) continue
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value !== "" && result[key as EnvKey] === undefined) {
      result[key as EnvKey] = value
    }
  }

  return result
}


function resolveVideoId(args: Args, decomposition: DecompositionFile): string {
  if (decomposition.source_video_id) {
    return decomposition.source_video_id
  }

  if (args.manifest) {
    const manifest = readJsonFile<ManifestFile>(args.manifest, "manifest")
    if (manifest.videos && manifest.videos.length > 0) {
      return manifest.videos[0].id
    }
  }

  throw new Error(
    "Could not resolve video id. Decomposition is missing source_video_id and no manifest was provided.",
  )
}

function readJsonFile<T>(filePath: string, label: string): T {
  const resolved = resolve(filePath)
  if (!existsSync(resolved)) {
    throw new Error(`${label} file not found: ${resolved}`)
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8")) as T
  } catch (error) {
    throw new Error(`Failed to parse ${label} JSON at ${resolved}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n")
}

function redactAudio(response: MiniMaxT2aResponse): MiniMaxT2aResponse {
  if (!response.data?.audio) return response
  return {
    ...response,
    data: {
      ...response.data,
      audio: `<redacted hex audio, ${response.data.audio.length} chars; saved as narration.mp3>`,
    },
  }
}

interface GenerateAudioOptions {
  endpoint: string
  apiKey: string
  request: MiniMaxT2aRequest
  timeoutSec: number
}

async function generateAudio({ endpoint, apiKey, request, timeoutSec }: GenerateAudioOptions): Promise<MiniMaxT2aResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000)

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    const text = await response.text()
    let parsed: MiniMaxT2aResponse
    try {
      parsed = JSON.parse(text) as MiniMaxT2aResponse
    } catch {
      throw new Error(`MiniMax returned non-JSON (HTTP ${response.status}): ${text.slice(0, 500)}`)
    }

    if (!response.ok && !parsed.base_resp) {
      throw new Error(`MiniMax HTTP error ${response.status}: ${text.slice(0, 500)}`)
    }

    return parsed
  } finally {
    clearTimeout(timeoutId)
  }
}

interface BuildManifestOptions {
  args: Args
  videoId: string
  transcript: string
  textHash: string
  config: {
    endpoint: string
    model: string
    voice: string
    language: string
  }
  response: MiniMaxT2aResponse
  mp3Path: string
  responsePath: string
  dryRun: boolean
}

function buildManifest(options: BuildManifestOptions): TtsManifest {
  const { args, videoId, transcript, textHash, config, response, mp3Path, responsePath, dryRun } = options
  const extra = response.extra_info ?? {}
  const baseResp = response.base_resp ?? { status_code: -1, status_msg: "" }

  return {
    schemaVersion: "tiktok-recreate.tts.v1",
    videoId,
    transcriptLength: transcript.length,
    textHash,
    model: config.model,
    voice: config.voice,
    language: config.language,
    endpoint: config.endpoint,
    dryRun,
    audioPaths: {
      mp3: mp3Path,
      responseJson: responsePath,
    },
    durationMs: typeof extra.audio_length === "number" ? extra.audio_length : undefined,
    byteSize: typeof extra.audio_size === "number" ? extra.audio_size : undefined,
    sampleRate: typeof extra.audio_sample_rate === "number" ? extra.audio_sample_rate : undefined,
    bitrate: typeof extra.bitrate === "number" ? extra.bitrate : undefined,
    usageCharacters: typeof extra.usage_characters === "number" ? extra.usage_characters : undefined,
    traceId: response.trace_id,
    statusCode: baseResp.status_code,
    statusMsg: baseResp.status_msg,
    generatedAt: new Date().toISOString(),
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
