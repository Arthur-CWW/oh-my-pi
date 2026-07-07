import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Database } from "bun:sqlite"
import { Schema } from "effect"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..")
const REPO_ROOT = resolve(PACKAGE_DIR, "..", "..")
const DEFAULT_STORE_PATH = resolve(REPO_ROOT, "data/primer/generation-store.sqlite")

const GENERATION_DIR = "streams/primer/wrapped-commentary-reader/artifacts/generation"
const ANNOTATION_DIR = `${GENERATION_DIR}/quality-pass-2026-07-06`
const PROMPT_AB_DIR_PATTERN = /^prompt-ab-20\d{2}-\d{2}-\d{2}$/u
const DATED_GENERATION_DIR_PATTERN = /^.+-20\d{2}-\d{2}-\d{2}$/u
const RUBRIC_DIR = `${GENERATION_DIR}/rubric-2026-07-06`
const HSK_DIR = "streams/primer/hsk-cards/gen-2026-07-06"

const BATCH_KINDS = ["annotation-rewrite", "rubric-verdict", "hsk-cards"] as const

type BatchKind = (typeof BATCH_KINDS)[number]
type NoRows = Record<string, never>

interface FileIngestResult {
  kind: BatchKind
  sourceFile: string
  inserted: number
  updated: number
  skippedDup: number
  malformed: number
}

export interface IngestGenerationOptions {
  rootDir?: string
  storePath?: string
  now?: () => Date
}

export interface IngestGenerationResult {
  storePath: string
  files: FileIngestResult[]
}

interface GenerationStats {
  storePath: string
  kinds: Array<{ kind: BatchKind; batches: number; rows: number }>
  tierHistograms: TierRow[]
}

interface ExistingRow {
  raw_json: string
}

interface CountRow {
  count: number
}

interface TierRow {
  kind: "rubric-verdict" | "hsk-cards"
  tier: string | null
  rows: number
}

interface AnnotationBatch {
  unit_key?: string | null
  reading_unit_key?: string | null
  annotations: JsonRecord[]
  worker?: string | null
  model?: string | null
  prompt_version?: string | null
}

interface AnnotationEnvelope {
  slice?: string | null
  unit_batches: AnnotationBatch[]
  worker?: string | null
  model?: string | null
  prompt_version?: string | null
}

interface RubricVerdict {
  id: string | number
  tier: string
  paraphrase: boolean
  anchorPrecise: boolean
  redundant: boolean
  retrievalTarget: string
  defects: unknown[]
  verdict: string
}

interface HskCardFile {
  word: string
  pinyin: string
  gloss: string
  cards: JsonRecord[]
  worker?: string | null
  model?: string | null
  prompt_version?: string | null
}

interface HskCardRow {
  type: string
  front: string
  back: string
  retrievalTarget: string
  tier: string
  notes: string | null
}

type JsonRecord = Record<string, unknown>

const JsonRecordSchema = Schema.Record(Schema.String, Schema.Unknown)
const OptionalString = Schema.optional(Schema.NullOr(Schema.String))

const AnnotationBatchSchema = Schema.Struct({
  unit_key: OptionalString,
  reading_unit_key: OptionalString,
  annotations: Schema.Array(JsonRecordSchema),
  worker: OptionalString,
  model: OptionalString,
  prompt_version: OptionalString,
})
const AnnotationEnvelopeSchema = Schema.Struct({
  slice: OptionalString,
  unit_batches: Schema.Array(AnnotationBatchSchema),
  worker: OptionalString,
  model: OptionalString,
  prompt_version: OptionalString,
})
const AnnotationBatchArraySchema = Schema.Array(AnnotationBatchSchema)

const RubricVerdictSchema = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  tier: Schema.String,
  paraphrase: Schema.Boolean,
  anchorPrecise: Schema.Boolean,
  redundant: Schema.Boolean,
  retrievalTarget: Schema.String,
  defects: Schema.Array(Schema.Unknown),
  verdict: Schema.String,
})

