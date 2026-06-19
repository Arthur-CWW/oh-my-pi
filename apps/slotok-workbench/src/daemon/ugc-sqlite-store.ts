import type { Database as BunDatabase } from "bun:sqlite"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import type { JsonValue } from "../renderer/ugcStudioModel"
import {
  createInitialResearchTargets,
  createInitialTemplateMiningJobs,
  isLocalState,
  referenceProfileToArchive,
  type UgcLocalState,
  type UgcResearchTarget,
  type UgcTemplateMiningJob,
} from "../ugc/local-state"

export type UgcSqliteCollection =
  | "workspace"
  | "personas"
  | "campaigns"
  | "branches"
  | "candidates"
  | "notes"
  | "provider-jobs"
  | "reference-archives"
  | "exports"
  | "research-targets"
  | "template-mining-jobs"
  | "workflow-runs"
  | "workflow-events"

export interface UgcSqliteStoreOptions {
  readonly workspaceDir: string
  readonly sqlitePath?: string
}

export interface UgcSqliteStoreConfig {
  readonly workspaceDir: string
  readonly sqlitePath: string
}

interface ObjectRow {
  readonly payload_json: string
}

interface CountRow {
  readonly collection: string
  readonly count: number
}

interface WorkspaceStateRow {
  readonly payload_json: string
}

interface CollectionRecord {
  readonly collection: UgcSqliteCollection
  readonly id: string
  readonly payload: object
}

export class UgcSqliteStore {
  readonly config: UgcSqliteStoreConfig

  constructor(options: UgcSqliteStoreOptions) {
    const workspaceDir = resolve(options.workspaceDir)
    this.config = {
      workspaceDir,
      sqlitePath: resolve(options.sqlitePath ?? resolve(workspaceDir, "workspace.sqlite")),
    }
  }

  needsInitialImport(): boolean {
    return this.readValidState() === null
  }

  writeState(state: UgcLocalState): void {
    mkdirSync(this.config.workspaceDir, { recursive: true })
    try {
      this.writeStateToDatabase(state)
    } catch (error) {
      if (!(error instanceof Error) || !isRecoverableDatabaseFileError(error)) throw error
      this.removeDatabaseFiles()
      this.writeStateToDatabase(state)
    }
  }

  readState(): UgcLocalState | null {
    return this.readValidState()
  }

  readValidState(): UgcLocalState | null {
    if (!existsSync(this.config.sqlitePath)) return null
    try {
      const db = this.openReadonly()
      try {
        const row = db.query<WorkspaceStateRow, []>("SELECT payload_json FROM workspace_state LIMIT 1").get()
        if (!row) return null
        const payload = JSON.parse(row.payload_json) as JsonValue
        return isLocalState(payload) ? normalizeLocalState(payload) : null
      } finally {
        db.close()
      }
    } catch {
      return null
    }
  }

