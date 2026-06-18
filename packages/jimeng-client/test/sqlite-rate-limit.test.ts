import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createJimengSqliteRateLimiter, type JimengSqliteRateLimiter } from "../src/sqlite-rate-limit"

describe("Jimeng SQLite rate limiter", () => {
  test("allows events up to the sliding window limit", () => {
    const fixture = createFixture()
    try {
      const first = fixture.limiter.acquireSlidingWindow({
        accountKey: "account-1",
        sessionHash: "session-a",
        operation: "submit",
        maxEvents: 2,
        windowMs: 1_000,
      })
      const second = fixture.limiter.acquireSlidingWindow({
        accountKey: "account-1",
        sessionHash: "session-a",
        operation: "submit",
        maxEvents: 2,
        windowMs: 1_000,
      })

      expect(first.allowed).toBe(true)
      expect(first.remaining).toBe(1)
      expect(second.allowed).toBe(true)
      expect(second.remaining).toBe(0)
    } finally {
      fixture.dispose()
    }
  })

  test("denies within the window and recovers with an injected clock", () => {
    const fixture = createFixture()
    try {
      const input = {
        accountKey: "account-1",
        sessionHash: "session-a",
        operation: "submit" as const,
        maxEvents: 2,
        windowMs: 1_000,
      }

      expect(fixture.limiter.acquireSlidingWindow(input).allowed).toBe(true)
      fixture.advance(100)
      expect(fixture.limiter.acquireSlidingWindow(input).allowed).toBe(true)
      fixture.advance(100)
      const denied = fixture.limiter.acquireSlidingWindow(input)

      expect(denied.allowed).toBe(false)
      expect(denied.remaining).toBe(0)
      expect(denied.retryAfterMs).toBe(800)
      expect(denied.resetAtMs).toBe(1_000)

      fixture.advance(801)
      const recovered = fixture.limiter.acquireSlidingWindow(input)
      expect(recovered.allowed).toBe(true)
      expect(recovered.remaining).toBe(0)
    } finally {
      fixture.dispose()
    }
  })

  test("separates account, session, and operation keys", () => {
    const fixture = createFixture()
    try {
      const base = {
        accountKey: "account-1",
        sessionHash: "session-a",
        operation: "submit" as const,
        maxEvents: 1,
        windowMs: 1_000,
      }

      expect(fixture.limiter.acquireSlidingWindow(base).allowed).toBe(true)
      expect(fixture.limiter.acquireSlidingWindow(base).allowed).toBe(false)
      expect(fixture.limiter.acquireSlidingWindow({ ...base, accountKey: "account-2" }).allowed).toBe(true)
      expect(fixture.limiter.acquireSlidingWindow({ ...base, sessionHash: "session-b" }).allowed).toBe(true)
      expect(fixture.limiter.acquireSlidingWindow({ ...base, operation: "poll" }).allowed).toBe(true)
    } finally {
      fixture.dispose()
    }
  })

  test("uses TTL cleanup and explicit release for concurrency leases", () => {
    const fixture = createFixture()
    try {
      const input = {
        accountKey: "account-1",
        sessionHash: "session-a",
        operation: "download" as const,
        maxConcurrent: 1,
        ttlMs: 500,
      }

      const first = fixture.limiter.acquireConcurrency({ ...input, leaseId: "lease-1" })
      expect(first.allowed).toBe(true)
      expect(first.lease?.leaseId).toBe("lease-1")

      const denied = fixture.limiter.acquireConcurrency({ ...input, leaseId: "lease-2" })
      expect(denied.allowed).toBe(false)
      expect(denied.inFlight).toBe(1)
      expect(denied.retryAfterMs).toBe(500)

      expect(first.lease?.release()).toBe(true)
      const afterRelease = fixture.limiter.acquireConcurrency({ ...input, leaseId: "lease-2" })
      expect(afterRelease.allowed).toBe(true)
      expect(afterRelease.lease?.release()).toBe(true)

      const ttlLease = fixture.limiter.acquireConcurrency({ ...input, leaseId: "lease-3" })
      expect(ttlLease.allowed).toBe(true)
      fixture.advance(501)
      const afterTtl = fixture.limiter.acquireConcurrency({ ...input, leaseId: "lease-4" })
      expect(afterTtl.allowed).toBe(true)
      expect(fixture.limiter.releaseConcurrency("lease-3")).toBe(false)
      expect(afterTtl.lease?.release()).toBe(true)
    } finally {
      fixture.dispose()
    }
  })
})

function createFixture(): {
  limiter: JimengSqliteRateLimiter
  advance: (ms: number) => void
  dispose: () => void
} {
  const dir = mkdtempSync(path.join(tmpdir(), "jimeng-sqlite-rate-limit-"))
  let now = 0
  const limiter = createJimengSqliteRateLimiter({
    path: path.join(dir, "rate-limit.sqlite"),
    nowMs: () => now,
  })

  return {
    limiter,
    advance: (ms: number) => {
      now += ms
    },
    dispose: () => {
      limiter.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
