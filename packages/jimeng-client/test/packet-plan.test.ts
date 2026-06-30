import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import {
  buildJimengPacketPlan,
  pickNextJimengPacketId,
  validateJimengPacketPlan,
  writeJimengPacketPlanOutputs,
  writeJimengPacketPlanMarkdown,
} from "../src/packet-plan"

describe("Jimeng packet plans", () => {
  test("chooses lip-sync-human as the next packet from registry packet selection", () => {
    expect(pickNextJimengPacketId()).toBe("lip-sync-human")

    const plan = buildJimengPacketPlan({
      artifactRoot: "data/jimeng-lab/packet-lip-sync-human-20260624",
    })

    expect(plan.packetId).toBe("lip-sync-human")
    expect(plan.familyIds).toEqual(["L1", "V1", "G2", "A1"])
    expect(plan.approvalRequired).toBe(true)
    expect(plan.approvalPrompt).toContain("Approve running the lip-sync-human packet with concurrency 1?")
    expect(plan.examples.map((example) => example.id)).toEqual([
      "avatar-preprocess",
      "image-lipsync",
    ])
    expect(plan.examples[0]?.outputDir).toBe("data/jimeng-lab/packet-lip-sync-human-20260624/avatar-preprocess")
    expect(plan.gaps.some((gap) => gap.familyId === "G2" && gap.endpoint === "/mweb/v1/mpack_image")).toBe(true)
    expect(plan.gaps.some((gap) => gap.familyId === "V1" && gap.endpoint === "/mweb/v1/mix_audio_video")).toBe(true)
    expect(plan.gaps.some((gap) => gap.familyId === "L1" && gap.endpoint === "/mweb/v1/video_generate/pre_process")).toBe(true)
    expect(plan.promotionPlan.join("\n")).toContain("Run contract-infer over pre-process/result and lip-sync generation samples.")
    expect(plan.acceptance).toContain("Approved lip-sync media artifact is playable and tied to a typed history record.")
  })

  test("renders an approval-ready markdown packet plan without live provider access", () => {
    const plan = buildJimengPacketPlan({
      packetId: "lip-sync-human",
      artifactRoot: "data/jimeng-lab/packet-lip-sync-human-20260612",
    })
    const markdown = writeJimengPacketPlanMarkdown(plan)

    expect(markdown).toContain("# Jimeng Packet Plan: lip-sync-human")
    expect(markdown).toContain("- Approval required: yes")
    expect(markdown).toContain("video-preprocess-plan")
    expect(markdown).toContain("## Current Registry Gaps")
    expect(markdown).toContain("`L1 /mweb/v1/video_generate/pre_process`")
    expect(markdown).not.toContain("undefined")
  })

  test("keeps no-spend reference-control prep non-approval by default", () => {
    const plan = buildJimengPacketPlan({
      packetId: "reference-controls",
      artifactRoot: "data/jimeng-lab/packet-reference-controls-20260612",
    })

    expect(plan.approvalRequired).toBe(false)
    expect(plan.approvalPrompt).toBeNull()
    expect(plan.examples[0]?.risks).toEqual(["none"])
  })

  test("writes a schema-validated packet manifest bundle", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "jimeng-packet-plan-"))
    const plan = buildJimengPacketPlan({
      packetId: "persona-voice",
      artifactRoot: "data/jimeng-lab/packet-persona-voice-20260612",
    })

    const files = writeJimengPacketPlanOutputs(plan, outDir)
    const manifest = JSON.parse(readFileSync(files.manifestJson, "utf8")) as {
      packetId: string
      examples: Array<{ id: string; command: string; outputDir: string; approvalNote?: string }>
      approvalRequired: boolean
    }
    const markdown = readFileSync(files.manifestMarkdown, "utf8")

    expect(manifest.packetId).toBe("persona-voice")
    expect(manifest.examples[0]?.outputDir).toBe("data/jimeng-lab/packet-persona-voice-20260612/subject-voice")
    expect(manifest.examples[1]).toMatchObject({
      id: "voice-clone-submit",
      command: expect.stringContaining("--dryRun"),
      approvalNote: expect.stringContaining("explicit mutation/spend approval"),
    })
    expect(manifest.approvalRequired).toBe(true)
    expect(markdown).toContain("# Jimeng Packet Plan: persona-voice")
    expect(markdown).toContain("## Approval Prompt")
    expect(markdown).toContain("Live voice clone submit is intentionally disabled")
    expect(typeof files.approvalPrompt).toBe("string")
    if (files.approvalPrompt) {
      expect(existsSync(files.approvalPrompt)).toBe(true)
      expect(readFileSync(files.approvalPrompt, "utf8")).toContain("Approve running the persona-voice packet")
    }
  })

  test("rejects packet manifests that drift from the required contract", () => {
    const plan = buildJimengPacketPlan({
      artifactRoot: "data/jimeng-lab/packet-gen-parity-20260612",
    })
    const invalidPlan = {
      ...plan,
      packetId: "weekly-challenges",
    } as never

    expect(() => validateJimengPacketPlan(invalidPlan)).toThrow("Jimeng packet plan did not match required manifest fields")
  })
})
