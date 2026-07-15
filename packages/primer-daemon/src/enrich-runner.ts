import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Database } from "bun:sqlite"
import { Schema } from "effect"

import { isForbiddenModel } from "./ask-synthesis"
import { lookupCedictExact, listKnownWords } from "./dict"
import { insertEnrichment, type EnrichmentOutput, EnrichmentOutputSchema, type EnrichmentRecord } from "./enrich-store"
import type { DaemonPaths } from "./paths"
import { getQueueItemById, getReadingDoc, listQueueItems } from "./reading-store"
 
const DEFAULT_ENRICH_MODEL = "google-antigravity/gemini-3.5-flash"
const ENRICH_TIMEOUT_MS = 90_000
const STDERR_TAIL_LENGTH = 1_000
const PROMPT_VERSION = "v0"
const PROMPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../streams/primer/experiments/queue-enrichment/prompt-v0.md")
const ENRICHMENT_PROMPT_TEMPLATE = readFileSync(PROMPT_PATH, "utf8")

const SEED_FUNCTION_WORDS = [
  "的", "了", "是", "我", "你", "在", "有", "不", "人", "也", "他", "她", "它", "这", "那", "很", "都", "就", "会", "和", "与", "或", "要", "能", "可以", "吗", "呢", "啊", "从", "到", "上", "下", "里", "中", "为", "还", "把", "被", "让", "给", "着", "过", "得", "地", "而", "因为", "所以", "如果", "但是", "然后", "一个", "什么", "怎么", "没有", "不是", "时候", "一起",
] as const

export interface EnrichmentPromptInput {
  queue_item: {
    id: number
    word: string
    pinyin: string
    gloss: string
  }
  cedict: {
    simplified: string
    traditional: string
    pinyin: string
    definitions: string[]
  }
  decomposition: Array<{ char: string; ids: string; components: string[] }>
  source: {
    doc_id: number
    doc_title: string
    paragraph_idx: number
    paragraph_text: string
    sentence: string
    mark_id: number
  }
  known_words: string[]
  seed_function_words: string[]
  sibling_queue_items: Array<{ word: string; pinyin: string; gloss: string }>
}

export function buildEnrichmentPrompt(input: EnrichmentPromptInput, template = ENRICHMENT_PROMPT_TEMPLATE): string {
  const marker = "### Input (filled per queue item)"
  const markerStart = template.indexOf(marker)
  if (markerStart < 0) throw new Error("enrichment prompt is missing its input marker")
  const openingFence = template.indexOf("```json", markerStart)
  if (openingFence < 0) throw new Error("enrichment prompt is missing its JSON input fence")
  const contentStart = openingFence + "```json".length
  const contentEnd = template.indexOf("```", contentStart)
  if (contentEnd < 0) throw new Error("enrichment prompt is missing its closing input fence")
  const inputJson = JSON.stringify(input, null, 2)
  return `${template.slice(0, contentStart)}\n${inputJson}${template.slice(contentEnd)}`
}

