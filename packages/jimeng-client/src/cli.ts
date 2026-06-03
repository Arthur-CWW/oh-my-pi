#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { buildCookieHeaderFromCookieList, prepareFromCapture, redactHeaders, type CaptureFile, type JimengOp, type JimengSessionBundle } from "./capture"
import { JimengClient } from "./client"
import { JimengError } from "./errors"

const USAGE = `Usage: jimeng-direct --op <video|image> --capture <capture.json> (--session-bundle <bundle.json> | --cookies-file <cookies.txt>) [options]

Options:
  --prompt <text>              Prompt to inject into captured template
  --durationSec <1-15>         Video duration seconds (default: 3)
  --firstFrameUri <uri>        Payload-level first frame URI injection
  --lastFrameUri <uri>         Payload-level last frame URI injection
  --outDir <dir>               Output directory (default: data/jimeng-lab)
  --pollIntervalMs <ms>        Poll interval (default: 3000)
  --maxPolls <n>               Max polls (default: 30)
  --dryRun                     Write patched request plan only
  --noDownload                 Submit/poll but do not download artifacts
  --help                       Show help

Use --dryRun first. Live runs can consume paid quota.`

interface CliArgs {
  op: JimengOp
  capture: string
  cookiesFile?: string
  sessionBundle?: string
  prompt?: string
  durationSec: number
  firstFrameUri?: string
  lastFrameUri?: string
  outDir: string
  pollIntervalMs: number
  maxPolls: number
  dryRun: boolean
  noDownload: boolean
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const runId = `${args.op}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
  const dirs = ensureOutputDirs(path.resolve(args.outDir))
  const capture = readJson(args.capture) as CaptureFile
  const session = loadSession(args)
  const prepared = prepareFromCapture({
    op: args.op,
    capture,
    session,
    prompt: args.prompt,
    durationSec: args.durationSec,
    firstFrameUri: args.firstFrameUri,
    lastFrameUri: args.lastFrameUri,
  })

  const plan = {
    op: prepared.op,
    submit_id: prepared.submitId,
    submit_url: prepared.submitUrl,
    poll_url: prepared.pollUrl,
    submit_headers: redactHeaders(prepared.submitHeaders),
    poll_headers: redactHeaders(prepared.pollHeaders),
    submit_body: prepared.submitBody,
    terminal_status: prepared.terminalStatus,
  }

  if (args.dryRun) {
    const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
    writeJson(file, plan)
    console.log(`[jimeng] dry run saved: ${file}`)
    return
  }

  const client = new JimengClient()
  console.log(`[jimeng] start op=${args.op} pollIntervalMs=${args.pollIntervalMs} maxPolls=${args.maxPolls}`)
  const submit = await client.submitPrepared(prepared)
  writeJson(path.join(dirs.rawDir, `${runId}-submit.json`), submit)
  console.log(`[jimeng] submit accepted submitId=${submit.submitId} historyId=${submit.historyId ?? "n/a"}`)

  const poll = await client.pollUntilTerminal({
    pollUrl: prepared.pollUrl,
    pollHeaders: prepared.pollHeaders,
    submitId: submit.submitId,
    terminalStatus: prepared.terminalStatus,
    pollIntervalMs: args.pollIntervalMs,
    maxPolls: args.maxPolls,
  })
  writeJson(path.join(dirs.rawDir, `${runId}-poll.json`), poll)
  console.log(`[jimeng] poll complete status=${poll.record.status ?? "unknown"} trace=${poll.trace.length}`)

  const artifacts = args.noDownload ? [] : await client.downloadArtifacts(args.op, poll.record)
  const manifest = []
  for (let i = 0; i < artifacts.length; i += 1) {
    const artifact = artifacts[i]!
    const ext = artifact.kind === "video" ? "mp4" : "png"
    const file = path.join(dirs.artifactsDir, `${submit.submitId}-${String(i).padStart(2, "0")}.${ext}`)
    writeFileSync(file, Buffer.from(artifact.bytes))
    manifest.push({ kind: artifact.kind, url: artifact.url, saved_file: file })
  }

  const result = { plan, submit, pollTrace: poll.trace, artifacts: manifest }
  writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), result)
  console.log(`[jimeng] done artifacts=${manifest.length}`)
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    process.exit(0)
  }

  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = "true"
    }
  }

  const op = flags.op
  if (op !== "video" && op !== "image") throw new Error("--op must be video or image")
  if (!flags.capture) throw new Error("--capture is required")
  if (!flags["session-bundle"] && !flags["cookies-file"]) throw new Error("--session-bundle or --cookies-file is required")

  return {
    op,
    capture: flags.capture,
    cookiesFile: flags["cookies-file"],
    sessionBundle: flags["session-bundle"],
    prompt: flags.prompt,
    durationSec: Number(flags.durationSec ?? 3),
    firstFrameUri: flags.firstFrameUri,
    lastFrameUri: flags.lastFrameUri,
    outDir: flags.outDir ?? "data/jimeng-lab",
    pollIntervalMs: Number(flags.pollIntervalMs ?? 3000),
    maxPolls: Number(flags.maxPolls ?? 30),
    dryRun: flags.dryRun === "true",
    noDownload: flags.noDownload === "true",
  }
}

function loadSession(args: CliArgs): JimengSessionBundle {
  if (args.sessionBundle) return readJson(args.sessionBundle) as JimengSessionBundle
  if (!args.cookiesFile) throw new Error("missing --cookies-file")
  return { cookie: buildCookieHeaderFromCookieList(readFileSync(args.cookiesFile, "utf8")) }
}

function ensureOutputDirs(outDir: string): { rawDir: string; normalizedDir: string; artifactsDir: string } {
  const rawDir = path.join(outDir, "raw")
  const normalizedDir = path.join(outDir, "normalized")
  const artifactsDir = path.join(outDir, "artifacts")
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(normalizedDir, { recursive: true })
  mkdirSync(artifactsDir, { recursive: true })
  return { rawDir, normalizedDir, artifactsDir }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"))
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof JimengError) {
      console.error(JSON.stringify(error.toJSON(), null, 2))
      process.exit(error.retryable ? 2 : 1)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
