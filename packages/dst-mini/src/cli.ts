#!/usr/bin/env bun
import { runReplicatedLogSimulation, searchReplicatedLog } from "./index"

interface CliOptions {
  mode: "buggy" | "fixed"
  seed?: number
  seeds: number
  steps: number
  verbose: boolean
  json: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: "buggy", seeds: 100, steps: 80, verbose: false, json: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--buggy") options.mode = "buggy"
    else if (arg === "--fixed") options.mode = "fixed"
    else if (arg === "--verbose") options.verbose = true
    else if (arg === "--json") options.json = true
    else if (arg === "--seed") options.seed = Number(argv[++i])
    else if (arg === "--seeds") options.seeds = Number(argv[++i])
    else if (arg === "--steps") options.steps = Number(argv[++i])
    else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.seeds) || options.seeds <= 0) throw new Error("--seeds must be a positive integer")
  if (!Number.isInteger(options.steps) || options.steps <= 0) throw new Error("--steps must be a positive integer")
  if (options.seed !== undefined && (!Number.isInteger(options.seed) || options.seed <= 0)) {
    throw new Error("--seed must be a positive integer")
  }

  return options
}

function printHelp(): void {
  console.log(`dst-mini: bounded deterministic simulation testing prototype

Usage:
  bun packages/dst-mini/src/cli.ts --buggy --seeds 200
  bun packages/dst-mini/src/cli.ts --buggy --seed 1 --verbose
  bun packages/dst-mini/src/cli.ts --fixed --seeds 200

Options:
  --buggy | --fixed   Select the demo replicated-log implementation.
  --seed N            Replay exactly one seed.
  --seeds N           Search N seeds, starting at 1. Default: 100.
  --steps N           Workload scheduling budget. Default: 80.
  --verbose           Include deterministic event trace for replay.
  --json              Print machine-readable JSON.
`)
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))

  if (options.seed !== undefined) {
    const result = runReplicatedLogSimulation({
      seed: options.seed,
      steps: options.steps,
      mode: options.mode,
      verbose: options.verbose,
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printRun(result)
    }
    process.exit(result.ok ? 0 : 1)
  }

  const search = searchReplicatedLog({ seeds: options.seeds, steps: options.steps, mode: options.mode })
  if (options.json) {
    console.log(JSON.stringify(search, null, 2))
  } else if (search.ok) {
    console.log(`ok: checked ${search.checked} ${options.mode} seeds without invariant failures`)
  } else if (search.firstFailure) {
    console.log(`failed: found invariant failure after ${search.checked} seed(s)`)
    printRun(search.firstFailure)
  }
  process.exit(search.ok ? 0 : 1)
}

type PrintableRun = ReturnType<typeof runReplicatedLogSimulation>

function printRun(result: PrintableRun): void {
  console.log(`${result.ok ? "ok" : "failed"}: seed=${result.seed} mode=${result.mode} steps=${result.steps}`)
  console.log(`acked writes: ${result.ackedWrites.length ? result.ackedWrites.join(", ") : "none"}`)
  console.log(`persisted by node: ${JSON.stringify(result.persistedByNode)}`)
  for (const violation of result.violations) {
    console.log(`violation: ${violation.property}`)
    console.log(`  ${violation.message}`)
  }
  console.log(`replay: ${result.replay}`)
  if (result.trace.length > 0) {
    console.log("trace:")
    for (const line of result.trace) console.log(`  ${line}`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
