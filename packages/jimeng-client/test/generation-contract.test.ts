import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengGenerationContractReport,
  parseJimengGenerationProof,
  summarizeJimengGenerationProof,
  writeJimengGenerationContractReportMarkdown,
} from "../src"
import { type JsonValue } from "../src/reference-image"

const fixtureRoot = path.resolve(import.meta.dir, "fixtures/contract-infer/live-matrix-mini")
const text2VideoFixture = path.join(fixtureRoot, "text2video-kbeauty-hook/normalized/text2video-result.json")

describe("Jimeng generation contract", () => {
  test("parses a normalized live generation proof and summarizes relied-on paths", () => {
    const proof = parseJimengGenerationProof(readJson(text2VideoFixture), "text2video fixture", "text2video-result.json")
    const summary = summarizeJimengGenerationProof(proof)

    expect(summary).toMatchObject({
      source_file: "text2video-result.json",
      command: "text2video",
      op: "video",
      submit_kind: "workbench_json",
      poll_kind: "history_by_submit_id",
      ret: "0",
      submit_ret: "0",
      terminal_status: 50,
      latest_poll_status: 50,
      final_status: 20,
      generate_type: 10,
      model_req_key: "dreamina_ic_generate_video_model_vgfm_3.0_fast",
      function_mode: "first_last_frames",
      ratio: "9:16",
      resolution: "720p",
      duration_ms: 3000,
      fps: 24,
      seed: 2026061201,
      artifact_count: 1,
      artifact_kinds: ["video"],
    })
    expect(summary.prompt).toContain("韩系美妆UGC创作者")
    expect(proof.submitDraftContent.component_list).toBeArray()
    expect(proof.finalAigcData?.model_info).toBeDefined()
  })

  test("reports all generation proof fixtures without accepting TTS-only fixtures", () => {
    const report = buildJimengGenerationContractReport(fixtureRoot)

    expect(report.proof_count).toBe(1)
    expect(report.skipped_json_count).toBe(0)
    expect(report.summaries.map((summary) => summary.command)).toEqual(["text2video"])
    expect(writeJimengGenerationContractReportMarkdown(report)).toContain("Jimeng Generation Contract Report")
  })

  test("rejects drift in required generation proof paths", () => {
    const value = readJson(text2VideoFixture)
    if (value && typeof value === "object" && !Array.isArray(value)) {
      delete value.plan
    }

    expect(() => parseJimengGenerationProof(value, "broken fixture")).toThrow("Jimeng generation proof contract did not match required fields")
  })
})

function readJson(file: string): JsonValue {
  return JSON.parse(readFileSync(file, "utf8")) as JsonValue
}
