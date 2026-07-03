import { describe, expect, test } from "bun:test"
import {
  consentBasedUsEgressComparisons,
  consentBasedUsEgressInfrastructureScenarios,
  defaultProviderMatrix,
  providerEconomics,
  providersByCategory,
  providersByRisk,
  providersByUseCase,
  lowestRiskUsEgressProviders,
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

  test("provider economics covers plan-only cheap commercial entries", () => {
    const economicsProviderIds = new Set(providerEconomics.map((e) => e.providerId))
    const providerIds = new Set(defaultProviderMatrix.map((p) => p.id))
    expect(providerEconomics.every((e) => providerIds.has(e.providerId))).toBe(true)
    expect(defaultProviderMatrix.some((p) => p.id === "proxying")).toBe(true)
    expect(defaultProviderMatrix.some((p) => p.id === "proxy-cheap-seller")).toBe(true)
    expect(economicsProviderIds.has("proxying")).toBe(true)
    expect(economicsProviderIds.has("proxy-cheap-seller")).toBe(true)
    expect(defaultProviderMatrix.some((p) => p.id === "academic-corporate-trial-arbitrage")).toBe(true)
    expect(economicsProviderIds.has("academic-corporate-trial-arbitrage")).toBe(true)
  })

  test("consent-based US egress comparisons expose normalized cost basis and provenance", () => {
    const comparisons = consentBasedUsEgressComparisons()
    expect(comparisons.length).toBeGreaterThan(0)
    expect(comparisons.every((option) => option.usEgress)).toBe(true)
    expect(comparisons.every((option) => option.normalizedCostBasis.length > 0)).toBe(true)
    expect(comparisons.some((option) => option.providerId === "evomi-static" && option.normalizedCostBasis === "monthly-ip-price-divided-by-plan-fair-use-gb")).toBe(true)
    expect(comparisons.some((option) => option.providerId === "browsercash" && option.normalizedCostBasis === "browser-hour-pricing-not-bandwidth-normalized")).toBe(true)
    expect(comparisons.some((option) => option.consentProvenance === "compromised-or-open")).toBe(false)
    expect(comparisons.some((option) => option.consentProvenance === "third-party-resale")).toBe(false)
  })

  test("infrastructure scenarios normalize consent-based US egress economics", () => {
    const scenarios = consentBasedUsEgressInfrastructureScenarios()
    expect(scenarios.length).toBeGreaterThan(0)
    expect(scenarios.every((scenario) => scenario.usEgress)).toBe(true)
    expect(scenarios.every((scenario) => scenario.normalizedCostUsdPerGb.min <= scenario.normalizedCostUsdPerGb.max)).toBe(true)
    expect(scenarios.some((scenario) => scenario.id === "mobile-proxy-farm" && scenario.consentProvenance === "owned-account")).toBe(true)
    expect(scenarios.some((scenario) => scenario.id === "isp-wisp-partnership" && scenario.consentProvenance === "isp-contract")).toBe(true)
  })
})
