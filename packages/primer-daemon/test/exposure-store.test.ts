import { describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { Database } from "bun:sqlite"

import { startDashboard } from "../src/dashboard"
import { addExposureEvents, exposureStats } from "../src/exposure-store"
import { resolveDaemonPaths } from "../src/paths"

function withDb(run: (db: Database) => void): void {
  const db = new Database(":memory:")
  try {
    run(db)
  } finally {
    db.close()
  }
}

describe("exposure store", () => {
  test("inserts a deduped batch and reports its count without touching review tables", () => {
    withDb((db) => {
      db.exec(`
        CREATE TABLE review_state (id INTEGER PRIMARY KEY, due TEXT NOT NULL);
        CREATE TABLE review_events (id INTEGER PRIMARY KEY, grade TEXT NOT NULL);
      `)
      db.query("INSERT INTO review_state (id, due) VALUES (?, ?)").run(1, "2026-07-16T00:00:00.000Z")
      db.query("INSERT INTO review_events (id, grade) VALUES (?, ?)").run(1, "good")

      const result = addExposureEvents(db, [
        { docId: 7, paragraphIdx: 2, word: "学习", source: "read" },
        { docId: 7, paragraphIdx: 2, word: "学习", source: "read" },
        { docId: 7, paragraphIdx: 2, word: "学习", source: "media" },
        { docId: 7, paragraphIdx: 3, word: "学习", source: "read" },
      ])

      expect(result).toEqual({ count: 3 })
      expect(exposureStats(db)).toEqual({ count: 3 })
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM review_state").get()?.count).toBe(1)
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM review_events").get()?.count).toBe(1)
    })
  })

  test("rejects batches over the 200-event cap", () => {
    withDb((db) => {
      const events = Array.from({ length: 201 }, (_, index) => ({
        docId: 1,
        paragraphIdx: index,
        word: `词${index}`,
        source: "read" as const,
      }))

      expect(() => addExposureEvents(db, events)).toThrow("exposure batch exceeds 200 events")
      expect(exposureStats(db)).toEqual({ count: 0 })
    })
  })

  test("serves the batch and stats endpoints", async () => {
    const ledgerPath = new URL(`.tmp/exposure-route-${Date.now()}-${Math.random()}.sqlite`, import.meta.url).pathname
    const server = startDashboard({
      port: 0,
      paths: resolveDaemonPaths({ PRIMER_LEDGER_DB: ledgerPath }),
    })
    try {
      const baseUrl = `http://localhost:${server.port}`
      const insert = await fetch(`${baseUrl}/api/exposure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: [
            { docId: 3, paragraphIdx: 1, word: "阅读", source: "read" },
            { docId: 3, paragraphIdx: 1, word: "阅读", source: "read" },
          ],
        }),
      })
      expect(insert.status).toBe(200)
      expect(await insert.json()).toEqual({ count: 1 })

      const stats = await fetch(`${baseUrl}/api/exposure/stats`)
      expect(stats.status).toBe(200)
      expect(await stats.json()).toEqual({ count: 1 })
    } finally {
      await server.stop(true)
      rmSync(ledgerPath, { force: true })
    }
  })
})
