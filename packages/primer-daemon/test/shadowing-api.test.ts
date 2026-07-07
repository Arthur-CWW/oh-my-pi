import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { startDashboard } from "../src/dashboard"
import { resolveDaemonPaths } from "../src/paths"

const TEST_TMP_ROOT = new URL(".tmp/shadowing-api/", import.meta.url).pathname
const EXAMPLE_ALIGNMENT = new URL("../../shadowing-pipeline/examples/hsk1_00001_sentence.json", import.meta.url).pathname
const EXAMPLE_MEDIA = "/Users/arthur/apps/hsk-deck/audio/sentences/hsk1_00001_sentence.mp3"

interface ShadowingAssetEntry {
  slug: string
  mediaFile: string | null
  durationMs: number | null
  sentenceCount: number | null
  asr: string | null
  createdAt: string | null
  warning?: string
}

interface AlignmentResponse {
  version: 1
  media: {
    file: string
    durationMs: number
    lang: "zh"
    asr: string
  }
  sentences: { idx: number; text: string }[]
}

describe("shadowing API", () => {
  test("lists assets, serves alignment, serves media, and reports malformed assets", async () => {
    const shadowingDir = join(TEST_TMP_ROOT, "assets")
    rmSync(TEST_TMP_ROOT, { recursive: true, force: true })
    mkdirSync(shadowingDir, { recursive: true })

    const validDir = join(shadowingDir, "hsk1_00001_sentence")
    mkdirSync(validDir, { recursive: true })
    copyFileSync(EXAMPLE_ALIGNMENT, join(validDir, "alignment.json"))
    copyFileSync(EXAMPLE_MEDIA, join(validDir, "hsk1_00001_sentence.mp3"))

    const malformedDir = join(shadowingDir, "malformed")
    mkdirSync(malformedDir, { recursive: true })
    writeFileSync(join(malformedDir, "alignment.json"), "{ nope", "utf8")

    const paths = resolveDaemonPaths({ PRIMER_SHADOWING_DIR: shadowingDir })
    const server = startDashboard({ port: 0, paths, env: { PRIMER_ASK_SYNTHESIS: "0" } })
    const baseUrl = `http://localhost:${server.port}`

    try {
      const listResponse = await fetch(`${baseUrl}/api/shadowing/assets`)
      expect(listResponse.status).toBe(200)
      const list = (await listResponse.json()) as ShadowingAssetEntry[]
      const valid = list.find((entry) => entry.slug === "hsk1_00001_sentence")
      expect(valid).toEqual({
        slug: "hsk1_00001_sentence",
        mediaFile: "hsk1_00001_sentence.mp3",
        durationMs: 2473,
        sentenceCount: 1,
        asr: "faster-whisper-base",
        createdAt: expect.any(String),
      })

      const malformed = list.find((entry) => entry.slug === "malformed")
      expect(malformed?.warning).toBe("malformed alignment JSON")
      expect(malformed?.mediaFile).toBeNull()

      const alignmentResponse = await fetch(`${baseUrl}/api/shadowing/assets/hsk1_00001_sentence/alignment`)
      expect(alignmentResponse.status).toBe(200)
      const alignment = (await alignmentResponse.json()) as AlignmentResponse
      expect(alignment.version).toBe(1)
      expect(alignment.media.durationMs).toBe(2473)
      expect(alignment.sentences.map((sentence) => sentence.text)).toEqual(["我今天想去超市买东西"])

      const expectedMedia = readFileSync(EXAMPLE_MEDIA)
      const mediaResponse = await fetch(`${baseUrl}/api/shadowing/assets/hsk1_00001_sentence/media`)
      expect(mediaResponse.status).toBe(200)
      expect(mediaResponse.headers.get("content-type")).toBe("audio/mpeg")
      expect(mediaResponse.headers.get("accept-ranges")).toBe("bytes")
      expect(mediaResponse.headers.get("content-length")).toBe(String(expectedMedia.length))
      expect(new Uint8Array(await mediaResponse.arrayBuffer())).toEqual(new Uint8Array(expectedMedia))

      const rangeResponse = await fetch(`${baseUrl}/api/shadowing/assets/hsk1_00001_sentence/media`, {
        headers: { range: "bytes=10-31" },
      })
      expect(rangeResponse.status).toBe(206)
      expect(rangeResponse.headers.get("content-range")).toBe(`bytes 10-31/${expectedMedia.length}`)
      expect(rangeResponse.headers.get("accept-ranges")).toBe("bytes")
      expect(rangeResponse.headers.get("content-length")).toBe("22")
      expect(new Uint8Array(await rangeResponse.arrayBuffer())).toEqual(new Uint8Array(expectedMedia.subarray(10, 32)))
    } finally {
      await server.stop(true)
    }
  })
})
