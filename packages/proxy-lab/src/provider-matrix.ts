import { Schema } from "effect"

export const SourceCategory = Schema.Union([
  Schema.Literal("commercial-residential"),
  Schema.Literal("static-residential"),
  Schema.Literal("distributed-browser-network"),
  Schema.Literal("consumer-residential-vpn"),
  Schema.Literal("vpn-privacy"),
  Schema.Literal("p2p-bandwidth-sharing"),
  Schema.Literal("self-operated"),
  Schema.Literal("grey-market-resale"),
  Schema.Literal("bulletproof-hosting"),
  Schema.Literal("compromised-botnet"),
  Schema.Literal("public-free-list"),
])
export type SourceCategory = typeof SourceCategory.Type

export const RiskTier = Schema.Union([
  Schema.Literal("low"),
  Schema.Literal("moderate"),
  Schema.Literal("high"),
  Schema.Literal("critical"),
])
export type RiskTier = typeof RiskTier.Type

export const CostTier = Schema.Union([
  Schema.Literal("free"),
  Schema.Literal("cheap"),
  Schema.Literal("moderate"),
  Schema.Literal("expensive"),
])
export type CostTier = typeof CostTier.Type

export const PricingModel = Schema.Union([
  Schema.Literal("per-gb"),
  Schema.Literal("per-ip-month"),
  Schema.Literal("flat-monthly"),
  Schema.Literal("free"),
])
export type PricingModel = typeof PricingModel.Type

export const IpType = Schema.Union([
  Schema.Literal("residential"),
  Schema.Literal("mobile"),
  Schema.Literal("datacenter"),
  Schema.Literal("vpn"),
  Schema.Literal("mixed"),
])
export type IpType = typeof IpType.Type

export const ConsentProvenance = Schema.Union([
  Schema.Literal("direct-provider-contract"),
  Schema.Literal("trial-provider-contract"),
  Schema.Literal("participant-opt-in"),
  Schema.Literal("friend-family-opt-in"),
  Schema.Literal("owned-account"),
  Schema.Literal("isp-contract"),
  Schema.Literal("low-information-p2p"),
  Schema.Literal("third-party-resale"),
  Schema.Literal("compromised-or-open"),
])
export type ConsentProvenance = typeof ConsentProvenance.Type

export const ProviderCostBasis = Schema.Union([
  Schema.Literal("free-tier"),
  Schema.Literal("per-gb"),
  Schema.Literal("per-ip-month"),
  Schema.Literal("flat-monthly"),
  Schema.Literal("browser-hour"),
  Schema.Literal("self-operated"),
])
export type ProviderCostBasis = typeof ProviderCostBasis.Type

export const UsdRange = Schema.Struct({
  min: Schema.Number,
  max: Schema.Number,
})
export type UsdRange = typeof UsdRange.Type

export const ProviderEconomics = Schema.Struct({
  providerId: Schema.String,
  consentProvenance: ConsentProvenance,
  costBasis: ProviderCostBasis,
  effectiveCostUsdPerGb: Schema.optional(UsdRange),
  monthlyCostUsd: Schema.optional(UsdRange),
  priceUsdPerIpMonth: Schema.optional(UsdRange),
  fairUseGbPerIpMonth: Schema.optional(UsdRange),
  browserHourUsd: Schema.optional(UsdRange),
  oneTimeHardwareUsd: Schema.optional(UsdRange),
  riskFacts: Schema.Array(Schema.String),
  provenance: Schema.String,
})
export type ProviderEconomics = typeof ProviderEconomics.Type

export const ProxyProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: SourceCategory,
  ipType: IpType,
  riskTier: RiskTier,
  costTier: CostTier,
  pricingModel: PricingModel,
  approxPriceUsdPerGb: Schema.Union([Schema.Number, Schema.Literal("n/a")]),
  freeTier: Schema.Boolean,
  usEgress: Schema.Boolean,
  auEgress: Schema.Boolean,
  notes: Schema.String,
})
export type ProxyProvider = typeof ProxyProvider.Type