const HskCardSchema = JsonRecordSchema
const HskCardFileSchema = Schema.Struct({
  word: Schema.String,
  pinyin: Schema.String,
  gloss: Schema.String,
  cards: Schema.Array(HskCardSchema),
  worker: OptionalString,
  model: OptionalString,
  prompt_version: OptionalString,
})
const HskCardFilesSchema = Schema.Union([HskCardFileSchema, Schema.Array(HskCardFileSchema)])

export async function ingestGeneration(options: IngestGenerationOptions = {}): Promise<IngestGenerationResult> {
  const storePath = resolve(options.storePath ?? DEFAULT_STORE_PATH)
  const db = openGenerationStore(storePath)
  try {
    return await ingestGenerationWithDb(db, { ...options, storePath })
  } finally {
    db.close()
  }
}

export async function ingestGenerationWithDb(db: Database, options: IngestGenerationOptions = {}): Promise<IngestGenerationResult> {
  const rootDir = resolve(options.rootDir ?? REPO_ROOT)
  const storePath = options.storePath === undefined ? DEFAULT_STORE_PATH : options.storePath
  const now = options.now ?? (() => new Date())
  const files = [
    ...ingestAnnotationFiles(db, rootDir, now),
    ...ingestRubricFiles(db, rootDir, now),
    ...ingestHskFiles(db, rootDir, now),
  ]
  return { storePath, files }
}

export function getGenerationStats(storePath = DEFAULT_STORE_PATH): GenerationStats {
  const resolvedStorePath = resolve(storePath)
  const db = openGenerationStore(resolvedStorePath)
  try {
    return getGenerationStatsFromDb(db, resolvedStorePath)
  } finally {
    db.close()
  }
}

export function getGenerationStatsFromDb(db: Database, storePath = DEFAULT_STORE_PATH): GenerationStats {
  return {
    storePath,
    kinds: BATCH_KINDS.map((kind) => ({
      kind,
      batches: countBatches(db, kind),
      rows: countKindRows(db, kind),
    })),
    tierHistograms: db
      .query<TierRow, []>(`
        SELECT 'rubric-verdict' AS kind, tier, count(*) AS rows
        FROM rubric_verdicts
        WHERE tier IS NOT NULL AND tier <> ''
        GROUP BY tier
        UNION ALL
        SELECT 'hsk-cards' AS kind, tier, count(*) AS rows
        FROM hsk_cards
        WHERE tier IS NOT NULL AND tier <> ''
        GROUP BY tier
        ORDER BY kind, tier
      `)
      .all(),
  }
}

export function openGenerationStore(storePath = DEFAULT_STORE_PATH): Database {
  prepareStorePath(storePath)
  const db = new Database(storePath, { create: true, readwrite: true })
  initializeGenerationStore(db)
  return db
}

export function initializeGenerationStore(db: Database): Database {
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec(`
CREATE TABLE IF NOT EXISTS generation_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('annotation-rewrite', 'rubric-verdict', 'hsk-cards')),
  source_file TEXT NOT NULL,
  worker TEXT,
  model TEXT,
  prompt_version TEXT,
  ingested_at TEXT NOT NULL,
  UNIQUE(kind, source_file)
);

CREATE TABLE IF NOT EXISTS annotations (
  batch_id TEXT NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  ann_id TEXT NOT NULL,
  unit_key TEXT,
  block_key TEXT,
  pdf_page INTEGER,
  anchor TEXT,
  kind TEXT,
  title TEXT,
  reader_question TEXT,
  front_claim TEXT,
  category TEXT,
  ontology TEXT,
  why_reference TEXT,
  note TEXT,
  refs TEXT,
  verdict TEXT,
  reason TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(batch_id, ann_id)
);

CREATE TABLE IF NOT EXISTS rubric_verdicts (
  batch_id TEXT NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  ann_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  paraphrase INTEGER NOT NULL CHECK (paraphrase IN (0, 1)),
  anchor_precise INTEGER NOT NULL CHECK (anchor_precise IN (0, 1)),
  redundant INTEGER NOT NULL CHECK (redundant IN (0, 1)),
  retrieval_target TEXT NOT NULL,
  defects_json TEXT NOT NULL,
  verdict TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(batch_id, ann_id)
);

CREATE TABLE IF NOT EXISTS hsk_cards (
  batch_id TEXT NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  gloss TEXT NOT NULL,
  card_type TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  retrieval_target TEXT NOT NULL,
  tier TEXT NOT NULL,
  notes TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(batch_id, word, card_type, front)
);

CREATE INDEX IF NOT EXISTS annotations_ann_id_idx ON annotations(ann_id);
CREATE INDEX IF NOT EXISTS rubric_verdicts_tier_idx ON rubric_verdicts(tier);
CREATE INDEX IF NOT EXISTS hsk_cards_tier_idx ON hsk_cards(tier);
PRAGMA user_version = 1;
`)
  return db
}

