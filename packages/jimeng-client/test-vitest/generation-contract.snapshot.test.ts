import path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  buildJimengGenerationContractReport,
  writeJimengGenerationContractReportMarkdown,
} from "../src"

describe("Jimeng generation contract snapshots", () => {
  it.effect("snapshots normalized generation proof summaries", () =>
    Effect.sync(() => {
      const fixtureRoot = path.resolve(import.meta.dirname, "../test/fixtures/contract-infer/live-matrix-mini")
      const report = buildJimengGenerationContractReport(fixtureRoot)

      expect(report.summaries.map((summary) => ({
        command: summary.command,
        op: summary.op,
        submit_kind: summary.submit_kind,
        poll_kind: summary.poll_kind,
        ret: summary.ret,
        terminal_status: summary.terminal_status,
        latest_poll_status: summary.latest_poll_status,
        final_status: summary.final_status,
        generate_type: summary.generate_type,
        model_req_key: summary.model_req_key,
        function_mode: summary.function_mode,
        ratio: summary.ratio,
        resolution: summary.resolution,
        duration_ms: summary.duration_ms,
        fps: summary.fps,
        has_first_frame: summary.has_first_frame,
        has_end_frame: summary.has_end_frame,
        artifact_count: summary.artifact_count,
        artifact_kinds: summary.artifact_kinds,
      }))).toMatchSnapshot()
      expect(writeJimengGenerationContractReportMarkdown(report)).toMatchSnapshot()
    }))
})
