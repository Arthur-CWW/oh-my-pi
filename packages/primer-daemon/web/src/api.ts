import { createSseParser } from "@/lib/sse"

export type EvidenceSource = "browser" | "twitter" | "reader" | "cards"
export type CardStatus = "candidate" | "approved" | "rejected"
export type CardListStatus = CardStatus | "enrolled" | "all"

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
  enrolled?: boolean
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

export type ReviewFeedKind = "proof" | "demo" | "note" | "decision" | "question" | "progress"
export type ReviewArtifactMedia = "audio" | "video" | "image" | "markdown" | "text" | "json" | "embed"

export interface ReviewFeedArtifact {
  label: string
  path?: string
  url?: string
  media: ReviewArtifactMedia
}

export interface ReviewFeedAction {
  label: string
  cwd?: string
  command: string
  argv?: string[]
}

export interface ReviewFeedLink {
  label: string
  href: string
}

export interface ReviewFeedEntry {
  schema: "xanadu-feed.v1"
  id: string
  ts: string
  stream: string
  kind: ReviewFeedKind
  title: string
  summary: string
  artifacts: ReviewFeedArtifact[]
  actions: ReviewFeedAction[]
  links: ReviewFeedLink[]
  needsInput: boolean
  tags: string[]
  parentId?: string
}

export interface ReviewFeedResponse {
  entries: ReviewFeedEntry[]
  pendingCount: number
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
export type ReviewFailReason = "decode" | "slow" | "forgot"
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
  failReason: ReviewFailReason | null
  eventTime: string
}

export interface GradeReviewResult {
  queueItemId: number
  itemKind: "queue_item" | "card_candidate"
  itemId: number
  eventId: number
  due: string
  state: string
  reps: number
}


export interface CreateMarkResult {
  markId: number
  queueItem: QueueItem
}

export type ExposureSource = "read" | "media"

export interface ExposureEventInput {
  docId: number
  paragraphIdx: number
  word: string
  source: ExposureSource
}

export interface ExposureStats {
  count: number
}


export async function getStatus(): Promise<DashboardStatus> {
  return fetchJson<DashboardStatus>("/api/status")
}

export async function getReviewFeed(): Promise<ReviewFeedResponse> {
  return fetchJson<ReviewFeedResponse>("/api/review-feed")
}

