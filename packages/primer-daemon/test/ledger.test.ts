import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"

import { addCard, addNote, listCards, listNotes, openLedger } from "../src/ledger"
const TEST_TMP_ROOT = new URL(".tmp/", import.meta.url).pathname

function makeTempDir(prefix: string): string {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  return mkdtempSync(join(TEST_TMP_ROOT, prefix))
}


describe("ledger", () => {
  test("openLedger creates parent dirs and is idempotent", () => {
    const root = makeTempDir("primer-ledger-")
    try {
      const ledgerPath = join(root, "nested", "daemon-ledger.sqlite")
      expect(existsSync(dirname(ledgerPath))).toBe(false)

      const first = openLedger(ledgerPath)
      try {
        expect(existsSync(dirname(ledgerPath))).toBe(true)
        const tables = first
          .query<{ name: string }, []>(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table' AND name IN ('notes', 'note_sources', 'card_candidates')
             ORDER BY name`,
          )
          .all()
          .map((row) => row.name)
        expect(tables).toEqual(["card_candidates", "note_sources", "notes"])
        addNote(first, {
          question: "What was I reading about ledgers?",
          body: "SQLite write-back ledger notes.",
          sources: [{ ref: "browser:tab_entries:1" }],
        })
      } finally {
        first.close()
      }

      const second = openLedger(ledgerPath)
      try {
        const notes = listNotes(second)
        expect(notes).toHaveLength(1)
        expect(notes[0]?.question).toBe("What was I reading about ledgers?")
      } finally {
        second.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("addNote round-trips sources and lists newest first", () => {
    const root = makeTempDir("primer-ledger-")
    try {
      const db = openLedger(join(root, "ledger.sqlite"))
      try {
        const older = addNote(db, {
          question: "older question",
          body: "older body",
          sources: [{ ref: "reader:annotations:1", title: "Older annotation" }],
        })
        const newer = addNote(db, {
          question: "newer question",
          body: "newer body",
          sources: [
            { ref: "browser:tab_entries:2", url: "https://example.com/ledger", title: "Ledger article" },
            { ref: "twitter:tweets:3", url: "https://x.example/t/3", title: "Ledger thread" },
          ],
        })

        const notes = listNotes(db)
        expect(notes.map((note) => note.id)).toEqual([newer.id, older.id])
        expect(notes[0]).toMatchObject({
          id: newer.id,
          question: "newer question",
          body: "newer body",
          sources: [
            { ref: "browser:tab_entries:2", url: "https://example.com/ledger", title: "Ledger article" },
            { ref: "twitter:tweets:3", url: "https://x.example/t/3", title: "Ledger thread" },
          ],
        })
      } finally {
        db.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("addCard round-trips with candidate default status", () => {
    const root = makeTempDir("primer-ledger-")
    try {
      const db = openLedger(join(root, "ledger.sqlite"))
      try {
        const inserted = addCard(db, {
          front: "What should own write-back state?",
          back: "Only the ledger DB.",
          sourceRef: "browser:tab_entries:4",
          url: "https://example.com/writeback",
        })

        const cards = listCards(db)
        expect(cards).toHaveLength(1)
        expect(cards[0]).toMatchObject({
          id: inserted.id,
          front: "What should own write-back state?",
          back: "Only the ledger DB.",
          sourceRef: "browser:tab_entries:4",
          url: "https://example.com/writeback",
          status: "candidate",
        })
      } finally {
        db.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("note sources stay with their notes and cascade on delete", () => {
    const root = makeTempDir("primer-ledger-")
    try {
      const db = openLedger(join(root, "ledger.sqlite"))
      try {
        const first = addNote(db, {
          question: "browser note",
          body: "browser body",
          sources: [{ ref: "browser:tab_entries:10", url: "https://example.com/browser" }],
        })
        const second = addNote(db, {
          question: "reader note",
          body: "reader body",
          sources: [
            { ref: "reader:annotations:20", title: "Reader note" },
            { ref: "twitter:tweets:21", title: "Related tweet" },
          ],
        })

        const notes = listNotes(db)
        const firstNote = notes.find((note) => note.id === first.id)
        const secondNote = notes.find((note) => note.id === second.id)
        expect(firstNote?.sources.map((source) => source.ref)).toEqual(["browser:tab_entries:10"])
        expect(secondNote?.sources.map((source) => source.ref)).toEqual(["reader:annotations:20", "twitter:tweets:21"])

        db.query<Record<string, never>, [number]>("DELETE FROM notes WHERE id = ?").run(first.id)
        const remaining = listNotes(db)
        const orphanCount = db
          .query<{ count: number }, [number]>("SELECT count(*) AS count FROM note_sources WHERE note_id = ?")
          .get(first.id)
        expect(remaining.map((note) => note.id)).toEqual([second.id])
        expect(orphanCount?.count).toBe(0)
      } finally {
        db.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
