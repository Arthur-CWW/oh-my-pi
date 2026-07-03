import { describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import { addCard, addNote, addProgress, listCards, listNotes, listProgress, openLedger, setCardStatus } from "../src/ledger"

const TEST_TMP_ROOT = new URL(".tmp/", import.meta.url).pathname

function ledgerPath(name: string): string {
  return join(TEST_TMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
}

function removeLedger(path: string): void {
  rmSync(path, { force: true })
  rmSync(`${path}-shm`, { force: true })
  rmSync(`${path}-wal`, { force: true })
}

describe("ledger", () => {
  test("openLedger initializes tables and is idempotent", () => {
    const path = ledgerPath("ledger-idempotent")
    removeLedger(path)
    expect(existsSync(path)).toBe(false)

    const first = openLedger(path)
    try {
      const tables = first
        .query<{ name: string }, []>(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table' AND name IN ('notes', 'note_sources', 'card_candidates', 'progress')
           ORDER BY name`,
        )
        .all()
        .map((row) => row.name)
      expect(tables).toEqual(["card_candidates", "note_sources", "notes", "progress"])
      addNote(first, {
        question: "What was I reading about ledgers?",
        body: "SQLite write-back ledger notes.",
        sources: [{ ref: "browser:tab_entries:1" }],
      })
    } finally {
      first.close()
    }

    const second = openLedger(path)
    try {
      const notes = listNotes(second)
      expect(notes).toHaveLength(1)
      expect(notes[0]?.question).toBe("What was I reading about ledgers?")
    } finally {
      second.close()
      removeLedger(path)
    }
  })

  test("addNote round-trips sources and lists newest first", () => {
    const path = ledgerPath("ledger-notes")
    const db = openLedger(path)
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
      removeLedger(path)
    }
  })

  test("addCard round-trips with candidate default status", () => {
    const path = ledgerPath("ledger-cards")
    const db = openLedger(path)
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
      removeLedger(path)
    }
  })

  test("note sources stay with their notes and cascade on delete", () => {
    const path = ledgerPath("ledger-cascade")
    const db = openLedger(path)
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
      removeLedger(path)
    }
  })

  test("setCardStatus flips status, persists, and returns null for unknown cards", () => {
    const path = ledgerPath("ledger-card-status")
    const db = openLedger(path)
    let insertedId = 0
    try {
      const inserted = addCard(db, {
        front: "Which cards reach the dashboard?",
        back: "Only ledger card candidates.",
      })
      insertedId = inserted.id

      const updated = setCardStatus(db, inserted.id, "approved")
      expect(updated).toMatchObject({ id: inserted.id, status: "approved" })
      expect(setCardStatus(db, inserted.id + 1000, "rejected")).toBeNull()
    } finally {
      db.close()
    }

    const reopened = openLedger(path)
    try {
      const cards = listCards(reopened)
      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({ id: insertedId, status: "approved" })
    } finally {
      reopened.close()
      removeLedger(path)
    }
  })

  test("addProgress round-trips refs and listProgress returns newest first", () => {
    const path = ledgerPath("ledger-progress")
    const db = openLedger(path)
    try {
      const older = addProgress(db, {
        kind: "note",
        title: "Older progress",
        body: "Started the ledger work.",
        refs: ["docs/qa/older.md"],
      })
      const newer = addProgress(db, {
        kind: "proof",
        title: "Newer progress",
        refs: ["browser:tab_entries:2", "reader:annotations:3"],
      })

      const progress = listProgress(db)
      expect(progress.map((row) => row.id)).toEqual([newer.id, older.id])
      expect(progress[0]).toMatchObject({
        id: newer.id,
        kind: "proof",
        title: "Newer progress",
        body: null,
        refs: ["browser:tab_entries:2", "reader:annotations:3"],
      })
      expect(progress[1]).toMatchObject({
        id: older.id,
        kind: "note",
        title: "Older progress",
        body: "Started the ledger work.",
        refs: ["docs/qa/older.md"],
      })
      expect(listProgress(db, 1).map((row) => row.id)).toEqual([newer.id])
    } finally {
      db.close()
      removeLedger(path)
    }
  })

  test("openLedger creates the progress table on a fresh path", () => {
    const path = ledgerPath("ledger-progress-fresh")
    removeLedger(path)
    expect(existsSync(path)).toBe(false)

    const db = openLedger(path)
    try {
      const table = db
        .query<{ name: string }, []>(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table' AND name = 'progress'`,
        )
        .get()
      expect(table?.name).toBe("progress")
      expect(listProgress(db)).toEqual([])
    } finally {
      db.close()
      removeLedger(path)
    }
  })
})
