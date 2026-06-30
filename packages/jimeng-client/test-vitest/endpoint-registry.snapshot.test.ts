import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  buildJimengDiscoveryKnownEndpointMap,
  summarizeJimengDiscoveryTriageCoverage,
  writeJimengDiscoveryTriageCoverageMarkdown,
} from "../src/endpoint-registry"

interface KeepFamilyGapSnapshot {
  readonly statusCounts: Record<string, number>
  readonly valueRankedGaps: ReadonlyArray<{
    readonly valueRank: number
    readonly workflow: string
    readonly implementationRank: number
    readonly familyId: string
    readonly endpoint: string
    readonly status: string
    readonly command: string | null
    readonly nextProbe: string | null
  }>
  readonly selectedPacket: {
    readonly id: string
    readonly status: string
    readonly families: readonly string[]
    readonly blocker: string | null
    readonly nextCommand: string | null
  }
  readonly families: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly statuses: Record<string, number>
    readonly gaps: ReadonlyArray<{
      readonly endpoint: string
      readonly status: string
      readonly command: string | null
      readonly note: string
      readonly evidence: readonly string[]
      readonly nextProbe: string | null
    }>
  }>
}

function buildKeepFamilyGapSnapshot(): KeepFamilyGapSnapshot {
  const registry = buildJimengDiscoveryKnownEndpointMap()
  const coverage = summarizeJimengDiscoveryTriageCoverage({ decisions: ["keep"] })

  return {
    statusCounts: coverage.statusCounts,
    valueRankedGaps: coverage.valueRankedGaps.map((gap) => ({
      valueRank: gap.valueRank,
      workflow: gap.workflow,
      implementationRank: gap.implementationRank,
      familyId: gap.familyId,
      endpoint: gap.endpoint,
      status: gap.status,
      command: gap.command,
      nextProbe: gap.nextProbe,
    })),
    selectedPacket: {
      id: coverage.selectedPacket.id,
      status: coverage.selectedPacket.status,
      families: coverage.selectedPacket.families,
      blocker: coverage.selectedPacket.blocker,
      nextCommand: coverage.selectedPacket.nextCommand,
    },
    families: coverage.families.map((family) => ({
      id: family.id,
      title: family.title,
      statuses: family.statusCounts,
      gaps: family.notImplementedEndpoints.map((endpoint) => {
        const row = registry.get(endpoint)
        return {
          endpoint,
          status: row?.status ?? "missing",
          command: row?.command ?? null,
          note: row?.note ?? "missing registry row",
          evidence: row?.evidence ?? [],
          nextProbe: row?.nextProbe ?? null,
        }
      }),
    })),
  }
}

describe("Jimeng endpoint registry snapshots", () => {
  it.effect("snapshots keep-family gap summary as a normalized contract object", () =>
    Effect.sync(() => {
      expect(buildKeepFamilyGapSnapshot()).toMatchSnapshot()
    }))

  it.effect("snapshots the generated keep-family Markdown report", () =>
    Effect.promise(() => {
      const coverage = summarizeJimengDiscoveryTriageCoverage({ decisions: ["keep"] })

      return expect(writeJimengDiscoveryTriageCoverageMarkdown(coverage)).toMatchFileSnapshot(
        "./__snapshots__/endpoint-registry.keep.md",
      )
    }))
})
