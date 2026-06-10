import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengDiscoveryWorklist,
  readJimengCaptureAnalysisFile,
  readJimengEndpointProbeCandidateFile,
  summarizeJimengDiscoveryWorklist,
  type JsonObject,
  writeJimengDiscoveryWorklistMarkdown,
} from "../src"

describe("Jimeng discovery worklist", () => {
  test("prioritizes uncovered read-safe endpoints and hides already-covered captures by default", () => {
    const staticRoot = mkdtempSync(path.join(tmpdir(), "jimeng-discovery-worklist-"))
    try {
      writeFileSync(
        path.join(staticRoot, "bundle.js"),
        [
          `fetch("/mweb/v1/reference_profile/list")`,
          `fetch("/mweb/v1/get_history")`,
          `fetch("/mweb/v1/dreamina_subject/generate_voice")`,
        ].join("\n"),
        "utf8",
      )

      const worklist = buildJimengDiscoveryWorklist({
        analyses: [analysisFixture()],
        probeCandidates: [probeCandidateFixture()],
        staticRoots: [staticRoot],
        nowIso: "2026-06-10T00:00:00.000Z",
      })

      expect(worklist.skipped_known_count).toBe(1)
      expect(worklist.items.some((item) => item.endpoint === "/mweb/v1/get_history_by_ids")).toBe(false)
      const readGap = worklist.items.find((item) => item.endpoint === "/mweb/v1/reference_profile/list")
      expect(readGap?.recommended_action).toBe("probe_then_promote_cli")
      expect(readGap?.has_probe_variants).toBe(true)
      expect(readGap?.probe_variant_count).toBe(1)
      const blockedGap = worklist.items.find((item) => item.endpoint === "/mweb/v1/get_history")
      expect(blockedGap?.known_status).toBe("blocked")
      expect(blockedGap?.recommended_action).toBe("static_capture_needed")
      expect(blockedGap?.blocked_reason).toContain("Previous safe probes")
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/aigc_draft/generate")?.recommended_action).toBe("compare_dry_run_before_live")
      expect(worklist.items.find((item) => item.endpoint === "/mweb/v1/dreamina_subject/generate_voice")?.recommended_action).toBe("approval_or_disposable_fixture")
      expect(worklist.probe_variant_exports).toHaveLength(1)
      expect(worklist.probe_variant_exports[0]?.endpoint).toBe("/mweb/v1/reference_profile/list")
    } finally {
      rmSync(staticRoot, { recursive: true, force: true })
    }
  })

  test("can include already-covered endpoints for audit views", () => {
    const worklist = buildJimengDiscoveryWorklist({
      analyses: [analysisFixture()],
      includeKnown: true,
      nowIso: "2026-06-10T00:00:00.000Z",
    })

    const covered = worklist.items.find((item) => item.endpoint === "/mweb/v1/get_history_by_ids")
    expect(covered?.recommended_action).toBe("already_covered")
    expect(covered?.known_command).toBe("history-records")
  })

  test("validates saved analysis/probe files and renders normalized summaries without probe bodies", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-discovery-worklist-files-"))
    try {
      const analysisFile = path.join(dir, "analysis.json")
      const probeFile = path.join(dir, "probe-candidates.json")
      writeFileSync(analysisFile, JSON.stringify(analysisFixture()), "utf8")
      writeFileSync(probeFile, JSON.stringify({ candidates: [probeCandidateFixture()] }), "utf8")

      const analysis = readJimengCaptureAnalysisFile(analysisFile)
      const probeCandidates = readJimengEndpointProbeCandidateFile(probeFile)
      const worklist = buildJimengDiscoveryWorklist({
        analyses: [analysis],
        analysisFiles: [analysisFile],
        probeCandidates,
        nowIso: "2026-06-10T00:00:00.000Z",
      })
      const summary = summarizeJimengDiscoveryWorklist(worklist)
      const markdown = writeJimengDiscoveryWorklistMarkdown(worklist)

      expect(markdown).toContain("Jimeng Discovery Worklist")
      expect(markdown).toContain("/mweb/v1/reference_profile/list")
      expect(JSON.stringify(summary)).not.toContain("secret-style-reference")
      expect(worklist.probe_variant_exports[0]?.variants[0]?.body).toEqual({ cursor: 0, keyword: "secret-style-reference" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function analysisFixture() {
  return {
    source_path: "/tmp/raw-network.jsonl",
    analyzed_at_iso: "2026-06-10T00:00:00.000Z",
    total_events: 9,
    total_requests: 3,
    candidates: [
      candidateFixture({
        rank: 1,
        endpoint: "/mweb/v1/reference_profile/list",
        riskClass: "read",
        replaySafe: true,
        requestShape: { kind: "object", keys: ["cursor", "keyword"] },
      }),
      candidateFixture({
        rank: 2,
        endpoint: "/mweb/v1/aigc_draft/generate",
        riskClass: "generate",
        replaySafe: false,
        requestShape: { kind: "object", keys: ["draft_content", "submit_id"] },
      }),
      candidateFixture({
        rank: 3,
        endpoint: "/mweb/v1/get_history_by_ids",
        riskClass: "read",
        replaySafe: true,
        requestShape: { kind: "object", keys: ["submit_ids"] },
      }),
    ],
  }
}

function candidateFixture(input: {
  rank: number
  endpoint: string
  riskClass: "read" | "generate"
  replaySafe: boolean
  requestShape: JsonObject
}) {
  return {
    rank: input.rank,
    method: "POST",
    endpoint: input.endpoint,
    url_host: "jimeng.jianying.com",
    url_pathname: input.endpoint,
    status: 200,
    risk_class: input.riskClass,
    replay_safe_by_default: input.replaySafe,
    score: 120 - input.rank,
    reasons: ["same-origin", "mweb-api", "json-request"],
    request_body_sha256: `request-${input.rank}`,
    response_text_sha256: `response-${input.rank}`,
    response_ret: "0",
    response_errmsg: "success",
    request_shape: input.requestShape,
    response_shape: { kind: "object", keys: ["ret", "errmsg", "data"] },
    initiator_functions: ["requestBuilder"],
    initiator_scripts: ["static/js/demo.js"],
    static_hints: [],
  }
}

function probeCandidateFixture() {
  return {
    name: "reference-profile-list",
    endpoint: "/mweb/v1/reference_profile/list",
    method: "POST" as const,
    query: null,
    risk_class: "read" as const,
    replay_safe_by_default: true,
    variants: [
      {
        name: "captured",
        body: { cursor: 0, keyword: "secret-style-reference" },
      },
    ],
  }
}
