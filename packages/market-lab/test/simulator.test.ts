import { describe, expect, test } from "bun:test"
import { defaultMomentumSignalConfig, runMomentumResearchFixture, type Bar, type RebalanceConfig } from "../src"

const DAY_MS = 86_400_000

function fixtureBars(assetId: string, startPrice: number, dailyReturns: readonly number[]): Bar[] {
  let close = startPrice
  return dailyReturns.map((dailyReturn, index) => {
    const open = close
    close = close * (1 + dailyReturn)
    return {
      assetId,
      timestamp: index * DAY_MS,
      open,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      close,
      volume: 1_000 + index,
    }
  })
}

const fixtureConfig: RebalanceConfig = {
  initialCash: 100_000,
  targetGrossExposure: 1,
  maxPositionWeight: 0.6,
  minTradeNotional: 500,
  commissionBps: 2,
  rebalanceEveryBars: 8,
  allowShort: true,
  signal: {
    ...defaultMomentumSignalConfig,
    horizons: [3, 6],
    horizonWeights: [0.6, 0.4],
    volatilityWindow: 6,
    absoluteTrendGate: 0.01,
    noTradeBuffer: 0.1,
  },
}

describe("Momentum research fixture simulator", () => {
  test("summarizes deterministic fixture performance, exposure, turnover, and signal routing", () => {
    const leaderReturns = Array.from({ length: 24 }, () => 0.018)
    const laggardReturns = Array.from({ length: 24 }, () => -0.014)
    const choppyReturns = Array.from({ length: 24 }, (_, index) => (index % 2 === 0 ? 0.004 : -0.004))
    const bars = [
      ...fixtureBars("LEADER", 100, leaderReturns),
      ...fixtureBars("LAGGARD", 100, laggardReturns),
      ...fixtureBars("CHOP", 100, choppyReturns),
    ]

    const report = runMomentumResearchFixture(bars, fixtureConfig)

    expect(report.barCount).toBe(72)
    expect(report.assetCount).toBe(3)
    expect(report.firstTimestamp).toBe(0)
    expect(report.lastTimestamp).toBe(23 * DAY_MS)
    expect(report.rebalanceCount).toBe(3)
    expect(report.orderCount).toBeGreaterThan(0)
    expect(report.longSignalCount).toBeGreaterThan(0)
    expect(report.shortSignalCount).toBeGreaterThan(0)
    expect(report.flatSignalCount).toBeGreaterThan(0)
    expect(report.grossTurnoverPct).toBeGreaterThan(0)
    expect(report.averageGrossExposurePct).toBeGreaterThan(0)
    expect(report.totalReturnPct).toBeGreaterThan(0)
    expect(report.maxDrawdownPct).toBeGreaterThanOrEqual(0)

    expect(report.assetReturns[0]!.assetId).toBe("LEADER")
    expect(report.assetReturns.at(-1)!.assetId).toBe("LAGGARD")
    expect(report.simulation.orders.every((order) => order.reason === "rebalance")).toBe(true)
  })

  test("requires an explicit offline bar fixture", () => {
    expect(() => runMomentumResearchFixture([], fixtureConfig)).toThrow(
      "At least one bar is required for a momentum research fixture",
    )
  })
})
