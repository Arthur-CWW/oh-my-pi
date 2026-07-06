import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import { Schema } from "effect"

export const CEDICT_NOT_BUILT_ERROR = "cedict not built — run bun run cedict:build"

export interface CedictEntry {
  simplified: string
  traditional: string
  pinyin: string
  definitions: string[]
}

export interface DictLookup {
  word: string
  entries: CedictEntry[]
}

export interface KnownWordsResult {
  words: string[]
}

const StringArraySchema = Schema.Array(Schema.String)
const RawCedictRowSchema = Schema.Struct({
  simplified: Schema.String,
  traditional: Schema.String,
  pinyin: Schema.String,
  definitions: Schema.String,
})

type RawCedictRow = Schema.Schema.Type<typeof RawCedictRowSchema>

const RawKnownWordRowSchema = Schema.Struct({ word: Schema.String })
type RawKnownWordRow = Schema.Schema.Type<typeof RawKnownWordRowSchema>

export class CedictNotBuiltError extends Error {
  constructor() {
    super(CEDICT_NOT_BUILT_ERROR)
  }
}

export function lookupCedictExact(dbPath: string, word: string): DictLookup {
  const trimmedWord = word.trim()
  if (trimmedWord.length === 0) return { word: trimmedWord, entries: [] }
  return withCedict(dbPath, (db) => ({ word: trimmedWord, entries: queryExactEntries(db, trimmedWord) }))
}

export function lookupCedictBest(dbPath: string, text: string): DictLookup {
  const trimmedText = text.trim()
  if (trimmedText.length === 0) return { word: trimmedText, entries: [] }
  return withCedict(dbPath, (db) => {
    const chars = Array.from(trimmedText)
    for (let length = chars.length; length > 0; length -= 1) {
      const prefix = chars.slice(0, length).join("")
      const entries = queryExactEntries(db, prefix)
      if (entries.length > 0) return { word: prefix, entries }
    }
    return { word: trimmedText, entries: [] }
  })
}

export function listKnownWords(dbPath: string): KnownWordsResult {
  return withCedict(dbPath, (db) => {
    const words = db
      .query<RawKnownWordRow, []>("SELECT word FROM known_words ORDER BY word ASC")
      .all()
      .map((row) => Schema.decodeUnknownSync(RawKnownWordRowSchema)(row).word)
    return { words }
  })
}

function withCedict<T>(dbPath: string, use: (db: Database) => T): T {
  if (!dbPath.startsWith("file:") && dbPath !== ":memory:" && !existsSync(dbPath)) throw new CedictNotBuiltError()
  const db = new Database(dbPath, { readonly: true })
  try {
    return use(db)
  } catch (error) {
    if (error instanceof CedictNotBuiltError) throw error
    if (error instanceof Error && /no such table: (cedict|known_words)/u.test(error.message)) throw new CedictNotBuiltError()
    throw error
  } finally {
    db.close()
  }
}

function queryExactEntries(db: Database, word: string): CedictEntry[] {
  return db
    .query<RawCedictRow, [string, string]>(
      `SELECT simplified, traditional, pinyin, definitions
       FROM cedict
       WHERE simplified = ? OR traditional = ?
       ORDER BY length(simplified) DESC, simplified ASC, traditional ASC, pinyin ASC`,
    )
    .all(word, word)
    .map((row) => decodeCedictRow(row))
}

function decodeCedictRow(row: RawCedictRow): CedictEntry {
  const decoded = Schema.decodeUnknownSync(RawCedictRowSchema)(row)
  const parsedDefinitions: unknown = JSON.parse(decoded.definitions)
  return {
    simplified: decoded.simplified,
    traditional: decoded.traditional,
    pinyin: decoded.pinyin,
    definitions: [...Schema.decodeUnknownSync(StringArraySchema)(parsedDefinitions)],
  }
}
