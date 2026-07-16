import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, relative, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { resolveDaemonPaths, type DaemonPaths } from "./paths"

export interface ZhSentence {
  text: string
  source: string
  easeRank: number
}

export type ZhSynonymRelation = "近义词" | "反义词"

export interface ZhGlossSynonym {
  word: string
  note: string
  relation: ZhSynonymRelation
}

export interface ZhGloss {
  word: string
  simpleDef: string
  synonyms: ZhGlossSynonym[]
  registerNote: string | null
  model: string
  createdAt: string
}

export interface SaveZhGlossInput {
  word: string
  simpleDef: string
  synonyms: ZhGlossSynonym[]
  registerNote: string | null
  model: string
}

export interface ZhDictIndexResult {
  sentenceCount: number
  insertedCount: number
  sourceCount: number
}

interface SentenceCandidate {
  text: string
  source: string
}

interface HskStats {
  basic: number
  advanced: number
  unknown: number
  total: number
}

type NoRows = Record<string, never>

const RawSentenceRowSchema = Schema.Struct({
  text: Schema.String,
  source: Schema.String,
  hsk_estimate: Schema.NullOr(Schema.Number),
})
type RawSentenceRow = Schema.Schema.Type<typeof RawSentenceRowSchema>

const RawGlossRowSchema = Schema.Struct({
  word: Schema.String,
  simple_def: Schema.String,
  synonyms: Schema.String,
  register_note: Schema.NullOr(Schema.String),
  model: Schema.String,
  created_at: Schema.String,
})
type RawGlossRow = Schema.Schema.Type<typeof RawGlossRowSchema>

const RawHskWordSchema = Schema.Struct({ simplified: Schema.String })
const GeneratedSynonymSchema = Schema.Struct({
  word: Schema.String,
  note: Schema.String,
  relation: Schema.Union([Schema.Literal("近义词"), Schema.Literal("反义词")]),
})
const GeneratedGlossSchema = Schema.Struct({
  simple_def: Schema.String,
  synonyms: Schema.Array(GeneratedSynonymSchema),
  register_note: Schema.NullOr(Schema.String),
})

