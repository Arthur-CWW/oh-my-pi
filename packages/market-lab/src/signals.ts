import { type Bar, type MomentumSignalConfig, type Signal, type SignalSide } from "./schemas"

export const defaultMomentumSignalConfig: MomentumSignalConfig = {
  horizons: [3, 6, 12],
  horizonWeights: [0.5, 0.3, 0.2],
  volatilityWindow: 12,
  volatilityFloor: 0.005,
  absoluteTrendGate: 0.01,
  noTradeBuffer: 0.05,
  maxAbsSignal: 1,
}

interface AssetSignalInput {
  assetId: string
  timestamp: number
  rawReturnScore: number
  realizedVolatility: number
  blockedByTrendGate: boolean
}

export function calculateMomentumSignals(bars: readonly Bar[], config: MomentumSignalConfig = defaultMomentumSignalConfig): Signal[] {
  assertSignalConfig(config)
  const histories = groupBarsByAsset(bars)
  const inputs: AssetSignalInput[] = []

  for (const [assetId, history] of histories) {
    const sorted = history.toSorted(compareBars)
    const latest = sorted[sorted.length - 1]
    if (!latest) continue

    const rawReturnScore = weightedMultiHorizonReturn(sorted, config)
    const realizedVolatility = realizedVolatilityOfReturns(sorted, config.volatilityWindow)
    inputs.push({
      assetId,
      timestamp: latest.timestamp,
      rawReturnScore,
      realizedVolatility,
      blockedByTrendGate: Math.abs(rawReturnScore) < config.absoluteTrendGate,
    })
  }

  const ranked = rankInputs(inputs)
  return ranked.map((entry) => materializeSignal(entry, config)).toSorted((a, b) => a.assetId.localeCompare(b.assetId))
}

export function weightedMultiHorizonReturn(bars: readonly Bar[], config: MomentumSignalConfig): number {
  const latest = bars[bars.length - 1]
  if (!latest) return 0

  let weightedSum = 0
  let usedWeight = 0
  for (let index = 0; index < config.horizons.length; index += 1) {
    const horizon = Math.trunc(config.horizons[index] ?? 0)
    const weight = config.horizonWeights[index] ?? 0
    const comparison = bars[bars.length - 1 - horizon]
    if (!comparison || comparison.close <= 0 || latest.close <= 0 || weight <= 0) continue
    weightedSum += ((latest.close / comparison.close) - 1) * weight
    usedWeight += weight
  }

  return usedWeight > 0 ? weightedSum / usedWeight : 0
}

export function realizedVolatilityOfReturns(bars: readonly Bar[], window: number): number {
  const returns: number[] = []
  const start = Math.max(1, bars.length - Math.trunc(window))
  for (let index = start; index < bars.length; index += 1) {
    const previous = bars[index - 1]
    const current = bars[index]
    if (!previous || !current || previous.close <= 0 || current.close <= 0) continue
    returns.push(Math.log(current.close / previous.close))
  }
  if (returns.length < 2) return 0

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + ((value - mean) * (value - mean)), 0) / (returns.length - 1)
  return Math.sqrt(variance)
}

function materializeSignal(input: AssetSignalInput & { rankScore: number }, config: MomentumSignalConfig): Signal {
  const volatility = Math.max(input.realizedVolatility, config.volatilityFloor)
  const normalized = input.blockedByTrendGate ? 0 : input.rankScore * (Math.abs(input.rawReturnScore) / volatility)
  const capped = clamp(normalized, -config.maxAbsSignal, config.maxAbsSignal)
  const buffered = Math.abs(capped) < config.noTradeBuffer ? 0 : capped
  return {
    assetId: input.assetId,
    timestamp: input.timestamp,
    side: signalSide(buffered),
    rawReturnScore: input.rawReturnScore,
    rankScore: input.rankScore,
    realizedVolatility: input.realizedVolatility,
    normalizedScore: normalized,
    targetWeight: buffered,
    blockedByTrendGate: input.blockedByTrendGate,
    blockedByNoTradeBuffer: !input.blockedByTrendGate && buffered === 0,
  }
}

function rankInputs(inputs: readonly AssetSignalInput[]): Array<AssetSignalInput & { rankScore: number }> {
  if (inputs.length === 0) return []
  if (inputs.length === 1) return [{ ...inputs[0], rankScore: inputs[0].rawReturnScore === 0 ? 0 : Math.sign(inputs[0].rawReturnScore) }]

  const sorted = inputs.toSorted((a, b) => {
    const scoreDelta = a.rawReturnScore - b.rawReturnScore
    return scoreDelta === 0 ? a.assetId.localeCompare(b.assetId) : scoreDelta
  })
  const denominator = sorted.length - 1
  return sorted.map((input, index) => ({
    ...input,
    rankScore: (index / denominator * 2) - 1,
  }))
}

function groupBarsByAsset(bars: readonly Bar[]): Map<string, Bar[]> {
  const grouped = new Map<string, Bar[]>()
  for (const bar of bars) {
    const current = grouped.get(bar.assetId)
    if (current) current.push(bar)
    else grouped.set(bar.assetId, [bar])
  }
  return grouped
}

function compareBars(a: Bar, b: Bar): number {
  const timeDelta = a.timestamp - b.timestamp
  return timeDelta === 0 ? a.assetId.localeCompare(b.assetId) : timeDelta
}

function signalSide(value: number): SignalSide {
  if (value > 0) return "long"
  if (value < 0) return "short"
  return "flat"
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function assertSignalConfig(config: MomentumSignalConfig): void {
  if (config.horizons.length === 0) throw new Error("At least one momentum horizon is required")
  if (config.horizons.length !== config.horizonWeights.length) throw new Error("Momentum horizons and weights must align")
  if (config.volatilityWindow < 2) throw new Error("Volatility window must include at least two returns")
  if (config.volatilityFloor <= 0) throw new Error("Volatility floor must be positive")
  if (config.maxAbsSignal <= 0) throw new Error("Signal cap must be positive")
  if (config.noTradeBuffer < 0) throw new Error("No-trade buffer cannot be negative")
}