export const defaultProviderMatrix: ReadonlyArray<ProxyProvider> = [
  {
    id: "dataimpulse",
    name: "DataImpulse",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.0,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "PAYG, often cited as the value floor for residential traffic.",
  },
  {
    id: "thordata",
    name: "Thordata",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 0.65,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Self-serve with city/ASN targeting.",
  },
  {
    id: "proxyrack",
    name: "Proxyrack",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.0,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Tiered pricing by threads/volume.",
  },
  {
    id: "iproyal",
    name: "IPRoyal",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "moderate",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.75,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Non-expiring bandwidth.",
  },
  {
    id: "proxying",
    name: "Proxying",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "moderate",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.5,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Low-cost residential plans with non-expiring bandwidth options.",
  },
  {
    id: "proxy-cheap-seller",
    name: "Proxy-Cheap / Proxy-Seller",
    category: "commercial-residential",
    ipType: "mixed",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.5,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Budget residential/mobile plans; verify pool quality and ASN mix per target.",
  },
  {
    id: "oxylabs",
    name: "Oxylabs",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "expensive",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 5.0,
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "Enterprise grade; free trial available.",
  },
  {
    id: "brightdata",
    name: "Bright Data",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "expensive",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 5.0,
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "Enterprise grade with SDK-based P2P panel.",
  },
  {
    id: "evomi-core",
    name: "Evomi Core Residential",
    category: "commercial-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 0.49,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Rotating residential pool; among the cheapest per-GB residential proxies.",
  },
  {
    id: "evomi-static",
    name: "Evomi Static Residential (ISP)",
    category: "static-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-ip-month",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Static residential IPs at ~$1.00/IP/mo with unlimited bandwidth; cheapest flat-rate option.",
  },
  {
    id: "webshare",
    name: "Webshare",
    category: "commercial-residential",
    ipType: "datacenter",
    riskTier: "low",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: "n/a",
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "Free tier is 10 dedicated datacenter proxies + 1 GB/mo, not residential.",
  },
  {
    id: "browsercash",
    name: "Browser Cash",
    category: "distributed-browser-network",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-ip-month",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Distributed browser nodes via user extension; residential IPs from opted-in home connections.",
  },
  {
    id: "driverdev",
    name: "Driver.dev",
    category: "distributed-browser-network",
    ipType: "residential",
    riskTier: "low",
    costTier: "moderate",
    pricingModel: "flat-monthly",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Hosted real-hardware browser PoPs with ISP-contract residential IPs; CDP/Playwright/Puppeteer API.",
  },
  {
    id: "iproyal-isp",
    name: "IPRoyal ISP proxies",
    category: "static-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-ip-month",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Static residential IPs from ISP ASNs; ~$2.40–$5.40/IP/mo with unlimited bandwidth.",
  },
  {
    id: "webshare-isp",
    name: "Webshare ISP proxies",
    category: "static-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-ip-month",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Static ISP proxies starting around $3/IP/mo; often with unlimited bandwidth.",
  },
  {
    id: "brightdata-isp",
    name: "Bright Data ISP proxies",
    category: "static-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "moderate",
    pricingModel: "per-ip-month",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Static residential IPs from ISPs; priced per IP/month with high fair-use limits.",
  },
  {
    id: "oxylabs-isp",
    name: "Oxylabs Static Residential Proxies",
    category: "static-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "moderate",
    pricingModel: "per-ip-month",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "ISP-sourced static IPs; per-IP monthly pricing.",
  },
  {
    id: "us-isp-business-line",
    name: "US ISP business line with static IP",
    category: "static-residential",
    ipType: "residential",
    riskTier: "low",
    costTier: "expensive",
    pricingModel: "flat-monthly",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: false,
    notes: "True residential/business connection with static IP; $50–$200/mo depending on ISP.",
  },
  {
    id: "mullvad",
    name: "Mullvad VPN",
    category: "vpn-privacy",
    ipType: "vpn",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "flat-monthly",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: false,
    notes: "Flat monthly fee; US exits but datacenter ASNs, often blocked by targets.",
  },
  {
    id: "windscribe",
    name: "Windscribe",
    category: "vpn-privacy",
    ipType: "vpn",
    riskTier: "low",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: "n/a",
    freeTier: true,
    usEgress: true,
    auEgress: false,
    notes: "Free 10 GB/mo with US exits; Build-a-Plan for cheap paid tier.",
  },
  {
    id: "protonvpn",
    name: "Proton VPN",
    category: "vpn-privacy",
    ipType: "vpn",
    riskTier: "low",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: "n/a",
    freeTier: true,
    usEgress: true,
    auEgress: false,
    notes: "Free tier includes US servers; slower than paid.",
  },
  {
    id: "cloudflare-warp",
    name: "Cloudflare WARP+",
    category: "vpn-privacy",
    ipType: "vpn",
    riskTier: "low",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: "n/a",
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "Sometimes egresses from US Cloudflare PoPs; not residential.",
  },
  {
    id: "windscribe-residential",
    name: "Windscribe + Residential IP add-on",
    category: "consumer-residential-vpn",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "per-ip-month",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: false,
    notes: "VPN base plan plus static residential IP add-on (~$2/IP/mo); polished apps, unlimited bandwidth.",
  },
  {
    id: "hola-vpn",
    name: "Hola VPN",
    category: "consumer-residential-vpn",
    ipType: "residential",
    riskTier: "moderate",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: "n/a",
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "P2P residential VPN; free tier makes your device an exit node for others. Privacy concerns.",
  },
  {
    id: "self-home-node",
    name: "Self-operated home node",
    category: "self-operated",
    ipType: "residential",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "flat-monthly",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: false,
    notes: "Raspberry Pi or mini-PC at a US residence with documented consent.",
  },
  {
    id: "self-mobile-node",
    name: "Self-operated mobile node",
    category: "self-operated",
    ipType: "mobile",
    riskTier: "low",
    costTier: "cheap",
    pricingModel: "flat-monthly",
    approxPriceUsdPerGb: "n/a",
    freeTier: false,
    usEgress: true,
    auEgress: false,
    notes: "US phone/SIM with USB tether + WireGuard backhaul.",
  },
  {
    id: "packetstream",
    name: "PacketStream",
    category: "p2p-bandwidth-sharing",
    ipType: "residential",
    riskTier: "moderate",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.5,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "P2P bandwidth marketplace; consent is often low-information.",
  },
  {
    id: "honeygain",
    name: "Honeygain",
    category: "p2p-bandwidth-sharing",
    ipType: "residential",
    riskTier: "moderate",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.5,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Bandwidth-sharing app; more suited to passive income than proxy research.",
  },
  {
    id: "brightdata-sdk",
    name: "Bright Data SDK (P2P panel)",
    category: "p2p-bandwidth-sharing",
    ipType: "residential",
    riskTier: "moderate",
    costTier: "moderate",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 3.0,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "App-embedded SDK where end users opt in via ToS.",
  },
  {
    id: "resold-isp-account",
    name: "Resold ISP/customer account",
    category: "grey-market-resale",
    ipType: "residential",
    riskTier: "high",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.0,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Likely violates ISP ToS; identity-fraud risk if accounts are stolen.",
  },
  {
    id: "sim-farm",
    name: "US SIM farm / mobile proxy",
    category: "grey-market-resale",
    ipType: "mobile",
    riskTier: "high",
    costTier: "moderate",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 2.5,
    freeTier: false,
    usEgress: true,
    auEgress: false,
    notes: "Legal only if you own the SIMs and contracts; high carrier-ToS risk otherwise.",
  },
  {
    id: "academic-corporate-trial-arbitrage",
    name: "Academic / corporate trial arbitrage",
    category: "grey-market-resale",
    ipType: "mixed",
    riskTier: "high",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: 0,
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "Repeated trials using fabricated or borrowed identities/cards; high account-fraud exposure.",
  },
  {
    id: "bulletproof-hosting",
    name: "Bulletproof / offshore host",
    category: "bulletproof-hosting",
    ipType: "mixed",
    riskTier: "critical",
    costTier: "cheap",
    pricingModel: "per-gb",
    approxPriceUsdPerGb: 1.0,
    freeTier: false,
    usEgress: true,
    auEgress: true,
    notes: "Often mixes datacenter and compromised residential IPs; high fraud association.",
  },
  {
    id: "compromised-botnet",
    name: "Compromised IoT / botnet proxy",
    category: "compromised-botnet",
    ipType: "residential",
    riskTier: "critical",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: 0,
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "Criminal under AU/US computer-misuse law; do not use.",
  },
  {
    id: "public-free-list",
    name: "Public free proxy list",
    category: "public-free-list",
    ipType: "mixed",
    riskTier: "critical",
    costTier: "free",
    pricingModel: "free",
    approxPriceUsdPerGb: 0,
    freeTier: true,
    usEgress: true,
    auEgress: true,
    notes: "Open relays, often misconfigured or malware; traffic interception risk.",
  },
]

