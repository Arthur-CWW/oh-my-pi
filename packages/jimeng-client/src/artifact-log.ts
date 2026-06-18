import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { desc, eq, inArray, sql } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export interface JimengArtifactLogOptions {
  dbPath: string
  nowMs?: () => number
}

export interface JimengArtifactRunInput {
  id?: string
  workerId?: string
  functionName: string
  command: string
  commandCwd: string
  status: string
  notes?: string
  proofRoot?: string
  resultJson?: string
  submitId?: string
  historyId?: string
  prompt?: string
  startedAtIso?: string
  finishedAtIso?: string
}

export interface JimengWorkItemInput {
  id: string
  title: string
  status: "blocked" | "done" | "failed" | "in_progress" | "next" | "partial"
  owner?: string
  category?: string
  summary?: string
  nextAction?: string
}

export const JIMENG_PACKET_STATUSES = ["todo", "in_progress", "review", "blocked", "done", "skipped", "unknown"] as const
export type JimengPacketStatus = (typeof JIMENG_PACKET_STATUSES)[number]

export interface JimengPacketInput {
  id: string
  title: string
  family?: string | null
  category?: string | null
  priority?: number
  status?: JimengPacketStatus
  owner?: string | null
  currentWorker?: string | null
  reviewer?: string | null
  blocker?: string | null
  unblockCondition?: string | null
  nextCommand?: string | null
  proofArtifact?: string | null
  validationCommand?: string | null
  commitHash?: string | null
  summary?: string | null
}

export interface JimengPacketRecord {
  id: string
  title: string
  family: string | null
  category: string | null
  priority: number
  status: JimengPacketStatus
  owner: string | null
  currentWorker: string | null
  reviewer: string | null
  blocker: string | null
  unblockCondition: string | null
  nextCommand: string | null
  proofArtifact: string | null
  validationCommand: string | null
  commitHash: string | null
  summary: string | null
  createdAtMs: number
  updatedAtMs: number
}



export interface JimengArtifactInput {
  id?: string
  runId: string
  kind: string
  path: string
  relativePath: string
  mime: string
  sizeBytes: number | null
  urlRedacted?: string
}

export interface JimengArtifactEventInput {
  runId: string
  level: string
  message: string
}

export interface JimengArtifactRecord {
  id: string
  runId: string
  kind: string
  path: string
  relativePath: string
  mime: string
  sizeBytes: number | null
  urlRedacted: string | null
  createdAtMs: number
}

export interface JimengArtifactRunRecord {
  id: string
  workerId: string | null
  functionName: string
  command: string
  commandCwd: string
  status: string
  notes: string | null
  proofRoot: string | null
  resultJson: string | null
  submitId: string | null
  historyId: string | null
  prompt: string | null
  startedAtIso: string | null
  finishedAtIso: string | null
  createdAtMs: number
  updatedAtMs: number
  artifacts: JimengArtifactRecord[]
}

export interface JimengWorkItemRecord {
  id: string
  title: string
  status: JimengWorkItemInput["status"]
  owner: string | null
  category: string | null
  summary: string | null
  nextAction: string | null
  updatedAtMs: number
}

export interface JimengArtifactLogSnapshot {
  generatedAtMs: number
  packets: JimengPacketRecord[]
  workItems: JimengWorkItemRecord[]
  runs: JimengArtifactRunRecord[]
}

export interface JimengProofIngestOptions {
  dbPath: string
  proofRoot: string
  workerId?: string
  command?: string
  commandCwd?: string
  notes?: string
  nowMs?: () => number
}

type JsonRecord = Record<string, JsonValue>
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const jimengArtifactRuns = sqliteTable("jimeng_artifact_runs", {
  id: text("id").primaryKey(),
  workerId: text("worker_id"),
  functionName: text("function_name").notNull(),
  command: text("command").notNull(),
  commandCwd: text("command_cwd").notNull(),
  status: text("status").notNull(),
  notes: text("notes"),
  proofRoot: text("proof_root"),
  resultJson: text("result_json"),
  submitId: text("submit_id"),
  historyId: text("history_id"),
  prompt: text("prompt"),
  startedAtIso: text("started_at_iso"),
  finishedAtIso: text("finished_at_iso"),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
})

