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
const personaVoiceFixtureDir = path.resolve(import.meta.dir, "fixtures/contract-infer/persona-voice-mini")
const lipSyncHumanFixtureDir = path.resolve(import.meta.dir, "fixtures/contract-infer/lip-sync-human-mini")

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

  test("extracts endpoint sequences and persona-voice flags from dry-run packet plans", () => {
    const inference = inferJimengContractsFromPath({
      inputPath: personaVoiceFixtureDir,
      generatedAtIso: "2026-06-12T00:00:00.000Z",
    })

    expect(inference.file_count).toBe(4)
    expect(inference.endpoints.map((endpoint) => endpoint.endpoint)).toEqual([
      "/mweb/v1/dreamina_subject/generate_voice",
      "/mweb/v1/mix_audio_video",
      "/mweb/v1/voice/query_task",
      "/mweb/v1/voice/submit_task",
    ])

    const subjectVoice = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/dreamina_subject/generate_voice")
    expect(subjectVoice?.commands).toEqual(["subject-generate-voice"])
    expect(subjectVoice?.cli_flag_suggestions).toContain("--imageUri")
    expect(subjectVoice?.effect_schema_ir.required_paths.map((entry) => entry.path)).toEqual([
      "request",
      "request.image_uri",
    ])

    const voiceSubmit = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/voice/submit_task")
    expect(voiceSubmit?.commands).toEqual(["voice-clone-submit"])
    expect(voiceSubmit?.cli_flag_suggestions).toEqual(expect.arrayContaining(["--audioVid", "--name"]))
    expect(voiceSubmit?.effect_schema_ir.required_paths.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "request.voice_clone.audio.vid",
      "request.voice_clone.audio.duration",
      "request.voice_clone.audio.title",
      "request.voice_clone.name",
    ]))

    const voiceQuery = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/voice/query_task")
    expect(voiceQuery?.cli_flag_suggestions).toContain("--taskIds")
    expect(voiceQuery?.effect_schema_ir.required_paths.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "request.task_id_list",
      "request.task_id_list[]",
    ]))

    const mixAudio = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/mix_audio_video")
    expect(mixAudio?.cli_flag_suggestions).toEqual(expect.arrayContaining(["--audioVid", "--videoItemId"]))
    expect(mixAudio?.effect_schema_ir.required_paths.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "request.input.audio_vid",
      "request.input.video_item_id",
      "query_params.babi_param",
    ]))
  })

  test("extracts lip-sync and digital-human plan endpoints from packet plans", () => {
    const inference = inferJimengContractsFromPath({
      inputPath: lipSyncHumanFixtureDir,
      generatedAtIso: "2026-06-12T00:00:00.000Z",
    })

    expect(inference.file_count).toBe(4)
    expect(inference.endpoints.map((endpoint) => endpoint.endpoint)).toEqual([
      "/mweb/v1/aigc_draft/generate",
      "/mweb/v1/video_generate/mget_pre_process_result",
      "/mweb/v1/video_generate/pre_process",
    ])

    const generate = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/aigc_draft/generate")
    expect(generate?.commands).toEqual(["lip-sync"])
    expect(generate?.cli_flag_suggestions).toEqual(expect.arrayContaining([
      "--imageUri",
      "--mode",
      "--modelReqKey",
      "--speed",
      "--text",
      "--videoUri",
      "--videoVid",
      "--voice-id",
    ]))
    expect(generate?.observed_packet_slices).toEqual(expect.arrayContaining(["lip-sync-image-avatar", "lip-sync-vod"]))

    const preprocess = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/video_generate/pre_process")
    expect(preprocess?.commands).toEqual(["video-preprocess-plan"])
    expect(preprocess?.cli_flag_suggestions).toContain("--imageUri")

    const preprocessQuery = inference.endpoints.find((endpoint) => endpoint.endpoint === "/mweb/v1/video_generate/mget_pre_process_result")
    expect(preprocessQuery?.commands).toEqual(["video-preprocess-query-plan"])
    expect(preprocessQuery?.cli_flag_suggestions).toContain("--submitIds")
    expect(preprocess?.observed_packet_slices).toContain("video-preprocess")
    expect(preprocessQuery?.observed_packet_slices).toContain("video-preprocess-query")
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
