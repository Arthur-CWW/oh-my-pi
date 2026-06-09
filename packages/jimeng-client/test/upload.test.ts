import { describe, expect, test } from "bun:test"
import {
  getJimengUploadToken,
  parseUploadTokenScene,
  signJimengImageXRequest,
  summarizeUploadTokenBody,
  uploadJimengImage,
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

  test("signs ImageX apply requests with the frontend AWS4-style signer", () => {
    const signed = signJimengImageXRequest({
      method: "GET",
      host: "https://imagex.bytedanceapi.com",
      region: "cn-north-1",
      service: "imagex",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      sessionToken: "token",
      params: {
        Action: "ApplyImageUpload",
        Version: "2018-08-01",
        ServiceId: "tb4s082cfz",
        UploadNum: "1",
        FileExtension: ".png",
        s: "abc123",
      },
      date: new Date("2026-06-09T20:23:20.000Z"),
    })

    expect(signed.url).toBe("https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=tb4s082cfz&UploadNum=1&FileExtension=.png&s=abc123")
    expect(signed.headers["X-Amz-Date"]).toBe("20260609T202320Z")
    expect(signed.headers["x-amz-security-token"]).toBe("token")
    expect(signed.signedHeaders).toBe("x-amz-date;x-amz-security-token")
    expect(signed.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=ak/20260609/cn-north-1/imagex/aws4_request, SignedHeaders=x-amz-date;x-amz-security-token, Signature=f4bf1806f1b54d3b51cdd04482dcb18b9b63b39358f3ab789ce1c6a6a26114f8",
    )
  })

  test("uploads a local image through token, apply, direct upload, and commit", async () => {
    const requests: Array<{ url: string; method: string; headers: Record<string, string>; bodyText: string | null; bodyBytes: number | null }> = []
    const client = new JimengClient({
      fetch: mockImageUploadFetch(requests),
    })

    const result = await uploadJimengImage({
      client,
      session,
      image: {
        fileName: "proof.png",
        bytes: proofPng(),
      },
    })

    expect(requests.map((request) => request.method)).toEqual(["POST", "GET", "POST", "POST"])
    expect(requests[0]?.url).toContain("/mweb/v1/get_upload_token")
    expect(requests[1]?.url).toContain("Action=ApplyImageUpload")
    expect(requests[1]?.headers.Authorization).toContain("AWS4-HMAC-SHA256 Credential=ak/")
    expect(requests[2]?.url).toBe("https://upload.example.invalid/upload/v1/tos-cn-i-tb4s082cfz/example.png")
    expect(requests[2]?.headers["Content-CRC32"]).toBe("9050a959")
    expect(requests[2]?.bodyBytes).toBe(68)
    expect(requests[3]?.url).toContain("Action=CommitImageUpload")
    expect(requests[3]?.bodyText).toBe(JSON.stringify({ SessionKey: "session-key" }))
    expect(result.summary.imageUris).toEqual(["tos-cn-i-tb4s082cfz/example.png"])
    expect(result.summary.pluginResults[0]).toEqual({
      imageUri: "tos-cn-i-tb4s082cfz/example.png",
      imageWidth: 1,
      imageHeight: 1,
      imageFormat: "png",
      imageSize: 68,
    })
    expect(JSON.stringify(result.summary)).not.toContain("auth-token")
    expect(JSON.stringify(result.summary)).not.toContain("session-key")
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

function mockImageUploadFetch(requests: Array<{ url: string; method: string; headers: Record<string, string>; bodyText: string | null; bodyBytes: number | null }>): JimengFetch {
  return async (url, init) => {
    const bodyInfo = await requestBodyInfo(init?.body)
    requests.push({
      url,
      method: init?.method ?? "GET",
      headers: headersToRecord(init?.headers),
      bodyText: bodyInfo.text,
      bodyBytes: bodyInfo.bytes,
    })

    if (url.includes("/mweb/v1/get_upload_token")) return jsonResponse(uploadTokenBody())
    if (url.includes("Action=ApplyImageUpload")) return jsonResponse(applyImageUploadBody())
    if (url.includes("/upload/v1/")) return jsonResponse({ code: 2000, message: "Success", data: { crc32: "9050a959" } })
    if (url.includes("Action=CommitImageUpload")) return jsonResponse(commitImageUploadBody())
    return jsonResponse({ error: "unexpected url" }, 404)
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

async function requestBodyInfo(body: BodyInit | null | undefined): Promise<{ text: string | null; bytes: number | null }> {
  if (!body) return { text: null, bytes: null }
  if (typeof body === "string") return { text: body, bytes: Buffer.byteLength(body) }
  if (body instanceof Blob) return { text: null, bytes: (await body.arrayBuffer()).byteLength }
  return { text: null, bytes: null }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}

function proofPng(): Uint8Array {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
}

function applyImageUploadBody(): Record<string, unknown> {
  return {
    ResponseMetadata: {
      RequestId: "request-id",
      Action: "ApplyImageUpload",
      Version: "2018-08-01",
      Service: "imagex",
      Region: "cn-north-1",
    },
    Result: {
      UploadAddress: {
        SessionKey: "session-key",
        UploadHosts: ["upload.example.invalid"],
        UploadHeader: {},
        StoreInfos: [
          {
            StoreUri: "tos-cn-i-tb4s082cfz/example.png",
            Auth: "auth-token",
          },
        ],
      },
    },
  }
}

function commitImageUploadBody(): Record<string, unknown> {
  return {
    ResponseMetadata: {
      RequestId: "request-id",
      Action: "CommitImageUpload",
      Version: "2018-08-01",
      Service: "imagex",
      Region: "cn-north-1",
    },
    Result: {
      Results: [
        {
          Uri: "tos-cn-i-tb4s082cfz/example.png",
          UriStatus: 2000,
        },
      ],
      PluginResult: [
        {
          ImageUri: "tos-cn-i-tb4s082cfz/example.png",
          ImageWidth: 1,
          ImageHeight: 1,
          ImageFormat: "png",
          ImageSize: 68,
        },
      ],
    },
  }
}
