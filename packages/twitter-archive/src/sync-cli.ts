#!/usr/bin/env bun
import { runSyncTick, type SyncTickReport } from "./sync-scheduler"

const command = Bun.argv[2] ?? "tick"
const policyPath = valueFlag("--policy")
const dbPath = valueFlag("--db")
const intervalMs = numberFlag("--interval-ms") ?? 60_000

if (command === "tick") {
  await tickOnce()
} else if (command === "daemon") {
  await runDaemon()
} else {
  throw new Error(`unknown sync command: ${command}`)
}

async function tickOnce(): Promise<void> {
  const report = await runSyncTick({ policyPath, dbPath })
  printReport(report)
  if (report.failed > 0) process.exitCode = 1
}

async function runDaemon(): Promise<void> {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error("--interval-ms must be a positive integer")
  const abort = new AbortController()
  process.once("SIGINT", () => abort.abort())
  process.once("SIGTERM", () => abort.abort())
  while (!abort.signal.aborted) {
    await tickOnce()
    if (process.exitCode) process.exitCode = 0
    await sleep(intervalMs, abort.signal)
  }
}

function printReport(report: SyncTickReport): void {
  for (const bucket of report.buckets) {
    console.log(JSON.stringify({ event: "bucket", ...bucket }))
  }
  for (const account of report.accounts) {
    console.log(JSON.stringify({ event: "account", ...account }))
  }
  console.log(`sync:tick due=${report.due} synced=${report.synced} deferred=${report.deferred} failed=${report.failed}`)
}

function valueFlag(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  if (index < 0) return undefined
  const value = Bun.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function numberFlag(name: string): number | undefined {
  const value = valueFlag(name)
  return value === undefined ? undefined : Number(value)
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
