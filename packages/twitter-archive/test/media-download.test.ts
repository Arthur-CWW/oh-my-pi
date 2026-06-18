import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { downloadArchivedMedia, initTwitterArchiveSqliteStore, type ArchiveMedia, type MediaDownloadFetchFunction, type MediaDownloadLogEntry } from "../src"

function fixtureResponse(body: string, contentType: string) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === "content-type" ? contentType : null
      },
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      const bytes = new TextEncoder().encode(body)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    },
  }
}

describe("downloadArchivedMedia", () => {
  test("downloads stored media URLs, updates localPath, logs, and skips existing local files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-media-"))
    const store = initTwitterArchiveSqliteStore(join(tempDir, "archive.sqlite"))

    try {
      const media: ArchiveMedia = {
        id: "media:image 1",
        tweetId: "tweet-1",
        type: "image",
        remoteUrl: "https://nitter.example/pic/media-1?format=jpg&name=large",
        capturedAt: "2026-06-18T00:00:00.000Z",
        source: "frontend",
      }
      store.upsertMedia([media])

      const fetchedUrls: string[] = []
      const logs: MediaDownloadLogEntry[] = []
      const fetchFn: MediaDownloadFetchFunction = async (url) => {
        fetchedUrls.push(url)
        return fixtureResponse("image-bytes", "image/jpeg; charset=binary")
      }

      const firstRun = await downloadArchivedMedia({
        store,
        mediaRoot: join(tempDir, "media"),
        fetchFn,
        logger: (entry) => {
          logs.push(entry)
        },
        now: () => "2026-06-18T00:01:00.000Z",
      })

      expect(firstRun.counts).toMatchObject({ downloaded: 1, skippedExisting: 0, failed: 0 })
      expect(fetchedUrls).toEqual([media.remoteUrl ?? ""])
      expect(firstRun.items[0].localPath?.endsWith(".jpg")).toBe(true)
      expect(await readFile(firstRun.items[0].localPath ?? "", "utf8")).toBe("image-bytes")
      expect(store.getMedia(media.id)?.localPath).toBe(firstRun.items[0].localPath)
      expect(logs.map((entry) => entry.event)).toContain("media-download.downloaded")

      const secondRun = await downloadArchivedMedia({
        store,
        mediaRoot: join(tempDir, "media"),
        fetchFn: async () => {
          throw new Error("fetch should not run for existing local media")
        },
        now: () => "2026-06-18T00:02:00.000Z",
      })

      expect(secondRun.counts).toMatchObject({ downloaded: 0, skippedExisting: 1, failed: 0 })
      expect(secondRun.items[0]).toMatchObject({ mediaId: media.id, status: "skipped-existing", localPath: firstRun.items[0].localPath })
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("caps concurrency at four and keeps starting queued downloads as slots finish", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-media-concurrency-"))
    const store = initTwitterArchiveSqliteStore(join(tempDir, "archive.sqlite"))

    try {
      const media: ArchiveMedia[] = Array.from({ length: 5 }, (_, index) => ({
        id: `media-${index + 1}`,
        tweetId: `tweet-${index + 1}`,
        type: "video",
        remoteUrl: `https://video.twimg.com/ext_tw_video/${index + 1}/pu/vid/720x720/video-${index + 1}.mp4`,
        variants: [
          {
            url: `https://video.twimg.com/ext_tw_video/${index + 1}/pu/vid/720x720/video-${index + 1}.mp4`,
            contentType: "video/mp4",
            bitrate: 832000,
          },
        ],
        capturedAt: "2026-06-18T00:00:00.000Z",
        source: "frontend",
      }))
      store.upsertMedia(media)

      const releases = media.map(() => Promise.withResolvers<void>())
      const fourthStarted = Promise.withResolvers<void>()
      const fifthStarted = Promise.withResolvers<void>()
      const startedUrls: string[] = []
      let active = 0
      let maxActive = 0

      const fetchFn: MediaDownloadFetchFunction = async (url) => {
        const index = startedUrls.length
        startedUrls.push(url)
        active += 1
        maxActive = Math.max(maxActive, active)
        if (startedUrls.length === 4) {
          fourthStarted.resolve()
        }
        if (startedUrls.length === 5) {
          fifthStarted.resolve()
        }
        await releases[index].promise
        active -= 1
        return fixtureResponse(`video-${index + 1}`, "video/mp4")
      }

      const run = downloadArchivedMedia({
        store,
        mediaRoot: join(tempDir, "media"),
        fetchFn,
        maxItems: 5,
        concurrency: 99,
        now: () => "2026-06-18T00:03:00.000Z",
      })

      await fourthStarted.promise
      expect(startedUrls).toHaveLength(4)
      expect(maxActive).toBe(4)

      releases[0].resolve()
      await fifthStarted.promise
      expect(startedUrls).toHaveLength(5)
      expect(maxActive).toBe(4)

      for (const release of releases.slice(1)) {
        release.resolve()
      }

      const result = await run
      expect(result.concurrency).toBe(4)
      expect(result.counts).toMatchObject({ downloaded: 5, failed: 0 })
      expect(new Set(result.items.map((item) => item.localPath)).size).toBe(5)
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("skips rows whose existing localPath points at a file without fetching", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-media-existing-"))
    const store = initTwitterArchiveSqliteStore(join(tempDir, "archive.sqlite"))

    try {
      const localPath = join(tempDir, "media", "images", "already-there.jpg")
      await mkdir(dirname(localPath), { recursive: true })
      await writeFile(localPath, "existing")
      const media: ArchiveMedia = {
        id: "existing-media",
        tweetId: "tweet-1",
        type: "image",
        remoteUrl: "https://nitter.example/pic/existing.jpg",
        localPath,
        capturedAt: "2026-06-18T00:00:00.000Z",
        source: "frontend",
      }
      store.upsertMedia([media])

      const result = await downloadArchivedMedia({
        store,
        mediaRoot: join(tempDir, "media"),
        fetchFn: async () => {
          throw new Error("fetch should not run for rows with existing local files")
        },
      })

      expect(result.counts).toMatchObject({ downloaded: 0, skippedExisting: 1, failed: 0 })
      expect(result.items).toEqual([{ mediaId: media.id, status: "skipped-existing", localPath }])
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
