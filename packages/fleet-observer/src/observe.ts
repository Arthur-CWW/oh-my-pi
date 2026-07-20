import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"

export interface FleetOverviewRow {
  readonly sessionId: string
  readonly name: string
  readonly label?: string
  readonly state: string
  readonly workstream: string
  readonly cwd: string
  readonly sessionJournal: string
  readonly summary: string
  readonly spawnName: string
}

export interface JournalStat {
  readonly byteSize: number
  readonly mtimeMs: number
}

export interface JournalCursor extends JournalStat {}
export type CursorStore = Readonly<Record<string, JournalCursor>>

export interface ObserverPaths {
  readonly cursorPath: string
  readonly errorLogPath: string
  readonly heartbeatPath: string
  readonly stateDocsDir: string
  readonly indexPath: string
}

export interface StateDocLayers {
  readonly whatWhy?: string
  readonly approach?: string
  readonly recent?: string
  readonly next?: string
  readonly decision?: string
  readonly deferredWhy?: string
  readonly blocker?: string
  readonly revivalTrigger?: string
  readonly artifacts?: readonly string[]
}

export interface SummaryOutput {
  readonly summary: string
  readonly name: string
  readonly workstream?: string
  readonly layers?: StateDocLayers
}

export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type CommandRunner = (argv: readonly string[]) => Promise<CommandResult>
export type TextReader = (filePath: string) => Promise<string>
export type JournalStatReader = (filePath: string) => Promise<JournalStat>

export interface StateDocInput {
  readonly sessionId: string
  readonly name: string
  readonly state: string
  readonly workstream: string
  readonly summary: string
  readonly layers?: StateDocLayers
  readonly journalPath: string
  readonly stamp: string
}

export interface IndexRecord {
  readonly sessionId: string
  readonly name: string
  readonly workstream: string
  readonly stamp: string
}
export interface ParkCandidate {
  readonly sessionId: string
  readonly name: string
  readonly idleMs: number
}


export interface ObserverOptions {
  readonly paths?: ObserverPaths
  readonly binary?: string
  readonly model?: string
  readonly thresholdBytes?: number
  readonly now?: () => Date
  readonly runCommand?: CommandRunner
  readonly readText?: TextReader
  readonly statJournal?: JournalStatReader
  readonly overviewFixturePath?: string
  readonly includeAll?: boolean
}

export interface ObserverPassResult {
  readonly ran: true
  readonly peers: number
  readonly observed: number
  readonly skipped: number
  readonly failed: number
  readonly parkCandidates: number
  readonly skippedReasons: Readonly<Record<string, number>>
}


const DEFAULT_THRESHOLD_BYTES = 65_536
const DEFAULT_INTERVAL_SECONDS = 120
const DEFAULT_PARK_IDLE_HOURS = 12
const MAX_SUMMARY_CHARS = 280
const MAX_NAME_WORDS = 4
const DEFAULT_TAIL_LINES = 200
const DEFAULT_EXCERPT_CHARS = 12_000
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i



function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringField(record: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string") return value
  }
  return ""
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

function boundedSummary(value: string): string {
  return truncate(oneLine(value), MAX_SUMMARY_CHARS)
}

function boundedName(value: string): string {
  const words = oneLine(value).split(" ").filter(Boolean).slice(0, MAX_NAME_WORDS)
  return words.join(" ")
}

function normaliseWorkstream(value: string): string | undefined {
  const slug = oneLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || undefined
}

function isUuidLike(sessionId: string): boolean {
  return UUID_LIKE_PATTERN.test(sessionId)
}

function isSafeSessionId(sessionId: string): boolean {
  return sessionId.length > 0 && !/[/:]/.test(sessionId)
}

function isUnderDirectory(candidate: string, directory: string): boolean {
  const resolvedCandidate = resolve(candidate)
  const resolvedDirectory = resolve(directory)
  return resolvedCandidate === resolvedDirectory || resolvedCandidate.startsWith(`${resolvedDirectory}/`)
}

function isTmpCwd(cwd: string): boolean {
  return Boolean(cwd) && isUnderDirectory(cwd, tmpdir())
}

function errorCode(error: unknown): string | undefined {
  const record = recordOf(error)
  return typeof record?.code === "string" ? record.code : undefined
}

