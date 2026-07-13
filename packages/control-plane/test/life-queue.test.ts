import { join } from "node:path"

import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"

import { openQueueStore, QueueStore } from "../src/life-queue"
import { QueueItemSchema, type QueueItem } from "../src/life-queue-schema"
import { scanAbandonedSessions } from "../src/life-queue-scanner"

const tmpDir = join(import.meta.dir, ".tmp")
const fixtureDir = join(import.meta.dir, "fixtures", "life-queue")

const schemaFixture: QueueItem = {
  id: "queue-1",
  title: "Resume the deployment investigation",
  intent: "Finish the interrupted deployment diagnosis.",
  priority: "p1",
  source: "session-scan",
  contextPacketPath: "/tmp/session.jsonl",
  status: "paused",
  owningAgent: null,
  resumeRef: "session-1",
  createdAt: 1_000,
  updatedAt: 1_500,
}

test("queue item schema round-trips every durable field", () => {
  const encoded = Schema.encodeSync(QueueItemSchema)(schemaFixture)
  expect(Schema.decodeUnknownSync(QueueItemSchema)(encoded)).toEqual(schemaFixture)
})

test("queue enforces lifecycle transitions and persists timestamps", async () => {
  const dbPath = join(tmpDir, `life-queue-states-${crypto.randomUUID()}.sqlite`)
  const program = Effect.gen(function* () {
    const store = yield* QueueStore
    const added = yield* store.add({
      id: "manual-1",
      title: "Pursue refund",
      intent: "Continue until resolved.",
      priority: "p0",
      source: "manual",
      contextPacketPath: "/private/refund.packet",
      createdAt: 1_000,
    })
    expect(added.inserted).toBe(true)
    expect(added.item.status).toBe("inbox")

    const active = yield* store.transition("manual-1", "active", 2_000)
    expect(active.status).toBe("active")
    expect(active.updatedAt).toBe(2_000)
    expect((yield* store.transition("manual-1", "paused", 3_000)).status).toBe("paused")
    expect((yield* store.transition("manual-1", "active", 4_000)).status).toBe("active")
    expect((yield* store.transition("manual-1", "done", 5_000)).status).toBe("done")

    expect((yield* Effect.exit(store.transition("manual-1", "active", 6_000)))._tag).toBe("Failure")
  })
  await Effect.runPromise(program.pipe(Effect.provide(openQueueStore(dbPath))))
})

test("abandoned session intake is terminal-aware, title-bounded, and idempotent", async () => {
  const dbPath = join(tmpDir, `life-queue-scan-${crypto.randomUUID()}.sqlite`)
  const now = Date.parse("2026-07-10T00:00:00.000Z")
  const program = Effect.gen(function* () {
    const first = yield* scanAbandonedSessions({ sessionsDir: fixtureDir, now })
    expect(first.scanned).toBe(3)
    expect(first.abandoned).toBe(1)
    expect(first.inserted).toBe(1)
    expect(first.skipped).toBe(0)
    expect(first.items[0]?.item.resumeRef).toBe("abandoned-session")
    expect(Array.from(first.items[0]?.item.title ?? "").length).toBe(80)
    expect(first.items[0]?.item.title.endsWith("…")).toBe(true)

    const second = yield* scanAbandonedSessions({ sessionsDir: fixtureDir, now })
    expect(second.inserted).toBe(0)
    expect(second.ignored).toBe(1)

    const store = yield* QueueStore
    const rows = yield* store.list({ source: "session-scan" })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("paused")
  })
  await Effect.runPromise(program.pipe(Effect.provide(openQueueStore(dbPath))))
})