export async function answerReviewFeedEntry(id: string, summary: string): Promise<ReviewFeedEntry> {
  return fetchJson<ReviewFeedEntry>(`/api/review-feed/${encodeURIComponent(id)}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary }),
  })
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

export async function getCardCandidates(status: CardListStatus = "all", limit = 500): Promise<Card[]> {
  const params = new URLSearchParams({ status, limit: String(limit) })
  return fetchJson<Card[]>(`/api/cards?${params}`)
}

export async function enrollCardCandidate(cardId: number): Promise<{ itemId: number; state: string; due: string }> {
  return fetchJson<{ itemId: number; state: string; due: string }>("/api/review/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId }),
  })
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

export async function gradeReview(
  queueItemId: number,
  grade: ReviewGrade,
  failReason?: ReviewFailReason,
): Promise<GradeReviewResult> {
  return fetchJson<GradeReviewResult>("/api/review/grade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(failReason === undefined ? { queueItemId, grade } : { queueItemId, grade, failReason }),
  })
}

export async function setReviewEventReason(eventId: number, failReason: ReviewFailReason): Promise<void> {
  await fetchJson<{ eventId: number; failReason: ReviewFailReason }>(`/api/review/events/${eventId}/reason`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ failReason }),
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


export async function postExposureEvents(events: ExposureEventInput[]): Promise<{ count: number }> {
  return fetchJson<{ count: number }>("/api/exposure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  })
}

export async function getExposureStats(): Promise<ExposureStats> {
  return fetchJson<ExposureStats>("/api/exposure/stats")
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

// ---------------------------------------------------------------------------
// Tabs / Browser Context API
//
// Wire contract for the daemon-backed browser-context review surface. The
// daemon is the single authority: it reclassifies every tab, owns the writable
// SQLite connection, and owns selection state (review batches are addressed by
// an opaque token, never reconstructed client-side). Excluded tabs never carry
// url/title/query/body — only identity, protection flags, and a reason.
// ---------------------------------------------------------------------------

export type TabScope = "live" | "historical"

/** Why a tab is protected from automatic close (present on eligible + excluded). */
export type TabProtection = "pinned" | "active" | "audible" | "sensitive" | "uncertain" | "incognito"

export interface TabIdentity {
  /** Stable daemon-side identifier, durable across the live/historical split. */
  tabId: string
  browser: string
  profile: string
  windowId: string
  /** Position within its window; drives deterministic ordering + restore. */
  index: number
}

/** A remote, non-sensitive tab the daemon is willing to expose and act on. */
export interface EligibleTab {
  eligible: true
  identity: TabIdentity
  url: string
  /** Canonicalized dedup key under the tested policy; null when not computed. */
  canonicalUrl: string | null
  title: string
  domain: string
  active: boolean
  pinned: boolean
  audible: boolean
  incognito: boolean
  discarded: boolean
  openerTabId: string | null
  groupId: string | null
  container: string | null
  lastActiveAt: string | null
  /** Shared by exact duplicates; null when the tab is unique. */
  duplicateGroupId: string | null
  /** The deterministically selected keeper within its duplicate group. */
  isRepresentative: boolean
  /** Non-empty when the tab may not be auto-closed (pinned/active/…). */
  protections: TabProtection[]
}

/**
 * A sensitivity/loopback/auth/file/excluded-domain tab. Carries only enough to
 * preserve it from actions — never title, url, query, body, or extracted data.
 */
export interface ExcludedTab {
  eligible: false
  identity: TabIdentity
  /** Classification: "sensitive" | "loopback" | "auth" | "file" | "excluded-domain" | … */
  reason: string
  protections: TabProtection[]
}

export type Tab = EligibleTab | ExcludedTab

export const isEligibleTab = (tab: Tab): tab is EligibleTab => tab.eligible

export interface TabListResponse {
  scope: TabScope
  tabs: Tab[]
  eligibleCount: number
  excludedCount: number
  duplicateGroups: number
  generatedAt: string
}

export interface TabImageHandle {
  /** artifact:// handle resolved lazily; never inline base64. */
  artifact: string
  mime: string
  hash: string
  width: number | null
  height: number | null
}

export type TabReadStatus = "ready" | "queued" | "shaping" | "metadata-only" | "unavailable"

export interface TabReadResponse {
  tabId: string
  title: string
  url: string
  canonicalUrl: string | null
  status: TabReadStatus
  parser: string | null
  parserVersion: string | null
  contentHash: string | null
  extractedAt: string | null
  wordCount: number | null
  /** Metadata-safe text preview; null until extracted. */
  excerpt: string | null
  /** artifact:// handle for the full extracted text; null until ready. */
  artifact: string | null
  images: TabImageHandle[]
}

/**
 * A daemon-side selection. The UI holds only the opaque token + last-known
 * membership/revision; every add/remove round-trips so the daemon stays the
 * source of truth and mutations can be revalidated against `revision`.
 */
export interface ReviewBatch {
  token: string
  scope: TabScope
  tabIds: string[]
  revision: number
  createdAt: string
}

export type TabAction = "keep" | "read-later" | "archive" | "close-duplicate" | "exclude-domain"

export type TabActionOutcome =
  | "keep"
  | "close"
  | "archive"
  | "enqueue"
  | "exclude"
  | "skip-protected"
  | "unchanged"

export interface TabActionPreviewTab {
  tabId: string
  title: string | null
  url: string | null
  domain: string | null
  outcome: TabActionOutcome
  /** e.g. "representative kept", "duplicate of <rep>", "protected: pinned". */
  note: string | null
}

/** Where the pre-mutation state can be recovered from after a destructive action. */
export interface RestorePoint {
  kind: "snapshot" | "manifest"
  id: string
  label: string
  restoresTabs: number
  /** Null on a preview (not yet written); concrete after commit. */
  createdAt: string | null
}

export interface TabActionPreview {
  token: string
  /** Batch revision this preview was computed against — echoed on commit. */
  revision: number
  /** Opaque revalidation handle; commit is rejected if the batch changed. */
  previewId: string
  action: TabAction
  /** Exact human-readable rule (canonicalization policy, exclusion scope, …). */
  rule: string
  /** Machine id of the applied policy, e.g. "exact-canonical-v1". */
  ruleId: string
  /** Present for destructive actions; null when nothing is destroyed. */
  restorePoint: RestorePoint | null
  tabs: TabActionPreviewTab[]
  affectedCount: number
  protectedCount: number
  /** True → committing issues a browser command. */
  mutating: boolean
  warnings: string[]
}

export interface TabActionReceiptTab {
  tabId: string
  /** "pending" until a durable browser command result is recorded for this tab. */
  status: "ok" | "error" | "skipped" | "pending"
  error: string | null
}

export interface TabActionReceipt {
  commandId: string
  action: TabAction
  ruleId: string
  /** Concrete restore point (with id + createdAt) for destructive actions. */
  restorePoint: RestorePoint | null
  tabs: TabActionReceiptTab[]
  /** Durably succeeded so far — excludes still-pending browser commands. */
  succeeded: number
  /** Durably failed (extension rejected the command or returned an error). */
  failed: number
  /** Dispatched browser commands still awaiting a durable result; 0 once settled. */
  pending: number
  committedAt: string
}

export interface TabSnapshotSummary {
  snapshotId: string
  label: string
  createdAt: string
  tabCount: number
  kind: "manual" | "archive" | "auto"
}

export type TabDiffChange = "added" | "removed" | "moved" | "unchanged"

export interface TabSnapshotDiffEntry {
  tabId: string
  title: string | null
  url: string | null
  domain: string | null
  change: TabDiffChange
}

export interface TabSnapshotDiff {
  a: TabSnapshotSummary
  b: TabSnapshotSummary
  entries: TabSnapshotDiffEntry[]
  added: number
  removed: number
  moved: number
}

export interface TabArchiveEntry {
  restoreId: string
  label: string
  kind: "snapshot" | "manifest"
  createdAt: string
  tabCount: number
  /** Origin of the restore point: "close-duplicate" | "archive" | "manual-snapshot" | … */
  reason: string
}

export interface TabRestoreReceipt {
  /** Stable command correlation used to read durable restore outcomes. */
  commandId: string
  /** Restore point selected by the user; retained after the command settles. */
  restoreId: string
  /** Tabs with a durable successful browser result. */
  restored: number
  /** Tabs whose browser command has not recorded a durable result yet. */
  pending: number
  /** Tabs with a durable failed browser result. */
  failed: number
  restoredAt: string
  tabs: Array<{
    tabId: string
    status: "ok" | "error" | "pending"
    error: string | null
  }>
}

export type TabRestoreOutcome = "restore" | "skip"

export interface TabRestorePreviewTab {
  tabId: string
  title: string | null
  url: string | null
  domain: string | null
  outcome: TabRestoreOutcome
  note: string | null
}

export interface TabRestorePreview {
  restoreId: string
  /** Opaque revalidation handle; commit is rejected if the archive changed. */
  previewId: string
  label: string
  /** Origin: "close-duplicate" | "archive" | "manual-snapshot" | … */
  reason: string
  ruleId: string
  /** Exact human-readable restore rule (source + placement policy). */
  rule: string
  tabs: TabRestorePreviewTab[]
  willRestore: number
  /** Snapshot of the current set written before restore, so restore is itself reversible. */
  preRestorePoint: RestorePoint | null
  warnings: string[]
}

export type TabQueueReadiness =
  | "captured"
  | "shaping"
  | "ready"
  | "running"
  | "review"
  | "done"
  | "deferred"

export type TabQueuePriority = "now" | "next" | "later"

export interface TabQueueEntry {
  id: string
  tabId: string | null
  /** Null when the queued item references a no-content/excluded tab. */
  title: string | null
  url: string | null
  readiness: TabQueueReadiness
  priority: TabQueuePriority
  attempts: number
  parser: string | null
  updatedAt: string
  error: string | null
}

export interface TabQueueResponse {
  entries: TabQueueEntry[]
  running: number
  concurrency: number
  /** True while background extraction is paused (e.g. Low Power Mode). */
  paused: boolean
}

export interface TabErrorEntry {
  id: string
  scope: string
  message: string
  tabId: string | null
  createdAt: string
  resolved: boolean
}

/** Error carrying the HTTP status so the UI can react to revalidation (409). */
export class TabsRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "TabsRequestError"
    this.status = status
  }
}

async function requestTabs<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("x-primer-csrf", "1")
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" })
  if (!response.ok) {
    let detail = `Request failed with ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === "string" && body.error.length > 0) detail = body.error
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new TabsRequestError(response.status, detail)
  }
  return (await response.json()) as T
}

