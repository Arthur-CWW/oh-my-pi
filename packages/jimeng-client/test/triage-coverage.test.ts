import { describe, expect, test } from "bun:test"
import {
  getJimengDiscoveryPacketQueue,
  selectJimengDiscoveryNextPacket,
  summarizeJimengDiscoveryTriageCoverage,
  writeJimengDiscoveryTriageCoverageMarkdown,
} from "../src/endpoint-registry"

describe("Jimeng triage packet coverage", () => {
  test("selects the active lip-sync-human packet over completed generation and blocked persona work", () => {
    const queue = getJimengDiscoveryPacketQueue()
    const selected = selectJimengDiscoveryNextPacket()

    expect(queue.map((packet) => packet.id)).toEqual([
      "gen-parity",
      "persona-voice",
      "lip-sync-human",
      "reference-controls",
      "template-mining",
      "supporting-reads",
    ])
    expect(queue.find((packet) => packet.id === "gen-parity")?.status).toBe("complete")
    expect(queue.find((packet) => packet.id === "persona-voice")?.status).toBe("blocked")
    expect(selected).toMatchObject({
      id: "lip-sync-human",
      status: "active",
      families: ["L1", "V1", "G2", "A1"],
    })
    expect(selected.whyNow).toContain("generation parity is complete")
    expect(selected.blocker).toContain("Background passive capture now confirms")
    expect(selected.nextCommand).toContain("browser-proxy-cli.ts lip-sync")
    expect(selected.nextCommand).toContain("digitalHuman")
  })

  test("keeps packet selection grounded in unfinished keep-family endpoint coverage", () => {
    const selected = selectJimengDiscoveryNextPacket()
    const coverage = summarizeJimengDiscoveryTriageCoverage({ decisions: ["keep"] })
    const markdown = writeJimengDiscoveryTriageCoverageMarkdown(coverage)
    const unfinishedByFamily = Object.fromEntries(
      coverage.families.map((family) => [family.id, family.notImplementedEndpoints]),
    ) as Partial<Record<string, string[]>>

    expect(unfinishedByFamily.L1).toEqual([
      "/mweb/v1/video_generate/get_switch_model_queue_info",
      "/mweb/v1/video_generate/pre_process",
      "/mweb/v1/video_generate/mget_pre_process_result",
      "/mweb/v1/video_generate/face_auth/skip",
      "/mweb/v1/video_generate/face_auth/skip/query",
    ])
    expect(coverage.selectedPacket.id).toBe("lip-sync-human")
    expect(markdown).toContain("## Selected Next Packet")
    expect(markdown).toContain("- Packet: `lip-sync-human` - active - Lip-sync and digital human")
    expect(markdown).toContain("Next command: `bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync")
    expect(selected.evidence).toContain("docs/qa/jimeng-lip-sync-digitalhuman-passive-capture-20260630.md")
    expect(selected.nextCommand).toBe(
      "bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync --transport cdp-ui --cdp http://127.0.0.1:9340 --target-url \"type=digitalHuman\" --image <local-persona-image.png> --voice-id <voice-id-or-visible-label> --voice-title \"直爽女大\" --text \"三秒告诉你为什么这款产品值得试。\" --outDir data/jimeng-lab/packet-lip-sync-human-20260630/packet-artifacts/image-lipsync --pollIntervalMs 3000 --maxPolls 30",
    )
  })

  test("returns cloned packet queue data", () => {
    const firstRead = getJimengDiscoveryPacketQueue()
    firstRead[0]?.families.push("X1")
    firstRead[0]?.evidence.push("mutated")

    const secondRead = getJimengDiscoveryPacketQueue()
    expect(secondRead[0]?.families).not.toContain("X1")
    expect(secondRead[0]?.evidence).not.toContain("mutated")
  })
})
