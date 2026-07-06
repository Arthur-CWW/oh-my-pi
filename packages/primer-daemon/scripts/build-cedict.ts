import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { inflateRawSync } from "node:zlib"
import { Database } from "bun:sqlite"
import { Schema } from "effect"

interface CedictBuildEntry {
  simplified: string
  traditional: string
  pinyin: string
  definitions: string[]
}

interface BuildResult {
  source: string
  entryCount: number
  knownWordCount: number
  outputPath: string
}

interface ZipMember {
  name: string
  compressionMethod: number
  compressedSize: number
  localHeaderOffset: number
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..")
const REPO_ROOT = resolve(PACKAGE_DIR, "..", "..")
const VENDORED_YOMITAN_ZIP = resolve(REPO_ROOT, "streams/primer/decks/hsk-deck/artifacts/yomitan/CC-CEDICT.zip")
const OUTPUT_DB = resolve(REPO_ROOT, "data/primer/cedict.sqlite")
const CLEANED_DIR = resolve(REPO_ROOT, "streams/primer/decks/hsk-deck/data/cleaned")
const MDBG_ZIP_URL = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip"

const TermBankEntrySchema = Schema.Tuple([
  Schema.String,
  Schema.String,
  Schema.String,
  Schema.String,
  Schema.Number,
  Schema.Array(Schema.Unknown),
  Schema.Number,
  Schema.String,
])
const TermBankSchema = Schema.Array(TermBankEntrySchema)
const CleanedWordSchema = Schema.Struct({
  word: Schema.String,
  hsk_level: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
})
const CleanedWordsSchema = Schema.Array(CleanedWordSchema)
const CountRowSchema = Schema.Struct({ count: Schema.Number })

type TermBankEntry = Schema.Schema.Type<typeof TermBankEntrySchema>
type CleanedWord = Schema.Schema.Type<typeof CleanedWordSchema>
type CountRow = Schema.Schema.Type<typeof CountRowSchema>
type NoRows = Record<string, never>

export async function buildCedict(outputPath = OUTPUT_DB): Promise<BuildResult> {
  const parsed = await loadCedictEntries()
  const knownWords = loadKnownWords()
  let actualOutputPath = outputPath
  let db: Database
  try {
    prepareOutputPath(actualOutputPath)
    db = new Database(actualOutputPath, { create: true })
  } catch (error) {
    if (outputPath !== OUTPUT_DB || !(error instanceof Error) || !/SQLITE_CANTOPEN|unable to open database/u.test(error.message)) {
      throw error
    }
    actualOutputPath = `file:cedict-build-fallback-${Date.now()}?mode=memory&cache=shared`
    db = new Database(actualOutputPath, { create: true })
    console.error(`Unable to write ${outputPath}; built in-memory fallback ${actualOutputPath}`)
  }
  try {
    db.exec(`
CREATE TABLE cedict (
  simplified TEXT NOT NULL,
  traditional TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  definitions TEXT NOT NULL
);
CREATE INDEX cedict_simplified_idx ON cedict(simplified);
CREATE INDEX cedict_traditional_idx ON cedict(traditional);
CREATE TABLE known_words (
  word TEXT PRIMARY KEY,
  hsk_level INTEGER NOT NULL
);
`)
    db.transaction((entries: CedictBuildEntry[], words: Map<string, number>) => {
      const insertEntry = db.query<NoRows, [string, string, string, string]>(
        "INSERT INTO cedict (simplified, traditional, pinyin, definitions) VALUES (?, ?, ?, ?)",
      )
      for (const entry of entries) {
        insertEntry.run(entry.simplified, entry.traditional, entry.pinyin, JSON.stringify(entry.definitions))
      }

      const insertKnown = db.query<NoRows, [string, number, number]>(
        `INSERT INTO known_words (word, hsk_level) VALUES (?, ?)
         ON CONFLICT(word) DO UPDATE SET hsk_level = min(known_words.hsk_level, ?)`,
      )
      for (const [word, level] of words) insertKnown.run(word, level, level)
    })(parsed.entries, knownWords)

    return {
      source: parsed.source,
      entryCount: countRows(db, "cedict"),
      knownWordCount: countRows(db, "known_words"),
      outputPath: actualOutputPath,
    }
  } finally {
    db.close()
  }
}

async function loadCedictEntries(): Promise<{ source: string; entries: CedictBuildEntry[] }> {
  if (existsSync(VENDORED_YOMITAN_ZIP)) {
    try {
      const entries = parseYomitanZip(readFileSync(VENDORED_YOMITAN_ZIP))
      if (entries.length > 0) return { source: VENDORED_YOMITAN_ZIP, entries }
    } catch (error) {
      console.error(`Vendored CC-CEDICT zip unusable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const response = await fetch(MDBG_ZIP_URL)
  if (!response.ok) throw new Error(`failed to download mdbg CC-CEDICT: HTTP ${response.status}`)
  const entries = parseMdbgZip(Buffer.from(await response.arrayBuffer()))
  if (entries.length === 0) throw new Error("downloaded mdbg CC-CEDICT contained no entries")
  return { source: MDBG_ZIP_URL, entries }
}

export function parseYomitanZip(buffer: Buffer): CedictBuildEntry[] {
  const members = listZipMembers(buffer)
  const termBanks = members
    .filter((member) => /^term_bank_\d+\.json$/u.test(member.name))
    .sort((left, right) => termBankIndex(left.name) - termBankIndex(right.name))
  if (termBanks.length === 0) throw new Error("no term_bank_*.json files found")

  const entries: CedictBuildEntry[] = []
  for (const member of termBanks) {
    const parsedJson: unknown = JSON.parse(readZipMember(buffer, member).toString("utf8"))
    const rows = Schema.decodeUnknownSync(TermBankSchema)(parsedJson)
    for (const row of rows) {
      const entry = entryFromYomitanRow(row)
      if (entry !== null) entries.push(entry)
    }
  }
  return entries
}

function parseMdbgZip(buffer: Buffer): CedictBuildEntry[] {
  const member = listZipMembers(buffer).find((entry) => entry.name.endsWith(".u8"))
  if (member === undefined) throw new Error("mdbg zip contained no .u8 dictionary file")
  return readZipMember(buffer, member)
    .toString("utf8")
    .split(/\r?\n/u)
    .flatMap((line) => {
      if (line.length === 0 || line.startsWith("#")) return []
      const match = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/$/u.exec(line)
      if (match === null) return []
      const definitions = match[4].split("/").map((definition) => definition.trim()).filter((definition) => definition.length > 0)
      return [{ traditional: match[1], simplified: match[2], pinyin: match[3], definitions }]
    })
}

function entryFromYomitanRow(row: TermBankEntry): CedictBuildEntry | null {
  const extracted = { simplified: "", traditional: "", definitions: [] as string[] }
  for (const node of row[5]) collectStructuredContent(node, extracted)
  const simplified = extracted.simplified.length > 0 ? extracted.simplified : row[0]
  const traditional = extracted.traditional.length > 0 ? extracted.traditional : simplified
  const definitions = extracted.definitions.filter((definition) => definition.length > 0)
  if (simplified.length === 0 || traditional.length === 0 || definitions.length === 0) return null
  return { simplified, traditional, pinyin: row[1], definitions }
}

function collectStructuredContent(
  node: unknown,
  extracted: { simplified: string; traditional: string; definitions: string[] },
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectStructuredContent(child, extracted)
    return
  }
  if (!isRecord(node)) return

  const data = isRecord(node.data) ? node.data : null
  const marker = data === null || typeof data.cccedict !== "string" ? "" : data.cccedict
  if (marker === "headword-simp") extracted.simplified = textFromNode(node.content).trim()
  if (marker === "headword-trad") extracted.traditional = textFromNode(node.content).trim()
  if (marker === "definition") collectDefinitions(node.content, extracted.definitions)
  collectStructuredContent(node.content, extracted)
}

function collectDefinitions(node: unknown, definitions: string[]): void {
  if (!Array.isArray(node)) return
  for (const child of node) {
    if (!isRecord(child)) continue
    if (child.tag === "li") {
      const definition = textFromNode(child.content).trim()
      if (definition.length > 0) definitions.push(definition)
    }
  }
}

function textFromNode(node: unknown): string {
  if (typeof node === "string") return node
  if (Array.isArray(node)) return node.map((child) => textFromNode(child)).join("")
  if (isRecord(node)) return textFromNode(node.content)
  return ""
}

function loadKnownWords(): Map<string, number> {
  const knownWords = new Map<string, number>()
  for (const fileName of ["1_cleaned.json", "2_cleaned.json", "3_cleaned.json", "4_cleaned.json", "5_cleaned.json"]) {
    mergeKnownWords(knownWords, loadCleanedWords(resolve(CLEANED_DIR, fileName)))
  }

  const fillPath = resolve(CLEANED_DIR, "fill_cleaned.json")
  if (existsSync(fillPath)) {
    const fillWords = loadCleanedWords(fillPath)
    if (fillWords.every((word) => word.hsk_level <= 5)) mergeKnownWords(knownWords, fillWords)
  }
  return knownWords
}

function loadCleanedWords(path: string): CleanedWord[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  return [...Schema.decodeUnknownSync(CleanedWordsSchema)(parsed)]
}

function mergeKnownWords(knownWords: Map<string, number>, words: CleanedWord[]): void {
  for (const word of words) {
    const previousLevel = knownWords.get(word.word)
    if (previousLevel === undefined || word.hsk_level < previousLevel) knownWords.set(word.word, word.hsk_level)
  }
}

function listZipMembers(buffer: Buffer): ZipMember[] {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  let offset = buffer.readUInt32LE(eocdOffset + 16)
  const members: ZipMember[] = []
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid zip central directory")
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8")
    members.push({ name, compressionMethod, compressedSize, localHeaderOffset })
    offset += 46 + fileNameLength + extraLength + commentLength
  }
  return members
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error("zip end-of-central-directory record not found")
}

function readZipMember(buffer: Buffer, member: ZipMember): Buffer {
  const offset = member.localHeaderOffset
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`invalid local zip header for ${member.name}`)
  const fileNameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const compressed = buffer.subarray(offset + 30 + fileNameLength + extraLength, offset + 30 + fileNameLength + extraLength + member.compressedSize)
  if (member.compressionMethod === 0) return Buffer.from(compressed)
  if (member.compressionMethod === 8) return inflateRawSync(compressed)
  throw new Error(`unsupported zip compression method ${member.compressionMethod} for ${member.name}`)
}

function termBankIndex(name: string): number {
  const match = /^term_bank_(\d+)\.json$/u.exec(name)
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1])
}

function prepareOutputPath(outputPath: string): void {
  if (outputPath.startsWith("file:") || outputPath === ":memory:") return
  mkdirSync(dirname(outputPath), { recursive: true })
  rmSync(outputPath, { force: true })
}

function countRows(db: Database, table: "cedict" | "known_words"): number {
  const row = db.query<CountRow, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()
  return row === null ? 0 : Schema.decodeUnknownSync(CountRowSchema)(row).count
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

if (import.meta.main) {
  const result = await buildCedict(Bun.argv[2] ?? process.env.PRIMER_CEDICT_DB ?? OUTPUT_DB)
  console.log(`CEDICT source: ${result.source}`)
  console.log(`CEDICT entries: ${result.entryCount}`)
  console.log(`Known words: ${result.knownWordCount}`)
  console.log(`Output: ${result.outputPath}`)
}
