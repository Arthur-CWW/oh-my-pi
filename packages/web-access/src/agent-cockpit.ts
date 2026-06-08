import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

export type CockpitStatus =
  | "idle"
  | "running"
  | "thinking"
  | "tool"
  | "blocked"
  | "review"
  | "done"
  | "offline"
  | "unknown"
  | string

export type TerminalBackend = "zellij" | "tmux" | "direct" | string

export interface CockpitSessionInput {
  artifacts?: string[]
  branch?: string | null
  cwd?: string | null
  expiresAt?: number | null
  id?: string
  kind?: string
  objective?: string | null
  paneId?: string | null
  paneTitle?: string | null
  pid?: number | null
  repo?: string | null
  role?: string | null
  sessionFile?: string | null
  status?: CockpitStatus
  statusIcon?: string | null
  summary?: string | null
  tabId?: string | null
  tabName?: string | null
  tags?: string[]
  terminalBackend?: TerminalBackend | null
  terminalSession?: string | null
  title?: string | null
  transcriptPath?: string | null
  workgroupId?: string | null
  workgroupTitle?: string | null
}

export interface CockpitSessionRecord {
  artifacts: string[]
  branch: string | null
  createdAt: number
  cwd: string | null
  expiresAt: number | null
  id: string
  kind: string
  lastHeartbeatAt: number
  objective: string | null
  paneId: string | null
  paneTitle: string | null
  pid: number | null
  repo: string | null
  role: string | null
  sessionFile: string | null
  status: CockpitStatus
  statusIcon: string | null
  summary: string | null
  tabId: string | null
  tabName: string | null
  tags: string[]
  terminalBackend: TerminalBackend | null
  terminalSession: string | null
  title: string
  transcriptPath: string | null
  updatedAt: number
  workgroupId: string | null
}

export interface CockpitWorkgroupInput {
  id: string
  objective?: string | null
  status?: CockpitStatus
  title?: string | null
}

export interface CockpitWorkgroupRecord {
  createdAt: number
  id: string
  objective: string | null
  status: CockpitStatus
  title: string
  updatedAt: number
}

export interface CockpitEventInput {
  payload?: unknown
  sessionId?: string | null
  type: string
  workgroupId?: string | null
}

export interface CockpitEventRecord {
  id: number
  payload: unknown
  sessionId: string | null
  ts: number
  type: string
  workgroupId: string | null
}

export interface TerminalTabRecord {
  active: boolean
  backend: TerminalBackend
  name: string | null
  position: number | null
  raw: unknown
  tabId: string
  terminalSession: string
  updatedAt: number
}

export interface TerminalPaneRecord {
  backend: TerminalBackend
  command: string | null
  cwd: string | null
  exited: boolean
  exitStatus: number | null
  focused: boolean
  floating: boolean
  geometry: unknown
  paneId: string
  raw: unknown
  tabId: string | null
  tabName: string | null
  terminalSession: string
  title: string | null
  updatedAt: number
}

export interface CockpitSummary {
  dbPath: string
  generatedAt: number
  sessionsByStatus: Record<string, number>
  sessionsByWorkgroup: Record<string, number>
  staleSessions: number
  totalSessions: number
  workgroups: number
}

export interface CockpitDbOptions {
  dbPath?: string
  now?: number
}

export interface ListSessionsOptions extends CockpitDbOptions {
  activeWithinMs?: number
  includeExpired?: boolean
  limit?: number
  workgroupId?: string
}

export interface ZellijSnapshotOptions extends CockpitDbOptions {
  session?: string
  zellijBin?: string
}

interface CockpitSessionRow {
  artifacts_json: string | null
  branch: string | null
  created_at: number
  cwd: string | null
  expires_at: number | null
  id: string
  kind: string
  last_heartbeat_at: number
  objective: string | null
  pane_id: string | null
  pane_title: string | null
  pid: number | null
  repo: string | null
  role: string | null
  session_file: string | null
  status: string
  status_icon: string | null
  summary: string | null
  tab_id: string | null
  tab_name: string | null
  tags_json: string | null
  terminal_backend: string | null
  terminal_session: string | null
  title: string
  transcript_path: string | null
  updated_at: number
  workgroup_id: string | null
}

interface WorkgroupRow {
  created_at: number
  id: string
  objective: string | null
  status: string
  title: string
  updated_at: number
}

interface EventRow {
  id: number
  payload_json: string | null
  session_id: string | null
  ts: number
  type: string
  workgroup_id: string | null
}

interface TerminalTabRow {
  active: number | boolean | null
  backend: string
  name: string | null
  position: number | null
  raw_json: string | null
  tab_id: string
  terminal_session: string
  updated_at: number
}

