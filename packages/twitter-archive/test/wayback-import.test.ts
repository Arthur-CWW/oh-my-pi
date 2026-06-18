import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildWaybackCdxQueries,
  fetchWaybackCdxEntriesForHandle,
  importWaybackSnapshotsToSqlite,
  initTwitterArchiveSqliteStore,
  WAYBACK_CDX_SOURCE_LANE,
  WAYBACK_DEFAULT_CDX_LIMIT,
  WAYBACK_SNAPSHOT_SOURCE_LANE,
  type WaybackFetchFunction,
} from "../src"
import { readFixture } from "./fixtures/read-fixture"

const cdxJson = await readFixture("wayback-cdx-pleometric.json")
const snapshotHtml = await readFixture("wayback-twitter-snapshot.html")

describe("Wayback import lane", () => {
  test("builds bounded CDX queries for Twitter and X profile/status URL patterns", () => {
    const queries = buildWaybackCdxQueries("@pleometric")

    expect(queries.map((query) => query.target.pattern)).toEqual([
      "twitter.com/pleometric",
      "x.com/pleometric",
      "twitter.com/pleometric/status/*",
      "x.com/pleometric/status/*",
    ])
    expect(queries.every((query) => query.limit === WAYBACK_DEFAULT_CDX_LIMIT)).toBe(true)
    expect(queries[0]?.url).toContain("output=json")
    expect(queries[0]?.url).toContain("filter=statuscode%3A200")
    expect(queries[2]?.url).toContain("twitter.com%2Fpleometric%2Fstatus%2F")
  })

  test("lists CDX entries through an injected fetch without live network", async () => {
    const fetchedUrls: string[] = []
    const fetchFn: WaybackFetchFunction = async (url) => {
      fetchedUrls.push(url)
      return {
        status: 200,
        async text() {
          return cdxJson
        },
      }
    }

    const result = await fetchWaybackCdxEntriesForHandle("pleometric", { fetchFn })

    expect(fetchedUrls).toHaveLength(4)
    expect(result.entries).toHaveLength(8)
    expect(result.entries[0]).toMatchObject({
      sourceLane: WAYBACK_CDX_SOURCE_LANE,
      timestamp: "20230102030405",
      originalUrl: "https://twitter.com/pleometric",
      statusCode: 200,
      mimeType: "text/html",
    })
  })

  test("stores CDX provenance and a low-cap raw snapshot while queuing incompatible HTML for later parsing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-wayback-"))
    const store = initTwitterArchiveSqliteStore(join(tempDir, "archive.sqlite"))
    const fetchedUrls: string[] = []
    const fetchFn: WaybackFetchFunction = async (url) => {
      fetchedUrls.push(url)
      const isCdx = url.startsWith("https://web.archive.org/cdx?")
      return {
        status: 200,
        headers: {
          get(name: string) {
            return !isCdx && name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
          },
        },
        async text() {
          return isCdx ? cdxJson : snapshotHtml
        },
      }
    }

    try {
      const result = await importWaybackSnapshotsToSqlite("pleometric", {
        store,
        fetchFn,
        fetchSnapshots: true,
        snapshotLimit: 1,
        importBatchId: "wayback-test-batch",
        importedAt: "2026-06-18T00:00:00.000Z",
      })

      expect(fetchedUrls).toHaveLength(5)
      expect(result.cdxEntriesStored).toBe(8)
      expect(result.snapshotsFetched).toBe(1)
      expect(result.rawPagesCached).toBe(1)
      expect(result.parseJobsCreated).toBe(1)
      expect(result.parsedSnapshots).toBe(0)
      expect(result.entityUpserts).toEqual({ users: 0, tweets: 0, media: 0 })

      const firstEntry = result.entries[0]
      expect(firstEntry).toBeDefined()
      const cdxRows = store.listWaybackCdxEntries({ importBatchId: "wayback-test-batch", sourceLane: WAYBACK_CDX_SOURCE_LANE })
      expect(cdxRows).toHaveLength(8)
      expect(cdxRows.some((row) => row.importStatus === "snapshot-fetched" && row.parseStatus === "pending")).toBe(true)

      const cached = store.getCachedPage({ source: WAYBACK_SNAPSHOT_SOURCE_LANE, url: firstEntry!.mementoUrl })
      expect(cached).toMatchObject({
        source: WAYBACK_SNAPSHOT_SOURCE_LANE,
        url: firstEntry!.mementoUrl,
        sourceUrl: firstEntry!.sourceUrl,
        sourceTimestamp: firstEntry!.timestamp,
        originalUrl: firstEntry!.originalUrl,
        mementoUrl: firstEntry!.mementoUrl,
        importBatchId: "wayback-test-batch",
        importStatus: "fetched",
        parseStatus: "pending",
      })
      expect(cached?.body).toBe(snapshotHtml)

      const jobs = store.listJobs({ stage: "wayback-parse" })
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({
        source: WAYBACK_SNAPSHOT_SOURCE_LANE,
        target: firstEntry!.mementoUrl,
        status: "pending",
        provenance: {
          sourceLane: WAYBACK_SNAPSHOT_SOURCE_LANE,
          originalUrl: firstEntry!.originalUrl,
          importBatchId: "wayback-test-batch",
        },
      })
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
