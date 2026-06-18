#!/usr/bin/env bun
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { buildCookieHeaderFromCookieList, redactHeaders, type CaptureFile, type JimengSessionBundle } from "./capture"
import { JimengClient } from "./client"
import { DREAMINA_COMPAT_CAPABILITIES, prepareDreaminaCompat, type DreaminaCompatCommand } from "./dreamina-compatible"
import { JimengArtifactLog, type JimengArtifactInput } from "./artifact-log"
import { JimengError } from "./errors"

const USAGE = `Usage: jimeng-dreamina <command> [options]

Dreamina-compatible direct client backed by reversed Jimeng/Dreamina web endpoints.
This is NOT the official dreamina CLI; it uses local capture templates + browser session bundles.

Commands:
  capabilities          Show direct-compatibility status for official-like commands
  text2video            Direct text-to-video using captured workbench template
  text2image            Direct text-to-image using captured agent/image template
  image2video           Partial: requires confirmed --firstFrameUri; local upload not reversed yet
  frames2video          Partial: requires confirmed --firstFrameUri/--lastFrameUri; local upload not reversed yet
  image2image           Not implemented: needs capture
  multiframe2video      Not implemented: needs capture
  multimodal2video      Not implemented: needs capture
  image_upscale         Not implemented: needs capture

Common options:
  --capture <file>              Capture template JSON
  --session-bundle <file>       Session bundle JSON
  --cookies-file <file>         Cookie list fallback instead of session bundle
  --prompt <text>               Generation prompt
  --outDir <dir>                Output directory (default: data/jimeng-lab/direct-compat)
  --dryRun                      Write patched plan only; otherwise submit live and consume credits
  --noDownload                  Submit/poll but do not download artifacts
  --pollIntervalMs <ms>         Poll interval (default: 3000)
  --maxPolls <n>                Max polls (default: 30)
  --artifact-db <file>          Optional SQLite dashboard DB to update with run/artifact status
  --worker <id>                 Optional dashboard worker id
  --artifact-notes <text>       Optional dashboard notes for this run

Video options:
  --duration <sec>              Official-style duration alias
  --durationSec <sec>           Direct duration seconds
  --ratio <ratio>               e.g. 16:9, 9:16
  --video_resolution <value>    Official-style alias, e.g. 720p
  --videoResolution <value>     Direct alias
  --model_version <value>       Official-style alias. Confirmed direct mapping: 3.0fast/3.0_fast
  --modelVersion <value>        Direct alias
  --modelReqKey <key>           Confirmed raw model_req_key from capture
  --seed <int>                  Optional deterministic seed
  --firstFrameUri <uri>         Confirmed provider URI for first frame
  --lastFrameUri <uri>          Confirmed provider URI for last frame
  --image <path>                Parsed for compatibility, but local upload is not reversed yet

Examples:
  jimeng-dreamina capabilities

  jimeng-dreamina text2video \
    --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
    --session-bundle data/jimeng-lab/raw/session-bundle.json \
    --prompt "赛博海豹，电影感，无文字" \
    --duration=3 \
    --ratio=16:9 \
    --model_version=3.0fast \
    --dryRun

Live runs consume credits by default. Use --dryRun to only write the patched request plan.`

interface CliArgs {
  command: DreaminaCompatCommand | "capabilities"
  capture?: string
  sessionBundle?: string
  cookiesFile?: string
  prompt?: string
  outDir: string
  dryRun: boolean
  noDownload: boolean
  pollIntervalMs: number
  maxPolls: number
  durationSec?: number
  ratio?: string
  videoResolution?: string
  modelVersion?: string
  modelReqKey?: string
  seed?: number
  firstFrameUri?: string
  lastFrameUri?: string
  localImages: string[]
  artifactDb?: string
  worker?: string
  artifactNotes?: string
}

interface ArtifactLogger {
  log: JimengArtifactLog
  runId: string
  command: string
  commandCwd: string
  proofRoot: string
  startedAtIso: string
}

interface ArtifactManifestEntry {
  kind: string
  url: string
  saved_file: string
}

interface RunUpdate {
  status: string
  resultJson?: string
  submitId?: string
  historyId?: string
  finishedAtIso?: string
  prompt?: string
  functionName?: string
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  if (args.command === "capabilities") {
    console.log(JSON.stringify(DREAMINA_COMPAT_CAPABILITIES, null, 2))
    return
  }

