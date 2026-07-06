import { createSseParser } from "@/lib/sse"

export type EvidenceSource = "browser" | "twitter" | "reader"
export type CardStatus = "candidate" | "approved" | "rejected"

export interface EvidenceHit {
  source: EvidenceSource
  kind: string
  ref: string
  url: string | null
  title: string
  snippet: string | null
  timestamp: string | null
  score: number
}

export interface SubstrateStatus {
  name: EvidenceSource
  path: string
  exists: boolean
  mtime: string | null
}

export interface DashboardStatus {
  generatedAt: string
  substrates: SubstrateStatus[]
  ledger: {
    path: string
    notes: number
    cards: number
    progress: number
  }
}

export interface AskAnswer {
  text: string
  model: string
  elapsedMs: number
}

export interface AskResponse {
  question: string
  terms: string[]
  hits: EvidenceHit[]
  skipped: string[]
  answer: AskAnswer | null
  answerError: string | null
}

/** The `meta` frame that opens every /api/ask/stream response. */
export interface AskStreamMeta {
  question: string
  terms: string[]
  hits: EvidenceHit[]
  skipped: string[]
  model: string
  synthesisEnabled: boolean
}

export interface AskStreamHandlers {
  onMeta: (meta: AskStreamMeta) => void
  onDelta: (text: string) => void
  onDone: (info: { elapsedMs: number }) => void
  onError: (message: string) => void
}

export interface NoteSource {
  id: number
  ref: string
  url: string | null
  title: string | null
}

export interface Note {
  id: number
  question: string
  body: string
  createdAt: string
  sources: NoteSource[]
}

export interface Card {
  id: number
  front: string
  back: string
  sourceRef: string | null
  url: string | null
  status: CardStatus
  createdAt: string
}

export interface ProgressEntry {
  id: number
  kind: string
  title: string
  body: string | null
  refs: string[]
  createdAt: string
}

export interface ProofSummary {
  name: string
  title: string
  mtime: string
}

export interface Proof {
  name: string
  markdown: string
}

export interface AskConfig {
  model: string
  synthesisEnabled: boolean
}

export async function getStatus(): Promise<DashboardStatus> {
  return fetchJson<DashboardStatus>("/api/status")
}

export async function ask(question: string, limit?: number): Promise<AskResponse> {
  return fetchJson<AskResponse>("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(limit === undefined ? { question } : { question, limit }),
  })
}

/**
 * Stream a synthesized answer over SSE. Resolves once the stream ends; rejects
 * on transport failure or when `signal` aborts (surfaced as an AbortError the
 * caller can distinguish). Answer-side failures arrive via `handlers.onError`.
 */
export async function askStream(
  question: string,
  limit: number | undefined,
  handlers: AskStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/ask/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(limit === undefined ? { question } : { question, limit }),
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Request failed with ${response.status}`)
  }
  const feed = createSseParser((event) => {
    switch (event.event) {
      case "meta":
        handlers.onMeta(JSON.parse(event.data) as AskStreamMeta)
        break
      case "delta":
        handlers.onDelta((JSON.parse(event.data) as { text: string }).text)
        break
      case "done":
        handlers.onDone(JSON.parse(event.data) as { elapsedMs: number })
        break
      case "error":
        handlers.onError((JSON.parse(event.data) as { message: string }).message)
        break
    }
  })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      feed(decoder.decode(value, { stream: true }))
    }
    feed(decoder.decode())
  } finally {
    reader.releaseLock()
  }
}

export async function getNotes(limit?: number): Promise<Note[]> {
  return fetchJson<Note[]>(withLimit("/api/notes", limit))
}

export async function getCards(limit?: number): Promise<Card[]> {
  return fetchJson<Card[]>(withLimit("/api/cards", limit))
}

export async function setCardStatus(id: number, status: CardStatus): Promise<Card> {
  return fetchJson<Card>("/api/cards/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, status }),
  })
}

export async function getProgress(limit?: number): Promise<ProgressEntry[]> {
  return fetchJson<ProgressEntry[]>(withLimit("/api/progress", limit))
}

export async function addProgress(input: { kind: string; title: string; body?: string; refs?: string[] }): Promise<ProgressEntry> {
  return fetchJson<ProgressEntry>("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
}

export async function getProofs(): Promise<ProofSummary[]> {
  return fetchJson<ProofSummary[]>("/api/proofs")
}

export async function getProof(name: string): Promise<Proof> {
  return fetchJson<Proof>(`/api/proofs/${encodeURIComponent(name)}`)
}

export async function getAskConfig(): Promise<AskConfig> {
  return fetchJson<AskConfig>("/api/ask/config")
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }
  return (await response.json()) as T
}

function withLimit(path: string, limit: number | undefined): string {
  if (limit === undefined) return path
  const params = new URLSearchParams({ limit: String(limit) })
  return `${path}?${params}`
}
