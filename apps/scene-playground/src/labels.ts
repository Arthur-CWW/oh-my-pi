// ---------------------------------------------------------------------------
// Labels store — bun:sqlite backed, human-provenance labeling
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface LabelRow {
  id: number;
  media_path: string;
  grp: string;
  ts: string;
}

export interface GroupRow {
  name: string;
  key: string | null;
  ord: number;
}

export interface GroupWithCount extends GroupRow {
  count: number;
}

export interface NoteRow {
  id: number;
  item_key: string;
  body: string;
  ts: string;
}

export interface LabelsStore {
  assign(mediaPath: string, group: string): LabelRow;
  unassign(mediaPath: string, group: string): boolean;
  listByMedia(mediaPath: string): LabelRow[];
  listByGroup(group: string): LabelRow[];
  allLabels(): LabelRow[];
  groupsWithCounts(): GroupWithCount[];
  ensureGroup(name: string, key?: string | null): GroupRow;
  listGroups(): GroupRow[];
  getNote(itemKey: string): NoteRow | null;
  setNote(itemKey: string, body: string): NoteRow | null;
  allNotes(): NoteRow[];
  close(): void;
}

interface CountRow {
  name: string;
  key: string | null;
  ord: number;
  count: number;
}

export function openLabels(dbPath: string): LabelsStore {
  return new SqliteLabels(dbPath);
}

class SqliteLabels implements LabelsStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    const resolved = dbPath === ":memory:" ? dbPath : resolve(dbPath);
    if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        name TEXT PRIMARY KEY,
        key TEXT NULL,
        ord INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS labels (
        id INTEGER PRIMARY KEY,
        media_path TEXT NOT NULL,
        grp TEXT NOT NULL,
        ts TEXT NOT NULL,
        UNIQUE(media_path, grp)
      );
      CREATE INDEX IF NOT EXISTS labels_media_idx ON labels(media_path);
      CREATE INDEX IF NOT EXISTS labels_grp_idx ON labels(grp);
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        item_key TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL,
        ts TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_item_idx ON notes(item_key);
    `);
  }

  assign(mediaPath: string, group: string): LabelRow {
    // Ensure group exists
    this.ensureGroup(group);
    const row = this.db
      .query<LabelRow, [string, string, string]>(
        `INSERT INTO labels (media_path, grp, ts) VALUES (?, ?, ?)
         ON CONFLICT(media_path, grp) DO UPDATE SET ts = excluded.ts
         RETURNING id, media_path, grp, ts`,
      )
      .get(mediaPath, group, new Date().toISOString());
    if (row === null || row === undefined) throw new Error("Label insert failed");
    return row;
  }

  unassign(mediaPath: string, group: string): boolean {
    const result = this.db.run(
      "DELETE FROM labels WHERE media_path = ? AND grp = ?",
      [mediaPath, group],
    );
    return result.changes > 0;
  }

  listByMedia(mediaPath: string): LabelRow[] {
    return this.db
      .query<LabelRow, [string]>("SELECT id, media_path, grp, ts FROM labels WHERE media_path = ? ORDER BY ts")
      .all(mediaPath);
  }

  listByGroup(group: string): LabelRow[] {
    return this.db
      .query<LabelRow, [string]>("SELECT id, media_path, grp, ts FROM labels WHERE grp = ? ORDER BY ts")
      .all(group);
  }

  allLabels(): LabelRow[] {
    return this.db
      .query<LabelRow, []>("SELECT id, media_path, grp, ts FROM labels ORDER BY ts DESC")
      .all();
  }

  groupsWithCounts(): GroupWithCount[] {
    return this.db
      .query<CountRow, []>(`
        SELECT g.name, g.key, g.ord, COALESCE(c.cnt, 0) AS count
        FROM groups g
        LEFT JOIN (SELECT grp, COUNT(*) AS cnt FROM labels GROUP BY grp) c ON c.grp = g.name
        ORDER BY g.ord, g.name
      `)
      .all();
  }

  ensureGroup(name: string, key?: string | null): GroupRow {
    const existing = this.db
      .query<GroupRow, [string]>("SELECT name, key, ord FROM groups WHERE name = ?")
      .get(name);
    if (existing !== null && existing !== undefined) {
      if (key !== undefined) {
        this.db.run("UPDATE groups SET key = ? WHERE name = ?", [key ?? null, name]);
        return { name, key: key ?? null, ord: existing.ord };
      }
      return existing;
    }
    // Auto-assign next digit key 1-9 if not specified
    const maxOrd = this.db
      .query<{ m: number | null }, []>("SELECT MAX(ord) as m FROM groups")
      .get()?.m ?? -1;
    const ord = (maxOrd ?? -1) + 1;
    const autoKey = key !== undefined ? (key ?? null) : (ord < 9 ? String(ord + 1) : null);
    this.db.run(
      "INSERT INTO groups (name, key, ord) VALUES (?, ?, ?)",
      [name, autoKey, ord],
    );
    return { name, key: autoKey, ord };
  }

  listGroups(): GroupRow[] {
    return this.db
      .query<GroupRow, []>("SELECT name, key, ord FROM groups ORDER BY ord, name")
      .all();
  }

  getNote(itemKey: string): NoteRow | null {
    const row = this.db
      .query<NoteRow, [string]>("SELECT id, item_key, body, ts FROM notes WHERE item_key = ?")
      .get(itemKey);
    return row ?? null;
  }

  setNote(itemKey: string, body: string): NoteRow | null {
    // Empty/whitespace-only body clears the note — keeps the table free of blanks.
    if (body.trim().length === 0) {
      this.db.run("DELETE FROM notes WHERE item_key = ?", [itemKey]);
      return null;
    }
    const row = this.db
      .query<NoteRow, [string, string, string]>(
        `INSERT INTO notes (item_key, body, ts) VALUES (?, ?, ?)
         ON CONFLICT(item_key) DO UPDATE SET body = excluded.body, ts = excluded.ts
         RETURNING id, item_key, body, ts`,
      )
      .get(itemKey, body, new Date().toISOString());
    if (row === null || row === undefined) throw new Error("Note insert failed");
    return row;
  }

  allNotes(): NoteRow[] {
    return this.db
      .query<NoteRow, []>("SELECT id, item_key, body, ts FROM notes ORDER BY ts DESC")
      .all();
  }

  close(): void {
    this.db.close();
  }
}
