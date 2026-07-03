#!/usr/bin/env bun
/**
 * Creative asset inventory boundary.
 *
 * Usage:
 *   bun scripts/creative-asset-inventory.boundary.ts [--roots <dir>]... --out <json> [--max 1000]
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"

const DEFAULT_ROOTS = ["data/video-recreation", "data/source-archives/tiktok"]
const DEFAULT_MAX = 1000
const PROBE_LIMIT = 100
const IMAGE_EXTENSIONS: Record<string, true> = { ".png": true, ".jpg": true, ".jpeg": true, ".webp": true }
const VIDEO_EXTENSIONS: Record<string, true> = { ".mp4": true }
const AUDIO_EXTENSIONS: Record<string, true> = { ".mp3": true, ".wav": true }

type AssetKind = "image" | "video" | "audio"

interface Args {
  roots: string[]
  out: string
  max: number
}

interface CandidateAsset {
  path: string
  absolutePath: string
  kind: AssetKind
  bytes: number
  mtimeMs: number
}

interface InventoryAsset {
  path: string
  kind: AssetKind
  bytes: number
  mtime: string
  durationSeconds?: number
  width?: number
  height?: number
  probed?: boolean
}

interface AssetInventoryManifest {
  schemaVersion: "asset-inventory.v1"
  generatedAt: string
  roots: string[]
  max: number
  probeLimit: number
  assets: InventoryAsset[]
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

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  validateArgs(args)

  const roots = args.roots.length === 0 ? DEFAULT_ROOTS : args.roots
  const candidates: CandidateAsset[] = []
  for (const root of roots) {
    const absoluteRoot = resolve(root)
    if (existsSync(absoluteRoot)) walkRoot(absoluteRoot, candidates)
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const selected = candidates.slice(0, args.max)
  const assets: InventoryAsset[] = []
  let probesUsed = 0

  for (const candidate of selected) {
    const asset: InventoryAsset = {
      path: relative(process.cwd(), candidate.absolutePath),
      kind: candidate.kind,
      bytes: candidate.bytes,
      mtime: new Date(candidate.mtimeMs).toISOString(),
    }

    if ((candidate.kind === "video" || candidate.kind === "audio") && probesUsed < PROBE_LIMIT) {
      probesUsed += 1
      const probe = await ffprobe(candidate.absolutePath)
      addProbeFields(asset, probe, candidate.kind)
      asset.probed = true
    } else if (candidate.kind === "video" || candidate.kind === "audio") {
      asset.probed = false
    }

    assets.push(asset)
  }

  const outputPath = resolve(args.out)
  mkdirSync(dirname(outputPath), { recursive: true })
  const manifest: AssetInventoryManifest = {
    schemaVersion: "asset-inventory.v1",
    generatedAt: new Date().toISOString(),
    roots: roots.map((root) => relative(process.cwd(), resolve(root))),
    max: args.max,
    probeLimit: PROBE_LIMIT,
    assets,
  }
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n")

  console.log(JSON.stringify({
    ok: true,
    output: outputPath,
    roots: manifest.roots,
    candidateCount: candidates.length,
    emittedCount: assets.length,
    probedCount: probesUsed,
  }, null, 2))
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    roots: [],
    out: "",
    max: DEFAULT_MAX,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    const next = argv[i + 1]

    switch (current) {
      case "--roots":
        if (!next) throw new Error("--roots requires a value")
        args.roots.push(next)
        i += 1
        break
      case "--out":
        if (!next) throw new Error("--out requires a value")
        args.out = next
        i += 1
        break
      case "--max":
        if (!next) throw new Error("--max requires a value")
        args.max = Number(next)
        if (!Number.isInteger(args.max) || args.max < 1) throw new Error("--max must be a positive integer")
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
  if (!args.out) throw new Error("--out is required")
}

function usageText(): string {
  return `
Inventory creative image/video/audio assets for scene-spec authoring.

Usage:
  bun scripts/creative-asset-inventory.boundary.ts --out <json> [options]

Required:
  --out <json>         Output JSON manifest path.

Optional:
  --roots <dir>        Root directory to walk. Repeatable. Defaults to: ${DEFAULT_ROOTS.join(" ")}
  --max <n>            Maximum assets to emit after mtime sort (default: ${DEFAULT_MAX}).
  -h, --help           Show this help text.

Notes:
  Finds .png/.jpg/.webp images, .mp4 videos, and .mp3/.wav audio. Video/audio files are probed with ffprobe for duration and dimensions, capped at ${PROBE_LIMIT} probes to keep this quick.
`.trim()
}

function walkRoot(directory: string, out: CandidateAsset[]): void {
  const entries = readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      walkRoot(absolutePath, out)
      continue
    }
    if (!entry.isFile()) continue

    const extension = extname(entry.name).toLowerCase()
    const kind = kindForExtension(extension)
    if (!kind) continue

    const stats = statSync(absolutePath)
    out.push({
      path: relative(process.cwd(), absolutePath),
      absolutePath,
      kind,
      bytes: stats.size,
      mtimeMs: stats.mtimeMs,
    })
  }
}

function kindForExtension(extension: string): AssetKind | undefined {
  if (IMAGE_EXTENSIONS[extension]) return "image"
  if (VIDEO_EXTENSIONS[extension]) return "video"
  if (AUDIO_EXTENSIONS[extension]) return "audio"
  return undefined
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

function addProbeFields(asset: InventoryAsset, probe: FfprobeResult, kind: AssetKind): void {
  const stream = (probe.streams ?? []).find((candidate) => candidate.codec_type === kind)
  const rawDuration = probe.format?.duration ?? stream?.duration
  const durationSeconds = rawDuration === undefined ? Number.NaN : Number(rawDuration)
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) asset.durationSeconds = Math.round(durationSeconds * 1000) / 1000
  if (stream?.width !== undefined) asset.width = stream.width
  if (stream?.height !== undefined) asset.height = stream.height
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
