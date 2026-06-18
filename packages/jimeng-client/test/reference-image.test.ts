import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengFaceRecognizeRequest,
  buildJimengImageDescriptionRequest,
  createJimengHttpTransport,
  describeJimengImage,
  JimengClient,
  JimengError,
  parseImageUri,
  readJimengHttpCassette,
  recognizeJimengImageFaces,
  summarizeReferenceImageInspection,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng reference image helpers", () => {
  test("validates provider image URIs", () => {
    expect(parseImageUri("tos-cn-i-tb4s082cfz/reference.png")).toBe("tos-cn-i-tb4s082cfz/reference.png")
    expect(() => parseImageUri(undefined)).toThrow(JimengError)
    expect(() => parseImageUri("https://example.invalid/reference.png")).toThrow(JimengError)
  })

  test("builds typed reference-image request bodies", () => {
    expect(buildJimengImageDescriptionRequest({ imageUri: "tos-cn-i-tb4s082cfz/reference.png" })).toEqual({
      file_uri: "tos-cn-i-tb4s082cfz/reference.png",
    })
    expect(buildJimengFaceRecognizeRequest({ imageUri: "tos-cn-i-tb4s082cfz/reference.png" })).toEqual({
      image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"],
    })
    expect(() => buildJimengImageDescriptionRequest({ imageUri: "https://example.invalid/reference.png" })).toThrow(JimengError)
  })

  test("describes a provider image URI", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          description: "韩系美妆达人，室内自然光，正面自拍构图。",
        },
      }), requests),
    })

    const result = await describeJimengImage({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      babiParam: { scenario: "image_video_generation" },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_image_description")
    expect(requests[0]?.url).toContain("babi_param=")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      file_uri: "tos-cn-i-tb4s082cfz/reference.png",
    })
    expect(result.description).toBe("韩系美妆达人，室内自然光，正面自拍构图。")
    expect(result.responseTextSha256).toHaveLength(64)
  })

  test("recognizes faces from a provider image URI", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          face_info_list: [
            {
              face_key: "face-1",
              face_rect: [10, 20, 110, 220],
              keypoint: ["30", "40", 50, 60],
              score: 0.91,
              label: "main",
            },
          ],
        },
      }), requests),
    })

    const result = await recognizeJimengImageFaces({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
    })

    expect(requests[0]?.url).toContain("/mweb/v1/face_recognize")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"],
    })
    expect(result.faces).toEqual([
      {
        faceKey: "face-1",
        faceRect: [10, 20, 110, 220],
        keypoint: [30, 40, 50, 60],
        score: 0.91,
        label: "main",
      },
    ])
  })

  test("recognizes faces when upstream returns data as an array", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: [
          {
            faceKey: "face-direct",
            faceRect: [1, 2, 3, 4],
            keypoints: [5, 6],
          },
        ],
      }), requests),
    })

    const result = await recognizeJimengImageFaces({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
    })

    expect(result.faces).toEqual([
      {
        faceKey: "face-direct",
        faceRect: [1, 2, 3, 4],
        keypoint: [5, 6],
        score: null,
        label: null,
      },
    ])
  })

  test("can inspect images through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-reference-image-cassette-"))
    try {
      const cassettePath = path.join(dir, "reference-image.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify({
            ret: "0",
            errmsg: "success",
            data: { description: "韩系美妆达人，室内自然光，正面自拍构图。" },
          }),
          JSON.stringify({
            ret: "0",
            errmsg: "success",
            data: {
              face_info_list: [{
                face_key: "face-1",
                face_rect: [10, 20, 110, 220],
                keypoint: [30, 40, 50, 60],
                score: 0.91,
                label: "main",
              }],
            },
          }),
        ], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const imageUri = "tos-cn-i-tb4s082cfz/reference.png"

      const description = await describeJimengImage({
        fetch: recordTransport.fetch,
        session,
        imageUri,
      })
      const faces = await recognizeJimengImageFaces({
        fetch: recordTransport.fetch,
        session,
        imageUri,
      })

      expect(description.description).toBeTruthy()
      expect(faces.faces).toHaveLength(1)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      expect(requests).toHaveLength(2)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayedDescription = await describeJimengImage({
        fetch: replayTransport.fetch,
        session,
        imageUri,
      })
      const replayedFaces = await recognizeJimengImageFaces({
        fetch: replayTransport.fetch,
        session,
        imageUri,
      })

      expect(summarizeReferenceImageInspection({
        imageUri,
        description: replayedDescription,
        faceRecognition: replayedFaces,
      })).toMatchObject({
        image_uri: imageUri,
        description_present: true,
        face_count: 1,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("summarizes reference image inspection without raw response bodies", () => {
    const summary = summarizeReferenceImageInspection({
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      description: {
        endpoint: "/mweb/v1/get_image_description",
        imageUri: "tos-cn-i-tb4s082cfz/reference.png",
        httpStatus: 200,
        ret: "0",
        errmsg: "success",
        responseTextSha256: "a".repeat(64),
        request: { file_uri: "tos-cn-i-tb4s082cfz/reference.png" },
        description: "韩系美妆达人，正面自拍。",
        body: { raw: true },
      },
      faceRecognition: {
        endpoint: "/mweb/v1/face_recognize",
        imageUri: "tos-cn-i-tb4s082cfz/reference.png",
        httpStatus: 200,
        ret: "0",
        errmsg: "success",
        responseTextSha256: "b".repeat(64),
        request: { image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"] },
        faces: [{
          faceKey: "face-1",
          faceRect: [10, 20, 110, 220],
          keypoint: [30, 40, 50, 60],
          score: 0.91,
          label: "main",
        }],
        body: { raw: true },
      },
    })

    expect(summary).toEqual({
      image_uri: "tos-cn-i-tb4s082cfz/reference.png",
      description_present: true,
      description_length: 12,
      face_count: 1,
      faces: [{
        face_key: "face-1",
        face_rect: [10, 20, 110, 220],
        keypoint_count: 4,
        score: 0.91,
        label: "main",
      }],
    })
    expect(JSON.stringify(summary)).not.toContain("raw")
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
