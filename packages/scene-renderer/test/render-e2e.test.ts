import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

const FfprobeFormatSchema = Schema.Struct({
  format: Schema.Struct({
    duration: Schema.String,
  }),
})

describe("render CLI with test runtime", () => {
  test("captures deterministic frames, muxes mp4, and renders a still", async () => {
    const root = join(resolve("."), "test-output", `scene-render-e2e-${Date.now()}`)
    const scenePath = join(root, "scene.json")
    const outDir = join(root, "out")
    const extractDir = join(root, "extract")
    await mkdir(extractDir, { recursive: true })
    await writeFile(
      scenePath,
      `${JSON.stringify(
        {
          schemaVersion: "scene.v1",
          width: 320,
          height: 480,
          fps: 12,
          durationSeconds: 1,
          background: "#0a0a0c",
          objects: [],
          assets: [],
        },
        null,
        2,
      )}\n`,
    )

    await runCommand(["bun", "src/render.ts", "--scene", scenePath, "--out", outDir, "--runtime", "src/test-runtime.js"], resolve("."))
    const mp4Path = join(outDir, "scene.mp4")
    expect(await Bun.file(mp4Path).exists()).toBe(true)

    const probe = await runCommand(
      ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", mp4Path],
      resolve("."),
    )
    const decodedProbe = Schema.decodeUnknownSync(FfprobeFormatSchema)(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(probe.stdout))
    expect(Math.abs(Number(decodedProbe.format.duration) - 1)).toBeLessThan(0.2)

    await runCommand(["ffmpeg", "-y", "-i", mp4Path, "-frames:v", "2", join(extractDir, "%06d.png")], resolve("."))
    const first = Buffer.from(await Bun.file(join(extractDir, "000001.png")).arrayBuffer())
    const second = Buffer.from(await Bun.file(join(extractDir, "000002.png")).arrayBuffer())
    expect(first.equals(second)).toBe(false)

    await runCommand(
      ["bun", "src/render.ts", "--scene", scenePath, "--out", outDir, "--runtime", "src/test-runtime.js", "--still", "0.5"],
      resolve("."),
    )
    expect(await Bun.file(join(outDir, "still-0.5s.png")).exists()).toBe(true)
  }, 60_000)
})

async function runCommand(cmd: string[], cwd: string): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}\n${stdout}\n${stderr}`)
  return { stdout, stderr }
}
