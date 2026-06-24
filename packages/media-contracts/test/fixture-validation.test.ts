import { describe, expect, test } from "bun:test"
import {
  decodeAnalysisTagsV1,
  decodeAsmrContractManifest,
  decodeAsmrStemsV1,
  decodeGeneratedVideoClipsV1,
  decodeSpatialAudioManifestV1,
  decodeVoiceAssetsV1,
} from "../src/index"
import { readMediaContractFixture } from "./fixtures/read-fixture"

type FixtureDecoder = (
  value: Parameters<typeof decodeAsmrContractManifest>[0],
  operation?: string,
) => ReturnType<typeof decodeAsmrContractManifest>

interface ValidFixture {
  name: string
  schemaVersion: ReturnType<typeof decodeAsmrContractManifest>["schemaVersion"]
  decode: FixtureDecoder
}

interface InvalidFixture {
  name: string
  decode: FixtureDecoder
}


const validFixtures = [
  {
    name: "analysis-tags.v1.json",
    schemaVersion: "analysis-tags.v1",
    decode: decodeAnalysisTagsV1,
  },
  {
    name: "voice-assets.v1.json",
    schemaVersion: "voice-assets.v1",
    decode: decodeVoiceAssetsV1,
  },
  {
    name: "asmr-stems.v1.json",
    schemaVersion: "asmr-stems.v1",
    decode: decodeAsmrStemsV1,
  },
  {
    name: "spatial-audio-manifest.v1.json",
    schemaVersion: "spatial-audio-manifest.v1",
    decode: decodeSpatialAudioManifestV1,
  },
  {
    name: "generated-video-clips.v1.json",
    schemaVersion: "generated-video-clips.v1",
    decode: decodeGeneratedVideoClipsV1,
  },
] satisfies ReadonlyArray<ValidFixture>

const invalidFixtures = [
  {
    name: "missing-source-hash.analysis-tags.v1.json",
    decode: decodeAnalysisTagsV1,
  },
  {
    name: "missing-source-provenance.analysis-tags.v1.json",
    decode: decodeAnalysisTagsV1,
  },
  {
    name: "unsafe-derivative-input-path.analysis-tags.v1.json",
    decode: decodeAnalysisTagsV1,
  },
  {
    name: "invalid-timestamps.asmr-stems.v1.json",
    decode: decodeAsmrStemsV1,
  },
  {
    name: "invalid-spatial-coordinates.spatial-audio-manifest.v1.json",
    decode: decodeSpatialAudioManifestV1,
  },
  {
    name: "missing-provider-model-job.generated-video-clips.v1.json",
    decode: decodeGeneratedVideoClipsV1,
  },
] satisfies ReadonlyArray<InvalidFixture>

describe("ASMR media contract fixture bundle", () => {
  for (const fixture of validFixtures) {
    test(`decodes ${fixture.name}`, () => {
      const decoded = fixture.decode(readMediaContractFixture("valid", fixture.name), `packages/media-contracts/fixtures/valid/${fixture.name}`)
      expect(decoded.schemaVersion).toBe(fixture.schemaVersion)
      expect(decodeAsmrContractManifest(decoded).schemaVersion).toBe(fixture.schemaVersion)
    })
  }

  for (const fixture of invalidFixtures) {
    test(`rejects ${fixture.name}`, () => {
      expect(() => fixture.decode(readMediaContractFixture("invalid", fixture.name), `packages/media-contracts/fixtures/invalid/${fixture.name}`)).toThrow()
    })
  }

  test("analysis tags fixture includes prompt-card placeholder metadata but no image-path generation input", () => {
    const decoded = decodeAnalysisTagsV1(readMediaContractFixture("valid", "analysis-tags.v1.json"))
    expect(decoded.promptCardPlaceholder?.cardSchema).toBe("brainrot_referential_mirror_card_v0")
    expect(decoded.generationInputs.every((input) => input.kind !== "provider_uri" || input.providerUri !== undefined)).toBe(true)
    expect(decoded.generationInputs.every((input) => !("path" in input))).toBe(true)
  })

  test("generated clip fixture preserves first-frame conditioning and provider provenance", () => {
    const decoded = decodeGeneratedVideoClipsV1(readMediaContractFixture("valid", "generated-video-clips.v1.json"))
    expect(decoded.clips.length).toBeGreaterThan(0)
    const clip = decoded.clips[0]
    expect(clip).toBeDefined()
    if (!clip) throw new Error("generated-video-clips fixture must include at least one clip")
    expect(clip.providerJob.provider).toBe("jimeng-seedance")
    expect(clip.providerJob.model).toContain("seedance")
    expect(clip.providerJob.jobId).toBeTruthy()
    expect(clip.firstFrame.originalHash.value).not.toBe(clip.firstFrame.conditionedHash.value)
  })
})
