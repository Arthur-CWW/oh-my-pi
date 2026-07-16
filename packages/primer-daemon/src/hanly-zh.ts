import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { Database } from "bun:sqlite"

import { isForbiddenModel } from "./ask-synthesis"

export const HANLY_ZH_PILOT_LIMIT = 50
export const HANLY_ZH_PROMPT_VERSION = "v0"
const DEFAULT_ENRICH_MODEL = "google-antigravity/gemini-3.5-flash"
const HANLY_ZH_TIMEOUT_MS = 90_000
const DEFAULT_HANLY_DB = resolve(homedir(), "apps/hsk-deck/hanly-re/output/hanly-content.sqlite")

export type HanlyZhStatus = "ok" | "error"
export type HanlyZhConfidence = "高" | "中" | "低"

export interface HanlyPrimitiveSource {
  char: string
  meaning: string
  phonetic: string
}

export interface HanlyZhPromptInput {
  char: string
  decomposition: readonly string[]
  primitives: readonly HanlyPrimitiveSource[]
  etymology: string
}

export interface HanlyZhOutput {
  char: string
  部件: Array<{ 部件: string; 意思: string }>
  字源一句话: string
  记忆提示: string
  信心: HanlyZhConfidence
}

export interface HanlyPilotCharacter extends HanlyZhPromptInput {
  hskLevel: number
  frequencyRank: number
  sourceSummary: string
}

export interface HanlyZhRow {
  char: string
  sourceSummary: string
  zhExplanation: string | null
  components: Array<{ 部件: string; 意思: string }>
  model: string
  status: HanlyZhStatus
  createdAt: string
}

export interface HanlyZhRunSummary {
  total: number
  ok: number
  error: number
  rows: HanlyZhRow[]
  samples: Array<{ source: HanlyPilotCharacter; output: HanlyZhOutput }>
}

type NoRows = Record<string, never>

type HanlyCharacterRow = {
  char: string
  story: string | null
  hsk_level: number | null
  frequency_rank: number | null
  json: string
}

type HanlyPrimitiveRow = {
  primitive: string
  meaning_informal: string | null
  phonetic_name: string | null
  json: string
}

