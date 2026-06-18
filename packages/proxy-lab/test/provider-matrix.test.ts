import { describe, expect, test } from "bun:test"
import {
  defaultProviderMatrix,
  providersByCategory,
  providersByRisk,
  providersByUseCase,
  lowestRiskUsEgressProviders,
  type ProxyProvider,
} from "../src"

describe("Provider matrix", () => {
  test("default matrix has providers across risk tiers", () => {
    const riskSeen: Record<string, true> = {}
    for (const p of defaultProviderMatrix) riskSeen[p.riskTier] = true
    expect(riskSeen["low"]).toBe(true)
    expect(riskSeen["moderate"]).toBe(true)
    expect(riskSeen["high"]).toBe(true)
    expect(riskSeen["critical"]).toBe(true)
  })

  test("commercial residential providers are low risk", () => {
    const commercial = providersByCategory("commercial-residential")
    expect(commercial.length).toBeGreaterThan(0)
    expect(commercial.every((p) => p.riskTier === "low")).toBe(true)
  })

  test("critical risk providers include free options", () => {
    const critical = providersByRisk("critical")
    expect(critical.length).toBeGreaterThan(0)
    expect(critical.some((p) => p.freeTier)).toBe(true)
  })

  test("low-risk US egress providers include commercial and VPN options", () => {
    const providers = lowestRiskUsEgressProviders()
    expect(providers.length).toBeGreaterThan(0)
    expect(providers.every((p) => p.usEgress && p.riskTier === "low")).toBe(true)
    expect(providers.some((p) => p.category === "commercial-residential")).toBe(true)
    expect(providers.some((p) => p.category === "vpn-privacy")).toBe(true)
  })

  test("free-tier filter returns only free providers", () => {
    const free = providersByUseCase({ freeTier: true, maxRiskTier: "low" })
    expect(free.every((p) => p.freeTier)).toBe(true)
    expect(free.every((p) => p.riskTier === "low")).toBe(true)
  })

  test("max cost tier filtering excludes expensive providers", () => {
    const cheapOrFree = providersByUseCase({
      usEgress: true,
      maxRiskTier: "low",
      maxCostTier: "cheap",
    })
    expect(cheapOrFree.every((p) => ["free", "cheap"].includes(p.costTier))).toBe(true)
    expect(cheapOrFree.some((p) => p.id === "dataimpulse")).toBe(true)
  })
})
