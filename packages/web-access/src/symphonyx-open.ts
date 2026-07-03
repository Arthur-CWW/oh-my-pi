import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent"
import { openPath } from "@oh-my-pi/pi-coding-agent/utils/open"

export type SymphonyxOpenKind = "agent" | "session"

export interface SymphonyxOpenArgs {
  kind: SymphonyxOpenKind
  agentId?: string
  provider?: string
  sessionId?: string
  root?: string
  help: boolean
}

export interface SymphonyxOpenResult {
  kind: string
  id: string
  target: string
  opened: boolean
}

interface SymphonyxEnvelope {
  ok: boolean
  data?: SymphonyxOpenResult
  error?: {
    code?: string
    message?: string
  }
}

const CUSTOM_TYPE = "symphonyx-open"
const DEFAULT_ROOT = "data/symphonyx"

export function usageText(): string {
  return [
    "Usage: /symphonyx-open agent <id> [--root <dir>]",
    "       /symphonyx-open session <provider> <id> [--root <dir>]",
    "",
    "Open a SymphonyX agent or external session target via OMP's OS opener.",
    "Default root is data/symphonyx relative to the repo root.",
  ].join("\n")
}

export function parseSymphonyxOpenArgs(rawArgs: string): SymphonyxOpenArgs {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean)
  const parsed: SymphonyxOpenArgs = { kind: "agent", help: false }
  let i = 0
  if (parts[0] === "agent" || parts[0] === "session") {
    parsed.kind = parts[0]
    i = 1
  }

  while (i < parts.length) {
    const part = parts[i]!
    if (part === "--help" || part === "-h") {
      parsed.help = true
      i++
    } else if (part === "--root") {
      const next = parts[i + 1]
      if (next) {
        parsed.root = next
        i += 2
      } else {
        i++
      }
    } else if (part.startsWith("--root=")) {
      parsed.root = part.slice("--root=".length)
      i++
    } else if (parsed.kind === "agent" && !parsed.agentId) {
      parsed.agentId = part
      i++
    } else if (parsed.kind === "session" && !parsed.provider) {
      parsed.provider = part
      i++
    } else if (parsed.kind === "session" && parsed.provider && !parsed.sessionId) {
      parsed.sessionId = part
      i++
    } else {
      i++
    }
  }

  return parsed
}

export function findRepoRoot(cwd: string): string | undefined {
  let dir = resolve(cwd)
  while (true) {
    if (existsSync(join(dir, "packages", "symphony-lite-rs", "Cargo.toml"))) return dir
    if (existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

function resolveRoot(args: SymphonyxOpenArgs, cwd: string): string {
  if (args.root) return resolve(cwd, args.root)
  const repoRoot = findRepoRoot(cwd)
  return repoRoot ? join(repoRoot, DEFAULT_ROOT) : resolve(cwd, DEFAULT_ROOT)
}

function hasSymphonyxOnPath(): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>()
  execFile("symphonyx", ["--help"], (err) => resolve(err === null))
  return promise
}

function execSymphonyx(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ stdout: string; stderr: string }>()
  execFile(
    command,
    args,
    { cwd: options.cwd, timeout: options.timeout ?? 60_000, maxBuffer: 8 * 1024 * 1024 },
    (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.toString().trim() || err.message))
        return
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    },
  )
  return promise
}


