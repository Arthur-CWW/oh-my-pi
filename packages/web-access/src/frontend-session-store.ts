import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { FrontendBrowserError } from "./schemas"

export type FrontendProvider = "aistudio" | "deepseek" | "chatgpt" | "grok" | "jimeng"

export interface FrontendProjectRecord {
  createdAt: number
  key: string
  provider: FrontendProvider
  title: string
  updatedAt: number
  url: string
}

export interface FrontendSessionRecord {
  conversationUrl: string | null
  blockerReason: string | null
  createdAt: number
  id: string
  outputPath: string | null
  projectKey: string | null
  projectUrl: string | null
  prompt: string
  provider: FrontendProvider
  responseText: string
  title: string | null
  recoveryStep: string | null
  updatedAt: number
}

interface StoredProjectRow {
  created_at: number
  key: string
  provider: FrontendProvider
  title: string
  updated_at: number
  url: string
}

interface StoredSessionRow {
  conversation_url: string | null
  blocker_reason: string | null
  created_at: number
  id: string
  output_path: string | null
  project_key: string | null
  project_url: string | null
  prompt: string
  provider: FrontendProvider
  response_text: string
  recovery_step: string | null
  title: string | null
  updated_at: number
}

interface TableInfoRow {
  name: string
}

export function frontendSessionDbPath(): string {
  return join(homedir(), ".pi", "pi-web-access", "frontend-browser.sqlite")
}

function sqliteValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL"
  return `'${value.replaceAll("'", "''")}'`
}

async function runSql(script: string): Promise<string> {
  const dbPath = frontendSessionDbPath()
  await mkdir(join(homedir(), ".pi", "pi-web-access"), { recursive: true })

  return await new Promise((resolve, reject) => {
    const child = execFile("sqlite3", [dbPath], (err, stdout, stderr) => {
      if (err) {
        reject(new FrontendBrowserError({ reason: stderr.trim() || String(err) }))
        return
      }
      resolve(stdout)
    })
    child.stdin?.end(script)
  })
}

async function initDb(): Promise<void> {
  await runSql(`
CREATE TABLE IF NOT EXISTS frontend_projects (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS frontend_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  project_key TEXT,
  project_url TEXT,
  conversation_url TEXT,
  output_path TEXT,
  blocker_reason TEXT,
  title TEXT,
  prompt TEXT NOT NULL,
  response_text TEXT NOT NULL DEFAULT '',
  recovery_step TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_frontend_sessions_provider_updated
  ON frontend_sessions(provider, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_frontend_sessions_project_updated
  ON frontend_sessions(project_key, updated_at DESC);
`)

  const columnsJson = await runSql(`.mode json
PRAGMA table_info(frontend_sessions);
`)
  const columns = JSON.parse(columnsJson.trim() || "[]") as TableInfoRow[]
  for (const [name, alterSql] of [
    ["output_path", "ALTER TABLE frontend_sessions ADD COLUMN output_path TEXT;"],
    ["blocker_reason", "ALTER TABLE frontend_sessions ADD COLUMN blocker_reason TEXT;"],
    ["recovery_step", "ALTER TABLE frontend_sessions ADD COLUMN recovery_step TEXT;"],
  ] as const) {
    if (!columns.some((column) => column.name === name)) {
      await runSql(alterSql)
    }
  }
}

function projectFromRow(row: StoredProjectRow): FrontendProjectRecord {
  return {
    createdAt: row.created_at,
    key: row.key,
    provider: row.provider,
    title: row.title,
    updatedAt: row.updated_at,
    url: row.url,
  }
}

function sessionFromRow(row: StoredSessionRow): FrontendSessionRecord {
  return {
    conversationUrl: row.conversation_url,
    blockerReason: row.blocker_reason,
    createdAt: row.created_at,
    id: row.id,
    outputPath: row.output_path,
    projectKey: row.project_key,
    projectUrl: row.project_url,
    prompt: row.prompt,
    provider: row.provider,
    responseText: row.response_text,
    recoveryStep: row.recovery_step,
    title: row.title,
    updatedAt: row.updated_at,
  }
}

async function queryJson<T>(selectSql: string): Promise<T[]> {
  await initDb()
  const out = await runSql(`.mode json
${selectSql}
`)
  const trimmed = out.trim()
  if (!trimmed) return []
  return JSON.parse(trimmed) as T[]
}

export function normalizeProjectKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export async function saveFrontendProject(input: {
  key: string
  provider: FrontendProvider
  title?: string
  url: string
}): Promise<FrontendProjectRecord> {
  await initDb()
  const key = normalizeProjectKey(input.key)
  if (!key) throw new FrontendBrowserError({ reason: "Project key is empty." })
  const now = Date.now()
  const title = input.title?.trim() || key
  await runSql(`
INSERT INTO frontend_projects (key, provider, title, url, created_at, updated_at)
VALUES (${sqliteValue(key)}, ${sqliteValue(input.provider)}, ${sqliteValue(title)}, ${sqliteValue(input.url)}, ${now}, ${now})
ON CONFLICT(key) DO UPDATE SET
  provider = excluded.provider,
  title = excluded.title,
  url = excluded.url,
  updated_at = excluded.updated_at;
`)
  return {
    createdAt: now,
    key,
    provider: input.provider,
    title,
    updatedAt: now,
    url: input.url,
  }
}