export const providerEconomics: ReadonlyArray<ProviderEconomics> = [
  {
    providerId: "evomi-core",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 0.49, max: 0.49 },
    riskFacts: ["Rotating residential pool", "Review pool cleanliness against target block rate before volume purchase"],
    provenance: "Plan cheap commercial table: ~US$0.49/GB",
  },
  {
    providerId: "dataimpulse",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1.0, max: 1.0 },
    riskFacts: ["PAYG residential traffic", "Value-floor provider cited for small-volume testing"],
    provenance: "Plan cheap commercial table: ~US$1.00/GB",
  },
  {
    providerId: "thordata",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 0.65, max: 0.65 },
    riskFacts: ["City/ASN targeting changes reachable pool size", "Self-serve provider contract"],
    provenance: "Plan cheap commercial table: from ~US$0.65/GB",
  },
  {
    providerId: "proxyrack",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 0.5, max: 1.5 },
    riskFacts: ["Tiered by threads and volume", "Retry cost depends on pool cleanliness"],
    provenance: "Plan cheap commercial table: ~US$0.50–$1.50/GB",
  },
  {
    providerId: "iproyal",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1.75, max: 1.75 },
    riskFacts: ["Non-expiring bandwidth lowers breakage from unused credits"],
    provenance: "Plan cheap commercial table: from ~US$1.75/GB",
  },
  {
    providerId: "proxying",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1.5, max: 1.5 },
    riskFacts: ["Non-expiring bandwidth option", "Confirm US residential ASN mix before purchase"],
    provenance: "Plan cheap commercial table: Proxying from ~US$1.50/GB",
  },
  {
    providerId: "proxy-cheap-seller",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1.0, max: 2.0 },
    riskFacts: ["Variable residential/mobile plans", "Pool composition needs target-specific verification"],
    provenance: "Plan cheap commercial table: Proxy-Cheap / Proxy-Seller variable",
  },
  {
    providerId: "webshare",
    consentProvenance: "trial-provider-contract",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    monthlyCostUsd: { min: 0, max: 2.99 },
    riskFacts: ["Free tier is datacenter, not residential", "Useful only for quick US egress checks"],
    provenance: "Plan free tier table: 10 datacenter proxies + 1 GB/mo; paid entry ~$2.99/mo",
  },
  {
    providerId: "windscribe",
    consentProvenance: "direct-provider-contract",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    monthlyCostUsd: { min: 0, max: 3 },
    riskFacts: ["VPN exits use datacenter ASNs", "Free tier limited to 10 GB/mo"],
    provenance: "Plan free tier table: 10 GB/mo; Build-a-Plan ~$3/mo",
  },
  {
    providerId: "protonvpn",
    consentProvenance: "direct-provider-contract",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    monthlyCostUsd: { min: 0, max: 10 },
    riskFacts: ["Free US servers are slower than paid", "VPN ASN may be blocked by targets"],
    provenance: "Plan free tier table: free US servers; paid entry ~$10/mo",
  },
  {
    providerId: "cloudflare-warp",
    consentProvenance: "direct-provider-contract",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    monthlyCostUsd: { min: 0, max: 4.99 },
    riskFacts: ["Not residential", "US egress is not guaranteed from Australia"],
    provenance: "Plan free tier table: free / WARP+ ~$4.99/mo",
  },
  {
    providerId: "oxylabs",
    consentProvenance: "trial-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 5, max: 5 },
    riskFacts: ["Enterprise onboarding and trial scope control", "Reputable residential pool"],
    provenance: "Plan free tier table: trials / small free tiers; provider matrix list price placeholder",
  },
  {
    providerId: "brightdata",
    consentProvenance: "trial-provider-contract",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 5, max: 5 },
    riskFacts: ["Enterprise onboarding and SDK-based participant pool", "Trial scope is safest free residential path"],
    provenance: "Plan free tier table: trials / small free tiers; provider matrix list price placeholder",
  },
  {
    providerId: "windscribe-residential",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-ip-month",
    monthlyCostUsd: { min: 5, max: 7 },
    priceUsdPerIpMonth: { min: 2, max: 2 },
    fairUseGbPerIpMonth: { min: 100, max: 500 },
    effectiveCostUsdPerGb: { min: 0.01, max: 0.07 },
    riskFacts: ["Static residential add-on", "Unlimited bandwidth claim still needs fair-use review"],
    provenance: "Plan consumer residential VPN table: ~$3–$5/mo + ~$2/mo/IP",
  },
  {
    providerId: "evomi-static",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-ip-month",
    priceUsdPerIpMonth: { min: 1, max: 1 },
    fairUseGbPerIpMonth: { min: 20, max: 100 },
    effectiveCostUsdPerGb: { min: 0.01, max: 0.05 },
    riskFacts: ["Flat-rate static ISP proxy", "Cheap static IP may already be flagged by major sites"],
    provenance: "Plan static options table: ~US$1.00/IP/mo; caveats say 20–100 GB/IP/mo fair-use",
  },
  {
    providerId: "webshare-isp",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-ip-month",
    priceUsdPerIpMonth: { min: 2, max: 3 },
    fairUseGbPerIpMonth: { min: 20, max: 100 },
    effectiveCostUsdPerGb: { min: 0.02, max: 0.15 },
    riskFacts: ["Static ISP proxy", "One blocked IP breaks sticky sessions"],
    provenance: "Plan cheapest flat-rate table: ~$2–$3/IP/mo; caveats say 20–100 GB/IP/mo fair-use",
  },
  {
    providerId: "iproyal-isp",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-ip-month",
    priceUsdPerIpMonth: { min: 2.4, max: 5.4 },
    fairUseGbPerIpMonth: { min: 20, max: 100 },
    effectiveCostUsdPerGb: { min: 0.024, max: 0.27 },
    riskFacts: ["Static ISP proxy", "Non-rotating reputation must be monitored per account/session"],
    provenance: "Plan cheapest flat-rate table: ~$2.40–$5.40/IP/mo; caveats say 20–100 GB/IP/mo fair-use",
  },
  {
    providerId: "brightdata-isp",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-ip-month",
    priceUsdPerIpMonth: { min: 5, max: 10 },
    fairUseGbPerIpMonth: { min: 20, max: 100 },
    effectiveCostUsdPerGb: { min: 0.05, max: 0.5 },
    riskFacts: ["Static ISP proxy", "Higher contract trust and cost than budget static pools"],
    provenance: "Plan cheapest flat-rate table: ~$5–$10/IP/mo; caveats say 20–100 GB/IP/mo fair-use",
  },
  {
    providerId: "oxylabs-isp",
    consentProvenance: "direct-provider-contract",
    costBasis: "per-ip-month",
    priceUsdPerIpMonth: { min: 5, max: 10 },
    fairUseGbPerIpMonth: { min: 20, max: 100 },
    effectiveCostUsdPerGb: { min: 0.05, max: 0.5 },
    riskFacts: ["ISP-sourced static IPs", "Enterprise controls and per-IP pricing"],
    provenance: "Plan static residential options table: ISP proxies $2–$10/IP/mo",
  },
  {
    providerId: "us-isp-business-line",
    consentProvenance: "isp-contract",
    costBasis: "flat-monthly",
    monthlyCostUsd: { min: 50, max: 200 },
    fairUseGbPerIpMonth: { min: 100, max: 1000 },
    effectiveCostUsdPerGb: { min: 0.05, max: 2 },
    riskFacts: ["Highest trust static US connection", "Highest fixed cost and operational ownership"],
    provenance: "Plan static options table: $50–$200/mo",
  },
  {
    providerId: "browsercash",
    consentProvenance: "participant-opt-in",
    costBasis: "browser-hour",
    browserHourUsd: { min: 0.09, max: 0.09 },
    riskFacts: ["Browser extension nodes from opted-in residential connections", "Costs normalize by browser-hour rather than GB"],
    provenance: "Plan Browser Cash case study: claimed $0.09/browser/hr",
  },
  {
    providerId: "driverdev",
    consentProvenance: "isp-contract",
    costBasis: "browser-hour",
    riskFacts: ["Hosted real-hardware PoPs with ISP contracts", "Contact-sales pricing; compare by browser-hour outcome"],
    provenance: "Plan Browser Cash / Driver.dev case study",
  },
  {
    providerId: "self-home-node",
    consentProvenance: "friend-family-opt-in",
    costBasis: "self-operated",
    monthlyCostUsd: { min: 20, max: 100 },
    oneTimeHardwareUsd: { min: 100, max: 150 },
    effectiveCostUsdPerGb: { min: 0.3, max: 0.8 },
    riskFacts: ["Documented host consent required", "Node owner receives abuse reports for that IP"],
    provenance: "Plan self-operated and fixed-line opt-in sections: $100–$150 hardware; $20–$100/mo or $0.30–$0.80/GB",
  },
  {
    providerId: "self-mobile-node",
    consentProvenance: "owned-account",
    costBasis: "self-operated",
    monthlyCostUsd: { min: 40, max: 150 },
    oneTimeHardwareUsd: { min: 100, max: 410 },
    effectiveCostUsdPerGb: { min: 0.2, max: 1.0 },
    riskFacts: ["Use business SIM/data plans for resale/proxy use", "IP rotation depends on carrier CGNAT behavior"],
    provenance: "Plan mobile proxy farm sections: $40–$150/mo SIM; 50–300 GB/mo; $0.20–$1.00/GB",
  },
  {
    providerId: "packetstream",
    consentProvenance: "low-information-p2p",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1, max: 3 },
    riskFacts: ["End-user consent may be low-information", "Destination abuse reports land on participant home IPs"],
    provenance: "Plan P2P section: usually $1–$3/GB",
  },
  {
    providerId: "honeygain",
    consentProvenance: "low-information-p2p",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1, max: 3 },
    riskFacts: ["Bandwidth-sharing app rather than proxy-first UX", "Participant IP reputation exposure"],
    provenance: "Plan P2P section: usually $1–$3/GB",
  },
  {
    providerId: "brightdata-sdk",
    consentProvenance: "participant-opt-in",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 3, max: 3 },
    riskFacts: ["SDK opt-in consent is mediated by app disclosure quality", "Enterprise customer controls can narrow allowed use"],
    provenance: "Plan P2P examples and provider matrix placeholder",
  },
  {
    providerId: "hola-vpn",
    consentProvenance: "low-information-p2p",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    monthlyCostUsd: { min: 0, max: 15 },
    riskFacts: ["Free tier makes the user device an exit node", "Poor privacy record noted in plan"],
    provenance: "Plan consumer residential VPN table: Free / ~$15/mo premium",
  },
  {
    providerId: "resold-isp-account",
    consentProvenance: "third-party-resale",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1, max: 1 },
    riskFacts: ["Likely ISP ToS violation", "May be tied to fabricated or stolen identity data"],
    provenance: "Plan grey market table",
  },
  {
    providerId: "sim-farm",
    consentProvenance: "third-party-resale",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 2.5, max: 2.5 },
    riskFacts: ["Carrier ToS risk unless SIMs and contracts are owned", "Cloned or stolen SIMs change risk class"],
    provenance: "Plan grey market table",
  },
  {
    providerId: "academic-corporate-trial-arbitrage",
    consentProvenance: "third-party-resale",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    riskFacts: ["Repeated free trials depend on fabricated, borrowed, or rotated identities/cards", "High account-fraud and contract-termination exposure"],
    provenance: "Plan grey market table",
  },
  {
    providerId: "bulletproof-hosting",
    consentProvenance: "third-party-resale",
    costBasis: "per-gb",
    effectiveCostUsdPerGb: { min: 1, max: 1 },
    riskFacts: ["Often mixes datacenter and compromised residential IPs", "Frequent fraud and abuse-report exposure"],
    provenance: "Plan grey market table",
  },
  {
    providerId: "compromised-botnet",
    consentProvenance: "compromised-or-open",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    riskFacts: ["Relies on unauthorized third-party devices", "Criminal exposure under AU/US computer-misuse statutes"],
    provenance: "Plan grey market table and statutory notes",
  },
  {
    providerId: "public-free-list",
    consentProvenance: "compromised-or-open",
    costBasis: "free-tier",
    effectiveCostUsdPerGb: { min: 0, max: 0 },
    riskFacts: ["Open relays may intercept traffic", "Many entries originate from misconfigured or malware-controlled devices"],
    provenance: "Plan grey market table",
  },
]

