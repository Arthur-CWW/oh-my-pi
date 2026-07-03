import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { searchBrowser } from "../src/substrate/browser"
import { searchReader } from "../src/substrate/reader"
import { searchTwitter } from "../src/substrate/twitter"

describe("substrate missing-file degradation", () => {
  test("returns empty hits and skip details instead of throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "primer-missing-substrate-"))
    try {
      const missingBrowser = join(root, "missing-browser.sqlite")
      const missingTwitter = join(root, "missing-twitter.sqlite")
      const missingReader = join(root, "missing-reader.sqlite")

      const browser = searchBrowser(missingBrowser, ["memory"], { limit: 5 })
      const twitter = searchTwitter(missingTwitter, ["memory"], 5)
      const reader = searchReader(missingReader, ["memory"], 5)

      expect(browser.hits).toEqual([])
      expect(browser.skipped).toContain("missing browser DB")
      expect(twitter.hits).toEqual([])
      expect(twitter.skipped).toContain("missing twitter DB")
      expect(reader.hits).toEqual([])
      expect(reader.skipped).toContain("missing reader DB")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
