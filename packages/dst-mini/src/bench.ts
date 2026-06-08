#!/usr/bin/env bun
import { runReplicatedLogSimulation } from "./index"

interface BenchOptions {
  mode: "buggy" | "fixed"
  seeds: number
  steps: number
}

function parseArgs(argv: string[]): BenchOptions {
  const options: BenchOptions = { mode: "fixed", seeds: 10_000, steps: 80 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--buggy") options.mode = "buggy"
    else if (arg === "--fixed") options.mode = "fixed"
    else if (arg === "--seeds") options.seeds = Number(argv[++i])
    else if (arg === "--steps") options.steps = Number(argv[++i])
    else if (arg === "--help" || arg === "-h") {
      console.log(`dst-mini bench\n\nUsage:\n  bun packages/dst-mini/src/bench.ts --fixed --seeds 10000 --steps 80`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const start = performance.now()
let failures = 0
for (let seed = 1; seed <= options.seeds; seed++) {
  const result = runReplicatedLogSimulation({ mode: options.mode, seed, steps: options.steps, verbose: false })
  if (!result.ok) failures++
}
const seconds = (performance.now() - start) / 1000
console.log(
  JSON.stringify({
    runtime: "bun-typescript",
    mode: options.mode,
    checked: options.seeds,
    failures,
    seconds: Number(seconds.toFixed(6)),
    seedsPerSecond: Number((options.seeds / seconds).toFixed(2)),
  }),
)