function ingestAnnotationFiles(db: Database, rootDir: string, now: () => Date): FileIngestResult[] {
  const files = [
    ...listStageFiles(rootDir, ANNOTATION_DIR, /^slice-[a-d]\.json$/u),
    ...listAnnotationBatchFiles(rootDir),
  ]
  return files.map((filePath) => ingestAnnotationFile(db, rootDir, filePath, now))
}

function ingestAnnotationFile(db: Database, rootDir: string, filePath: string, now: () => Date): FileIngestResult {
  const sourceFile = sourceFileFor(rootDir, filePath)
  const result = emptyFileResult("annotation-rewrite", sourceFile)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    result.malformed += 1
    return result
  }

  let envelope: AnnotationEnvelope
  try {
    envelope = parseAnnotationEnvelope(parsed)
  } catch {
    result.malformed += 1
    return result
  }

  const batchId = batchIdFor("annotation-rewrite", sourceFile)
  const firstBatch = envelope.unit_batches[0]
  upsertGenerationBatch(db, {
    id: batchId,
    kind: "annotation-rewrite",
    sourceFile,
    worker: firstText(envelope.worker, envelope.slice, firstBatch?.worker, workerFromSource(sourceFile)),
    model: firstText(envelope.model, firstBatch?.model),
    promptVersion: firstText(promptVersionFromSource(sourceFile), envelope.prompt_version, firstBatch?.prompt_version),
    ingestedAt: now().toISOString(),
  })

  const applyRows = db.transaction((batches: AnnotationBatch[]) => {
    for (const batch of batches) {
      const unitKey = firstText(batch.unit_key, batch.reading_unit_key)
      if (unitKey === null) {
        result.malformed += Math.max(1, batch.annotations.length)
        continue
      }
      for (let index = 0; index < batch.annotations.length; index += 1) {
        const annotation = batch.annotations[index]
        const rawJson = stableRawJson({ unit_key: unitKey, annotation })
        const annId = annotationIdFor(unitKey, annotation, index)
        const existing = db
          .query<ExistingRow, [string, string]>("SELECT raw_json FROM annotations WHERE batch_id = ? AND ann_id = ?")
          .get(batchId, annId)
        if (existing === null) {
          insertAnnotation(db, batchId, annId, unitKey, annotation, rawJson)
          result.inserted += 1
        } else if (existing.raw_json === rawJson) {
          result.skippedDup += 1
        } else {
          updateAnnotation(db, batchId, annId, unitKey, annotation, rawJson)
          result.updated += 1
        }
      }
    }
  })
  applyRows(envelope.unit_batches)
  return result
}

function parseAnnotationEnvelope(parsed: unknown): AnnotationEnvelope {
  try {
    return Schema.decodeUnknownSync(AnnotationEnvelopeSchema)(parsed) as AnnotationEnvelope
  } catch {
    // Accept legacy/manual transports: a single import-batch object or an array of them.
  }
  try {
    return { unit_batches: [Schema.decodeUnknownSync(AnnotationBatchSchema)(parsed) as AnnotationBatch] }
  } catch {
    return { unit_batches: Schema.decodeUnknownSync(AnnotationBatchArraySchema)(parsed) as AnnotationBatch[] }
  }
}

