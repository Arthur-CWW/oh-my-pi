import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { executeChineseReadingReviewCell } from "../src/chinese-reading-review-cell"
import { decodeValidationCellManifest } from "../src/validation-cell-contract"
import { runValidationCell, type ValidationCellExecutor } from "../src/validation-cell-runner"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)))
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..")
const DEFAULT_MANIFEST = resolve(PACKAGE_ROOT, "validation/cells/chinese-reading-review.v1.json")

const EXECUTORS: Record<string, ValidationCellExecutor> = {
  "chinese-reading-review": executeChineseReadingReviewCell,
}

export async function runValidationCellCli(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  const manifest = decodeValidationCellManifest(JSON.parse(readFileSync(options.manifestPath, "utf8")) as unknown)
  const executor = EXECUTORS[manifest.cell.id]
  if (executor === undefined) throw new Error(`unknown Primer validation cell: ${manifest.cell.id}`)
  const receipt = await runValidationCell({
    manifestPath: options.manifestPath,
    repositoryRoot: REPOSITORY_ROOT,
    outputRoot: options.outputRoot,
    executor,
  })
  process.stdout.write(`${JSON.stringify({
    outcome: receipt.outcome,
    cell: receipt.manifest.cellId,
    layers: receipt.layers,
    counts: receipt.counts,
    control: receipt.negativeControl.observedInvariantFailure,
  })}\n`)
  return receipt.outcome === "passed" ? 0 : 1
}

interface CliOptions {
  manifestPath: string
  outputRoot?: string
}

function parseArgs(argv: readonly string[]): CliOptions {
  let manifestPath = DEFAULT_MANIFEST
  let outputRoot: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--manifest") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--manifest requires a path")
      manifestPath = resolve(value)
      index += 1
      continue
    }
    if (argument === "--output") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--output requires a path")
      outputRoot = resolve(value)
      index += 1
      continue
    }
    throw new Error(`unknown validation option: ${argument}`)
  }
  return outputRoot === undefined ? { manifestPath } : { manifestPath, outputRoot }
}

if (import.meta.main) {
  try {
    process.exitCode = await runValidationCellCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
