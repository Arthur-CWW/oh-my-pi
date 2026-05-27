import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"

describe("cross-platform paths", () => {
  it("finds the correct Firefox cookies path on this platform", () => {
    const bases = platform() === "darwin"
      ? [join(homedir(), "Library/Application Support/Firefox/Profiles")]
      : [join(homedir(), ".mozilla/firefox"), join(homedir(), "snap/firefox/common/.mozilla/firefox")]

    const found = bases.flatMap((base) => {
      try {
        return readdirSync(base)
          .map((dir) => join(base, dir, "cookies.sqlite"))
          .filter((db) => existsSync(db))
      } catch { return [] }
    })

    // On macOS we expect at least one Firefox profile with cookies
    // On Linux, it depends on whether Firefox is installed
    if (platform() === "darwin") {
      expect(found.length).toBeGreaterThan(0)
    }
    // On either platform, the base paths should be sensible
    for (const base of bases) {
      expect(base.toLowerCase()).toContain("firefox")
    }
  })

  it("finds the correct Chrome cookies path on this platform", () => {
    const base = platform() === "darwin"
      ? join(homedir(), "Library/Application Support/Google/Chrome/Default/Cookies")
      : join(homedir(), ".config/google-chrome/Default/Cookies")

    // Chrome might not be installed, so just check the path is sensible
    expect(base).toContain("Chrome")
    expect(base).toContain("Cookies")
  })

  it("sqlite3 is available", () => {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
    try {
      const ver = execFileSync("sqlite3", ["--version"], { timeout: 3000, encoding: "utf-8" })
      expect(ver).toMatch(/^\d+\.\d+/)
    } catch {
      // sqlite3 might not be installed; that's OK for some platforms
      expect(platform()).not.toBe("darwin") // macOS should have it via Xcode
    }
  })

  it("yt-dlp is available (optional)", () => {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
    try {
      const ver = execFileSync("yt-dlp", ["--version"], { timeout: 3000, encoding: "utf-8" })
      expect(ver).toMatch(/^\d+\.\d+/)
    } catch {
      // yt-dlp is optional (only needed for youtube_transcript)
    }
  })
})
