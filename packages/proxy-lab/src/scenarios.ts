import { Schema } from "effect"
import { ConsentProvenance, IpType, RiskTier, UsdRange } from "./provider-matrix.ts"

export const ScrapingTarget = Schema.Union([
  Schema.Literal("static-html"),
  Schema.Literal("headless-page"),
  Schema.Literal("api-only"),
  Schema.Literal("tiktok-video-low"),
  Schema.Literal("tiktok-video-high"),
  Schema.Literal("tiktok-metadata"),
])
export type ScrapingTarget = typeof ScrapingTarget.Type

export const bytesPerTarget: Record<ScrapingTarget, number> = {
  "static-html": 200_000, // ~200 KB average page
  "headless-page": 2_000_000, // ~2 MB with JS/CSS/images rendered
  "api-only": 50_000, // ~50 KB JSON response
  "tiktok-video-low": 5_000_000, // ~5 MB 720p short video
  "tiktok-video-high": 25_000_000, // ~25 MB 1080p short video
  "tiktok-metadata": 150_000, // ~150 KB page + thumbnail metadata
}

export const InfrastructureCostBasis = Schema.Union([
  Schema.Literal("participant-payout-per-gb"),
  Schema.Literal("business-sim-monthly"),
  Schema.Literal("fixed-node-monthly"),
  Schema.Literal("isp-contract"),
  Schema.Literal("device-hosting-monthly"),
  Schema.Literal("browser-hour"),
])
export type InfrastructureCostBasis = typeof InfrastructureCostBasis.Type

export const UsEgressInfrastructureScenario = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  ipType: IpType,
  riskTier: RiskTier,
  consentProvenance: ConsentProvenance,
  costBasis: InfrastructureCostBasis,
  normalizedCostUsdPerGb: UsdRange,
  monthlyFixedCostUsd: Schema.optional(UsdRange),
  oneTimeHardwareUsd: Schema.optional(UsdRange),
  participantPayoutUsdPerGb: Schema.optional(UsdRange),
  expectedGbPerNodeMonth: Schema.optional(UsdRange),
  usEgress: Schema.Literal(true),
  bestFor: Schema.Array(Schema.String),
  riskFacts: Schema.Array(Schema.String),
  provenance: Schema.String,
})
export type UsEgressInfrastructureScenario = typeof UsEgressInfrastructureScenario.Type

export const usEgressInfrastructureScenarios: ReadonlyArray<UsEgressInfrastructureScenario> = [
  {
    id: "p2p-bandwidth-sharing-app",
    label: "P2P bandwidth-sharing app",
    ipType: "residential",
    riskTier: "moderate",
    consentProvenance: "participant-opt-in",
    costBasis: "participant-payout-per-gb",
    normalizedCostUsdPerGb: { min: 0.05, max: 0.3 },
    monthlyFixedCostUsd: { min: 200, max: 200 },
    participantPayoutUsdPerGb: { min: 0.1, max: 0.5 },
    usEgress: true,
    bestFor: ["National scale", "large rotating pools", "100k+ IP supply"],
    riskFacts: [
      "Disclosure quality controls consent strength",
      "Gateway needs abuse filtering, metering, and kill switches",
    ],
    provenance: "Plan US sourcing model table and P2P app network section",
  },
  {
    id: "mobile-proxy-farm",
    label: "Owned US mobile proxy farm",
    ipType: "mobile",
    riskTier: "low",
    consentProvenance: "owned-account",
    costBasis: "business-sim-monthly",
    normalizedCostUsdPerGb: { min: 0.1, max: 0.5 },
    monthlyFixedCostUsd: { min: 40, max: 150 },
    oneTimeHardwareUsd: { min: 210, max: 410 },
    expectedGbPerNodeMonth: { min: 50, max: 300 },
    usEgress: true,
    bestFor: ["City targeting", "high-trust mobile ASNs", "controlled IP rotation"],
    riskFacts: [
      "Consumer SIM ToS usually prohibit resale or commercial proxy use",
      "Business data plan ownership keeps provenance reviewable",
    ],
    provenance: "Plan mobile proxy farm sections: $40–$150/mo SIM, 50–300 GB/mo, $0.10–$0.50/GB US model",
  },
  {
    id: "fixed-line-opt-in-node",
    label: "Fixed-line opt-in home node",
    ipType: "residential",
    riskTier: "low",
    consentProvenance: "friend-family-opt-in",
    costBasis: "fixed-node-monthly",
    normalizedCostUsdPerGb: { min: 0.2, max: 0.8 },
    monthlyFixedCostUsd: { min: 30, max: 100 },
    oneTimeHardwareUsd: { min: 100, max: 150 },
    expectedGbPerNodeMonth: { min: 40, max: 250 },
    usEgress: true,
    bestFor: ["Sticky sessions", "static-ish home IPs", "small trusted pools"],
    riskFacts: [
      "Participant ISP fair-use and sharing terms must allow the node",
      "Abuse reports map to the participant connection",
    ],
    provenance: "Plan fixed-line opt-in sections: $100–$150 hardware; $30–$100/mo or $0.20–$0.80/GB",
  },
  {
    id: "isp-wisp-partnership",
    label: "ISP / WISP partnership",
    ipType: "residential",
    riskTier: "low",
    consentProvenance: "isp-contract",
    costBasis: "isp-contract",
    normalizedCostUsdPerGb: { min: 0.1, max: 0.5 },
    usEgress: true,
    bestFor: ["Wholesale volume", "contracted provenance", "regional pool supply"],
    riskFacts: [
      "Requires contracts and volume commitments",
      "Operational review shifts to abuse desk and routing controls",
    ],
    provenance: "Plan US sourcing model table: ISP / WISP partnerships $0.10–$0.50/GB",
  },
  {
    id: "travel-router-us-esim",
    label: "Travel router / US eSIM hotspot",
    ipType: "mobile",
    riskTier: "low",
    consentProvenance: "owned-account",
    costBasis: "business-sim-monthly",
    normalizedCostUsdPerGb: { min: 0.2, max: 1.0 },
    monthlyFixedCostUsd: { min: 30, max: 100 },
    oneTimeHardwareUsd: { min: 100, max: 300 },
    expectedGbPerNodeMonth: { min: 50, max: 300 },
    usEgress: true,
    bestFor: ["Plug-and-play mobile IP", "browsing checks", "small mobile-egress pools"],
    riskFacts: [
      "Long-lived or static CGNAT IP is less residential than fixed-line home broadband",
      "Carrier plan terms determine resale/proxy permission",
    ],
    provenance: "Plan consumer residential VPN and static option tables: SIM/eSIM plan, $30–$100/mo",
  },
  {
    id: "residential-colocation",
    label: "Residential co-location",
    ipType: "residential",
    riskTier: "low",
    consentProvenance: "friend-family-opt-in",
    costBasis: "device-hosting-monthly",
    normalizedCostUsdPerGb: { min: 0.3, max: 0.8 },
    monthlyFixedCostUsd: { min: 50, max: 150 },
    oneTimeHardwareUsd: { min: 100, max: 150 },
    usEgress: true,
    bestFor: ["Dedicated equipment", "high-trust fixed residential IP", "operator-controlled software"],
    riskFacts: [
      "Cost is negotiated with the host residence",
      "Single-IP block or outage affects all sessions on that node",
    ],
    provenance: "Plan static residential options table: rent device/space in a US home $50–$150/mo; residential co-location negotiated",
  },
]