interface TerminalPaneRow {
  backend: string
  command: string | null
  cwd: string | null
  exited: number | boolean | null
  exit_status: number | null
  focused: number | boolean | null
  floating: number | boolean | null
  geometry_json: string | null
  pane_id: string
  raw_json: string | null
  tab_id: string | null
  tab_name: string | null
  terminal_session: string
  title: string | null
  updated_at: number
}

export class AgentCockpitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentCockpitError"
  }
}

export function cockpitDbPath(): string {
  return process.env.PI_COCKPIT_DB?.trim()
    || join(homedir(), ".local", "share", "pi-cockpit", "cockpit.sqlite")
}

function nowMs(options?: CockpitDbOptions): number {
  return options?.now ?? Date.now()
}

function dbPath(options?: CockpitDbOptions): string {
  return options?.dbPath ?? cockpitDbPath()
}

function sqliteValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.trunc(value)) : "NULL"
  if (typeof value === "boolean") return value ? "1" : "0"
  return `'${value.replaceAll("\0", "").replaceAll("'", "''")}'`
}

function sqliteJson(value: unknown): string {
  return sqliteValue(JSON.stringify(value ?? null))
}

function clampLimit(limit: number | undefined, defaultLimit: number, maxLimit = 500): number {
  if (!Number.isFinite(limit ?? NaN)) return defaultLimit
  return Math.max(1, Math.min(Math.trunc(limit!), maxLimit))
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function boolFromSql(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1
}

function hashText(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12)
}

export function normalizeWorkgroupId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
}

function defaultTitle(input: { cwd?: string | null; id: string; sessionFile?: string | null }): string {
  if (input.cwd) return basename(input.cwd) || input.id
  if (input.sessionFile) return basename(input.sessionFile).replace(/\.jsonl$/i, "") || input.id
  return input.id
}

export function inferTerminalLinkFromEnv(env: NodeJS.ProcessEnv = process.env): Pick<
  CockpitSessionInput,
  "paneId" | "terminalBackend" | "terminalSession"
> {
  if (env.ZELLIJ || env.ZELLIJ_SESSION_NAME || env.ZELLIJ_PANE_ID) {
    return {
      paneId: trimOrNull(env.ZELLIJ_PANE_ID),
      terminalBackend: "zellij",
      terminalSession: trimOrNull(env.ZELLIJ_SESSION_NAME),
    }
  }
  if (env.TMUX || env.TMUX_PANE) {
    return {
      paneId: trimOrNull(env.TMUX_PANE),
      terminalBackend: "tmux",
      terminalSession: null,
    }
  }
  return { paneId: null, terminalBackend: "direct", terminalSession: null }
}

export function inferCockpitSessionId(input: CockpitSessionInput = {}, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = trimOrNull(input.id) || trimOrNull(env.PI_COCKPIT_SESSION_ID) || trimOrNull(env.PI_SESSION_ID)
  if (explicit) return explicit

  const sessionFile = trimOrNull(input.sessionFile)
  if (sessionFile) return `pi:${hashText(sessionFile)}`

  const terminalSession = trimOrNull(input.terminalSession) || trimOrNull(env.ZELLIJ_SESSION_NAME)
  const paneId = trimOrNull(input.paneId) || trimOrNull(env.ZELLIJ_PANE_ID) || trimOrNull(env.TMUX_PANE)
  if (terminalSession && paneId) return `pane:${hashText(`${terminalSession}:${paneId}`)}`
  if (paneId) return `pane:${hashText(paneId)}`

  const cwd = trimOrNull(input.cwd) || process.cwd()
  return `process:${hashText(`${cwd}:${process.pid}`)}`
}

function runProcess(command: string, args: string[], stdin?: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr.toString().trim() || err.message
        reject(new AgentCockpitError(`${command} ${args.join(" ")}: ${msg}`))
        return
      }
      resolve(stdout.toString())
    })
    if (stdin !== undefined) child.stdin?.end(stdin)
  })
}

async function runSql(script: string, options?: CockpitDbOptions): Promise<string> {
  const path = dbPath(options)
  await mkdir(dirname(path), { recursive: true })
  return await runProcess("sqlite3", [path], `.timeout 5000\n${script}`)
}

async function queryJson<T>(selectSql: string, options?: CockpitDbOptions): Promise<T[]> {
  await initCockpitDb(options)
  const out = await runSql(`.mode json\n${selectSql}\n`, options)
  const trimmed = out.trim()
  if (!trimmed) return []
  return JSON.parse(trimmed) as T[]
}

