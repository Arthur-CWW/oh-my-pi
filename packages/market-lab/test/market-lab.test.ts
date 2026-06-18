import { describe, expect, test } from "bun:test"
import {
  defaultMomentumSignalConfig,
  calculateMomentumSignals,
  runSimulation,
  type Bar,
  type RebalanceConfig,
} from "../src"

function generateMockBars(assetId: string, startPrice: number, trend: number, count: number): Bar[] {
  const bars: Bar[] = []
  let price = startPrice
  for (let index = 0; index < count; index += 1) {
    price = price * (1 + trend)
    bars.push({
      assetId,
      timestamp: index * 86400 * 1000,
      open: price * 0.99,
      high: price * 1.01,
      low: price * 0.98,
      close: price,
      volume: 1000,
    })
  }
  return bars
}

describe("Momentum Signals", () => {
  test("calculates positive signals for rising asset and negative for falling asset", () => {
    const btc = generateMockBars("BTC", 100, 0.02, 20)
    const eth = generateMockBars("ETH", 100, -0.02, 20)
    const allBars = [...btc, ...eth].sort((a, b) => a.timestamp - b.timestamp)

    const signals = calculateMomentumSignals(allBars, defaultMomentumSignalConfig)

    expect(signals.length).toBe(2)

    const btcSignal = signals.find((s) => s.assetId === "BTC")
    const ethSignal = signals.find((s) => s.assetId === "ETH")

    expect(btcSignal).toBeDefined()
    expect(btcSignal!.rawReturnScore).toBeGreaterThan(0)
    expect(btcSignal!.rankScore).toBe(1)
    expect(btcSignal!.side).toBe("long")

    expect(ethSignal).toBeDefined()
    expect(ethSignal!.rawReturnScore).toBeLessThan(0)
    expect(ethSignal!.rankScore).toBe(-1)
    expect(ethSignal!.side).toBe("short")
  })

  test("applies absoluteTrendGate to filter out weak signals", () => {
    const stableAsset = generateMockBars("STABLE", 100, 0.0001, 20)
    const config = {
      ...defaultMomentumSignalConfig,
      absoluteTrendGate: 0.05,
    }

    const signals = calculateMomentumSignals(stableAsset, config)
    expect(signals.length).toBe(1)
    expect(signals[0]!.blockedByTrendGate).toBe(true)
    expect(signals[0]!.targetWeight).toBe(0)
    expect(signals[0]!.side).toBe("flat")
  })
})

describe("Paper Portfolio Simulation", () => {
  const btc = generateMockBars("BTC", 100, 0.02, 20)
  const eth = generateMockBars("ETH", 100, -0.02, 20)
  const allBars = [...btc, ...eth].sort((a, b) => a.timestamp - b.timestamp)

  const baseConfig: RebalanceConfig = {
    initialCash: 100000,
    targetGrossExposure: 1.0,
    maxPositionWeight: 0.8,
    minTradeNotional: 1000,
    commissionBps: 10,
    rebalanceEveryBars: 15,
    allowShort: true,
    signal: defaultMomentumSignalConfig,
  }

  test("runs simulation, makes trades at step 15, and generates expected snapshot PnL", () => {
    const result = runSimulation(allBars, baseConfig)

    // Should have 20 snapshots (one per timestamp)
    expect(result.snapshots.length).toBe(20)

    // Should have generated rebalance signals
    expect(result.signals.length).toBeGreaterThan(0)

    // Step 0: no trades (not enough history)
    const initialSnapshot = result.snapshots[0]
    expect(initialSnapshot!.cash).toBe(100000)
    expect(initialSnapshot!.positions.length).toBe(0)

    // Step 15: rebalance occurs
    // We expect orders to be generated
    const ordersAt15 = result.orders.filter((o) => o.timestamp === 15 * 86400 * 1000)
    expect(ordersAt15.length).toBe(2)

    const btcOrder = ordersAt15.find((o) => o.assetId === "BTC")
    const ethOrder = ordersAt15.find((o) => o.assetId === "ETH")

    expect(btcOrder).toBeDefined()
    expect(btcOrder!.side).toBe("buy") // Long momentum
    expect(ethOrder).toBeDefined()
    expect(ethOrder!.side).toBe("sell") // Short momentum

    // At step 19 (the end), since BTC went up and ETH went down, the portfolio equity should have increased
    const finalSnapshot = result.snapshots[19]
    expect(finalSnapshot!.equity).toBeGreaterThan(100000)
    expect(finalSnapshot!.positions.length).toBe(2)

    const finalBtcPos = finalSnapshot!.positions.find((p) => p.assetId === "BTC")
    const finalEthPos = finalSnapshot!.positions.find((p) => p.assetId === "ETH")

    expect(finalBtcPos!.quantity).toBeGreaterThan(0)
    expect(finalEthPos!.quantity).toBeLessThan(0)
  })

  test("respects allowShort: false by not shorting down-trending assets", () => {
    const noShortConfig = {
      ...baseConfig,
      allowShort: false,
    }

    const result = runSimulation(allBars, noShortConfig)
    const ordersAt15 = result.orders.filter((o) => o.timestamp === 15 * 86400 * 1000)

    // We only expect BTC buy order since ETH would be short and is filtered out
    expect(ordersAt15.length).toBe(1)
    expect(ordersAt15[0]!.assetId).toBe("BTC")
    expect(ordersAt15[0]!.side).toBe("buy")
  })
})
