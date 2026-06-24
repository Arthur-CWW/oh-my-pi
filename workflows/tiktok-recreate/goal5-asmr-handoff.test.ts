import { describe, expect, test } from "bun:test"
import { buildGoal5Artifacts } from "./goal5-asmr-handoff"

describe("Goal 5 ASMR handoff", () => {
  test("materializes Remotion and HyperFrames outputs from Goals 2-4 artifacts", () => {
    const result = buildGoal5Artifacts({
      handoff: "data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json",
      generatedClips: "data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json",
      spatialRenderOutput: "data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json",
      outDir: "data/asmr-companion/goal5-pipeline-proof",
      createdAt: "2026-06-24T00:00:00.000Z",
      proofId: "goal5-asmr-seedance-render-proof-001",
    })

    const files = result.files as Record<string, unknown>
    const textFiles = result.textFiles as Record<string, string>
    const handoff = result.handoff as { outputs: Record<string, string>; mediaReadiness: Record<string, unknown> }
    const layerPlan = files[handoff.outputs.layerPlan] as { beats: Array<{ layers: Array<{ type: string; props: Record<string, unknown> }> }> }
    const clipLayer = layerPlan.beats[0]?.layers.find((layer) => layer.type === "ClipLayer")

    expect(handoff.outputs.layerPlan).toBe("data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json")
    expect(handoff.outputs.hyperframesAnimationMap).toBe("data/asmr-companion/goal5-pipeline-proof/hyperframes-animation-map.json")
    expect(handoff.mediaReadiness.missingLiveMedia).toBe(true)
    expect(handoff.mediaReadiness.spatialAudioAvailable).toBe(true)
    expect(clipLayer?.props.missingLiveMedia).toBe(true)
    expect(clipLayer?.props.placeholderImagePath).toBe("data/asmr-companion/goal5-pipeline-proof/media/first-frame-candidate-seedance-dry-run.placeholder.svg")
    expect(textFiles[handoff.outputs.placeholderMedia]).toContain("GENERATED CLIP PLACEHOLDER")
  })
})