function isMissingJournalError(error: unknown): boolean {
  return errorCode(error) === "ENOENT"
}

function incrementReason(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1
}

function formatSkippedReasons(reasons: Readonly<Record<string, number>>): string {
  const entries = Object.entries(reasons)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
  return entries.length > 0 ? entries.map(([reason, count]) => `${reason}=${count}`).join(", ") : "none"
}

function stateDocPath(paths: ObserverPaths, sessionId: string): string {
  if (!isSafeSessionId(sessionId)) throw new Error(`unsafe session id for state doc: ${sessionId}`)
  return join(paths.stateDocsDir, `${sessionId}.md`)
}

function liveIdentity(peer: Pick<FleetOverviewRow, "label" | "name" | "spawnName" | "workstream" | "sessionId">): {
  readonly name: string
  readonly workstream: string
} {
  return {
    name: boundedName(peer.label || peer.name || peer.spawnName) || peer.sessionId,
    workstream: oneLine(peer.workstream) || "uncategorized",
  }
}

export function defaultObserverPaths(repoRoot = process.env.OBSERVER_REPO_ROOT ?? resolve(import.meta.dir, "../../..")): ObserverPaths {
  const dataDir = process.env.OBSERVER_DATA_DIR ?? join(repoRoot, "data", "fleet-observer")
  const stateDocsDir = process.env.OBSERVER_STATE_DOCS_DIR ?? join(repoRoot, "local", "state-docs")
  return {
    cursorPath: process.env.OBSERVER_CURSOR_PATH ?? join(dataDir, "cursors.json"),
    errorLogPath: process.env.OBSERVER_ERROR_LOG ?? join(dataDir, "errors.log"),
    heartbeatPath: process.env.OBSERVER_HEARTBEAT_PATH ?? join(dataDir, "heartbeat"),
    stateDocsDir,
    indexPath: process.env.OBSERVER_INDEX_PATH ?? join(stateDocsDir, "INDEX.md"),
  }
}

export function thresholdBytesFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const parsed = Number(env.OBSERVER_THRESHOLD_BYTES ?? DEFAULT_THRESHOLD_BYTES)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_THRESHOLD_BYTES
}

export function parkIdleHoursFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const parsed = Number(env.OBSERVER_PARK_IDLE_HOURS ?? DEFAULT_PARK_IDLE_HOURS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PARK_IDLE_HOURS
}


export function intervalMsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const milliseconds = Number(env.OBSERVER_INTERVAL_MS)
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return Math.floor(milliseconds)
  const seconds = Number(env.OBSERVER_INTERVAL_SECONDS ?? env.OBSERVER_INTERVAL ?? DEFAULT_INTERVAL_SECONDS)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds * 1_000) : DEFAULT_INTERVAL_SECONDS * 1_000
}

export function jitteredIntervalMs(baseMs: number, random = Math.random): number {
  const boundedRandom = Math.min(1, Math.max(0, random()))
  return Math.max(0, Math.round(baseMs * (0.8 + boundedRandom * 0.4)))
}

export function buildOverviewCommand(binary = process.env.OMP_BIN ?? "omp"): readonly string[] {
  return [binary, "fleet", "overview", "--json"]
}

export function buildLabelCommand(
  sessionId: string,
  output: SummaryOutput,
  binary = process.env.OMP_BIN ?? "omp",
): readonly string[] {
  const argv: string[] = [binary, "fleet", "label", sessionId, "--summary", output.summary]
  if (output.name) argv.push("--name", output.name)
  if (output.workstream) argv.push("--workstream", output.workstream)
  return argv
}

export function buildSummaryCommand(
  excerpt: string,
  model: string,
  binary = process.env.OMP_BIN ?? "omp",
): readonly string[] {
  const prompt = [
    "Summarize this OMP agent journal excerpt for a fleet overview.",
    "Return exactly twelve labelled lines and no markdown. Keep every line grounded in the excerpt; leave a field blank when the excerpt has no evidence.",
    "SUMMARY: one terse fallback line, at most 280 characters",
    "NAME: ignored; identity comes from the live fleet row",
    "WORKSTREAM: ignored; identity comes from the live fleet row",
    "WHAT_WHY: the distinct objective and reason for the work",
    "APPROACH: the distinct current method or plan",
    "RECENT: the distinct latest completed or observed result",
    "NEXT: the distinct next action or open task",
    "DECISION: the last meaningful decision",
    "DEFERRED_WHY: why a decision or work was deferred",
    "BLOCKER: the current blocker",
    "REVIVAL_TRIGGER: what should trigger resuming this work",
    "ARTIFACTS: comma-separated paths or URLs produced by the work",
    "Do not include tool payloads, credentials, or long code.",
    "",
    excerpt,
  ].join("\n")
  return [binary, "-p", "--model", model, prompt]
}