function ingestRubricFiles(db: Database, rootDir: string, now: () => Date): FileIngestResult[] {
  const files = listStageFiles(rootDir, RUBRIC_DIR, /^verdicts-[12]\.jsonl$/u)
  return files.map((filePath) => ingestRubricFile(db, rootDir, filePath, now))
}

function ingestRubricFile(db: Database, rootDir: string, filePath: string, now: () => Date): FileIngestResult {
  const sourceFile = sourceFileFor(rootDir, filePath)
  const result = emptyFileResult("rubric-verdict", sourceFile)
  const batchId = batchIdFor("rubric-verdict", sourceFile)

  let lines: string[]
  try {
    lines = readFileSync(filePath, "utf8").split(/\r?\n/u)
  } catch {
    result.malformed += 1
    return result
  }
  const applyRows = db.transaction((records: RubricVerdict[]) => {
    for (const verdict of records) {
      const annId = String(verdict.id)
      const rawJson = stableRawJson(verdict)
      const existing = db
        .query<ExistingRow, [string, string]>("SELECT raw_json FROM rubric_verdicts WHERE batch_id = ? AND ann_id = ?")
        .get(batchId, annId)
      if (existing === null) {
        insertRubricVerdict(db, batchId, annId, verdict, rawJson)
        result.inserted += 1
      } else if (existing.raw_json === rawJson) {
        result.skippedDup += 1
      } else {
        updateRubricVerdict(db, batchId, annId, verdict, rawJson)
        result.updated += 1
      }
    }
  })

  const records: RubricVerdict[] = []
  for (const line of lines) {
    if (line.trim().length === 0) continue
    try {
      records.push(Schema.decodeUnknownSync(RubricVerdictSchema)(JSON.parse(line)) as RubricVerdict)
    } catch {
      result.malformed += 1
    }
  }
  if (records.length === 0) return result
  upsertGenerationBatch(db, {
    id: batchId,
    kind: "rubric-verdict",
    sourceFile,
    worker: workerFromSource(sourceFile),
    model: null,
    promptVersion: promptVersionFromSource(sourceFile),
    ingestedAt: now().toISOString(),
  })
  applyRows(records)
  return result
}

function ingestHskFiles(db: Database, rootDir: string, now: () => Date): FileIngestResult[] {
  const files = listStageFiles(rootDir, HSK_DIR, /^hsk5-.*\.json$/u)
  return files.map((filePath) => ingestHskFile(db, rootDir, filePath, now))
}

function ingestHskFile(db: Database, rootDir: string, filePath: string, now: () => Date): FileIngestResult {
  const sourceFile = sourceFileFor(rootDir, filePath)
  const result = emptyFileResult("hsk-cards", sourceFile)
  let entries: HskCardFile[]
  try {
    const decoded = Schema.decodeUnknownSync(HskCardFilesSchema)(JSON.parse(readFileSync(filePath, "utf8"))) as HskCardFile | HskCardFile[]
    entries = Array.isArray(decoded) ? decoded : [decoded]
  } catch {
    result.malformed += 1
    return result
  }

  const batchId = batchIdFor("hsk-cards", sourceFile)
  const firstEntry = entries[0]
  upsertGenerationBatch(db, {
    id: batchId,
    kind: "hsk-cards",
    sourceFile,
    worker: firstText(firstEntry?.worker, workerFromSource(sourceFile)),
    model: textValue(firstEntry?.model),
    promptVersion: firstText(firstEntry?.prompt_version, promptVersionFromSource(sourceFile)),
    ingestedAt: now().toISOString(),
  })

  const applyRows = db.transaction((wordEntries: HskCardFile[]) => {
    for (const entry of wordEntries) {
      for (const card of entry.cards) {
        const normalizedCard = hskCardRow(card)
        if (normalizedCard === null) {
          result.malformed += 1
          continue
        }
        const rawJson = stableRawJson({ word: entry.word, pinyin: entry.pinyin, gloss: entry.gloss, card })
        const existing = db
          .query<ExistingRow, [string, string, string, string]>(
            "SELECT raw_json FROM hsk_cards WHERE batch_id = ? AND word = ? AND card_type = ? AND front = ?",
          )
          .get(batchId, entry.word, normalizedCard.type, normalizedCard.front)
        if (existing === null) {
          insertHskCard(db, batchId, entry, normalizedCard, rawJson)
          result.inserted += 1
        } else if (existing.raw_json === rawJson) {
          result.skippedDup += 1
        } else {
          updateHskCard(db, batchId, entry, normalizedCard, rawJson)
          result.updated += 1
        }
      }
    }
  })
  applyRows(entries)
  return result
}

