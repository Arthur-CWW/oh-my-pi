import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { parsePublicNitter } from "@wirebabel/twitter-archive"
import { appendCandidateRows, FeedStateStore, syncFeeds } from "../src/engine"
import { classifierProfiles, type CandidateFact, type FeedItem } from "../src/model"

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("availability classifier", () => {
  test("extracts all matching terms and bounds the verbatim quote", () => {
    const item: FeedItem = {
      id: "tweet-1",
      observedAt: "2026-07-12T18:25:00.000Z",
      source: "thsottiaux",
      handle: "thsottiaux",
      text: `${"context ".repeat(40)}I reset everyone's Codex usage limits and removed the 5-hour limit for Plus subscriptions.`,
      url: "https://x.com/thsottiaux/status/tweet-1",
    }
    const candidate = classifierProfiles.availability?.(item)
    expect(candidate?.matchedTerms).toEqual(["reset", "limit", "5 hour", "subscription"])
    expect(candidate?.quote.length).toBeLessThanOrEqual(280)
    expect(candidate?.quote).toContain("reset everyone's Codex usage limits")
  })

  test("classifies a recorded Nitter timeline item", async () => {
    const page = parsePublicNitter(await fixture("thsottiaux.html"), { handle: "thsottiaux", sourceUrl: "https://nitter.example/thsottiaux" })
    expect(page.records).toHaveLength(1)
    const record = page.records[0]
    expect(record).toBeDefined()
    const candidate = classifierProfiles.availability?.({
      id: record!.id,
      observedAt: record!.timestamp,
      source: "thsottiaux",
      handle: record!.handle,
      text: record!.text,
      url: record!.sourceUrl,
    })
    expect(candidate?.matchedTerms).toContain("reset")
  })
})

describe("feed synchronization", () => {
  test("dedupes a second sync and preserves all existing document bytes", async () => {
    const directory = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    temporaryPaths.push(directory)
    const registryPath = join(directory, "feeds.yml")
    const databasePath = join(directory, "state", "feeds.sqlite")
    const documentPath = join(directory, "model-availability.md")
    const machineStatePath = join(directory, "model-availability.state.json")
    const existing = "# Existing\n\n## Updates\n\n| Observed | Extracted fact | Verbatim quote | Link |\n|---|---|---|---|\n| old | untouched | byte-exact | https://example.test |\n"
    await Bun.write(registryPath, JSON.stringify({ feeds: [{ name: "thsottiaux", kind: "rss", target: "https://fixture.test/thsottiaux.xml", cadence: "hourly", classifierProfile: "availability" }] }))
    await Bun.write(documentPath, existing)
    const rss = await fixture("thsottiaux.xml")
    let fetches = 0
    const fixtureFetch: typeof fetch = Object.assign(async () => { fetches++; return new Response(rss, { status: 200 }) }, fetch)

    const first = await syncFeeds({ registryPath, databasePath, documentPath, machineStatePath, now: new Date("2026-07-13T00:00:00.000Z"), fetch: fixtureFetch })
    expect(first.appended).toBe(1)
    const afterFirst = await Bun.file(documentPath).text()
    expect(afterFirst.slice(0, existing.length)).toBe(existing)
    expect(afterFirst).toContain("| 2026-07-12 | @thsottiaux: matched reset, limit, 5 hour |")

    const second = await syncFeeds({ registryPath, databasePath, documentPath, machineStatePath, now: new Date("2026-07-13T00:30:00.000Z"), fetch: fixtureFetch })
    expect(second.appended).toBe(0)
    expect(await Bun.file(documentPath).text()).toBe(afterFirst)
    expect(fetches).toBe(1)
    const machineState = await Bun.file(machineStatePath).text()
    expect(machineState).not.toContain("reset everyone's Codex usage limits")
    expect(machineState).not.toContain("lastResetQuote")
    const database = new Database(databasePath)
    try {
      const tables = database.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
      expect(tables.map(({ name }) => name)).toEqual(["feed_state", "processed_items"])
      expect(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_source_records'").get()).toBeNull()
    } finally {
      database.close()
    }
  })

  test("atomically claims each delivery key once across concurrent stores", async () => {
    const directory = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    temporaryPaths.push(directory)
    const databasePath = join(directory, "state", "feeds.sqlite")
    await Bun.write(join(directory, "state", ".keep"), "")
    const first = new FeedStateStore(databasePath)
    const second = new FeedStateStore(databasePath)
    const candidate: CandidateFact = {
      source: "thsottiaux",
      itemId: "tweet-1",
      observedAt: "2026-07-13T00:00:00.000Z",
      handle: "thsottiaux",
      quote: "reset",
      url: "https://example.test/tweet-1",
      matchedTerms: ["reset"],
    }
    try {
      expect(first.claimProcessed("thsottiaux", candidate, candidate.observedAt)).toBeTrue()
      expect(second.claimProcessed("thsottiaux", candidate, candidate.observedAt)).toBeFalse()
    } finally {
      first.close()
      second.close()
    }
  })

  test("page-hash feeds classify recorded page content once", async () => {
    const directory = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    temporaryPaths.push(directory)
    const registryPath = join(directory, "feeds.yml")
    const databasePath = join(directory, "state", "feeds.sqlite")
    const documentPath = join(directory, "model-availability.md")
    const machineStatePath = join(directory, "model-availability.state.json")
    await Bun.write(registryPath, JSON.stringify({ feeds: [{ name: "anthropic-news", kind: "page-hash", target: "https://fixture.test/news", cadence: "daily", classifierProfile: "availability" }] }))
    await Bun.write(documentPath, "| Observed | Extracted fact | Verbatim quote | Link |\n|---|---|---|---|\n")
    const html = await fixture("anthropic-news.html")
    const fixtureFetch: typeof fetch = Object.assign(async () => new Response(html, { status: 200 }), fetch)
    const first = await syncFeeds({ registryPath, databasePath, documentPath, machineStatePath, now: new Date("2026-07-13T00:00:00.000Z"), fetch: fixtureFetch })
    const second = await syncFeeds({ registryPath, databasePath, documentPath, machineStatePath, now: new Date("2026-07-13T01:00:00.000Z"), fetch: fixtureFetch })
    expect(first.appended).toBe(1)
    expect(first.candidates[0]?.quote).toContain("Fable 5 returns globally")
    expect(second.appended).toBe(0)
  })
})

test("appendCandidateRows is a no-op for no candidates", async () => {
  const directory = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
  temporaryPaths.push(directory)
  const path = join(directory, "document.md")
  await Bun.write(path, "unchanged")
  await appendCandidateRows(path, [])
  expect(await Bun.file(path).text()).toBe("unchanged")
})
