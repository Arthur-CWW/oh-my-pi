#!/usr/bin/env bun

import { Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { readMachineState, syncFeeds } from "./engine"

const runtime = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(Terminal.Terminal, Terminal.make({
    columns: Effect.succeed(process.stdout.columns ?? 80),
    rows: Effect.succeed(process.stdout.rows ?? 24),
    readInput: Effect.die("Interactive input is unavailable"),
    readLine: Effect.die("Interactive input is unavailable"),
    display: (text) => Effect.sync(() => process.stdout.write(text)),
  })),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => Effect.die("Child process spawning is unavailable"))),
)

const syncCommand = Command.make("sync", { dryRun: Flag.boolean("dry-run") }, ({ dryRun }) =>
  Effect.tryPromise({
    try: async () => {
      const report = await syncFeeds({ dryRun })
      for (const diagnostic of report.diagnostics) {
        process.stdout.write(`${diagnostic.feed}: fetched=${diagnostic.fetched} candidates=${diagnostic.candidates}\n`)
        for (const failure of diagnostic.failures) process.stdout.write(`  failed: ${failure}\n`)
      }
      for (const candidate of report.candidates) process.stdout.write(`${dryRun ? "candidate" : "appended"}: ${candidate.observedAt.slice(0, 10)} ${candidate.source} [${candidate.matchedTerms.join(", ")}] "${candidate.quote}" ${candidate.url}\n`)
      process.stdout.write(`appended=${report.appended}\n`)
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  }))

const checkCommand = Command.make("check", {}, () => Effect.tryPromise({
  try: async () => {
    const state = await readMachineState()
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`)
    const resetTimes = Object.values(state.perSource).flatMap((source) => source.lastResetMentionAt ? [Date.parse(source.lastResetMentionAt)] : [])
    const lastReset = resetTimes.length > 0 ? Math.max(...resetTimes) : undefined
    process.stdout.write(`hoursSinceLastResetMention=${lastReset === undefined ? "unknown" : ((Date.now() - lastReset) / 3_600_000).toFixed(1)}\n`)
  },
  catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
}))

const watcherCommand = Command.make("availability").pipe(
  Command.withDescription("Synchronize registered public feeds into availability state"),
  Command.withSubcommands([syncCommand, checkCommand]),
)
const watcherCli = Command.runWith(watcherCommand, { version: "0.1.0" })

try {
  await Effect.runPromise(watcherCli(Bun.argv.slice(2)).pipe(Effect.provide(runtime)))
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
}
