import { createReadStream } from "node:fs"
import { readdir, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { createInterface } from "node:readline"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "@sinclair/typebox"

const DEFAULT_MAX_CHARS = 50_000
const DEFAULT_LIST_LIMIT = 20
const TOOL_OUTPUT_MAX_CHARS = 3_000
const TOOL_INPUT_MAX_CHARS = 6_000
const MESSAGE_MAX_CHARS = 12_000

export interface CodexSessionInfo {
  cwd?: string
  file: string
  id: string
  source: "sessions" | "archived_sessions"
  timestamp?: string
  title?: string
  updatedAt: number
}

export interface CodexResumeArgs {
  all: boolean
  help: boolean
  maxChars: number
  noSend: boolean
  pick: boolean
  ref?: string
}

interface CodexListOptions {
  all?: boolean
  codexHome?: string
  cwd?: string
  limit?: number
}

interface CodexResolveOptions extends CodexListOptions {
  ref?: string
}

interface CodexResumeContextOptions {
  maxChars?: number
}

interface CodexResumeContext {
  context: string
  entryCount: number
  originalChars: number
  session: CodexSessionInfo
  truncated: boolean
}

interface CodexJsonRecord {
  payload?: Record<string, unknown>
  timestamp?: string
  type?: string
}

function codexHomePath(codexHome?: string): string {
  return codexHome ? resolve(codexHome) : join(homedir(), ".codex")
}

function isSessionFile(path: string): boolean {
  return path.endsWith(".jsonl")
}

async function discoverSessionFiles(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const child = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await discoverSessionFiles(child))
    } else if (entry.isFile() && isSessionFile(child)) {
      files.push(child)
    }
  }
  return files
}

async function normalizeExistingPath(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

function parseJsonLine(line: string): CodexJsonRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === "object" ? parsed as CodexJsonRecord : null
  } catch {
    return null
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function titleFromMessage(message: string | undefined): string | undefined {
  const normalized = message?.replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized
}

function idFromFile(file: string): string {
  const match = basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)
  return match?.[1] ?? basename(file, ".jsonl")
}

async function readSessionInfo(file: string, source: CodexSessionInfo["source"], updatedAt: number): Promise<CodexSessionInfo | null> {
  let cwd: string | undefined
  let id: string | undefined
  let timestamp: string | undefined
  let title: string | undefined
  let lineCount = 0

  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      lineCount++
      const record = parseJsonLine(line)
      if (!record) continue
      timestamp ??= record.timestamp

      if (record.type === "session_meta") {
        const payload = record.payload ?? {}
        id = stringValue(payload.id) ?? id
        cwd = stringValue(payload.cwd) ?? cwd
        timestamp = stringValue(payload.timestamp) ?? timestamp
      }

      if (!title && record.type === "event_msg" && record.payload?.type === "user_message") {
        title = titleFromMessage(stringValue(record.payload.message))
      }

      if (id && cwd && title) break
      if (lineCount > 200 && (id || cwd)) break
    }
  } finally {
    rl.close()
  }

  if (!id && !cwd && !timestamp && !title) return null
  return {
    cwd,
    file,
    id: id ?? idFromFile(file),
    source,
    timestamp,
    title,
    updatedAt,
  }
}