export interface ConsentBasedUsEgressComparison {
  readonly providerId: string
  readonly name: string
  readonly category: SourceCategory
  readonly ipType: IpType
  readonly riskTier: RiskTier
  readonly costTier: CostTier
  readonly costBasis: ProviderCostBasis
  readonly consentProvenance: ConsentProvenance
  readonly normalizedCostUsdPerGb?: UsdRange
  readonly normalizedCostBasis: string
  readonly usEgress: true
  readonly riskFacts: ReadonlyArray<string>
  readonly provenance: string
}

const nonConsentProvenance = new Set<ConsentProvenance>([
  "third-party-resale",
  "compromised-or-open",
])

const riskRank: Record<RiskTier, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
}

function normalizedCostBasis(economics: ProviderEconomics): string {
  switch (economics.costBasis) {
    case "free-tier":
      return "free-tier-usd-per-gb"
    case "per-gb":
      return "listed-usd-per-gb"
    case "per-ip-month":
      return "monthly-ip-price-divided-by-plan-fair-use-gb"
    case "flat-monthly":
      return "monthly-fixed-price-divided-by-assumed-monthly-gb"
    case "browser-hour":
      return "browser-hour-pricing-not-bandwidth-normalized"
    case "self-operated":
      return "operator-cost-divided-by-observed-monthly-gb"
  }
}

