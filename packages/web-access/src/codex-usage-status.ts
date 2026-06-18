import type { AssistantMessage } from "@oh-my-pi/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent"
import { errorMessage, type UsageSnapshot } from "./codex-usage/domain"
import { readFooterDefaults } from "./codex-usage/files"
import { composeFooterLine, formatModelVariants, formatStatsLeft, formatUsageVariants } from "./codex-usage/format"
import { getUsage, MISSING_AUTH_ERROR } from "./codex-usage/usage"

const REFRESH_INTERVAL_MS = 60_000

class CodexUsageFooter {
  private ctx?: ExtensionContext
  private generation = 0
  private timer?: ReturnType<typeof setInterval>
  private inFlight = false
  private queued?: { ctx: ExtensionContext; generation: number; modelId?: string }
  private requestRender?: () => void
  private lastUsage?: UsageSnapshot
  private lastUsageError = false
  private autoCompactEnabled = true
  private thinkingLevel = "off"

  constructor(pi: ExtensionAPI) {
    pi.on("session_start", (_event, ctx) => this.start(ctx))
    pi.on("turn_end", (_event, ctx) => void this.refresh(ctx))
    pi.on("session_shutdown", (_event, ctx) => this.stop(ctx))
  }

  private isCurrent(generation: number): boolean {
    return this.ctx !== undefined && this.generation === generation
  }

  private start(ctx: ExtensionContext): void {
    this.generation++
    this.ctx = ctx
    this.lastUsage = undefined
    this.lastUsageError = false
    this.thinkingLevel = this.getInitialThinkingLevel(ctx)

    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
    this.timer.unref?.()

    if (ctx.hasUI) {
      const generation = this.generation
      ctx.ui.setFooter((tui, theme) => {
        this.requestRender = () => {
          if (this.isCurrent(generation)) tui.requestRender()
        }

        return {
          dispose: () => {
            if (this.isCurrent(generation)) this.requestRender = undefined
          },
          invalidate() {},
          render: (width: number) => [this.renderFooterLine(width, ctx, theme)],
        }
      })
    }

    const generation = this.generation
    void (async () => {
      try {
        const defaults = await readFooterDefaults()
        if (!this.isCurrent(generation)) return
        this.autoCompactEnabled = defaults.autoCompactEnabled
        if (this.thinkingLevel === "off") this.thinkingLevel = defaults.thinkingLevel
        this.requestRender?.()
      } catch {
        // Ignore settings read failures; footer falls back to sane defaults.
      }
      await this.refresh(ctx, ctx.model?.id, generation)
    })()
  }

  private stop(ctx: ExtensionContext): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.queued = undefined
    this.requestRender = undefined
    this.ctx = undefined
    this.generation++
    if (ctx.hasUI) ctx.ui.setFooter(undefined)
  }

  private getInitialThinkingLevel(ctx: ExtensionContext): string {
    const entries = ctx.sessionManager.getEntries()
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") return entry.thinkingLevel
    }
    return this.thinkingLevel
  }

  private async refresh(ctx = this.ctx, modelId = ctx?.model?.id, generation = this.generation): Promise<void> {
    if (!ctx?.hasUI || !this.isCurrent(generation)) return

    if (this.inFlight) {
      this.queued = { ctx, generation, modelId }
      return
    }

    this.inFlight = true
    try {
      const usage = await getUsage(modelId)
      if (!this.isCurrent(generation)) return
      this.lastUsage = usage
      this.lastUsageError = false
      this.requestRender?.()
    } catch (error) {
      if (!this.isCurrent(generation)) return
      if (errorMessage(error).includes(MISSING_AUTH_ERROR)) {
        this.lastUsage = undefined
        this.lastUsageError = false
      } else {
        this.lastUsageError = true
      }
      this.requestRender?.()
    } finally {
      this.inFlight = false
      const queued = this.queued
      this.queued = undefined
      if (queued && this.isCurrent(queued.generation)) void this.refresh(queued.ctx, queued.modelId, queued.generation)
    }
  }

  private renderFooterLine(
    width: number,
    ctx: ExtensionContext,
    theme: ExtensionContext["ui"]["theme"],
  ): string {
    let totalInput = 0
    let totalOutput = 0
    let totalCacheRead = 0
    let totalCacheWrite = 0
    let totalCost = 0

    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        const message = entry.message as AssistantMessage
        totalInput += message.usage.input
        totalOutput += message.usage.output
        totalCacheRead += message.usage.cacheRead
        totalCacheWrite += message.usage.cacheWrite
        totalCost += message.usage.cost.total
      }
    }

    const contextUsage = ctx.getContextUsage()
    const statsLeft = formatStatsLeft(theme, {
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      usingSubscription: ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false,
      contextPercent: contextUsage?.percent ?? null,
      contextWindow: contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
      autoCompactEnabled: this.autoCompactEnabled,
    })

    const usageVariants = formatUsageVariants(theme, this.lastUsage, this.lastUsageError)
    const modelVariants = formatModelVariants(theme, {
      modelId: ctx.model?.id,
      provider: ctx.model?.provider,
      providerCount: 0,
      reasoning: ctx.model?.reasoning,
      thinkingLevel: this.thinkingLevel,
    })

    const rightVariants = usageVariants.length
      ? usageVariants.flatMap((usage) => modelVariants.map((model) => `${usage} ${model}`))
      : modelVariants

    return composeFooterLine(width, statsLeft, rightVariants)
  }
}

export default function (pi: ExtensionAPI): void {
  new CodexUsageFooter(pi)
}
