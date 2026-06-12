import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import {
  inferJimengContractsFromPath,
  writeJimengContractInferenceMarkdown,
  writeJimengContractInferenceOutputs,
} from "../src"

const fixtureDir = path.resolve(import.meta.dir, "fixtures/contract-infer/live-matrix-mini")

describe("Jimeng contract inference", () => {
  test("groups proof bundle JSON by endpoint and suggests useful flags", () => {
    const inference = inferJimengContractsFromPath({
      inputPath: fixtureDir,
      generatedAtIso: "2026-06-12T00:00:00.000Z",
    })

    expect(inference.file_count).toBe(2)
    expect(inference.artifact_count).toBe(2)
    expect(inference.endpoints.map((endpoint) => endpoint.endpoint)).toEqual([
      "/mweb/v1/aigc_draft/generate",
      "/mweb/v1/get_history_by_ids",
      "/mweb/v1/tts_generate",
    ])

    const generate = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/aigc_draft/generate")
    expect(generate?.cli_flag_suggestions).toContain("--prompt")
    expect(generate?.cli_flag_suggestions).toContain("--modelReqKey")
    expect(generate?.effect_schema_ir.required_paths.some((entry) => entry.path.includes("draft_content"))).toBe(true)
  })

  test("writes scaffold files for review", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "jimeng-contract-infer-"))
    const inference = inferJimengContractsFromPath({
      inputPath: fixtureDir,
      endpoint: "/mweb/v1/aigc_draft/generate",
      generatedAtIso: "2026-06-12T00:00:00.000Z",
    })
    const files = writeJimengContractInferenceOutputs(inference, outDir)

    expect(existsSync(files.summaryJson)).toBe(true)
    expect(existsSync(files.summaryMarkdown)).toBe(true)
    expect(existsSync(files.schemaIrJson)).toBe(true)
    expect(existsSync(files.registryPatchDraftJson)).toBe(true)
    expect(readFileSync(files.summaryMarkdown, "utf8")).toContain("/mweb/v1/aigc_draft/generate")
  })

  test("renders markdown summary", () => {
    const inference = inferJimengContractsFromPath({
      inputPath: fixtureDir,
      endpoint: "/mweb/v1/tts_generate",
      generatedAtIso: "2026-06-12T00:00:00.000Z",
    })

    expect(writeJimengContractInferenceMarkdown(inference)).toContain("CLI flag suggestions")
  })
})