export function providerEconomicsFor(providerId: string): ProviderEconomics | undefined {
  return providerEconomics.find((e) => e.providerId === providerId)
}

export function consentBasedUsEgressComparisons(): ReadonlyArray<ConsentBasedUsEgressComparison> {
  const economicsByProviderId = new Map(providerEconomics.map((e) => [e.providerId, e]))

  return defaultProviderMatrix
    .filter((provider) => provider.usEgress)
    .flatMap((provider) => {
      const economics = economicsByProviderId.get(provider.id)
      if (!economics || nonConsentProvenance.has(economics.consentProvenance)) return []

      return [{
        providerId: provider.id,
        name: provider.name,
        category: provider.category,
        ipType: provider.ipType,
        riskTier: provider.riskTier,
        costTier: provider.costTier,
        costBasis: economics.costBasis,
        consentProvenance: economics.consentProvenance,
        normalizedCostUsdPerGb: economics.effectiveCostUsdPerGb,
        normalizedCostBasis: normalizedCostBasis(economics),
        usEgress: true,
        riskFacts: economics.riskFacts,
        provenance: economics.provenance,
      } satisfies ConsentBasedUsEgressComparison]
    })
    .sort((a, b) => {
      const riskDelta = riskRank[a.riskTier] - riskRank[b.riskTier]
      if (riskDelta !== 0) return riskDelta
      const aCost = a.normalizedCostUsdPerGb?.min ?? Number.POSITIVE_INFINITY
      const bCost = b.normalizedCostUsdPerGb?.min ?? Number.POSITIVE_INFINITY
      return aCost - bCost
    })
}