function upsertGenerationBatch(
  db: Database,
  batch: {
    id: string
    kind: BatchKind
    sourceFile: string
    worker: string | null
    model: string | null
    promptVersion: string | null
    ingestedAt: string
  },
): void {
  db.query<NoRows, [string, BatchKind, string, string | null, string | null, string | null, string]>(
    `INSERT INTO generation_batches (id, kind, source_file, worker, model, prompt_version, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_file = excluded.source_file,
       worker = excluded.worker,
       model = excluded.model,
       prompt_version = excluded.prompt_version,
       ingested_at = excluded.ingested_at`,
  ).run(batch.id, batch.kind, batch.sourceFile, batch.worker, batch.model, batch.promptVersion, batch.ingestedAt)
}

function insertAnnotation(
  db: Database,
  batchId: string,
  annId: string,
  unitKey: string,
  annotation: JsonRecord,
  rawJson: string,
): void {
  db.query<NoRows, AnnotationParams>(annotationInsertSql()).run(...annotationParams(batchId, annId, unitKey, annotation, rawJson))
}

function updateAnnotation(
  db: Database,
  batchId: string,
  annId: string,
  unitKey: string,
  annotation: JsonRecord,
  rawJson: string,
): void {
  db.query<NoRows, [...AnnotationParams, string, string]>(
    `${annotationUpdateSql()} WHERE batch_id = ? AND ann_id = ?`,
  ).run(...annotationParams(batchId, annId, unitKey, annotation, rawJson), batchId, annId)
}

type AnnotationParams = [
  string,
  string,
  string,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
]

function annotationParams(batchId: string, annId: string, unitKey: string, annotation: JsonRecord, rawJson: string): AnnotationParams {
  return [
    batchId,
    annId,
    unitKey,
    textValue(annotation.block_key),
    numberValue(annotation.pdf_page),
    textValue(annotation.anchor),
    textValue(annotation.kind),
    textValue(annotation.title),
    firstText(annotation.reader_question, annotation.question),
    textValue(annotation.front_claim),
    textValue(annotation.category),
    textValue(annotation.ontology),
    textValue(annotation.why_reference),
    firstText(annotation.note, annotation.body),
    textValue(annotation.refs),
    textValue(annotation.verdict),
    textValue(annotation.reason),
    rawJson,
  ]
}

