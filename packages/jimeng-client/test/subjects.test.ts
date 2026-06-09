import { describe, expect, test } from "bun:test"
import {
  buildJimengSubjectsRequest,
  fetchJimengSubjects,
  JimengClient,
  JimengError,
  summarizeJimengSubjects,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng subject/persona helpers", () => {
  test("builds and validates subject list requests", () => {
    expect(buildJimengSubjectsRequest()).toEqual({ cursor: 0, limit: 20 })
    expect(buildJimengSubjectsRequest({ cursor: 10, limit: 50 })).toEqual({ cursor: 10, limit: 50 })
    expect(() => buildJimengSubjectsRequest({ cursor: -1 })).toThrow(JimengError)
    expect(() => buildJimengSubjectsRequest({ limit: 101 })).toThrow(JimengError)
  })

  test("fetches saved subjects and normalizes durable persona fields", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          next_cursor: 20,
          has_more: true,
          data_list: [{
            subject_id: "subject-1",
            name: "K-beauty host",
            desc: "Polished skincare creator",
            status: 1,
            create_time: "1781000000",
            cover_image: {
              image_uri: "tos-cn-i-tb4s082cfz/cover.png",
              image_url: "https://signed.example.invalid/cover.png?X-Amz-Signature=secret",
            },
            image_list: [
              { image_uri: "tos-cn-i-tb4s082cfz/ref-1.png" },
              { image: { uri: "tos-cn-i-tb4s082cfz/ref-2.png" } },
            ],
            voice_list: [
              { id_info: { id: "voice-1" } },
              { tone_id: "voice-2" },
            ],
          }],
        },
      }), requests),
    })

    const result = await fetchJimengSubjects({
      client,
      session,
      query: { cursor: 0, limit: 20 },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/dreamina_subject/get")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ cursor: 0, limit: 20 })
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(20)
    expect(result.subjects).toEqual([{
      subjectId: "subject-1",
      name: "K-beauty host",
      description: "Polished skincare creator",
      status: 1,
      createTime: "1781000000",
      updateTime: null,
      coverImageUri: "tos-cn-i-tb4s082cfz/cover.png",
      coverImageUrl: "https://signed.example.invalid/cover.png?X-Amz-Signature=secret",
      imageUris: ["tos-cn-i-tb4s082cfz/ref-1.png", "tos-cn-i-tb4s082cfz/ref-2.png"],
      voiceIds: ["voice-1", "voice-2"],
    }])
  })

  test("summarizes subjects without signed media URLs", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: 0,
        errmsg: "success",
        data: {
          next_cursor: 0,
          has_more: false,
          data_list: [{
            id: "subject-1",
            title: "Persona",
            coverImageUrl: "https://signed.example.invalid/cover.png?X-Amz-Signature=secret",
            coverImageUri: "tos-cn-i-tb4s082cfz/cover.png",
          }],
        },
      }), []),
    })

    const result = await fetchJimengSubjects({ client, session })
    const summary = summarizeJimengSubjects(result)

    expect(summary.subject_count).toBe(1)
    expect(JSON.stringify(summary)).toContain("cover_image_url_present")
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
