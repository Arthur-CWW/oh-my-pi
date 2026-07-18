import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

export interface FleetSession {
  readonly sessionId: string
  readonly name: string
  readonly state: string
  readonly workstream: string
  readonly objective: string
  readonly summary: string
  readonly spawnName: string
  readonly todoHead: string
  readonly lastSeen: string
  readonly cwd: string
  readonly pid: number | null
  readonly sessionJournal: string
  readonly version: string
  readonly versionSkew: boolean
}

export interface FleetOverviewApiRow {
  readonly session_id: string
  readonly name: string
  readonly state: string
  readonly workstream: string
  readonly objective: string
  readonly summary: string
  readonly spawnName: string
  readonly todo_head: string
  readonly last_seen: string
  readonly cwd: string
  readonly pid: number | null
  readonly session_journal: string
  readonly version: string
  readonly versionSkew: boolean
}

export interface RegisterCard {
  readonly id: string
  readonly intent: string
  readonly status: string
  readonly phase: string
}

export interface FleetBoardPaths {
  readonly repoRoot: string
  readonly stateDocsDir: string
  readonly registerPath: string
  readonly errorLogPath: string
}

export interface RegisterSnapshot {
  readonly mtimeMs: number
  readonly size: number
  readonly cards: readonly RegisterCard[]
}

interface JsonRecord {
  readonly [key: string]: unknown
}

const MAX_INTENT_LENGTH = 200
const SESSION_ID_PATTERN = /^[^/\\]+$/

function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as JsonRecord
}