export function consentBasedUsEgressInfrastructureScenarios(): ReadonlyArray<UsEgressInfrastructureScenario> {
  return usEgressInfrastructureScenarios
    .filter((scenario) => scenario.usEgress)
    .sort((a, b) => a.normalizedCostUsdPerGb.min - b.normalizedCostUsdPerGb.min)
}

export interface ScrapingEstimate {
  readonly target: ScrapingTarget
  readonly items: number
  readonly proxyPricePerGbUsd: number
  readonly bytesPerItem: number
  readonly totalBytes: number
  readonly totalGb: number
  readonly proxyCostUsd: number
  readonly overheadFactor: number
  readonly notes: string
}

export function estimateScrapingCost(
  target: ScrapingTarget,
  items: number,
  proxyPricePerGbUsd: number,
  overheadFactor = 1.2,
): ScrapingEstimate {
  const bytesPerItem = bytesPerTarget[target]
  const totalBytes = bytesPerItem * items * overheadFactor
  const totalGb = totalBytes / 1_073_741_824
  const proxyCostUsd = totalGb * proxyPricePerGbUsd

  const notesByTarget: Record<ScrapingTarget, string> = {
    "static-html":
      "Light HTML pages; assumes no images/JS assets are fetched. Good for link/content extraction.",
    "headless-page":
      "Playwright/Puppeteer page load including scripts, stylesheets, and images. Much heavier than static HTML.",
    "api-only":
      "Direct JSON API calls. Cheapest if the target exposes a stable API and you have permission.",
    "tiktok-video-low":
      "720p short-form video download. Video dominates bandwidth; proxy cost scales linearly with minutes downloaded.",
    "tiktok-video-high":
      "1080p short-form video download. Roughly 5x the bandwidth of 720p.",
    "tiktok-metadata":
      "Page HTML, thumbnail, and metadata only. Avoids video file downloads; ~100x cheaper than full video scraping.",
  }

  return {
    target,
    items,
    proxyPricePerGbUsd,
    bytesPerItem,
    totalBytes,
    totalGb,
    proxyCostUsd,
    overheadFactor,
    notes: notesByTarget[target],
  }
}

export function compareScrapingCosts(
  items: number,
  proxyPricesPerGbUsd: ReadonlyArray<number>,
  overheadFactor = 1.2,
): ReadonlyArray<ScrapingEstimate> {
  const targets: ReadonlyArray<ScrapingTarget> = [
    "static-html",
    "headless-page",
    "api-only",
    "tiktok-metadata",
    "tiktok-video-low",
    "tiktok-video-high",
  ]

  const estimates: ScrapingEstimate[] = []
  for (const target of targets) {
    for (const price of proxyPricesPerGbUsd) {
      estimates.push(estimateScrapingCost(target, items, price, overheadFactor))
    }
  }
  return estimates
}

export function formatEstimate(e: ScrapingEstimate): string {
  return `${e.target}: ${e.items.toLocaleString()} items × ${(e.bytesPerItem / 1_000).toFixed(0)} KB @ $${e.proxyPricePerGbUsd}/GB ≈ ${e.totalGb.toFixed(2)} GB → $${e.proxyCostUsd.toFixed(2)}`
}