function annotationInsertSql(): string {
  return `INSERT INTO annotations (
    batch_id, ann_id, unit_key, block_key, pdf_page, anchor, kind, title, reader_question, front_claim,
    category, ontology, why_reference, note, refs, verdict, reason, raw_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
}

function annotationUpdateSql(): string {
  return `UPDATE annotations SET
    batch_id = ?, ann_id = ?, unit_key = ?, block_key = ?, pdf_page = ?, anchor = ?, kind = ?, title = ?,
    reader_question = ?, front_claim = ?, category = ?, ontology = ?, why_reference = ?, note = ?, refs = ?,
    verdict = ?, reason = ?, raw_json = ?`
}

function insertRubricVerdict(db: Database, batchId: string, annId: string, verdict: RubricVerdict, rawJson: string): void {
  db.query<NoRows, RubricParams>(rubricInsertSql()).run(...rubricParams(batchId, annId, verdict, rawJson))
}

function updateRubricVerdict(db: Database, batchId: string, annId: string, verdict: RubricVerdict, rawJson: string): void {
  db.query<NoRows, [...RubricParams, string, string]>(`${rubricUpdateSql()} WHERE batch_id = ? AND ann_id = ?`).run(
    ...rubricParams(batchId, annId, verdict, rawJson),
    batchId,
    annId,
  )
}

type RubricParams = [string, string, string, number, number, number, string, string, string, string]

function rubricParams(batchId: string, annId: string, verdict: RubricVerdict, rawJson: string): RubricParams {
  return [
    batchId,
    annId,
    verdict.tier,
    verdict.paraphrase ? 1 : 0,
    verdict.anchorPrecise ? 1 : 0,
    verdict.redundant ? 1 : 0,
    verdict.retrievalTarget,
    JSON.stringify(verdict.defects),
    verdict.verdict,
    rawJson,
  ]
}

function rubricInsertSql(): string {
  return `INSERT INTO rubric_verdicts (
    batch_id, ann_id, tier, paraphrase, anchor_precise, redundant, retrieval_target, defects_json, verdict, raw_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
}

function rubricUpdateSql(): string {
  return `UPDATE rubric_verdicts SET
    batch_id = ?, ann_id = ?, tier = ?, paraphrase = ?, anchor_precise = ?, redundant = ?,
    retrieval_target = ?, defects_json = ?, verdict = ?, raw_json = ?`
}

function insertHskCard(db: Database, batchId: string, file: HskCardFile, card: HskCardRow, rawJson: string): void {
  db.query<NoRows, HskParams>(hskInsertSql()).run(...hskParams(batchId, file, card, rawJson))
}

function updateHskCard(db: Database, batchId: string, file: HskCardFile, card: HskCardRow, rawJson: string): void {
  db.query<NoRows, [...HskParams, string, string, string, string]>(
    `${hskUpdateSql()} WHERE batch_id = ? AND word = ? AND card_type = ? AND front = ?`,
  ).run(...hskParams(batchId, file, card, rawJson), batchId, file.word, card.type, card.front)
}

function hskCardRow(card: JsonRecord): HskCardRow | null {
  const type = textValue(card.type)
  const front = textValue(card.front)
  const back = textValue(card.back)
  const retrievalTarget = textValue(card.retrievalTarget)
  const tier = textValue(card.tier)
  if (type === null || front === null || back === null || retrievalTarget === null || tier === null) return null
  return { type, front, back, retrievalTarget, tier, notes: textValue(card.notes) }
}

type HskParams = [string, string, string, string, string, string, string, string, string, string | null, string]

function hskParams(batchId: string, file: HskCardFile, card: HskCardRow, rawJson: string): HskParams {
  return [
    batchId,
    file.word,
    file.pinyin,
    file.gloss,
    card.type,
    card.front,
    card.back,
    card.retrievalTarget,
    card.tier,
    card.notes,
    rawJson,
  ]
}

function hskInsertSql(): string {
  return `INSERT INTO hsk_cards (
    batch_id, word, pinyin, gloss, card_type, front, back, retrieval_target, tier, notes, raw_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
}

function hskUpdateSql(): string {
  return `UPDATE hsk_cards SET
    batch_id = ?, word = ?, pinyin = ?, gloss = ?, card_type = ?, front = ?, back = ?,
    retrieval_target = ?, tier = ?, notes = ?, raw_json = ?`
}

function countBatches(db: Database, kind: BatchKind): number {
  return db.query<CountRow, [BatchKind]>("SELECT count(*) AS count FROM generation_batches WHERE kind = ?").get(kind)?.count ?? 0
}

function countKindRows(db: Database, kind: BatchKind): number {
  if (kind === "annotation-rewrite") {
    return db.query<CountRow, []>("SELECT count(*) AS count FROM annotations").get()?.count ?? 0
  }
  if (kind === "rubric-verdict") {
    return db.query<CountRow, []>("SELECT count(*) AS count FROM rubric_verdicts").get()?.count ?? 0
  }
  return db.query<CountRow, []>("SELECT count(*) AS count FROM hsk_cards").get()?.count ?? 0
}

function listStageFiles(rootDir: string, relativeDir: string, filePattern: RegExp): string[] {
  const dir = resolve(rootDir, relativeDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && filePattern.test(entry.name))
    .map((entry) => resolve(dir, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

function listAnnotationBatchFiles(rootDir: string): string[] {
  const generationDir = resolve(rootDir, GENERATION_DIR)
  if (!existsSync(generationDir)) return []
  const files: string[] = []
  for (const entry of readdirSync(generationDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!DATED_GENERATION_DIR_PATTERN.test(entry.name)) continue
    if (PROMPT_AB_DIR_PATTERN.test(entry.name)) continue
    files.push(...listStageFiles(rootDir, `${GENERATION_DIR}/${entry.name}`, /^.+\.batch\.json$/u))
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function sourceFileFor(rootDir: string, filePath: string): string {
  const sourceFile = relative(rootDir, filePath)
  return sourceFile.length === 0 || sourceFile.startsWith("..") ? filePath : sourceFile
}

function batchIdFor(kind: BatchKind, sourceFile: string): string {
  return `${kind}:${sourceFile}`
}

function annotationIdFor(unitKey: string, annotation: JsonRecord, index: number): string {
  return firstText(annotation.ann_id, annotation.id, `${unitKey}:${index}`) ?? `${unitKey}:${index}`
}

function promptVersionFromSource(sourceFile: string): string | null {
  const parts = sourceFile.split(/[\\/]/u)
  if (parts.length < 2) return null
  return parts.at(-2) ?? null
}

function workerFromSource(sourceFile: string): string | null {
  const fileName = sourceFile.split(/[\\/]/u).at(-1)
  return fileName === undefined ? null : fileName.replace(/\.(jsonl|json)$/u, "")
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = textValue(value)
    if (text !== null && text.length > 0) return text
  }
  return null
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map((entry) => textValue(entry)).filter((entry): entry is string => entry !== null).join(", ")
  return JSON.stringify(value)
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function stableRawJson(value: unknown): string {
  return JSON.stringify(value)
}

function emptyFileResult(kind: BatchKind, sourceFile: string): FileIngestResult {
  return { kind, sourceFile, inserted: 0, updated: 0, skippedDup: 0, malformed: 0 }
}

function prepareStorePath(storePath: string): void {
  mkdirSync(dirname(storePath), { recursive: true })
}

function formatIngestReport(result: IngestGenerationResult): string {
  const lines = [`generation store: ${result.storePath}`]
  if (result.files.length === 0) {
    lines.push("no staging files found")
    return lines.join("\n")
  }
  for (const file of result.files) {
    lines.push(
      `${file.kind} ${file.sourceFile}: inserted=${file.inserted} updated=${file.updated} skipped-dup=${file.skippedDup} malformed=${file.malformed}`,
    )
  }
  return lines.join("\n")
}

function formatStats(stats: GenerationStats): string {
  const lines = [`generation store: ${stats.storePath}`]
  for (const kind of stats.kinds) {
    lines.push(`${kind.kind}: batches=${kind.batches} rows=${kind.rows}`)
  }
  const histograms = new Map<string, string[]>()
  for (const row of stats.tierHistograms) {
    const entries = histograms.get(row.kind) ?? []
    entries.push(`${row.tier ?? "(null)"}=${row.rows}`)
    histograms.set(row.kind, entries)
  }
  for (const [kind, entries] of histograms) {
    lines.push(`${kind} tiers: ${entries.join(" ")}`)
  }
  return lines.join("\n")
}

function parseArgs(argv: string[]): { command: "ingest" | "stats"; rootDir: string } {
  let command: "ingest" | "stats" = "ingest"
  const args = [...argv]
  if (args[0] === "stats") {
    command = "stats"
    args.shift()
  }

  let rootDir = REPO_ROOT
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--dir") {
      const value = args[index + 1]
      if (value === undefined) throw new Error("--dir requires a path")
      rootDir = resolve(value)
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return { command, rootDir }
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.command === "stats") {
      console.log(formatStats(getGenerationStats()))
    } else {
      console.log(formatIngestReport(await ingestGeneration({ rootDir: args.rootDir })))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
