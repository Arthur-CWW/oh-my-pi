import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import { Effect } from "effect"
import type { StoredData } from "./schemas"

const STORE_PATH = `${process.env.HOME ?? process.env.USERPROFILE ?? "/tmp"}/.pi/pi-web-access/store.json`

interface StoreEntry {
  value: unknown
  expiresAt: number | null
}

// ─── JSON file store ──────────────────────────────────────────────────

let _store: Record<string, StoreEntry> | null = null

function load(): Record<string, StoreEntry> {
  if (_store) return _store
  try {
    if (existsSync(STORE_PATH)) {
      _store = JSON.parse(readFileSync(STORE_PATH, "utf-8"))
      return _store!
    }
  } catch { /* nop */ }
  _store = {}
  return _store
}

function save(): void {
  if (!_store) return
  mkdirSync(dirname(STORE_PATH), { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(_store, null, 2), "utf-8")
}

function cleanExpired(): void {
  const s = load()
  const now = Date.now()
  let changed = false
  for (const key of Object.keys(s)) {
    const entry = s[key]
    if (entry?.expiresAt && entry.expiresAt < now) {
      delete s[key]
      changed = true
    }
  }
  if (changed) save()
}

// ─── KV API ───────────────────────────────────────────────────────────

export const storeSet = Effect.fn("storeSet")(function* (
  key: string,
  value: unknown,
  ttlMs?: number,
) {
  const s = load()
  s[key] = {
    value,
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
  }
  save()
})

export const storeGet = Effect.fn("storeGet")(function* (key: string) {
  cleanExpired()
  const entry = load()[key]
  if (!entry) return null
  return entry.value
})

export const storeDelete = Effect.fn("storeDelete")(function* (key: string) {
  const s = load()
  delete s[key]
  save()
})

export const storeList = Effect.fn("storeList")(function* () {
  cleanExpired()
  return Object.entries(load()).map(([key, entry]) => ({
    key,
    created_at: 0,
    expires_at: entry.expiresAt,
  }))
})

// ─── Result storage ───────────────────────────────────────────────────

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
