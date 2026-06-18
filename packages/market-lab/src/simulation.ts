import { type Bar, type RebalanceConfig, type SimulationResult, type PaperOrder, type PortfolioSnapshot, type Position, type Signal } from "./schemas"
import { calculateMomentumSignals } from "./signals"

export function runSimulation(bars: readonly Bar[], config: RebalanceConfig): SimulationResult {
  // 1. Group bars by timestamp
  const barsByTimestamp = new Map<number, Bar[]>()
  for (const bar of bars) {
    const list = barsByTimestamp.get(bar.timestamp) ?? []
    list.push(bar)
    barsByTimestamp.set(bar.timestamp, list)
  }

  // Sort timestamps chronologically
  const timestamps = Array.from(barsByTimestamp.keys()).sort((a, b) => a - b)

  // Initialize portfolio state
  let cash = config.initialCash
  const positions = new Map<string, { quantity: number; averagePrice: number }>()
  const lastKnownPrices = new Map<string, number>()

  const allOrders: PaperOrder[] = []
  const allSnapshots: PortfolioSnapshot[] = []
  const allSignals: Signal[] = []

  // Track historical bars up to current time (to avoid lookahead bias in signal calculation)
  const historicalBars: Bar[] = []

  for (let step = 0; step < timestamps.length; step += 1) {
    const timestamp = timestamps[step]!
    const currentBars = barsByTimestamp.get(timestamp)!

    // Update last known prices and add to history
    for (const bar of currentBars) {
      lastKnownPrices.set(bar.assetId, bar.close)
      historicalBars.push(bar)
    }

    // Step 1: Update existing positions with new prices at this timestamp
    let grossExposure = 0
    let netExposure = 0
    const activePositions: Position[] = []

    for (const [assetId, pos] of positions.entries()) {
      const price = lastKnownPrices.get(assetId)
      if (price === undefined || pos.quantity === 0) continue

      const marketValue = pos.quantity * price
      const unrealizedPnl = pos.quantity * (price - pos.averagePrice)

      grossExposure += Math.abs(marketValue)
      netExposure += marketValue

      activePositions.push({
        assetId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        marketValue,
        unrealizedPnl,
      })
    }

    let equity = cash + netExposure

    // Step 2: Check if we should rebalance at this step
    const shouldRebalance = step % config.rebalanceEveryBars === 0

    if (shouldRebalance) {
      // Calculate signals using history up to current timestamp
      const stepSignals = calculateMomentumSignals(historicalBars, config.signal)
      allSignals.push(...stepSignals)

      // Calculate target weights
      const targetWeights = new Map<string, number>()
      let sumAbsWeight = 0

      for (const sig of stepSignals) {
        let w = sig.targetWeight
        if (!config.allowShort && w < 0) {
          w = 0
        }
        targetWeights.set(sig.assetId, w)
        sumAbsWeight += Math.abs(w)
      }

      // Scale weights to targetGrossExposure
      if (sumAbsWeight > 0) {
        const scaleFactor = config.targetGrossExposure / sumAbsWeight
        for (const [assetId, w] of targetWeights.entries()) {
          targetWeights.set(assetId, w * scaleFactor)
        }
      }

      // Clip individual weights to maxPositionWeight
      for (const [assetId, w] of targetWeights.entries()) {
        const cappedW = Math.min(config.maxPositionWeight, Math.max(-config.maxPositionWeight, w))
        targetWeights.set(assetId, cappedW)
      }

      // Determine all assets to consider for trading (either currently held or target weight non-zero)
      const allAssets = new Set([...positions.keys(), ...targetWeights.keys()])

      for (const assetId of allAssets) {
        const price = lastKnownPrices.get(assetId)
        if (price === undefined || price <= 0) continue

        const targetWeight = targetWeights.get(assetId) ?? 0
        const targetValue = targetWeight * equity

        const currentPos = positions.get(assetId)
        const currentQty = currentPos?.quantity ?? 0
        const currentValue = currentQty * price

        const tradeValue = targetValue - currentValue

        if (Math.abs(tradeValue) >= config.minTradeNotional) {
          const tradeQty = tradeValue / price
          const commission = Math.abs(tradeValue) * (config.commissionBps / 10000)

          // Record the order
          allOrders.push({
            timestamp,
            assetId,
            side: tradeQty > 0 ? "buy" : "sell",
            quantity: Math.abs(tradeQty),
            price,
            notional: Math.abs(tradeValue),
            commission,
            reason: "rebalance",
          })

          // Update cash
          cash -= (tradeQty * price) + commission

          // Update positions Map
          if (currentQty === 0) {
            positions.set(assetId, { quantity: tradeQty, averagePrice: price })
          } else if (Math.sign(currentQty) === Math.sign(tradeQty)) {
            const totalCost = (currentQty * currentPos!.averagePrice) + (tradeQty * price)
            const newQty = currentQty + tradeQty
            positions.set(assetId, { quantity: newQty, averagePrice: totalCost / newQty })
          } else {
            // Reversing or reducing
            if (Math.abs(tradeQty) <= Math.abs(currentQty)) {
              // Reducing
              const newQty = currentQty + tradeQty
              if (newQty === 0) {
                positions.delete(assetId)
              } else {
                positions.set(assetId, { quantity: newQty, averagePrice: currentPos!.averagePrice })
              }
            } else {
              // Reversing
              const newQty = currentQty + tradeQty
              positions.set(assetId, { quantity: newQty, averagePrice: price })
            }
          }
        }
      }

      // Recalculate portfolio metrics after trades
      grossExposure = 0
      netExposure = 0
      activePositions.length = 0 // clear array

      for (const [assetId, pos] of positions.entries()) {
        const price = lastKnownPrices.get(assetId)
        if (price === undefined || pos.quantity === 0) continue

        const marketValue = pos.quantity * price
        const unrealizedPnl = pos.quantity * (price - pos.averagePrice)

        grossExposure += Math.abs(marketValue)
        netExposure += marketValue

        activePositions.push({
          assetId,
          quantity: pos.quantity,
          averagePrice: pos.averagePrice,
          marketValue,
          unrealizedPnl,
        })
      }

      equity = cash + netExposure
    }

    // Record portfolio snapshot for the timestamp
    allSnapshots.push({
      timestamp,
      cash,
      grossExposure,
      netExposure,
      equity,
      positions: [...activePositions],
    })
  }

  return {
    orders: allOrders,
    snapshots: allSnapshots,
    signals: allSignals,
  }
}
