import { describe, expect, test } from "bun:test"
import { collectSceneIssues } from "../src/check"
import { decodeSceneSpec } from "../src/schema"

describe("collectSceneIssues", () => {
  test("catches missing asset references with available ids", () => {
    const spec = decodeSceneSpec({
      schemaVersion: "scene.v1",
      width: 320,
      height: 480,
      fps: 12,
      durationSeconds: 1,
      assets: [{ id: "plate1", kind: "image", path: "plate.png" }],
      objects: [{ id: "wall", kind: "plane", asset: "plate9" }],
    })

    expect(collectSceneIssues(spec)).toContain("objects[0].asset 'plate9' not found; available: plate1")
  })
})
