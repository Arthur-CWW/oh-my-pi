#!/usr/bin/env bun
/**
 * Video contact sheet boundary.
 *
 * Usage:
 *   bun scripts/video-contact-sheet.boundary.ts --video <mp4> [--video <mp4>] --out <png> [--tiles 4x4] [--width 1600]
 */
import { existsSync, mkdirSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const DEFAULT_TILES = "4x4"
const DEFAULT_WIDTH = 1600
const LABEL_FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
const MAX_VIDEOS = 2

interface Args {
  videos: string[]
  out: string
  tiles: TileSpec
  width: number
}

interface TileSpec {
  cols: number
  rows: number
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
  duration?: string
}

interface FfprobeResult {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
  }
}

interface VideoProbe {
  path: string
  absolutePath: string
  relativePath: string
  durationSeconds: number
  width: number
  height: number
}

interface ContactSheetSummary {
  schemaVersion: "video-contact-sheet.v1"
  output: {
    path: string
    absolutePath: string
    relativePath: string
  }
  videos: VideoProbe[]
  tiles: {
    columns: number
    rowsPerVideo: number
    tileCountPerVideo: number
    totalRows: number
    width: number
    tileWidth: number
    tileHeight: number
  }
  labels: {
    requested: true
    applied: boolean
    fontfile: string
  }
  samples: Array<{
    video: string
    timestampSeconds: number
    label: string
  }>
  ffmpegArgv: string[]
  createdAt: string
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  validateArgs(args)

  const probes: VideoProbe[] = []
  for (let i = 0; i < args.videos.length; i += 1) {
    probes.push(await probeVideo(args.videos[i], `video ${i + 1}`))
  }

  const outputPath = resolve(args.out)
  mkdirSync(dirname(outputPath), { recursive: true })

  const tileWidth = Math.max(2, Math.floor(args.width / args.tiles.cols))
  const firstProbe = probes[0]
  const tileHeight = Math.max(2, Math.round(tileWidth * firstProbe.height / firstProbe.width))
  const labelsApplied = existsSync(LABEL_FONT)
  const ffmpegArgv = buildFfmpegArgv({ args, probes, outputPath, tileWidth, tileHeight, labelsApplied })

  await runCommand("ffmpeg", ffmpegArgv, "ffmpeg")

  const samples = buildSamples(args, probes).map((sample) => ({
    video: probes[sample.videoIndex].relativePath,
    timestampSeconds: sample.timestampSeconds,
    label: formatTimestamp(sample.timestampSeconds),
  }))

  const summary: ContactSheetSummary = {
    schemaVersion: "video-contact-sheet.v1",
    output: {
      path: outputPath,
      absolutePath: outputPath,
      relativePath: relative(process.cwd(), outputPath),
    },
    videos: probes,
    tiles: {
      columns: args.tiles.cols,
      rowsPerVideo: args.tiles.rows,
      tileCountPerVideo: args.tiles.cols * args.tiles.rows,
      totalRows: args.tiles.rows * probes.length,
      width: args.width,
      tileWidth,
      tileHeight,
    },
    labels: {
      requested: true,
      applied: labelsApplied,
      fontfile: LABEL_FONT,
    },
    samples,
    ffmpegArgv: ["ffmpeg", ...ffmpegArgv],
    createdAt: new Date().toISOString(),
  }

  console.log(outputPath)
  console.log(JSON.stringify(summary, null, 2))
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    videos: [],
    out: "",
    tiles: parseTiles(DEFAULT_TILES),
    width: DEFAULT_WIDTH,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    const next = argv[i + 1]

    switch (current) {
      case "--video":
        if (!next) throw new Error("--video requires a value")
        args.videos.push(next)
        i += 1
        break
      case "--out":
        if (!next) throw new Error("--out requires a value")
        args.out = next
        i += 1
        break
      case "--tiles":
        if (!next) throw new Error("--tiles requires a value")
        args.tiles = parseTiles(next)
        i += 1
        break
      case "--width":
        if (!next) throw new Error("--width requires a value")
        args.width = Number(next)
        if (!Number.isInteger(args.width) || args.width < 64) {
          throw new Error("--width must be an integer >= 64")
        }
        i += 1
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
  if (args.videos.length === 0) throw new Error("At least one --video is required")
  if (args.videos.length > MAX_VIDEOS) throw new Error(`--video may be repeated at most ${MAX_VIDEOS} times`)
  if (!args.out) throw new Error("--out is required")
}

function usageText(): string {
  return `
Create a timestamped PNG contact sheet from one or two mp4 videos.

Usage:
  bun scripts/video-contact-sheet.boundary.ts --video <mp4> [--video <mp4>] --out <png> [options]

Required:
  --video <mp4>        Input mp4. Repeat once to compare two videos; each video's samples occupy their own rows.
  --out <png>          Output PNG path.

Optional:
  --tiles <NxM>        Columns x rows per video (default: ${DEFAULT_TILES}).
  --width <px>         Output grid width in pixels (default: ${DEFAULT_WIDTH}).
  -h, --help           Show this help text.

Notes:
  Samples are evenly spaced across each probed video duration. Timestamp labels use drawtext and are skipped when ${LABEL_FONT} is missing.
`.trim()
}

function parseTiles(raw: string): TileSpec {
  const match = /^(\d+)x(\d+)$/i.exec(raw)
  if (!match) throw new Error("--tiles must look like NxM, for example 4x4")
  const cols = Number(match[1])
  const rows = Number(match[2])
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols * rows > 64) {
    throw new Error("--tiles columns and rows must be positive integers with at most 64 tiles")
  }
  return { cols, rows }
}

