import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"

const sourceRoot = path.resolve(import.meta.dir, "../src")

describe("Jimeng client construction seams", () => {
  test("plain JimengClient construction is limited to classified compatibility and live-artifact paths", () => {
    const occurrences = collectTsFiles(sourceRoot).flatMap((file) => {
      const lines = readFileSync(file, "utf8").split(/\r?\n/u)
      return lines.flatMap((line) => {
        if (!line.includes("new JimengClient()")) return []
        return [{
          file: path.relative(sourceRoot, file),
          text: line.trim(),
        }]
      })
    })

    expect(occurrences.map(({ file, text }) => `${file}|${text}`).sort()).toEqual([
      "browser-proxy-cli.ts|const bytes = await new JimengClient().download(preview.previewImageUrl)",
      "browser-proxy-cli.ts|const client = new JimengClient()",
      "cli.ts|const client = new JimengClient()",
      "dreamina-compatible-cli.ts|const client = new JimengClient()",
    ].sort())
  })
})

function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(file))
    } else if (entry.isFile() && file.endsWith(".ts")) {
      files.push(file)
    }
  }
  return files.sort()
}
