import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import { addCard, openLedger, setCardStatus } from "../src/ledger"
import { createReadingDoc, createReadingMark, ensureReadingTables, setQueueItemPriority } from "../src/reading-store"
import {
  CardCandidateNotApprovedError,
  CardCandidateNotFoundError,
  buildReviewSession,
  enrollCardCandidate,
  gradeReviewItem,
} from "../src/review-store"

describe("card review enrollment", () => {
  test("requires approval, does not auto-enroll, and is idempotent", () => {
    const db = openLedger(":memory:")
    ensureReadingTables(db)
    try {
      const card = addCard(db, { front: "前", back: "后" })
      expect(() => enrollCardCandidate(db, card.id)).toThrow(CardCandidateNotApprovedError)
      expect(() => enrollCardCandidate(db, 99)).toThrow(CardCandidateNotFoundError)
      setCardStatus(db, card.id, "rejected")
      expect(() => enrollCardCandidate(db, card.id)).toThrow(CardCandidateNotApprovedError)
      setCardStatus(db, card.id, "approved")
      expect(db.query("SELECT COUNT(*) AS count FROM review_state").get()).toEqual({ count: 0 })

      const first = enrollCardCandidate(db, card.id)
      const second = enrollCardCandidate(db, undefined, card.id)
      expect(second).toEqual(first)
      expect(db.query("SELECT COUNT(*) AS count FROM review_state WHERE item_kind = 'card_candidate'").get()).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  })

  test("mixes enrolled cards due-first, preserves queue priority, and grades card events", () => {
    const db = openLedger(":memory:")
    try {
      const card = addCard(db, { front: "卡片正面", back: "卡片背面" })
      setCardStatus(db, card.id, "approved")
      enrollCardCandidate(db, card.id)

      const doc = createReadingDoc(db, { title: "队列", text: "队列" })
      const mark = createReadingMark(db, {
        docId: doc.id,
        paragraphIdx: 0,
        start: 0,
        end: 2,
        surface: "队列",
        sentence: "队列",
      })
      setQueueItemPriority(db, mark.queueItem.id, 100)

      const session = buildReviewSession(db, 10)
      expect(session.map((item) => item.itemKind)).toEqual(["card_candidate", "queue_item"])
      expect(session[0]).toMatchObject({ queueItemId: card.id, front: "卡片正面", back: "卡片背面", phase: "due" })
      expect(session[1]).toMatchObject({ queueItemId: mark.queueItem.id, word: "队列", priority: 100, phase: "new" })

      gradeReviewItem(db, card.id, "good", "card_candidate")
      gradeReviewItem(db, { itemKind: "card_candidate", itemId: card.id }, "good")
      expect(
        db
          .query<{ item_kind: string; prior_state_version: number; derived_state_version: number }, [number]>(
            "SELECT item_kind, prior_state_version, derived_state_version FROM review_events WHERE item_id = ? ORDER BY id",
          )
          .all(card.id),
      ).toEqual([
        { item_kind: "card_candidate", prior_state_version: 0, derived_state_version: 1 },
        { item_kind: "card_candidate", prior_state_version: 1, derived_state_version: 2 },
      ])
    } finally {
      db.close()
    }
  })
})
