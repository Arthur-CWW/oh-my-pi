#!/usr/bin/env bun
/**
 * TikTok recreation side-by-side comparison boundary.
 *
 * Composes the original source video and recreated render into one hstacked
 * comparison video using local ffmpeg/ffprobe only.
 *
 * Usage:
 *   bun scripts/tiktok-recreate-side-by-side.boundary.ts \
 *     --original data/source-archives/.../source.mp4 \
 *     --recreate data/video-recreation/.../recreate.mp4 \
 *     --out data/video-recreation/.../side-by-side \
 *     [--audio recreate] \
 *     [--height 960]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"

const DEFAULT_AUDIO: AudioSource = "recreate"
const DEFAULT_HEIGHT = 960
const LABEL_FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
const OUTPUT_FILE = "side-by-side.mp4"
const MANIFEST_FILE = "manifest.json"

type AudioSource = "original" | "recreate"

interface Args {
  original: string
  recreate: string
  out: string
  audio: AudioSource
  height: number
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

interface InputProbe {
  path: string
  absolutePath: string
  relativePath: string
  durationSec: number
  videoStreamCount: number
  audioStreamCount: number
  width?: number
  height?: number
}

interface SideBySideManifest {
  schemaVersion: "tiktok-recreate.side-by-side.v1"
  inputs: {
    original: InputProbe
    recreate: InputProbe
  }
  output: {
    path: string
    absolutePath: string
    relativePath: string
  }
  audio: AudioSource
  height: number
  labels: {
    requested: true
    applied: boolean
    fontfile: string
  }
  ffmpegArgv: string[]
  createdAt: string
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  validateArgs(args)

  const outDir = resolve(args.out)
  mkdirSync(outDir, { recursive: true })

  const originalProbe = await probeInput(args.original, "original")
  const recreateProbe = await probeInput(args.recreate, "recreate")
  const chosenAudioProbe = args.audio === "original" ? originalProbe : recreateProbe
  if (chosenAudioProbe.audioStreamCount === 0) {
    throw new Error(`Chosen --audio ${args.audio} input has zero audio streams: ${chosenAudioProbe.absolutePath}`)
  }
  const outputPath = resolve(outDir, OUTPUT_FILE)
  const labelsApplied = existsSync(LABEL_FONT)
  const ffmpegArgv = buildFfmpegArgv({ args, outputPath, labelsApplied })

  await runCommand("ffmpeg", ffmpegArgv, "ffmpeg")

  const manifest: SideBySideManifest = {
    schemaVersion: "tiktok-recreate.side-by-side.v1",
    inputs: {
      original: originalProbe,
      recreate: recreateProbe,
    },
    output: {
      path: outputPath,
      absolutePath: outputPath,
      relativePath: relative(process.cwd(), outputPath),
    },
    audio: args.audio,
    height: args.height,
    labels: {
      requested: true,
      applied: labelsApplied,
      fontfile: LABEL_FONT,
    },
    ffmpegArgv: ["ffmpeg", ...ffmpegArgv],
    createdAt: new Date().toISOString(),
  }

  const manifestPath = resolve(outDir, MANIFEST_FILE)
  writeJson(manifestPath, manifest)

  console.log(JSON.stringify({
    ok: true,
    output: outputPath,
    manifest: manifestPath,
    labelsApplied,
    originalDurationSec: originalProbe.durationSec,
    recreateDurationSec: recreateProbe.durationSec,
  }, null, 2))
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    original: "",
    recreate: "",
    out: "",
    audio: DEFAULT_AUDIO,
    height: DEFAULT_HEIGHT,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    const next = argv[i + 1]

    switch (current) {
      case "--original":
        if (!next) throw new Error("--original requires a value")
        args.original = next
        i += 1
        break
      case "--recreate":
        if (!next) throw new Error("--recreate requires a value")
        args.recreate = next
        i += 1
        break
      case "--out":
        if (!next) throw new Error("--out requires a value")
        args.out = next
        i += 1
        break
      case "--audio":
        if (!next) throw new Error("--audio requires a value")
        if (next !== "original" && next !== "recreate") {
          throw new Error("--audio must be original or recreate")
        }
        args.audio = next
        i += 1
        break
      case "--height":
        if (!next) throw new Error("--height requires a value")
        args.height = Number(next)
        if (!Number.isInteger(args.height) || args.height < 2) {
          throw new Error("--height must be an integer greater than 1")
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
  if (!args.original) {
    throw new Error("--original is required")
  }
  if (!args.recreate) {
    throw new Error("--recreate is required")
  }
  if (!args.out) {
    throw new Error("--out is required")
  }
}

function usageText(): string {
  return `
Compose a TikTok recreation side-by-side comparison video with ffmpeg.

Usage:
  bun scripts/tiktok-recreate-side-by-side.boundary.ts --original <mp4> --recreate <mp4> --out <dir> [options]

Required:
  --original <mp4>       Original source video.
  --recreate <mp4>       Recreated render video.
  --out <dir>            Output directory for side-by-side.mp4 and manifest.json.

Optional:
  --audio <source>       Audio source: original or recreate (default: ${DEFAULT_AUDIO}).
  --height <px>          Target pane height in pixels (default: ${DEFAULT_HEIGHT}).
  -h, --help             Show this help text.
`.trim()
}

async function probeInput(inputPath: string, label: string): Promise<InputProbe> {
  const absolutePath = resolve(inputPath)
  if (!existsSync(absolutePath)) {
    throw new Error(`${label} input not found: ${absolutePath}`)
  }

  const probe = await ffprobe(absolutePath)
  const streams = probe.streams ?? []
  const videoStreams = streams.filter((stream) => stream.codec_type === "video")
  if (videoStreams.length === 0) {
    throw new Error(`${label} input has zero video streams: ${absolutePath}`)
  }

  const audioStreams = streams.filter((stream) => stream.codec_type === "audio")
  const firstVideo = videoStreams[0]

  return {
    path: absolutePath,
    absolutePath,
    relativePath: relative(process.cwd(), absolutePath),
    durationSec: readDurationSec(probe, firstVideo, label, absolutePath),
    videoStreamCount: videoStreams.length,
    audioStreamCount: audioStreams.length,
    width: firstVideo.width,
    height: firstVideo.height,
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

function readDurationSec(probe: FfprobeResult, stream: FfprobeStream, label: string, inputPath: string): number {
  const rawDuration = probe.format?.duration ?? stream.duration
  const durationSec = rawDuration === undefined ? Number.NaN : Number(rawDuration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`${label} input has missing or invalid duration: ${inputPath}`)
  }
  return durationSec
}

function buildFfmpegArgv(options: { args: Args; outputPath: string; labelsApplied: boolean }): string[] {
  const { args, outputPath, labelsApplied } = options
  const originalPath = resolve(args.original)
  const recreatePath = resolve(args.recreate)
  const audioInputIndex = args.audio === "original" ? 0 : 1
  const scaledOriginal = `[0:v]scale=-2:${args.height}[orig]`
  const scaledRecreate = `[1:v]scale=-2:${args.height}[rec]`
  const filterComplex = labelsApplied
    ? [
        scaledOriginal,
        scaledRecreate,
        `[orig]${drawTextFilter("ORIGINAL")}[orig_label]`,
        `[rec]${drawTextFilter("RECREATION")}[rec_label]`,
        "[orig_label][rec_label]hstack=inputs=2[v]",
      ].join(";")
    : [
        scaledOriginal,
        scaledRecreate,
        "[orig][rec]hstack=inputs=2[v]",
      ].join(";")

  return [
    "-y",
    "-i", originalPath,
    "-i", recreatePath,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", `${audioInputIndex}:a:0`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    outputPath,
  ]
}

function drawTextFilter(text: string): string {
  return [
    "drawtext=fontfile='" + escapeDrawtextValue(LABEL_FONT) + "'",
    "text='" + escapeDrawtextValue(text) + "'",
    "x=(w-text_w)/2",
    "y=32",
    "fontsize=40",
    "fontcolor=white",
    "box=1",
    "boxcolor=black@0.55",
    "boxborderw=12",
  ].join(":")
}

function escapeDrawtextValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:")
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

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n")
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
