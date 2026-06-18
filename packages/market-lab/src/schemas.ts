import { Schema } from "effect"

export const AssetClass = Schema.Union([
  Schema.Literal("equity"),
  Schema.Literal("etf"),
  Schema.Literal("future"),
  Schema.Literal("fx"),
  Schema.Literal("crypto"),
])
export type AssetClass = typeof AssetClass.Type

export const Asset = Schema.Struct({
  id: Schema.String,
  symbol: Schema.String,
  name: Schema.String,
  assetClass: AssetClass,
  currency: Schema.String,
  lotSize: Schema.Number,
})
export type Asset = typeof Asset.Type

export const Bar = Schema.Struct({
  assetId: Schema.String,
  timestamp: Schema.Number,
  open: Schema.Number,
  high: Schema.Number,
  low: Schema.Number,
  close: Schema.Number,
  volume: Schema.Number,
})
export type Bar = typeof Bar.Type

export const SignalSide = Schema.Union([Schema.Literal("long"), Schema.Literal("short"), Schema.Literal("flat")])
export type SignalSide = typeof SignalSide.Type

export const Signal = Schema.Struct({
  assetId: Schema.String,
  timestamp: Schema.Number,
  side: SignalSide,
  rawReturnScore: Schema.Number,
  rankScore: Schema.Number,
  realizedVolatility: Schema.Number,
  normalizedScore: Schema.Number,
  targetWeight: Schema.Number,
  blockedByTrendGate: Schema.Boolean,
  blockedByNoTradeBuffer: Schema.Boolean,
})
export type Signal = typeof Signal.Type

export const OrderSide = Schema.Union([Schema.Literal("buy"), Schema.Literal("sell")])
export type OrderSide = typeof OrderSide.Type

export const PaperOrder = Schema.Struct({
  timestamp: Schema.Number,
  assetId: Schema.String,
  side: OrderSide,
  quantity: Schema.Number,
  price: Schema.Number,
  notional: Schema.Number,
  commission: Schema.Number,
  reason: Schema.String,
})
export type PaperOrder = typeof PaperOrder.Type

export const Position = Schema.Struct({
  assetId: Schema.String,
  quantity: Schema.Number,
  averagePrice: Schema.Number,
  marketValue: Schema.Number,
  unrealizedPnl: Schema.Number,
})
export type Position = typeof Position.Type

export const PortfolioSnapshot = Schema.Struct({
  timestamp: Schema.Number,
  cash: Schema.Number,
  grossExposure: Schema.Number,
  netExposure: Schema.Number,
  equity: Schema.Number,
  positions: Schema.Array(Position),
})
export type PortfolioSnapshot = typeof PortfolioSnapshot.Type

export const MomentumSignalConfig = Schema.Struct({
  horizons: Schema.Array(Schema.Number),
  horizonWeights: Schema.Array(Schema.Number),
  volatilityWindow: Schema.Number,
  volatilityFloor: Schema.Number,
  absoluteTrendGate: Schema.Number,
  noTradeBuffer: Schema.Number,
  maxAbsSignal: Schema.Number,
})
export type MomentumSignalConfig = typeof MomentumSignalConfig.Type

export const RebalanceConfig = Schema.Struct({
  initialCash: Schema.Number,
  targetGrossExposure: Schema.Number,
  maxPositionWeight: Schema.Number,
  minTradeNotional: Schema.Number,
  commissionBps: Schema.Number,
  rebalanceEveryBars: Schema.Number,
  allowShort: Schema.Boolean,
  signal: MomentumSignalConfig,
})
export type RebalanceConfig = typeof RebalanceConfig.Type

export const SimulationResult = Schema.Struct({
  orders: Schema.Array(PaperOrder),
  snapshots: Schema.Array(PortfolioSnapshot),
  signals: Schema.Array(Signal),
})
export type SimulationResult = typeof SimulationResult.Type
