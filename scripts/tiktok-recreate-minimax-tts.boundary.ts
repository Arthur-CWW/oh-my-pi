#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { spawn, type ChildProcess } from "node:child_process"
import { basename, dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_VOICE_ID = "289066744107112"
const DEFAULT_MODEL = "speech-2.8-turbo"
const DEFAULT_LANGUAGE = "Chinese (Mandarin)"
const DEFAULT_TRANSCRIPT_FIELD = "verbatim_or_vtt_cleaned" as const
const DEFAULT_TIMEOUT_SEC = 240

const TRANSCRIPT_FIELDS = ["verbatim_or_vtt_cleaned", "raw"] as const
type TranscriptField = (typeof TRANSCRIPT_FIELDS)[number]

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, "..")
const GENERATOR_SCRIPT = resolve(REPO_ROOT, "../apps/hsk-deck/tools/minimax-direct/generate-audio.mjs")
const DEFAULT_SESSION = resolve(REPO_ROOT, "../apps/hsk-deck/tools/minimax-direct/session.json")

interface Args {
	decomposition: string
	outDir: string
	manifest?: string
	session: string
	voiceId: string
	model: string
	language: string
	transcriptField: TranscriptField
	dryRun: boolean
	timeoutSec: number
}

interface DecompositionJson {
	source_video_id?: string
	transcript?: unknown
	[key: string]: unknown
}

interface SourceContext {
	id?: string
	title?: string
	description?: string
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

interface TtsRequest {
	transcriptField: TranscriptField
	transcriptCharLength: number
	transcriptPreview: string
	voiceId: string
	model: string
	language: string
}

interface TtsCommand {
	script: string
	args: string[]
}

interface TtsResult {
	audioPath: string
	resultJsonPath: string
	byteSize: number
	voiceId?: string
	voiceName?: string
	actualModel?: string
	languageBoost?: string
	costCredit?: number | null
	audioId?: string
	hasSrt: boolean
	hasWav: boolean
}

interface RunManifest {
	schemaVersion: "tiktok-recreate.minimax-tts.v1"
	decompositionPath: string
	sourceManifestPath?: string
	outDir: string
	videoId: string
	dryRun: boolean
	request: TtsRequest
	sourceMetadata?: {
		title?: string
		description?: string
	}
	command: TtsCommand
	result?: TtsResult
}

function usage(): string {
	const scriptName = basename(fileURLToPath(import.meta.url))
	return `Usage: ${scriptName} --decomposition <path> --outDir <path> [options]

Generate MiniMax TTS narration audio from a TikTok recreation decomposition.

Required:
  --decomposition <path>   Path to a single decomposition JSON.
  --outDir <path>          Root output directory (audio written under <outDir>/<videoId>/).

Optional:
  --manifest <path>        Source manifest / context JSON for video metadata enrichment.
  --session <path>         MiniMax session/auth JSON (default: ${DEFAULT_SESSION}).
  --voiceId <id>           MiniMax voice ID (default: ${DEFAULT_VOICE_ID}).
  --model <name>           MiniMax TTS model name (default: ${DEFAULT_MODEL}).
  --language <name>        Language name passed to the TTS engine (default: ${DEFAULT_LANGUAGE}).
  --transcriptField <f>    Transcript key in decomposition JSON: ${TRANSCRIPT_FIELDS.join(" | ")} (default: ${DEFAULT_TRANSCRIPT_FIELD}).
  --dryRun                 Write manifest describing planned command without calling MiniMax.
  --timeoutSec <n>         Timeout in seconds for the generation subprocess (default: ${DEFAULT_TIMEOUT_SEC}).
  --help, -h               Show this help.`
}

function parseArgs(argv: string[]): Args {
	const args = argv.slice(2)
	const parsed: Partial<Args> = {
		session: DEFAULT_SESSION,
		voiceId: DEFAULT_VOICE_ID,
		model: DEFAULT_MODEL,
		language: DEFAULT_LANGUAGE,
		transcriptField: DEFAULT_TRANSCRIPT_FIELD,
		timeoutSec: DEFAULT_TIMEOUT_SEC,
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
			case "--session":
				parsed.session = next()
				break
			case "--voiceId":
				parsed.voiceId = next()
				break
			case "--model":
				parsed.model = next()
				break
			case "--language":
				parsed.language = next()
				break
			case "--transcriptField":
				parsed.transcriptField = next() as TranscriptField
				break
			case "--timeoutSec":
				parsed.timeoutSec = Number(next())
				break
			case "--dryRun":
				parsed.dryRun = true
				break
			case "--help":
			case "-h":
				console.log(usage())
				process.exit(0)
				break
			default:
				throw new Error(`Unknown flag: ${flag}. Use --help for usage.`)
		}
	}