export function parseOverviewJson(stdout: string): readonly FleetOverviewRow[] {
  if (!stdout.trim()) return []
  const parsed: unknown = JSON.parse(stdout)
  const root = Array.isArray(parsed) ? parsed : recordOf(parsed)?.rows
  if (!Array.isArray(root)) return []
  const rows: FleetOverviewRow[] = []
  for (const value of root) {
    const record = recordOf(value)
    if (!record) continue
    const sessionId = stringField(record, "session_id", "sessionId")
    if (!sessionId) continue
    const label = stringField(record, "label")
    rows.push({
      sessionId,
      name: stringField(record, "name"),
      ...(label ? { label } : {}),
      state: stringField(record, "state", "display_state"),
      workstream: stringField(record, "workstream"),
      cwd: stringField(record, "cwd"),
      sessionJournal: stringField(record, "session_journal", "sessionJournal"),
      summary: stringField(record, "summary"),
      spawnName: stringField(record, "spawnName", "spawn_name"),
    })
  }
  return rows
}

export function shouldObserve(
  peer: Pick<FleetOverviewRow, "summary">,
  previous: JournalCursor | undefined,
  current: JournalStat,
  threshold: number,
): boolean {
  if (!peer.summary.trim()) return true
  if (!previous) return false
  return current.byteSize - previous.byteSize >= threshold
}

export async function loadCursorStore(filePath: string): Promise<CursorStore> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"))
    const record = recordOf(parsed)
    if (!record) return {}
    const cursors: Record<string, JournalCursor> = {}
    for (const [sessionId, value] of Object.entries(record)) {
      const cursor = recordOf(value)
      if (!cursor) continue
      const byteSize = typeof cursor.byteSize === "number" ? cursor.byteSize : typeof cursor.bytes === "number" ? cursor.bytes : NaN
      const mtimeMs = typeof cursor.mtimeMs === "number" ? cursor.mtimeMs : NaN
      if (Number.isFinite(byteSize) && Number.isFinite(mtimeMs)) cursors[sessionId] = { byteSize, mtimeMs }
    }
    return cursors
  } catch {
    return {}
  }
}

export async function saveCursorStore(filePath: string, cursors: CursorStore): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await Bun.write(filePath, `${JSON.stringify(cursors, null, 2)}\n`)
}

export async function readJournalTail(
  journalPath: string,
  maxLines = DEFAULT_TAIL_LINES,
  readText: TextReader = async filePath => Bun.file(filePath).text(),
): Promise<readonly string[]> {
  const content = await readText(journalPath)
  return content
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .slice(-maxLines)
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  const parts: string[] = []
  for (const item of value) {
    const block = recordOf(item)
    if (!block || block.type !== "text") continue
    const text = block.text
    if (typeof text === "string" && text.trim()) parts.push(text)
  }
  return parts.join(" ")
}

function toolCallEvidence(content: unknown): string {
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const item of content) {
    const block = recordOf(item)
    if (!block || block.type !== "toolCall") continue
    const name = stringField(block, "name")
    const args = recordOf(block.arguments)
    if (name === "goal" && args) {
      const objective = stringField(args, "objective")
      const workstream = stringField(args, "workstream")
      if (objective) parts.push(`goal objective: ${oneLine(objective)}`)
      if (workstream) parts.push(`goal workstream: ${oneLine(workstream)}`)
      continue
    }
    if (name === "todo" && args) {
      const ops = Array.isArray(args.ops) ? args.ops : []
      const tasks: string[] = []
      for (const opValue of ops) {
        const op = recordOf(opValue)
        if (!op) continue
        const task = stringField(op, "task", "content")
        if (task) tasks.push(oneLine(task))
        const items = Array.isArray(op.items) ? op.items : []
        for (const itemValue of items) {
          if (typeof itemValue === "string" && itemValue.trim()) tasks.push(oneLine(itemValue))
        }
      }
      if (tasks.length > 0) parts.push(`todo: ${tasks.join("; ")}`)
    }
  }
  return parts.join(" ")
}