export const jimengArtifacts = sqliteTable("jimeng_artifacts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => jimengArtifactRuns.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  path: text("path").notNull(),
  relativePath: text("relative_path").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes"),
  urlRedacted: text("url_redacted"),
  createdAtMs: integer("created_at_ms").notNull(),
})

export const jimengArtifactEvents = sqliteTable("jimeng_artifact_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  tsMs: integer("ts_ms").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
})

export const jimengWorkItems = sqliteTable("jimeng_work_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  owner: text("owner"),
  category: text("category"),
  summary: text("summary"),
  nextAction: text("next_action"),
  updatedAtMs: integer("updated_at_ms").notNull(),
})

export const jimengPackets = sqliteTable("jimeng_packets", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  family: text("family"),
  category: text("category"),
  priority: integer("priority").notNull().default(100),
  status: text("status").notNull(),
  owner: text("owner"),
  currentWorker: text("current_worker"),
  reviewer: text("reviewer"),
  blocker: text("blocker"),
  unblockCondition: text("unblock_condition"),
  nextCommand: text("next_command"),
  proofArtifact: text("proof_artifact"),
  validationCommand: text("validation_command"),
  commitHash: text("commit_hash"),
  summary: text("summary"),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
})

type ArtifactLogDatabase = BunSQLiteDatabase

const NEXT_PACKET_STATUSES = ["todo", "review", "unknown"] as const

function excludedColumn(column: string) {
  return sql.raw(`excluded.${column}`)
}

export class JimengArtifactLog {
  private readonly sqlite: Database
  private readonly db: ArtifactLogDatabase
  private readonly nowMs: () => number

  constructor(options: JimengArtifactLogOptions) {
    mkdirSync(path.dirname(path.resolve(options.dbPath)), { recursive: true })
    this.sqlite = new Database(options.dbPath)
    this.db = drizzle(this.sqlite)
    this.nowMs = options.nowMs ?? Date.now
    this.initialize()
  }

  upsertRun(input: JimengArtifactRunInput): string {
    const now = this.nowMs()
    const id = input.id ?? randomUUID()
    this.db.insert(jimengArtifactRuns).values({
      id,
      workerId: input.workerId ?? null,
      functionName: input.functionName,
      command: input.command,
      commandCwd: input.commandCwd,
      status: input.status,
      notes: input.notes ?? null,
      proofRoot: input.proofRoot ?? null,
      resultJson: input.resultJson ?? null,
      submitId: input.submitId ?? null,
      historyId: input.historyId ?? null,
      prompt: input.prompt ?? null,
      startedAtIso: input.startedAtIso ?? null,
      finishedAtIso: input.finishedAtIso ?? null,
      createdAtMs: now,
      updatedAtMs: now,
    }).onConflictDoUpdate({
      target: jimengArtifactRuns.id,
      set: {
        workerId: excludedColumn("worker_id"),
        functionName: excludedColumn("function_name"),
        command: excludedColumn("command"),
        commandCwd: excludedColumn("command_cwd"),
        status: excludedColumn("status"),
        notes: excludedColumn("notes"),
        proofRoot: excludedColumn("proof_root"),
        resultJson: excludedColumn("result_json"),
        submitId: excludedColumn("submit_id"),
        historyId: excludedColumn("history_id"),
        prompt: excludedColumn("prompt"),
        startedAtIso: excludedColumn("started_at_iso"),
        finishedAtIso: excludedColumn("finished_at_iso"),
        updatedAtMs: excludedColumn("updated_at_ms"),
      },
    }).run()
    return id
  }

