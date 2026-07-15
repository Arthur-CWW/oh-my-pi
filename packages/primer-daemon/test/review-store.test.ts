import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import { handleReaderApi } from "../src/reader-api"
import { resolveDaemonPaths, type DaemonPaths } from "../src/paths"
import {
  createReadingDoc,
  createReadingMark,
  ensureReadingTables,
  setQueueItemPriority,
  type CreatedReadingMark,
} from "../src/reading-store"
import { buildReviewSession, gradeReviewItem } from "../src/review-store"

let nextFixtureId = 0

describe("review scheduler store", () => {
  test("adds the priority migration idempotently", () => {
    const db = new Database(":memory:")
    try {
      db.exec(`
CREATE TABLE queue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'new',
  lookup_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`)
      ensureReadingTables(db)
      ensureReadingTables(db)
      const columns = db.query<{ name: string }, []>("PRAGMA table_info(queue_items)").all()
      expect(columns.filter((column) => column.name === "priority")).toHaveLength(1)
      expect(db.query<{ name: string }, []>("PRAGMA index_list(queue_items)").all().some((index) => index.name === "queue_items_new_intro_idx")).toBe(true)
    } finally {
      db.close()
    }
  })

  test("orders NEW items by priority and creation time", () => {
    withReadingDb((db) => {
      const first = markWord(db, "猫")
      const second = markWord(db, "狗")
      const third = markWord(db, "鸟")
      setQueueItemPriority(db, first.queueItem.id, 2)
      setQueueItemPriority(db, second.queueItem.id, 4)
      setQueueItemPriority(db, third.queueItem.id, 4)
      expect(buildReviewSession(db, 10).map((item) => item.word)).toEqual(["狗", "鸟", "猫"])
    })
  })

  test("puts due items ahead of NEW items regardless of priority", () => {
    withReadingDb((db) => {
      const due = markWord(db, "甲")
      const fresh = markWord(db, "乙")
      setQueueItemPriority(db, fresh.queueItem.id, 100)
      expect(gradeReviewItem(db, due.queueItem.id, "good")?.state).toBe("Learning")
      db.query("UPDATE review_state SET due = ? WHERE item_id = ?").run("2000-01-01T00:00:00.000Z", due.queueItem.id)
      const session = buildReviewSession(db, 10)
      expect(session.map((item) => item.phase)).toEqual(["due", "new"])
      expect(session[0]?.word).toBe("甲")
    })
  })

  test("separates NEW items sharing a Han character when possible", () => {
    withReadingDb((db) => {
      const first = markWord(db, "中国")
      const conflicting = markWord(db, "国人")
      const separated = markWord(db, "学习")
      setQueueItemPriority(db, first.queueItem.id, 3)
      setQueueItemPriority(db, conflicting.queueItem.id, 2)
      setQueueItemPriority(db, separated.queueItem.id, 1)
      expect(buildReviewSession(db, 10).map((item) => item.word)).toEqual(["中国", "学习", "国人"])
    })
  })

  test("grades with FSRS, appends versioned events, and preserves event history", () => {
    withReadingDb((db) => {
      const mark = markWord(db, "记")
      const first = gradeReviewItem(db, mark.queueItem.id, "good")
      const second = gradeReviewItem(db, mark.queueItem.id, "good")
      expect(first?.queueItemId).toBe(mark.queueItem.id)
      expect(first?.state).toBe("Learning")
      expect(second?.state).toBe("Review")
      expect(second?.due && first?.due && second.due > first.due).toBe(true)
      expect(db.query("SELECT status FROM queue_items WHERE id = ?").get(mark.queueItem.id)).toEqual({ status: "keep" })
      const events = db
        .query<{ grade: string; prior_state_version: number; derived_state_version: number }, [number]>(
          "SELECT grade, prior_state_version, derived_state_version FROM review_events WHERE item_id = ? ORDER BY id ASC",
        )
        .all(mark.queueItem.id)
      expect(events).toEqual([
        { grade: "good", prior_state_version: 0, derived_state_version: 1 },
        { grade: "good", prior_state_version: 1, derived_state_version: 2 },
      ])
    })
  })

  test("rejects bad review grades and priorities at the HTTP boundary", async () => {
    const paths = makePaths()
    const ledger = new Database(paths.ledgerDb)
    try {
      const badGrade = await handleReaderApi(
        new Request("http://review.test/api/review/grade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ queueItemId: 1, grade: "maybe" }),
        }),
        paths,
      )
      const badPriority = await handleReaderApi(
        new Request("http://review.test/api/queue/1/priority", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priority: -1 }),
        }),
        paths,
      )
      expect(badGrade?.status).toBe(400)
      expect(badPriority?.status).toBe(400)
      const created = createReadingDoc(ledger, { title: "端点", text: "端点" })
      const mark = createReadingMark(ledger, {
        docId: created.id,
        paragraphIdx: 0,
        start: 0,
        end: 2,
        surface: "端点",
        sentence: "端点",
      })
      const priority = await handleReaderApi(
        new Request(`http://review.test/api/queue/${mark.queueItem.id}/priority`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priority: 7 }),
        }),
        paths,
      )
      const session = await handleReaderApi(new Request("http://review.test/api/review/session?limit=1"), paths)
      const grade = await handleReaderApi(
        new Request("http://review.test/api/review/grade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ queueItemId: mark.queueItem.id, grade: "good" }),
        }),
        paths,
      )
      expect(priority?.status).toBe(200)
      expect((await priority?.json()).priority).toBe(7)
      expect(session?.status).toBe(200)
      expect((await session?.json()).items[0].word).toBe("端点")
      expect(grade?.status).toBe(200)
      expect((await grade?.json()).state).toBe("Learning")
    } finally {
      ledger.close()
    }
  })
})

function withReadingDb(run: (db: Database) => void): void {
  const db = new Database(":memory:")
  try {
    run(db)
  } finally {
    db.close()
  }
}

function markWord(db: Database, word: string): CreatedReadingMark {
  const doc = createReadingDoc(db, { title: word, text: word })
  return createReadingMark(db, {
    docId: doc.id,
    paragraphIdx: 0,
    start: 0,
    end: word.length,
    surface: word,
    sentence: word,
  })
}

function makePaths(): DaemonPaths {
  const id = nextFixtureId
  nextFixtureId += 1
  const suffix = `review-api-${id}`
  return resolveDaemonPaths({
    PRIMER_BROWSER_DB: `file:${suffix}-browser?mode=memory&cache=shared`,
    PRIMER_TWITTER_DB: `file:${suffix}-twitter?mode=memory&cache=shared`,
    PRIMER_READER_DB: `file:${suffix}-reader?mode=memory&cache=shared`,
    PRIMER_CARDS_DB: `file:${suffix}-cards?mode=memory&cache=shared`,
    PRIMER_READER_SITE: ".",
    PRIMER_LEDGER_DB: `file:${suffix}-ledger?mode=memory&cache=shared`,
    PRIMER_CEDICT_DB: `file:${suffix}-cedict?mode=memory&cache=shared`,
  })
}