async function probeVideo(inputPath: string, label: string): Promise<VideoProbe> {
  const absolutePath = resolve(inputPath)
  if (!existsSync(absolutePath)) throw new Error(`${label} not found: ${absolutePath}`)

  const probe = await ffprobe(absolutePath)
  const stream = (probe.streams ?? []).find((candidate) => candidate.codec_type === "video")
  if (!stream || !stream.width || !stream.height) throw new Error(`${label} has no video stream with dimensions: ${absolutePath}`)

  return {
    path: absolutePath,
    absolutePath,
    relativePath: relative(process.cwd(), absolutePath),
    durationSeconds: readDurationSeconds(probe, stream, label, absolutePath),
    width: stream.width,
    height: stream.height,
  }
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

function readDurationSeconds(probe: FfprobeResult, stream: FfprobeStream, label: string, inputPath: string): number {
  const rawDuration = probe.format?.duration ?? stream.duration
  const durationSeconds = rawDuration === undefined ? Number.NaN : Number(rawDuration)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`${label} has missing or invalid duration: ${inputPath}`)
  }
  return durationSeconds
}

interface SamplePoint {
  videoIndex: number
  tileIndex: number
  timestampSeconds: number
}

function buildSamples(args: Args, probes: VideoProbe[]): SamplePoint[] {
  const samples: SamplePoint[] = []
  const perVideoCount = args.tiles.cols * args.tiles.rows
  for (let videoIndex = 0; videoIndex < probes.length; videoIndex += 1) {
    const duration = probes[videoIndex].durationSeconds
    for (let tileIndex = 0; tileIndex < perVideoCount; tileIndex += 1) {
      const timestampSeconds = duration * (tileIndex + 0.5) / perVideoCount
      samples.push({ videoIndex, tileIndex, timestampSeconds })
    }
  }
  return samples
}

function buildFfmpegArgv(options: {
  args: Args
  probes: VideoProbe[]
  outputPath: string
  tileWidth: number
  tileHeight: number
  labelsApplied: boolean
}): string[] {
  const { args, probes, outputPath, tileWidth, tileHeight, labelsApplied } = options
  const samples = buildSamples(args, probes)
  const argv = ["-y"]
  for (const sample of samples) {
    argv.push("-ss", sample.timestampSeconds.toFixed(3), "-i", probes[sample.videoIndex].absolutePath)
  }

  const filters: string[] = []
  const labels: string[] = []
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]
    const timestamp = formatTimestamp(sample.timestampSeconds)
    const labelFilter = labelsApplied ? `,${drawTextFilter(timestamp)}` : ""
    const outLabel = `tile${i}`
    filters.push(`[${i}:v]scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black${labelFilter}[${outLabel}]`)
    labels.push(`[${outLabel}]`)
  }

  const layout: string[] = []
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]
    const col = sample.tileIndex % args.tiles.cols
    const rowInVideo = Math.floor(sample.tileIndex / args.tiles.cols)
    const row = sample.videoIndex * args.tiles.rows + rowInVideo
    layout.push(`${col * tileWidth}_${row * tileHeight}`)
  }
  filters.push(`${labels.join("")}xstack=inputs=${samples.length}:layout=${layout.join("|")}[v]`)

  argv.push(
    "-filter_complex", filters.join(";"),
    "-map", "[v]",
    "-frames:v", "1",
    "-update", "1",
    outputPath,
  )
  return argv
}

function drawTextFilter(text: string): string {
  return [
    "drawtext=fontfile='" + escapeDrawtextValue(LABEL_FONT) + "'",
    "text='" + escapeDrawtextValue(text) + "'",
    "x=10",
    "y=10",
    "fontsize=28",
    "fontcolor=white",
    "box=1",
    "boxcolor=black@0.55",
    "boxborderw=8",
  ].join(":")
}

function escapeDrawtextValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:")
}

function formatTimestamp(seconds: number): string {
  const whole = Math.floor(seconds)
  const millis = Math.round((seconds - whole) * 1000)
  const minutes = Math.floor(whole / 60)
  const secs = whole % 60
  return `${minutes}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`
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
