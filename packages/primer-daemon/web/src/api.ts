import { createSseParser } from "@/lib/sse"

export type EvidenceSource = "browser" | "twitter" | "reader" | "cards"
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

// ---------------------------------------------------------------------------
// Reader / Queue types
// ---------------------------------------------------------------------------

export interface ReaderDocSummary {
  id: number
  title: string
  lang: string
  createdAt: string
  paragraphCount: number
  markCount: number
}

export interface Mark {
  id: number
  paragraphIdx: number
  start: number
  end: number
  surface: string
  kind: string
}

export interface ReaderDoc {
  id: number
  title: string
  lang: string
  createdAt: string
  paragraphs: string[]
  marks: Mark[]
}
export type ReaderMediaKind = "audio" | "video"

export interface ReaderMedia {
  slug: string
  kind: ReaderMediaKind
  file: string
  durationMs: number
  asr: string
  sentenceCount: number
}

export interface ReaderAlignmentPhone {
  p: string
  startMs: number
  endMs: number
}

export interface ReaderAlignmentChar {
  ch: string
  pinyin: string
  startMs: number
  endMs: number
  phones?: ReaderAlignmentPhone[] | null
}

export interface ReaderAlignmentSentence {
  idx: number
  text: string
  pinyin: string
  startMs: number
  endMs: number
  chars: ReaderAlignmentChar[]
  charTiming?: "native" | "interpolated" | null
}

export interface ReaderAlignmentMedia {
  file: string
  durationMs: number
  lang: "zh"
  asr: string
  kind?: ReaderMediaKind
}

export interface ReaderAlignment {
  version: 1
  media: ReaderAlignmentMedia
  sentences: ReaderAlignmentSentence[]
}

export interface DictEntry {
  simplified: string
  traditional: string
  pinyin: string
  definitions: string[]
}

export interface DictResult {
  word: string
  entries: DictEntry[]
}

export type ZhSynonymRelation = "近义词" | "反义词"

export interface ZhDictSynonym {
  word: string
  note: string
  relation: ZhSynonymRelation
}

export interface ZhDictGloss {
  word: string
  simpleDef: string
  synonyms: ZhDictSynonym[]
  registerNote: string | null
  model: string
  createdAt: string
}

export interface ZhDictSentence {
  text: string
  source: string
  easeRank: number
}

export interface ZhDictDecomposition {
  char: string
  ids: string
  components: string[]
}

export interface ZhDictResult {
  word: string
  pinyin: string | null
  sentences: ZhDictSentence[]
  gloss: ZhDictGloss | null
  decomposition: ZhDictDecomposition[]
  en: DictEntry[]
}

export interface QueueProvenance {
  docId: number
  docTitle: string
  markId: number | null
  paragraphIdx: number
  start: number
  end: number
  sentence: string
}

export type QueueStatus = "new" | "keep" | "discarded" | "known"

export interface QueueItem {
  id: number
  word: string
  pinyin: string | null
  gloss: string | null
  status: QueueStatus
  priority: number
  lookupCount: number
  createdAt: string
  provenance: QueueProvenance | null
}

export type ReviewGrade = "again" | "hard" | "good" | "easy"
export type ReviewSessionMode = "full" | "quick"

export interface ReviewSessionItem {
  queueItemId: number
  itemKind: "queue_item" | "card_candidate"
  word: string
  pinyin: string | null
  gloss: string | null
  phase: "due" | "new"
  due: string | null
  retrievability: number | null
  priority: number
  provenance: QueueProvenance | null
  explain?: {
    slot: number
    reasons: string[]
  }
}

export interface ReviewSessionResponse {
  items: ReviewSessionItem[]
  mode: ReviewSessionMode
  threshold: number
}

export interface ReviewEvent {
  id: number
  itemKind: "queue_item" | "card_candidate"
  itemId: number
  label: string
  grade: ReviewGrade
  eventTime: string
}

export interface GradeReviewResult {
  queueItemId: number
  due: string
  state: string
  reps: number
}