export function providersByCategory(
  category: SourceCategory,
): ReadonlyArray<ProxyProvider> {
  return defaultProviderMatrix.filter((p) => p.category === category)
}

export function providersByRisk(
  riskTier: RiskTier,
): ReadonlyArray<ProxyProvider> {
  return defaultProviderMatrix.filter((p) => p.riskTier === riskTier)
}

export function providersByUseCase(filters: {
  readonly usEgress?: boolean
  readonly freeTier?: boolean
  readonly maxRiskTier?: RiskTier
  readonly maxCostTier?: CostTier
}): ReadonlyArray<ProxyProvider> {
  const riskOrder: ReadonlyArray<RiskTier> = ["low", "moderate", "high", "critical"]
  const costOrder: ReadonlyArray<CostTier> = ["free", "cheap", "moderate", "expensive"]

  const maxRiskIndex = filters.maxRiskTier ? riskOrder.indexOf(filters.maxRiskTier) : Infinity
  const maxCostIndex = filters.maxCostTier ? costOrder.indexOf(filters.maxCostTier) : Infinity

  return defaultProviderMatrix.filter((p) => {
    if (filters.usEgress !== undefined && p.usEgress !== filters.usEgress) return false
    if (filters.freeTier !== undefined && p.freeTier !== filters.freeTier) return false
    if (Number.isFinite(maxRiskIndex) && riskOrder.indexOf(p.riskTier) > maxRiskIndex) return false
    if (Number.isFinite(maxCostIndex) && costOrder.indexOf(p.costTier) > maxCostIndex) return false
    return true
  })
}

export function lowestRiskUsEgressProviders(): ReadonlyArray<ProxyProvider> {
  return providersByUseCase({ usEgress: true, maxRiskTier: "low" })
}
