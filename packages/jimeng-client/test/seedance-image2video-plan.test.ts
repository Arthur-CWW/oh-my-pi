import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { decodeGeneratedVideoClipsV1 } from "@wirebabel/media-contracts"
import { describe, expect, test } from "bun:test"
import {
  buildSeedanceImage2VideoDryRunPlan,
  buildSeedanceFirstFrameConditioningPlan,
  summarizeSeedanceImage2VideoDryRunPlan,
} from "../src/seedance-image2video-plan"

const createdAt = "2026-06-24T00:00:00.000Z"
const originalHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

function basePlanInput() {
  return {
    prompt: "Original ASMR companion holds eye contact in moonlit server shrine, no text",
    negativePrompt: "logos, protected character, real person likeness",
    ratio: "9:16",
    durationSec: 5,
    fps: 24,
    seed: 2026062401,
    submitId: "seedance-plan-submit-001",
    runId: "seedance-plan-run-001",
    createdAt,
    requestPath: "data/asmr-companion/goal2/seedance-plan/raw/request.json",
    responsePath: "data/asmr-companion/goal2/seedance-plan/normalized/response-placeholder.json",
    artifactPath: "data/asmr-companion/goal2/seedance-plan/artifacts/seedance-plan-run-001.mp4",
    firstFrame: {
      sourceAssetId: "first-frame-candidate-001",
      firstFrameUri: "tos://fixture/seedance/first-frame-candidate-001.png",
      firstFrameHash: originalHash,
      conditioningManifestPath: "data/asmr-companion/goal2/seedance-plan/normalized/first-frame-conditioning.json",
      createdAt,
    },
  }
}

