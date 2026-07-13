import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createRssSource,
  parsePublicJsonPage,
  PublicSourceCache,
  type PublicSourceAdapter,
  syncPublicSources,
} from "../src"

const fixtureDirectory = join(import.meta.dir, "fixtures")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function createCache(): Promise<{ cache: PublicSourceCache; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "twitter-public-source-"))
  temporaryDirectories.push(directory)
  const path = join(directory, "cache.sqlite")
  return { cache: new PublicSourceCache(path), path }
}

const response = (body: string, status = 200) => ({ ok: status >= 200 && status < 300, status, async text() { return body } })

describe("cached public Twitter sources", () => {
  test("syncs a fixture RSS feed and deduplicates repeated records", async () => {
    const rss = await readFile(join(fixtureDirectory, "public-source-rss.xml"), "utf8")
    const { cache } = await createCache()
    const adapter = createRssSource("fixture-rss", "https://feeds.example/{handle}.xml")
    const fetch = async () => response(rss)

    const first = await syncPublicSources(cache, [adapter], { handles: ["@thsottiaux"], fetch, force: true, retries: 0, backoffMs: 0, jitterMs: 0 })
    const second = await syncPublicSources(cache, [adapter], { handles: ["thsottiaux"], fetch, force: true, retries: 0, backoffMs: 0, jitterMs: 0 })

    expect(first.inserted).toBe(2)
    expect(second.inserted).toBe(0)
    expect(cache.search({ handle: "thsottiaux" }).map(record => record.id)).toEqual(["tweet-101", "tweet-100"])
    cache.close()
  })

  test("falls back after an endpoint failure and searches by handle, list, query, and date", async () => {
    const rss = await readFile(join(fixtureDirectory, "public-source-rss.xml"), "utf8")
    const { cache } = await createCache()
    const failed = createRssSource("unavailable", "https://unavailable.example/{handle}")
    const fallback = createRssSource("fallback", "https://feeds.example/{handle}.xml")
    const fetch = async (url: string) => url.includes("unavailable") ? response("service unavailable", 503) : response(rss)

    const result = await syncPublicSources(cache, [failed, fallback], { handles: ["thsottiaux"], fetch, retries: 0, backoffMs: 0, jitterMs: 0 })
    expect(result).toMatchObject({ attempted: 2, inserted: 2, failures: [] })
    expect(cache.search({ handles: ["nobody", "thsottiaux"], query: "durable", since: "2026-07-12", until: "2026-07-13" }).map(record => record.id)).toEqual(["tweet-101"])
    cache.close()
  })

  test("persists a per-source cursor and cadence across cache restart", async () => {
    const page = await readFile(join(fixtureDirectory, "public-source-page.json"), "utf8")
    const { cache, path } = await createCache()
    const seenCursors: Array<string | undefined> = []
    const adapter: PublicSourceAdapter = {
      id: "cursor-api",
      kind: "api",
      async fetch(input) {
        seenCursors.push(input.cursor)
        return parsePublicJsonPage(page, { handle: input.handle, sourceUrl: "https://api.example/thsottiaux" })
      },
    }
    const firstNow = new Date("2026-07-13T09:00:00.000Z")
    await syncPublicSources(cache, [adapter], { handles: ["thsottiaux"], now: firstNow, retries: 0, backoffMs: 0, jitterMs: 0 })
    cache.close()

    const reopened = new PublicSourceCache(path)
    const skipped = await syncPublicSources(reopened, [adapter], { handles: ["thsottiaux"], now: new Date("2026-07-13T09:30:00.000Z"), retries: 0, backoffMs: 0, jitterMs: 0 })
    await syncPublicSources(reopened, [adapter], { handles: ["thsottiaux"], now: new Date("2026-07-13T10:01:00.000Z"), retries: 0, backoffMs: 0, jitterMs: 0 })

    expect(skipped.skipped).toBe(1)
    expect(seenCursors).toEqual([undefined, "next-103"])
    expect(reopened.sourceState("cursor-api", "thsottiaux")?.cursor).toBe("next-103")
    reopened.close()
  })
})
