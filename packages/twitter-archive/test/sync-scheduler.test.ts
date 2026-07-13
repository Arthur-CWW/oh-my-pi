import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSyncPolicy } from "../src/sync-policy"
import { runSyncTick } from "../src/sync-scheduler"
import { acquireMirrorToken, consumeTokenBucket, refillTokenBucket } from "../src/sync-token-bucket"
import { readFixture } from "./fixtures/read-fixture"

const mirror = { url: "https://nitter.example", capacity: 2, refillPerHour: 1 }

describe("sync token bucket", () => {
  test("refills continuously, caps at capacity, and computes retry time", () => {
    const halfFull = refillTokenBucket({ tokens: 0, refilledAtMs: 0 }, mirror, 30 * 60_000)
    expect(halfFull.tokens).toBeCloseTo(0.5)
    const denied = consumeTokenBucket(halfFull, mirror, 30 * 60_000)
    expect(denied.granted).toBeFalse()
    expect(denied.retryAtMs).toBe(60 * 60_000)
    const capped = refillTokenBucket(halfFull, mirror, 10 * 60 * 60_000)
    expect(capped.tokens).toBe(2)
  })

  test("shares one persistent mirror bucket across corpus and news lanes", () => {
    const database = new Database(":memory:")
    const oneTokenMirror = { ...mirror, capacity: 1 }
    const corpus = acquireMirrorToken(database, oneTokenMirror, { handle: "pleometric", lane: "corpus" }, 0)
    const news = acquireMirrorToken(database, oneTokenMirror, { handle: "thsottiaux", lane: "news" }, 0)
    expect(corpus.granted).toBeTrue()
    expect(news.granted).toBeFalse()
    const rows = database.query("SELECT lane,granted FROM sync_bucket_events ORDER BY id").all()
    expect(rows).toEqual([{ lane: "corpus", granted: 1 }, { lane: "news", granted: 0 }])
    database.close()
  })
})

describe("sync tiers", () => {
  test("live config assigns exhaustive corpus and recent-only news tiers", async () => {
    const policy = await loadSyncPolicy()
    const tiers = Object.fromEntries(policy.accounts.map((account) => [account.handle, account.tier]))
    expect(tiers.pleometric).toBe("corpus")
    expect(tiers.teortaxestex).toBe("corpus")
    expect(tiers.thsottiaux).toBe("news")
    expect(policy.tiers.corpus.cadenceMinutes).toBeGreaterThanOrEqual(1440)
    expect(policy.tiers.news.pagesPerTick).toBe(1)
  })

  test("news tick fetches one recent timeline page without thread or media downloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "twitter-news-tier-"))
    const dbPath = join(directory, "archive.sqlite")
    const policyPath = join(directory, "policy.json")
    const body = await readFixture("nitter-timeline-media-quote-retweet.html")
    const fetched: string[] = []
    await Bun.write(policyPath, JSON.stringify({
      version: 1,
      maxAccountsPerTick: 1,
      delayMs: 0,
      jitterMs: 0,
      mirrors: [{ url: "https://nitter.example", capacity: 1, refillPerHour: 1 }],
      tiers: {
        corpus: { cadenceMinutes: 1440, pagesPerTick: 1 },
        news: { cadenceMinutes: 60, pagesPerTick: 1 },
      },
      accounts: [{ handle: "thsottiaux", tier: "news" }],
    }))
    const fixtureFetch: typeof fetch = Object.assign(async (input: URL | RequestInfo) => {
      fetched.push(String(input))
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } })
    }, fetch)
    try {
      const report = await runSyncTick({
        policyPath,
        dbPath,
        now: new Date("2026-07-13T06:00:00.000Z"),
        fetch: fixtureFetch,
      })
      expect(report.synced).toBe(1)
      expect(report.accounts[0]?.tier).toBe("news")
      expect(report.accounts[0]?.detail).toContain("recent-only")
      expect(fetched).toHaveLength(1)
      expect(fetched[0]).toBe("https://nitter.example/thsottiaux")
      expect(fetched.some((url) => url.includes("/status/") || url.includes("fxtwitter"))).toBeFalse()
      expect(await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: directory }))).not.toContain("media")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
