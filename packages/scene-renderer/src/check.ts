#!/usr/bin/env bun
import { dirname, resolve } from "node:path"
import { decodeSceneSpec, parseJsonText, type SceneSpec, type TrackSpec } from "./schema"

interface CheckArgs {
  readonly scenePath: string
}

export function collectSceneIssues(spec: SceneSpec): readonly string[] {
  const issues: string[] = []
  const assetsById = new Map(spec.assets.map((asset) => [asset.id, asset]))
  const available = spec.assets.map((asset) => asset.id).join(", ") || "none"

  if (spec.durationSeconds <= 0) issues.push("durationSeconds must be > 0")
  if (spec.fps <= 0) issues.push("fps must be > 0")

  spec.objects.forEach((object, objectIndex) => {
    if (object.asset && !assetsById.has(object.asset)) {
      issues.push(`objects[${objectIndex}].asset '${object.asset}' not found; available: ${available}`)
    }
    if (object.clone && object.clone.count < 1) {
      issues.push(`objects[${objectIndex}].clone.count must be >= 1`)
    }
    object.tracks.forEach((track, trackIndex) => {
      issues.push(...lintTrack(track, `objects[${objectIndex}].tracks[${trackIndex}]`))
    })
  })

  spec.camera.tracks.forEach((track, trackIndex) => {
    issues.push(...lintTrack(track, `camera.tracks[${trackIndex}]`))
  })

  if (spec.audio && !assetsById.has(spec.audio.asset)) {
    issues.push(`audio.asset '${spec.audio.asset}' not found; available: ${available}`)
  } else if (spec.audio && assetsById.get(spec.audio.asset)?.kind !== "audio") {
    issues.push(`audio.asset '${spec.audio.asset}' must reference an audio asset`)
  }

  return issues
}

export function frameCountForSpec(spec: SceneSpec): number {
  return Math.ceil(spec.durationSeconds * spec.fps)
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(Bun.argv.slice(2))
    const scenePath = resolve(args.scenePath)
    const spec = decodeSceneSpec(parseJsonText(await Bun.file(scenePath).text()))
    const issues = collectSceneIssues(spec)
    if (issues.length > 0) {
      console.error(issues.join("\n"))
      process.exitCode = 1
      return
    }
    console.log(`OK: ${spec.objects.length} objects, ${spec.assets.length} assets, ${frameCountForSpec(spec)} frames`)
    dirname(scenePath)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function lintTrack(track: TrackSpec, path: string): readonly string[] {
  const issues: string[] = []
  if (track.mode === "keyframes" && (!track.keyframes || track.keyframes.length === 0)) {
    issues.push(`${path}.keyframes required when mode is 'keyframes'`)
  }
  if (track.mode === "osc" && !track.osc) {
    issues.push(`${path}.osc required when mode is 'osc'`)
  }
  if (track.mode === "beat" && !track.beat) {
    issues.push(`${path}.beat required when mode is 'beat'`)
  }
  return issues
}

function parseArgs(argv: readonly string[]): CheckArgs {
  let scenePath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--scene") {
      scenePath = argv[index + 1]
      index += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (!scenePath) throw new Error("missing required --scene <spec.json>")
  return { scenePath }
}

if (import.meta.main) {
  await main()
}
