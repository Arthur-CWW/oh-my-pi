import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { asObject, type JsonObject } from "./domain"

const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent")
const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex")

export const PI_AUTH_FILE = path.join(agentDir, "auth.json")
export const PI_SETTINGS_FILE = path.join(agentDir, "settings.json")
export const CODEX_AUTH_FILE = path.join(codexHome, "auth.json")

export async function readJsonObject(file: string): Promise<JsonObject> {
  try {
    return asObject(JSON.parse(await fs.readFile(file, "utf8"))) ?? {}
  } catch (error) {
    if (asObject(error)?.code === "ENOENT") return {}
    throw error
  }
}

export async function readFooterDefaults(): Promise<{ autoCompactEnabled: boolean; thinkingLevel: string }> {
  const settings = await readJsonObject(PI_SETTINGS_FILE)
  const compaction = asObject(settings.compaction)
  return {
    autoCompactEnabled: compaction?.enabled !== false,
    thinkingLevel: typeof settings.defaultThinkingLevel === "string" ? settings.defaultThinkingLevel : "off",
  }
}
