import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengObjectSegmentationRequest,
  createJimengHttpTransport,
  defaultObjectSegmentationBabiParam,
  jimengObjectSegmentationModes,
  JimengClient,
  JimengError,
  parseJimengObjectSegmentationCommandMode,
  readJimengHttpCassette,
  segmentJimengObject,
  summarizeObjectSegmentation,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng object segmentation helpers", () => {
  test("validates object segmentation mode flags", () => {
    expect(parseJimengObjectSegmentationCommandMode(undefined)).toBe("both")
    expect(parseJimengObjectSegmentationCommandMode("CANVAS")).toBe("canvas")
    expect(parseJimengObjectSegmentationCommandMode("default")).toBe("default")
    expect(jimengObjectSegmentationModes("both")).toEqual(["canvas", "default"])
    expect(jimengObjectSegmentationModes("canvas")).toEqual(["canvas"])
    expect(() => parseJimengObjectSegmentationCommandMode("mask")).toThrow(JimengError)
  })

  test("builds frontend saliency_seg request shapes", () => {
    expect(buildJimengObjectSegmentationRequest({
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      mode: "canvas",
    })).toEqual({
      image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"],
      mode: "canvas",
    })

    expect(buildJimengObjectSegmentationRequest({
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      mode: "default",
    })).toEqual({
      image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"],
    })
  })

  test("segments a provider image and parses masks", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: [{
          mask: {
            uri: "tos-cn-i-tb4s082cfz/mask.png",
            url: "https://signed.example.invalid/mask.png?X-Amz-Signature=secret",
          },
          bbox: [10, 20, 300, 400],
          score: 0.91,
          label: "person",
        }],
      }), requests),
    })

    const result = await segmentJimengObject({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      mode: "canvas",
      babiParam: defaultObjectSegmentationBabiParam(),
    })

    expect(requests[0]?.url).toContain("/mweb/v1/saliency_seg")
    expect(requests[0]?.url).toContain("babi_param=")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"],
      mode: "canvas",
    })
    expect(result.masks).toEqual([{
      maskUri: "tos-cn-i-tb4s082cfz/mask.png",
      maskUrl: "https://signed.example.invalid/mask.png?X-Amz-Signature=secret",
      bbox: [10, 20, 300, 400],
      score: 0.91,
      label: "person",
    }])
    expect(result.responseTextSha256).toHaveLength(64)
  })

  test("parses alternate observed mask containers and typed upstream no-object errors", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const successClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          value: [
            {
              mask: {
                uri: "tos-cn-i-tb4s082cfz/mask.png",
                url: "https://signed.example.invalid/mask.png?X-Amz-Signature=secret",
              },
              rect: ["1", 2, "3", 4],
              confidence: 0.88,
              name: "foreground",
            },
          ],
        },
      }), requests),
    })

    const result = await segmentJimengObject({
      client: successClient,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      mode: "default",
    })

    expect(result.masks).toEqual([{
      maskUri: "tos-cn-i-tb4s082cfz/mask.png",
      maskUrl: "https://signed.example.invalid/mask.png?X-Amz-Signature=secret",
      bbox: [1, 2, 3, 4],
      score: 0.88,
      label: "foreground",
    }])

    const failureClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({ ret: 2046, errmsg: "no object" }), []),
    })
    await expect(segmentJimengObject({
      client: failureClient,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      mode: "canvas",
    })).rejects.toThrow("object segmentation failed")
  })

  test("can segment objects through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-reference-segmentation-cassette-"))
    try {
      const cassettePath = path.join(dir, "reference-segmentation.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify({
            ret: "0",
            errmsg: "success",
            data: [{
              mask: {
                uri: "tos-cn-i-tb4s082cfz/mask.png",
                url: "https://signed.example.invalid/mask.png?X-Amz-Signature=secret",
              },
              bbox: [10, 20, 300, 400],
              score: 0.91,
              label: "person",
            }],
          }),
          JSON.stringify({
            ret: 0,
            errmsg: "success",
            data: {
              maskList: [{
                maskUrl: "https://signed.example.invalid/mask-default.png?X-Amz-Signature=secret",
                maskUri: "tos-cn-i-tb4s082cfz/mask-default.png",
              }],
            },
          }),
        ], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const imageUri = "tos-cn-i-tb4s082cfz/reference.png"

      const canvas = await segmentJimengObject({
        fetch: recordTransport.fetch,
        session,
        imageUri,
        mode: "canvas",
        babiParam: defaultObjectSegmentationBabiParam(),
      })
      const defaultResult = await segmentJimengObject({
        fetch: recordTransport.fetch,
        session,
        imageUri,
        mode: "default",
        babiParam: defaultObjectSegmentationBabiParam(),
      })

      expect(canvas.masks).toHaveLength(1)
      expect(defaultResult.masks).toHaveLength(1)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      expect(requests).toHaveLength(2)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayedCanvas = await segmentJimengObject({
        fetch: replayTransport.fetch,
        session,
        imageUri,
        mode: "canvas",
        babiParam: defaultObjectSegmentationBabiParam(),
      })
      const replayedDefault = await segmentJimengObject({
        fetch: replayTransport.fetch,
        session,
        imageUri,
        mode: "default",
        babiParam: defaultObjectSegmentationBabiParam(),
      })
      const summary = summarizeObjectSegmentation([replayedCanvas, replayedDefault])

      expect(summary).toMatchObject({
        image_uri: imageUri,
        modes: [
          {
            mode: "canvas",
            mask_count: 1,
            masks: [{
              mask_uri: "tos-cn-i-tb4s082cfz/mask.png",
              mask_url_present: true,
            }],
          },
          {
            mode: "default",
            mask_count: 1,
            masks: [{
              mask_uri: "tos-cn-i-tb4s082cfz/mask-default.png",
              mask_url_present: true,
            }],
          },
        ],
      })
      expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
      expect(JSON.stringify(summary)).not.toContain("X-Amz-Signature")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("summarizes masks without signed URLs", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: 0,
        errmsg: "success",
        data: {
          maskList: [{
            maskUrl: "https://signed.example.invalid/mask.png?X-Amz-Signature=secret",
            maskUri: "tos-cn-i-tb4s082cfz/mask.png",
          }],
        },
      }), []),
    })

    const result = await segmentJimengObject({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      mode: "default",
    })
    const summary = summarizeObjectSegmentation([result])

    expect(summary.image_uri).toBe("tos-cn-i-tb4s082cfz/reference.png")
    expect(JSON.stringify(summary)).toContain("mask_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("X-Amz-Signature")
  })
})

function mockFetch(text: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    return new Response(text, { status: 200 })
  }
}

function mockFetchSequence(texts: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  let index = 0
  return async (url, init) => {
    requests.push({ url, init })
    const text = texts[index]
    index += 1
    if (text === undefined) throw new Error(`unexpected request ${url}`)
    return new Response(text, { status: 200 })
  }
}