  replaceArtifacts(runId: string, artifacts: JimengArtifactInput[]): void {
    const now = this.nowMs()
    this.db.transaction((tx) => {
      tx.delete(jimengArtifacts).where(eq(jimengArtifacts.runId, runId)).run()
      for (const artifact of artifacts) {
        tx.insert(jimengArtifacts).values({
          id: artifact.id ?? randomUUID(),
          runId,
          kind: artifact.kind,
          path: artifact.path,
          relativePath: artifact.relativePath,
          mime: artifact.mime,
          sizeBytes: artifact.sizeBytes,
          urlRedacted: artifact.urlRedacted ?? null,
          createdAtMs: now,
        }).run()
      }
    })
  }

  addEvent(input: JimengArtifactEventInput): void {
    this.db.insert(jimengArtifactEvents).values({
      runId: input.runId,
      tsMs: this.nowMs(),
      level: input.level,
      message: input.message,
    }).run()
  }

  upsertWorkItem(input: JimengWorkItemInput): void {
    this.db.insert(jimengWorkItems).values({
      id: input.id,
      title: input.title,
      status: input.status,
      owner: input.owner ?? null,
      category: input.category ?? null,
      summary: input.summary ?? null,
      nextAction: input.nextAction ?? null,
      updatedAtMs: this.nowMs(),
    }).onConflictDoUpdate({
      target: jimengWorkItems.id,
      set: {
        title: excludedColumn("title"),
        status: excludedColumn("status"),
        owner: excludedColumn("owner"),
        category: excludedColumn("category"),
        summary: excludedColumn("summary"),
        nextAction: excludedColumn("next_action"),
        updatedAtMs: excludedColumn("updated_at_ms"),
      },
    }).run()
  }

  upsertPacket(input: JimengPacketInput): void {
    const now = this.nowMs()
    this.db.insert(jimengPackets).values({
      id: input.id,
      title: input.title,
      family: input.family ?? null,
      category: input.category ?? null,
      priority: input.priority ?? 100,
      status: normalizePacketStatus(input.status),
      owner: input.owner ?? null,
      currentWorker: input.currentWorker ?? null,
      reviewer: input.reviewer ?? null,
      blocker: input.blocker ?? null,
      unblockCondition: input.unblockCondition ?? null,
      nextCommand: input.nextCommand ?? null,
      proofArtifact: input.proofArtifact ?? null,
      validationCommand: input.validationCommand ?? null,
      commitHash: input.commitHash ?? null,
      summary: input.summary ?? null,
      createdAtMs: now,
      updatedAtMs: now,
    }).onConflictDoUpdate({
      target: jimengPackets.id,
      set: {
        title: excludedColumn("title"),
        family: excludedColumn("family"),
        category: excludedColumn("category"),
        priority: excludedColumn("priority"),
        status: excludedColumn("status"),
        owner: excludedColumn("owner"),
        currentWorker: excludedColumn("current_worker"),
        reviewer: excludedColumn("reviewer"),
        blocker: excludedColumn("blocker"),
        unblockCondition: excludedColumn("unblock_condition"),
        nextCommand: excludedColumn("next_command"),
        proofArtifact: excludedColumn("proof_artifact"),
        validationCommand: excludedColumn("validation_command"),
        commitHash: excludedColumn("commit_hash"),
        summary: excludedColumn("summary"),
        updatedAtMs: excludedColumn("updated_at_ms"),
      },
    }).run()
  }

  nextPacket(): JimengPacketRecord | null {
    const [row] = this.db.select().from(jimengPackets)
      .where(inArray(jimengPackets.status, NEXT_PACKET_STATUSES))
      .orderBy(jimengPackets.priority, packetStatusOrderSql(), jimengPackets.updatedAtMs, jimengPackets.id)
      .limit(1)
      .all()
    return row ? readPacketRow(row) : null
  }

