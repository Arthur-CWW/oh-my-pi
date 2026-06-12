import path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { inferJimengContractsFromPath } from "../src"

describe("Jimeng contract inference snapshots", () => {
  it.effect("snapshots normalized contract-infer output from a proof bundle", () =>
    Effect.sync(() => {
      const fixtureDir = path.resolve(import.meta.dirname, "../test/fixtures/contract-infer/live-matrix-mini")
      const inference = inferJimengContractsFromPath({
        inputPath: fixtureDir,
        generatedAtIso: "2026-06-12T00:00:00.000Z",
      })

      expect({
        file_count: inference.file_count,
        artifact_count: inference.artifact_count,
        endpoints: inference.endpoints.map((endpoint) => ({
          endpoint: endpoint.endpoint,
          sample_count: endpoint.sample_count,
          commands: endpoint.commands,
          document_kinds: endpoint.document_kinds,
          http_statuses: endpoint.http_statuses,
          rets: endpoint.rets,
          cli_flag_suggestions: endpoint.cli_flag_suggestions,
          effect_schema_ir: {
            name: endpoint.effect_schema_ir.name,
            mode: endpoint.effect_schema_ir.mode,
            required_paths: endpoint.effect_schema_ir.required_paths.slice(0, 12),
          },
          registry_patch_draft: endpoint.registry_patch_draft,
        })),
        scaffold: inference.scaffold,
      }).toMatchSnapshot()
    }))

  it.effect("snapshots persona-voice packet contract scaffolds", () =>
    Effect.sync(() => {
      const fixtureDir = path.resolve(import.meta.dirname, "../test/fixtures/contract-infer/persona-voice-mini")
      const inference = inferJimengContractsFromPath({
        inputPath: fixtureDir,
        generatedAtIso: "2026-06-12T00:00:00.000Z",
      })

      expect({
        file_count: inference.file_count,
        endpoints: inference.endpoints.map((endpoint) => ({
          endpoint: endpoint.endpoint,
          sample_count: endpoint.sample_count,
          commands: endpoint.commands,
          document_kinds: endpoint.document_kinds,
          cli_flag_suggestions: endpoint.cli_flag_suggestions,
          effect_schema_ir: {
            name: endpoint.effect_schema_ir.name,
            mode: endpoint.effect_schema_ir.mode,
            required_paths: endpoint.effect_schema_ir.required_paths.slice(0, 12),
          },
          registry_patch_draft: endpoint.registry_patch_draft,
        })),
        scaffold: inference.scaffold,
      }).toMatchSnapshot()
    }))

  it.effect("snapshots lip-sync human packet contract scaffolds", () =>
    Effect.sync(() => {
      const fixtureDir = path.resolve(import.meta.dirname, "../test/fixtures/contract-infer/lip-sync-human-mini")
      const inference = inferJimengContractsFromPath({
        inputPath: fixtureDir,
        generatedAtIso: "2026-06-12T00:00:00.000Z",
      })

      expect({
        file_count: inference.file_count,
        endpoints: inference.endpoints.map((endpoint) => ({
          endpoint: endpoint.endpoint,
          sample_count: endpoint.sample_count,
          commands: endpoint.commands,
          document_kinds: endpoint.document_kinds,
          cli_flag_suggestions: endpoint.cli_flag_suggestions,
          effect_schema_ir: {
            name: endpoint.effect_schema_ir.name,
            mode: endpoint.effect_schema_ir.mode,
            required_paths: endpoint.effect_schema_ir.required_paths.slice(0, 12),
          },
          registry_patch_draft: endpoint.registry_patch_draft,
        })),
        scaffold: inference.scaffold,
      }).toMatchSnapshot()
    }))
})
