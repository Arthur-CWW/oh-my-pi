import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent"
import { Ellipsis, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui"
import type { UsageSnapshot } from "./domain"

type FooterTheme = Pick<ExtensionContext["ui"]["theme"], "fg">

type ModelFooterInput = {
  modelId?: string
  provider?: string
  providerCount: number
  reasoning?: boolean
  thinkingLevel?: string
}

type StatsFooterInput = {
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  totalCost: number
  usingSubscription: boolean
  contextPercent: number | null
  contextWindow: number
  autoCompactEnabled: boolean
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

export function formatCompactCountdown(seconds: number | null): string | null {
  if (seconds === null || Number.isNaN(seconds)) return null

  const total = Math.max(0, Math.round(seconds))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)

  if (days) return hours ? `${days}d${hours}h` : `${days}d`
  if (hours) return minutes ? `${hours}h${minutes}m` : `${hours}h`
  return minutes ? `${minutes}m` : `${total % 60}s`
}

function usageColor(theme: FooterTheme, leftPercent: number | null, text: string): string {
  if (leftPercent === null) return theme.fg("muted", text)
  const color = leftPercent <= 10 ? "error" : leftPercent <= 25 ? "warning" : "success"
  return theme.fg(color, text)
}

function formatUsedPercent(theme: FooterTheme, leftPercent: number | null): string {
  if (leftPercent === null) return theme.fg("muted", "--")
  return usageColor(theme, leftPercent, `${Math.round(100 - leftPercent)}%`)
}

export function formatStatsLeft(theme: FooterTheme, input: StatsFooterInput): string {
  const parts: string[] = []

  if (input.totalInput) parts.push(theme.fg("dim", `↑${formatTokens(input.totalInput)}`))
  if (input.totalOutput) parts.push(theme.fg("dim", `↓${formatTokens(input.totalOutput)}`))
  if (input.totalCacheRead) parts.push(theme.fg("dim", `R${formatTokens(input.totalCacheRead)}`))
  if (input.totalCacheWrite) parts.push(theme.fg("dim", `W${formatTokens(input.totalCacheWrite)}`))
  if (input.totalCost || input.usingSubscription) {
    const subscription = input.usingSubscription ? " (sub)" : ""
    parts.push(theme.fg("dim", `$${input.totalCost.toFixed(3)}${subscription}`))
  }

  const autoIndicator = input.autoCompactEnabled ? " (auto)" : ""
  const contextDisplay = input.contextPercent === null
    ? `?/${formatTokens(input.contextWindow)}${autoIndicator}`
    : `${input.contextPercent.toFixed(1)}%/${formatTokens(input.contextWindow)}${autoIndicator}`

  if (input.contextPercent !== null && input.contextPercent > 90) parts.push(theme.fg("error", contextDisplay))
  else if (input.contextPercent !== null && input.contextPercent > 70) parts.push(theme.fg("warning", contextDisplay))
  else parts.push(theme.fg("dim", contextDisplay))

  return parts.join(" ")
}

export function formatUsageVariants(theme: FooterTheme, usage: UsageSnapshot | undefined, usageError = false): string[] {
  if (!usage) return usageError ? [theme.fg("warning", "rl?")] : []

  const label = usage.accountLabel ? `[${usage.accountLabel}]` : "[cod]"
  const labelText = theme.fg(usage.isLimited ? "error" : "dim", label)
  const used5 = formatUsedPercent(theme, usage.leftPercent["5h"])
  const used7 = formatUsedPercent(theme, usage.leftPercent["7d"])
  const reset7 = formatCompactCountdown(usage.resetInSeconds["7d"])
  const reset5 = formatCompactCountdown(usage.resetInSeconds["5h"])
  const resets = reset7 || reset5 ? `${theme.fg("dim", "↺")}${reset7 ?? "--"}/${reset5 ?? "--"}` : ""

  const variants = [
    `${labelText} ${theme.fg("dim", "5h")}${used5} ${theme.fg("dim", "7d")}${used7}${resets ? ` ${resets}` : ""}`,
    `${labelText} ${used5}/${used7}${resets ? ` ${resets}` : ""}`,
    `${labelText} ${used5}/${used7}`,
  ]

  return Array.from(new Set(variants.filter(Boolean)))
}

export function formatModelVariants(theme: FooterTheme, input: ModelFooterInput): string[] {
  const modelName = input.modelId || "no-model"
  const thinkingSuffix = input.reasoning && input.thinkingLevel && input.thinkingLevel !== "off"
    ? `• ${input.thinkingLevel}`
    : ""
  const compact = theme.fg("dim", `${modelName}${thinkingSuffix}`)
  const full = input.providerCount > 1 && input.provider
    ? theme.fg("dim", `(${input.provider}) ${modelName}${thinkingSuffix}`)
    : compact

  return Array.from(new Set([full, compact]))
}

export function composeFooterLine(width: number, left: string, rightVariants: string[]): string {
  const minPadding = 2
  const variants = rightVariants.filter(Boolean)
  if (!variants.length) return truncateToWidth(left, width, Ellipsis.Omit)

  const shortest = variants[variants.length - 1]!
  let leftText = left
  const reserve = visibleWidth(shortest) + minPadding
  if (visibleWidth(leftText) + reserve > width) {
    leftText = truncateToWidth(leftText, Math.max(0, width - reserve), Ellipsis.Omit)
  }

  const availableForRight = Math.max(0, width - visibleWidth(leftText) - minPadding)
  const chosen = variants.find((value) => visibleWidth(value) <= availableForRight) ?? truncateToWidth(shortest, availableForRight, Ellipsis.Omit)
  if (!chosen) return truncateToWidth(leftText, width, Ellipsis.Omit)

  const paddingWidth = Math.max(minPadding, width - visibleWidth(leftText) - visibleWidth(chosen))
  const line = `${leftText}${" ".repeat(paddingWidth)}${chosen}`
  return truncateToWidth(line, width, Ellipsis.Omit)
}
