import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { decodeSceneSpec } from "../src/schema"
import { stageAssets } from "../src/stage"

describe("stageAssets", () => {
  test("rewrites paths and dedupes copied image/audio assets", async () => {
    const root = testRoot("dedupe")
    const sourceDir = join(root, "source")
    await mkdir(sourceDir, { recursive: true })
    const imagePath = join(sourceDir, "plate one.png")
    const audioPath = join(sourceDir, "voice.wav")
    await writeFile(imagePath, "image-bytes")
    await writeFile(audioPath, "audio-bytes")

    const spec = decodeSceneSpec({
      schemaVersion: "scene.v1",
      width: 320,
      height: 480,
      fps: 12,
      durationSeconds: 1,
      assets: [
        { id: "plate1", kind: "image", path: "plate one.png" },
        { id: "plate2", kind: "image", path: "plate one.png" },
        { id: "narration", kind: "audio", path: "voice.wav" },
      ],
      audio: { asset: "narration" },
    })

    const staged = await stageAssets(spec, { outDir: join(root, "out"), sceneDir: sourceDir })
    expect(staged.spec.assets[0]?.path).toBe("assets/0-plate_one.png")
    expect(staged.spec.assets[1]?.path).toBe("assets/0-plate_one.png")
    expect(staged.spec.assets[2]?.path).toBe("assets/2-voice.wav")
    expect(staged.audioFilePath).toBe(join(root, "out", "public", "assets", "2-voice.wav"))
    expect(await Bun.file(join(staged.publicDir, "assets", "0-plate_one.png")).text()).toBe("image-bytes")
  })

  test("resolves repo-root-relative assets before spec-dir-relative assets", async () => {
    const root = testRoot("repo-root")
    const sceneDir = join(root, "scenes", "nested")
    await mkdir(join(root, ".git"), { recursive: true })
    await mkdir(join(root, "data"), { recursive: true })
    await mkdir(join(sceneDir, "data"), { recursive: true })
    await writeFile(join(root, "data", "plate.png"), "repo-root-bytes")
    await writeFile(join(sceneDir, "data", "plate.png"), "spec-dir-bytes")

    const staged = await stageAssets(
      decodeSceneSpec({
        schemaVersion: "scene.v1",
        width: 320,
        height: 480,
        fps: 12,
        durationSeconds: 1,
        assets: [{ id: "plate", kind: "image", path: "data/plate.png" }],
      }),
      { outDir: join(root, "out"), sceneDir },
    )

    expect(await Bun.file(join(staged.publicDir, "assets", "0-plate.png")).text()).toBe("repo-root-bytes")
  })

  test("falls back to spec-dir-relative assets when repo-root-relative path is absent", async () => {
    const root = testRoot("spec-fallback")
    const sceneDir = join(root, "scenes")
    await mkdir(join(root, ".git"), { recursive: true })
    await mkdir(join(sceneDir, "local"), { recursive: true })
    await writeFile(join(sceneDir, "local", "plate.png"), "spec-dir-bytes")

    const staged = await stageAssets(
      decodeSceneSpec({
        schemaVersion: "scene.v1",
        width: 320,
        height: 480,
        fps: 12,
        durationSeconds: 1,
        assets: [{ id: "plate", kind: "image", path: "local/plate.png" }],
      }),
      { outDir: join(root, "out"), sceneDir },
    )

    expect(await Bun.file(join(staged.publicDir, "assets", "0-plate.png")).text()).toBe("spec-dir-bytes")
  })

  test("missing relative assets report both repo-root and spec-dir paths", async () => {
    const root = testRoot("missing")
    const sceneDir = join(root, "scenes")
    await mkdir(join(root, ".git"), { recursive: true })
    await mkdir(sceneDir, { recursive: true })
    const missingPath = "missing/plate.png"

    const attempt = stageAssets(
      decodeSceneSpec({
        schemaVersion: "scene.v1",
        width: 320,
        height: 480,
        fps: 12,
        durationSeconds: 1,
        assets: [{ id: "plate", kind: "image", path: missingPath }],
      }),
      { outDir: join(root, "out"), sceneDir },
    )

    await expect(attempt).rejects.toThrow(
      `asset path '${missingPath}' not found; tried:\n${join(root, missingPath)}\n${join(sceneDir, missingPath)}`,
    )
  })
})

function testRoot(name: string): string {
  return join(resolve("."), "test-output", `scene-stage-${name}-${Date.now()}`)
}
