import { type AssetClass } from "./schemas"

export interface ProviderMetadata {
  readonly id: string
  readonly name: string
  readonly supportedAssetClasses: readonly AssetClass[]
  readonly hasHistoricalBars: boolean
  readonly hasRealtimeTicks: boolean
}

export const staticProviders: Record<string, ProviderMetadata> = {
  binance: {
    id: "binance",
    name: "Binance",
    supportedAssetClasses: ["crypto"],
    hasHistoricalBars: true,
    hasRealtimeTicks: true,
  },
  alpaca: {
    id: "alpaca",
    name: "Alpaca",
    supportedAssetClasses: ["equity", "etf"],
    hasHistoricalBars: true,
    hasRealtimeTicks: true,
  },
  ibkr: {
    id: "ibkr",
    name: "Interactive Brokers",
    supportedAssetClasses: ["equity", "etf", "future", "fx"],
    hasHistoricalBars: true,
    hasRealtimeTicks: true,
  },
}
