import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import { Schema } from "effect"

import type { DaemonPaths } from "./paths"

const BATCH_KINDS = ["annotation-rewrite", "rubric-verdict", "hsk-cards"] as const
const DEFAULT_LIMIT = 100

const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const PositiveIntegerFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
)
const NullableString = Schema.NullOr(Schema.String)
const BatchKindSchema = Schema.Union([
  Schema.Literal("annotation-rewrite"),
  Schema.Literal("rubric-verdict"),
  Schema.Literal("hsk-cards"),
])
const TieredKindSchema = Schema.Union([Schema.Literal("rubric-verdict"), Schema.Literal("hsk-cards")])

const LimitQuerySchema = Schema.Struct({ limit: Schema.optionalKey(PositiveIntegerFromString) })
const AnnotationQuerySchema = Schema.Struct({
  verdict: Schema.optionalKey(Schema.String),
  unit: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(PositiveIntegerFromString),
})
const TierQuerySchema = Schema.Struct({
  tier: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(PositiveIntegerFromString),
})

const CountRowSchema = Schema.Struct({ count: NonNegativeInteger })
const KindStatsRowSchema = Schema.Struct({
  kind: BatchKindSchema,
  batches: NonNegativeInteger,
  rows: NonNegativeInteger,
})
const TierHistogramRowSchema = Schema.Struct({
  kind: TieredKindSchema,
  tier: NullableString,
  rows: NonNegativeInteger,
})

const RawBatchColumnsSchema = Schema.Struct({
  batch_id: Schema.String,
  batch_kind: BatchKindSchema,
  source_file: Schema.String,
  worker: NullableString,
  model: NullableString,
  prompt_version: NullableString,
  ingested_at: Schema.String,
})

const RawAnnotationRowSchema = Schema.Struct({
  ann_id: Schema.String,
  unit_key: NullableString,
  block_key: NullableString,
  pdf_page: Schema.NullOr(NonNegativeInteger),
  anchor: NullableString,
  kind: NullableString,
  title: NullableString,
  reader_question: NullableString,
  front_claim: NullableString,
  category: NullableString,
  ontology: NullableString,
  why_reference: NullableString,
  note: NullableString,
  refs: NullableString,
  verdict: NullableString,
  reason: NullableString,
  raw_json: Schema.String,
  ...RawBatchColumnsSchema.fields,
})

const RawRubricVerdictRowSchema = Schema.Struct({
  ann_id: Schema.String,
  tier: Schema.String,
  paraphrase: Schema.Union([Schema.Literal(0), Schema.Literal(1)]),
  anchor_precise: Schema.Union([Schema.Literal(0), Schema.Literal(1)]),
  redundant: Schema.Union([Schema.Literal(0), Schema.Literal(1)]),
  retrieval_target: Schema.String,
  defects_json: Schema.String,
  verdict: Schema.String,
  raw_json: Schema.String,
  ...RawBatchColumnsSchema.fields,
})

const RawHskCardRowSchema = Schema.Struct({
  word: Schema.String,
  pinyin: Schema.String,
  gloss: Schema.String,
  card_type: Schema.String,
  front: Schema.String,
  back: Schema.String,
  retrieval_target: Schema.String,
  tier: Schema.String,
  notes: NullableString,
  raw_json: Schema.String,
  ...RawBatchColumnsSchema.fields,
})

type BatchKind = (typeof BATCH_KINDS)[number]
type QueryBinding = string | number
type LimitQuery = Schema.Schema.Type<typeof LimitQuerySchema>
type AnnotationQuery = Schema.Schema.Type<typeof AnnotationQuerySchema>
type TierQuery = Schema.Schema.Type<typeof TierQuerySchema>
type CountRow = Schema.Schema.Type<typeof CountRowSchema>
type KindStatsRow = Schema.Schema.Type<typeof KindStatsRowSchema>
type TierHistogramRow = Schema.Schema.Type<typeof TierHistogramRowSchema>
type RawAnnotationRow = Schema.Schema.Type<typeof RawAnnotationRowSchema>
type RawRubricVerdictRow = Schema.Schema.Type<typeof RawRubricVerdictRowSchema>
type RawHskCardRow = Schema.Schema.Type<typeof RawHskCardRowSchema>

interface BatchProvenance {
  id: string
  kind: BatchKind
  sourceFile: string
  worker: string | null
  model: string | null
  promptVersion: string | null
  ingestedAt: string
}

interface AnnotationRow {
  annId: string
  unitKey: string | null
  blockKey: string | null
  pdfPage: number | null
  anchor: string | null
  kind: string | null
  title: string | null
  readerQuestion: string | null
  frontClaim: string | null
  category: string | null
  ontology: string | null
  whyReference: string | null
  note: string | null
  refs: string | null
  verdict: string | null
  reason: string | null
  rawJson: string
  batch: BatchProvenance
}

