import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA,
  GOAL4_HANDOFF_SCHEMA,
  PROMPT_PLAN_SCHEMA,
  buildGoal4PipelineHandoff,
  buildPromptPlan,
  decodeBrainrotReferentialMirrorCard,
  type BrainrotReferentialMirrorCard,
} from "../src/index"

const repoRoot = path.resolve(import.meta.dir, "../../..")
const fixtureRoot = path.resolve(import.meta.dir, "../fixtures")

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown
}

function readCard(name: string): BrainrotReferentialMirrorCard {
  return decodeBrainrotReferentialMirrorCard(readJson(path.join(fixtureRoot, "cards", name)))
}

describe("Goal 4 referential mirror planner", () => {
  test("emits deterministic prompt output from the ASMR fixture card", () => {
    const card = readCard("asmr-companion-moonlit.card.json")
    const firstPlan = buildPromptPlan(card)
    const secondPlan = buildPromptPlan(card)

    expect(card.schemaVersion).toBe(BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA)
    expect(firstPlan).toEqual(secondPlan)
    expect(firstPlan.schemaVersion).toBe(PROMPT_PLAN_SCHEMA)
    expect(firstPlan.conceptId).toBe("asmr_companion_moonlit_server_shrine")
    expect(firstPlan.prompts.imagePrompt.text).toContain("Prompt-planned short-video first frame for Moonlit Server Shrine Companion.")
    expect(firstPlan.prompts.imagePrompt.text).toContain("Recognition chain: quiet companion invitation -> server-shrine glow -> near-ear whisper movement -> mythic aura hold.")
    expect(firstPlan.prompts.seedanceMotionPrompt.controls).toMatchObject({ ratio: "9:16", durationSec: 5, fps: 24 })
    expect(firstPlan.pipelineMetadata.providerRoute).toMatchObject({
      provider: "goal4-local-planner",
      endpoint: "buildPromptPlan",
      seed: 2026062404,
    })
    expect(firstPlan.pipelineMetadata.vibeAxes).toContain("artifact-consciousness")
    expect(firstPlan.promptHash.value).toMatch(/^[a-f0-9]{64}$/)
  })

  test("rejects card avoid-list violations in positive prompt fields", () => {
    const card = readCard("asmr-companion-moonlit.card.json")
    const avoidViolation = structuredClone(card)
    avoidViolation.layers.primaryCharacter = "stray text glyphs"
    expect(() => buildPromptPlan(avoidViolation)).toThrow(/avoid-list entry/)
  })

  test("handoff references upstream Goal 2 and Goal 3 artifacts without copying internals", () => {
    const cards = [
      readCard("asmr-companion-moonlit.card.json"),
      readCard("high-aura-orbit.card.json"),
    ]
    const generatedClipsPath = "data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json"
    const spatialRenderPath = "data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json"

    const handoff = buildGoal4PipelineHandoff({
      bundleId: "goal4-pleometric-handoff-test",
      createdAt: "2026-06-24T00:00:00.000Z",
      cards,
      generatedClipsManifest: readJson(path.join(repoRoot, generatedClipsPath)),
      generatedClipsManifestPath: generatedClipsPath,
      spatialRenderOutput: readJson(path.join(repoRoot, spatialRenderPath)),
      spatialRenderOutputPath: spatialRenderPath,
    })

    expect(handoff.schemaVersion).toBe(GOAL4_HANDOFF_SCHEMA)
    expect(handoff.promptPlans).toHaveLength(2)
    expect(handoff.upstreamReferences.generatedVideo.owner).toBe("goal2_seedance")
    expect(handoff.upstreamReferences.generatedVideo.manifestPath).toBe(generatedClipsPath)
    expect(handoff.upstreamReferences.generatedVideo.clipConstraints[0]).toMatchObject({
      clipId: "first-frame-candidate-seedance-dry-run",
      generation: { durationSec: 5, ratio: "9:16", fps: 24, dryRun: true },
    })
    expect(JSON.stringify(handoff.upstreamReferences.generatedVideo)).not.toContain("providerJob")
    expect(JSON.stringify(handoff.upstreamReferences.generatedVideo)).not.toContain("requestPath")
    expect(handoff.upstreamReferences.spatialAudio.owner).toBe("goal3_spatial_audio")
    expect(handoff.upstreamReferences.spatialAudio.renderOutputPath).toBe(spatialRenderPath)
    expect(handoff.goal5Handoff.rendererIntent.audioBinding.audioPath).toBe("data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav")
  })
})
