import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  buildJimengPacketPlan,
  writeJimengPacketPlanMarkdown,
} from "../src"

describe("Jimeng packet plan snapshots", () => {
  it.effect("snapshots the next gen-parity packet plan", () =>
    Effect.sync(() => {
      const plan = buildJimengPacketPlan({
        artifactRoot: "data/jimeng-lab/packet-gen-parity-20260612",
      })

      expect({
        packetId: plan.packetId,
        title: plan.title,
        familyIds: plan.familyIds,
        valueRank: plan.valueRank,
        approvalRequired: plan.approvalRequired,
        examples: plan.examples.map((example) => ({
          id: example.id,
          risks: example.risks,
          outputDir: example.outputDir,
        })),
        gaps: plan.gaps.map((gap) => ({
          endpoint: gap.endpoint,
          status: gap.status,
          command: gap.command,
          nextProbe: gap.nextProbe,
        })),
      }).toMatchSnapshot()
      expect(writeJimengPacketPlanMarkdown(plan)).toMatchSnapshot()
    }))
})