/** Creates the local result table. The Hanly source database is never written. */
export function ensureHanlyZhTable(db: Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS hanly_zh (
  char TEXT UNIQUE NOT NULL,
  source_summary TEXT NOT NULL,
  zh_explanation TEXT,
  components TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
}

export function insertHanlyZh(
  db: Database,
  input: {
    char: string
    sourceSummary: string
    zhExplanation: string | null
    components: readonly { 部件: string; 意思: string }[]
    model: string
    status: HanlyZhStatus
  },
): HanlyZhRow {
  ensureHanlyZhTable(db)
  db.query<NoRows, [string, string, string | null, string, string, HanlyZhStatus]>(
    `INSERT INTO hanly_zh (char, source_summary, zh_explanation, components, model, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(char) DO UPDATE SET
       source_summary = excluded.source_summary,
       zh_explanation = excluded.zh_explanation,
       components = excluded.components,
       model = excluded.model,
       status = excluded.status,
       created_at = excluded.created_at`,
  ).run(
    input.char,
    input.sourceSummary,
    input.zhExplanation,
    JSON.stringify(input.components),
    input.model,
    input.status,
  )
  const row = db.query<RawHanlyZhRow, [string]>(
    `SELECT char, source_summary, zh_explanation, components, model, status, created_at
     FROM hanly_zh WHERE char = ?`,
  ).get(input.char)
  if (row === null) throw new Error(`failed to read Hanly zh row for ${input.char}`)
  return decodeHanlyZhRow(row)
}

export function listHanlyZh(db: Database, limit = HANLY_ZH_PILOT_LIMIT): HanlyZhRow[] {
  ensureHanlyZhTable(db)
  const normalizedLimit = normalizeLimit(limit)
  return db
    .query<RawHanlyZhRow, [number]>(
      `SELECT char, source_summary, zh_explanation, components, model, status, created_at
       FROM hanly_zh ORDER BY datetime(created_at) DESC, char LIMIT ?`,
    )
    .all(normalizedLimit)
    .map(decodeHanlyZhRow)
}

export function buildHanlyZhPrompt(input: HanlyZhPromptInput): string {
  const decomposition = input.decomposition.length === 0 ? "暂无" : input.decomposition.join("、")
  const primitives =
    input.primitives.length === 0
      ? "暂无"
      : input.primitives
          .map((primitive) => `${primitive.char}（意思：${primitive.meaning || "暂无"}；读音提示：${primitive.phonetic || "暂无"}）`)
          .join("；")
  const etymology = input.etymology.trim().length === 0 ? "暂无" : input.etymology.trim()
  return [
    "你是给中文初学者讲汉字的老师。",
    "只输出严格 JSON，不要 Markdown，不要前后解释，不要输出 JSON 以外的文字。",
    "输出必须是简体中文；词语尽量使用 HSK 1-3 常用词。禁止英文、拼音和英文解释。",
    "所有字源判断只能来自下面的 Hanly 输入资料，不能凭空补充历史；资料不够时写“暂无”。",
    "字源一句话必须是简单中文，最多 30 个字。",
    "记忆提示可以是帮助记忆的联想，但不是历史；必须以“联想：”开头，不能把联想说成字源。",
    '输出格式必须完全是：{"char":"目标字","部件":[{"部件":"部件字","意思":"简单中文"}],"字源一句话":"……","记忆提示":"联想：……","信心":"高"|"中"|"低"}',
    "",
    "目标字：",
    input.char,
    "Hanly 分解：",
    decomposition,
    "Hanly 部件资料：",
    primitives,
    "Hanly 英文资料（只可据此判断，不要原样输出英文）：",
    etymology,
  ].join("\n")
}

/** Selects the deterministic highest-frequency HSK1-2 pilot with source data. */
export function selectHanlyPilot(sourceDb: Database, limit = HANLY_ZH_PILOT_LIMIT): HanlyPilotCharacter[] {
  const normalizedLimit = normalizeGenerationLimit(limit)
  const primitiveRows = sourceDb
    .query<HanlyPrimitiveRow, []>(
      "SELECT primitive, meaning_informal, phonetic_name, json FROM primitives",
    )
    .all()
  const primitiveByChar = new Map(primitiveRows.map((row) => [row.primitive, decodePrimitive(row)]))
  const candidates = sourceDb
    .query<HanlyCharacterRow, []>(
      `SELECT char, story, hsk_level, frequency_rank, json
       FROM characters
       WHERE hsk_level IN (1, 2) AND frequency_rank IS NOT NULL
       ORDER BY frequency_rank ASC`,
    )
    .all()
  const selected: HanlyPilotCharacter[] = []
  for (const row of candidates) {
    if (Array.from(row.char).length !== 1 || row.hsk_level === null || row.frequency_rank === null) continue
    const payload = parseObject(row.json)
    const decomposition = asStringArray(payload.decomposition)
    const heisigData = isRecord(payload.heisig_data) ? payload.heisig_data : {}
    const etymology = firstNonEmpty(row.story, asString(payload.story), asString(heisigData.story))
    if (decomposition.length === 0 || etymology.length === 0) continue
    const primitives = decomposition.map((component) => primitiveByChar.get(component) ?? { char: component, meaning: "", phonetic: "" })
    selected.push({
      char: row.char,
      hskLevel: row.hsk_level,
      frequencyRank: row.frequency_rank,
      decomposition,
      primitives,
      etymology,
      sourceSummary: formatSourceSummary({ char: row.char, decomposition, primitives, etymology }),
    })
    if (selected.length >= normalizedLimit) break
  }
  return selected
}

export async function runHanlyZh(
  db: Database,
  hanlyDbPath = DEFAULT_HANLY_DB,
  limit = HANLY_ZH_PILOT_LIMIT,
  env: Record<string, string | undefined> = process.env,
): Promise<HanlyZhRunSummary> {
  const normalizedLimit = normalizeGenerationLimit(limit)
  if (!existsSync(hanlyDbPath)) throw new Error(`Hanly database not found: ${hanlyDbPath}`)
  const model = env.PRIMER_ENRICH_MODEL ?? DEFAULT_ENRICH_MODEL
  ensureHanlyZhTable(db)
  const sourceDb = new Database(hanlyDbPath, { readonly: true })
  try {
    const sources = selectHanlyPilot(sourceDb, normalizedLimit)
    if (sources.length < normalizedLimit) throw new Error(`Hanly source has only ${sources.length} eligible pilot characters (requested ${normalizedLimit})`)
    const rows: HanlyZhRow[] = []
    const samples: Array<{ source: HanlyPilotCharacter; output: HanlyZhOutput }> = []
    for (const source of sources) {
      const started = Date.now()
      try {
        if (isForbiddenModel(model)) throw new Error(`forbidden enrichment model: ${model}`)
        const raw = await spawnHanlyZh(model, buildHanlyZhPrompt(source))
        const output = parseHanlyZhOutput(raw, source.char)
        const row = insertHanlyZh(db, {
          char: source.char,
          sourceSummary: source.sourceSummary,
          zhExplanation: output.字源一句话,
          components: output.部件,
          model,
          status: "ok",
        })
        rows.push(row)
        if (samples.length < 10) samples.push({ source, output })
        process.stdout.write(`[hanly-zh] ${source.char} ok ${Date.now() - started}ms\n`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const row = insertHanlyZh(db, {
          char: source.char,
          sourceSummary: source.sourceSummary,
          zhExplanation: `错误：${detail}`,
          components: [],
          model,
          status: "error",
        })
        rows.push(row)
        process.stderr.write(`[hanly-zh] ${source.char} error: ${detail}\n`)
      }
    }
    return {
      total: rows.length,
      ok: rows.filter((row) => row.status === "ok").length,
      error: rows.filter((row) => row.status === "error").length,
      rows,
      samples,
    }
  } finally {
    sourceDb.close()
  }
}

export function parseHanlyZhOutput(raw: string, expectedChar: string): HanlyZhOutput {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("Hanly zh output did not contain a JSON object")
  let value: unknown
  try {
    value = JSON.parse(trimmed.slice(start, end + 1))
  } catch (error) {
    throw new Error(`Hanly zh JSON parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(value)) throw new Error("Hanly zh output is not an object")
  if (value.char !== expectedChar) throw new Error(`Hanly zh char mismatch: expected ${expectedChar}`)
  const components = value.部件
  if (!Array.isArray(components)) throw new Error("Hanly zh 部件 must be an array")
  const decodedComponents: Array<{ 部件: string; 意思: string }> = []
  for (const component of components) {
    if (!isRecord(component) || typeof component.部件 !== "string" || typeof component.意思 !== "string") {
      throw new Error("Hanly zh 部件 entries must contain string 部件 and 意思")
    }
    if (component.部件.trim().length === 0 || component.意思.trim().length === 0) throw new Error("Hanly zh 部件 entries cannot be empty")
    assertZhOnly(component.意思, "部件意思")
    decodedComponents.push({ 部件: component.部件, 意思: component.意思 })
  }
  if (typeof value.字源一句话 !== "string" || value.字源一句话.trim().length === 0) throw new Error("Hanly zh 字源一句话 is required")
  const explanation = value.字源一句话.trim()
  if (Array.from(explanation.replace(/\s/gu, "")).length > 30) throw new Error("Hanly zh 字源一句话 exceeds 30 characters")
  assertZhOnly(explanation, "字源一句话")
  if (typeof value.记忆提示 !== "string" || !value.记忆提示.trim().startsWith("联想：")) throw new Error("Hanly zh 记忆提示 must start with 联想：")
  const memory = value.记忆提示.trim()
  assertZhOnly(memory, "记忆提示")
  if (value.信心 !== "高" && value.信心 !== "中" && value.信心 !== "低") throw new Error("Hanly zh 信心 must be 高、中或低")
  return { char: expectedChar, 部件: decodedComponents, 字源一句话: explanation, 记忆提示: memory, 信心: value.信心 }
}

function formatSourceSummary(input: HanlyZhPromptInput): string {
  const primitiveLines = input.primitives.map((primitive) => ({ 部件: primitive.char, 意思: primitive.meaning, 读音提示: primitive.phonetic }))
  return [
    `目标字：${input.char}`,
    `Hanly 分解：${input.decomposition.join("、")}`,
    `Hanly 部件：${JSON.stringify(primitiveLines, null, 2)}`,
    `Hanly 英文字源资料：${input.etymology}`,
  ].join("\n")
}

function decodePrimitive(row: HanlyPrimitiveRow): HanlyPrimitiveSource {
  const payload = parseObject(row.json)
  const meaningObject = isRecord(payload.meaning) ? payload.meaning : {}
  const meaning = firstNonEmpty(
    row.meaning_informal,
    asStringArray(meaningObject.mnemonic_primitive_meanings)[0],
    asStringArray(meaningObject.primitive_meanings)[0],
  )
  return { char: row.primitive, meaning, phonetic: row.phonetic_name ?? asString(payload.phonetic_name) }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? ""
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertZhOnly(value: string, field: string): void {
  if (/[A-Za-z]/u.test(value)) throw new Error(`Hanly zh ${field} contains Latin letters`)
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : HANLY_ZH_PILOT_LIMIT
}

function normalizeGenerationLimit(limit: number): number {
  const normalized = normalizeLimit(limit)
  if (normalized > HANLY_ZH_PILOT_LIMIT) throw new Error(`Hanly zh pilot limit cannot exceed ${HANLY_ZH_PILOT_LIMIT}`)
  return normalized
}

type RawHanlyZhRow = {
  char: string
  source_summary: string
  zh_explanation: string | null
  components: string
  model: string
  status: string
  created_at: string
}

function decodeHanlyZhRow(row: RawHanlyZhRow): HanlyZhRow {
  let components: Array<{ 部件: string; 意思: string }> = []
  try {
    const parsed: unknown = JSON.parse(row.components)
    if (Array.isArray(parsed)) {
      components = parsed.filter(
        (value): value is { 部件: string; 意思: string } =>
          isRecord(value) && typeof value.部件 === "string" && typeof value.意思 === "string",
      )
    }
  } catch {
    components = []
  }
  if (row.status !== "ok" && row.status !== "error") throw new Error(`invalid Hanly zh status: ${row.status}`)
  return {
    char: row.char,
    sourceSummary: row.source_summary,
    zhExplanation: row.zh_explanation,
    components,
    model: row.model,
    status: row.status,
    createdAt: row.created_at,
  }
}

async function spawnHanlyZh(model: string, prompt: string): Promise<string> {
  const subprocess = Bun.spawn(
    ["omp", "--mode", "json", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-rules", "--thinking", "low", "--model", model, prompt],
    { stdout: "pipe", stderr: "pipe" },
  )
  const stdout = new Response(subprocess.stdout).text()
  const stderr = new Response(subprocess.stderr).text()
  let timeoutResolve: (value: { kind: "timeout" }) => void = () => {}
  const timeout = new Promise<{ kind: "timeout" }>((resolveTimeout) => {
    timeoutResolve = resolveTimeout
  })
  const timeoutId = setTimeout(() => timeoutResolve({ kind: "timeout" }), HANLY_ZH_TIMEOUT_MS)
  try {
    const result = await Promise.race([subprocess.exited.then((code) => ({ kind: "exit" as const, code })), timeout])
    clearTimeout(timeoutId)
    if (result.kind === "timeout") {
      subprocess.kill()
      await settleText(stderr)
      await settle(stdout)
      throw new Error(`omp timed out after ${HANLY_ZH_TIMEOUT_MS / 1000}s`)
    }
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr])
    if (result.code !== 0) throw new Error(`omp exited with code ${result.code}${stderrText.trim().length > 0 ? `: ${stderrText.trim().slice(-1_000)}` : ""}`)
    if (stdoutText.trim().length === 0) throw new Error(`omp returned empty output${stderrText.trim().length > 0 ? `: ${stderrText.trim().slice(-1_000)}` : ""}`)
    const deltas: string[] = []
    for (const line of stdoutText.split("\n")) {
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(event) || event.type !== "message_update" || !isRecord(event.assistantMessageEvent)) continue
      if (event.assistantMessageEvent.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") deltas.push(event.assistantMessageEvent.delta)
    }
    const output = deltas.join("").trim()
    if (output.length === 0) throw new Error("omp returned no assistant text")
    return output
  } catch (error) {
    clearTimeout(timeoutId)
    subprocess.kill()
    await settle(stderr)
    await settle(stdout)
    throw error
  }
}

async function settleText(text: Promise<string>): Promise<string> {
  try {
    return await text
  } catch {
    return ""
  }
}

async function settle<T>(promise: Promise<T>): Promise<void> {
  try {
    await promise
  } catch {
    return
  }
}