function messageText(record: Record<string, unknown>): string {
  const message = recordOf(record.message) ?? record
  const content = message.content ?? message.text ?? message.summary
  const text = textFromContent(content)
  const toolEvidence = toolCallEvidence(content)
  return [text, toolEvidence].filter(Boolean).join(" ")
}

export function compressExcerpt(lines: readonly string[], maxChars = DEFAULT_EXCERPT_CHARS): string {
  const compressed: string[] = []
  for (const line of lines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      // A byte-tail may begin in the middle of a JSONL record. Ignore it.
      continue
    }
    const record = recordOf(parsed)
    if (!record) continue
    const type = stringField(record, "type")
    let role = ""
    let text = ""
    if (type === "message") {
      const message = recordOf(record.message)
      role = message ? stringField(message, "role") : "message"
      text = messageText(record)
    } else if (type === "custom_message" || type === "custom" || type === "hookMessage") {
      role = stringField(record, "customType", "type") || "custom"
      text = messageText(record)
    } else if (type === "compaction" || type === "branch_summary") {
      role = type
      text = stringField(record, "summary", "shortSummary")
    } else if (type === "mode_change") {
      role = "goal"
      const data = recordOf(record.data)
      const goal = recordOf(data?.goal)
      const goalDetails = recordOf(goal?.goal)
      const objective = stringField(goalDetails ?? {}, "objective")
      const status = stringField(goalDetails ?? {}, "status")
      text = [objective && `objective: ${oneLine(objective)}`, status && `status: ${oneLine(status)}`].filter(Boolean).join("; ")
    }
    if (!text.trim()) continue
    const lineText = `${role || "entry"}: ${truncate(oneLine(text), 360)}`
    compressed.push(lineText)
  }
  if (maxChars <= 0 || compressed.length === 0) return ""
  let start = compressed.length
  let used = 0
  while (start > 0) {
    const lineLength = compressed[start - 1].length + (start < compressed.length ? 1 : 0)
    if (used + lineLength > maxChars) break
    used += lineLength
    start--
  }
  if (start === compressed.length) return truncate(compressed[compressed.length - 1], maxChars)
  return compressed.slice(start).join("\n")
}
function labelledLine(lines: readonly string[], label: string): string | undefined {
  const prefix = `${label}:`
  const line = lines.find(candidate => candidate.toLowerCase().startsWith(prefix.toLowerCase()))
  return line === undefined ? undefined : line.slice(prefix.length).trim()
}

function optionalLayer(value: string | undefined): string | undefined {
  const result = boundedSummary(value ?? "")
  return result || undefined
}

function parseArtifacts(value: string | undefined): readonly string[] | undefined {
  const artifacts = (value ?? "")
    .split(/[;,]/)
    .map(item => oneLine(item).replace(/^[-*]\s+/, ""))
    .filter(item => item.length > 0 && item !== "— none" && item !== "— none yet")
    .map(item => truncate(item, MAX_SUMMARY_CHARS))
  return artifacts.length > 0 ? [...new Set(artifacts)] : undefined
}

export function parseSummaryOutput(output: string): SummaryOutput | null {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s+/, ""))
    .filter(line => line.length > 0 && !line.startsWith("```"))
  if (lines.length === 0) return null
  const labelledSummary = labelledLine(lines, "SUMMARY")
  const labelledName = labelledLine(lines, "NAME")
  const labelledWorkstream = labelledLine(lines, "WORKSTREAM")
  const summary = boundedSummary(labelledSummary ?? lines[0] ?? "")
  const name = boundedName(labelledName ?? lines[1] ?? "")
  if (!summary) return null
  const workstreamValue = labelledWorkstream ?? (labelledSummary === undefined && lines.length >= 3 ? lines[2] : undefined)
  const workstream = workstreamValue ? normaliseWorkstream(workstreamValue) : undefined
  const layers: StateDocLayers = {
    whatWhy: optionalLayer(labelledLine(lines, "WHAT_WHY")),
    approach: optionalLayer(labelledLine(lines, "APPROACH")),
    recent: optionalLayer(labelledLine(lines, "RECENT")),
    next: optionalLayer(labelledLine(lines, "NEXT")),
    decision: optionalLayer(labelledLine(lines, "DECISION")),
    deferredWhy: optionalLayer(labelledLine(lines, "DEFERRED_WHY")),
    blocker: optionalLayer(labelledLine(lines, "BLOCKER")),
    revivalTrigger: optionalLayer(labelledLine(lines, "REVIVAL_TRIGGER")),
    artifacts: parseArtifacts(labelledLine(lines, "ARTIFACTS")),
  }
  const hasLayers = Object.values(layers).some(value => value !== undefined && (!Array.isArray(value) || value.length > 0))
  return {
    summary,
    name,
    ...(workstream === undefined ? {} : { workstream }),
    ...(hasLayers ? { layers } : {}),
  }
}