  if (!args.capture) throw new Error("--capture is required")
  if (!args.sessionBundle && !args.cookiesFile) throw new Error("--session-bundle or --cookies-file is required")
  const runId = `${args.command}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
  const outDir = path.resolve(args.outDir)
  const dirs = ensureOutputDirs(outDir)
  const artifactLogger = openArtifactLogger(args, runId, argv, outDir)
  try {
    if (artifactLogger) {
      upsertArtifactRun(artifactLogger, args, { status: "in_progress", prompt: args.prompt })
      artifactLogger.log.addEvent({ runId, level: "info", message: "Dreamina-compatible CLI run started" })
    }
    await runDreaminaCommand(args, runId, dirs, artifactLogger)
  } catch (error) {
    if (artifactLogger) {
      upsertArtifactRun(artifactLogger, args, {
        status: "failed",
        finishedAtIso: new Date().toISOString(),
        prompt: args.prompt,
      })
      artifactLogger.log.addEvent({
        runId,
        level: "error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    artifactLogger?.log.close()
  }
}

async function runDreaminaCommand(
  args: CliArgs,
  runId: string,
  dirs: { rawDir: string; normalizedDir: string; artifactsDir: string },
  artifactLogger: ArtifactLogger | null,
): Promise<void> {
  const capture = readJson(requiredString(args.capture, "--capture")) as CaptureFile
  const session = loadSession(args)
  const command = runnableCommand(args.command)
  const prepared = prepareDreaminaCompat({
    command,
    capture,
    session,
    prompt: args.prompt,
    durationSec: args.durationSec,
    ratio: args.ratio,
    videoResolution: args.videoResolution,
    modelVersion: args.modelVersion,
    modelReqKey: args.modelReqKey,
    seed: args.seed,
    firstFrameUri: args.firstFrameUri,
    lastFrameUri: args.lastFrameUri,
    localImages: args.localImages,
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
  }

  if (args.dryRun) {
    const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
    writeJson(file, plan)
    if (artifactLogger) {
      upsertArtifactRun(artifactLogger, args, {
        status: "dry_run",
        functionName: `${args.command} / ${prepared.op}`,
        resultJson: file,
        submitId: prepared.submitId,
        finishedAtIso: new Date().toISOString(),
        prompt: args.prompt,
      })
      artifactLogger.log.replaceArtifacts(runId, [artifactInputForFile(runId, artifactLogger.proofRoot, file, "dry-run-plan")])
      artifactLogger.log.addEvent({ runId, level: "info", message: `Dry run plan saved to ${path.relative(artifactLogger.proofRoot, file)}` })
    }
    console.log(`[jimeng-dreamina] dry run saved: ${file}`)
    return
  }

  const client = new JimengClient()
  console.log(`[jimeng-dreamina] live submit command=${args.command} op=${prepared.op}`)
  const submit = await client.submitPrepared(prepared)
  writeJson(path.join(dirs.rawDir, `${runId}-submit.json`), submit)
  if (artifactLogger) {
    upsertArtifactRun(artifactLogger, args, {
      status: "in_progress",
      functionName: `${args.command} / ${prepared.op}`,
      submitId: submit.submitId,
      historyId: submit.historyId ?? undefined,
      prompt: args.prompt,
    })
    artifactLogger.log.addEvent({ runId, level: "info", message: `Submit accepted submitId=${submit.submitId}` })
  }
  console.log(`[jimeng-dreamina] submit accepted submitId=${submit.submitId} historyId=${submit.historyId ?? "n/a"}`)

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
  console.log(`[jimeng-dreamina] poll complete status=${poll.record.status ?? "unknown"} trace=${poll.trace.length}`)

  const artifacts = args.noDownload ? [] : await client.downloadArtifacts(prepared.op, poll.record)
  const manifest: ArtifactManifestEntry[] = []
  for (let i = 0; i < artifacts.length; i += 1) {
    const artifact = artifacts[i]!
    const ext = artifact.kind === "video" ? "mp4" : "png"
    const file = path.join(dirs.artifactsDir, `${submit.submitId}-${String(i).padStart(2, "0")}.${ext}`)
    writeFileSync(file, Buffer.from(artifact.bytes))
    manifest.push({ kind: artifact.kind, url: artifact.url, saved_file: file })
  }

  const resultFile = path.join(dirs.normalizedDir, `${runId}-result.json`)
  writeJson(resultFile, { plan, submit, pollTrace: poll.trace, artifacts: manifest })
  if (artifactLogger) {
    upsertArtifactRun(artifactLogger, args, {
      status: "success",
      functionName: `${args.command} / ${prepared.op}`,
      resultJson: resultFile,
      submitId: submit.submitId,
      historyId: submit.historyId ?? undefined,
      finishedAtIso: new Date().toISOString(),
      prompt: args.prompt,
    })
    artifactLogger.log.replaceArtifacts(runId, manifest.map((artifact) => artifactInputForManifest(runId, artifactLogger.proofRoot, artifact)))
    artifactLogger.log.addEvent({ runId, level: "info", message: `Run completed with ${manifest.length} artifacts` })
  }
  console.log(`[jimeng-dreamina] done artifacts=${manifest.length}`)
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE)
    process.exit(0)
  }

  const command = argv[0] as CliArgs["command"]
  const known = new Set<string>(["capabilities", ...DREAMINA_COMPAT_CAPABILITIES.map((capability) => capability.command)])
  if (!known.has(command)) throw new Error(`Unknown command: ${String(command)}`)

  const flags = parseFlags(argv.slice(1))
  const duration = singleFlag(flags, "durationSec") ?? singleFlag(flags, "duration")
  const videoResolution = singleFlag(flags, "videoResolution") ?? singleFlag(flags, "video_resolution")
  const modelVersion = singleFlag(flags, "modelVersion") ?? singleFlag(flags, "model_version")
  const seed = singleFlag(flags, "seed")

  return {
    command,
    capture: singleFlag(flags, "capture"),
    sessionBundle: singleFlag(flags, "session-bundle"),
    cookiesFile: singleFlag(flags, "cookies-file"),
    prompt: singleFlag(flags, "prompt"),
    outDir: singleFlag(flags, "outDir") ?? "data/jimeng-lab/direct-compat",
    dryRun: singleFlag(flags, "dryRun") === "true",
    noDownload: singleFlag(flags, "noDownload") === "true",
    pollIntervalMs: Number(singleFlag(flags, "pollIntervalMs") ?? 3000),
    maxPolls: Number(singleFlag(flags, "maxPolls") ?? 30),
    durationSec: duration ? Number(duration) : undefined,
    ratio: singleFlag(flags, "ratio"),
    videoResolution,
    modelVersion,
    modelReqKey: singleFlag(flags, "modelReqKey"),
    seed: seed ? Number(seed) : undefined,
    firstFrameUri: singleFlag(flags, "firstFrameUri"),
    lastFrameUri: singleFlag(flags, "lastFrameUri"),
    localImages: collectRepeated(flags, "image"),
    artifactDb: singleFlag(flags, "artifact-db"),
    worker: singleFlag(flags, "worker"),
    artifactNotes: singleFlag(flags, "artifact-notes"),
  }
}

function parseFlags(argv: string[]): Record<string, string | string[]> {
  const flags: Record<string, string | string[]> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith("--")) continue

    const eq = token.indexOf("=")
    const key = eq > 2 ? token.slice(2, eq) : token.slice(2)
    const value = eq > 2 ? token.slice(eq + 1) : (argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true")
    const existing = flags[key]
    if (existing === undefined) flags[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else flags[key] = [existing, value]
  }
  return flags
}

function singleFlag(flags: Record<string, string | string[]>, key: string): string | undefined {
  const value = flags[key]
  if (Array.isArray(value)) return value.at(-1)
  return value
}

function collectRepeated(flags: Record<string, string | string[]>, key: string): string[] {
  const value = flags[key]
  if (Array.isArray(value)) return value
  return typeof value === "string" && value !== "true" ? [value] : []
}

function loadSession(args: Pick<CliArgs, "sessionBundle" | "cookiesFile">): JimengSessionBundle {
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

function openArtifactLogger(
  args: CliArgs,
  runId: string,
  argv: string[],
  proofRoot: string,
): ArtifactLogger | null {
  if (!args.artifactDb) return null
  return {
    log: new JimengArtifactLog({ dbPath: path.resolve(args.artifactDb) }),
    runId,
    command: buildReproCommand(argv),
    commandCwd: process.cwd(),
    proofRoot,
    startedAtIso: new Date().toISOString(),
  }
}

function upsertArtifactRun(logger: ArtifactLogger, args: CliArgs, update: RunUpdate): void {
  logger.log.upsertRun({
    id: logger.runId,
    workerId: args.worker,
    functionName: update.functionName ?? String(args.command),
    command: logger.command,
    commandCwd: logger.commandCwd,
    status: update.status,
    notes: args.artifactNotes,
    proofRoot: logger.proofRoot,
    resultJson: update.resultJson,
    submitId: update.submitId,
    historyId: update.historyId,
    prompt: update.prompt,
    startedAtIso: logger.startedAtIso,
    finishedAtIso: update.finishedAtIso,
  })
}

function artifactInputForManifest(runId: string, proofRoot: string, artifact: ArtifactManifestEntry): JimengArtifactInput {
  return artifactInputForFile(runId, proofRoot, artifact.saved_file, artifact.kind, redactSignedUrlValue(artifact.url))
}

function artifactInputForFile(
  runId: string,
  proofRoot: string,
  file: string,
  kind: string,
  urlRedacted?: string,
): JimengArtifactInput {
  const absolute = path.resolve(file)
  return {
    runId,
    kind,
    path: absolute,
    relativePath: path.relative(proofRoot, absolute) || path.basename(absolute),
    mime: mimeForFile(absolute),
    sizeBytes: sizeForFile(absolute),
    ...(urlRedacted ? { urlRedacted } : {}),
  }
}

function mimeForFile(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".mp4") return "video/mp4"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".json") return "application/json"
  return "application/octet-stream"
}

function sizeForFile(file: string): number | null {
  try {
    return statSync(file).size
  } catch {
    return null
  }
}

function redactSignedUrlValue(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ""
    return parsed.toString()
  } catch {
    return "[unparseable-url]"
  }
}

function buildReproCommand(argv: string[]): string {
  return ["bun", "packages/jimeng-client/src/dreamina-compatible-cli.ts", ...argv].map(shellQuote).join(" ")
}
function requiredString(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`)
  return value
}

function runnableCommand(command: CliArgs["command"]): DreaminaCompatCommand {
  if (command === "capabilities") throw new Error("capabilities is not runnable")
  return command
}


function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
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