interface RubricVerdictRow {
  annId: string
  tier: string
  paraphrase: boolean
  anchorPrecise: boolean
  redundant: boolean
  retrievalTarget: string
  defectsJson: string
  verdict: string
  rawJson: string
  batch: BatchProvenance
}

interface HskCardRow {
  word: string
  pinyin: string
  gloss: string
  cardType: string
  front: string
  back: string
  retrievalTarget: string
  tier: string
  notes: string | null
  rawJson: string
  batch: BatchProvenance
}

export async function handleGenerationApi(request: Request, paths: DaemonPaths): Promise<Response | null> {
  const url = new URL(request.url)
  const pathname = url.pathname
  if (!pathname.startsWith("/api/generation/")) return null

  try {
    if (request.method !== "GET") throw new NotFoundError("unknown route")
    if (!existsSync(paths.generationStore)) return jsonResponse({ available: false })

    if (pathname === "/api/generation/stats") return withGenerationStore(paths, (db) => jsonResponse(generationStats(paths, db)))
    if (pathname === "/api/generation/annotations") return withGenerationStore(paths, (db) => jsonResponse(listAnnotations(db, url)))
    if (pathname === "/api/generation/verdicts") return withGenerationStore(paths, (db) => jsonResponse(listVerdicts(db, url)))
    if (pathname === "/api/generation/hsk-cards") return withGenerationStore(paths, (db) => jsonResponse(listHskCards(db, url)))
  } catch (error) {
    if (error instanceof BadRequestError) return jsonError(error.message, 400)
    if (error instanceof NotFoundError) return jsonError(error.message, 404)
    throw error
  }

  return null
}