function evidenceKey(value: string): string {
  return value
}

export function renderStateDoc(input: StateDocInput): string {
  const name = oneLine(input.name) || input.sessionId
  const summary = boundedSummary(input.summary)
  const workstream = oneLine(input.workstream)
  const layers = input.layers ?? {}
  const used = new Set<string>()
  const uniqueLayer = (value: string | undefined, empty: string): string => {
    const candidate = boundedSummary(value ?? "")
    const key = evidenceKey(candidate)
    if (!candidate || !key || used.has(key)) return empty
    used.add(key)
    return candidate
  }
  const whatWhy = uniqueLayer(layers.whatWhy ?? summary, "— none yet")
  const approach = uniqueLayer(layers.approach, "— none yet")
  const recent = uniqueLayer(layers.recent, "— none yet")
  const next = uniqueLayer(layers.next, "— none yet")
  const decision = uniqueLayer(layers.decision, "— none")
  const deferredWhy = uniqueLayer(layers.deferredWhy, "— none")
  const blocker = uniqueLayer(layers.blocker, "— none")
  const revivalTrigger = uniqueLayer(layers.revivalTrigger, "— none")
  const artifacts = (layers.artifacts ?? [])
    .map(artifact => uniqueLayer(artifact, ""))
    .filter(Boolean)
  return [
    `# ${name}`,
    `Workstream: ${workstream || "uncategorized"}`,
    "## L0",
    `What/why: ${whatWhy}`,
    `Status: ${oneLine(input.state) || "unknown"} · Fresh: ${input.stamp}`,
    "",
    "## L1 Overview",
    `Current approach: ${approach}`,
    `Recent: ${recent}`,
    `Next: ${next}`,
    "",
    "## L2 Decisions",
    `- Last meaningful decision: ${decision}`,
    `- Deferred because: ${deferredWhy}`,
    `- Blocker: ${blocker}`,
    `- Revival trigger: ${revivalTrigger}`,
    "",
    "## L3 Artifacts",
    "- Paths/URLs produced:",
    ...(artifacts.length > 0 ? artifacts.map(artifact => `  - ${artifact}`) : ["  - — none"]),
    "",
    "## L5 Depth",
    `- Journal: ${input.journalPath}`,
    `- History: history://${input.sessionId}`,
    "",
  ].join("\n")
}

