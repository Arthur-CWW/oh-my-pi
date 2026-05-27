import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Effect } from "effect"
import type { StoredData } from "./schemas"

// ─── SQLite setup ─────────────────────────────────────────────────────

const DB_PATH = `${process.env.HOME ?? process.env.USERPROFILE ?? "/tmp"}/.pi/pi-web-access/store.sqlite`

let _db: Database | null = null

function db(): Database {
  if (_db) return _db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)
  _db.run("PRAGMA journal_mode = WAL")
  _db.run("PRAGMA synchronous = NORMAL")
  _db.run(`CREATE TABLE IF NOT EXISTS store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  _db.run("DELETE FROM store WHERE expires_at IS NOT NULL AND expires_at < ?", [Date.now()])
  return _db
}

// ─── KV API ───────────────────────────────────────────────────────────

export const storeSet = Effect.fn("storeSet")(function* (
  key: string,
  value: unknown,
  ttlMs?: number,
) {
  const d = db()
  const json = JSON.stringify(value)
  const expiresAt = ttlMs ? Date.now() + ttlMs : null
  d.run(
    "INSERT OR REPLACE INTO store (key, value, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [key, json, expiresAt, Date.now()],
  )
})

export const storeGet = Effect.fn("storeGet")(function* (key: string) {
  const d = db()
  d.run("DELETE FROM store WHERE key = ? AND expires_at IS NOT NULL AND expires_at < ?", [key, Date.now()])
  const row = d.query("SELECT value FROM store WHERE key = ?").get(key) as { value: string } | null
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return null }
})

export const storeDelete = Effect.fn("storeDelete")(function* (key: string) {
  db().run("DELETE FROM store WHERE key = ?", [key])
})

export const storeList = Effect.fn("storeList")(function* () {
  const d = db()
  d.run("DELETE FROM store WHERE expires_at IS NOT NULL AND expires_at < ?", [Date.now()])
  return d.query("SELECT key, created_at, expires_at FROM store ORDER BY created_at DESC").all() as Array<{
    key: string; created_at: number; expires_at: number | null
  }>
})

// ─── Result storage (search/fetch session results) ────────────────────

const RESULT_TTL = 24 * 60 * 60 * 1000

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const storeSearch = Effect.fn("storeSearch")(function* (
  answer: string,
  results: Array<{ title: string; url: string; snippet: string }>,
) {
  const id = genId()
  const data: StoredData = {
    id,
    type: "search",
    timestamp: Date.now(),
    queries: [{ query: "", answer, results: [...results], error: null }],
  }
  yield* storeSet(`result:${id}`, data, RESULT_TTL)
  return id
})

export const storeFetch = Effect.fn("storeFetch")(function* (
  urls: Array<{ url: string; title: string; content: string; error: string | null }>,
) {
  const id = genId()
  const data: StoredData = {
    id,
    type: "fetch",
    timestamp: Date.now(),
    urls: [...urls],
  }
  yield* storeSet(`result:${id}`, data, RESULT_TTL)
  return id
})

export const getStored = Effect.fn("getStored")(function* (responseId: string) {
  const data = yield* storeGet(`result:${responseId}`)
  return data as StoredData | null
})

export const clearStored = Effect.fn("clearStored")(function* (responseId: string) {
  yield* storeDelete(`result:${responseId}`)
})
