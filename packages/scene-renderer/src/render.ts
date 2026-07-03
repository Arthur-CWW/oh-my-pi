#!/usr/bin/env bun
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { captureFrames } from "./capture"
import { decodeSceneSpec, parseJsonText } from "./schema"
import { runProcess, stageAssets } from "./stage"

interface RenderArgs {
  readonly scenePath: string
  readonly outDir: string
  readonly frameRange?: readonly [number, number]
  readonly stillSeconds?: number
  readonly runtimePath: string
  readonly keepFrames: boolean
}

interface RenderManifest {
  readonly schemaVersion: "scene-render.v1"
  readonly specPath: string
  readonly flags: {
    readonly frameRange?: readonly [number, number]
    readonly stillSeconds?: number
    readonly runtimePath: string
    readonly keepFrames: boolean
  }
  readonly frameCount: number
  readonly output: string
  readonly ffmpegArgv: readonly string[]
  readonly createdAt: string
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(Bun.argv.slice(2))
    if (!existsSync(args.runtimePath)) {
      throw new Error("runtime bundle missing — run: bun run --cwd packages/scene-renderer build:runtime")
    }

    const scenePath = resolve(args.scenePath)
    const outDir = resolve(args.outDir)
    await mkdir(outDir, { recursive: true })

    const spec = decodeSceneSpec(parseJsonText(await Bun.file(scenePath).text()))
    const staged = await stageAssets(spec, { outDir, sceneDir: dirname(scenePath) })

    await rm(join(outDir, "frames"), { recursive: true, force: true })
    if (args.stillSeconds !== undefined) {
      const frame = Math.round(args.stillSeconds * staged.spec.fps)
      const capture = await captureFrames(staged.spec, {
        publicDir: staged.publicDir,
        runtimePath: args.runtimePath,
        outDir,
        frameRange: [frame, frame],
      })
      const stillPath = join(outDir, `still-${args.stillSeconds}s.png`)
      await copyFile(join(capture.framesDir, `${String(frame).padStart(6, "0")}.png`), stillPath)
      if (!args.keepFrames) await rm(capture.framesDir, { recursive: true, force: true })
      console.log(stillPath)
      return
    }

    const capture = await captureFrames(staged.spec, {
      publicDir: staged.publicDir,
      runtimePath: args.runtimePath,
      outDir,
      frameRange: args.frameRange,
    })
    const outputPath = join(outDir, "scene.mp4")
    const ffmpegArgv = buildFfmpegArgs({
      fps: staged.spec.fps,
      startFrame: capture.startFrame,
      framesDir: capture.framesDir,
      audioFilePath: staged.audioFilePath,
      audioOffsetSeconds: staged.spec.audio?.offsetSeconds ?? 0,
      audioGainDb: staged.spec.audio?.gainDb ?? 0,
      outputPath,
    })
    await runProcess("ffmpeg", ffmpegArgv, outDir)

    const manifest: RenderManifest = {
      schemaVersion: "scene-render.v1",
      specPath: scenePath,
      flags: {
        frameRange: args.frameRange,
        runtimePath: args.runtimePath,
        keepFrames: args.keepFrames,
      },
      frameCount: capture.frameCount,
      output: outputPath,
      ffmpegArgv,
      createdAt: new Date().toISOString(),
    }
    await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    if (!args.keepFrames) await rm(capture.framesDir, { recursive: true, force: true })
    console.log(outputPath)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function buildFfmpegArgs(options: {
  readonly fps: number
  readonly startFrame: number
  readonly framesDir: string
  readonly audioFilePath?: string
  readonly audioOffsetSeconds: number
  readonly audioGainDb: number
  readonly outputPath: string
}): readonly string[] {
  const args = [
    "-y",
    "-framerate",
    String(options.fps),
    "-start_number",
    String(options.startFrame),
    "-i",
    join(options.framesDir, "%06d.png"),
  ]

  if (options.audioFilePath) {
    args.push("-itsoffset", String(options.audioOffsetSeconds), "-i", options.audioFilePath)
    if (options.audioGainDb !== 0) args.push("-filter:a", `volume=${options.audioGainDb}dB`)
    args.push("-shortest", "-c:a", "aac")
  }

  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", options.outputPath)
  return args
}

function parseArgs(argv: readonly string[]): RenderArgs {
  let scenePath: string | undefined
  let outDir: string | undefined
  let frameRange: readonly [number, number] | undefined
  let stillSeconds: number | undefined
  let runtimePath = defaultRuntimePath()
  let keepFrames = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--scene") {
      scenePath = argv[index + 1]
      index += 1
    } else if (arg === "--out") {
      outDir = argv[index + 1]
      index += 1
    } else if (arg === "--frame-range") {
      frameRange = parseFrameRange(argv[index + 1] ?? "")
      index += 1
    } else if (arg === "--still") {
      stillSeconds = parseNumber(argv[index + 1] ?? "", "--still")
      index += 1
    } else if (arg === "--runtime") {
      runtimePath = resolve(argv[index + 1] ?? "")
      index += 1
    } else if (arg === "--keep-frames") {
      keepFrames = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  if (!scenePath) throw new Error("missing required --scene <spec.json>")
  if (!outDir) throw new Error("missing required --out <dir>")
  return { scenePath, outDir, frameRange, stillSeconds, runtimePath, keepFrames }
}

function parseFrameRange(value: string): readonly [number, number] {
  const [startRaw, endRaw] = value.split("-", 2)
  const start = parseNumber(startRaw ?? "", "--frame-range start")
  const end = parseNumber(endRaw ?? "", "--frame-range end")
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new Error("--frame-range must be a non-negative inclusive range like 0-23")
  }
  return [start, end]
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a number`)
  return parsed
}

function defaultRuntimePath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../dist/runtime.js")
}

if (import.meta.main) {
  await main()
}
