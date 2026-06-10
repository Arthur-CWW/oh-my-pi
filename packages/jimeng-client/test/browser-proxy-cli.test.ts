import { describe, expect, test } from "bun:test"
import { redactJimengProofForNormalized } from "../src/browser-proxy-cli"
import { type JsonObject } from "../src"

describe("jimeng-browser-proxy normalized proof redaction", () => {
  test("redacts tokenized Jimeng URLs, signed media URLs, and credential fields", () => {
    const redacted = redactJimengProofForNormalized({
      plan: {
        submit_url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?aid=513695&msToken=secret&a_bogus=secret",
        poll_url: "https://jimeng.jianying.com/mweb/v1/get_history_by_ids?aid=513695&msToken=secret",
        submit_headers: {
          cookie: "sid=secret",
          "user-agent": "UnitTest/1.0",
        },
      },
      artifacts: [
        {
          kind: "video",
          url: "https://p11-dreamina-sign.byteimg.com/tos-cn-i/video.mp4?x-signature=secret&x-expires=123",
          saved_file: "/tmp/video.mp4",
        },
      ],
    }) as JsonObject

    expect(JSON.stringify(redacted)).not.toContain("msToken=secret")
    expect(JSON.stringify(redacted)).not.toContain("a_bogus=secret")
    expect(JSON.stringify(redacted)).not.toContain("x-signature=secret")
    expect(JSON.stringify(redacted)).not.toContain("sid=secret")
    expect(redacted).toMatchObject({
      plan: {
        submit_url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?[REDACTED_QUERY]",
        poll_url: "https://jimeng.jianying.com/mweb/v1/get_history_by_ids?[REDACTED_QUERY]",
        submit_headers: {
          cookie: "[REDACTED 10 chars]",
          "user-agent": "UnitTest/1.0",
        },
      },
      artifacts: [
        {
          kind: "video",
          url: "[SIGNED_URL_REDACTED]",
          saved_file: "/tmp/video.mp4",
        },
      ],
    })
  })
})
