import type { Database as BunDatabase } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import type { JsonValue } from "../renderer/ugcStudioModel"
import type { UgcLocalState } from "../ugc/local-state"

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
    return !existsSync(this.config.sqlitePath)
  }

  writeState(state: UgcLocalState): void {
    mkdirSync(this.config.workspaceDir, { recursive: true })
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

  readState(): UgcLocalState | null {
    if (!existsSync(this.config.sqlitePath)) return null
    const db = this.openReadonly()
    try {
      const row = db.query<WorkspaceStateRow, []>("SELECT payload_json FROM workspace_state LIMIT 1").get()
      return row ? JSON.parse(row.payload_json) as UgcLocalState : null
    } finally {
      db.close()
    }
  }

  readObjects(collection: UgcSqliteCollection): readonly JsonValue[] {
    if (!existsSync(this.config.sqlitePath)) return []
    const db = this.openReadonly()
    try {
      const rows = db.query<ObjectRow, [string]>(`
        SELECT payload_json
        FROM objects
        WHERE collection = ?
        ORDER BY id ASC
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
  ]
}

function objectUpdatedAt(payload: object, fallback: string): string {
  const candidate = payload as { readonly updatedAt?: string }
  return candidate.updatedAt ?? fallback
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
}

function loadDatabase(): typeof import("bun:sqlite").Database {
  return import.meta.require("bun:sqlite").Database as typeof import("bun:sqlite").Database
}
