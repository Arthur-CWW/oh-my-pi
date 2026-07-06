import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import {
  createReadingDoc,
  createReadingMark,
  deleteReadingMark,
  getReadingDoc,
  listQueueItems,
  setQueueItemStatus,
} from "../src/reading-store"


function withReadingDb(run: (db: Database) => void): void {
  const db = new Database(":memory:")
  try {
    run(db)
  } finally {
    db.close()
  }
}

describe("reading store", () => {
  test("splits documents into trimmed paragraphs and lists marks", () => {
    withReadingDb((db) => {
      const created = createReadingDoc(db, {
        title: "短文",
        text: " 第一段。\n\n第二段。\n第三段。\n",
      })

      expect(created.paragraphCount).toBe(3)
      const doc = getReadingDoc(db, created.id)
      expect(doc?.paragraphs).toEqual(["第一段。", "第二段。", "第三段。"])
      expect(doc?.marks).toEqual([])
    })
  })

  test("records every mark while deduping queued words and undoing both branches", () => {
    withReadingDb((db) => {
      const doc = createReadingDoc(db, {
        title: "中国故事",
        text: "我爱中国。\n中国人很多。",
      })

      const first = createReadingMark(db, {
        docId: doc.id,
        paragraphIdx: 0,
        start: 2,
        end: 4,
        surface: "中国",
        sentence: "我爱中国。",
        pinyin: "zhōngguó",
        gloss: "China",
      })
      const second = createReadingMark(db, {
        docId: doc.id,
        paragraphIdx: 1,
        start: 0,
        end: 2,
        surface: "中国",
        sentence: "中国人很多。",
        pinyin: "zhōngguó",
        gloss: "China",
      })

      expect(first.queueItem.id).toBe(second.queueItem.id)
      expect(second.queueItem.lookupCount).toBe(2)
      expect(second.queueItem.status).toBe("new")
      expect(getReadingDoc(db, doc.id)?.marks.map((mark) => mark.id)).toEqual([first.markId, second.markId])

      expect(deleteReadingMark(db, first.markId)).toBe(true)
      const afterFirstUndo = listQueueItems(db, "all", 10)
      expect(afterFirstUndo).toHaveLength(1)
      expect(afterFirstUndo[0].lookupCount).toBe(1)
      expect(afterFirstUndo[0].provenance?.sentence).toBe("中国人很多。")

      expect(deleteReadingMark(db, second.markId)).toBe(true)
      expect(listQueueItems(db, "all", 10)).toEqual([])
    })
  })

  test("preserves status while repeated lookups increment count", () => {
    withReadingDb((db) => {
      const doc = createReadingDoc(db, { title: "学生", text: "学生学习。\n学生读书。" })
      const first = createReadingMark(db, {
        docId: doc.id,
        paragraphIdx: 0,
        start: 0,
        end: 2,
        surface: "学生",
        sentence: "学生学习。",
      })
      const kept = setQueueItemStatus(db, first.queueItem.id, "keep")
      expect(kept?.status).toBe("keep")

      const second = createReadingMark(db, {
        docId: doc.id,
        paragraphIdx: 1,
        start: 0,
        end: 2,
        surface: "学生",
        sentence: "学生读书。",
      })
      expect(second.queueItem.lookupCount).toBe(2)
      expect(second.queueItem.status).toBe("keep")
      expect(listQueueItems(db, "keep", 10).map((item) => item.word)).toEqual(["学生"])

      const discarded = setQueueItemStatus(db, first.queueItem.id, "discarded")
      expect(discarded?.status).toBe("discarded")
      expect(listQueueItems(db, "discarded", 10)[0].provenance?.docTitle).toBe("学生")
    })
  })
})
