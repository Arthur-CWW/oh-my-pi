import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import { ingestGenerationWithDb, initializeGenerationStore } from "../scripts/ingest-generation"
import { promoteHskCardsWithDbs } from "../scripts/promote-hsk-cards"
import { listCards, openLedger } from "../src/ledger"

const FIXTURE_ROOT = new URL("fixtures/generation-staging/", import.meta.url).pathname
const EXPECTED_SOURCE_REF =
  "gen:hsk_cards:hsk-cards:streams/primer/hsk-cards/gen-2026-07-06/hsk5-fixture.json:将:disambiguation:00e1ec0e9156"

function readCards(db: Database) {
  return listCards(db, 100)
}

describe("promote HSK cards", () => {
  test("promotes staged T2 hsk_cards into ledger candidates idempotently", async () => {
    const generationDb = new Database(":memory:")
    const ledgerDb = openLedger(":memory:")
    try {
      initializeGenerationStore(generationDb)
      await ingestGenerationWithDb(generationDb, {
        rootDir: FIXTURE_ROOT,
        storePath: ":memory:",
        now: () => new Date("2026-07-07T00:00:00.000Z"),
      })

      const first = promoteHskCardsWithDbs(generationDb, ledgerDb)
      expect(first.selected).toBe(1)
      expect(first.inserted).toBe(1)
      expect(first.skipped).toBe(0)
      expect(first.dryRun).toBe(false)
      expect(first.candidates.map((candidate) => candidate.sourceRef)).toEqual([EXPECTED_SOURCE_REF])

      const cards = readCards(ledgerDb)
      expect(cards).toHaveLength(1)
      expect(cards[0]?.status).toBe("candidate")
      expect(cards[0]?.front).toBe("In 将军, which reading of 将 do you retrieve, and what role does it name?")
      expect(cards[0]?.back).toBe(
        "jiàng; it names a general/commander. Do not read it as 将 jiāng, the formal future marker.",
      )
      expect(cards[0]?.sourceRef).toBe(EXPECTED_SOURCE_REF)
      expect(cards[0]?.url).toBeNull()

      const second = promoteHskCardsWithDbs(generationDb, ledgerDb)
      expect(second.selected).toBe(1)
      expect(second.inserted).toBe(0)
      expect(second.skipped).toBe(1)
      expect(readCards(ledgerDb)).toHaveLength(1)
    } finally {
      ledgerDb.close()
      generationDb.close()
    }
  })

  test("dry-run reports candidates without writing ledger rows", async () => {
    const generationDb = new Database(":memory:")
    const ledgerDb = openLedger(":memory:")
    try {
      initializeGenerationStore(generationDb)
      await ingestGenerationWithDb(generationDb, {
        rootDir: FIXTURE_ROOT,
        storePath: ":memory:",
        now: () => new Date("2026-07-07T00:00:00.000Z"),
      })

      const result = promoteHskCardsWithDbs(generationDb, ledgerDb, { dryRun: true })
      expect(result.selected).toBe(1)
      expect(result.inserted).toBe(0)
      expect(result.skipped).toBe(0)
      expect(result.candidates.map((candidate) => candidate.sourceRef)).toEqual([EXPECTED_SOURCE_REF])
      expect(readCards(ledgerDb)).toHaveLength(0)
    } finally {
      ledgerDb.close()
      generationDb.close()
    }
  })
})
