import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengVideoInfoRequest,
  createJimengHttpTransport,
  fetchJimengVideoInfo,
  JimengClient,
  JimengError,
  parseJimengVidCsvFlag,
  readJimengHttpCassette,
  summarizeJimengVideoInfo,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng video info", () => {
  test("builds confirmed get_video_by_vid request shape", () => {
    expect(buildJimengVideoInfoRequest({ vids: ["v1", "v1", "v2"] })).toEqual({
      vids: ["v1", "v2"],
    })
    expect(parseJimengVidCsvFlag("v1,v2")).toEqual(["v1", "v2"])
    expect(() => buildJimengVideoInfoRequest({ vids: [] })).toThrow(JimengError)
    expect(() => buildJimengVideoInfoRequest({ vids: ["bad vid"] })).toThrow(JimengError)
  })

  test("fetches and summarizes VOD metadata without signed URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(videoInfoBody()), requests),
    })

    const result = await fetchJimengVideoInfo({
      client,
      session,
      query: { vids: ["v03870g10004d8k1u4nog65hb08dnhig"] },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_video_by_vid")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      vids: ["v03870g10004d8k1u4nog65hb08dnhig"],
    })
    expect(result.videos[0]).toMatchObject({
      lookupVid: "v03870g10004d8k1u4nog65hb08dnhig",
      vid: "v03870g10004d8k1u4nog65hb08dnhig",
      durationSec: 5,
      width: 704,
      height: 1248,
      fps: 24,
      format: "mp4",
      definition: "720p",
      videoUrlPresent: true,
      coverUrlPresent: true,
      transcodedDefinitions: ["720p"],
    })

    const summary = summarizeJimengVideoInfo(result)
    const summaryText = JSON.stringify(summary)
    expect(summaryText).toContain("video_url_present")
    expect(summaryText).not.toContain("signed.example.invalid")
    expect(summaryText).not.toContain("x-signature")
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-video-info-cassette-"))
    try {
      const cassettePath = path.join(dir, "video-info.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(JSON.stringify(videoInfoBody()), requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const query = { vids: ["v03870g10004d8k1u4nog65hb08dnhig"] }

      const recorded = await fetchJimengVideoInfo({
        fetch: recordTransport.fetch,
        session,
        query,
      })

      expect(recorded.videos).toHaveLength(1)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengVideoInfo({
        fetch: replayTransport.fetch,
        session,
        query,
      })

      expect(summarizeJimengVideoInfo(replayed)).toMatchObject({
        endpoint: "/mweb/v1/get_video_by_vid",
        video_count: 1,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function videoInfoBody() {
  return {
    ret: "0",
    errmsg: "success",
    vid2video: {
      v03870g10004d8k1u4nog65hb08dnhig: {
        origin_video: {
          vid: "v03870g10004d8k1u4nog65hb08dnhig",
          fps: 24,
          width: 704,
          height: 1248,
          duration: 5,
          video_url: "https://signed.example.invalid/video.mp4?x-signature=secret",
          cover_url: "https://signed.example.invalid/cover.webp?x-signature=secret",
          format: "mp4",
          definition: "720p",
          logo_type: "",
          md5: "8e16089b65a7b02eb6349aefe41fc267",
          size: 4285498,
          video_id: "v03870g10004d8k1u4nog65hb08dnhig",
        },
        transcoded_video: {
          "720p": {
            vid: "v03870g10004d8k1u4nog65hb08dnhig",
            fps: 24,
            width: 704,
            height: 1248,
            duration: 5,
            video_url: "https://signed.example.invalid/video-720.mp4?x-signature=secret",
            cover_url: "https://signed.example.invalid/cover-720.webp?x-signature=secret",
            format: "mp4",
            definition: "720p",
            md5: "8e16089b65a7b02eb6349aefe41fc267",
            size: 4285498,
            video_id: "v03870g10004d8k1u4nog65hb08dnhig",
          },
        },
      },
    },
  }
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return {
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }
  }
}