export interface CreateMarkResult {
  markId: number
  queueItem: QueueItem
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

// ---------------------------------------------------------------------------
// Reader API
// ---------------------------------------------------------------------------

export async function getReaderDocs(): Promise<ReaderDocSummary[]> {
  return fetchJson<ReaderDocSummary[]>("/api/reader/docs")
}

export async function getReaderDoc(id: number): Promise<ReaderDoc> {
  return fetchJson<ReaderDoc>(`/api/reader/docs/${id}`)
}
export async function getReaderMedia(docId: number): Promise<ReaderMedia> {
  return fetchJson<ReaderMedia>(`/api/reader/docs/${docId}/media`)
}

export async function getReaderMediaAlignment(docId: number): Promise<ReaderAlignment> {
  return fetchJson<ReaderAlignment>(`/api/reader/docs/${docId}/media/alignment`)
}

export async function createReaderDoc(title: string, text: string, lang?: string): Promise<{ id: number; paragraphCount: number }> {
  return fetchJson("/api/reader/docs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lang ? { title, text, lang } : { title, text }),
  })
}

export async function createMark(params: {
  docId: number
  paragraphIdx: number
  start: number
  end: number
  surface: string
  sentence: string
  kind?: string
}): Promise<CreateMarkResult> {
  return fetchJson("/api/reader/marks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  })
}

export async function deleteMark(id: number): Promise<void> {
  await fetchJson<{ ok: true }>(`/api/reader/marks/${id}`, { method: "DELETE" })
}

export async function dictLookup(word: string): Promise<DictResult> {
  return fetchJson<DictResult>(`/api/dict/${encodeURIComponent(word)}`)
}
export async function getZhDict(word: string): Promise<ZhDictResult> {
  return fetchJson<ZhDictResult>(`/api/zhdict/${encodeURIComponent(word)}`)
}

export async function generateZhDictGloss(word: string): Promise<ZhDictGloss> {
  return fetchJson<ZhDictGloss>(`/api/zhdict/${encodeURIComponent(word)}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
}


export async function dictBest(text: string): Promise<DictResult> {
  return fetchJson<DictResult>(`/api/dict/best?text=${encodeURIComponent(text)}`)
}

export async function getKnownWords(): Promise<string[]> {
  const result = await fetchJson<{ words: string[] }>("/api/reader/known-words")
  return result.words
}

export async function getQueue(status: QueueStatus | "all" = "new", limit = 100): Promise<QueueItem[]> {
  const params = new URLSearchParams({ status, limit: String(limit) })
  return fetchJson<QueueItem[]>(`/api/queue?${params}`)
}
export async function getReviewSession(
  limit?: number,
  explain = false,
  mode: ReviewSessionMode = "full",
): Promise<ReviewSessionResponse> {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set("limit", String(limit))
  if (explain) params.set("explain", "1")
  if (mode !== "full") params.set("mode", mode)
  const suffix = params.toString()
  return fetchJson<ReviewSessionResponse>(suffix ? `/api/review/session?${suffix}` : "/api/review/session")
}

export async function gradeReview(queueItemId: number, grade: ReviewGrade): Promise<GradeReviewResult> {
  return fetchJson<GradeReviewResult>("/api/review/grade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queueItemId, grade }),
  })
}

export async function setQueuePriority(id: number, priority: number): Promise<QueueItem> {
  return fetchJson<QueueItem>(`/api/queue/${id}/priority`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ priority }),
  })
}

export async function setQueueStatus(id: number, status: QueueStatus): Promise<QueueItem> {
  return fetchJson<QueueItem>(`/api/queue/${id}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  })
}

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export type FeedbackVerdict = "good" | "wrong" | "confusing" | "idea"

export interface FeedbackEvent {
  id: number
  surface: string
  verdict: FeedbackVerdict
  context: JsonObject | null
  note: string | null
  createdAt: string
}

export interface SubmitFeedbackInput {
  surface: string
  verdict: FeedbackVerdict
  note?: string
  context?: JsonObject
}

export interface UiEvent {
  id: number
  kind: string
  payload: JsonObject | null
  createdAt: string
}

export interface UiEventInput {
  kind: string
  payload?: JsonObject
}

export interface PipelineStats {
  docs: number
  marks: number
  queue: {
    new: number
    keep: number
    known: number
    discarded: number
  }
  priorityPushed: number
  enrolledQueue: number
  enrolledCards: number
  dueNow: number
  newAvailable: number
  reviewEvents: number
  feedbackCount: number
  enrichmentCount: number
}

