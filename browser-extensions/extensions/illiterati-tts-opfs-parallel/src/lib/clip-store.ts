import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { z } from 'zod';

const PERSIST_KEY = 'illiterati.sqlite.b64';
export const MAX_CLIP_STORE_BYTES = 32 * 1024 * 1024;

export type StoredClip = {
  id: string;
  requestId: string;
  text: string;
  language: string;
  model: string;
  codeVersion: string;
  sampleRate: number;
  pcm: Float32Array;
  createdAt: number;
  byteSize: number;
};

export type ClipSummary = Omit<StoredClip, 'pcm'> & {
  durationMs: number;
};

const summaryRowSchema = z.object({
  id: z.string(),
  request_id: z.string(),
  text: z.string(),
  language: z.string(),
  model: z.string(),
  code_version: z.string(),
  sample_rate: z.number().int(),
  created_at: z.number().int(),
  byte_size: z.number().int(),
  pcm_samples: z.number().int()
});

const clipRowSchema = summaryRowSchema.extend({
  pcm_blob: z.instanceof(Uint8Array)
});

type SummaryRow = z.infer<typeof summaryRowSchema>;
type ClipRow = z.infer<typeof clipRowSchema>;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlJsPromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function loadPersistedBytes(): Promise<Uint8Array | undefined> {
  const result = await chrome.storage.local.get(PERSIST_KEY);
  const raw = result[PERSIST_KEY];
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  return base64ToBytes(raw);
}

async function savePersistedBytes(bytes: Uint8Array): Promise<void> {
  await chrome.storage.local.set({ [PERSIST_KEY]: bytesToBase64(bytes) });
}

async function openSqliteDatabase(): Promise<Database> {
  const SQL = await getSqlJs();
  const persisted = await loadPersistedBytes();
  const db = persisted ? new SQL.Database(persisted) : new SQL.Database();

  db.exec(`
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      text TEXT NOT NULL,
      language TEXT NOT NULL,
      model TEXT NOT NULL,
      code_version TEXT NOT NULL,
      sample_rate INTEGER NOT NULL,
      pcm_blob BLOB NOT NULL,
      pcm_samples INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      byte_size INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC);
  `);

  return db;
}

function asObject<T>(columns: string[], values: unknown[]): T {
  const entries = columns.map((column, index) => [column, values[index]] as const);
  return Object.fromEntries(entries) as T;
}

function normalizeRow(columns: string[], row: unknown): Record<string, unknown> {
  if (Array.isArray(row)) {
    return asObject<Record<string, unknown>>(columns, row);
  }
  if (row && typeof row === 'object') {
    return row as Record<string, unknown>;
  }
  return {};
}

function toPcmBlob(pcm: Float32Array): Uint8Array {
  return new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
}

function fromPcmBlob(blob: Uint8Array): Float32Array {
  const copied = blob.slice();
  return new Float32Array(copied.buffer, copied.byteOffset, copied.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function estimateClipBytes(clip: Omit<StoredClip, 'byteSize' | 'createdAt'>): number {
  return clip.pcm.byteLength + utf8Bytes(clip.text) + utf8Bytes(clip.model) + utf8Bytes(clip.codeVersion) + 512;
}

function enforceQuota(db: Database): void {
  const totalRows = db.exec('SELECT COALESCE(SUM(byte_size), 0) AS total FROM clips');
  let total = Number(totalRows[0]?.values[0]?.[0] ?? 0);

  while (total > MAX_CLIP_STORE_BYTES) {
    db.exec('DELETE FROM clips WHERE id = (SELECT id FROM clips ORDER BY created_at ASC LIMIT 1)');
    const nextRows = db.exec('SELECT COALESCE(SUM(byte_size), 0) AS total FROM clips');
    total = Number(nextRows[0]?.values[0]?.[0] ?? 0);
  }
}

export async function saveClip(input: Omit<StoredClip, 'byteSize' | 'createdAt'>): Promise<StoredClip> {
  const db = await openSqliteDatabase();
  try {
    const clip: StoredClip = {
      ...input,
      createdAt: Date.now(),
      byteSize: estimateClipBytes(input)
    };

    const stmt = db.prepare(
      `
      INSERT OR REPLACE INTO clips (
        id, request_id, text, language, model, code_version,
        sample_rate, pcm_blob, pcm_samples, created_at, byte_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );
    stmt.run([
      clip.id,
      clip.requestId,
      clip.text,
      clip.language,
      clip.model,
      clip.codeVersion,
      clip.sampleRate,
      toPcmBlob(clip.pcm),
      clip.pcm.length,
      clip.createdAt,
      clip.byteSize
    ]);
    stmt.free();

    enforceQuota(db);
    await savePersistedBytes(db.export());
    return clip;
  } finally {
    db.close();
  }
}

export async function listClips(filterClause = ''): Promise<ClipSummary[]> {
  const db = await openSqliteDatabase();
  try {
    if (filterClause.includes(';')) {
      throw new Error('Filter clause cannot include semicolons');
    }

    const where = filterClause.trim() ? `WHERE ${filterClause}` : '';
    const result = db.exec(
      `
      SELECT id, request_id, text, language, model, code_version, sample_rate, created_at, byte_size, pcm_samples
      FROM clips
      ${where}
      ORDER BY created_at DESC
      LIMIT 200
      `
    );

    if (!result.length) {
      return [];
    }

    const query = result[0] as { values?: unknown[]; columns?: string[]; lc?: string[] };
    const rawValues = Array.isArray(query.values) ? query.values : [];
    const columns = Array.isArray(query.columns) ? query.columns : Array.isArray(query.lc) ? query.lc : [];
    const rows = rawValues.map((rawRow: unknown) => summaryRowSchema.parse(normalizeRow(columns, rawRow)));

    return rows.map((row: SummaryRow) => ({
      id: row.id,
      requestId: row.request_id,
      text: row.text,
      language: row.language,
      model: row.model,
      codeVersion: row.code_version,
      sampleRate: row.sample_rate,
      createdAt: row.created_at,
      byteSize: row.byte_size,
      durationMs: Math.round((row.pcm_samples / row.sample_rate) * 1000)
    }));
  } finally {
    db.close();
  }
}

export async function getClip(id: string): Promise<StoredClip | null> {
  const db = await openSqliteDatabase();
  try {
    const stmt = db.prepare(
      `
      SELECT id, request_id, text, language, model, code_version, sample_rate, pcm_blob, pcm_samples, created_at, byte_size
      FROM clips
      WHERE id = ?
      LIMIT 1
      `
    );
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = clipRowSchema.parse(normalizeRow(stmt.getColumnNames(), stmt.get()) as ClipRow);
    stmt.free();

    return {
      id: row.id,
      requestId: row.request_id,
      text: row.text,
      language: row.language,
      model: row.model,
      codeVersion: row.code_version,
      sampleRate: row.sample_rate,
      pcm: fromPcmBlob(row.pcm_blob),
      createdAt: row.created_at,
      byteSize: row.byte_size
    };
  } finally {
    db.close();
  }
}
