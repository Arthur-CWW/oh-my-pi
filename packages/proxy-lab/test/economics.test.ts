import { describe, expect, test } from "bun:test"
import {
  computeEconomics,
  costStackForMonthlyGb,
  cheapestAuMobileFarmCost,
  cheapestAuP2PNetworkCost,
  AU_INFRA_COST_STACK,
} from "../src"

describe("Proxy economics", () => {
  test("computeEconomics calculates margin and break-even", () => {
    const summary = computeEconomics({
      name: "reseller",
      model: "pay-per-gb",
      wholesaleGbUsd: 1.0,
      retailGbUsd: 5.0,
      fixedMonthlyUsd: 500,
      expectedMonthlyGb: 1000,
      customerAcquisitionCostUsd: 0,
      churnPerMonth: 0,
    })

    expect(summary.monthlyRevenueUsd).toBe(5_000)
    expect(summary.monthlyBandwidthCostUsd).toBe(1_000)
    expect(summary.monthlyFixedCostUsd).toBe(500)
    expect(summary.monthlyGrossProfitUsd).toBe(3_500)
    expect(summary.grossMargin).toBe(0.7)
    expect(summary.costPerGb).toBe(1.5)
    expect(summary.breakEvenGb).toBe(125)
  })

  test("churn reduces revenue but not costs", () => {
    const summary = computeEconomics({
      name: "reseller",
      model: "pay-per-gb",
      wholesaleGbUsd: 1.0,
      retailGbUsd: 5.0,
      fixedMonthlyUsd: 500,
      expectedMonthlyGb: 1000,
      customerAcquisitionCostUsd: 0,
      churnPerMonth: 0.1,
    })
    expect(summary.monthlyRevenueUsd).toBe(4_500)
    expect(summary.monthlyBandwidthCostUsd).toBe(1_000)
    expect(summary.monthlyGrossProfitUsd).toBe(3_000)
  })

  test("cost stack aggregates fixed and per-GB costs", () => {
    const { monthlyFixedUsd, perGbUsd } = costStackForMonthlyGb(AU_INFRA_COST_STACK, 10_000)
    expect(monthlyFixedUsd).toBe(1_250)
    expect(perGbUsd).toBe(0)
  })

  test("mobile farm cost is dominated by SIM plans", () => {
    const summary = cheapestAuMobileFarmCost(
      /* simMonthlyUsd */ 80,
      /* modemHardwareUsd */ 120,
      /* expectedGbPerSimPerMonth */ 200,
      /* simCount */ 10,
    )

    expect(summary.monthlyFixedCostUsd).toBe(800)
    expect(summary.wholesaleGbUsd).toBeCloseTo(0.4)
    expect(summary.expectedMonthlyGb).toBe(2_000)
    expect(summary.breakEvenGb).toBeGreaterThan(0)
  })

  test("P2P network cost uses payout as wholesale", () => {
    const summary = cheapestAuP2PNetworkCost(
      /* payoutPerGbUsd */ 0.25,
      /* fixedMonthlyUsd */ 1_000,
      /* expectedMonthlyGb */ 10_000,
      /* retailGbUsd */ 3.0,
    )

    expect(summary.monthlyBandwidthCostUsd).toBe(2_500)
    expect(summary.monthlyFixedCostUsd).toBe(1_000)
    expect(summary.monthlyRevenueUsd).toBe(30_000)
    expect(summary.grossMargin).toBeCloseTo(0.883, 2)
  })
})