function firstValue(record: JsonRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

function textValue(record: JsonRecord, keys: readonly string[]): string {
  const value = firstValue(record, keys)
  return typeof value === "string" ? value.trim() : ""
}

function numberValue(record: JsonRecord, keys: readonly string[]): number | null {
  const value = firstValue(record, keys)
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function sourceRows(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (!record) return []
  const rows = firstValue(record, ["rows", "sessions", "peers"])
  return Array.isArray(rows) ? rows : []
}

function modalVersion(rows: readonly FleetSession[]): string {
  const counts = new Map<string, number>()
  let selected = ""
  let selectedCount = 0
  for (const row of rows) {
    if (!row.version) continue
    const count = (counts.get(row.version) ?? 0) + 1
    counts.set(row.version, count)
    if (count > selectedCount) {
      selected = row.version
      selectedCount = count
    }
  }
  return selected
}

/** Decode the JSON emitted by `omp fleet overview --json` without trusting its shape. */
export function decodeOverview(value: unknown): readonly FleetSession[] {
  const decoded: FleetSession[] = []
  for (const candidate of sourceRows(value)) {
    const record = asRecord(candidate)
    if (!record) continue
    const sessionId = textValue(record, ["session_id", "sessionId", "id"])
    if (!sessionId) continue
    decoded.push({
      sessionId,
      name: textValue(record, ["name"]),
      state: textValue(record, ["state", "display_state", "displayState"]),
      workstream: textValue(record, ["workstream"]),
      objective: textValue(record, ["objective"]),
      summary: textValue(record, ["summary"]),
      spawnName: textValue(record, ["spawn_name", "spawnName"]),
      todoHead: textValue(record, ["todo_head", "todoHead"]),
      lastSeen: textValue(record, ["last_seen", "lastSeen"]),
      cwd: textValue(record, ["cwd"]),
      pid: numberValue(record, ["pid"]),
      sessionJournal: textValue(record, ["session_journal", "sessionJournal"]),
      version: textValue(record, ["version", "product_version", "productVersion"]),
      versionSkew: false,
    })
  }
  const modal = modalVersion(decoded)
  return decoded.map(row => ({ ...row, versionSkew: Boolean(row.version && row.version !== modal) }))
}

/** Parse command output and return typed, version-skew annotated rows. */
export function parseOverviewJson(stdout: string): readonly FleetSession[] {
  if (!stdout.trim()) return []
  return decodeOverview(JSON.parse(stdout) as unknown)
}

export function toFleetOverviewApiRow(row: FleetSession): FleetOverviewApiRow {
  return {
    session_id: row.sessionId,
    name: row.name,
    state: row.state,
    workstream: row.workstream,
    objective: row.objective,
    summary: row.summary,
    spawnName: row.spawnName,
    todo_head: row.todoHead,
    last_seen: row.lastSeen,
    cwd: row.cwd,
    pid: row.pid,
    session_journal: row.sessionJournal,
    version: row.version,
    versionSkew: row.versionSkew,
  }
}

function stripMarkdown(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\\([|\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 1)}…`
}

function splitTableCells(line: string): string[] {
  let source = line.trim()
  if (source.startsWith("|")) source = source.slice(1)
  if (source.endsWith("|")) source = source.slice(0, -1)
  const cells: string[] = []
  let cell = ""
  let escaped = false
  for (const character of source) {
    if (escaped) {
      cell += character
      escaped = false
    } else if (character === "\\") {
      cell += character
      escaped = true
    } else if (character === "|") {
      cells.push(cell.trim())
      cell = ""
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
}

function headerIndexes(lines: readonly string[]): { id: number; intent: number; status: number; phase: number } {
  for (const line of lines) {
    if (!line.includes("|")) continue
    const cells = splitTableCells(line).map(stripMarkdown).map(cell => cell.toLowerCase())
    const id = cells.findIndex(cell => cell === "id" || cell === "request id")
    const intent = cells.findIndex(cell => cell.includes("intent"))
    const status = cells.findIndex(cell => cell === "status")
    const phase = cells.findIndex(cell => cell.includes("phase"))
    if (id >= 0 && intent >= 0 && status >= 0 && phase >= 0) return { id, intent, status, phase }
  }
  return { id: 0, intent: 1, status: 2, phase: 3 }
}

function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 && index < cells.length ? stripMarkdown(cells[index]) : ""
}

/** Parse register table rows while tolerating markdown formatting and long cells. */
export function parseRegisterMarkdown(markdown: string): readonly RegisterCard[] {
  const lines = markdown.split(/\r?\n/)
  const indexes = headerIndexes(lines)
  const cards: RegisterCard[] = []
  for (const line of lines) {
    if (!line.trim().startsWith("|") || !line.includes("|")) continue
    const cells = splitTableCells(line)
    if (isSeparatorRow(cells)) continue
    const id = cellAt(cells, indexes.id).toUpperCase()
    if (!/^HR-\d+$/.test(id)) continue
    const statusCell = cellAt(cells, indexes.status)
    const status = statusCell.split(/\s+/u)[0] ?? ""
    cards.push({
      id,
      intent: truncate(cellAt(cells, indexes.intent), MAX_INTENT_LENGTH),
      status,
      phase: cellAt(cells, indexes.phase),
    })
  }
  return cards
}

export function pathsAt(repoRoot: string): FleetBoardPaths {
  const root = resolve(repoRoot)
  return {
    repoRoot: root,
    stateDocsDir: join(root, "local", "state-docs"),
    registerPath: join(root, "docs", "fable", "harness-request-register.md"),
    errorLogPath: join(root, "data", "fleet-board", "errors.log"),
  }
}

export function defaultPaths(): FleetBoardPaths {
  // import.meta.dir = <repo>/packages/fleet-board/src → repo root is three levels up.
  return pathsAt(process.env.FLEET_BOARD_ROOT ?? resolve(import.meta.dir, "../../.."))
}

export async function readRegisterSnapshot(filePath: string): Promise<RegisterSnapshot> {
  const fileStat = await stat(filePath)
  const markdown = await readFile(filePath, "utf8")
  return { mtimeMs: fileStat.mtimeMs, size: fileStat.size, cards: parseRegisterMarkdown(markdown) }
}

export async function readStateDoc(paths: FleetBoardPaths, sessionId: string): Promise<string | null> {
  if (!SESSION_ID_PATTERN.test(sessionId) || sessionId.includes("..")) return null
  const root = resolve(paths.stateDocsDir)
  const filePath = resolve(root, `${sessionId}.md`)
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return null
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
    if (code === "ENOENT") return null
    throw error
  }
}

export async function appendErrorLog(errorLogPath: string, source: string, error: unknown, stamp = new Date().toISOString()): Promise<void> {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error)
  const line = `${stamp}\t${stripMarkdown(source)}\t${stripMarkdown(message)}\n`
  await mkdir(dirname(errorLogPath), { recursive: true })
  await appendFile(errorLogPath, line, "utf8")
}
