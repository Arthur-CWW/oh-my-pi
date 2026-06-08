export type JsonObject = Record<string, unknown>
export type WindowName = "5h" | "7d"

export type UsageWindow = {
  used_percent?: number | null
  reset_after_seconds?: number | null
  reset_at?: number | null
}

export type RateLimitBucket = {
  allowed?: boolean
  limit_reached?: boolean
  primary_window?: UsageWindow | null
  secondary_window?: UsageWindow | null
}

export type UsageSnapshot = {
  leftPercent: Record<WindowName, number | null>
  resetInSeconds: Record<WindowName, number | null>
  isLimited: boolean
  accountLabel: string | null
}

export const SPARK_MODEL_ID = "gpt-5.3-codex-spark"

export const windows = {
  "5h": { field: "primary_window" },
  "7d": { field: "secondary_window" },
} as const

export const windowNames = Object.keys(windows) as WindowName[]

export function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
