import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import { addFeedback, addUiEvents, ensureFeedbackTables, listFeedback, listUiEvents, pipelineStats } from "../src/feedback-store"
import { ensureReadingTables } from "../src/reading-store"

function withDatabase(run: (db: Database) => void): void {
  const db = new Database(":memory:")
  try {
    run(db)
  } finally {
    db.close()
  }
}

describe("feedback telemetry store", () => {
  test("rejects a feedback verdict outside the contract", () => {
    withDatabase((db) => {
      expect(() => addFeedback(db, { surface: "reader", verdict: "bad" } as never)).toThrow()
      const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'feedback_events'").get()
      expect(row?.count ?? 0).toBe(1)
    })
  })

  test("inserts UI events as one batch and filters by kind", () => {
    withDatabase((db) => {
      const inserted = addUiEvents(db, [
        { kind: "route.view", payload: { route: "reader" } },
        { kind: "feedback.opened", payload: { surface: "review" } },
        { kind: "route.view" },
      ])
      expect(inserted).toBe(3)
      expect(listUiEvents(db, "route.view", 10)).toHaveLength(2)
      expect(listUiEvents(db, undefined, 10)).toHaveLength(3)
    })
  })

  test("returns pipeline stats from seeded reading and review tables", () => {
    withDatabase((db) => {
      ensureReadingTables(db)
      ensureFeedbackTables(db)
      const now = new Date().toISOString()
      db.query("INSERT INTO reading_docs (title, lang, created_at) VALUES (?, ?, ?)").run("Fixture", "zh", now)
      db.query("INSERT INTO reading_marks (doc_id, paragraph_idx, start, end, surface, sentence, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        1,
        0,
        0,
        2,
        "学习",
        "我学习中文。",
        "lookup",
        now,
      )
      db.query("INSERT INTO queue_items (id, mark_id, word, status, priority, lookup_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        1,
        1,
        "学习",
        "new",
        2,
        1,
        now,
        now,
      )
      db.query("INSERT INTO queue_items (id, word, status, priority, lookup_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        2,
        "中文",
        "keep",
        0,
        1,
        now,
        now,
      )
      db.query("INSERT INTO queue_items (id, word, status, priority, lookup_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        3,
        "已知",
        "known",
        0,
        1,
        now,
        now,
      )
      db.query("INSERT INTO queue_items (id, word, status, priority, lookup_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        4,
        "丢弃",
        "discarded",
        0,
        1,
        now,
        now,
      )
      db.query("INSERT INTO review_state (item_kind, item_id, due, stability, difficulty, state) VALUES (?, ?, ?, ?, ?, ?)").run(
        "queue_item",
        1,
        "2000-01-01T00:00:00.000Z",
        1,
        5,
        "Learning",
      )
      db.query("INSERT INTO review_state (item_kind, item_id, due, stability, difficulty, state) VALUES (?, ?, ?, ?, ?, ?)").run(
        "card_candidate",
        99,
        "2099-01-01T00:00:00.000Z",
        1,
        5,
        "New",
      )
      db.query("INSERT INTO review_events (item_kind, item_id, event_time, grade, prior_state_version, derived_state_version) VALUES (?, ?, ?, ?, ?, ?)").run(
        "queue_item",
        1,
        now,
        "good",
        0,
        1,
      )
      addFeedback(db, { surface: "review", verdict: "good", note: "clear" })

      expect(pipelineStats(db)).toEqual({
        docs: 1,
        marks: 1,
        queue: { new: 1, keep: 1, known: 1, discarded: 1 },
        priorityPushed: 1,
        enrolledQueue: 1,
        enrolledCards: 1,
        dueNow: 1,
        newAvailable: 1,
        reviewEvents: 1,
        feedbackCount: 1,
        enrichmentCount: 0,
      })
    })
  })

  test("tolerates a ledger without the optional enrichments table", () => {
    withDatabase((db) => {
      ensureReadingTables(db)
      expect(pipelineStats(db).enrichmentCount).toBe(0)
      expect(listFeedback(db)).toEqual([])
    })
  })
})
