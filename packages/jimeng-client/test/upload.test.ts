import { describe, expect, test } from "bun:test"
import {
  getJimengUploadToken,
  parseUploadTokenScene,
  summarizeUploadTokenBody,
  type JimengFetch,
  type JimengSessionBundle,
  JimengClient,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng upload helpers", () => {
  test("parses upload token scenes", () => {
    expect(parseUploadTokenScene(undefined)).toBe(2)
    expect(parseUploadTokenScene("image")).toBe(2)
    expect(parseUploadTokenScene("video")).toBe(1)
    expect(parseUploadTokenScene("file")).toBe(3)
    expect(parseUploadTokenScene("3")).toBe(3)
    expect(() => parseUploadTokenScene("missing")).toThrow("Unknown Jimeng upload-token scene")
  })

  test("summarizes upload token body without exposing credentials", () => {
    expect(summarizeUploadTokenBody(2, uploadTokenBody())).toEqual({
      scene: 2,
      region: "cn",
      spaceName: "tb4s082cfz",
      uploadDomainPresent: true,
      accessKeyPresent: true,
      secretKeyPresent: true,
      sessionTokenPresent: true,
      expiredTimePresent: true,
      currentTimePresent: true,
      dataKeys: [
        "access_key_id",
        "secret_access_key",
        "session_token",
        "expired_time",
        "current_time",
        "space_name",
        "upload_domain",
        "region",
      ],
    })
  })

  test("getJimengUploadToken posts scene and returns redaction-safe summary", async () => {
    const requests: Array<{ url: string; body: string | null }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(uploadTokenBody()), requests),
    })

    const result = await getJimengUploadToken({
      client,
      session,
      token: { scene: 2 },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/get_upload_token")
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ scene: 2 })
    expect(result.ret).toBe("0")
    expect(result.summary.spaceName).toBe("tb4s082cfz")
    expect(JSON.stringify(result.summary)).not.toContain("sk")
  })
})

function uploadTokenBody(): Record<string, unknown> {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      access_key_id: "ak",
      secret_access_key: "sk",
      session_token: "token",
      expired_time: "1781000000",
      current_time: "1780990000",
      space_name: "tb4s082cfz",
      upload_domain: "https://example.invalid",
      region: "cn",
    },
  }
}

function mockFetch(text: string, requests: Array<{ url: string; body: string | null }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, body: typeof init?.body === "string" ? init.body : null })
    return new Response(text, { status: 200 })
  }
}