	if (!parsed.decomposition) throw new Error("Missing required --decomposition")
	if (!parsed.outDir) throw new Error("Missing required --outDir")
	if (!TRANSCRIPT_FIELDS.includes(parsed.transcriptField as TranscriptField)) {
		throw new Error(`--transcriptField must be one of ${TRANSCRIPT_FIELDS.join(" | ")}, got ${parsed.transcriptField}`)
	}
	if (Number.isNaN(parsed.timeoutSec) || parsed.timeoutSec < 1) {
		throw new Error("--timeoutSec must be a positive integer")
	}

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

function extractTranscript(decomposition: DecompositionJson, field: TranscriptField): string {
	const transcript = decomposition.transcript
	if (typeof transcript === "string") {
		if (transcript.trim().length > 0) return transcript.trim()
		throw new Error("Decomposition transcript string is empty")
	}
	if (!transcript || typeof transcript !== "object") {
		throw new Error("Decomposition JSON has no transcript object")
	}

	const value = (transcript as Record<string, unknown>)[field]
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim()
	}

	throw new Error(
		`Decomposition transcript has no usable text at key "${field}". ` +
			`Available keys: ${Object.keys(transcript as Record<string, unknown>).join(", ") || "(none)"}`,
	)
}

function extractSourceMetadata(
	manifest: SourceContext | SourceManifest | undefined,
	videoId: string,
): { title?: string; description?: string } | undefined {
	if (!manifest) return undefined

	if (Array.isArray((manifest as SourceManifest).videos)) {
		const video = (manifest as SourceManifest).videos?.find((v) => v.id === videoId)
		if (!video) return undefined
		return {
			title: video.title,
			description: video.description,
		}
	}

	const ctx = manifest as SourceContext
	if (ctx.id !== undefined && ctx.id !== videoId) return undefined
	return {
		title: ctx.title,
		description: ctx.description,
	}
}

async function runGenerator(args: string[], timeoutSec: number): Promise<{ stdout: string; stderr: string }> {
	const { promise, resolve, reject } = Promise.withResolvers<{ stdout: string; stderr: string }>()
	const proc: ChildProcess = spawn("node", [GENERATOR_SCRIPT, ...args], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	})

	let stdout = ""
	let stderr = ""
	proc.stdout?.setEncoding("utf8")
	proc.stderr?.setEncoding("utf8")
	proc.stdout?.on("data", (chunk: string) => {
		stdout += chunk
	})
	proc.stderr?.on("data", (chunk: string) => {
		stderr += chunk
	})

	proc.on("error", (err) => {
		reject(new Error(`Failed to spawn MiniMax generator: ${err.message}`))
	})
	proc.on("close", (code) => {
		if (code === 0) {
			resolve({ stdout, stderr })
		} else {
			const tail = (s: string) => (s.length > 2000 ? `...${s.slice(-2000)}` : s)
			reject(
				new Error(
					`MiniMax TTS generator exited with code ${code}\n` +
						`stderr: ${tail(stderr)}\n` +
						`stdout: ${tail(stdout)}`,
				),
			)
		}
	})

	const timer = setTimeout(() => {
		proc.kill("SIGTERM")
		reject(new Error(`MiniMax TTS generator timed out after ${timeoutSec}s`))
	}, timeoutSec * 1000)

	try {
		return await promise
	} finally {
		clearTimeout(timer)
	}
}

function buildGeneratorArgs(
	sessionPath: string,
	text: string,
	outputPath: string,
	voiceId: string,
	model: string,
	language: string,
	timeoutSec: number,
): string[] {
	return [
		"--session",
		sessionPath,
		"--text",
		text,
		"--output",
		outputPath,
		"--voice-id",
		voiceId,
		"--model",
		model,
		"--language",
		language,
		"--timeout",
		String(timeoutSec),
	]
}

