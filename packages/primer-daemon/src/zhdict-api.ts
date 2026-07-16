import { Schema } from "effect"
import { CedictNotBuiltError, lookupCedictExact, type CedictEntry, type DecompositionEntry } from "./dict"
import { resolveDaemonPaths, type DaemonPaths } from "./paths"
import {
  decodeGeneratedGloss,
  getCachedZhGloss,
  lookupZhSentences,
  saveZhGloss,
  type ZhGloss,
  type ZhSentence,
} from "./zhdict-store"

export interface ZhDictResult {
  word: string
  pinyin: string | null
  sentences: ZhSentence[]
  gloss: ZhGloss | null
  decomposition: DecompositionEntry[]
  en: CedictEntry[]
}

export interface ZhDictApiOptions {
  env?: Record<string, string | undefined>
  generate?: (word: string, prompt: string) => Promise<string>
}

const EmptyBodySchema = Schema.Struct({})

export async function handleZhDictApi(
  request: Request,
  paths: DaemonPaths,
  options: ZhDictApiOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  const pathname = url.pathname
  if (!pathname.startsWith("/api/zhdict/")) return null

  try {
    const suffix = pathname.slice("/api/zhdict/".length)
    if (request.method === "GET" && suffix.length > 0 && !suffix.endsWith("/generate") && !suffix.includes("/")) {
      return jsonResponse(lookupZhDict(paths, decodeURIComponentSafe(suffix)))
    }
    if (request.method === "POST" && suffix.endsWith("/generate")) {
      const encodedWord = suffix.slice(0, -"/generate".length)
      if (encodedWord.length === 0 || encodedWord.includes("/")) throw new BadRequestError("malformed dictionary word")
      const word = decodeURIComponentSafe(encodedWord).trim()
      if (word.length === 0) throw new BadRequestError("dictionary word cannot be empty")
      await decodeOptionalBody(request)
      return await handleGenerate(word, paths, options)
    }
    return jsonError("unknown route", 404)
  } catch (error) {
    if (error instanceof BadRequestError) return jsonError(error.message, 400)
    if (error instanceof CedictNotBuiltError) return jsonError(error.message, 503)
    if (error instanceof Error) return jsonError(error.message, 502)
    return jsonError("dictionary request failed", 502)
  }
}

export function lookupZhDict(paths: DaemonPaths, word: string): ZhDictResult {
  const trimmed = word.trim()
  const cedict = lookupCedictExact(paths.cedictDb, trimmed)
  const zhdictDb = paths.zhdictDb ?? resolveDaemonPaths().zhdictDb
  if (zhdictDb === undefined) throw new Error("zhdict database path is not configured")
  return {
    word: trimmed,
    pinyin: cedict.entries[0]?.pinyin ?? null,
    sentences: lookupZhSentences(zhdictDb, trimmed, 4),
    gloss: getCachedZhGloss(zhdictDb, trimmed),
    decomposition: cedict.decomposition,
    en: cedict.entries,
  }
}

export function buildZhGlossPromptForWord(word: string, sentences: readonly ZhSentence[]): string {
  return buildZhGlossPrompt(word, sentences.map((sentence) => sentence.text))
}

async function handleGenerate(word: string, paths: DaemonPaths, options: ZhDictApiOptions): Promise<Response> {
  const zhdictDb = paths.zhdictDb ?? resolveDaemonPaths().zhdictDb
  if (zhdictDb === undefined) throw new Error("zhdict database path is not configured")
  const cached = getCachedZhGloss(zhdictDb, word)
  if (cached !== null) return jsonResponse(cached)

  const sentences = lookupZhSentences(zhdictDb, word, 4)
  const prompt = buildZhGlossPromptForWord(word, sentences)
  const env = options.env ?? process.env
  const model = env.PRIMER_ENRICH_MODEL ?? "google-antigravity/gemini-3.5-flash"
  if (isForbiddenModel(model)) throw new Error("dictionary generation model is not allowed")
  const raw = options.generate === undefined ? await runOmp(model, prompt) : await options.generate(word, prompt)
  const generated = decodeGeneratedGloss(raw, word)
  return jsonResponse(saveZhGloss(zhdictDb, { word, ...generated, model }))
}

async function decodeOptionalBody(request: Request): Promise<void> {
  const contentLength = request.headers.get("content-length")
  if (contentLength === "0") return
  const bodyText = await request.text()
  if (bodyText.trim().length === 0) return
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    throw new BadRequestError("malformed JSON body")
  }
  try {
    Schema.decodeUnknownSync(EmptyBodySchema)(body)
  } catch {
    throw new BadRequestError("malformed request body")
  }
}

async function runOmp(model: string, prompt: string): Promise<string> {
  const subprocess = Bun.spawn(
    [
      "omp",
      "--mode",
      "json",
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-rules",
      "--thinking",
      "low",
      "--model",
      model,
      prompt,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const stdout = await new Response(subprocess.stdout).text()
  const stderr = await new Response(subprocess.stderr).text()
  const exitCode = await subprocess.exited
  if (exitCode !== 0) throw new Error(`dictionary generation failed (${exitCode})${stderr.trim().length > 0 ? `: ${stderr.trim().slice(-500)}` : ""}`)

  const deltas: string[] = []
  for (const line of stdout.split("\n")) {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof event !== "object" || event === null) continue
    const record = event as Record<string, unknown>
    if (record.type !== "message_update") continue
    const inner = record.assistantMessageEvent
    if (typeof inner !== "object" || inner === null) continue
    const innerRecord = inner as Record<string, unknown>
    if (innerRecord.type === "text_delta" && typeof innerRecord.delta === "string") deltas.push(innerRecord.delta)
  }
  const output = deltas.join("").trim()
  if (output.length === 0) throw new Error("dictionary generation returned empty output")
  return output
}

function buildZhGlossPrompt(word: string, sentences: readonly string[]): string {
  return [
    "你是中文词典编辑，只能输出严格 JSON，不要 Markdown，不要解释。",
    "请为目标词写一个适合初学者的中文释义：释义只使用 HSK 1-3 的常用词，简短、清楚，不能出现英文、拼音或目标词本身。",
    "请给出 2-4 个近义词或反义词；每项必须说明一个简短的中文用法差别。",
    "register_note 可以是简短中文语体说明，没有则为 null。",
    '输出格式必须完全是：{"simple_def":"...","synonyms":[{"word":"...","note":"...","relation":"近义词"}],"register_note":null}',
    `目标词：${word}`,
    sentences.length === 0 ? "例句：暂无" : `例句：\n${sentences.map((sentence) => `- ${sentence}`).join("\n")}`,
  ].join("\n")
}

function isForbiddenModel(model: string): boolean {
  const lower = model.toLowerCase()
  return lower.includes("fable") || lower.includes("mythos")
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new BadRequestError("malformed path segment")
  }
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function jsonError(error: string, status: number): Response {
  return jsonResponse({ error }, status)
}

class BadRequestError extends Error {}
