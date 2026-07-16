import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startDashboard, type DashboardServer } from "../src/dashboard"
import { resolveDaemonPaths } from "../src/paths"

const cliPath = new URL("../src/cli.ts", import.meta.url).pathname

const alignment = {
  version: 1 as const,
  media: {
    file: "tiny.mp3",
    durationMs: 120,
    lang: "zh" as const,
    asr: "reader-media-test",
    kind: "audio" as const,
  },
  sentences: [
    {
      idx: 0,
      text: "你好。",
      pinyin: "nǐ hǎo",
      startMs: 0,
      endMs: 60,
      chars: [
        { ch: "你", pinyin: "nǐ", startMs: 0, endMs: 30 },
        { ch: "好", pinyin: "hǎo", startMs: 30, endMs: 60 },
      ],
      charTiming: "native" as const,
    },
    {
      idx: 1,
      text: "再见。",
      pinyin: "zài jiàn",
      startMs: 60,
      endMs: 120,
      chars: [
        { ch: "再", pinyin: "zài", startMs: 60, endMs: 90 },
        { ch: "见", pinyin: "jiàn", startMs: 90, endMs: 120 },
      ],
      charTiming: "native" as const,
    },
  ],
}

function runMediaCli(env: { ledgerDb: string; readerMediaDir: string }, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, cliPath, "media", ...args], {
    env: {
      ...process.env,
      PRIMER_LEDGER_DB: env.ledgerDb,
      PRIMER_READER_MEDIA_DIR: env.readerMediaDir,
    },
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe("reader media", () => {
  test("imports deterministic media, serves metadata/alignment/ranges, and rejects mismatched attachments", async () => {
    const root = mkdtempSync(join(tmpdir(), "primer-reader-media-test-"))
    const sourceDir = join(root, "source")
    const mediaDir = join(root, "reader-media")
    const ledgerDb = join(root, "ledger.sqlite")
    const mediaBytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, "alignment.json"), JSON.stringify(alignment), "utf8")
    writeFileSync(join(sourceDir, "tiny.mp3"), mediaBytes)

    const paths = resolveDaemonPaths({ PRIMER_LEDGER_DB: ledgerDb, PRIMER_READER_MEDIA_DIR: mediaDir })
    let server: DashboardServer | null = null
    try {
      const imported = runMediaCli({ ledgerDb, readerMediaDir: mediaDir }, "import", sourceDir, "--title", "Tiny reader")
      expect(imported).toEqual({
        exitCode: 0,
        stdout: expect.stringMatching(/^docId=1 slug=tiny-reader-[a-f0-9]{10}\n$/),
        stderr: "",
      })
      const docId = Number(/^docId=(\d+)/u.exec(imported.stdout)?.[1])
      expect(docId).toBe(1)

      server = startDashboard({ port: 0, paths, env: { PRIMER_ASK_SYNTHESIS: "0" } })
      const baseUrl = `http://localhost:${server.port}`

      const docResponse = await fetch(`${baseUrl}/api/reader/docs/${docId}`)
      expect(docResponse.status).toBe(200)
      const doc = (await docResponse.json()) as { paragraphs: string[] }
      expect(doc.paragraphs).toEqual(alignment.sentences.map((sentence) => sentence.text))

      const metadataResponse = await fetch(`${baseUrl}/api/reader/docs/${docId}/media`)
      expect(metadataResponse.status).toBe(200)
      const metadata = (await metadataResponse.json()) as {
        slug: string
        kind: string
        file: string
        durationMs: number
        asr: string
        sentenceCount: number
      }
      expect(metadata).toEqual({
        slug: expect.stringMatching(/^tiny-reader-[a-f0-9]{10}$/),
        kind: "audio",
        file: "tiny.mp3",
        durationMs: 120,
        asr: "reader-media-test",
        sentenceCount: 2,
      })

      const alignmentResponse = await fetch(`${baseUrl}/api/reader/docs/${docId}/media/alignment`)
      expect(alignmentResponse.status).toBe(200)
      expect(await alignmentResponse.json()).toEqual(alignment)

      const rangeResponse = await fetch(`${baseUrl}/api/reader/docs/${docId}/media/file`, {
        headers: { range: "bytes=2-5" },
      })
      expect(rangeResponse.status).toBe(206)
      expect(rangeResponse.headers.get("content-type")).toBe("audio/mpeg")
      expect(rangeResponse.headers.get("accept-ranges")).toBe("bytes")
      expect(rangeResponse.headers.get("content-range")).toBe("bytes 2-5/8")
      expect(rangeResponse.headers.get("content-length")).toBe("4")
      expect(new Uint8Array(await rangeResponse.arrayBuffer())).toEqual(mediaBytes.slice(2, 6))

      const noMediaResponse = await fetch(`${baseUrl}/api/reader/docs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "No media", text: "你好！\n再见！" }),
      })
      expect(noMediaResponse.status).toBe(200)
      const noMediaDoc = (await noMediaResponse.json()) as { id: number; paragraphCount: number }
      expect(noMediaDoc.paragraphCount).toBe(2)

      const mismatch = runMediaCli(
        { ledgerDb, readerMediaDir: mediaDir },
        "attach",
        String(noMediaDoc.id),
        sourceDir,
      )
      expect(mismatch).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "alignment sentence 0 does not exactly match reading document paragraph\n",
      })
      const exactResponse = await fetch(`${baseUrl}/api/reader/docs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Attached reader", text: "你好。\n再见。" }),
      })
      expect(exactResponse.status).toBe(200)
      const exactDoc = (await exactResponse.json()) as { id: number }
      const attached = runMediaCli(
        { ledgerDb, readerMediaDir: mediaDir },
        "attach",
        String(exactDoc.id),
        sourceDir,
      )
      expect(attached.exitCode).toBe(0)
      expect(attached.stdout).toMatch(/^docId=\d+ slug=attached-reader-[a-f0-9]{10}\n$/u)
      expect(attached.stderr).toBe("")

      const listed = runMediaCli({ ledgerDb, readerMediaDir: mediaDir }, "list", "--json")
      expect(listed.exitCode).toBe(0)
      expect(JSON.parse(listed.stdout)).toHaveLength(2)

      const missingMediaResponse = await fetch(`${baseUrl}/api/reader/docs/${noMediaDoc.id}/media`)
      expect(missingMediaResponse.status).toBe(404)
      expect(await missingMediaResponse.json()).toEqual({ error: "reader media not found" })

      expect(new Uint8Array(readFileSync(join(mediaDir, metadata.slug, "tiny.mp3")))).toEqual(mediaBytes)
    } finally {
      if (server !== null) await server.stop(true)
      rmSync(root, { recursive: true, force: true })
    }
  })
})