export async function listCodexSessions(options: CodexListOptions = {}): Promise<CodexSessionInfo[]> {
  const home = codexHomePath(options.codexHome)
  const roots: Array<{ path: string; source: CodexSessionInfo["source"] }> = [
    { path: join(home, "sessions"), source: "sessions" },
    { path: join(home, "archived_sessions"), source: "archived_sessions" },
  ]

  const discovered: Array<{ file: string; source: CodexSessionInfo["source"]; updatedAt: number }> = []
  for (const root of roots) {
    const files = await discoverSessionFiles(root.path)
    for (const file of files) {
      try {
        const s = await stat(file)
        discovered.push({ file, source: root.source, updatedAt: s.mtimeMs })
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  discovered.sort((a, b) => b.updatedAt - a.updatedAt)

  const cwd = await normalizeExistingPath(options.cwd)
  const sessions: CodexSessionInfo[] = []
  const scanLimit = options.all || !cwd ? discovered.length : Math.min(discovered.length, 400)
  for (const item of discovered.slice(0, scanLimit)) {
    const info = await readSessionInfo(item.file, item.source, item.updatedAt)
    if (!info) continue

    if (!options.all && cwd) {
      const sessionCwd = await normalizeExistingPath(info.cwd)
      if (sessionCwd !== cwd) continue
    }

    sessions.push(info)
    if (sessions.length >= (options.limit ?? DEFAULT_LIST_LIMIT)) break
  }

  return sessions
}

function looksLikePath(ref: string): boolean {
  return ref.includes("/") || ref.endsWith(".jsonl") || ref.startsWith("~") || ref.startsWith(".")
}

function expandPath(path: string, cwd: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return isAbsolute(path) ? path : resolve(cwd, path)
}

export async function resolveCodexSession(options: CodexResolveOptions = {}): Promise<CodexSessionInfo | null> {
  const rawRef = options.ref?.trim()
  const ref = rawRef && rawRef !== "latest" ? rawRef : undefined

  if (ref && looksLikePath(ref)) {
    const file = expandPath(ref, options.cwd ?? process.cwd())
    try {
      const s = await stat(file)
      const info = await readSessionInfo(file, file.includes("archived_sessions") ? "archived_sessions" : "sessions", s.mtimeMs)
      return info
    } catch {
      return null
    }
  }

  const sessions = await listCodexSessions({ ...options, all: options.all || Boolean(ref), limit: ref ? 200 : 1 })
  if (!ref) return sessions[0] ?? null

  return sessions.find((session) => session.id.startsWith(ref) || basename(session.file).includes(ref)) ?? null
}

function truncateMiddle(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  if (maxChars <= 200) return { text: `${text.slice(0, Math.max(0, maxChars - 20))}\n...[truncated]`, truncated: true }

  const marker = `\n\n...[truncated ${text.length - maxChars} characters]...\n\n`
  const available = Math.max(0, maxChars - marker.length)
  const head = Math.min(8_000, Math.floor(available * 0.25))
  const tail = available - head
  return { text: `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`, truncated: true }
}

function truncateEntry(text: string, maxChars: number): string {
  return truncateMiddle(text.trim(), maxChars).text
}

function redactSensitive(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\bghp_[0-9A-Za-z_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[0-9A-Za-z_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g, "[REDACTED_SLACK_TOKEN]")
    .replace(/(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s'\"]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s'\"]{8,}/gi, "$1[REDACTED]")
}

function parseJsonString(value: string | undefined): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatFunctionCall(payload: Record<string, unknown>): { callId?: string; name: string; text: string } | null {
  const name = stringValue(payload.name)
  if (!name) return null
  const callId = stringValue(payload.call_id)
  const argsText = stringValue(payload.arguments)
  const parsed = parseJsonString(argsText)

  if (name === "exec_command" && parsed && typeof parsed === "object") {
    const args = parsed as Record<string, unknown>
    const cmd = stringValue(args.cmd) ?? stringValue(args.command) ?? argsText ?? ""
    const workdir = stringValue(args.workdir) ?? stringValue(args.cwd)
    const lines = [
      workdir ? `workdir: ${workdir}` : undefined,
      "command:",
      cmd,
    ].filter((line): line is string => Boolean(line))
    return { callId, name, text: lines.join("\n") }
  }

  if (name === "update_plan" && parsed) {
    return { callId, name, text: prettyJson(parsed) }
  }

  const text = parsed ? prettyJson(parsed) : argsText ?? ""
  return { callId, name, text }
}

function formatPatchEvent(payload: Record<string, unknown>): string | null {
  const stdout = stringValue(payload.stdout) ?? ""
  const stderr = stringValue(payload.stderr) ?? ""
  const success = payload.success === true ? "success" : payload.success === false ? "failed" : "unknown"
  const changes = payload.changes && typeof payload.changes === "object"
    ? Object.entries(payload.changes as Record<string, { type?: unknown }>).map(([file, change]) => {
      const kind = typeof change?.type === "string" ? change.type : "change"
      return `${kind}: ${file}`
    })
    : []
  const lines = [`patch_apply_end: ${success}`]
  if (stdout.trim()) lines.push(`stdout:\n${stdout.trim()}`)
  if (stderr.trim()) lines.push(`stderr:\n${stderr.trim()}`)
  if (changes.length) lines.push(`changes:\n${changes.join("\n")}`)
  return lines.join("\n")
}

function eventText(record: CodexJsonRecord, callNames: Map<string, string>): { label: string; text: string } | null {
  const payload = record.payload ?? {}

  if (record.type === "event_msg") {
    const eventType = stringValue(payload.type)
    if (eventType === "user_message") {
      const message = stringValue(payload.message)?.trim()
      return message ? { label: "USER", text: truncateEntry(message, MESSAGE_MAX_CHARS) } : null
    }

    if (eventType === "agent_message") {
      const message = stringValue(payload.message)?.trim()
      const phase = stringValue(payload.phase)
      return message ? { label: phase ? `ASSISTANT (${phase})` : "ASSISTANT", text: truncateEntry(message, MESSAGE_MAX_CHARS) } : null
    }

    if (eventType === "turn_aborted") {
      return { label: "SESSION EVENT", text: `turn aborted: ${stringValue(payload.reason) ?? "unknown"}` }
    }

    if (eventType === "thread_rolled_back") {
      return { label: "SESSION EVENT", text: `thread rolled back by ${numberValue(payload.num_turns) ?? "?"} turn(s)` }
    }

    if (eventType === "context_compacted") {
      return { label: "SESSION EVENT", text: "context compacted" }
    }

    if (eventType === "patch_apply_end") {
      const text = formatPatchEvent(payload)
      return text ? { label: "TOOL RESULT apply_patch", text: truncateEntry(text, TOOL_OUTPUT_MAX_CHARS) } : null
    }

    return null
  }

  if (record.type !== "response_item") return null

  const itemType = stringValue(payload.type)
  if (itemType === "function_call") {
    const call = formatFunctionCall(payload)
    if (!call) return null
    if (call.callId) callNames.set(call.callId, call.name)
    return { label: `TOOL CALL ${call.name}`, text: truncateEntry(call.text, TOOL_INPUT_MAX_CHARS) }
  }

  if (itemType === "function_call_output") {
    const callId = stringValue(payload.call_id)
    const name = callId ? callNames.get(callId) : undefined
    const output = stringValue(payload.output)?.trim()
    return output ? { label: `TOOL RESULT ${name ?? callId ?? "unknown"}`, text: truncateEntry(output, TOOL_OUTPUT_MAX_CHARS) } : null
  }

  if (itemType === "custom_tool_call") {
    const name = stringValue(payload.name) ?? "custom_tool"
    const callId = stringValue(payload.call_id)
    if (callId) callNames.set(callId, name)
    const input = stringValue(payload.input)?.trim()
    return input ? { label: `TOOL CALL ${name}`, text: truncateEntry(input, TOOL_INPUT_MAX_CHARS) } : null
  }

  if (itemType === "custom_tool_call_output") {
    const callId = stringValue(payload.call_id)
    const name = callId ? callNames.get(callId) : undefined
    const output = stringValue(payload.output)?.trim()
    return output ? { label: `TOOL RESULT ${name ?? callId ?? "custom_tool"}`, text: truncateEntry(output, TOOL_OUTPUT_MAX_CHARS) } : null
  }

  return null
}

export async function buildCodexResumeContext(
  session: CodexSessionInfo,
  options: CodexResumeContextOptions = {},
): Promise<CodexResumeContext> {
  const maxChars = Math.max(2_000, Math.min(options.maxChars ?? DEFAULT_MAX_CHARS, 200_000))
  const entries: string[] = []
  const callNames = new Map<string, string>()

  const rl = createInterface({ input: createReadStream(session.file, { encoding: "utf8" }), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const record = parseJsonLine(line)
      if (!record) continue
      const event = eventText(record, callNames)
      if (!event) continue
      const stamp = record.timestamp ? ` ${record.timestamp}` : ""
      entries.push(`## ${event.label}${stamp}\n${redactSensitive(event.text)}`)
    }
  } finally {
    rl.close()
  }

  const header = [
    "# Imported Codex CLI session",
    "",
    `- Codex session: ${session.id}`,
    `- Source file: ${session.file}`,
    session.cwd ? `- Codex cwd: ${session.cwd}` : undefined,
    session.timestamp ? `- Started: ${session.timestamp}` : undefined,
    `- Updated: ${new Date(session.updatedAt).toISOString()}`,
    session.title ? `- First user request: ${session.title}` : undefined,
    "",
    "This transcript was imported from Codex so Pi can continue the work. Treat it as context, not as verified current repo state. Re-check files before editing. Obvious API keys/tokens are redacted.",
    "",
    "<codex_transcript>",
  ].filter((line): line is string => Boolean(line))

  const body = entries.join("\n\n")
  const footer = "\n</codex_transcript>"
  const full = `${header.join("\n")}\n\n${body}${footer}`
  const truncated = truncateMiddle(full, maxChars)
  return {
    context: truncated.text,
    entryCount: entries.length,
    originalChars: full.length,
    session,
    truncated: truncated.truncated,
  }
}

export function parseCodexResumeArgs(args: string): CodexResumeArgs {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const parsed: CodexResumeArgs = {
    all: false,
    help: false,
    maxChars: DEFAULT_MAX_CHARS,
    noSend: false,
    pick: false,
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part === "--all") parsed.all = true
    else if (part === "--pick") parsed.pick = true
    else if (part === "--no-send" || part === "--preview") parsed.noSend = true
    else if (part === "--help" || part === "-h") parsed.help = true
    else if (part.startsWith("--max-chars=")) {
      const value = Number(part.slice("--max-chars=".length))
      if (Number.isFinite(value)) parsed.maxChars = value
    } else if (part === "--max-chars") {
      const next = Number(parts[i + 1])
      if (Number.isFinite(next)) {
        parsed.maxChars = next
        i++
      }
    } else if (!parsed.ref) {
      parsed.ref = part
    }
  }

  parsed.maxChars = Math.max(2_000, Math.min(parsed.maxChars, 200_000))
  return parsed
}

function usageText(): string {
  return [
    "Usage: /codex-resume [latest|SESSION_ID|path] [--pick] [--all] [--no-send] [--max-chars N]",
    "",
    "Default: import the latest Codex session for the current cwd and ask Pi to continue.",
    "--pick: choose from recent sessions.",
    "--all: include sessions from all directories.",
    "--no-send: import hidden context and prefill the editor instead of starting the agent.",
  ].join("\n")
}

function formatSessionChoice(session: CodexSessionInfo): string {
  const shortId = session.id.slice(0, 8)
  const updated = new Date(session.updatedAt).toLocaleString()
  const title = session.title ?? "(no user message)"
  const cwd = session.cwd ? ` — ${session.cwd}` : ""
  return `${shortId} — ${updated} — ${title}${cwd}`
}

function buildResumeRequest(session: CodexSessionInfo): string {
  return [
    "Continue from the imported Codex session context.",
    "First briefly state what the Codex session was doing and the next concrete step, then continue in this Pi session.",
    "Re-check the repository state before making edits; the imported transcript may be stale or partially truncated.",
    session.cwd ? `Codex was working in: ${session.cwd}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n")
}

async function selectSession(args: CodexResumeArgs, cwd: string, ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1]): Promise<CodexSessionInfo | null> {
  if (args.pick) {
    const sessions = await listCodexSessions({ all: args.all, cwd, limit: DEFAULT_LIST_LIMIT })
    if (!sessions.length) return null
    if (!ctx.hasUI) return sessions[0] ?? null

    const choices = sessions.map(formatSessionChoice)
    const selected = await ctx.ui.select("Pick Codex session:", choices)
    if (!selected) return null
    return sessions[choices.indexOf(selected)] ?? null
  }

  return await resolveCodexSession({ all: args.all, cwd, ref: args.ref })
}

function registerCodexSessionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "codex_session",
    label: "Codex Session",
    description: "List or extract recent Codex CLI sessions so Pi can continue prior Codex work.",
    promptSnippet: "List or extract recent Codex CLI sessions for the current project.",
    promptGuidelines: [
      "Use codex_session when the user asks to continue, inspect, or import a previous Codex CLI session in Pi.",
    ],
    parameters: Type.Object({
      action: Type.Optional(Type.String({ description: "list or show (default: list)" })),
      all: Type.Optional(Type.Boolean({ description: "Include sessions from all directories, not just the current cwd" })),
      limit: Type.Optional(Type.Number({ description: "Number of sessions to list" })),
      maxChars: Type.Optional(Type.Number({ description: "Maximum characters when action=show" })),
      session: Type.Optional(Type.String({ description: "Session id prefix, latest, or path for action=show" })),
    }),
    async execute(_callId, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as { action?: string; all?: boolean; limit?: number; maxChars?: number; session?: string }
      const action = params.action ?? "list"
      if (!["list", "show"].includes(action)) {
        return { content: [{ type: "text", text: "Error: action must be list or show." }], details: { error: "Invalid action" } }
      }

      if (action === "list") {
        const sessions = await listCodexSessions({ all: params.all, cwd: ctx.cwd, limit: params.limit ?? DEFAULT_LIST_LIMIT })
        const text = sessions.length
          ? sessions.map((session) => [
            `${session.id} (${new Date(session.updatedAt).toISOString()})`,
            session.cwd ? `cwd: ${session.cwd}` : undefined,
            session.title ? `title: ${session.title}` : undefined,
            `file: ${session.file}`,
          ].filter(Boolean).join("\n")).join("\n\n")
          : "No Codex sessions found."
        return { content: [{ type: "text", text }], details: { error: null as unknown as string } }
      }

      const session = await resolveCodexSession({ all: params.all, cwd: ctx.cwd, ref: params.session })
      if (!session) {
        return { content: [{ type: "text", text: "No matching Codex session found." }], details: { error: "Not found" } }
      }

      const resume = await buildCodexResumeContext(session, { maxChars: params.maxChars })
      return {
        content: [{ type: "text", text: resume.context }],
        details: { error: null as unknown as string, entryCount: resume.entryCount, file: session.file, truncated: resume.truncated },
      }
    },
  })
}

function registerCodexResumeCommand(pi: ExtensionAPI): void {
  pi.registerCommand("codex-resume", {
    description: "Import a Codex CLI session and continue it in Pi",
    handler: async (rawArgs, ctx) => {
      const args = parseCodexResumeArgs(rawArgs)
      if (args.help) {
        pi.sendMessage({ customType: "codex-resume", content: usageText(), display: true })
        return
      }

      const session = await selectSession(args, ctx.cwd, ctx)
      if (!session) {
        ctx.ui.notify(args.all ? "No Codex sessions found." : "No Codex sessions found for this cwd. Try /codex-resume --all --pick", "warning")
        return
      }

      const resume = await buildCodexResumeContext(session, { maxChars: args.maxChars })
      const delivery = ctx.isIdle() ? undefined : { deliverAs: "followUp" as const }
      pi.sendMessage({
        customType: "codex-resume",
        content: resume.context,
        display: false,
        details: {
          entryCount: resume.entryCount,
          file: session.file,
          originalChars: resume.originalChars,
          truncated: resume.truncated,
        },
      }, delivery)

      const rel = relative(ctx.cwd, session.file)
      const note = `Imported Codex session ${session.id.slice(0, 8)} (${resume.entryCount} transcript entries${resume.truncated ? ", truncated" : ""}) from ${rel.startsWith("..") ? session.file : rel}.`

      if (args.noSend) {
        ctx.ui.setEditorText(buildResumeRequest(session))
        ctx.ui.notify(`${note} Editor prefilled; submit when ready.`, "info")
        return
      }

      pi.sendUserMessage(buildResumeRequest(session), delivery)
      ctx.ui.notify(note, "info")
    },
  })
}

export function registerCodexResume(pi: ExtensionAPI): void {
  registerCodexSessionTool(pi)
  registerCodexResumeCommand(pi)
}
