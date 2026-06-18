import { Schema } from "effect"

export const ScrapingTarget = Schema.Union([
  Schema.Literal("static-html"),
  Schema.Literal("headless-page"),
  Schema.Literal("api-only"),
  Schema.Literal("tiktok-video-low"),
  Schema.Literal("tiktok-video-high"),
  Schema.Literal("tiktok-metadata"),
])
export type ScrapingTarget = typeof ScrapingTarget.Type

export const bytesPerTarget: Record<ScrapingTarget, number> = {
  "static-html": 200_000, // ~200 KB average page
  "headless-page": 2_000_000, // ~2 MB with JS/CSS/images rendered
  "api-only": 50_000, // ~50 KB JSON response
  "tiktok-video-low": 5_000_000, // ~5 MB 720p short video
  "tiktok-video-high": 25_000_000, // ~25 MB 1080p short video
  "tiktok-metadata": 150_000, // ~150 KB page + thumbnail metadata
}

export interface ScrapingEstimate {
  readonly target: ScrapingTarget
  readonly items: number
  readonly proxyPricePerGbUsd: number
  readonly bytesPerItem: number
  readonly totalBytes: number
  readonly totalGb: number
  readonly proxyCostUsd: number
  readonly overheadFactor: number
  readonly notes: string
}

export function estimateScrapingCost(
  target: ScrapingTarget,
  items: number,
  proxyPricePerGbUsd: number,
  overheadFactor = 1.2,
): ScrapingEstimate {
  const bytesPerItem = bytesPerTarget[target]
  const totalBytes = bytesPerItem * items * overheadFactor
  const totalGb = totalBytes / 1_073_741_824
  const proxyCostUsd = totalGb * proxyPricePerGbUsd

  const notesByTarget: Record<ScrapingTarget, string> = {
    "static-html":
      "Light HTML pages; assumes no images/JS assets are fetched. Good for link/content extraction.",
    "headless-page":
      "Playwright/Puppeteer page load including scripts, stylesheets, and images. Much heavier than static HTML.",
    "api-only":
      "Direct JSON API calls. Cheapest if the target exposes a stable API and you have permission.",
    "tiktok-video-low":
      "720p short-form video download. Video dominates bandwidth; proxy cost scales linearly with minutes downloaded.",
    "tiktok-video-high":
      "1080p short-form video download. Roughly 5x the bandwidth of 720p.",
    "tiktok-metadata":
      "Page HTML, thumbnail, and metadata only. Avoids video file downloads; ~100x cheaper than full video scraping.",
  }

  return {
    target,
    items,
    proxyPricePerGbUsd,
    bytesPerItem,
    totalBytes,
    totalGb,
    proxyCostUsd,
    overheadFactor,
    notes: notesByTarget[target],
  }
}

export function compareScrapingCosts(
  items: number,
  proxyPricesPerGbUsd: ReadonlyArray<number>,
  overheadFactor = 1.2,
): ReadonlyArray<ScrapingEstimate> {
  const targets: ReadonlyArray<ScrapingTarget> = [
    "static-html",
    "headless-page",
    "api-only",
    "tiktok-metadata",
    "tiktok-video-low",
    "tiktok-video-high",
  ]

  const estimates: ScrapingEstimate[] = []
  for (const target of targets) {
    for (const price of proxyPricesPerGbUsd) {
      estimates.push(estimateScrapingCost(target, items, price, overheadFactor))
    }
  }
  return estimates
}

export function formatEstimate(e: ScrapingEstimate): string {
  return `${e.target}: ${e.items.toLocaleString()} items × ${(e.bytesPerItem / 1_000).toFixed(0)} KB @ $${e.proxyPricePerGbUsd}/GB ≈ ${e.totalGb.toFixed(2)} GB → $${e.proxyCostUsd.toFixed(2)}`
}
