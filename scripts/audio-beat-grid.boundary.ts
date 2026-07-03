#!/usr/bin/env bun
/**
 * Audio beat-grid boundary.
 *
 * Usage:
 *   bun scripts/audio-beat-grid.boundary.ts --audio <file> --out <json> --bpm <n> [--offset <sec>]
 *   bun scripts/audio-beat-grid.boundary.ts --audio <file> --out <json> --detect
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const DEFAULT_OFFSET_SECONDS = 0
const DETECT_WINDOW_SECONDS = 0.05
const DETECT_MIN_GAP_SECONDS = 0.2
const DETECT_ROLLING_RADIUS = 8
const DETECT_THRESHOLD_DB = 5

type Mode = "grid" | "detect"

interface Args {
  audio: string
  out: string
  bpm?: number
  offsetSeconds: number
  detect: boolean
}

interface FfprobeStream {
  codec_type?: string
  duration?: string
}

interface FfprobeResult {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
  }
}

interface RmsPoint {
  timeSeconds: number
  rmsDb: number
}

interface BeatGridManifest {
  schemaVersion: "beat-grid.v1"
  source: string
  durationSeconds: number
  mode: Mode
  bpm?: number
  offsetSeconds?: number
  beats: number[]
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  validateArgs(args)

  const inputPath = resolve(args.audio)
  if (!existsSync(inputPath)) throw new Error(`--audio not found: ${inputPath}`)

  const probe = await ffprobe(inputPath)
  const durationSeconds = readDurationSeconds(probe, inputPath)
  const mode: Mode = args.detect ? "detect" : "grid"
  const beats = args.detect
    ? await detectBeats(inputPath, durationSeconds)
    : buildGridBeats(durationSeconds, args.bpm ?? 0, args.offsetSeconds)

  const manifest: BeatGridManifest = {
    schemaVersion: "beat-grid.v1",
    source: relative(process.cwd(), inputPath),
    durationSeconds,
    mode,
    beats,
  }
  if (args.bpm !== undefined) manifest.bpm = args.bpm
  if (!args.detect) manifest.offsetSeconds = args.offsetSeconds

  const outputPath = resolve(args.out)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n")

  console.log(JSON.stringify({
    ok: true,
    output: outputPath,
    mode,
    durationSeconds,
    beatCount: beats.length,
    firstBeatSeconds: beats[0] ?? null,
  }, null, 2))
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    audio: "",
    out: "",
    offsetSeconds: DEFAULT_OFFSET_SECONDS,
    detect: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    const next = argv[i + 1]

    switch (current) {
      case "--audio":
        if (!next) throw new Error("--audio requires a value")
        args.audio = next
        i += 1
        break
      case "--out":
        if (!next) throw new Error("--out requires a value")
        args.out = next
        i += 1
        break
      case "--bpm":
        if (!next) throw new Error("--bpm requires a value")
        args.bpm = Number(next)
        if (!Number.isFinite(args.bpm) || args.bpm <= 0) throw new Error("--bpm must be a positive number")
        i += 1
        break
      case "--offset":
        if (!next) throw new Error("--offset requires a value")
        args.offsetSeconds = Number(next)
        if (!Number.isFinite(args.offsetSeconds) || args.offsetSeconds < 0) throw new Error("--offset must be a non-negative number")
        i += 1
        break
      case "--detect":
        args.detect = true
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
  if (!args.audio) throw new Error("--audio is required")
  if (!args.out) throw new Error("--out is required")
  if (args.detect && args.bpm !== undefined) throw new Error("Use either --detect or --bpm, not both")
  if (!args.detect && args.bpm === undefined) throw new Error("Either --bpm <n> or --detect is required")
}

function usageText(): string {
  return `
Create a beat-grid JSON file shaped for scene.v1 timeline.beats.

Usage:
  bun scripts/audio-beat-grid.boundary.ts --audio <file> --out <json> --bpm <n> [--offset <sec>]
  bun scripts/audio-beat-grid.boundary.ts --audio <file> --out <json> --detect

Required:
  --audio <file>       Input audio or video file readable by ffmpeg/ffprobe.
  --out <json>         Output JSON path.
  --bpm <n>            Grid mode tempo, mutually exclusive with --detect.
  --detect             Crude onset mode, mutually exclusive with --bpm.

Optional:
  --offset <sec>       Grid start offset in seconds (default: ${DEFAULT_OFFSET_SECONDS}).
  -h, --help           Show this help text.

Detect mode limits:
  Detection uses ffmpeg astats/ametadata RMS readings, roughly ${DETECT_WINDOW_SECONDS}s windows, then keeps local RMS maxima above a rolling-mean + ${DETECT_THRESHOLD_DB} dB threshold with a ${DETECT_MIN_GAP_SECONDS}s minimum gap. It is useful for quick visual sync markers, not musicological beat tracking.
`.trim()
}

async function ffprobe(inputPath: string): Promise<FfprobeResult> {
  const argv = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]
  const output = await runCommand("ffprobe", argv, "ffprobe")

  try {
    return JSON.parse(output.stdout) as FfprobeResult
  } catch (error) {
    throw new Error(`Failed to parse ffprobe JSON for ${inputPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readDurationSeconds(probe: FfprobeResult, inputPath: string): number {
  const audioStream = (probe.streams ?? []).find((stream) => stream.codec_type === "audio")
  if (!audioStream) throw new Error(`Input has no audio stream: ${inputPath}`)
  const rawDuration = probe.format?.duration ?? audioStream.duration
  const durationSeconds = rawDuration === undefined ? Number.NaN : Number(rawDuration)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Input has missing or invalid duration: ${inputPath}`)
  }
  return durationSeconds
}

function buildGridBeats(durationSeconds: number, bpm: number, offsetSeconds: number): number[] {
  const step = 60 / bpm
  const beats: number[] = []
  for (let t = offsetSeconds; t <= durationSeconds + 0.000001; t += step) {
    beats.push(roundSeconds(t))
  }
  return beats
}

async function detectBeats(inputPath: string, durationSeconds: number): Promise<number[]> {
  const argv = [
    "-v", "info",
    "-i", inputPath,
    "-vn",
    "-af", `aresample=48000,asetnsamples=n=${Math.round(48000 * DETECT_WINDOW_SECONDS)}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    "-f", "null",
    "-",
  ]
  const output = await runCommand("ffmpeg", argv, "ffmpeg")
  const rmsPoints = parseRmsPoints(output.stderr)
  if (rmsPoints.length < 3) return []

  const beats: number[] = []
  let lastBeat = -DETECT_MIN_GAP_SECONDS
  for (let i = 1; i < rmsPoints.length - 1; i += 1) {
    const point = rmsPoints[i]
    if (point.timeSeconds > durationSeconds) continue
    const previous = rmsPoints[i - 1]
    const next = rmsPoints[i + 1]
    if (point.rmsDb < previous.rmsDb || point.rmsDb < next.rmsDb) continue

    const start = Math.max(0, i - DETECT_ROLLING_RADIUS)
    const end = Math.min(rmsPoints.length - 1, i + DETECT_ROLLING_RADIUS)
    let sum = 0
    let count = 0
    for (let j = start; j <= end; j += 1) {
      sum += rmsPoints[j].rmsDb
      count += 1
    }
    const rollingMean = sum / count
    if (point.rmsDb >= rollingMean + DETECT_THRESHOLD_DB && point.timeSeconds - lastBeat >= DETECT_MIN_GAP_SECONDS) {
      beats.push(roundSeconds(point.timeSeconds))
      lastBeat = point.timeSeconds
    }
  }
  return beats
}

function parseRmsPoints(stderr: string): RmsPoint[] {
  const points: RmsPoint[] = []
  let pendingTime: number | undefined
  for (const line of stderr.split("\n")) {
    const timeMatch = /pts_time:([-+]?\d+(?:\.\d+)?)/.exec(line)
    if (timeMatch) pendingTime = Number(timeMatch[1])

    const rmsMatch = /lavfi\.astats\.Overall\.RMS_level=([-+]?\d+(?:\.\d+)?|-inf)/.exec(line)
    if (rmsMatch && pendingTime !== undefined) {
      const rmsDb = rmsMatch[1] === "-inf" ? -120 : Number(rmsMatch[1])
      if (Number.isFinite(rmsDb)) points.push({ timeSeconds: pendingTime, rmsDb })
      pendingTime = undefined
    }
  }
  return points
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

async function runCommand(command: string, argv: string[], label: string): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn([command, ...argv], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}: ${stderr.trim() || stdout.trim()}`)
  }

  return { stdout, stderr }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
