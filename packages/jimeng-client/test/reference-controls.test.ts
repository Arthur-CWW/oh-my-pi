import { describe, expect, test } from "bun:test"
import {
  buildJimengControlNetPreviewRequest,
  buildJimengControlNetSaveParams,
  defaultControlNetPreviewBabiParam,
  defaultPoseDetectBabiParam,
  detectJimengPose,
  generateJimengControlNetPreview,
  JimengClient,
  JimengError,
  normalizeJimengControlNetStrength,
  parseJimengControlNetFitMode,
  parseJimengControlNetKind,
  summarizeControlNetReferenceInspection,
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
  test("validates controlnet flags", () => {
    expect(parseJimengControlNetKind(undefined)).toBe("pose")
    expect(parseJimengControlNetKind("DEPTH")).toBe("depth")
    expect(parseJimengControlNetFitMode(undefined)).toBe("center_crop")
    expect(parseJimengControlNetFitMode("adapt_to_canvas")).toBe("adapt_to_canvas")
    expect(normalizeJimengControlNetStrength(undefined)).toBe(0.6)
    expect(normalizeJimengControlNetStrength(60)).toBe(0.6)
    expect(normalizeJimengControlNetStrength(0.75)).toBe(0.75)
    expect(() => parseJimengControlNetKind("style")).toThrow(JimengError)
    expect(() => parseJimengControlNetFitMode("stretch")).toThrow(JimengError)
    expect(() => normalizeJimengControlNetStrength(120)).toThrow(JimengError)
  })

  test("builds the frontend blend_preview request shape", () => {
    expect(buildJimengControlNetPreviewRequest({
      imageUri: "tos-cn-i-tb4s082cfz/reference.png",
      control: "pose",
      strength: 60,
    })).toEqual({
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
})

function mockFetch(text: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    return new Response(text, { status: 200 })
  }
}