  private writeStateToDatabase(state: UgcLocalState): void {
    const db = this.openWritable()
    try {
      initializeSchema(db)
      db.exec("BEGIN IMMEDIATE")
      try {
        db.query(`
          INSERT INTO workspace_state (workspace_id, schema_version, payload_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            schema_version = excluded.schema_version,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `).run(state.workspace.id, state.schemaVersion, JSON.stringify(state), state.updatedAt)

        db.query("DELETE FROM objects").run()
        const insert = db.query(`
          INSERT INTO objects (collection, id, workspace_id, payload_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        for (const record of stateObjectRecords(state)) {
          insert.run(
            record.collection,
            record.id,
            state.workspace.id,
            JSON.stringify(record.payload),
            objectUpdatedAt(record.payload, state.updatedAt),
          )
        }
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    } finally {
      db.close()
    }
  }

  private removeDatabaseFiles(): void {
    rmSync(this.config.sqlitePath, { force: true })
    rmSync(`${this.config.sqlitePath}-shm`, { force: true })
    rmSync(`${this.config.sqlitePath}-wal`, { force: true })
  }


  readObjects(collection: UgcSqliteCollection): readonly JsonValue[] {
    if (!existsSync(this.config.sqlitePath)) return []
    const db = this.openReadonly()
    try {
      const rows = db.query<ObjectRow, [string]>(`
        SELECT payload_json
        FROM objects
        WHERE collection = ?
        ORDER BY
          CASE WHEN collection = 'workflow-events' THEN CAST(id AS INTEGER) END ASC,
          id ASC
      `).all(collection)
      return rows.map((row) => JSON.parse(row.payload_json) as JsonValue)
    } finally {
      db.close()
    }
  }

  countObjectsByCollection(): Readonly<Record<UgcSqliteCollection, number>> {
    const counts: Record<UgcSqliteCollection, number> = {
      workspace: 0,
      personas: 0,
      campaigns: 0,
      branches: 0,
      candidates: 0,
      notes: 0,
      "provider-jobs": 0,
      "reference-archives": 0,
      exports: 0,
      "research-targets": 0,
      "template-mining-jobs": 0,
      "workflow-runs": 0,
      "workflow-events": 0,
    }
    if (!existsSync(this.config.sqlitePath)) return counts
    const db = this.openReadonly()
    try {
      const rows = db.query<CountRow, []>(`
        SELECT collection, count(*) AS count
        FROM objects
        GROUP BY collection
      `).all()
      for (const row of rows) {
        if (isUgcSqliteCollection(row.collection)) counts[row.collection] = Number(row.count)
      }
      return counts
    } finally {
      db.close()
    }
  }

  private openWritable(): BunDatabase {
    const db = new (loadDatabase())(this.config.sqlitePath)
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA foreign_keys = ON")
    return db
  }

  private openReadonly(): BunDatabase {
    const db = new (loadDatabase())(this.config.sqlitePath, { readonly: true })
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA query_only = ON")
    return db
  }
}

function initializeSchema(db: BunDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspace_state (
      workspace_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS objects (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS objects_workspace_collection_idx ON objects (workspace_id, collection);
  `)
}

function stateObjectRecords(state: UgcLocalState): readonly CollectionRecord[] {
  return [
    { collection: "workspace", id: state.workspace.id, payload: state.workspace },
    { collection: "campaigns", id: state.workspace.productBrief.id, payload: state.workspace.productBrief },
    ...state.workspace.personas.map((payload) => ({ collection: "personas" as const, id: payload.id, payload })),
    ...state.workspace.branchSnapshots.map((payload) => ({ collection: "branches" as const, id: payload.id, payload })),
    ...state.workspace.candidates.map((payload) => ({ collection: "candidates" as const, id: payload.id, payload })),
    ...state.workspace.reviewNotes.map((payload) => ({ collection: "notes" as const, id: payload.id, payload })),
    ...state.providerJobs.map((payload) => ({ collection: "provider-jobs" as const, id: payload.id, payload })),
    ...state.referenceArchives.map((payload) => ({ collection: "reference-archives" as const, id: payload.id, payload })),
    ...state.exportManifests.map((payload) => ({ collection: "exports" as const, id: payload.id, payload })),
    ...state.researchTargets.map((payload) => ({ collection: "research-targets" as const, id: payload.id, payload })),
    ...state.templateMiningJobs.map((payload) => ({ collection: "template-mining-jobs" as const, id: payload.id, payload })),
    ...state.workflowRuns.map((payload) => ({ collection: "workflow-runs" as const, id: payload.id, payload })),
    ...state.workflowEvents.map((payload) => ({ collection: "workflow-events" as const, id: String(payload.eventId), payload })),
  ]
}

function objectUpdatedAt(payload: object, fallback: string): string {
  const candidate = payload as { readonly updatedAt?: string; readonly createdAt?: string }
  return candidate.updatedAt ?? candidate.createdAt ?? fallback
}

function normalizeLocalState(state: UgcLocalState): UgcLocalState {
  const legacyState = state as {
    readonly researchTargets?: readonly UgcResearchTarget[]
    readonly templateMiningJobs?: readonly UgcTemplateMiningJob[]
    readonly workflowRuns?: UgcLocalState["workflowRuns"]
    readonly workflowEvents?: UgcLocalState["workflowEvents"]
  }
  const referenceArchives = state.workspace.referenceProfiles.map((referenceProfile) => {
    const defaultArchive = referenceProfileToArchive(state.workspace.id, referenceProfile, state.updatedAt)
    const existing = state.referenceArchives.find((archive) => archive.referenceProfileId === referenceProfile.id)
    return existing
      ? {
          ...defaultArchive,
          ...existing,
          sampleClipIds: existing.sampleClipIds ?? defaultArchive.sampleClipIds,
          candidateFormatOutputs: existing.candidateFormatOutputs ?? defaultArchive.candidateFormatOutputs,
          notes: existing.notes ?? defaultArchive.notes,
        }
      : defaultArchive
  })
  const orphanArchives = state.referenceArchives.filter((archive) => (
    !state.workspace.referenceProfiles.some((referenceProfile) => referenceProfile.id === archive.referenceProfileId)
  ))
  return {
    ...state,
    referenceArchives: [...referenceArchives, ...orphanArchives],
    researchTargets: legacyState.researchTargets ?? createInitialResearchTargets(state.workspace.id, state.updatedAt),
    templateMiningJobs: legacyState.templateMiningJobs ?? createInitialTemplateMiningJobs(state.workspace.id, state.updatedAt),
    workflowRuns: legacyState.workflowRuns ?? [],
    workflowEvents: [...(legacyState.workflowEvents ?? [])].sort((left, right) => left.eventId - right.eventId),
  }
}

function isRecoverableDatabaseFileError(error: Error): boolean {
  return error.message.includes("not a database")
    || error.message.includes("database disk image is malformed")
    || error.message.includes("file is not a database")
}

function isUgcSqliteCollection(value: string): value is UgcSqliteCollection {
  return value === "workspace"
    || value === "personas"
    || value === "campaigns"
    || value === "branches"
    || value === "candidates"
    || value === "notes"
    || value === "provider-jobs"
    || value === "reference-archives"
    || value === "exports"
    || value === "research-targets"
    || value === "template-mining-jobs"
    || value === "workflow-runs"
    || value === "workflow-events"
}

function loadDatabase(): typeof import("bun:sqlite").Database {
  return import.meta.require("bun:sqlite").Database as typeof import("bun:sqlite").Database
}
