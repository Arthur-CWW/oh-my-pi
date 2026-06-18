import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengControlNetPreviewRequest,
  buildJimengControlNetSaveParams,
  createJimengHttpTransport,
  defaultControlNetPreviewBabiParam,
  defaultPoseDetectBabiParam,
  detectJimengPose,
  generateJimengControlNetPreview,
  jimengReferenceControlEvidence,
  JimengClient,
  JimengError,
  normalizeJimengControlNetStrength,
  parseJimengControlNetFitMode,
  parseJimengControlNetKind,
  parseJimengReferenceControlKind,
  readJimengHttpCassette,
  summarizeControlNetReferenceInspection,
  type JimengControlNetKind,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng reference control helpers", () => {
  test("validates observed ControlNet flags and explicit catalog-only gaps", () => {
    expect(parseJimengControlNetKind(undefined)).toBe("pose")
    expect(parseJimengControlNetKind("DEPTH")).toBe("depth")
    expect(parseJimengReferenceControlKind("style")).toBe("style")
    expect(parseJimengControlNetFitMode(undefined)).toBe("center_crop")
    expect(parseJimengControlNetFitMode("adapt_to_canvas")).toBe("adapt_to_canvas")
    expect(normalizeJimengControlNetStrength(undefined)).toBe(0.6)
    expect(normalizeJimengControlNetStrength(60)).toBe(0.6)
    expect(normalizeJimengControlNetStrength(0.75)).toBe(0.75)
    expect(jimengReferenceControlEvidence("style")).toMatchObject({
      previewSupported: false,
      status: "catalog_only_missing_capture",
      gap: expect.stringContaining("No observed /mweb/v1/blend_preview style"),
    })
    expect(() => parseJimengControlNetKind("style")).toThrow(JimengError)
    expect(() => parseJimengReferenceControlKind("lineart")).toThrow(JimengError)
    expect(() => parseJimengControlNetFitMode("stretch")).toThrow(JimengError)
    expect(() => normalizeJimengControlNetStrength(120)).toThrow(JimengError)
  })

  test("builds observed frontend blend_preview request shapes for pose, depth, and canny", () => {
    for (const control of ["pose", "depth", "canny"] as JimengControlNetKind[]) {
      expect(buildJimengControlNetPreviewRequest({
        imageUri: "tos-cn-i-tb4s082cfz/reference.png",
        control,
        strength: 60,
      })).toEqual({
        model: "img2img_xl_sft",
        ability: {
          name: "control_net",
          image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"],
          control_net_list: [{
            name: control,
            strength: 0.6,
            image_index: 0,
          }],
        },
      })
    }
  })

  test("generates a controlnet preview for a provider image URI", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          ability: {
            large_image_list: [{
              image_uri: "tos-cn-i-tb4s082cfz/preview.png",
              image_url: "https://signed.example.invalid/preview.png?X-Amz-Signature=secret",
            }],
          },
        },
      }), requests),
    })

    const result = await generateJimengControlNetPreview({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      control: "pose",
      strength: 60,
      babiParam: defaultControlNetPreviewBabiParam("pose"),
    })

    expect(requests[0]?.url).toContain("/mweb/v1/blend_preview")
    expect(requests[0]?.url).toContain("babi_param=")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      model: "img2img_xl_sft",
      ability: {
        name: "control_net",
        image_uri_list: ["tos-cn-i-tb4s082cfz/reference.png"],
        control_net_list: [{
          name: "pose",
          strength: 0.6,
          image_index: 0,
        }],
      },
    })
    expect(result.previewImageUri).toBe("tos-cn-i-tb4s082cfz/preview.png")
    expect(result.previewImageUrl).toContain("signed.example.invalid")
    expect(result.responseTextSha256).toHaveLength(64)
  })

  test("detects whether a provider image has a pose", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          is_pose: true,
        },
      }), requests),
    })

    const result = await detectJimengPose({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      babiParam: defaultPoseDetectBabiParam(),
    })

    expect(requests[0]?.url).toContain("/mweb/v1/pose_detect")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      uri: "tos-cn-i-tb4s082cfz/reference.png",
    })
    expect(result.isPose).toBe(true)
  })

  test("can inspect ControlNet references through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-reference-controls-cassette-"))
    try {
      const cassettePath = path.join(dir, "reference-controls.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify({
            ret: "0",
            errmsg: "success",
            data: {
              ability: {
                large_image_list: [{
                  image_uri: "tos-cn-i-tb4s082cfz/preview.png",
                  image_url: "https://signed.example.invalid/preview.png?X-Amz-Signature=secret",
                }],
              },
            },
          }),
          JSON.stringify({
            ret: "0",
            errmsg: "success",
            data: { is_pose: true },
          }),
        ], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const imageUri = "tos-cn-i-tb4s082cfz/reference.png"
      const control = "pose"
      const fitMode = "center_crop"

      const preview = await generateJimengControlNetPreview({
        fetch: recordTransport.fetch,
        session,
        imageUri,
        control,
        strength: 60,
        babiParam: defaultControlNetPreviewBabiParam(control),
      })
      const poseDetection = await detectJimengPose({
        fetch: recordTransport.fetch,
        session,
        imageUri,
        babiParam: defaultPoseDetectBabiParam(),
      })

      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      expect(requests).toHaveLength(2)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayedPreview = await generateJimengControlNetPreview({
        fetch: replayTransport.fetch,
        session,
        imageUri,
        control,
        strength: 60,
        babiParam: defaultControlNetPreviewBabiParam(control),
      })
      const replayedPoseDetection = await detectJimengPose({
        fetch: replayTransport.fetch,
        session,
        imageUri,
        babiParam: defaultPoseDetectBabiParam(),
      })
      const summary = summarizeControlNetReferenceInspection({
        imageUri,
        control,
        fitMode,
        preview: replayedPreview,
        poseDetection: replayedPoseDetection,
        saveParams: buildJimengControlNetSaveParams({
          imageUri,
          control,
          strength: 60,
          previewImageUri: replayedPreview.previewImageUri,
          previewImageUrl: replayedPreview.previewImageUrl,
          fitMode,
        }),
      })

      expect(preview.previewImageUri).toBe("tos-cn-i-tb4s082cfz/preview.png")
      expect(poseDetection.isPose).toBe(true)
      expect(summary).toMatchObject({
        image_uri: imageUri,
        preview_image_uri: "tos-cn-i-tb4s082cfz/preview.png",
        preview_image_url_present: true,
        pose_detected: true,
      })
      expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
      expect(JSON.stringify(summary)).not.toContain("X-Amz-Signature")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("builds save params and summarizes without signed preview URLs", () => {
    const saveParams = buildJimengControlNetSaveParams({
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      control: "pose",
      strength: 60,
      previewImageUri: "tos-cn-i-tb4s082cfz/preview.png",
      previewImageUrl: "https://signed.example.invalid/preview.png?X-Amz-Signature=secret",
      fitMode: "center_crop",
    })
    const summary = summarizeControlNetReferenceInspection({
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      control: "pose",
      fitMode: "center_crop",
      saveParams,
      preview: {
        endpoint: "/mweb/v1/blend_preview",
        imageUri: "tos-cn-i-tb4s082cfz/reference.png",
        control: "pose",
        strength: 0.6,
        httpStatus: 200,
        ret: "0",
        errmsg: "success",
        responseTextSha256: "a".repeat(64),
        request: { safe: true },
        previewImageUri: "tos-cn-i-tb4s082cfz/preview.png",
        previewImageUrl: "https://signed.example.invalid/preview.png?X-Amz-Signature=secret",
        body: { raw_url: "https://signed.example.invalid/raw.png?X-Amz-Signature=secret" },
      },
      poseDetection: {
        endpoint: "/mweb/v1/pose_detect",
        imageUri: "tos-cn-i-tb4s082cfz/reference.png",
        httpStatus: 200,
        ret: "0",
        errmsg: "success",
        responseTextSha256: "b".repeat(64),
        request: { uri: "tos-cn-i-tb4s082cfz/reference.png" },
        isPose: true,
        body: { raw_url: "https://signed.example.invalid/pose.png?X-Amz-Signature=secret" },
      },
    })

    expect(summary.preview_image_uri).toBe("tos-cn-i-tb4s082cfz/preview.png")
    expect(summary.preview_image_url_present).toBe(true)
    expect(summary.pose_detected).toBe(true)
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("X-Amz-Signature")
  })

  test("builds save params for every observed ControlNet control and leaves style catalog-only", () => {
    for (const control of ["pose", "depth", "canny"] as JimengControlNetKind[]) {
      expect(buildJimengControlNetSaveParams({
        imageUri: "tos-cn-i-tb4s082cfz/reference.png",
        control,
        strength: 60,
        previewImageUri: "tos-cn-i-tb4s082cfz/preview.png",
        previewImageUrl: "https://signed.example.invalid/preview.png?X-Amz-Signature=secret",
        fitMode: "adapt_to_canvas",
      })).toMatchObject({
        model: {
          abilityName: "control_net",
          controlNet: {
            name: control,
            strength: 0.6,
            imageIndex: 0,
            [control]: {
              originImage: { imageUri: "tos-cn-i-tb4s082cfz/reference.png" },
              previewImage: { imageUri: "tos-cn-i-tb4s082cfz/preview.png" },
            },
          },
          extra: {
            name: control,
            fitMode: "adapt_to_canvas",
            imageIndex: 0,
          },
        },
      })
      expect(jimengReferenceControlEvidence(control).previewSupported).toBe(true)
    }
    expect(jimengReferenceControlEvidence("style").previewSupported).toBe(false)
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