function generationStats(paths: DaemonPaths, db: Database): object {
  return {
    available: true,
    storePath: paths.generationStore,
    kinds: BATCH_KINDS.map((kind) => kindStats(db, kind)),
    tierHistograms: db
      .query<TierHistogramRow, []>(`
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
      .all()
      .map((row) => Schema.decodeUnknownSync(TierHistogramRowSchema)(row)),
  }
}

function kindStats(db: Database, kind: BatchKind): KindStatsRow {
  return Schema.decodeUnknownSync(KindStatsRowSchema)({
    kind,
    batches: countBatches(db, kind),
    rows: countKindRows(db, kind),
  })
}

function countBatches(db: Database, kind: BatchKind): number {
  const row = db.query<CountRow, [BatchKind]>("SELECT count(*) AS count FROM generation_batches WHERE kind = ?").get(kind)
  return row === null ? 0 : Schema.decodeUnknownSync(CountRowSchema)(row).count
}

function countKindRows(db: Database, kind: BatchKind): number {
  if (kind === "annotation-rewrite") return countRows(db, "annotations")
  if (kind === "rubric-verdict") return countRows(db, "rubric_verdicts")
  return countRows(db, "hsk_cards")
}

function countRows(db: Database, table: "annotations" | "rubric_verdicts" | "hsk_cards"): number {
  const row = db.query<CountRow, []>(`SELECT count(*) AS count FROM ${table}`).get()
  return row === null ? 0 : Schema.decodeUnknownSync(CountRowSchema)(row).count
}

function listAnnotations(db: Database, url: URL): object {
  const query = decodeQuery(AnnotationQuerySchema, url)
  const where: string[] = []
  const bindings: QueryBinding[] = []
  if (query.verdict !== undefined) {
    where.push("a.verdict = ?")
    bindings.push(query.verdict)
  }
  if (query.unit !== undefined) {
    where.push("a.unit_key = ?")
    bindings.push(query.unit)
  }
  bindings.push(limitOrDefault(query))

  const sql = `${ANNOTATION_SELECT_SQL}${where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`} ORDER BY gb.source_file, a.unit_key, a.ann_id LIMIT ?`
  const rows = db.query<RawAnnotationRow, QueryBinding[]>(sql).all(...bindings).map(decodeAnnotationRow)
  return { available: true, rows }
}

function listVerdicts(db: Database, url: URL): object {
  const query = decodeQuery(TierQuerySchema, url)
  const where = query.tier === undefined ? "" : " WHERE rv.tier = ?"
  const bindings: QueryBinding[] = query.tier === undefined ? [limitOrDefault(query)] : [query.tier, limitOrDefault(query)]
  const rows = db
    .query<RawRubricVerdictRow, QueryBinding[]>(`${VERDICT_SELECT_SQL}${where} ORDER BY gb.source_file, rv.tier, rv.ann_id LIMIT ?`)
    .all(...bindings)
    .map(decodeVerdictRow)
  return { available: true, rows }
}

function listHskCards(db: Database, url: URL): object {
  const query = decodeQuery(TierQuerySchema, url)
  const where = query.tier === undefined ? "" : " WHERE hc.tier = ?"
  const bindings: QueryBinding[] = query.tier === undefined ? [limitOrDefault(query)] : [query.tier, limitOrDefault(query)]
  const rows = db
    .query<RawHskCardRow, QueryBinding[]>(`${HSK_CARD_SELECT_SQL}${where} ORDER BY gb.source_file, hc.tier, hc.word, hc.card_type, hc.front LIMIT ?`)
    .all(...bindings)
    .map(decodeHskCardRow)
  return { available: true, rows }
}

const ANNOTATION_SELECT_SQL = `SELECT a.ann_id, a.unit_key, a.block_key, a.pdf_page, a.anchor, a.kind, a.title,
                 a.reader_question, a.front_claim, a.category, a.ontology, a.why_reference, a.note, a.refs,
                 a.verdict, a.reason, a.raw_json,
                 gb.id AS batch_id, gb.kind AS batch_kind, gb.source_file, gb.worker, gb.model, gb.prompt_version, gb.ingested_at
          FROM annotations a
          JOIN generation_batches gb ON gb.id = a.batch_id`

const VERDICT_SELECT_SQL = `SELECT rv.ann_id, rv.tier, rv.paraphrase, rv.anchor_precise, rv.redundant,
                 rv.retrieval_target, rv.defects_json, rv.verdict, rv.raw_json,
                 gb.id AS batch_id, gb.kind AS batch_kind, gb.source_file, gb.worker, gb.model, gb.prompt_version, gb.ingested_at
          FROM rubric_verdicts rv
          JOIN generation_batches gb ON gb.id = rv.batch_id`

const HSK_CARD_SELECT_SQL = `SELECT hc.word, hc.pinyin, hc.gloss, hc.card_type, hc.front, hc.back,
                 hc.retrieval_target, hc.tier, hc.notes, hc.raw_json,
                 gb.id AS batch_id, gb.kind AS batch_kind, gb.source_file, gb.worker, gb.model, gb.prompt_version, gb.ingested_at
          FROM hsk_cards hc
          JOIN generation_batches gb ON gb.id = hc.batch_id`

function decodeAnnotationRow(row: RawAnnotationRow): AnnotationRow {
  const decoded = Schema.decodeUnknownSync(RawAnnotationRowSchema)(row)
  return {
    annId: decoded.ann_id,
    unitKey: decoded.unit_key,
    blockKey: decoded.block_key,
    pdfPage: decoded.pdf_page,
    anchor: decoded.anchor,
    kind: decoded.kind,
    title: decoded.title,
    readerQuestion: decoded.reader_question,
    frontClaim: decoded.front_claim,
    category: decoded.category,
    ontology: decoded.ontology,
    whyReference: decoded.why_reference,
    note: decoded.note,
    refs: decoded.refs,
    verdict: decoded.verdict,
    reason: decoded.reason,
    rawJson: decoded.raw_json,
    batch: decodeBatch(decoded),
  }
}

function decodeVerdictRow(row: RawRubricVerdictRow): RubricVerdictRow {
  const decoded = Schema.decodeUnknownSync(RawRubricVerdictRowSchema)(row)
  return {
    annId: decoded.ann_id,
    tier: decoded.tier,
    paraphrase: decoded.paraphrase === 1,
    anchorPrecise: decoded.anchor_precise === 1,
    redundant: decoded.redundant === 1,
    retrievalTarget: decoded.retrieval_target,
    defectsJson: decoded.defects_json,
    verdict: decoded.verdict,
    rawJson: decoded.raw_json,
    batch: decodeBatch(decoded),
  }
}

function decodeHskCardRow(row: RawHskCardRow): HskCardRow {
  const decoded = Schema.decodeUnknownSync(RawHskCardRowSchema)(row)
  return {
    word: decoded.word,
    pinyin: decoded.pinyin,
    gloss: decoded.gloss,
    cardType: decoded.card_type,
    front: decoded.front,
    back: decoded.back,
    retrievalTarget: decoded.retrieval_target,
    tier: decoded.tier,
    notes: decoded.notes,
    rawJson: decoded.raw_json,
    batch: decodeBatch(decoded),
  }
}

function decodeBatch(row: Schema.Schema.Type<typeof RawBatchColumnsSchema>): BatchProvenance {
  return {
    id: row.batch_id,
    kind: row.batch_kind,
    sourceFile: row.source_file,
    worker: row.worker,
    model: row.model,
    promptVersion: row.prompt_version,
    ingestedAt: row.ingested_at,
  }
}

function decodeQuery<S extends Schema.ConstraintDecoder<unknown>>(schema: S, url: URL): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(Object.fromEntries(url.searchParams))
  } catch {
    throw new BadRequestError("malformed generation query")
  }
}

function limitOrDefault(query: LimitQuery | AnnotationQuery | TierQuery): number {
  return query.limit ?? DEFAULT_LIMIT
}

function withGenerationStore<T>(paths: DaemonPaths, use: (db: Database) => T): T {
  const db = new Database(paths.generationStore, { readonly: true })
  try {
    return use(db)
  } finally {
    db.close()
  }
}

function jsonResponse(body: object | readonly object[], status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function jsonError(error: string, status: number): Response {
  return jsonResponse({ error }, status)
}

class BadRequestError extends Error {}
class NotFoundError extends Error {}
