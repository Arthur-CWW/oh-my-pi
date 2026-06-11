import { describe, expect, test } from "bun:test"
import {
  buildJimengDiscoveryKnownEndpointMap,
  getJimengDiscoveryKnownEndpointNote,
  getJimengDiscoveryKnownEndpoints,
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
})
