import { describe, expect, test } from "bun:test"
import {
  buildJimengDiscoveryKnownEndpointMap,
  getJimengDiscoveryKnownEndpointNote,
  getJimengDiscoveryKnownEndpoints,
  getJimengDiscoveryTriageFamilies,
  parseJimengDiscoveryTriageDecisions,
  summarizeJimengDiscoveryTriageCoverage,
  writeJimengDiscoveryTriageCoverageMarkdown,
} from "../src/endpoint-registry"

describe("Jimeng endpoint registry", () => {
  test("exposes known endpoint coverage without sharing mutable registry rows", () => {
    const endpoints = getJimengDiscoveryKnownEndpoints()
    const firstEndpoint = endpoints[0]

    expect(endpoints.length).toBeGreaterThan(100)
    expect(firstEndpoint).toBeDefined()
    expect(endpoints.some((endpoint) => endpoint.endpoint === "/mweb/v1/get_history_by_ids" && endpoint.status === "implemented")).toBe(true)

    if (!firstEndpoint) throw new Error("expected at least one known endpoint")
    const originalStatus = firstEndpoint.status
    firstEndpoint.status = "blocked"

    expect(getJimengDiscoveryKnownEndpoints()[0]?.status).toBe(originalStatus)

    const registryRow = buildJimengDiscoveryKnownEndpointMap().get(firstEndpoint.endpoint)
    if (!registryRow) throw new Error("expected known endpoint map row")
    registryRow.status = "blocked"
    registryRow.evidence.push("mutated")

    expect(buildJimengDiscoveryKnownEndpointMap().get(firstEndpoint.endpoint)?.status).toBe(originalStatus)
    expect(buildJimengDiscoveryKnownEndpointMap().get(firstEndpoint.endpoint)?.evidence).not.toContain("mutated")
  })

  test("tracks intentionally parked and blocked endpoint decisions", () => {
    const registry = buildJimengDiscoveryKnownEndpointMap()

    expect(registry.get("/mweb/v1/get_weekly_challenge_list")?.status).toBe("cataloged_only")
    expect(registry.get("/mweb/v1/get_weekly_challenge_list")?.note).toContain("Back burner")
    expect(registry.get("/lv/v1/cc_web/replicate/search_templates")?.status).toBe("blocked")
    expect(registry.get("/mweb/v1/get_history")?.command).toBe("history-list")
    expect(registry.get("/mweb/v1/get_history_by_ids")?.command).toBe("history-records")
  })

  test("returns notes for known endpoints and null for unknown endpoints", () => {
    expect(getJimengDiscoveryKnownEndpointNote("/mweb/v1/get_history")).toContain("valid empty records_list")
    expect(getJimengDiscoveryKnownEndpointNote("/mweb/v1/not_a_real_endpoint")).toBeNull()
  })

  test("summarizes triage keep-family coverage from registry statuses", () => {
    const families = getJimengDiscoveryTriageFamilies()
    const coverage = summarizeJimengDiscoveryTriageCoverage({ decisions: ["keep"] })
    const markdown = writeJimengDiscoveryTriageCoverageMarkdown(coverage)

    expect(families.filter((family) => family.decision === "keep").map((family) => family.id)).toEqual([
      "G1",
      "G2",
      "P1",
      "V1",
      "L1",
      "R1",
      "R2",
      "T1",
      "A1",
    ])
    expect(coverage.missingEndpointCount).toBe(0)
    expect(coverage.statusCounts.implemented).toBeGreaterThan(20)
    expect(coverage.statusCounts.blocked).toBeGreaterThanOrEqual(10)
    expect(coverage.families.find((family) => family.id === "T1")?.statusCounts.blocked).toBe(6)
    expect(coverage.families.find((family) => family.id === "L1")?.notImplementedEndpoints).toContain("/mweb/v1/video_generate/pre_process")
    expect(coverage.valueRankedGaps[0]).toMatchObject({
      valueRank: 1,
      workflow: "Generation parity and artifact proof",
      familyId: "G1",
      endpoint: "/mweb/v1/execute_generate_audit",
      status: "blocked",
    })
    expect(coverage.valueRankedGaps.find((gap) => gap.endpoint === "/mweb/v1/mget_story")).toMatchObject({
      valueRank: 6,
      workflow: "Supporting metadata reads",
    })
    expect(
      coverage.valueRankedGaps.findIndex((gap) => gap.endpoint === "/mweb/v1/dreamina_subject/generate_voice"),
    ).toBeLessThan(
      coverage.valueRankedGaps.findIndex((gap) => gap.endpoint === "/mweb/v1/mget_story"),
    )

    expect(markdown).toContain("| T1 | keep | CapCut/template mining | 16 | implemented=10, blocked=6 | 6 |")
    expect(markdown).toContain("## Value-Ranked Remaining Work")
    expect(markdown).toContain("1. Generation parity and artifact proof - `G1 /mweb/v1/execute_generate_audit`")
    expect(markdown).toContain("## Not Implemented Endpoints")
    expect(markdown).toContain("- `/mweb/v1/execute_generate_audit` - blocked command=generate-audit-plan/request-plan-compare/executeJimengGenerateAudit")
    expect(markdown).toContain("Evidence:")
    expect(markdown).toContain("Next probe:")
  })

  test("keeps every unfinished keep-family endpoint auditable with evidence and a next probe", () => {
    const registry = buildJimengDiscoveryKnownEndpointMap()
    const coverage = summarizeJimengDiscoveryTriageCoverage({ decisions: ["keep"] })
    const unfinished = coverage.families.flatMap((family) => family.notImplementedEndpoints)

    expect(unfinished.length).toBeGreaterThan(0)

    for (const endpoint of unfinished) {
      const row = registry.get(endpoint)
      expect(row).toBeDefined()
      expect(row?.evidence.length).toBeGreaterThan(0)
      expect(row?.nextProbe).toBeTruthy()
    }

    const auditedButNotUnfinished = getJimengDiscoveryKnownEndpoints()
      .filter((row) => row.status !== "implemented")
      .filter((row) => row.evidence.length > 0 || row.nextProbe)
      .map((row) => row.endpoint)
      .filter((endpoint) => !unfinished.includes(endpoint))

    expect(auditedButNotUnfinished).toEqual([])
  })

  test("parses triage decision flags with keep as the default", () => {
    expect(parseJimengDiscoveryTriageDecisions(undefined)).toEqual(["keep"])
    expect(parseJimengDiscoveryTriageDecisions("keep,maybe,keep")).toEqual(["keep", "maybe"])
    expect(() => parseJimengDiscoveryTriageDecisions("weekly")).toThrow("Unknown triage decision")
  })
})