export function ensureZhDictTables(db: Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS zh_sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  hsk_estimate REAL,
  UNIQUE(text, source)
);
CREATE INDEX IF NOT EXISTS zh_sentences_text_idx ON zh_sentences(text);
CREATE INDEX IF NOT EXISTS zh_sentences_ease_idx ON zh_sentences(hsk_estimate);
CREATE TABLE IF NOT EXISTS zh_glosses (
  word TEXT PRIMARY KEY,
  simple_def TEXT NOT NULL,
  synonyms TEXT NOT NULL,
  register_note TEXT,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`)
}

export function getCachedZhGloss(dbPath: string, word: string): ZhGloss | null {
  const trimmed = word.trim()
  if (trimmed.length === 0 || !databaseAvailable(dbPath)) return null
  try {
    return withReadonlyZhDict(dbPath, (db) => {
      const row = db
        .query<RawGlossRow, [string]>(
          "SELECT word, simple_def, synonyms, register_note, model, created_at FROM zh_glosses WHERE word = ?",
        )
        .get(trimmed)
      return row === null ? null : decodeGlossRow(row)
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table: zh_glosses")) return null
    throw error
  }
}

export function saveZhGloss(dbPath: string, input: SaveZhGlossInput): ZhGloss {
  const word = input.word.trim()
  if (word.length === 0) throw new Error("dictionary word cannot be empty")
  const gloss: ZhGloss = {
    word,
    simpleDef: input.simpleDef,
    synonyms: [...input.synonyms],
    registerNote: input.registerNote,
    model: input.model,
    createdAt: new Date().toISOString(),
  }
  const db = new Database(dbPath)
  try {
    ensureZhDictTables(db)
    db.query<NoRows, [string, string, string, string | null, string, string]>(
      `INSERT INTO zh_glosses (word, simple_def, synonyms, register_note, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET
         simple_def = excluded.simple_def,
         synonyms = excluded.synonyms,
         register_note = excluded.register_note,
         model = excluded.model,
         created_at = excluded.created_at`,
    ).run(
      gloss.word,
      gloss.simpleDef,
      JSON.stringify(gloss.synonyms),
      gloss.registerNote,
      gloss.model,
      gloss.createdAt,
    )
  } finally {
    db.close()
  }
  return gloss
}

export function lookupZhSentences(dbPath: string, word: string, limit = 4): ZhSentence[] {
  const trimmed = word.trim()
  if (trimmed.length === 0 || limit <= 0 || !databaseAvailable(dbPath)) return []
  try {
    return withReadonlyZhDict(dbPath, (db) => {
      const rows = db
        .query<RawSentenceRow, [string]>(
          `SELECT text, source, hsk_estimate
           FROM zh_sentences
           WHERE instr(text, ?) > 0
           ORDER BY hsk_estimate IS NULL ASC, hsk_estimate ASC, length(text) ASC, id ASC
           LIMIT 64`,
        )
        .all(trimmed)
        .map((row) => Schema.decodeUnknownSync(RawSentenceRowSchema)(row))
      const cappedLimit = Math.max(0, Math.min(Math.floor(limit), 64))
      return rows.slice(0, cappedLimit).map((row, index) => ({
        text: row.text,
        source: row.source,
        easeRank: index + 1,
      }))
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table: zh_sentences")) return []
    throw error
  }
}

export function indexZhDict(
  paths: Pick<DaemonPaths, "zhdictDb" | "readerDb">,
  options: { hskDeckDir?: string } = {},
): ZhDictIndexResult {
  const hskDeckDir = options.hskDeckDir ?? resolve(homedir(), "apps/hsk-deck")
  const dbPath = paths.zhdictDb ?? resolveDaemonPaths().zhdictDb
  if (dbPath === undefined) throw new Error("zhdict database path is not configured")
  const candidates = collectSentenceCandidates(paths.readerDb, hskDeckDir)
  const db = new Database(dbPath)
  let insertedCount = 0
  try {
    ensureZhDictTables(db)
    const vocabulary = loadHskVocabulary(hskDeckDir)
    const insert = db.query<NoRows, [string, string, number | null]>(
      `INSERT OR IGNORE INTO zh_sentences (text, source, hsk_estimate) VALUES (?, ?, ?)`,
    )
    const insertAll = db.transaction((rows: SentenceCandidate[]) => {
      for (const candidate of rows) {
        const estimate = estimateSentenceDifficulty(candidate.text, vocabulary)
        const result = insert.run(candidate.text, candidate.source, estimate)
        if (result.changes > 0) insertedCount += result.changes
      }
    })
    insertAll(candidates)
    const countRow = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM zh_sentences").get()
    const sourceCountRow = db.query<{ count: number }, []>("SELECT COUNT(DISTINCT source) AS count FROM zh_sentences").get()
    return {
      sentenceCount: Number(countRow?.count ?? 0),
      insertedCount,
      sourceCount: Number(sourceCountRow?.count ?? 0),
    }
  } finally {
    db.close()
  }
}

export function decodeGeneratedGloss(value: string, word: string): Omit<ZhGloss, "word" | "model" | "createdAt"> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("model returned invalid JSON")
  }
  const decoded = Schema.decodeUnknownSync(GeneratedGlossSchema)(parsed)
  if (decoded.simple_def.trim().length === 0) throw new Error("model returned an empty Chinese definition")
  if (decoded.synonyms.length < 2 || decoded.synonyms.length > 4) {
    throw new Error("model must return 2 to 4 synonyms")
  }
  if (containsLatin(decoded.simple_def) || decoded.synonyms.some((synonym) => containsLatin(synonym.word) || containsLatin(synonym.note))) {
    throw new Error(`model returned non-Chinese text for ${word}`)
  }
  return {
    simpleDef: decoded.simple_def.trim(),
    synonyms: decoded.synonyms.map((synonym) => ({ ...synonym, word: synonym.word.trim(), note: synonym.note.trim() })),
    registerNote: decoded.register_note?.trim() || null,
  }
}

function collectSentenceCandidates(readerDbPath: string, hskDeckDir: string): SentenceCandidate[] {
  const candidates: SentenceCandidate[] = []
  if (databaseAvailable(readerDbPath)) {
    const db = new Database(readerDbPath, { readonly: true })
    try {
      const rows = db
        .query<{ id: number; title: string; source: string | null; text: string }, []>(
          `SELECT rd.id, rd.title, rd.source, rp.text
           FROM reading_docs rd
           JOIN reading_paragraphs rp ON rp.doc_id = rd.id
           ORDER BY rd.id ASC, rp.idx ASC`,
        )
        .all()
      for (const row of rows) {
        const source = `reader:${row.id}:${row.source ?? row.title}`
        for (const text of splitChineseSentences(row.text)) candidates.push({ text, source })
      }
    } catch (error) {
      if (!(error instanceof Error) || !/no such table: reading_/u.test(error.message)) throw error
    } finally {
      db.close()
    }
  }

  for (const path of collectSentenceFiles(hskDeckDir)) {
    const source = relative(hskDeckDir, path).replaceAll("\\", "/")
    for (const text of parseSentenceFile(path)) candidates.push({ text, source })
  }
  return dedupeCandidates(candidates)
}

function collectSentenceFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && (entry.name === "mando_sentences.md" || /^hsk\d+_sentences\.md$/u.test(entry.name))) files.push(path)
    }
  }
  visit(resolve(root))
  return files.sort()
}

function parseSentenceFile(path: string): string[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/u)
  if (basename(path) === "mando_sentences.md") {
    return lines.flatMap((line) => {
      const separator = line.indexOf(":")
      if (separator < 0) return []
      return splitChineseSentences(line.slice(separator + 1))
    })
  }

  const sentences: string[] = []
  let waitingForMandarin = false
  for (const line of lines) {
    if (/^\s*M:\s*/u.test(line)) {
      waitingForMandarin = true
      continue
    }
    const text = line.trim()
    if (!waitingForMandarin) continue
    if (!containsHan(text) || /^C:/u.test(text) || /^M:/u.test(text)) continue
    waitingForMandarin = false
    sentences.push(...splitChineseSentences(text))
  }
  return sentences
}

function splitChineseSentences(text: string): string[] {
  const normalized = text.replace(/\s+/gu, "").trim()
  if (normalized.length === 0 || !containsHan(normalized)) return []
  const pieces = normalized.match(/[^。！？]*[。！？]|[^。！？]+$/gu) ?? []
  return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0 && containsHan(piece))
}

function dedupeCandidates(candidates: SentenceCandidate[]): SentenceCandidate[] {
  const seen = new Set<string>()
  const unique: SentenceCandidate[] = []
  for (const candidate of candidates) {
    const key = `${candidate.source}\u0000${candidate.text}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
  }
  return unique
}

