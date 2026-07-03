import { type Bar, type PaperOrder, type PortfolioSnapshot, type RebalanceConfig, type SimulationResult } from "./schemas"
import { runSimulation } from "./simulation"

export interface MomentumFixtureAssetReturn {
  assetId: string
  firstTimestamp: number
  lastTimestamp: number
  firstClose: number
  lastClose: number
  returnPct: number
}

export interface MomentumResearchFixtureReport {
  simulation: SimulationResult
  barCount: number
  assetCount: number
  firstTimestamp: number
  lastTimestamp: number
  rebalanceCount: number
  orderCount: number
  longSignalCount: number
  shortSignalCount: number
  flatSignalCount: number
  trendGateBlockCount: number
  noTradeBufferBlockCount: number
  totalReturnPct: number
  maxDrawdownPct: number
  grossTurnoverPct: number
  averageGrossExposurePct: number
  averageNetExposurePct: number
  assetReturns: MomentumFixtureAssetReturn[]
}

export function runMomentumResearchFixture(
  bars: readonly Bar[],
  config: RebalanceConfig,
): MomentumResearchFixtureReport {
  if (bars.length === 0) throw new Error("At least one bar is required for a momentum research fixture")

  const sortedBars = bars.toSorted(compareBars)
  const firstBar = sortedBars[0]!
  const lastBar = sortedBars[sortedBars.length - 1]!
  const simulation = runSimulation(sortedBars, config)
  const assetIds = new Set<string>()
  for (const bar of sortedBars) assetIds.add(bar.assetId)

  const rebalanceTimestamps = new Set<number>()
  let longSignalCount = 0
  let shortSignalCount = 0
  let flatSignalCount = 0
  for (const signal of simulation.signals) {
    rebalanceTimestamps.add(signal.timestamp)
    if (signal.side === "long") longSignalCount += 1
    else if (signal.side === "short") shortSignalCount += 1
    else flatSignalCount += 1
  }

  return {
    simulation,
    barCount: sortedBars.length,
    assetCount: assetIds.size,
    firstTimestamp: firstBar.timestamp,
    lastTimestamp: lastBar.timestamp,
    rebalanceCount: rebalanceTimestamps.size,
    orderCount: simulation.orders.length,
    longSignalCount,
    shortSignalCount,
    flatSignalCount,
    trendGateBlockCount: simulation.signals.filter((signal) => signal.blockedByTrendGate).length,
    noTradeBufferBlockCount: simulation.signals.filter((signal) => signal.blockedByNoTradeBuffer).length,
    totalReturnPct: totalReturnPct(simulation.snapshots, config.initialCash),
    maxDrawdownPct: maxDrawdownPct(simulation.snapshots),
    grossTurnoverPct: grossTurnoverPct(simulation.orders, config.initialCash),
    averageGrossExposurePct: averageExposurePct(simulation.snapshots, "grossExposure"),
    averageNetExposurePct: averageExposurePct(simulation.snapshots, "netExposure"),
    assetReturns: assetReturns(sortedBars),
  }
}

function compareBars(a: Bar, b: Bar): number {
  const timeDelta = a.timestamp - b.timestamp
  return timeDelta === 0 ? a.assetId.localeCompare(b.assetId) : timeDelta
}

function totalReturnPct(snapshots: readonly PortfolioSnapshot[], initialCash: number): number {
  if (initialCash <= 0) throw new Error("Initial cash must be positive for research fixture metrics")
  const finalSnapshot = snapshots[snapshots.length - 1]
  return finalSnapshot ? ((finalSnapshot.equity / initialCash) - 1) * 100 : 0
}

function maxDrawdownPct(snapshots: readonly PortfolioSnapshot[]): number {
  let peak = 0
  let maxDrawdown = 0

  for (const snapshot of snapshots) {
    peak = Math.max(peak, snapshot.equity)
    if (peak <= 0) continue
    maxDrawdown = Math.max(maxDrawdown, (peak - snapshot.equity) / peak)
  }

  return maxDrawdown * 100
}

function grossTurnoverPct(orders: readonly PaperOrder[], initialCash: number): number {
  if (initialCash <= 0) throw new Error("Initial cash must be positive for research fixture metrics")
  const totalNotional = orders.reduce((sum, order) => sum + order.notional, 0)
  return (totalNotional / initialCash) * 100
}

function averageExposurePct(
  snapshots: readonly PortfolioSnapshot[],
  key: "grossExposure" | "netExposure",
): number {
  if (snapshots.length === 0) return 0
  const exposureFractions = snapshots.map((snapshot) => {
    if (snapshot.equity === 0) return 0
    return snapshot[key] / snapshot.equity
  })
  return (exposureFractions.reduce((sum, fraction) => sum + fraction, 0) / snapshots.length) * 100
}

function assetReturns(bars: readonly Bar[]): MomentumFixtureAssetReturn[] {
  const grouped = new Map<string, Bar[]>()
  for (const bar of bars) {
    const history = grouped.get(bar.assetId)
    if (history) history.push(bar)
    else grouped.set(bar.assetId, [bar])
  }

  return Array.from(grouped.entries())
    .map(([assetId, history]) => {
      const sorted = history.toSorted(compareBars)
      const first = sorted[0]!
      const last = sorted[sorted.length - 1]!
      return {
        assetId,
        firstTimestamp: first.timestamp,
        lastTimestamp: last.timestamp,
        firstClose: first.close,
        lastClose: last.close,
        returnPct: ((last.close / first.close) - 1) * 100,
      }
    })
    .toSorted((a, b) => {
      const returnDelta = b.returnPct - a.returnPct
      return returnDelta === 0 ? a.assetId.localeCompare(b.assetId) : returnDelta
    })
}
