import { Schema } from "effect"

export const EconomicsPricingModel = Schema.Union([
  Schema.Literal("pay-per-gb"),
  Schema.Literal("flat-monthly"),
  Schema.Literal("revenue-share"),
])
export type EconomicsPricingModel = typeof EconomicsPricingModel.Type

export const CostStackItem = Schema.Struct({
  name: Schema.String,
  monthlyUsd: Schema.Number,
  perGbUsd: Schema.Number,
})
export type CostStackItem = typeof CostStackItem.Type

export const ProxyEconomics = Schema.Struct({
  name: Schema.String,
  model: EconomicsPricingModel,
  wholesaleGbUsd: Schema.Number,
  retailGbUsd: Schema.Number,
  fixedMonthlyUsd: Schema.Number,
  expectedMonthlyGb: Schema.Number,
  customerAcquisitionCostUsd: Schema.Number,
  churnPerMonth: Schema.Number,
})
export type ProxyEconomics = typeof ProxyEconomics.Type

export const EconomicsSummary = Schema.Struct({
  monthlyRevenueUsd: Schema.Number,
  monthlyBandwidthCostUsd: Schema.Number,
  monthlyFixedCostUsd: Schema.Number,
  monthlyGrossProfitUsd: Schema.Number,
  grossMargin: Schema.Number,
  costPerGb: Schema.Number,
  breakEvenGb: Schema.Number,
  wholesaleGbUsd: Schema.Number,
  expectedMonthlyGb: Schema.Number,
})
export type EconomicsSummary = typeof EconomicsSummary.Type
export function computeEconomics(config: ProxyEconomics): EconomicsSummary {
  const effectiveChurn = Math.max(0, Math.min(1, config.churnPerMonth))
  const retainedRevenueMultiplier = 1 - effectiveChurn

  const monthlyRevenueUsd =
    config.expectedMonthlyGb * config.retailGbUsd * retainedRevenueMultiplier
  const monthlyBandwidthCostUsd = config.expectedMonthlyGb * config.wholesaleGbUsd
  const monthlyFixedCostUsd = config.fixedMonthlyUsd
  const monthlyGrossProfitUsd = monthlyRevenueUsd - monthlyBandwidthCostUsd - monthlyFixedCostUsd

  const grossMargin =
    monthlyRevenueUsd > 0 ? monthlyGrossProfitUsd / monthlyRevenueUsd : 0

  const costPerGb =
    config.expectedMonthlyGb > 0
      ? (monthlyBandwidthCostUsd + monthlyFixedCostUsd) / config.expectedMonthlyGb
      : 0

  const breakEvenGb =
    config.retailGbUsd > config.wholesaleGbUsd
      ? config.fixedMonthlyUsd / (config.retailGbUsd - config.wholesaleGbUsd)
      : 0

  return {
    monthlyRevenueUsd,
    monthlyBandwidthCostUsd,
    monthlyFixedCostUsd,
    monthlyGrossProfitUsd,
    grossMargin,
    costPerGb,
    breakEvenGb,
    wholesaleGbUsd: config.wholesaleGbUsd,
    expectedMonthlyGb: config.expectedMonthlyGb,
  }
}

export const AU_INFRA_COST_STACK: ReadonlyArray<CostStackItem> = [
  { name: "aggregation-vps", monthlyUsd: 400, perGbUsd: 0 },
  { name: "bandwidth-cdn-logs", monthlyUsd: 150, perGbUsd: 0 },
  { name: "accounting-ato", monthlyUsd: 500, perGbUsd: 0 },
  { name: "abuse-monitoring", monthlyUsd: 200, perGbUsd: 0 },
]

export function costStackForMonthlyGb(
  stack: ReadonlyArray<CostStackItem>,
  monthlyGb: number,
): { monthlyFixedUsd: number; perGbUsd: number } {
  const monthlyFixedUsd = stack.reduce((sum, item) => sum + item.monthlyUsd, 0)
  const perGbUsd = stack.reduce((sum, item) => sum + item.perGbUsd, 0)
  return { monthlyFixedUsd, perGbUsd }
}

export function cheapestAuMobileFarmCost(
  simMonthlyUsd: number,
  modemHardwareUsd: number,
  expectedGbPerSimPerMonth: number,
  simCount: number,
): EconomicsSummary {
  const monthlyFixedUsd = simCount * simMonthlyUsd
  const wholesaleGbUsd = simMonthlyUsd / expectedGbPerSimPerMonth

  // Ignore hardware amortization in the per-GB cost for simplicity.
  return computeEconomics({
    name: "au-mobile-farm",
    model: "flat-monthly",
    wholesaleGbUsd,
    retailGbUsd: 5.0,
    fixedMonthlyUsd: monthlyFixedUsd,
    expectedMonthlyGb: simCount * expectedGbPerSimPerMonth,
    customerAcquisitionCostUsd: 0,
    churnPerMonth: 0,
  })
}

export function cheapestAuP2PNetworkCost(
  payoutPerGbUsd: number,
  fixedMonthlyUsd: number,
  expectedMonthlyGb: number,
  retailGbUsd: number,
): EconomicsSummary {
  return computeEconomics({
    name: "au-p2p-network",
    model: "revenue-share",
    wholesaleGbUsd: payoutPerGbUsd,
    retailGbUsd,
    fixedMonthlyUsd,
    expectedMonthlyGb,
    customerAcquisitionCostUsd: 0,
    churnPerMonth: 0,
  })
}
