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

    expect(buildJimengDiscoveryKnownEndpointMap().get(firstEndpoint.endpoint)?.status).toBe(originalStatus)
  })

  test("tracks intentionally parked and blocked endpoint decisions", () => {
    const registry = buildJimengDiscoveryKnownEndpointMap()

    expect(registry.get("/mweb/v1/get_weekly_challenge_list")?.status).toBe("cataloged_only")
    expect(registry.get("/mweb/v1/get_weekly_challenge_list")?.note).toContain("Back burner")
    expect(registry.get("/lv/v1/cc_web/replicate/search_templates")?.status).toBe("blocked")
    expect(registry.get("/mweb/v1/get_history_by_ids")?.command).toBe("history-records")
  })

  test("returns notes for known endpoints and null for unknown endpoints", () => {
    expect(getJimengDiscoveryKnownEndpointNote("/mweb/v1/get_history")).toContain("Safe frontend-derived probes")
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
    expect(coverage.statusCounts.blocked).toBeGreaterThan(10)
    expect(coverage.families.find((family) => family.id === "T1")?.statusCounts.blocked).toBe(6)
    expect(coverage.families.find((family) => family.id === "L1")?.notImplementedEndpoints).toContain("/mweb/v1/video_generate/pre_process")

    expect(markdown).toContain("| T1 | keep | CapCut/template mining | 16 | implemented=10, blocked=6 | 6 |")
    expect(markdown).toContain("## Not Implemented Endpoints")
    expect(markdown).toContain("- `/mweb/v1/aigc_draft/generate` - partial command=text2image/text2video/image2video/frames2video/lip-sync")
  })

  test("parses triage decision flags with keep as the default", () => {
    expect(parseJimengDiscoveryTriageDecisions(undefined)).toEqual(["keep"])
    expect(parseJimengDiscoveryTriageDecisions("keep,maybe,keep")).toEqual(["keep", "maybe"])
    expect(() => parseJimengDiscoveryTriageDecisions("weekly")).toThrow("Unknown triage decision")
  })
})