export async function listFrontendProjects(provider?: FrontendProvider): Promise<FrontendProjectRecord[]> {
  const where = provider ? `WHERE provider = ${sqliteValue(provider)}` : ""
  const rows = await queryJson<StoredProjectRow>(`
SELECT key, provider, title, url, created_at, updated_at
FROM frontend_projects
${where}
ORDER BY updated_at DESC;
`)
  return rows.map(projectFromRow)
}

export async function resolveFrontendProject(
  provider: FrontendProvider,
  project?: string,
): Promise<FrontendProjectRecord | null> {
  const raw = project?.trim()
  if (!raw) return null
  if (looksLikeUrl(raw)) {
    const key = normalizeProjectKey(new URL(raw).pathname.split("/").filter(Boolean).pop() ?? "project")
    return { createdAt: Date.now(), key, provider, title: key, updatedAt: Date.now(), url: raw }
  }

  const key = normalizeProjectKey(raw)
  const rows = await queryJson<StoredProjectRow>(`
SELECT key, provider, title, url, created_at, updated_at
FROM frontend_projects
WHERE key = ${sqliteValue(key)} AND provider = ${sqliteValue(provider)}
LIMIT 1;
`)
  return rows[0] ? projectFromRow(rows[0]) : null
}

export async function saveFrontendSession(input: {
  conversationUrl?: string | null
  blockerReason?: string | null
  id?: string
  outputPath?: string | null
  projectKey?: string | null
  projectUrl?: string | null
  prompt: string
  provider: FrontendProvider
  recoveryStep?: string | null
  responseText?: string
  title?: string | null
}): Promise<FrontendSessionRecord> {
  await initDb()
  const id = input.id?.trim() || randomUUID()
  const now = Date.now()
  await runSql(`
INSERT INTO frontend_sessions (
  id, provider, project_key, project_url, conversation_url, output_path, blocker_reason, title, prompt, response_text, recovery_step, created_at, updated_at
) VALUES (
  ${sqliteValue(id)},
  ${sqliteValue(input.provider)},
  ${sqliteValue(input.projectKey ?? null)},
  ${sqliteValue(input.projectUrl ?? null)},
  ${sqliteValue(input.conversationUrl ?? null)},
  ${sqliteValue(input.outputPath ?? null)},
  ${sqliteValue(input.blockerReason ?? null)},
  ${sqliteValue(input.title ?? null)},
  ${sqliteValue(input.prompt)},
  ${sqliteValue(input.responseText ?? "")},
  ${sqliteValue(input.recoveryStep ?? null)},
  ${now},
  ${now}
)
ON CONFLICT(id) DO UPDATE SET
  provider = excluded.provider,
  project_key = excluded.project_key,
  project_url = excluded.project_url,
  conversation_url = excluded.conversation_url,
  output_path = excluded.output_path,
  blocker_reason = excluded.blocker_reason,
  title = excluded.title,
  prompt = excluded.prompt,
  response_text = excluded.response_text,
  recovery_step = excluded.recovery_step,
  updated_at = excluded.updated_at;
`)
  return {
    conversationUrl: input.conversationUrl ?? null,
    blockerReason: input.blockerReason ?? null,
    createdAt: now,
    id,
    outputPath: input.outputPath ?? null,
    projectKey: input.projectKey ?? null,
    projectUrl: input.projectUrl ?? null,
    prompt: input.prompt,
    provider: input.provider,
    responseText: input.responseText ?? "",
    recoveryStep: input.recoveryStep ?? null,
    title: input.title ?? null,
    updatedAt: now,
  }
}

export async function listFrontendSessions(options: {
  limit?: number
  project?: string
  provider?: FrontendProvider
} = {}): Promise<FrontendSessionRecord[]> {
  const clauses: string[] = []
  if (options.provider) clauses.push(`provider = ${sqliteValue(options.provider)}`)
  if (options.project) clauses.push(`project_key = ${sqliteValue(normalizeProjectKey(options.project))}`)
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
  const rows = await queryJson<StoredSessionRow>(`
SELECT id, provider, project_key, project_url, conversation_url, output_path, blocker_reason, title, prompt, response_text, recovery_step, created_at, updated_at
FROM frontend_sessions
${where}
ORDER BY updated_at DESC
LIMIT ${limit};
`)
  return rows.map(sessionFromRow)
}

export async function resolveFrontendSession(ref: string, options: {
  project?: string
  provider?: FrontendProvider
} = {}): Promise<FrontendSessionRecord | null> {
  const raw = ref.trim()
  if (!raw) return null
  if (raw === "latest") {
    const [latest] = await listFrontendSessions({ limit: 1, project: options.project, provider: options.provider })
    return latest ?? null
  }

  const rows = await queryJson<StoredSessionRow>(`
SELECT id, provider, project_key, project_url, conversation_url, output_path, blocker_reason, title, prompt, response_text, recovery_step, created_at, updated_at
FROM frontend_sessions
WHERE id LIKE ${sqliteValue(`${raw}%`)}
ORDER BY updated_at DESC
LIMIT 1;
`)
  return rows[0] ? sessionFromRow(rows[0]) : null
}
