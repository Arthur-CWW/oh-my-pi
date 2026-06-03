import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_PATH = join(homedir(), ".pi", "web-search.json")

let _cache: Record<string, unknown> | null = null

function load(): Record<string, unknown> {
  if (_cache) return _cache
  if (existsSync(CONFIG_PATH)) {
    try { _cache = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); return _cache! } catch { /* nop */ }
  }
  _cache = {}
  return _cache
}

function str(key: string): string | undefined {
  const v = load()[key]
  return typeof v === "string" ? v : undefined
}

export function geminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY ?? str("geminiApiKey") ?? null
}

export function kagiSessionPath(): string {
  return join(homedir(), ".pi", "pi-web-access", "kagi-session.json")
}
