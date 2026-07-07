import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { Database } from "bun:sqlite"
import { Schema } from "effect"

import { addCard, listCards, openLedger } from "../src/ledger"
import { resolveDaemonPaths } from "../src/paths"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..")
const REPO_ROOT = resolve(PACKAGE_DIR, "..", "..")
const DEFAULT_GENERATION_STORE_PATH = resolve(REPO_ROOT, "data/primer/generation-store.sqlite")
const DEFAULT_TIER = "T2"
const LEDGER_SCAN_LIMIT = 1_000_000

export interface PromoteHskCardsOptions {
  generationStorePath?: string
  ledgerPath?: string
  tier?: string
  limit?: number
  dryRun?: boolean
}

export interface PromoteHskCardsWithDbsOptions {
  tier?: string
  limit?: number
  dryRun?: boolean
}

export interface PromotedHskCandidate {
  batchId: string
  word: string
  cardType: string
  front: string
  back: string
  sourceRef: string
}

export interface PromoteHskCardsResult {
  selected: number
  inserted: number
  skipped: number
  dryRun: boolean
  candidates: PromotedHskCandidate[]
}

const PositiveLimit = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const LimitOptionSchema = Schema.Struct({ limit: PositiveLimit })
const HskCardRowSchema = Schema.Struct({
  batch_id: Schema.String,
  word: Schema.String,
  card_type: Schema.String,
  front: Schema.String,
  back: Schema.String,
})

type HskCardRow = Schema.Schema.Type<typeof HskCardRowSchema>

export function promoteHskCards(options: PromoteHskCardsOptions = {}): PromoteHskCardsResult {
  const generationStorePath = resolve(options.generationStorePath ?? DEFAULT_GENERATION_STORE_PATH)
  const ledgerPath = resolve(options.ledgerPath ?? resolveDaemonPaths().ledgerDb)
  const dryRun = options.dryRun === true

  if (!existsSync(generationStorePath)) throw new Error(`generation store not found: ${generationStorePath}`)

  const generationDb = new Database(generationStorePath, { readonly: true })
  const ledgerDb = dryRun && !existsSync(ledgerPath) ? null : dryRun ? new Database(ledgerPath, { readonly: true }) : openLedger(ledgerPath)
  try {
    return promoteHskCardsWithDbs(generationDb, ledgerDb, {
      tier: options.tier,
      limit: options.limit,
      dryRun,
    })
  } finally {
    ledgerDb?.close()
    generationDb.close()
  }
}

export function promoteHskCardsWithDbs(
  generationDb: Database,
  ledgerDb: Database | null,
  options: PromoteHskCardsWithDbsOptions = {},
): PromoteHskCardsResult {
  const tier = options.tier ?? DEFAULT_TIER
  const limit = options.limit === undefined ? undefined : Schema.decodeUnknownSync(PositiveLimit)(options.limit)
  const dryRun = options.dryRun === true
  const rows = readHskRows(generationDb, tier, limit)
  const promotedRefs = new Set(
    ledgerDb === null ? [] : listCards(ledgerDb, LEDGER_SCAN_LIMIT).flatMap((card) => (card.sourceRef === null ? [] : [card.sourceRef])),
  )
  const seenRefs = new Set<string>()
  const candidates: PromotedHskCandidate[] = []
  let skipped = 0

  for (const row of rows) {
    const sourceRef = hskSourceRef(row)
    if (promotedRefs.has(sourceRef) || seenRefs.has(sourceRef)) {
      skipped += 1
      continue
    }
    seenRefs.add(sourceRef)
    const candidate = {
      batchId: row.batch_id,
      word: row.word,
      cardType: row.card_type,
      front: row.front,
      back: row.back,
      sourceRef,
    }
    candidates.push(candidate)
    if (!dryRun && ledgerDb !== null) addCard(ledgerDb, { front: row.front, back: row.back, sourceRef })
  }

  return {
    selected: rows.length,
    inserted: dryRun ? 0 : candidates.length,
    skipped,
    dryRun,
    candidates,
  }
}

export function formatPromoteReport(result: PromoteHskCardsResult): string {
  const action = result.dryRun ? "would insert" : "inserted"
  const lines = result.candidates.map((candidate) => `${action} ${candidate.sourceRef} ${JSON.stringify(candidate.front)}`)
  lines.push(
    `selected=${result.selected} inserted=${result.inserted} skipped=${result.skipped} dryRun=${result.dryRun ? "true" : "false"}`,
  )
  return lines.join("\n")
}

function readHskRows(db: Database, tier: string, limit: number | undefined): HskCardRow[] {
  if (limit === undefined) {
    return db
      .query<HskCardRow, [string]>(
        `SELECT batch_id, word, card_type, front, back
         FROM hsk_cards
         WHERE tier = ?
         ORDER BY batch_id, word, card_type, front`,
      )
      .all(tier)
      .map((row) => Schema.decodeUnknownSync(HskCardRowSchema)(row))
  }

  const limitRow = Schema.decodeUnknownSync(LimitOptionSchema)({ limit })
  return db
    .query<HskCardRow, [string, number]>(
      `SELECT batch_id, word, card_type, front, back
       FROM hsk_cards
       WHERE tier = ?
       ORDER BY batch_id, word, card_type, front
       LIMIT ?`,
    )
    .all(tier, limitRow.limit)
    .map((row) => Schema.decodeUnknownSync(HskCardRowSchema)(row))
}

function hskSourceRef(row: HskCardRow): string {
  const frontHash = createHash("sha1").update(row.front).digest("hex").slice(0, 12)
  return `gen:hsk_cards:${row.batch_id}:${row.word}:${row.card_type}:${frontHash}`
}

function parseArgs(argv: string[]): PromoteHskCardsOptions {
  const options: PromoteHskCardsOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--tier") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--tier requires a value")
      options.tier = value
      index += 1
      continue
    }
    if (arg === "--limit") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--limit requires a value")
      options.limit = Schema.decodeUnknownSync(PositiveLimit)(Number(value))
      index += 1
      continue
    }
    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }
    if (arg === "--generation-store") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--generation-store requires a path")
      options.generationStorePath = value
      index += 1
      continue
    }
    if (arg === "--ledger") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--ledger requires a path")
      options.ledgerPath = value
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

if (import.meta.main) {
  try {
    console.log(formatPromoteReport(promoteHskCards(parseArgs(process.argv.slice(2)))))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
