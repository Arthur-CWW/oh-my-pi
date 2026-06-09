import { describe, expect, test } from "bun:test"
import {
  buildJimengObjectSegmentationRequest,
  defaultObjectSegmentationBabiParam,
  jimengObjectSegmentationModes,
  JimengClient,
  JimengError,
  parseJimengObjectSegmentationCommandMode,
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
