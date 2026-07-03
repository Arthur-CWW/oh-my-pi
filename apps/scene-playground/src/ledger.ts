import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type EditActor = "human" | "agent";

export interface RecordEditInput {
  path: string;
  actor: EditActor;
  agentHint?: string | null;
  content: string | Uint8Array;
}

export interface EditRecord {
  id: number;
  path: string;
  actor: EditActor;
  agentHint: string | null;
  ts: string;
  contentHash: string;
  prevHash: string | null;
  bytes: number;
  deltaBytes: number | null;
}

export interface EditStats {
  humanEdits: number;
  agentEdits: number;
  lastActor: EditActor | null;
  lastTs: string | null;
}

interface EditRow {
  id: number;
  path: string;
  actor: string;
  agent_hint: string | null;
  ts: string;
  content_hash: string;
  prev_hash: string | null;
  bytes: number;
  delta_bytes: number | null;
}

interface EditCountRow {
  human_edits: number | null;
  agent_edits: number | null;
}

export interface Ledger {
  recordEdit(input: RecordEditInput): EditRecord;
  latestForPath(path: string): EditRecord | null;
  statsForPath(path: string): EditStats;
  listRecent(limit: number): EditRecord[];
  close(): void;
}

export function openLedger(dbPath: string): Ledger {
  return new SqliteLedger(dbPath);
}

class SqliteLedger implements Ledger {
  private readonly db: Database;

  constructor(dbPath: string) {
    const resolved = dbPath === ":memory:" ? dbPath : resolve(dbPath);
    if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS edits (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        actor TEXT NOT NULL CHECK(actor IN ('human','agent')),
        agent_hint TEXT NULL,
        ts TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        prev_hash TEXT NULL,
        bytes INTEGER NOT NULL,
        delta_bytes INTEGER NULL
      );
      CREATE INDEX IF NOT EXISTS edits_path_id_idx ON edits(path, id DESC);
      CREATE INDEX IF NOT EXISTS edits_ts_id_idx ON edits(ts DESC, id DESC);
    `);
  }

  recordEdit(input: RecordEditInput): EditRecord {
    const previous = this.latestForPath(input.path);
    const bytes = typeof input.content === "string" ? Buffer.byteLength(input.content, "utf8") : input.content.byteLength;
    const contentHash = createHash("sha256").update(input.content).digest("hex");
    const ts = new Date().toISOString();
    const deltaBytes = previous === null ? null : bytes - previous.bytes;
    const row = this.db
      .query<EditRow, [string, EditActor, string | null, string, string, string | null, number, number | null]>(`
        INSERT INTO edits (path, actor, agent_hint, ts, content_hash, prev_hash, bytes, delta_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, path, actor, agent_hint, ts, content_hash, prev_hash, bytes, delta_bytes
      `)
      .get(input.path, input.actor, input.agentHint ?? null, ts, contentHash, previous?.contentHash ?? null, bytes, deltaBytes);
    if (row === null || row === undefined) throw new Error("Inserted ledger row could not be read back");
    return mapEditRow(row);
  }

  latestForPath(path: string): EditRecord | null {
    const row = this.db
      .query<EditRow, [string]>(`
        SELECT id, path, actor, agent_hint, ts, content_hash, prev_hash, bytes, delta_bytes
        FROM edits
        WHERE path = ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(path);
    return row === null || row === undefined ? null : mapEditRow(row);
  }

  statsForPath(path: string): EditStats {
    const counts = this.db
      .query<EditCountRow, [string]>(`
        SELECT
          COALESCE(SUM(CASE WHEN actor = 'human' THEN 1 ELSE 0 END), 0) AS human_edits,
          COALESCE(SUM(CASE WHEN actor = 'agent' THEN 1 ELSE 0 END), 0) AS agent_edits
        FROM edits
        WHERE path = ?
      `)
      .get(path);
    const latest = this.latestForPath(path);
    return {
      humanEdits: Number(counts?.human_edits ?? 0),
      agentEdits: Number(counts?.agent_edits ?? 0),
      lastActor: latest?.actor ?? null,
      lastTs: latest?.ts ?? null,
    };
  }

  listRecent(limit: number): EditRecord[] {
    const safeLimit = normalizeLimit(limit);
    return this.db
      .query<EditRow, [number]>(`
        SELECT id, path, actor, agent_hint, ts, content_hash, prev_hash, bytes, delta_bytes
        FROM edits
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map((row) => mapEditRow(row));
  }

  close(): void {
    this.db.close();
  }

}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  const integer = Math.trunc(limit);
  if (integer < 1) return 1;
  if (integer > 500) return 500;
  return integer;
}

function mapEditRow(row: EditRow): EditRecord {
  return {
    id: Number(row.id),
    path: row.path,
    actor: decodeActor(row.actor),
    agentHint: row.agent_hint,
    ts: row.ts,
    contentHash: row.content_hash,
    prevHash: row.prev_hash,
    bytes: Number(row.bytes),
    deltaBytes: row.delta_bytes === null ? null : Number(row.delta_bytes),
  };
}

function decodeActor(value: string): EditActor {
  if (value === "human" || value === "agent") return value;
  throw new Error(`Invalid ledger actor ${value}`);
}