function loadHskVocabulary(root: string): Map<string, number> {
  const vocabulary = new Map<string, number>()
  const directory = resolve(root, "complete-hsk-vocabulary/wordlists/exclusive/new")
  if (!existsSync(directory)) return vocabulary
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const match = /^(\d+)\.json$/u.exec(entry.name)
    if (match === null) continue
    const level = Number(match[1])
    if (level > 5) continue
    const parsed: unknown = JSON.parse(readFileSync(resolve(directory, entry.name), "utf8"))
    const words = Schema.decodeUnknownSync(Schema.Array(RawHskWordSchema))(parsed)
    for (const word of words) {
      const prior = vocabulary.get(word.simplified)
      if (prior === undefined || level < prior) vocabulary.set(word.simplified, level)
    }
  }
  return vocabulary
}

function estimateSentenceDifficulty(sentence: string, vocabulary: Map<string, number>): number | null {
  const stats = segmentSentence(sentence, vocabulary)
  if (stats.total === 0) return null
  const unknownFraction = stats.unknown / stats.total
  const advancedFraction = stats.advanced / stats.total
  const averageKnownLevel = stats.basic === 0 ? 6 : (stats.basic * 2 + stats.advanced * 4.5) / (stats.basic + stats.advanced)
  return unknownFraction * 100 + advancedFraction * 10 + averageKnownLevel / 100
}

function segmentSentence(sentence: string, vocabulary: Map<string, number>): HskStats {
  const chars = Array.from(sentence)
  let maxWordLength = 1
  for (const word of vocabulary.keys()) maxWordLength = Math.max(maxWordLength, Array.from(word).length)
  const stats: HskStats = { basic: 0, advanced: 0, unknown: 0, total: 0 }
  for (let index = 0; index < chars.length; ) {
    if (!/\p{Script=Han}/u.test(chars[index] ?? "")) {
      index += 1
      continue
    }
    let matchedLevel: number | undefined
    let matchedLength = 0
    for (let length = Math.min(maxWordLength, chars.length - index); length >= 1; length -= 1) {
      const level = vocabulary.get(chars.slice(index, index + length).join(""))
      if (level === undefined) continue
      matchedLevel = level
      matchedLength = length
      break
    }
    if (matchedLevel === undefined) {
      stats.unknown += 1
      stats.total += 1
      index += 1
      continue
    }
    if (matchedLevel <= 3) stats.basic += 1
    else stats.advanced += 1
    stats.total += 1
    index += matchedLength
  }
  return stats
}

function decodeGlossRow(row: RawGlossRow): ZhGloss {
  const decoded = Schema.decodeUnknownSync(RawGlossRowSchema)(row)
  const synonyms = Schema.decodeUnknownSync(Schema.Array(GeneratedSynonymSchema))(JSON.parse(decoded.synonyms))
  return {
    word: decoded.word,
    simpleDef: decoded.simple_def,
    synonyms: [...synonyms],
    registerNote: decoded.register_note,
    model: decoded.model,
    createdAt: decoded.created_at,
  }
}

function containsHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value)
}

function containsLatin(value: string): boolean {
  return /[A-Za-z]/u.test(value)
}

function databaseAvailable(path: string): boolean {
  return path === ":memory:" || path.startsWith("file:") || existsSync(path)
}

function withReadonlyZhDict<T>(dbPath: string, use: (db: Database) => T): T {
  const db = new Database(dbPath, { readonly: true })
  try {
    return use(db)
  } finally {
    db.close()
  }
}