export async function initCockpitDb(options?: CockpitDbOptions): Promise<string> {
  const path = dbPath(options)
  await mkdir(dirname(path), { recursive: true })
  await runSql(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS cockpit_workgroups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cockpit_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'pi',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  status_icon TEXT,
  workgroup_id TEXT,
  role TEXT,
  objective TEXT,
  summary TEXT,
  cwd TEXT,
  repo TEXT,
  branch TEXT,
  pid INTEGER,
  terminal_backend TEXT,
  terminal_session TEXT,
  tab_id TEXT,
  tab_name TEXT,
  pane_id TEXT,
  pane_title TEXT,
  session_file TEXT,
  transcript_path TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  expires_at INTEGER,
  FOREIGN KEY(workgroup_id) REFERENCES cockpit_workgroups(id)
);

CREATE INDEX IF NOT EXISTS idx_cockpit_sessions_workgroup_updated
  ON cockpit_sessions(workgroup_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cockpit_sessions_status_updated
  ON cockpit_sessions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cockpit_sessions_heartbeat
  ON cockpit_sessions(last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS cockpit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  session_id TEXT,
  workgroup_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cockpit_events_session_ts
  ON cockpit_events(session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cockpit_events_workgroup_ts
  ON cockpit_events(workgroup_id, ts DESC);

CREATE TABLE IF NOT EXISTS terminal_tabs (
  backend TEXT NOT NULL,
  terminal_session TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  position INTEGER,
  name TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (backend, terminal_session, tab_id)
);

CREATE TABLE IF NOT EXISTS terminal_panes (
  backend TEXT NOT NULL,
  terminal_session TEXT NOT NULL,
  pane_id TEXT NOT NULL,
  tab_id TEXT,
  tab_name TEXT,
  title TEXT,
  command TEXT,
  cwd TEXT,
  focused INTEGER NOT NULL DEFAULT 0,
  floating INTEGER NOT NULL DEFAULT 0,
  exited INTEGER NOT NULL DEFAULT 0,
  exit_status INTEGER,
  geometry_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (backend, terminal_session, pane_id)
);

CREATE INDEX IF NOT EXISTS idx_terminal_panes_tab
  ON terminal_panes(backend, terminal_session, tab_id);
`, { ...options, dbPath: path })
  return path
}

function sessionFromRow(row: CockpitSessionRow): CockpitSessionRecord {
  return {
    artifacts: parseJson<string[]>(row.artifacts_json, []),
    branch: row.branch,
    createdAt: row.created_at,
    cwd: row.cwd,
    expiresAt: row.expires_at,
    id: row.id,
    kind: row.kind,
    lastHeartbeatAt: row.last_heartbeat_at,
    objective: row.objective,
    paneId: row.pane_id,
    paneTitle: row.pane_title,
    pid: row.pid,
    repo: row.repo,
    role: row.role,
    sessionFile: row.session_file,
    status: row.status,
    statusIcon: row.status_icon,
    summary: row.summary,
    tabId: row.tab_id,
    tabName: row.tab_name,
    tags: parseJson<string[]>(row.tags_json, []),
    terminalBackend: row.terminal_backend,
    terminalSession: row.terminal_session,
    title: row.title,
    transcriptPath: row.transcript_path,
    updatedAt: row.updated_at,
    workgroupId: row.workgroup_id,
  }
}

function workgroupFromRow(row: WorkgroupRow): CockpitWorkgroupRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    objective: row.objective,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  }
}

function eventFromRow(row: EventRow): CockpitEventRecord {
  return {
    id: row.id,
    payload: parseJson<unknown>(row.payload_json, {}),
    sessionId: row.session_id,
    ts: row.ts,
    type: row.type,
    workgroupId: row.workgroup_id,
  }
}

function terminalTabFromRow(row: TerminalTabRow): TerminalTabRecord {
  return {
    active: boolFromSql(row.active),
    backend: row.backend,
    name: row.name,
    position: row.position,
    raw: parseJson(row.raw_json, {}),
    tabId: row.tab_id,
    terminalSession: row.terminal_session,
    updatedAt: row.updated_at,
  }
}

function terminalPaneFromRow(row: TerminalPaneRow): TerminalPaneRecord {
  return {
    backend: row.backend,
    command: row.command,
    cwd: row.cwd,
    exited: boolFromSql(row.exited),
    exitStatus: row.exit_status,
    focused: boolFromSql(row.focused),
    floating: boolFromSql(row.floating),
    geometry: parseJson(row.geometry_json, {}),
    paneId: row.pane_id,
    raw: parseJson(row.raw_json, {}),
    tabId: row.tab_id,
    tabName: row.tab_name,
    terminalSession: row.terminal_session,
    title: row.title,
    updatedAt: row.updated_at,
  }
}

export async function saveWorkgroup(input: CockpitWorkgroupInput, options?: CockpitDbOptions): Promise<CockpitWorkgroupRecord> {
  await initCockpitDb(options)
  const id = normalizeWorkgroupId(input.id)
  if (!id) throw new AgentCockpitError("Workgroup id is empty.")
  const existing = await getWorkgroup(id, options)
  const now = nowMs(options)
  const title = trimOrNull(input.title) ?? existing?.title ?? input.id.trim()
  const status = input.status ?? existing?.status ?? "active"
  const objective = input.objective !== undefined ? trimOrNull(input.objective) : existing?.objective ?? null
  const createdAt = existing?.createdAt ?? now
  await runSql(`
INSERT INTO cockpit_workgroups (id, title, objective, status, created_at, updated_at)
VALUES (${sqliteValue(id)}, ${sqliteValue(title)}, ${sqliteValue(objective)}, ${sqliteValue(status)}, ${createdAt}, ${now})
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  objective = excluded.objective,
  status = excluded.status,
  updated_at = excluded.updated_at;
`, options)
  return { createdAt, id, objective, status, title, updatedAt: now }
}

export async function getWorkgroup(id: string, options?: CockpitDbOptions): Promise<CockpitWorkgroupRecord | null> {
  const normalized = normalizeWorkgroupId(id)
  if (!normalized) return null
  const rows = await queryJson<WorkgroupRow>(`
SELECT id, title, objective, status, created_at, updated_at
FROM cockpit_workgroups
WHERE id = ${sqliteValue(normalized)}
LIMIT 1;
`, options)
  return rows[0] ? workgroupFromRow(rows[0]) : null
}

export async function listWorkgroups(options?: CockpitDbOptions): Promise<CockpitWorkgroupRecord[]> {
  const rows = await queryJson<WorkgroupRow>(`
SELECT id, title, objective, status, created_at, updated_at
FROM cockpit_workgroups
ORDER BY updated_at DESC;
`, options)
  return rows.map(workgroupFromRow)
}

export async function getSession(id: string, options?: CockpitDbOptions): Promise<CockpitSessionRecord | null> {
  const rows = await queryJson<CockpitSessionRow>(`
SELECT *
FROM cockpit_sessions
WHERE id = ${sqliteValue(id)}
LIMIT 1;
`, options)
  return rows[0] ? sessionFromRow(rows[0]) : null
}

export async function publishSession(input: CockpitSessionInput = {}, options?: CockpitDbOptions): Promise<CockpitSessionRecord> {
  await initCockpitDb(options)
  const terminalEnv = inferTerminalLinkFromEnv()
  const id = inferCockpitSessionId({
    ...input,
    paneId: input.paneId ?? terminalEnv.paneId,
    terminalSession: input.terminalSession ?? terminalEnv.terminalSession,
  })
  const existing = await getSession(id, options)
  const now = nowMs(options)
  const rawWorkgroupId = input.workgroupId !== undefined ? trimOrNull(input.workgroupId) : undefined
  const workgroupId = input.workgroupId !== undefined
    ? (rawWorkgroupId ? normalizeWorkgroupId(rawWorkgroupId) : null)
    : existing?.workgroupId ?? null

  if (workgroupId) {
    await saveWorkgroup({
      id: workgroupId,
      title: input.workgroupTitle ?? rawWorkgroupId ?? workgroupId,
    }, options)
  }

  const cwd = input.cwd !== undefined ? trimOrNull(input.cwd) : existing?.cwd ?? process.cwd()
  const sessionFile = input.sessionFile !== undefined ? trimOrNull(input.sessionFile) : existing?.sessionFile ?? null
  const record: CockpitSessionRecord = {
    artifacts: input.artifacts ?? existing?.artifacts ?? [],
    branch: input.branch !== undefined ? trimOrNull(input.branch) : existing?.branch ?? null,
    createdAt: existing?.createdAt ?? now,
    cwd,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing?.expiresAt ?? null,
    id,
    kind: input.kind ?? existing?.kind ?? "pi",
    lastHeartbeatAt: now,
    objective: input.objective !== undefined ? trimOrNull(input.objective) : existing?.objective ?? null,
    paneId: input.paneId !== undefined ? trimOrNull(input.paneId) : existing?.paneId ?? terminalEnv.paneId ?? null,
    paneTitle: input.paneTitle !== undefined ? trimOrNull(input.paneTitle) : existing?.paneTitle ?? null,
    pid: input.pid !== undefined ? input.pid : existing?.pid ?? process.pid,
    repo: input.repo !== undefined ? trimOrNull(input.repo) : existing?.repo ?? null,
    role: input.role !== undefined ? trimOrNull(input.role) : existing?.role ?? null,
    sessionFile,
    status: input.status ?? existing?.status ?? "unknown",
    statusIcon: input.statusIcon !== undefined ? trimOrNull(input.statusIcon) : existing?.statusIcon ?? null,
    summary: input.summary !== undefined ? trimOrNull(input.summary) : existing?.summary ?? null,
    tabId: input.tabId !== undefined ? trimOrNull(input.tabId) : existing?.tabId ?? null,
    tabName: input.tabName !== undefined ? trimOrNull(input.tabName) : existing?.tabName ?? null,
    tags: input.tags ?? existing?.tags ?? [],
    terminalBackend: input.terminalBackend !== undefined ? trimOrNull(input.terminalBackend) : existing?.terminalBackend ?? terminalEnv.terminalBackend ?? null,
    terminalSession: input.terminalSession !== undefined ? trimOrNull(input.terminalSession) : existing?.terminalSession ?? terminalEnv.terminalSession ?? null,
    title: trimOrNull(input.title) ?? existing?.title ?? defaultTitle({ cwd, id, sessionFile }),
    transcriptPath: input.transcriptPath !== undefined ? trimOrNull(input.transcriptPath) : existing?.transcriptPath ?? null,
    updatedAt: now,
    workgroupId,
  }

  await runSql(`
INSERT INTO cockpit_sessions (
  id, kind, title, status, status_icon, workgroup_id, role, objective, summary,
  cwd, repo, branch, pid, terminal_backend, terminal_session, tab_id, tab_name,
  pane_id, pane_title, session_file, transcript_path, artifacts_json, tags_json,
  created_at, updated_at, last_heartbeat_at, expires_at
) VALUES (
  ${sqliteValue(record.id)},
  ${sqliteValue(record.kind)},
  ${sqliteValue(record.title)},
  ${sqliteValue(record.status)},
  ${sqliteValue(record.statusIcon)},
  ${sqliteValue(record.workgroupId)},
  ${sqliteValue(record.role)},
  ${sqliteValue(record.objective)},
  ${sqliteValue(record.summary)},
  ${sqliteValue(record.cwd)},
  ${sqliteValue(record.repo)},
  ${sqliteValue(record.branch)},
  ${sqliteValue(record.pid)},
  ${sqliteValue(record.terminalBackend)},
  ${sqliteValue(record.terminalSession)},
  ${sqliteValue(record.tabId)},
  ${sqliteValue(record.tabName)},
  ${sqliteValue(record.paneId)},
  ${sqliteValue(record.paneTitle)},
  ${sqliteValue(record.sessionFile)},
  ${sqliteValue(record.transcriptPath)},
  ${sqliteJson(record.artifacts)},
  ${sqliteJson(record.tags)},
  ${record.createdAt},
  ${record.updatedAt},
  ${record.lastHeartbeatAt},
  ${sqliteValue(record.expiresAt)}
)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  title = excluded.title,
  status = excluded.status,
  status_icon = excluded.status_icon,
  workgroup_id = excluded.workgroup_id,
  role = excluded.role,
  objective = excluded.objective,
  summary = excluded.summary,
  cwd = excluded.cwd,
  repo = excluded.repo,
  branch = excluded.branch,
  pid = excluded.pid,
  terminal_backend = excluded.terminal_backend,
  terminal_session = excluded.terminal_session,
  tab_id = excluded.tab_id,
  tab_name = excluded.tab_name,
  pane_id = excluded.pane_id,
  pane_title = excluded.pane_title,
  session_file = excluded.session_file,
  transcript_path = excluded.transcript_path,
  artifacts_json = excluded.artifacts_json,
  tags_json = excluded.tags_json,
  updated_at = excluded.updated_at,
  last_heartbeat_at = excluded.last_heartbeat_at,
  expires_at = excluded.expires_at;
`, options)

  await recordEvent({
    payload: { status: record.status, title: record.title },
    sessionId: record.id,
    type: "session.publish",
    workgroupId: record.workgroupId,
  }, options)

  return record
}

export async function recordEvent(input: CockpitEventInput, options?: CockpitDbOptions): Promise<CockpitEventRecord> {
  await initCockpitDb(options)
  const ts = nowMs(options)
  await runSql(`
INSERT INTO cockpit_events (ts, type, session_id, workgroup_id, payload_json)
VALUES (
  ${ts},
  ${sqliteValue(input.type)},
  ${sqliteValue(input.sessionId ?? null)},
  ${sqliteValue(input.workgroupId ?? null)},
  ${sqliteJson(input.payload ?? {})}
);
`, options)
  const rows = await queryJson<EventRow>(`
SELECT id, ts, type, session_id, workgroup_id, payload_json
FROM cockpit_events
WHERE ts = ${ts}
  AND type = ${sqliteValue(input.type)}
  AND (${input.sessionId ? `session_id = ${sqliteValue(input.sessionId)}` : "session_id IS NULL"})
ORDER BY id DESC
LIMIT 1;
`, options)
  return rows[0] ? eventFromRow(rows[0]) : {
    id: 0,
    payload: input.payload ?? {},
    sessionId: input.sessionId ?? null,
    ts,
    type: input.type,
    workgroupId: input.workgroupId ?? null,
  }
}

export async function listSessions(options: ListSessionsOptions = {}): Promise<CockpitSessionRecord[]> {
  const clauses: string[] = []
  if (options.workgroupId) clauses.push(`workgroup_id = ${sqliteValue(normalizeWorkgroupId(options.workgroupId))}`)
  if (!options.includeExpired) clauses.push(`(expires_at IS NULL OR expires_at > ${nowMs(options)})`)
  if (options.activeWithinMs && options.activeWithinMs > 0) {
    clauses.push(`last_heartbeat_at >= ${nowMs(options) - options.activeWithinMs}`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = clampLimit(options.limit, 50)
  const rows = await queryJson<CockpitSessionRow>(`
SELECT *
FROM cockpit_sessions
${where}
ORDER BY COALESCE(workgroup_id, ''), updated_at DESC
LIMIT ${limit};
`, options)
  return rows.map(sessionFromRow)
}

export async function listEvents(options: CockpitDbOptions & {
  limit?: number
  sessionId?: string
  workgroupId?: string
} = {}): Promise<CockpitEventRecord[]> {
  const clauses: string[] = []
  if (options.sessionId) clauses.push(`session_id = ${sqliteValue(options.sessionId)}`)
  if (options.workgroupId) clauses.push(`workgroup_id = ${sqliteValue(normalizeWorkgroupId(options.workgroupId))}`)
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = clampLimit(options.limit, 50)
  const rows = await queryJson<EventRow>(`
SELECT id, ts, type, session_id, workgroup_id, payload_json
FROM cockpit_events
${where}
ORDER BY ts DESC, id DESC
LIMIT ${limit};
`, options)
  return rows.map(eventFromRow)
}

export async function markSessionOffline(id: string, options?: CockpitDbOptions): Promise<CockpitSessionRecord> {
  return await publishSession({ id, status: "offline", expiresAt: nowMs(options) + 7 * 24 * 60 * 60 * 1000 }, options)
}

function getString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return null
}

function getNumber(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function getBool(raw: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "boolean") return value
    if (typeof value === "number") return value !== 0
    if (typeof value === "string") return value === "true" || value === "1"
  }
  return false
}

function normalizeTab(rawValue: unknown, backend: TerminalBackend, terminalSession: string, now: number): TerminalTabRecord | null {
  if (!rawValue || typeof rawValue !== "object") return null
  const raw = rawValue as Record<string, unknown>
  const tabId = getString(raw, ["tab_id", "id", "position"])
  if (!tabId) return null
  return {
    active: getBool(raw, ["active", "is_active"]),
    backend,
    name: getString(raw, ["name", "tab_name", "title"]),
    position: getNumber(raw, ["position", "tab_position"]),
    raw,
    tabId,
    terminalSession,
    updatedAt: now,
  }
}

function normalizePane(rawValue: unknown, backend: TerminalBackend, terminalSession: string, now: number): TerminalPaneRecord | null {
  if (!rawValue || typeof rawValue !== "object") return null
  const raw = rawValue as Record<string, unknown>
  const paneId = getString(raw, ["pane_id", "id"])
  if (!paneId) return null
  const geometry = {
    columns: getNumber(raw, ["pane_columns", "columns", "cols"]),
    rows: getNumber(raw, ["pane_rows", "rows"]),
    x: getNumber(raw, ["pane_x", "x"]),
    y: getNumber(raw, ["pane_y", "y"]),
  }
  return {
    backend,
    command: getString(raw, ["pane_command", "command"]),
    cwd: getString(raw, ["pane_cwd", "cwd"]),
    exited: getBool(raw, ["exited", "is_exited"]),
    exitStatus: getNumber(raw, ["exit_status"]),
    focused: getBool(raw, ["is_focused", "focused"]),
    floating: getBool(raw, ["is_floating", "floating"]),
    geometry,
    paneId,
    raw,
    tabId: getString(raw, ["tab_id"]),
    tabName: getString(raw, ["tab_name"]),
    terminalSession,
    title: getString(raw, ["title", "pane_title"]),
    updatedAt: now,
  }
}

export async function saveTerminalSnapshot(input: {
  backend: TerminalBackend
  panes: unknown[]
  tabs: unknown[]
  terminalSession: string
}, options?: CockpitDbOptions): Promise<{ panes: TerminalPaneRecord[]; tabs: TerminalTabRecord[] }> {
  await initCockpitDb(options)
  const now = nowMs(options)
  const terminalSession = input.terminalSession.trim() || "current"
  const tabs = input.tabs.flatMap((tab) => {
    const normalized = normalizeTab(tab, input.backend, terminalSession, now)
    return normalized ? [normalized] : []
  })
  const panes = input.panes.flatMap((pane) => {
    const normalized = normalizePane(pane, input.backend, terminalSession, now)
    return normalized ? [normalized] : []
  })

  const statements: string[] = []
  for (const tab of tabs) {
    statements.push(`
INSERT INTO terminal_tabs (backend, terminal_session, tab_id, position, name, active, raw_json, updated_at)
VALUES (${sqliteValue(tab.backend)}, ${sqliteValue(tab.terminalSession)}, ${sqliteValue(tab.tabId)}, ${sqliteValue(tab.position)}, ${sqliteValue(tab.name)}, ${sqliteValue(tab.active)}, ${sqliteJson(tab.raw)}, ${tab.updatedAt})
ON CONFLICT(backend, terminal_session, tab_id) DO UPDATE SET
  position = excluded.position,
  name = excluded.name,
  active = excluded.active,
  raw_json = excluded.raw_json,
  updated_at = excluded.updated_at;
`)
  }
  for (const pane of panes) {
    statements.push(`
INSERT INTO terminal_panes (
  backend, terminal_session, pane_id, tab_id, tab_name, title, command, cwd,
  focused, floating, exited, exit_status, geometry_json, raw_json, updated_at
) VALUES (
  ${sqliteValue(pane.backend)},
  ${sqliteValue(pane.terminalSession)},
  ${sqliteValue(pane.paneId)},
  ${sqliteValue(pane.tabId)},
  ${sqliteValue(pane.tabName)},
  ${sqliteValue(pane.title)},
  ${sqliteValue(pane.command)},
  ${sqliteValue(pane.cwd)},
  ${sqliteValue(pane.focused)},
  ${sqliteValue(pane.floating)},
  ${sqliteValue(pane.exited)},
  ${sqliteValue(pane.exitStatus)},
  ${sqliteJson(pane.geometry)},
  ${sqliteJson(pane.raw)},
  ${pane.updatedAt}
)
ON CONFLICT(backend, terminal_session, pane_id) DO UPDATE SET
  tab_id = excluded.tab_id,
  tab_name = excluded.tab_name,
  title = excluded.title,
  command = excluded.command,
  cwd = excluded.cwd,
  focused = excluded.focused,
  floating = excluded.floating,
  exited = excluded.exited,
  exit_status = excluded.exit_status,
  geometry_json = excluded.geometry_json,
  raw_json = excluded.raw_json,
  updated_at = excluded.updated_at;
`)
  }
  if (statements.length) await runSql(`BEGIN;\n${statements.join("\n")}\nCOMMIT;`, options)
  await recordEvent({ payload: { panes: panes.length, tabs: tabs.length }, type: "terminal.snapshot" }, options)
  return { panes, tabs }
}

export async function importZellijSnapshot(options: ZellijSnapshotOptions = {}): Promise<{ panes: TerminalPaneRecord[]; tabs: TerminalTabRecord[] }> {
  const session = options.session ?? process.env.ZELLIJ_SESSION_NAME ?? "current"
  const zellijBin = options.zellijBin ?? "zellij"
  const prefix = options.session ? ["--session", options.session] : []
  const [panesOut, tabsOut] = await Promise.all([
    runProcess(zellijBin, [...prefix, "action", "list-panes", "--all", "--json"]),
    runProcess(zellijBin, [...prefix, "action", "list-tabs", "--all", "--json"]),
  ])
  const panes = JSON.parse(panesOut || "[]") as unknown[]
  const tabs = JSON.parse(tabsOut || "[]") as unknown[]
  return await saveTerminalSnapshot({ backend: "zellij", panes, tabs, terminalSession: session }, options)
}

export async function listTerminalPanes(options: CockpitDbOptions & {
  backend?: TerminalBackend
  terminalSession?: string
} = {}): Promise<TerminalPaneRecord[]> {
  const clauses: string[] = []
  if (options.backend) clauses.push(`backend = ${sqliteValue(options.backend)}`)
  if (options.terminalSession) clauses.push(`terminal_session = ${sqliteValue(options.terminalSession)}`)
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const rows = await queryJson<TerminalPaneRow>(`
SELECT *
FROM terminal_panes
${where}
ORDER BY updated_at DESC;
`, options)
  return rows.map(terminalPaneFromRow)
}

export async function listTerminalTabs(options: CockpitDbOptions & {
  backend?: TerminalBackend
  terminalSession?: string
} = {}): Promise<TerminalTabRecord[]> {
  const clauses: string[] = []
  if (options.backend) clauses.push(`backend = ${sqliteValue(options.backend)}`)
  if (options.terminalSession) clauses.push(`terminal_session = ${sqliteValue(options.terminalSession)}`)
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const rows = await queryJson<TerminalTabRow>(`
SELECT *
FROM terminal_tabs
${where}
ORDER BY position, updated_at DESC;
`, options)
  return rows.map(terminalTabFromRow)
}

export async function getCockpitSummary(options: CockpitDbOptions & { staleAfterMs?: number } = {}): Promise<CockpitSummary> {
  const sessions = await listSessions({ ...options, includeExpired: true, limit: 500 })
  const workgroups = await listWorkgroups(options)
  const staleAfterMs = options.staleAfterMs ?? 2 * 60 * 1000
  const now = nowMs(options)
  const sessionsByStatus: Record<string, number> = {}
  const sessionsByWorkgroup: Record<string, number> = {}
  let staleSessions = 0
  for (const session of sessions) {
    sessionsByStatus[session.status] = (sessionsByStatus[session.status] ?? 0) + 1
    const wg = session.workgroupId ?? "ungrouped"
    sessionsByWorkgroup[wg] = (sessionsByWorkgroup[wg] ?? 0) + 1
    if (session.status !== "offline" && now - session.lastHeartbeatAt > staleAfterMs) staleSessions += 1
  }
  return {
    dbPath: dbPath(options),
    generatedAt: now,
    sessionsByStatus,
    sessionsByWorkgroup,
    staleSessions,
    totalSessions: sessions.length,
    workgroups: workgroups.length,
  }
}

export function statusIcon(status: CockpitStatus): string {
  if (status === "idle") return "○"
  if (status === "running") return "▶"
  if (status === "thinking") return "✶"
  if (status === "tool") return "⚙"
  if (status === "blocked") return "!"
  if (status === "review") return "◇"
  if (status === "done") return "✓"
  if (status === "offline") return "×"
  return "?"
}

function ageLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function pad(value: string, width: number): string {
  const clean = value.replace(/\s+/g, " ").trim()
  if (clean.length > width) return clean.slice(0, Math.max(0, width - 1)) + "…"
  return clean.padEnd(width, " ")
}

export function formatSessionList(sessions: CockpitSessionRecord[], options: { now?: number } = {}): string {
  if (!sessions.length) return "No cockpit sessions."
  const now = options.now ?? Date.now()
  const lines = [
    `${pad("ST", 3)} ${pad("UPDATED", 7)} ${pad("WORKGROUP", 15)} ${pad("ROLE", 12)} ${pad("TITLE", 28)} ${pad("OBJECTIVE/SUMMARY", 40)}`,
  ]
  for (const session of sessions) {
    const icon = session.statusIcon ?? statusIcon(session.status)
    const wg = session.workgroupId ?? "-"
    const role = session.role ?? session.kind
    const summary = session.objective ?? session.summary ?? session.cwd ?? ""
    lines.push(`${pad(icon, 3)} ${pad(ageLabel(now - session.updatedAt), 7)} ${pad(wg, 15)} ${pad(role, 12)} ${pad(session.title, 28)} ${pad(summary, 40)}`)
  }
  return lines.join("\n")
}

export function formatSummary(summary: CockpitSummary): string {
  const status = Object.entries(summary.sessionsByStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join(" ") || "none"
  const workgroups = Object.entries(summary.sessionsByWorkgroup)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join(" ") || "none"
  return [
    `DB: ${summary.dbPath}`,
    `Sessions: ${summary.totalSessions} (${status})`,
    `Workgroups: ${summary.workgroups} (${workgroups})`,
    `Stale: ${summary.staleSessions}`,
  ].join("\n")
}
