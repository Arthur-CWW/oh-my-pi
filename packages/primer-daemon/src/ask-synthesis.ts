import type { EvidenceHit } from "./schema"

export interface AskSynthesisConfig {
  model: string
  enabled: boolean
}

const DEFAULT_ASK_MODEL = "google-antigravity/gemini-3.5-flash"
const SYNTHESIS_TIMEOUT_MS = 90_000
const STDERR_TAIL_LENGTH = 1_000
const MAX_SNIPPET_LENGTH = 700

export function resolveAskSynthesisConfig(env: Record<string, string | undefined>): AskSynthesisConfig {
  const model = env.PRIMER_ASK_MODEL ?? DEFAULT_ASK_MODEL
  return {
    model,
    enabled: env.PRIMER_ASK_SYNTHESIS !== "0" && !isForbiddenModel(model),
  }
}

export function isForbiddenModel(model: string): boolean {
  const lower = model.toLowerCase()
  return lower.includes("fable") || lower.includes("mythos")
}

export function buildSynthesisPrompt(question: string, hits: readonly EvidenceHit[]): string {
  const evidence = hits.map(formatEvidenceHit).join("\n")
  return [
    "Answer the question from the evidence below only.",
    "Cite evidence refs inline exactly like [browser:events:241].",
    "If the evidence is thin or missing key facts, say what is missing.",
    "Keep the answer to 6 sentences or fewer.",
    "",
    `Question: ${question}`,
    "",
    "Evidence:",
    evidence.length === 0 ? "(none)" : evidence,
  ].join("\n")
}

export async function synthesizeAnswer(
  question: string,
  hits: readonly EvidenceHit[],
  config: AskSynthesisConfig,
): Promise<{ text: string; model: string; elapsedMs: number }> {
  const chunks: string[] = []
  const { elapsedMs } = await streamSynthesis(question, hits, config, (text) => {
    chunks.push(text)
  })
  return { text: chunks.join("").trim(), model: config.model, elapsedMs }
}

export async function streamSynthesis(
  question: string,
  hits: readonly EvidenceHit[],
  config: AskSynthesisConfig,
  onDelta: (text: string) => void,
): Promise<{ elapsedMs: number }> {
  if (!config.enabled) throw new Error("synthesis disabled")

  const prompt = buildSynthesisPrompt(question, hits)
  const started = Date.now()
  const subprocess = Bun.spawn(buildOmpArgv(config.model, prompt), { stdout: "pipe", stderr: "pipe" })
  const stderr = new Response(subprocess.stderr).text()
  let hasOutput = false
  let finishTimeout: (value: { kind: "timeout" }) => void = () => {}
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    finishTimeout = resolve
  })
  const timeoutId = setTimeout(() => finishTimeout({ kind: "timeout" }), SYNTHESIS_TIMEOUT_MS)
  const stdout = streamStdout(subprocess.stdout, (text) => {
    hasOutput = hasOutput || containsNonWhitespace(text)
    onDelta(text)
  })
  const stdoutFailure = stdout.then<never, { kind: "stdout"; error: unknown }>(
    () => new Promise<never>(() => {}),
    (error: unknown) => ({ kind: "stdout", error }),
  )

  try {
    const result = await Promise.race([
      subprocess.exited.then((code) => ({ kind: "exit" as const, code })),
      timeout,
      stdoutFailure,
    ])
    clearTimeout(timeoutId)

    if (result.kind === "stdout") throw result.error

    if (result.kind === "timeout") {
      subprocess.kill()
      const stderrText = await settleText(stderr)
      await settle(stdout)
      throw new Error(`omp timed out after ${SYNTHESIS_TIMEOUT_MS / 1000}s${stderrTail(stderrText)}`)
    }

    await stdout
    const stderrText = await stderr
    if (result.code !== 0) throw new Error(`omp exited with code ${result.code}${stderrTail(stderrText)}`)
    if (!hasOutput) throw new Error(`omp returned empty output${stderrTail(stderrText)}`)

    return { elapsedMs: Date.now() - started }
  } catch (error) {
    clearTimeout(timeoutId)
    subprocess.kill()
    await settle(stderr)
    await settle(stdout)
    throw error
  }
}

function buildOmpArgv(model: string, prompt: string): string[] {
  return [
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
  ]
}

/** Consume omp `--mode json` NDJSON events, forwarding assistant text deltas.
 * `text_delta` events carry incremental tokens; everything else (session
 * header, turn/message lifecycle, thinking) is ignored so the SSE stream
 * only ever contains answer text. */
async function streamStdout(stdout: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ""
  const consumeLine = (line: string): void => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      return // non-JSON noise on stdout; never forward it as answer text
    }
    if (typeof event !== "object" || event === null) return
    const record = event as Record<string, unknown>
    if (record.type !== "message_update") return
    const inner = record.assistantMessageEvent
    if (typeof inner !== "object" || inner === null) return
    const innerRecord = inner as Record<string, unknown>
    if (innerRecord.type !== "text_delta") return
    if (typeof innerRecord.delta === "string" && innerRecord.delta.length > 0) onDelta(innerRecord.delta)
  }
  for await (const chunk of stdout as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let newlineIdx = buffer.indexOf("\n")
    while (newlineIdx >= 0) {
      consumeLine(buffer.slice(0, newlineIdx))
      buffer = buffer.slice(newlineIdx + 1)
      newlineIdx = buffer.indexOf("\n")
    }
  }
  buffer += decoder.decode()
  consumeLine(buffer)
}

function containsNonWhitespace(text: string): boolean {
  for (const character of text) {
    if (!/\s/u.test(character)) return true
  }
  return false
}

function formatEvidenceHit(hit: EvidenceHit, index: number): string {
  const snippet = compact(hit.snippet ?? "")
  const clippedSnippet =
    snippet.length <= MAX_SNIPPET_LENGTH ? snippet : `${snippet.slice(0, MAX_SNIPPET_LENGTH - 1)}…`
  return [
    `${index + 1}. ref: ${hit.ref}`,
    `title: ${compact(hit.title)}`,
    `url: ${compact(hit.url ?? "")}`,
    `timestamp: ${compact(hit.timestamp ?? "")}`,
    `snippet: ${clippedSnippet}`,
  ].join(" | ")
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

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

