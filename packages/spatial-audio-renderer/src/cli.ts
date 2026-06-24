#!/usr/bin/env bun
import { renderSpatialAudioProof } from "./index"

interface Args {
  command: "render" | "help"
  voiceAssetsPath?: string
  stemsPath?: string
  spatialManifestPath?: string
  outDir?: string
  outputPath?: string
  outputManifestPath?: string
}

function main(argv: string[]): void {
  const args = parseArgs(argv)
  if (args.command === "help") {
    process.stdout.write(usage())
    return
  }
  if (!args.voiceAssetsPath || !args.stemsPath || !args.spatialManifestPath) {
    throw new Error("--voice-assets, --stems, and --spatial are required")
  }

  const result = renderSpatialAudioProof({
    voiceAssetsPath: args.voiceAssetsPath,
    stemsPath: args.stemsPath,
    spatialManifestPath: args.spatialManifestPath,
    outDir: args.outDir,
    outputPath: args.outputPath,
    outputManifestPath: args.outputManifestPath,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function parseArgs(argv: string[]): Args {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") return { command: "help" }
  const [command, ...rest] = argv
  if (command !== "render") {
    throw new Error(`unknown command: ${command}`)
  }
  const args: Args = { command }
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (!flag.startsWith("--")) throw new Error(`unexpected argument: ${flag}`)
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`)
    index += 1
    switch (flag) {
      case "--voice-assets":
        args.voiceAssetsPath = value
        break
      case "--stems":
        args.stemsPath = value
        break
      case "--spatial":
        args.spatialManifestPath = value
        break
      case "--outDir":
        args.outDir = value
        break
      case "--output":
        args.outputPath = value
        break
      case "--output-manifest":
        args.outputManifestPath = value
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }
  return args
}

function usage(): string {
  return `Usage:\n  bun packages/spatial-audio-renderer/src/cli.ts render \\\n    --voice-assets packages/media-contracts/fixtures/valid/voice-assets.v1.json \\\n    --stems packages/spatial-audio-renderer/fixtures/asmr-scene/asmr-stems.v1.json \\\n    --spatial packages/spatial-audio-renderer/fixtures/asmr-scene/spatial-audio-manifest.v1.json \\\n    --outDir data/asmr-companion/goal3-spatial-proof\n\nWrites a deterministic 16-bit stereo WAV master plus a Remotion-compatible render-output manifest.\n`
}

try {
  main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`spatial-audio-renderer: ${message}\n`)
  process.exitCode = 1
}
