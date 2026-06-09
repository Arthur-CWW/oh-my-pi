#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { loadJimengSessionFromBrowser } from "./browser-session"
import { prepareFromCapture, redactHeaders, type CaptureFile, type JimengOp, type JimengSessionBundle } from "./capture"
import { JimengClient } from "./client"
import { JimengError } from "./errors"

const DEFAULT_CDP_URL = "http://127.0.0.1:9340"

const USAGE = `Usage: jimeng-browser-proxy <command> [options]

Browser-backed Jimeng proxy for the dedicated background Helium/CDP profile.
It refreshes the live frontend session from the browser, then uses the direct client.

Commands:
  session       Save a fresh session bundle from the logged-in Jimeng browser profile
  text2image    Submit text-to-image from a captured workbench/agent template
  text2video    Submit text-to-video from a captured workbench template

Options:
  --cdp <url>                   CDP URL (default: ${DEFAULT_CDP_URL})
  --target-url <substring>      Existing Jimeng page URL/title substring (default: jimeng.jianying.com)
  --session-out <file>          session command output (default: data/jimeng-lab/raw/session-bundle-current.json)
  --capture <file>              Capture template JSON for generation commands
  --prompt <text>               Generation prompt
  --outDir <dir>                Output directory (default: data/jimeng-lab/browser-proxy)
  --dryRun                      Write patched plan only; otherwise live-submit and may consume credits
  --noDownload                  Submit/poll but do not download artifacts
  --pollIntervalMs <ms>         Poll interval (default: 3000)
  --maxPolls <n>                Max polls (default: 30)
  --durationSec <sec>           Video duration seconds for text2video (default from capture/client)

Examples:
  jimeng-browser-proxy session

  jimeng-browser-proxy text2image \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json \\
    --prompt "韩系美妆健身UGC创作者，手机自拍，无文字，无水印" \\
    --dryRun

Live generation uses the browser session but does not foreground the browser. Keep concurrency at 1.`

interface CliArgs {
  command: "session" | "text2image" | "text2video"
  cdpUrl: string
  targetUrl?: string
  sessionOut: string
  capture?: string
  prompt?: string
  outDir: string
  dryRun: boolean
  noDownload: boolean
  pollIntervalMs: number
  maxPolls: number
  durationSec?: number
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const session = await loadJimengSessionFromBrowser({ cdpUrl: args.cdpUrl, targetUrl: args.targetUrl })

  if (args.command === "session") {
    const file = path.resolve(args.sessionOut)
    mkdirSync(path.dirname(file), { recursive: true })
    writeJson(file, session)
    console.log(`[jimeng-browser-proxy] session saved: ${file}`)
    return
  }

  if (!args.capture) throw new Error("--capture is required")

  const op: JimengOp = args.command === "text2image" ? "image" : "video"
  const runId = `${args.command}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
  const dirs = ensureOutputDirs(path.resolve(args.outDir))
  const capture = readJson(args.capture) as CaptureFile
  const prepared = prepareFromCapture({
    op,
    capture,
    session,
    prompt: args.prompt,
    durationSec: args.durationSec,
  })

  const plan = {
    command: args.command,
    op: prepared.op,
    submit_kind: prepared.submitKind,
    poll_kind: prepared.pollKind,
    submit_id: prepared.submitId,
    submit_url: prepared.submitUrl,
    poll_url: prepared.pollUrl,
    submit_headers: redactHeaders(prepared.submitHeaders),
    poll_headers: redactHeaders(prepared.pollHeaders),
    submit_body: prepared.submitBody,
    poll_body: prepared.pollBody,
    terminal_status: prepared.terminalStatus,
    browser_session: redactSession(session),
  }

  if (args.dryRun) {
    const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
    writeJson(file, plan)
    console.log(`[jimeng-browser-proxy] dry run saved: ${file}`)
    return
  }

  const client = new JimengClient()
  console.log(`[jimeng-browser-proxy] live submit command=${args.command} submitKind=${prepared.submitKind} pollKind=${prepared.pollKind}`)
  const submit = await client.submitPrepared(prepared)
  writeJson(path.join(dirs.rawDir, `${runId}-submit.json`), submit)
  console.log(`[jimeng-browser-proxy] submit accepted submitId=${submit.submitId} historyId=${submit.historyId ?? "n/a"}`)

  const poll = await client.pollUntilTerminal({
    pollUrl: prepared.pollUrl,
    pollHeaders: prepared.pollHeaders,
    submitId: submit.submitId,
    terminalStatus: prepared.terminalStatus,
    pollKind: prepared.pollKind,
    pollBody: prepared.pollBody,
    pollIntervalMs: args.pollIntervalMs,
    maxPolls: args.maxPolls,
  })
  writeJson(path.join(dirs.rawDir, `${runId}-poll.json`), poll)
  console.log(`[jimeng-browser-proxy] poll complete status=${poll.record.status ?? "unknown"} trace=${poll.trace.length}`)

  const artifacts = args.noDownload ? [] : await client.downloadArtifacts(prepared.op, poll.record)
  const manifest = []
  for (let i = 0; i < artifacts.length; i += 1) {
    const artifact = artifacts[i]!
    const ext = artifact.kind === "video" ? "mp4" : "png"
    const file = path.join(dirs.artifactsDir, `${submit.submitId}-${String(i).padStart(2, "0")}.${ext}`)
    writeFileSync(file, Buffer.from(artifact.bytes))
    manifest.push({ kind: artifact.kind, url: artifact.url, saved_file: file })
  }

  writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), { plan, submit, pollTrace: poll.trace, artifacts: manifest })
  console.log(`[jimeng-browser-proxy] done artifacts=${manifest.length}`)
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE)
    process.exit(0)
  }

  const command = argv[0]
  if (command !== "session" && command !== "text2image" && command !== "text2video") {
    throw new Error(`Unknown command: ${String(command)}`)
  }

  const flags = parseFlags(argv.slice(1))
  const durationSec = flags.durationSec
  return {
    command,
    cdpUrl: flags.cdp ?? DEFAULT_CDP_URL,
    targetUrl: flags["target-url"],
    sessionOut: flags["session-out"] ?? "data/jimeng-lab/raw/session-bundle-current.json",
    capture: flags.capture,
    prompt: flags.prompt,
    outDir: flags.outDir ?? "data/jimeng-lab/browser-proxy",
    dryRun: flags.dryRun === "true",
    noDownload: flags.noDownload === "true",
    pollIntervalMs: Number(flags.pollIntervalMs ?? 3000),
    maxPolls: Number(flags.maxPolls ?? 30),
    durationSec: durationSec ? Number(durationSec) : undefined,
  }
}

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith("--")) continue

    const eq = token.indexOf("=")
    if (eq > 2) {
      flags[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = "true"
    }
  }
  return flags
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

function redactSession(session: JimengSessionBundle): JimengSessionBundle {
  return {
    ...session,
    cookie: `[REDACTED ${session.cookie.length} chars]`,
  }
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
