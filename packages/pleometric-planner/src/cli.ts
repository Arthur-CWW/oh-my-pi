#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  buildGoal4PipelineHandoff,
  decodeBrainrotReferentialMirrorCard,
  type BrainrotReferentialMirrorCard,
} from "./index"

interface Args {
  cards: string[]
  generatedClips: string
  spatialRenderOutput: string
  out: string
  bundleId: string
  createdAt: string
}

function main(argv: string[]): void {
  const args = parseArgs(argv)
  const cards = args.cards.map((cardPath) => readCard(cardPath))
  const handoff = buildGoal4PipelineHandoff({
    bundleId: args.bundleId,
    createdAt: args.createdAt,
    cards,
    generatedClipsManifest: readJson(args.generatedClips),
    generatedClipsManifestPath: args.generatedClips,
    spatialRenderOutput: readJson(args.spatialRenderOutput),
    spatialRenderOutputPath: args.spatialRenderOutput,
  })

  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, `${JSON.stringify(handoff, null, 2)}\n`)
  process.stdout.write(`pleometric-planner wrote ${args.out}\n`)
}

function parseArgs(argv: string[]): Args {
  if (argv.length === 0 || argv.includes("--help")) {
    throw new Error(usage())
  }

  const cards: string[] = []
  let generatedClips = ""
  let spatialRenderOutput = ""
  let out = ""
  let bundleId = "goal4-pleometric-handoff-001"
  let createdAt = "2026-06-24T00:00:00.000Z"

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    switch (arg) {
      case "build-handoff":
        break
      case "--card":
        cards.push(requireValue(value, arg))
        index += 1
        break
      case "--generated-clips":
        generatedClips = requireValue(value, arg)
        index += 1
        break
      case "--spatial-render-output":
        spatialRenderOutput = requireValue(value, arg)
        index += 1
        break
      case "--out":
        out = requireValue(value, arg)
        index += 1
        break
      case "--bundle-id":
        bundleId = requireValue(value, arg)
        index += 1
        break
      case "--created-at":
        createdAt = requireValue(value, arg)
        index += 1
        break
      default:
        throw new Error(`unknown argument: ${arg}\n${usage()}`)
    }
  }

  if (cards.length === 0) throw new Error(`missing --card\n${usage()}`)
  if (generatedClips.length === 0) throw new Error(`missing --generated-clips\n${usage()}`)
  if (spatialRenderOutput.length === 0) throw new Error(`missing --spatial-render-output\n${usage()}`)
  if (out.length === 0) throw new Error(`missing --out\n${usage()}`)

  return { cards, generatedClips, spatialRenderOutput, out, bundleId, createdAt }
}

function readCard(path: string): BrainrotReferentialMirrorCard {
  return decodeBrainrotReferentialMirrorCard(readJson(path))
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown
}

function requireValue(value: string | undefined, label: string): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`missing value for ${label}`)
  }
  return value
}

function usage(): string {
  return `Usage:\n  bun packages/pleometric-planner/src/cli.ts build-handoff \\\n    --card packages/pleometric-planner/fixtures/cards/asmr-companion-moonlit.card.json \\\n    --card packages/pleometric-planner/fixtures/cards/high-aura-orbit.card.json \\\n    --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json \\\n    --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json \\\n    --out data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json\n`
}

try {
  main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`pleometric-planner: ${message}\n`)
  process.exitCode = 1
}