  snapshot(): JimengArtifactLogSnapshot {
    const runs = this.db.select().from(jimengArtifactRuns)
      .orderBy(desc(jimengArtifactRuns.updatedAtMs), desc(jimengArtifactRuns.createdAtMs))
      .all()
    const artifacts = this.db.select().from(jimengArtifacts)
      .orderBy(jimengArtifacts.createdAtMs)
      .all()
    const byRun = new Map<string, JimengArtifactRecord[]>()
    for (const artifact of artifacts) {
      const list = byRun.get(artifact.runId) ?? []
      list.push(readArtifactRow(artifact))
      byRun.set(artifact.runId, list)
    }
    const packets = this.db.select().from(jimengPackets)
      .orderBy(jimengPackets.priority, packetStatusOrderSql(), jimengPackets.updatedAtMs, jimengPackets.id)
      .all()
    const workItems = this.db.select().from(jimengWorkItems)
      .orderBy(jimengWorkItems.category, desc(jimengWorkItems.updatedAtMs))
      .all()
    return {
      generatedAtMs: this.nowMs(),
      packets: packets.map(readPacketRow),
      workItems: workItems.map(readWorkItemRow),
      runs: runs.map((run) => ({ ...readRunRow(run), artifacts: byRun.get(run.id) ?? [] })),
    }
  }

  close(): void {
    this.sqlite.close()
  }