describe("Seedance image-to-video dry-run planning", () => {
  test("builds a deterministic direct first-frame Seedance plan without changing existing video-plan command names", () => {
    const first = buildSeedanceImage2VideoDryRunPlan(basePlanInput())
    const second = buildSeedanceImage2VideoDryRunPlan(basePlanInput())

    expect(first).toEqual(second)
    expect(first.liveSubmit).toBe(false)
    expect(first.videoPlan.modelVersion).toBe("jimeng-video-seedance-2.0")
    expect(first.videoPlan.hasFirstFrame).toBe(true)
    expect(first.conditioningManifest.conditioning.applied).toBe(false)
    expect(first.conditioningManifest.firstFrame.conditionedProviderUri).toBe("tos://fixture/seedance/first-frame-candidate-001.png")
    expect(first.generatedVideoClipsManifest.clips[0].firstFrame.originalHash.value).toBe(originalHash)
    expect(first.generatedVideoClipsManifest.clips[0].firstFrame.conditionedHash.value).toBe(originalHash)
  })

  test("conditions Gemini/SynthID-marked sidecar provenance while preserving disclosure", () => {
    const baseInput = basePlanInput()
    const { sourceAssetId, ...firstFrameWithoutSourceAssetId } = baseInput.firstFrame
    expect(sourceAssetId).toBe("first-frame-candidate-001")
    const plan = buildSeedanceImage2VideoDryRunPlan({
      ...baseInput,
      runId: "seedance-plan-run-synthid-001",
      firstFrame: {
        ...firstFrameWithoutSourceAssetId,
        firstFrameProvenance: {
          schemaVersion: "analysis-tags.v1",
          manifestId: "analysis-tags-synthid-fixture",
          createdAt,
          sourceAsset: {
            assetId: "first-frame-candidate-001",
            uri: "local-reference://asmr-companion/first-frame-candidate-001.png",
            mediaType: "image/png",
            hash: { algorithm: "sha256", value: originalHash },
            provenance: {
              kind: "synthetic",
              sourceName: "Gemini SynthID-marked fixture candidate",
              acquiredAt: createdAt,
              rightsSummary: "Synthetic fixture for no-spend planning tests.",
            },
          },
          analyzer: {
            provider: "fixture-local",
            model: "metadata-only-reviewer-v0",
            runId: "analysis-tags-synthid-fixture-run",
            analyzedAt: createdAt,
          },
          tags: [{ namespace: "ai-origin", value: "synthid-marked-gemini", confidence: 1 }],
          analysisCopies: [],
          generationInputs: [{
            kind: "canonical_source_hash",
            sourceAssetId: "first-frame-candidate-001",
            sourceHash: { algorithm: "sha256", value: originalHash },
            intendedUse: "first_frame_provenance",
          }],
          sidecars: [],
        },
        synthIdMarked: true,
        conditioningParams: {
          resize_policy: "provider_safe_even_dimensions",
          denoise_strength: 0.12,
        },
      },
    })

    expect(plan.conditioningManifest.synthId.marked).toBe(true)
    expect(plan.conditioningManifest.synthId.evidence).toContain("explicit --synthIdMarked flag")
    expect(plan.conditioningManifest.conditioning.applied).toBe(true)
    expect(plan.conditioningManifest.firstFrame.conditionedHash).not.toBe(originalHash)
    expect(plan.generatedVideoClipsManifest.clips[0].firstFrame.providerUri.startsWith("tos://dry-run/seedance/")).toBe(true)
    expect(plan.generatedVideoClipsManifest.clips[0].firstFrame.sourceAssetId).toBe("first-frame-candidate-001")
    expect(plan.conditioningManifest.provenance).toMatchObject({
      sidecarSchemaVersion: "analysis-tags.v1",
      sidecarManifestId: "analysis-tags-synthid-fixture",
      sourceKind: "synthetic",
      sourceName: "Gemini SynthID-marked fixture candidate",
      rightsSummary: "Synthetic fixture for no-spend planning tests.",
      aiOriginDisclosed: true,
    })
    expect(plan.conditioningManifest.provenance.disclosure).toContain("Gemini/SynthID")
  })

  test("rejects unsafe first-frame provenance and output paths before manifest emission", () => {
    expect(() => buildSeedanceFirstFrameConditioningPlan({
      firstFrameHash: originalHash,
      firstFramePath: "../private/gemini-remake.png",
      conditioningManifestPath: "data/asmr-companion/goal2/conditioning.json",
      createdAt,
    })).toThrow(/path must not contain empty or parent segments/)

    expect(() => buildSeedanceImage2VideoDryRunPlan({
      ...basePlanInput(),
      firstFrame: {
        ...basePlanInput().firstFrame,
        conditionedFirstFrameUri: "file:///tmp/not-uploaded.png",
      },
    })).toThrow(/must be an uploaded provider URI|must be a provider URI/)
  })

  test("emits generated-video-clips.v1 compatible dry-run output", () => {
    const plan = buildSeedanceImage2VideoDryRunPlan(basePlanInput())
    const decoded = decodeGeneratedVideoClipsV1(plan.generatedVideoClipsManifest)
    const summary = summarizeSeedanceImage2VideoDryRunPlan(plan)

    expect(decoded.schemaVersion).toBe("generated-video-clips.v1")
    expect(decoded.clips[0].providerJob).toMatchObject({
      provider: "jimeng-seedance",
      model: "jimeng-video-seedance-2.0",
      accountClass: "dry-run-no-spend",
    })
    expect(decoded.clips[0].generation).toMatchObject({
      durationSec: 5,
      ratio: "9:16",
      fps: 24,
      dryRun: true,
    })
    expect(summary.generated_video_clips_schema_version).toBe("generated-video-clips.v1")
  })

  test("seedance-image2video-plan CLI alias writes generated-video-clips.v1 dry-run artifacts", () => {
    const outDir = path.relative(
      process.cwd(),
      path.join(import.meta.dir, "../test-output/seedance-image2video-plan-cli"),
    ).replaceAll(path.sep, "/")
    rmSync(path.resolve(outDir), { recursive: true, force: true })
    try {
      const result = spawnSync(process.execPath, [
        path.resolve(import.meta.dir, "../src/browser-proxy-cli.ts"),
        "seedance-image2video-plan",
        "--prompt",
        "Original ASMR companion raises one hand under moonlit server shrine glow, no text",
        "--firstFrameUri",
        "tos://fixture/seedance/first-frame-candidate-001.png",
        "--firstFrameHash",
        originalHash,
        "--runId",
        "seedance-cli-fixture-001",
        "--createdAt",
        createdAt,
        "--seed",
        "2026062401",
        "--durationSec",
        "5",
        "--ratio",
        "9:16",
        "--outDir",
        outDir,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain("seedance-image2video-plan saved")
      const manifestPath = path.resolve(outDir, "normalized/generated-video-clips.v1.json")
      const conditioningPath = path.resolve(outDir, "normalized/seedance-cli-fixture-001-first-frame-conditioning.json")
      expect(existsSync(manifestPath)).toBe(true)
      expect(existsSync(conditioningPath)).toBe(true)
      const decoded = decodeGeneratedVideoClipsV1(JSON.parse(readFileSync(manifestPath, "utf8")))
      expect(decoded.clips[0].providerJob.jobId).toBe("seedance-cli-fixture-001-dry-run-no-provider-job")
    } finally {
      rmSync(path.resolve(outDir), { recursive: true, force: true })
    }
  })

  test("standalone seedance-image2video-plan binary wrapper writes the same dry-run manifest", () => {
    const outDir = path.relative(
      process.cwd(),
      path.join(import.meta.dir, "../test-output/seedance-image2video-plan-bin"),
    ).replaceAll(path.sep, "/")
    rmSync(path.resolve(outDir), { recursive: true, force: true })
    try {
      const result = spawnSync(process.execPath, [
        path.resolve(import.meta.dir, "../src/seedance-image2video-plan-cli.ts"),
        "--prompt",
        "Original ASMR companion turns toward camera under moonlit server shrine glow, no text",
        "--firstFrameUri",
        "tos://fixture/seedance/first-frame-candidate-001.png",
        "--firstFrameHash",
        originalHash,
        "--runId",
        "seedance-bin-fixture-001",
        "--createdAt",
        createdAt,
        "--durationSec",
        "5",
        "--ratio",
        "9:16",
        "--outDir",
        outDir,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      })

      expect(result.status).toBe(0)
      const manifestPath = path.resolve(outDir, "normalized/generated-video-clips.v1.json")
      const decoded = decodeGeneratedVideoClipsV1(JSON.parse(readFileSync(manifestPath, "utf8")))
      expect(decoded.clips[0].providerJob.jobId).toBe("seedance-bin-fixture-001-dry-run-no-provider-job")
    } finally {
      rmSync(path.resolve(outDir), { recursive: true, force: true })
    }
  })
})
