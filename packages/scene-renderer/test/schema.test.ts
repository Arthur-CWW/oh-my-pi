import { describe, expect, test } from "bun:test"
import { decodeSceneSpec } from "../src/schema"

describe("decodeSceneSpec", () => {
  test("accepts a minimal scene and fills deterministic defaults", () => {
    const spec = decodeSceneSpec({
      schemaVersion: "scene.v1",
      width: 320,
      height: 480,
      fps: 12,
      durationSeconds: 1,
      extraFutureField: true,
    })

    expect(spec.background).toBe("#000000")
    expect(spec.timeline.bpm).toBe(120)
    expect(spec.camera.position).toEqual([0, 0, 8])
    expect(spec.assets).toEqual([])
    expect(spec.objects).toEqual([])
  })

  test("reports all failed paths one per line", () => {
    expect(() =>
      decodeSceneSpec({
        schemaVersion: "scene.v1",
        width: "wide",
        height: 480,
        fps: 12,
        durationSeconds: 1,
        objects: [
          {
            id: "box",
            kind: "plane",
            tracks: [{ prop: "scale", mode: "osc", osc: { amp: "loud", freqBeats: 1 } }],
          },
        ],
      }),
    ).toThrow(/width: expected number, got string[\s\S]*objects\[0\]\.tracks\[0\]\.osc\.amp: expected number, got string/)
  })
})
