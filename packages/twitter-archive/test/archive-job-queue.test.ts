import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  enqueueBrowserHistoryArchiveJobs,
  initTwitterArchiveSqliteStore,
  runArchiveJobWorkerOnce,
  type NitterFetchFunction,
} from "../src"
import { readFixture } from "./fixtures/read-fixture"

const detailPage = await readFixture("nitter-detail-thread.html")

describe("archive job queue", () => {
  test("imports browser history candidates and dispatches a queued status job without live network", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-job-queue-"))
    const dbPath = join(tempDir, "archive.sqlite")
    const store = initTwitterArchiveSqliteStore(dbPath)
    const fetchedUrls: string[] = []
    const fetchFn: NitterFetchFunction = async (url) => {
      fetchedUrls.push(url)
      return {
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null
          },
        },
        async text() {
          return detailPage
        },
      }
    }

    try {
      const imported = enqueueBrowserHistoryArchiveJobs(
        {
          candidates: [
            { username: "communalAI", score: 4 },
            { url: "https://x.com/communalAI/status/1800000000000000003", priority: 9 },
            { url: "https://example.test/not-twitter" },
          ],
        },
        { store, defaultPriority: 1 },
      )
      expect(imported.jobs.map((job) => [job.targetType, job.targetValue, job.priority])).toEqual([
        ["profile", "communalai", 4],
        ["status", "https://x.com/communalAI/status/1800000000000000003", 9],
      ])
      expect(imported.skipped).toBe(1)

      const result = await runArchiveJobWorkerOnce({ store, baseUrl: "https://nitter.example", fetchFn })
      expect(result.status).toBe("completed")
      expect(result.job).toMatchObject({ targetType: "status", status: "completed" })
      expect(fetchedUrls).toEqual(["https://nitter.example/communalai/status/1800000000000000003"])
      expect(store.getTweet("1800000000000000003")?.text).toContain("complete text")
      expect(store.getCounts()).toMatchObject({ archiveJobs: 2, rawPages: 1 })
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

