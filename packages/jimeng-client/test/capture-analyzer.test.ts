import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { analyzeJimengNetworkCapture, writeJimengCaptureAnalysisMarkdown } from "../src"

describe("Jimeng capture analyzer", () => {
  test("ranks captured API calls and emits only safe replay candidates by default", () => {
    const staticRoot = mkdtempSync(path.join(tmpdir(), "jimeng-capture-analyzer-"))
    try {
      writeFileSync(path.join(staticRoot, "bundle.js"), `fetch("/mweb/v1/get_history_by_ids")\n`, "utf8")
      const analysis = analyzeJimengNetworkCapture({
        rawNetworkText: jsonl(
          requestEvent("read-1", "/mweb/v1/get_history_by_ids?aid=513695", { submit_ids: ["submit-1"] }, "getHistory"),
          responseEvent("read-1", "/mweb/v1/get_history_by_ids?aid=513695"),
          responseBodyEvent("read-1", "/mweb/v1/get_history_by_ids?aid=513695", {
            ret: "0",
            errmsg: "success",
            data: {
              item_list: [
                {
                  image_url: "https://signed.example.invalid/image.png?x-signature=secret",
                  width: 1024,
                },
              ],
            },
          }),
          requestEvent("gen-1", "/mweb/v1/aigc_draft/generate?aid=513695", { draft_content: "{}", submit_id: "old" }, "generateVideo"),
          responseEvent("gen-1", "/mweb/v1/aigc_draft/generate?aid=513695"),
          responseBodyEvent("gen-1", "/mweb/v1/aigc_draft/generate?aid=513695", { ret: "0", errmsg: "success" }),
        ),
        staticRoots: [staticRoot],
      })

      expect(analysis.total_events).toBe(6)
      expect(analysis.total_requests).toBe(2)
      expect(analysis.candidates.map((candidate) => candidate.url_pathname)).toContain("/mweb/v1/get_history_by_ids")
      expect(analysis.candidates.find((candidate) => candidate.url_pathname === "/mweb/v1/get_history_by_ids")?.risk_class).toBe("read")
      expect(analysis.candidates.find((candidate) => candidate.url_pathname === "/mweb/v1/aigc_draft/generate")?.risk_class).toBe("generate")
      expect(analysis.candidates.find((candidate) => candidate.url_pathname === "/mweb/v1/get_history_by_ids")?.static_hints[0]?.file).toBe(path.join(staticRoot, "bundle.js"))
      expect(analysis.endpoint_probe_candidates).toHaveLength(1)
      expect(analysis.endpoint_probe_candidates[0]?.endpoint).toBe("/mweb/v1/get_history_by_ids")
      expect(analysis.endpoint_probe_candidates[0]?.variants[0]?.body).toEqual({ submit_ids: ["submit-1"] })
      expect(JSON.stringify(analysis.candidates)).not.toContain("signed.example.invalid")
      expect(JSON.stringify(analysis.candidates)).not.toContain("x-signature=secret")
    } finally {
      rmSync(staticRoot, { recursive: true, force: true })
    }
  })

  test("can include risky endpoints when explicitly requested", () => {
    const analysis = analyzeJimengNetworkCapture({
      rawNetworkText: jsonl(
        requestEvent("gen-1", "/mweb/v1/aigc_draft/generate?aid=513695", { prompt: "hello" }, "generate"),
        responseEvent("gen-1", "/mweb/v1/aigc_draft/generate?aid=513695"),
        responseBodyEvent("gen-1", "/mweb/v1/aigc_draft/generate?aid=513695", { ret: "0", errmsg: "success" }),
      ),
      includeRisky: true,
    })

    expect(analysis.endpoint_probe_candidates).toHaveLength(1)
    expect(analysis.endpoint_probe_candidates[0]?.risk_class).toBe("generate")
    expect(analysis.endpoint_probe_candidates[0]?.replay_safe_by_default).toBe(false)
  })

  test("renders markdown summary for proof review", () => {
    const analysis = analyzeJimengNetworkCapture({
      rawNetworkText: jsonl(
        requestEvent("read-1", "/mweb/v1/get_unread_count?aid=513695", { notice_type_list: [1, 2] }, "getUnread"),
        responseEvent("read-1", "/mweb/v1/get_unread_count?aid=513695"),
        responseBodyEvent("read-1", "/mweb/v1/get_unread_count?aid=513695", { ret: "0", errmsg: "success", data: { 1: 0, 2: 1 } }),
      ),
    })
    const markdown = writeJimengCaptureAnalysisMarkdown(analysis)
    expect(markdown).toContain("Jimeng Capture Analysis")
    expect(markdown).toContain("/mweb/v1/get_unread_count")
    expect(markdown).toContain("Safe Replay")
  })

  test("fails malformed JSONL through the boundary contract", () => {
    expect(() => analyzeJimengNetworkCapture({ rawNetworkText: "{not-json}\n" })).toThrow("Raw network JSONL line was not valid JSON")
  })
})

function jsonl(...events: object[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
}

function requestEvent(requestId: string, endpoint: string, postData: object, functionName: string) {
  return {
    kind: "cdpEvent",
    method: "Network.requestWillBeSent",
    params: {
      requestId,
      type: "XHR",
      documentURL: "https://jimeng.jianying.com/ai-tool/generate/",
      request: {
        url: `https://jimeng.jianying.com${endpoint}`,
        method: "POST",
        headers: { "content-type": "application/json" },
        postData: JSON.stringify(postData),
      },
      initiator: {
        type: "script",
        stack: {
          callFrames: [
            {
              functionName,
              url: "https://lf3-lv-buz.vlabstatic.com/static/js/async/demo.js?x=1",
              lineNumber: 0,
              columnNumber: 42,
            },
          ],
        },
      },
    },
  }
}

function responseEvent(requestId: string, endpoint: string) {
  return {
    kind: "cdpEvent",
    method: "Network.responseReceived",
    params: {
      requestId,
      type: "XHR",
      response: {
        url: `https://jimeng.jianying.com${endpoint}`,
        status: 200,
        headers: { "content-type": "application/json" },
        mimeType: "application/json",
      },
    },
  }
}

function responseBodyEvent(requestId: string, endpoint: string, body: object) {
  return {
    kind: "responseBody",
    requestId,
    url: `https://jimeng.jianying.com${endpoint}`,
    status: 200,
    mimeType: "application/json",
    truncatedBytes: false,
    body: JSON.stringify(body),
  }
}