function postTabs<T>(path: string, body?: unknown): Promise<T> {
  return requestTabs<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export async function getTabs(scope: TabScope, limit = 500): Promise<TabListResponse> {
  const params = new URLSearchParams({ scope, limit: String(limit) })
  return requestTabs<TabListResponse>(`/api/tabs?${params}`)
}

export async function searchTabs(query: string, scope: TabScope, limit = 500): Promise<TabListResponse> {
  const params = new URLSearchParams({ q: query, scope, limit: String(limit) })
  return requestTabs<TabListResponse>(`/api/tabs/search?${params}`)
}

export async function readTab(tabId: string, signal?: AbortSignal): Promise<TabReadResponse> {
  return requestTabs<TabReadResponse>(`/api/tabs/${encodeURIComponent(tabId)}/read`, signal ? { signal } : undefined)
}

export async function createTabReviewBatch(scope: TabScope, tabIds: string[]): Promise<ReviewBatch> {
  return postTabs<ReviewBatch>("/api/tabs/review-batch", { scope, tabIds })
}

export async function updateTabReviewBatch(
  token: string,
  change: { add?: string[]; remove?: string[]; clear?: boolean },
): Promise<ReviewBatch> {
  return postTabs<ReviewBatch>(`/api/tabs/review-batch/${encodeURIComponent(token)}/select`, change)
}

export async function discardTabReviewBatch(token: string): Promise<void> {
  await requestTabs<{ ok: true }>(`/api/tabs/review-batch/${encodeURIComponent(token)}`, { method: "DELETE" })
}

export async function previewTabAction(token: string, action: TabAction): Promise<TabActionPreview> {
  return postTabs<TabActionPreview>(`/api/tabs/review-batch/${encodeURIComponent(token)}/preview`, { action })
}

export async function commitTabAction(
  token: string,
  previewId: string,
  action: TabAction,
): Promise<TabActionReceipt> {
  return postTabs<TabActionReceipt>(`/api/tabs/review-batch/${encodeURIComponent(token)}/commit`, {
    previewId,
    action,
  })
}

/**
 * Fetch the durable per-tab command-result state for a committed action. Poll
 * this after `commitTabAction` while the receipt has `pending > 0`: the daemon
 * reports every dispatched browser command as pending until its exact result is
 * recorded, so the UI shows success/failure only once results exist.
 */
export async function getTabAction(commandId: string): Promise<TabActionReceipt> {
  return requestTabs<TabActionReceipt>(`/api/tabs/actions/${encodeURIComponent(commandId)}`)
}

export async function getTabSnapshots(): Promise<TabSnapshotSummary[]> {
  return requestTabs<TabSnapshotSummary[]>("/api/tabs/snapshots")
}

export async function createTabSnapshot(label?: string): Promise<TabSnapshotSummary> {
  return postTabs<TabSnapshotSummary>("/api/tabs/snapshots", label === undefined ? {} : { label })
}

export async function diffTabSnapshots(a: string, b: string): Promise<TabSnapshotDiff> {
  const params = new URLSearchParams({ a, b })
  return requestTabs<TabSnapshotDiff>(`/api/tabs/diff?${params}`)
}

export async function getTabArchive(): Promise<TabArchiveEntry[]> {
  return requestTabs<TabArchiveEntry[]>("/api/tabs/archive")
}

export async function previewTabRestore(restoreId: string): Promise<TabRestorePreview> {
  const params = new URLSearchParams({ restoreId })
  return requestTabs<TabRestorePreview>(`/api/tabs/restore/preview?${params}`)
}

export async function commitTabRestore(restoreId: string, previewId: string): Promise<TabRestoreReceipt> {
  return postTabs<TabRestoreReceipt>("/api/tabs/restore", { restoreId, previewId })
}

/** Poll a restore command until its durable per-tab results have settled. */
export async function getTabRestoreAction(commandId: string): Promise<TabRestoreReceipt> {
  return requestTabs<TabRestoreReceipt>(`/api/tabs/actions/${encodeURIComponent(commandId)}`)
}

export async function getTabQueue(): Promise<TabQueueResponse> {
  return requestTabs<TabQueueResponse>("/api/tabs/queue")
}

export async function cancelTabQueueEntry(id: string): Promise<TabQueueEntry> {
  return postTabs<TabQueueEntry>(`/api/tabs/queue/${encodeURIComponent(id)}/cancel`)
}

export async function retryTabQueueEntry(id: string): Promise<TabQueueEntry> {
  return postTabs<TabQueueEntry>(`/api/tabs/queue/${encodeURIComponent(id)}/retry`)
}

export async function getTabErrors(limit = 50): Promise<TabErrorEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  return requestTabs<TabErrorEntry[]>(`/api/tabs/errors?${params}`)
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
