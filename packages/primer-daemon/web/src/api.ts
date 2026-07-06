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
