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
  if (!config.enabled) throw new Error("synthesis disabled")

  const prompt = buildSynthesisPrompt(question, hits)
  const started = Date.now()
  const subprocess = Bun.spawn(
    [
      "omp",
      "-p",
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-rules",
      "--thinking",
      "low",
      "--model",
      config.model,
      prompt,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )

  const stdout = new Response(subprocess.stdout).text()
  const stderr = new Response(subprocess.stderr).text()
  let finishTimeout: (value: "timeout") => void = () => {}
  const timeout = new Promise<"timeout">((resolve) => {
    finishTimeout = resolve
  })
  const timeoutId = setTimeout(() => finishTimeout("timeout"), SYNTHESIS_TIMEOUT_MS)

  const exit = await Promise.race([subprocess.exited, timeout])
  clearTimeout(timeoutId)

  if (exit === "timeout") {
    subprocess.kill()
    const stderrText = await settleText(stderr)
    await settleText(stdout)
    throw new Error(`omp timed out after ${SYNTHESIS_TIMEOUT_MS / 1000}s${stderrTail(stderrText)}`)
  }

  const [stdoutText, stderrText] = await Promise.all([stdout, stderr])
  if (exit !== 0) throw new Error(`omp exited with code ${exit}${stderrTail(stderrText)}`)

  const text = stdoutText.trim()
  if (text.length === 0) throw new Error(`omp returned empty output${stderrTail(stderrText)}`)

  return { text, model: config.model, elapsedMs: Date.now() - started }
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

function stderrTail(stderr: string): string {
  const trimmed = stderr.trim()
  if (trimmed.length === 0) return ""
  return `: ${trimmed.slice(-STDERR_TAIL_LENGTH)}`
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