function formatIdleDuration(idleMs: number): string {
  const minutes = Math.max(0, Math.floor(idleMs / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`
}

export function renderIndex(records: readonly IndexRecord[], parkCandidates: readonly ParkCandidate[] = []): string {
  const rows = [...records]
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
    .map(record => `- ${record.sessionId}\t${oneLine(record.name) || record.sessionId}\t${oneLine(record.workstream) || "uncategorized"}\t${record.stamp}`)
  const candidates = [...parkCandidates]
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
    .map(candidate => `- ${oneLine(candidate.name) || candidate.sessionId} — idle ${formatIdleDuration(candidate.idleMs)} — [state doc](./${candidate.sessionId}.md)`)
  return [
    ...rows,
    "",
    "## Park candidates",
    ...(candidates.length > 0 ? candidates : ["— none"]),
    "",
  ].join("\n")
}


async function readIndexRecords(filePath: string): Promise<readonly IndexRecord[]> {
  try {
    const content = await readFile(filePath, "utf8")
    const records: IndexRecord[] = []
    for (const line of content.split(/\r?\n/)) {
      if (!line.startsWith("- ")) continue
      const fields = line.slice(2).split("\t")
      if (fields.length !== 4) continue
      const [sessionId, name, workstream, stamp] = fields
      if (sessionId && name && workstream && stamp) records.push({ sessionId, name, workstream, stamp })
    }
    return records
  } catch {
    return []
  }
}
async function writeStateFiles(paths: ObserverPaths, input: StateDocInput): Promise<void> {
  await mkdir(paths.stateDocsDir, { recursive: true })
  await Bun.write(stateDocPath(paths, input.sessionId), renderStateDoc(input))
  const existing = await readIndexRecords(paths.indexPath)
  const bySession = new Map(existing.map(record => [record.sessionId, record]))
  bySession.set(input.sessionId, {
    sessionId: input.sessionId,
    name: input.name,
    workstream: input.workstream,
    stamp: input.stamp,
  })
  await Bun.write(paths.indexPath, renderIndex([...bySession.values()]))
}

async function refreshIdentity(
  paths: ObserverPaths,
  peer: Pick<FleetOverviewRow, "label" | "sessionId" | "name" | "spawnName" | "workstream" | "state">,
  stamp: string,
): Promise<boolean> {
  const docPath = stateDocPath(paths, peer.sessionId)
  let content: string
  try {
    content = await readFile(docPath, "utf8")
  } catch {
    return false
  }
  const hasLiveName = Boolean(peer.label?.trim() || peer.name.trim() || peer.spawnName.trim())
  const hasLiveWorkstream = Boolean(peer.workstream.trim())
  if (!hasLiveName && !hasLiveWorkstream) return false
  const identity = liveIdentity(peer)
  const lines = content.split(/\r?\n/)
  if (hasLiveName && lines[0]?.startsWith("# ")) lines[0] = `# ${identity.name}`
  const statusIndex = lines.findIndex(line => line.startsWith("Status: "))
  if (statusIndex >= 0) lines[statusIndex] = `Status: ${oneLine(peer.state) || "unknown"} · Fresh: ${stamp}`
  if (hasLiveWorkstream) {
    const nextIndex = lines.findIndex(line => line.startsWith("Next: Continue the current work"))
    if (nextIndex >= 0) lines[nextIndex] = `Next: Continue the current work in ${identity.workstream}.`
    const headerIndex = lines.findIndex(line => line.startsWith("Workstream: "))
    const depthIndex = lines.findIndex(line => line.startsWith("- Workstream: "))
    if (headerIndex >= 0) lines[headerIndex] = `Workstream: ${identity.workstream}`
    else {
      if (depthIndex >= 0) lines.splice(depthIndex, 1)
      lines.splice(1, 0, `Workstream: ${identity.workstream}`)
    }
  }
  const refreshed = lines.join("\n")
  if (refreshed === content) return false
  await Bun.write(docPath, refreshed)
  const existing = await readIndexRecords(paths.indexPath)
  const bySession = new Map(existing.map(record => [record.sessionId, record]))
  bySession.set(peer.sessionId, {
    sessionId: peer.sessionId,
    name: hasLiveName ? identity.name : bySession.get(peer.sessionId)?.name ?? peer.sessionId,
    workstream: hasLiveWorkstream ? identity.workstream : bySession.get(peer.sessionId)?.workstream ?? "uncategorized",
    stamp,
  })
  await Bun.write(paths.indexPath, renderIndex([...bySession.values()]))
  return true
}

async function regenerateIndex(
  paths: ObserverPaths,
  survivingSessionIds: ReadonlySet<string>,
  journalStats: ReadonlyMap<string, JournalStat>,
  nowMs: number,
  parkIdleHours: number,
): Promise<number> {
  const existing = await readIndexRecords(paths.indexPath)
  const surviving: IndexRecord[] = []
  const stateDocMtimes = new Map<string, number>()
  for (const record of existing) {
    if (!survivingSessionIds.has(record.sessionId)) continue
    try {
      const stateDocStat = await stat(stateDocPath(paths, record.sessionId))
      stateDocMtimes.set(record.sessionId, stateDocStat.mtimeMs)
      surviving.push(record)
    } catch {
      // An index entry without its state document is stale.
    }
  }
  const idleThresholdMs = parkIdleHours * 60 * 60 * 1_000
  const parkCandidates: ParkCandidate[] = []
  for (const record of surviving) {
    if (!isUuidLike(record.sessionId)) continue
    const journalStat = journalStats.get(record.sessionId)
    const stateDocMtime = stateDocMtimes.get(record.sessionId)
    if (journalStat === undefined || stateDocMtime === undefined) continue
    const idleMs = nowMs - journalStat.mtimeMs
    if (idleMs <= idleThresholdMs || stateDocMtime < journalStat.mtimeMs) continue
    parkCandidates.push({ sessionId: record.sessionId, name: record.name, idleMs })
  }
  await mkdir(dirname(paths.indexPath), { recursive: true })
  await Bun.write(paths.indexPath, renderIndex(surviving, parkCandidates))
  return parkCandidates.length
}


async function defaultCommandRunner(argv: readonly string[]): Promise<CommandResult> {
  const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}

async function defaultJournalStatReader(filePath: string): Promise<JournalStat> {
  const fileStat = await stat(filePath)
  return { byteSize: fileStat.size, mtimeMs: fileStat.mtimeMs }
}

function commandFailure(argv: readonly string[], result: CommandResult): Error {
  const detail = oneLine(result.stderr || result.stdout)
  return new Error(`${argv[0] ?? "command"} ${argv.slice(1).join(" ")} failed (${result.exitCode})${detail ? `: ${detail}` : ""}`)
}

export async function appendErrorLog(
  errorLogPath: string,
  sessionId: string,
  error: unknown,
  stamp = new Date().toISOString(),
): Promise<void> {
  await mkdir(dirname(errorLogPath), { recursive: true })
  const message = error instanceof Error ? error.message : String(error)
  await appendFile(errorLogPath, `${stamp}\t${sessionId}\t${oneLine(message)}\n`, "utf8")
}

export async function runObserverPass(options: ObserverOptions = {}): Promise<ObserverPassResult> {
  const paths = options.paths ?? defaultObserverPaths()
  const binary = options.binary ?? process.env.OMP_BIN ?? "omp"
  const runner = options.runCommand ?? defaultCommandRunner
  const readText = options.readText ?? (async filePath => Bun.file(filePath).text())
  const statJournal = options.statJournal ?? defaultJournalStatReader
  const now = (options.now ?? (() => new Date()))()
  const stamp = now.toISOString()
  const threshold = options.thresholdBytes ?? thresholdBytesFromEnv()
  const parkIdleHours = parkIdleHoursFromEnv()
  const overviewFixturePath = options.overviewFixturePath ?? process.env.OBSERVER_OVERVIEW_FIXTURE
  const includeAll = options.includeAll ?? false


  let overviewText: string
  if (overviewFixturePath) {
    overviewText = await readText(overviewFixturePath)
  } else {
    const overviewCommand = buildOverviewCommand(binary)
    const result = await runner(overviewCommand)
    if (result.exitCode !== 0) throw commandFailure(overviewCommand, result)
    overviewText = result.stdout
  }
  const peers = parseOverviewJson(overviewText)
  const cursors = await loadCursorStore(paths.cursorPath)
  const nextCursors: Record<string, JournalCursor> = { ...cursors }
  const journalStats = new Map<string, JournalStat>()
  const survivingSessionIds = new Set<string>()
  const skippedReasons: Record<string, number> = {}
  let observed = 0
  let skipped = 0
  let failed = 0


  for (const peer of peers) {
    if (!peer.sessionJournal.trim()) {
      incrementReason(skippedReasons, "missing-session-journal")
      skipped++
      continue
    }
    if (!isSafeSessionId(peer.sessionId)) {
      incrementReason(skippedReasons, "unsafe-session-id")
      skipped++
      continue
    }
    if (!includeAll && !isUuidLike(peer.sessionId)) {
      incrementReason(skippedReasons, "invalid-session-id")
      skipped++
      continue
    }
    if (!includeAll && isTmpCwd(peer.cwd)) {
      incrementReason(skippedReasons, "tmp-cwd")
      skipped++
      continue
    }

    let current: JournalStat
    try {
      current = await statJournal(peer.sessionJournal)
    } catch (error) {
      if (isMissingJournalError(error)) {
        incrementReason(skippedReasons, "missing-journal-file")
        skipped++
        continue
      }
      failed++
      try {
        await appendErrorLog(paths.errorLogPath, peer.sessionId, error, stamp)
      } catch (logError) {
        console.error(`fleet observer error log failed: ${logError instanceof Error ? logError.message : String(logError)}`)
      }
      continue
    }
    survivingSessionIds.add(peer.sessionId)
    journalStats.set(peer.sessionId, current)

    try {
      if (!shouldObserve(peer, cursors[peer.sessionId], current, threshold)) {
        await refreshIdentity(paths, peer, stamp)
        nextCursors[peer.sessionId] = current
        incrementReason(skippedReasons, "below-threshold")
        skipped++
        continue
      }
      const tail = await readJournalTail(peer.sessionJournal, DEFAULT_TAIL_LINES, readText)
      const excerpt = compressExcerpt(tail)
      if (!excerpt) throw new Error("journal tail contained no readable text")
      const model = options.model ?? process.env.OBSERVER_MODEL
      if (!model) throw new Error("OBSERVER_MODEL is not set")
      const summaryCommand = buildSummaryCommand(excerpt, model, binary)
      const summaryResult = await runner(summaryCommand)
      if (summaryResult.exitCode !== 0) throw commandFailure(summaryCommand, summaryResult)
      const summary = parseSummaryOutput(summaryResult.stdout)
      if (!summary) throw new Error("observer model returned no summary")
      const identity = liveIdentity(peer)
      const liveName = identity.name
      const liveWorkstream = identity.workstream
      const labelOutput: SummaryOutput = {
        ...summary,
        name: liveName,
        workstream: peer.workstream ? oneLine(peer.workstream) : undefined,
      }
      const labelCommand = buildLabelCommand(peer.sessionId, labelOutput, binary)
      const labelResult = await runner(labelCommand)
      if (labelResult.exitCode !== 0) throw commandFailure(labelCommand, labelResult)
      await writeStateFiles(paths, {
        sessionId: peer.sessionId,
        name: liveName,
        state: peer.state,
        workstream: liveWorkstream,
        summary: summary.summary,
        layers: summary.layers,
        journalPath: peer.sessionJournal,
        stamp,
      })
      nextCursors[peer.sessionId] = current
      observed++
    } catch (error) {
      failed++
      try {
        await appendErrorLog(paths.errorLogPath, peer.sessionId, error, stamp)
      } catch (logError) {
        console.error(`fleet observer error log failed: ${logError instanceof Error ? logError.message : String(logError)}`)
      }
    }
  }

  const parkCandidates = await regenerateIndex(paths, survivingSessionIds, journalStats, now.getTime(), parkIdleHours)
  await saveCursorStore(paths.cursorPath, nextCursors)
  return { ran: true, peers: peers.length, observed, skipped, failed, parkCandidates, skippedReasons }

}

async function main(argv: readonly string[]): Promise<number> {
  const once = argv.includes("--once")
  const loop = argv.includes("--loop")
  const includeAll = argv.includes("--include-all")
  if (
    argv.some(argument => argument !== "--once" && argument !== "--loop" && argument !== "--include-all") ||
    (once && loop)
  ) {
    console.error("usage: bun run observe -- [--once|--loop] [--include-all]")
    return 2
  }
  do {
    // Liveness for the supervisor health check: stamp before AND after each
    // pass so a long summarize burst never reads as dead.
    const heartbeatPath = defaultObserverPaths().heartbeatPath
    await Bun.write(heartbeatPath, new Date().toISOString())
    try {
      const result = await runObserverPass({ includeAll })
      process.stdout.write(
        `fleet observer: ${result.observed} observed, ${result.skipped} skipped, ${result.failed} failed; park candidates: ${result.parkCandidates}; skip reasons: ${formatSkippedReasons(result.skippedReasons)}\n`,
      )
    } catch (error) {
      await appendErrorLog(defaultObserverPaths().errorLogPath, "_pass", error)
      console.error(error instanceof Error ? error.message : String(error))
      if (!loop) return 1
    }
    if (!loop) return 0
    await Bun.write(heartbeatPath, new Date().toISOString())
    await Bun.sleep(jitteredIntervalMs(intervalMsFromEnv()))
  } while (true)
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