export async function runEnrichment(db: Database, paths: DaemonPaths, queueItemId: number): Promise<EnrichmentRecord> {
  const queueItem = getQueueItemById(db, queueItemId)
  if (queueItem === null) throw new Error("unknown queue item")
  const model = process.env.PRIMER_ENRICH_MODEL ?? DEFAULT_ENRICH_MODEL
  const started = Date.now()

  try {
    if (isForbiddenModel(model)) throw new Error(`forbidden enrichment model: ${model}`)
    const input = buildEnrichmentPromptInput(db, paths, queueItemId)
    const prompt = buildEnrichmentPrompt(input)
    const raw = await spawnEnrichment(model, prompt)
    const output = parseEnrichmentOutput(raw)
    return insertEnrichment(db, {
      queueItemId,
      model,
      promptVersion: PROMPT_VERSION,
      output,
      status: "ok",
      elapsedMs: Date.now() - started,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return insertEnrichment(db, {
      queueItemId,
      model,
      promptVersion: PROMPT_VERSION,
      output: null,
      status: "error",
      error: detail,
      elapsedMs: Date.now() - started,
    })
  }
}

export function buildEnrichmentPromptInput(db: Database, paths: DaemonPaths, queueItemId: number): EnrichmentPromptInput {
  const queueItem = getQueueItemById(db, queueItemId)
  if (queueItem === null) throw new Error("unknown queue item")
  const provenance = queueItem.provenance
  if (provenance === null) throw new Error("queue item has no reading provenance")
  const doc = getReadingDoc(db, provenance.docId)
  if (doc === null) throw new Error("queue item's reading document is missing")
  const paragraphText = doc.paragraphs[provenance.paragraphIdx]
  if (paragraphText === undefined) throw new Error("queue item's reading paragraph is missing")
  const dict = lookupCedictExact(paths.cedictDb, queueItem.word)
  const firstEntry = dict.entries[0]
  const knownWords = listKnownWords(paths.cedictDb).words
  const siblings = listQueueItems(db, "all", 100)
    .filter((item) => item.id !== queueItem.id)
    .map((item) => ({ word: item.word, pinyin: item.pinyin ?? "", gloss: item.gloss ?? "" }))
  return {
    queue_item: {
      id: queueItem.id,
      word: queueItem.word,
      pinyin: queueItem.pinyin ?? firstEntry?.pinyin ?? "",
      gloss: queueItem.gloss ?? firstEntry?.definitions.join("; ") ?? "",
    },
    cedict: {
      simplified: firstEntry?.simplified ?? queueItem.word,
      traditional: firstEntry?.traditional ?? queueItem.word,
      pinyin: firstEntry?.pinyin ?? queueItem.pinyin ?? "",
      definitions: dict.entries.flatMap((entry) => entry.definitions),
    },
    decomposition: dict.decomposition,
    source: {
      doc_id: provenance.docId,
      doc_title: provenance.docTitle,
      paragraph_idx: provenance.paragraphIdx,
      paragraph_text: paragraphText,
      sentence: provenance.sentence,
      mark_id: provenance.markId ?? 0,
    },
    known_words: knownWords,
    seed_function_words: [...SEED_FUNCTION_WORDS],
    sibling_queue_items: siblings,
  }
}

async function spawnEnrichment(model: string, prompt: string): Promise<string> {
  const subprocess = Bun.spawn(
    ["omp", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-rules", "--thinking", "low", "--model", model, prompt],
    { stdout: "pipe", stderr: "pipe" },
  )
  const stdout = new Response(subprocess.stdout).text()
  const stderr = new Response(subprocess.stderr).text()
  let timeoutResolve: (value: { kind: "timeout" }) => void = () => {}
  const timeout = new Promise<{ kind: "timeout" }>((resolveTimeout) => {
    timeoutResolve = resolveTimeout
  })
  const timeoutId = setTimeout(() => timeoutResolve({ kind: "timeout" }), ENRICH_TIMEOUT_MS)
  try {
    const result = await Promise.race([subprocess.exited.then((code) => ({ kind: "exit" as const, code })), timeout])
    clearTimeout(timeoutId)
    if (result.kind === "timeout") {
      subprocess.kill()
      const stderrText = await settleText(stderr)
      await settle(stdout)
      throw new Error(`omp timed out after ${ENRICH_TIMEOUT_MS / 1000}s${stderrTail(stderrText)}`)
    }
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr])
    if (result.code !== 0) throw new Error(`omp exited with code ${result.code}${stderrTail(stderrText)}`)
    if (stdoutText.trim().length === 0) throw new Error(`omp returned empty output${stderrTail(stderrText)}`)
    return stdoutText
  } catch (error) {
    clearTimeout(timeoutId)
    subprocess.kill()
    await settle(stderr)
    await settle(stdout)
    throw error
  }
}

function parseEnrichmentOutput(raw: string): EnrichmentOutput {
  const trimmed = raw.trim()
  const unfenced = trimmed.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim()
  const start = unfenced.indexOf("{")
  const end = unfenced.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("enrichment output did not contain a JSON object")
  let parsed: EnrichmentOutput
  try {
    parsed = Schema.decodeUnknownSync(EnrichmentOutputSchema)(JSON.parse(unfenced.slice(start, end + 1)))
  } catch (error) {
    throw new Error(`enrichment JSON/schema parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parsed
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

function stderrTail(stderr: string): string {
  const trimmed = stderr.trim()
  if (trimmed.length === 0) return ""
  return `: ${trimmed.slice(-STDERR_TAIL_LENGTH)}`
}
