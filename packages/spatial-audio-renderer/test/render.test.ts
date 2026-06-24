import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { inspectWav16Stereo, loadSpatialRenderBundle, renderSpatialAudioProof } from "../src"

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..")
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..")
const MEDIA_VOICE = "packages/media-contracts/fixtures/valid/voice-assets.v1.json"
const MEDIA_STEMS = "packages/media-contracts/fixtures/valid/asmr-stems.v1.json"
const MEDIA_SPATIAL = "packages/media-contracts/fixtures/valid/spatial-audio-manifest.v1.json"
const SCENE_STEMS = "packages/spatial-audio-renderer/fixtures/asmr-scene/asmr-stems.v1.json"
const SCENE_SPATIAL = "packages/spatial-audio-renderer/fixtures/asmr-scene/spatial-audio-manifest.v1.json"
const TEST_OUTPUT_ROOT = "packages/spatial-audio-renderer/test-output"

describe("Goal 3 spatial ASMR renderer", () => {
  test("round-trips Goal 1 media-contract fixtures through decoders", () => {
    const bundle = loadSpatialRenderBundle({
      voiceAssetsPath: MEDIA_VOICE,
      stemsPath: MEDIA_STEMS,
      spatialManifestPath: MEDIA_SPATIAL,
    })

    expect(bundle.voiceAssets.schemaVersion).toBe("voice-assets.v1")
    expect(bundle.stems.schemaVersion).toBe("asmr-stems.v1")
    expect(bundle.spatial.schemaVersion).toBe("spatial-audio-manifest.v1")
    expect(bundle.spatial.objects.map((object) => object.stemId)).toEqual([
      "voice-main-001",
      "foley-ear-taps-001",
      "room-tone-001",
    ])
  })

  test("renders Goal 1 media-contract spatial fixture as deterministic stereo proof", () => {
    mkdirSync(repoPath(TEST_OUTPUT_ROOT), { recursive: true })
    const outDir = relativeRepoPath(mkdtempSync(path.join(repoPath(TEST_OUTPUT_ROOT), "media-fixture-")))
    const result = renderSpatialAudioProof({
      voiceAssetsPath: MEDIA_VOICE,
      stemsPath: MEDIA_STEMS,
      spatialManifestPath: MEDIA_SPATIAL,
      outDir,
    })
    const wav = inspectWav16Stereo(result.audioPath)

    expect(result.channels).toBe(2)
    expect(result.durationSec).toBe(12)
    expect(wav.channels).toBe(2)
    expect(wav.durationSec).toBeCloseTo(12, 5)
    expect(wav.nonSilent).toBe(true)
  })

  test("fixture scene covers close whispers, behind movement, looped foley, and heartbeat bed", () => {
    const bundle = loadSpatialRenderBundle({
      voiceAssetsPath: MEDIA_VOICE,
      stemsPath: SCENE_STEMS,
      spatialManifestPath: SCENE_SPATIAL,
    })
    const stemIds = bundle.stems.stems.map((stem) => stem.stemId)

    expect(stemIds).toContain("whisper-left-001")
    expect(stemIds).toContain("whisper-right-001")
    expect(stemIds).toContain("behind-near-far-motion-001")
    expect(stemIds).toContain("soft-brush-tap-loop-001")
    expect(stemIds).toContain("heartbeat-room-bed-001")
    expect(bundle.stems.stems.find((stem) => stem.stemId === "soft-brush-tap-loop-001")?.timing.loop).toBe(true)
    for (const stem of bundle.stems.stems) {
      expect(stem.timing.startSec + stem.timing.durationSec).toBeLessThanOrEqual(bundle.spatial.durationSec)
    }
  })

  test("renders deterministic stereo WAV proof with duration and non-silent output", () => {
    mkdirSync(repoPath(TEST_OUTPUT_ROOT), { recursive: true })
    const outDir = relativeRepoPath(mkdtempSync(path.join(repoPath(TEST_OUTPUT_ROOT), "render-")))
    const result = renderSpatialAudioProof({
      voiceAssetsPath: MEDIA_VOICE,
      stemsPath: SCENE_STEMS,
      spatialManifestPath: SCENE_SPATIAL,
      outDir,
    })
    const wav = inspectWav16Stereo(result.audioPath)
    const outputManifest = JSON.parse(readFileSync(repoPath(result.outputManifestPath), "utf8")) as {
      audioPath: string
      output: { channels: number; durationSec: number; nonSilent: boolean; sha256: string }
    }

    expect(existsSync(repoPath(result.audioPath))).toBe(true)
    expect(existsSync(repoPath(result.outputManifestPath))).toBe(true)
    expect(result.channels).toBe(2)
    expect(wav.channels).toBe(2)
    expect(wav.sampleRateHz).toBe(48000)
    expect(wav.durationSec).toBeCloseTo(8, 5)
    expect(wav.nonSilent).toBe(true)
    expect(outputManifest.audioPath).toBe(result.audioPath)
    expect(outputManifest.output.channels).toBe(2)
    expect(outputManifest.output.durationSec).toBe(8)
    expect(outputManifest.output.nonSilent).toBe(true)
    expect(outputManifest.output.sha256).toBe(result.sha256)
  })

  test("rejects mismatched stem manifests and overrun timing constraints", () => {
    mkdirSync(repoPath(TEST_OUTPUT_ROOT), { recursive: true })
    const outDir = relativeRepoPath(mkdtempSync(path.join(repoPath(TEST_OUTPUT_ROOT), "timing-")))
    const mismatchedSpatialPath = path.join(outDir, "mismatched-spatial-audio-manifest.v1.json")
    const shortSpatialPath = path.join(outDir, "short-spatial-audio-manifest.v1.json")
    const spatial = JSON.parse(readFileSync(repoPath(SCENE_SPATIAL), "utf8")) as {
      stemsManifestPath: string
      durationSec: number
    }

    writeFileSync(
      repoPath(mismatchedSpatialPath),
      `${JSON.stringify({ ...spatial, stemsManifestPath: MEDIA_STEMS }, null, 2)}\n`,
    )
    expect(() => renderSpatialAudioProof({
      voiceAssetsPath: MEDIA_VOICE,
      stemsPath: SCENE_STEMS,
      spatialManifestPath: mismatchedSpatialPath,
      outDir,
    })).toThrow(/stemsManifestPath/)

    writeFileSync(
      repoPath(shortSpatialPath),
      `${JSON.stringify({ ...spatial, durationSec: 7.8 }, null, 2)}\n`,
    )
    expect(() => renderSpatialAudioProof({
      voiceAssetsPath: MEDIA_VOICE,
      stemsPath: SCENE_STEMS,
      spatialManifestPath: shortSpatialPath,
      outDir,
    })).toThrow(/ends after spatial render duration/)
  })

  test("rejects unsafe rendered artifact paths", () => {
    mkdirSync(repoPath(TEST_OUTPUT_ROOT), { recursive: true })
    const outDir = relativeRepoPath(mkdtempSync(path.join(repoPath(TEST_OUTPUT_ROOT), "invalid-")))
    const unsafeManifestPath = path.join(outDir, "unsafe-spatial-audio-manifest.v1.json")
    const spatial = JSON.parse(readFileSync(repoPath(SCENE_SPATIAL), "utf8")) as { mix: { outputPath: string } }
    spatial.mix.outputPath = "../escape.wav"
    writeFileSync(repoPath(unsafeManifestPath), `${JSON.stringify(spatial, null, 2)}\n`)

    expect(() => renderSpatialAudioProof({
      voiceAssetsPath: MEDIA_VOICE,
      stemsPath: SCENE_STEMS,
      spatialManifestPath: unsafeManifestPath,
      outDir,
    })).toThrow()
  })
})

function repoPath(relativePath: string): string {
  return path.resolve(REPO_ROOT, relativePath)
}

function relativeRepoPath(filePath: string): string {
  return path.relative(REPO_ROOT, filePath)
}