type SymphonyxExecutor = (
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>

export interface RunSymphonyxOpenOptions {
  cwd: string
  repoRoot?: string
  defaultRoot?: string
  timeoutMs?: number
  /**
   * Override the symphonyx executable path. Intended for tests; production code
   * should leave this unset so the command is discovered on PATH or via cargo.
   */
  symphonyxCommand?: string
  /**
   * Override the target opener. Intended for tests; production code should leave
   * this unset so openPath() is used.
   */
  openTarget?: (target: string) => void
  /**
   * Override process execution. Intended for tests.
   */
  execCommand?: SymphonyxExecutor
}

export async function runSymphonyxOpen(
  rawArgs: string,
  options: RunSymphonyxOpenOptions,
): Promise<{ result: SymphonyxOpenResult; openedByOmp: boolean; commandUsed: string }> {
  const args = parseSymphonyxOpenArgs(rawArgs)
  if (args.help) {
    return Promise.reject(new UsageError(usageText()))
  }

  if (args.kind === "agent" && !args.agentId) {
    return Promise.reject(new UsageError("Missing agent id.\n\n" + usageText()))
  }
  if (args.kind === "session" && (!args.provider || !args.sessionId)) {
    return Promise.reject(new UsageError("Missing session provider or id.\n\n" + usageText()))
  }

  const root = args.root
    ? resolve(options.cwd, args.root)
    : (options.defaultRoot ?? join(options.repoRoot ?? findRepoRoot(options.cwd) ?? options.cwd, DEFAULT_ROOT))

  const commandFromOptions = options.symphonyxCommand
  const hasBinary = commandFromOptions ? true : await hasSymphonyxOnPath()
  let command: string
  let commandArgs: string[]
  let commandCwd: string | undefined
  let commandUsed: string

  if (commandFromOptions) {
    command = commandFromOptions
    commandArgs = buildOpenArgs(args, root)
    commandCwd = options.cwd
    commandUsed = `${command} ${commandArgs.join(" ")}`
  } else if (hasBinary) {
    command = "symphonyx"
    commandArgs = buildOpenArgs(args, root)
    commandCwd = options.cwd
    commandUsed = `${command} ${commandArgs.join(" ")}`
  } else {
    const repoRoot = options.repoRoot ?? findRepoRoot(options.cwd)
    if (!repoRoot) {
      return Promise.reject(new Error("symphonyx is not on PATH and repo root could not be found for cargo fallback."))
    }
    command = "cargo"
    commandArgs = ["run", "--quiet", "--manifest-path", "packages/symphony-lite-rs/Cargo.toml", "--", ...buildOpenArgs(args, root)]
    commandCwd = repoRoot
    commandUsed = `${command} ${commandArgs.join(" ")}`
  }

  const { stdout } = await (options.execCommand ?? execSymphonyx)(command, commandArgs, { cwd: commandCwd, timeout: options.timeoutMs })
  const envelope = parseEnvelope(stdout)
  if (!envelope.ok) {
    return Promise.reject(new Error(envelope.error?.message || `symphonyx open failed (ok=false): ${stdout.trim()}`))
  }
  if (!envelope.data?.target || typeof envelope.data.target !== "string") {
    return Promise.reject(new Error(`symphonyx open returned no target: ${stdout.trim()}`))
  }

  const result = envelope.data
  const opener = options.openTarget ?? openPath
  opener(result.target)
  return { result, openedByOmp: true, commandUsed }
}

export class UsageError extends Error {}

function buildOpenArgs(args: SymphonyxOpenArgs, root: string): string[] {
  const base = ["--root", root, "open"]
  if (args.kind === "agent") {
    return [...base, "agent", args.agentId!, "--json"]
  }
  return [...base, "session", args.provider!, args.sessionId!, "--json"]
}

function parseEnvelope(stdout: string): SymphonyxEnvelope {
  try {
    return JSON.parse(stdout.trim()) as SymphonyxEnvelope
  } catch {
    return { ok: false, error: { message: `Invalid JSON from symphonyx: ${stdout.trim()}` } }
  }
}

export function registerSymphonyxOpen(pi: ExtensionAPI): void {
  pi.registerCommand("symphonyx-open", {
    description: "Open a SymphonyX agent or external session target via OMP",
    handler: async (rawArgs, ctx: ExtensionCommandContext) => {
      try {
        const { result, commandUsed } = await runSymphonyxOpen(rawArgs, {
          cwd: ctx.cwd,
          timeoutMs: 60_000,
        })
        pi.sendMessage({
          customType: CUSTOM_TYPE,
          content: `Opened ${result.kind} ${result.id} → ${result.target}\nCLI: ${commandUsed}`,
          display: true,
          details: { kind: result.kind, id: result.id, target: result.target, commandUsed },
        })
      } catch (err) {
        const message = err instanceof UsageError ? err.message : `symphonyx-open failed: ${String(err)}`
        pi.sendMessage({
          customType: CUSTOM_TYPE,
          content: message,
          display: true,
          details: { error: String(err) },
        })
      }
    },
  })
}
