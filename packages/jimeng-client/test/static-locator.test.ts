import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  locateJimengStaticEndpoints,
  parseJimengStaticLocatorEndpoints,
  parseJimengStaticLocatorQueries,
  summarizeJimengStaticLocator,
  writeJimengStaticLocatorMarkdown,
} from "../src"

describe("Jimeng static locator", () => {
  test("parses endpoint CSV flags", () => {
    expect(parseJimengStaticLocatorEndpoints("/mweb/v1/a,/mweb/v1/b?x=1,https://jimeng.jianying.com/mweb/v1/c?token=secret")).toEqual([
      "/mweb/v1/a",
      "/mweb/v1/b",
      "/mweb/v1/c",
    ])
    expect(parseJimengStaticLocatorEndpoints(undefined)).toEqual([])
    expect(parseJimengStaticLocatorEndpoints("/mweb/search/v1/sug,/mweb/search/v1/search")).toEqual([
      "/mweb/search/v1/search",
      "/mweb/search/v1/sug",
    ])
  })

  test("parses static query CSV flags", () => {
    expect(parseJimengStaticLocatorQueries("SearchTemplates, GetTemplateHotWords ,, SearchTemplates")).toEqual([
      "GetTemplateHotWords",
      "SearchTemplates",
    ])
    expect(parseJimengStaticLocatorQueries(undefined)).toEqual([])
  })

  test("locates request-builder snippets and static follow-up commands", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-static-locator-"))
    try {
      const bundle = path.join(dir, "bundle.js")
      writeFileSync(
        bundle,
        [
          `const GenerateVoicePath = "/mweb/v1/dreamina_subject/generate_voice";`,
          `function submitSubjectVoice(payload) {`,
          `  return request.post(GenerateVoicePath, { scene: "subject_voice", image_uri: payload.image_uri });`,
          `}`,
        ].join("\n"),
        "utf8",
      )

      const result = locateJimengStaticEndpoints({
        staticRoots: [dir],
        endpoints: ["/mweb/v1/dreamina_subject/generate_voice"],
        contextLines: 2,
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summary = summarizeJimengStaticLocator(result)
      const markdown = writeJimengStaticLocatorMarkdown(result)

      expect(result.endpointResults[0]?.occurrenceCount).toBe(1)
      expect(result.endpointResults[0]?.targetKind).toBe("endpoint")
      expect(result.endpointResults[0]?.occurrences[0]?.nearbySymbols).toContain("GenerateVoicePath")
      expect(result.endpointResults[0]?.occurrences[0]?.nearbySymbols).toContain("submitSubjectVoice")
      expect(result.endpointResults[0]?.occurrences[0]?.suggestedAstGrepCommands[0]).toContain("mise x ast-grep")
      expect(JSON.stringify(summary)).toContain("subject_voice")
      expect(markdown).toContain("/mweb/v1/dreamina_subject/generate_voice")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("locates symbol queries beside endpoint terms", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-static-locator-query-"))
    try {
      const bundle = path.join(dir, "bundle.js")
      writeFileSync(
        bundle,
        [
          `const endpoints = { SearchTemplates: { url: "/lv/v1/cc_web/replicate/search_templates" } };`,
          `function buildPayload(keyword) {`,
          `  return { keyword, page_size: 20, cursor: "0" };`,
          `}`,
          `client.post(endpoints.SearchTemplates.url, buildPayload("serum"));`,
        ].join("\n"),
        "utf8",
      )

      const result = locateJimengStaticEndpoints({
        staticRoots: [dir],
        endpoints: ["/lv/v1/cc_web/replicate/search_templates"],
        queries: ["SearchTemplates"],
        contextLines: 1,
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summary = summarizeJimengStaticLocator(result)

      expect(result.endpoints).toEqual(["/lv/v1/cc_web/replicate/search_templates"])
      expect(result.queries).toEqual(["SearchTemplates"])
      expect(result.endpointResults.map((item) => item.targetKind).sort()).toEqual(["endpoint", "query"])
      expect(JSON.stringify(summary)).toContain("buildPayload")
      expect(summary.query_count).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("can derive endpoints from analysis files and redacts signed URL query strings", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-static-locator-analysis-"))
    try {
      const staticRoot = path.join(dir, "src")
      mkdirSync(staticRoot)
      const analysisFile = path.join(dir, "analysis.json")
      const bundle = path.join(staticRoot, "bundle.js")
      writeFileSync(analysisFile, JSON.stringify({
        source_path: "/tmp/raw-network.jsonl",
        candidates: [
          {
            method: "POST",
            url_pathname: "/mweb/v1/get_video_by_vid",
            risk_class: "read",
          },
        ],
      }), "utf8")
      writeFileSync(
        bundle,
        `const url = "https://jimeng.jianying.com/mweb/v1/get_video_by_vid?x-signature=secret&token=also-secret";`,
        "utf8",
      )

      const result = locateJimengStaticEndpoints({
        staticRoots: [staticRoot],
        analysisFiles: [analysisFile],
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summaryText = JSON.stringify(summarizeJimengStaticLocator(result))

      expect(result.endpoints).toEqual(["/mweb/v1/get_video_by_vid"])
      expect(result.endpointResults[0]?.occurrenceCount).toBe(1)
      expect(summaryText).toContain("?<redacted-query>")
      expect(summaryText).not.toContain("also-secret")
      expect(summaryText).not.toContain("x-signature=secret")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
