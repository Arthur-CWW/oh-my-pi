import { describe, expect, test } from "bun:test"
import {
  estimateScrapingCost,
  compareScrapingCosts,
  formatEstimate,
  bytesPerTarget,
} from "../src"

describe("Scraping cost estimates", () => {
  test("static HTML is cheaper than headless pages", () => {
    const staticHtml = estimateScrapingCost("static-html", 10_000, 1.0)
    const headless = estimateScrapingCost("headless-page", 10_000, 1.0)

    expect(staticHtml.totalGb).toBeLessThan(headless.totalGb)
    expect(staticHtml.proxyCostUsd).toBeLessThan(headless.proxyCostUsd)
  })

  test("TikTok metadata is much cheaper than full video", () => {
    const metadata = estimateScrapingCost("tiktok-metadata", 10_000, 1.0)
    const videoLow = estimateScrapingCost("tiktok-video-low", 10_000, 1.0)

    expect(videoLow.proxyCostUsd).toBeGreaterThan(metadata.proxyCostUsd * 10)
  })

  test("cost scales linearly with proxy price", () => {
    const cheap = estimateScrapingCost("api-only", 100_000, 0.5)
    const expensive = estimateScrapingCost("api-only", 100_000, 2.0)

    expect(expensive.proxyCostUsd).toBe(cheap.proxyCostUsd * 4)
  })

  test("compareScrapingCosts returns all target/price combinations", () => {
    const estimates = compareScrapingCosts(1_000, [0.5, 1.0, 2.0])
    expect(estimates.length).toBe(18) // 6 targets × 3 prices
  })

  test("formatEstimate includes key numbers", () => {
    const e = estimateScrapingCost("static-html", 1_000, 1.0)
    const formatted = formatEstimate(e)
    expect(formatted).toContain("static-html")
    expect(formatted).toContain("1,000")
    expect(formatted).toContain("$1")
  })

  test("bytesPerTarget values are ordered as expected", () => {
    expect(bytesPerTarget["api-only"]).toBeLessThan(bytesPerTarget["static-html"])
    expect(bytesPerTarget["static-html"]).toBeLessThan(bytesPerTarget["headless-page"])
    expect(bytesPerTarget["headless-page"]).toBeLessThan(bytesPerTarget["tiktok-video-low"])
    expect(bytesPerTarget["tiktok-video-low"]).toBeLessThan(bytesPerTarget["tiktok-video-high"])
  })
})