export interface ReviewSimulationStep {
  grade: ReviewGrade
  due: string
  intervalDays: number
  stability: number
  difficulty: number
}

export interface ReviewSimulationResult {
  steps: ReviewSimulationStep[]
}

export interface EnrichmentLabel {
  id: number
  enrichmentId: number
  field: string
  verdict: "keep" | "cut" | "edit"
  edited: string | null
  note: string | null
  createdAt: string
}

export interface EnrichmentOutput {
  enrichment_version: "v0"
  item: {
    queue_item_id: number
    word: string
    pinyin: string
  }
  provenance: {
    source_sentence: string
    doc_id: number
    doc_title: string
    paragraph_idx: number
    mark_id: number | null
    quote_verified: boolean
  }
  sense_disambiguation: {
    cedict_definitions: string[]
    selected_sense_index: number
    selected_sense: string
    evidence_quote: string
    gloss_in_context: string
    source: "cedict" | "cedict-extended" | "inferred"
    confidence: "high" | "medium" | "low"
    note: string | null
  }
  examples: Array<{
    sentence: string
    pinyin: string
    translation: string
    uses_sense_index: number
    unknown_tokens: string[]
    known_token_ratio: number
  }>
  morpheme_note: {
    components: Array<{ char: string; ids?: string; gloss: string }>
    note: string
    predicted_confusion: string
    source: string
  } | null
  contrast: {
    confusable_with: string
    trigger: string
    distinction: string
    source: string
  } | null
  review_target: {
    durable_candidate: boolean
    retrieval_target: string | null
    why: string
    note: string
  }
  self_audit: {
    no_empty_filler_fields: boolean
    sense_selected_not_dumped: boolean
    answer_not_leaked_into_target: boolean
    examples_within_unknown_budget: boolean
    omissions: string[]
  }
}

export interface EnrichmentRecord {
  id: number
  queueItemId: number
  model: string | null
  promptVersion: string
  output: EnrichmentOutput | null
  status: "ok" | "error"
  error: string | null
  elapsedMs: number | null
  createdAt: string
  labels: EnrichmentLabel[]
}

export interface EnrichmentLabelInput {
  field: string
  verdict: "keep" | "cut" | "edit"
  edited?: string
  note?: string
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<{ id: number }> {
  return fetchJson<{ id: number }>("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
}

export async function getFeedback(limit?: number): Promise<FeedbackEvent[]> {
  return fetchJson<FeedbackEvent[]>(withLimit("/api/feedback", limit))
}

export async function postUiEvents(events: UiEventInput[]): Promise<{ count: number }> {
  return fetchJson<{ count: number }>("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  })
}

export async function getUiEvents(limit?: number, kind?: string): Promise<UiEvent[]> {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set("limit", String(limit))
  if (kind) params.set("kind", kind)
  const suffix = params.toString()
  return fetchJson<UiEvent[]>(suffix ? `/api/events?${suffix}` : "/api/events")
}

export async function getPipelineStats(): Promise<PipelineStats> {
  return fetchJson<PipelineStats>("/api/pipeline/stats")
}

export async function simulateReview(grades: ReviewGrade[]): Promise<ReviewSimulationResult> {
  return fetchJson<ReviewSimulationResult>("/api/review/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grades }),
  })
}

export async function getReviewEvents(limit?: number): Promise<ReviewEvent[]> {
  return fetchJson<ReviewEvent[]>(withLimit("/api/review/events", limit))
}

export async function runEnrichment(queueItemId: number): Promise<{ enrichment: EnrichmentRecord }> {
  return fetchJson<{ enrichment: EnrichmentRecord }>(`/api/enrich/${queueItemId}`, { method: "POST" })
}

export async function getEnrichments(queueItemId?: number): Promise<EnrichmentRecord[]> {
  const path = queueItemId === undefined ? "/api/enrichments" : `/api/enrichments?queueItemId=${queueItemId}`
  return fetchJson<EnrichmentRecord[]>(path)
}

export async function addEnrichmentLabel(id: number, input: EnrichmentLabelInput): Promise<{ id: number }> {
  return fetchJson<{ id: number }>(`/api/enrichments/${id}/labels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
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