  private initialize(): void {
    this.sqlite.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS jimeng_artifact_runs (
        id TEXT PRIMARY KEY,
        worker_id TEXT,
        function_name TEXT NOT NULL,
        command TEXT NOT NULL,
        command_cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        notes TEXT,
        proof_root TEXT,
        result_json TEXT,
        submit_id TEXT,
        history_id TEXT,
        prompt TEXT,
        started_at_iso TEXT,
        finished_at_iso TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jimeng_artifact_runs_function_idx
        ON jimeng_artifact_runs (function_name, updated_at_ms);
      CREATE TABLE IF NOT EXISTS jimeng_work_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        owner TEXT,
        category TEXT,
        summary TEXT,
        next_action TEXT,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jimeng_work_items_status_idx
        ON jimeng_work_items (status, category);
      CREATE TABLE IF NOT EXISTS jimeng_packets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        family TEXT,
        category TEXT,
        priority INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL,
        owner TEXT,
        current_worker TEXT,
        reviewer TEXT,
        blocker TEXT,
        unblock_condition TEXT,
        next_command TEXT,
        proof_artifact TEXT,
        validation_command TEXT,
        commit_hash TEXT,
        summary TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jimeng_packets_queue_idx
        ON jimeng_packets (priority, status, updated_at_ms);
      CREATE TABLE IF NOT EXISTS jimeng_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES jimeng_artifact_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER,
        url_redacted TEXT,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jimeng_artifacts_run_idx ON jimeng_artifacts (run_id);
      CREATE TABLE IF NOT EXISTS jimeng_artifact_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jimeng_artifact_events_run_idx ON jimeng_artifact_events (run_id, ts_ms);
    `)
  }
}

export const upsertJimengPacketEffect = Effect.fn("upsertJimengPacketEffect")(function* (
  log: JimengArtifactLog,
  input: JimengPacketInput,
) {
  return yield* Effect.try({
    try: () => log.upsertPacket(input),
    catch: artifactLogEffectError,
  })
})

export const nextJimengPacketEffect = Effect.fn("nextJimengPacketEffect")(function* (log: JimengArtifactLog) {
  return yield* Effect.try({
    try: () => log.nextPacket(),
    catch: artifactLogEffectError,
  })
})

export const snapshotJimengArtifactLogEffect = Effect.fn("snapshotJimengArtifactLogEffect")(function* (
  log: JimengArtifactLog,
) {
  return yield* Effect.try({
    try: () => log.snapshot(),
    catch: artifactLogEffectError,
  })
})

export class JimengArtifactLogEffectClient {
  constructor(private readonly log: JimengArtifactLog) {}

  upsertPacket(input: JimengPacketInput) {
    return upsertJimengPacketEffect(this.log, input)
  }

  nextPacket() {
    return nextJimengPacketEffect(this.log)
  }

  snapshot() {
    return snapshotJimengArtifactLogEffect(this.log)
  }
}

function artifactLogEffectError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

type WorkItemRow = typeof jimengWorkItems.$inferSelect
type RunRow = typeof jimengArtifactRuns.$inferSelect
type PacketRow = typeof jimengPackets.$inferSelect
type ArtifactRow = typeof jimengArtifacts.$inferSelect

function readWorkItemRow(row: WorkItemRow): JimengWorkItemRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status as JimengWorkItemRecord["status"],
    owner: row.owner,
    category: row.category,
    summary: row.summary,
    nextAction: row.nextAction,
    updatedAtMs: row.updatedAtMs,
  }
}

function readRunRow(row: RunRow): Omit<JimengArtifactRunRecord, "artifacts"> {
  return {
    id: row.id,
    workerId: row.workerId,
    functionName: row.functionName,
    command: row.command,
    commandCwd: row.commandCwd,
    status: row.status,
    notes: row.notes,
    proofRoot: row.proofRoot,
    resultJson: row.resultJson,
    submitId: row.submitId,
    historyId: row.historyId,
    prompt: row.prompt,
    startedAtIso: row.startedAtIso,
    finishedAtIso: row.finishedAtIso,
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
  }
}

function readPacketRow(row: PacketRow): JimengPacketRecord {
  return {
    id: row.id,
    title: row.title,
    family: row.family,
    category: row.category,
    priority: row.priority,
    status: normalizePacketStatus(row.status),
    owner: row.owner,
    currentWorker: row.currentWorker,
    reviewer: row.reviewer,
    blocker: row.blocker,
    unblockCondition: row.unblockCondition,
    nextCommand: row.nextCommand,
    proofArtifact: row.proofArtifact,
    validationCommand: row.validationCommand,
    commitHash: row.commitHash,
    summary: row.summary,
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
  }
}

function readArtifactRow(row: ArtifactRow): JimengArtifactRecord {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    path: row.path,
    relativePath: row.relativePath,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    urlRedacted: row.urlRedacted,
    createdAtMs: row.createdAtMs,
  }
}

export function ingestJimengProofIntoArtifactLog(options: JimengProofIngestOptions): JimengArtifactLogSnapshot {
  const log = new JimengArtifactLog({ dbPath: options.dbPath, nowMs: options.nowMs })
  try {
    const proofRoot = path.resolve(options.proofRoot)
    const resultFiles = collectResultFiles(proofRoot)
    for (const resultFile of resultFiles) {
      const result = parseJsonObject(readFileSync(resultFile, "utf8"), resultFile)
      const plan = objectValue(result.plan)
      const submit = objectValue(result.submit)
      const command = options.command ?? buildReproCommand(proofRoot, plan)
      const functionName = reportFunctionName(plan)
      const runId = stableRunId(resultFile)
      const submitId = stringValue(submit?.submitId) ?? stringValue(plan?.submit_id)
      const historyId = stringValue(submit?.historyId)
      const prompt = extractPrompt(objectValue(plan?.submit_body))
      log.upsertRun({
        id: runId,
        workerId: options.workerId,
        functionName,
        command,
        commandCwd: options.commandCwd ?? process.cwd(),
        status: String(numberOrStringValue(objectValue(arrayValue(result.pollTrace).at(-1))?.status) ?? "unknown"),
        notes: options.notes,
        proofRoot,
        resultJson: resultFile,
        submitId: submitId ?? undefined,
        historyId: historyId ?? undefined,
        prompt: prompt ?? undefined,
      })
      log.replaceArtifacts(runId, buildArtifactInputs(runId, proofRoot, arrayValue(result.artifacts)))
      log.addEvent({ runId, level: "info", message: `Ingested ${path.relative(proofRoot, resultFile)}` })
    }
    return log.snapshot()
  } finally {
    log.close()
  }
}

function collectResultFiles(proofRoot: string): string[] {
  const normalized = path.join(proofRoot, "normalized")
  if (!existsSync(normalized)) return []
  return collectJsonFiles(normalized).filter((file) => file.endsWith("-result.json")).sort()
}

function collectJsonFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectJsonFiles(file))
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(file)
  }
  return out
}

function stableRunId(file: string): string {
  return createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 24)
}

function reportFunctionName(plan: JsonRecord | null): string {
  const command = stringValue(plan?.command)
  const op = stringValue(plan?.op)
  if (command && op) return `${command} / ${op}`
  return command ?? op ?? "unknown"
}

function buildReproCommand(proofRoot: string, plan: JsonRecord | null): string {
  const command = stringValue(plan?.command) ?? "unknown"
  return `bun packages/jimeng-client/src/dreamina-compatible-cli.ts ${command} --outDir ${shellQuote(path.relative(process.cwd(), proofRoot) || proofRoot)}`
}

function buildArtifactInputs(runId: string, proofRoot: string, artifacts: JsonValue[]): JimengArtifactInput[] {
  return artifacts.flatMap((value) => {
    const artifact = objectValue(value)
    const file = stringValue(artifact?.saved_file)
    if (!file) return []
    const absolute = path.resolve(file)
    const urlRedacted = redactSignedUrl(stringValue(artifact?.url))
    return [{
      id: createHash("sha256").update(`${runId}:${absolute}`).digest("hex").slice(0, 24),
      runId,
      kind: stringValue(artifact?.kind) ?? inferKind(absolute),
      path: absolute,
      relativePath: path.relative(proofRoot, absolute) || path.basename(absolute),
      mime: inferMime(absolute),
      sizeBytes: fileSizeOrNull(absolute),
      ...(urlRedacted ? { urlRedacted } : {}),
    }]
  })
}

function inferKind(file: string): string {
  if (/\.mp4$/i.test(file)) return "video"
  if (/\.(png|jpe?g|webp)$/i.test(file)) return "image"
  if (/\.(mp3|wav|m4a)$/i.test(file)) return "audio"
  return "file"
}

function inferMime(file: string): string {
  if (/\.mp4$/i.test(file)) return "video/mp4"
  if (/\.png$/i.test(file)) return "image/png"
  if (/\.jpe?g$/i.test(file)) return "image/jpeg"
  if (/\.webp$/i.test(file)) return "image/webp"
  if (/\.mp3$/i.test(file)) return "audio/mpeg"
  if (/\.wav$/i.test(file)) return "audio/wav"
  if (/\.m4a$/i.test(file)) return "audio/mp4"
  return "application/octet-stream"
}

function fileSizeOrNull(file: string): number | null {
  try {
    return statSync(file).size
  } catch {
    return null
  }
}

function parseJsonObject(text: string, label: string): JsonRecord {
  const parsed = JSON.parse(text) as JsonValue
  const record = objectValue(parsed)
  if (!record) throw new Error(`${label} is not a JSON object`)
  return record
}

function extractPrompt(body: JsonRecord | null): string | null {
  const draftContent = stringValue(body?.draft_content)
  if (draftContent) {
    const parsed = safeJsonObject(draftContent)
    const prompt = firstStringByKey(parsed, "prompt") ?? firstStringByKey(parsed, "text")
    if (prompt) return prompt
  }
  return firstStringByKey(body, "prompt")
}

function firstStringByKey(value: JsonValue | undefined, key: string): string | null {
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringByKey(item, key)
      if (found) return found
    }
    return null
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && typeof entryValue === "string" && entryValue.trim()) return entryValue
    const found = firstStringByKey(entryValue, key)
    if (found) return found
  }
  return null
}

function safeJsonObject(text: string): JsonRecord | null {
  try {
    return objectValue(JSON.parse(text) as JsonValue)
  } catch {
    return null
  }
}

function objectValue(value: JsonValue | undefined): JsonRecord | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberOrStringValue(value: JsonValue | undefined): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null
}

function normalizePacketStatus(value: string | undefined): JimengPacketStatus {
  if (JIMENG_PACKET_STATUSES.includes(value as JimengPacketStatus)) return value as JimengPacketStatus
  return "unknown"
}

function packetStatusOrderSql() {
  return sql<number>`CASE ${jimengPackets.status} WHEN 'todo' THEN 0 WHEN 'review' THEN 1 WHEN 'unknown' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'blocked' THEN 4 WHEN 'done' THEN 5 WHEN 'skipped' THEN 6 ELSE 7 END`
}

function redactSignedUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    parsed.search = ""
    return parsed.toString()
  } catch {
    return "[unparseable-url]"
  }
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}