async function run(): Promise<void> {
	const args = parseArgs(process.argv)

	if (!args.dryRun && !existsSync(GENERATOR_SCRIPT)) {
		throw new Error(
			`MiniMax TTS generator not found: ${GENERATOR_SCRIPT}\n` +
				`Expected it at apps/hsk-deck/tools/minimax-direct/generate-audio.mjs`,
		)
	}

	const decomposition = await readJson<DecompositionJson>(resolve(args.decomposition))
	const sourceManifest = await readJsonOptional<SourceContext | SourceManifest>(
		args.manifest ? resolve(args.manifest) : undefined,
	)

	const videoId = decomposition.source_video_id ?? basename(args.decomposition, extname(args.decomposition))
	const sourceMetadata = extractSourceMetadata(sourceManifest, videoId)
	const transcriptText = extractTranscript(decomposition, args.transcriptField)

	const outDir = resolve(args.outDir)
	const videoOutDir = join(outDir, videoId)
	await mkdir(videoOutDir, { recursive: true })

	const audioPath = join(videoOutDir, "narration.mp3")
	const resultJsonPath = join(videoOutDir, "narration.mp3.json")
	const sessionPath = resolve(args.session)

	const request: TtsRequest = {
		transcriptField: args.transcriptField,
		transcriptCharLength: transcriptText.length,
		transcriptPreview: transcriptText.slice(0, 200),
		voiceId: args.voiceId,
		model: args.model,
		language: args.language,
	}

	const command: TtsCommand = {
		script: GENERATOR_SCRIPT,
		args: buildGeneratorArgs(
			sessionPath,
			transcriptText,
			audioPath,
			args.voiceId,
			args.model,
			args.language,
			args.timeoutSec,
		),
	}

	let result: TtsResult | undefined

	if (args.dryRun) {
		console.error(`[dry-run] Would run: node ${command.args.join(" ")}`)
		console.error(`[dry-run] Expected audio: ${audioPath}`)
		console.error(`[dry-run] Expected result JSON: ${resultJsonPath}`)
	} else {
		console.error(`[live] Running MiniMax TTS for video ${videoId}...`)

		await runGenerator(command.args, args.timeoutSec)

		const audioStat = await stat(audioPath)
		const resultJson = await readJson<Record<string, unknown>>(resultJsonPath)

		result = {
			audioPath: "narration.mp3",
			resultJsonPath: "narration.mp3.json",
			byteSize: audioStat.size,
			voiceId: typeof resultJson.voice_id === "string" ? resultJson.voice_id : undefined,
			voiceName: typeof resultJson.voice_name === "string" ? resultJson.voice_name : undefined,
			actualModel: typeof resultJson.actual_model === "string" ? resultJson.actual_model : undefined,
			languageBoost: typeof resultJson.language_boost === "string" ? resultJson.language_boost : undefined,
			costCredit: typeof resultJson.cost_credit === "number" ? resultJson.cost_credit : null,
			audioId: typeof resultJson.audio_id === "string" ? resultJson.audio_id : undefined,
			hasSrt: Boolean(resultJson.has_srt),
			hasWav: Boolean(resultJson.has_wav),
		}

		console.error(
			`[live] Wrote audio: ${result.audioPath} (${result.byteSize} bytes)` +
				(result.voiceName ? ` voice=${result.voiceName}` : ""),
		)
	}

	const manifest: RunManifest = {
		schemaVersion: "tiktok-recreate.minimax-tts.v1",
		decompositionPath: resolve(args.decomposition),
		...(args.manifest ? { sourceManifestPath: resolve(args.manifest) } : {}),
		outDir,
		videoId,
		dryRun: args.dryRun,
		request,
		...(sourceMetadata ? { sourceMetadata } : {}),
		command,
		...(result ? { result } : {}),
	}

	const manifestPath = join(videoOutDir, "manifest.json")
	await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
	console.log(JSON.stringify({ manifestPath, videoId, dryRun: args.dryRun }, null, 2))
}

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})
