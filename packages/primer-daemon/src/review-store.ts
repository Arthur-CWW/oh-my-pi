import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { createEmptyCard, fsrs, Rating, State, type CardInput, type Grade } from "ts-fsrs"

import { ensureReadingTables, type QueueProvenance } from "./reading-store"
import { CardStatusSchema } from "./ledger"

export type ReviewGrade = "again" | "hard" | "good" | "easy"
export type ReviewPhase = "due" | "new"
export type ReviewItemKind = "queue_item" | "card_candidate"

export interface ReviewSessionExplain {
  slot: number
  reasons: string[]
}

export interface ReviewSessionItem {
  // Card candidates reuse queueItemId as the stable item-id field for compatibility.
  queueItemId: number
  itemKind: ReviewItemKind
  word: string
  pinyin: string | null
  gloss: string | null
  front?: string
  back?: string
  phase: ReviewPhase
  due: string | null
  priority: number
  provenance: QueueProvenance | null
  explain?: ReviewSessionExplain
}

export interface ReviewSessionOptions {
  explain?: boolean
}

export interface ReviewSimulationStep {
  grade: ReviewGrade
  due: string
  intervalDays: number
  stability: number
  difficulty: number
}
export interface ReviewEvent {
  id: number
  itemKind: ReviewItemKind
  itemId: number
  label: string
  grade: ReviewGrade
  eventTime: string
}

type ReviewSessionCandidate = ReviewSessionItem & { createdAt: string }

export interface GradeReviewResult {
  // Card candidates reuse queueItemId as the stable item-id field for compatibility.
  queueItemId: number
  itemKind: ReviewItemKind
  itemId: number
  due: string
  state: string
  reps: number
}

export interface ReviewState {
  id: number
  itemKind: ReviewItemKind
  itemId: number
  due: string
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: ReviewStateName
  lastReview: string | null
  scheduledDays: number
  learningSteps: number
  stateVersion: number
}

export interface ReviewDueCounts {
  dueNow: number
  newAvailable: number
  enrolledCards: number
}

export class CardCandidateNotFoundError extends Error {
  constructor(cardId: number) {
    super(`card ${cardId} not found`)
    this.name = "CardCandidateNotFoundError"
  }
}

export class CardCandidateNotApprovedError extends Error {
  constructor(cardId: number) {
    super(`card ${cardId} is not approved`)
    this.name = "CardCandidateNotApprovedError"
  }
}

const REVIEW_ITEM_KIND = "queue_item" as const
const CARD_ITEM_KIND = "card_candidate" as const
const DEFAULT_REVIEW_LIMIT = 20
const DAY_MS = 86_400_000
const FiniteNumber = Schema.Number.check(Schema.isFinite())
const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const NullableString = Schema.NullOr(Schema.String)
const ReviewItemKindSchema = Schema.Union([Schema.Literal(REVIEW_ITEM_KIND), Schema.Literal(CARD_ITEM_KIND)])
const ReviewGradeSchema = Schema.Union([
  Schema.Literal("again"),
  Schema.Literal("hard"),
  Schema.Literal("good"),
  Schema.Literal("easy"),
])
const ReviewStateNameSchema = Schema.Union([
  Schema.Literal("New"),
  Schema.Literal("Learning"),
  Schema.Literal("Review"),
  Schema.Literal("Relearning"),
])
const QueueStatusSchema = Schema.Union([
  Schema.Literal("new"),
  Schema.Literal("keep"),
  Schema.Literal("discarded"),
  Schema.Literal("known"),
])

const RawReviewStateRowSchema = Schema.Struct({
  id: PositiveInteger,
  item_kind: ReviewItemKindSchema,
  item_id: PositiveInteger,
  due: Schema.String,
  stability: FiniteNumber,
  difficulty: FiniteNumber,
  reps: NonNegativeInteger,
  lapses: NonNegativeInteger,
  state: ReviewStateNameSchema,
  last_review: NullableString,
  scheduled_days: NonNegativeInteger,
  learning_steps: NonNegativeInteger,
  state_version: NonNegativeInteger,
})
type RawReviewStateRow = Schema.Schema.Type<typeof RawReviewStateRowSchema>

const RawQueueStatusRowSchema = Schema.Struct({
  id: PositiveInteger,
  status: QueueStatusSchema,
})
type RawQueueStatusRow = Schema.Schema.Type<typeof RawQueueStatusRowSchema>

const RawCardCandidateRowSchema = Schema.Struct({
  id: PositiveInteger,
  front: Schema.String,
  back: Schema.String,
  status: CardStatusSchema,
  created_at: Schema.String,
})
type RawCardCandidateRow = Schema.Schema.Type<typeof RawCardCandidateRowSchema>

const RawReviewQueueRowSchema = Schema.Struct({
  queue_item_id: PositiveInteger,
  word: Schema.String,
  pinyin: NullableString,
  gloss: NullableString,
  status: QueueStatusSchema,
  priority: NonNegativeInteger,
  created_at: Schema.String,
  due: NullableString,
  doc_id: Schema.NullOr(PositiveInteger),
  doc_title: NullableString,
  mark_id: Schema.NullOr(PositiveInteger),
  paragraph_idx: Schema.NullOr(NonNegativeInteger),
  start: Schema.NullOr(NonNegativeInteger),
  end: Schema.NullOr(NonNegativeInteger),
  sentence: NullableString,
})
type RawReviewQueueRow = Schema.Schema.Type<typeof RawReviewQueueRowSchema>

const RawReviewCardRowSchema = Schema.Struct({
  card_id: PositiveInteger,
  front: Schema.String,
  back: Schema.String,
  status: CardStatusSchema,
  created_at: Schema.String,
  due: Schema.String,
})
type RawReviewCardRow = Schema.Schema.Type<typeof RawReviewCardRowSchema>
const RawReviewEventRowSchema = Schema.Struct({
  id: PositiveInteger,
  item_kind: ReviewItemKindSchema,
  item_id: PositiveInteger,
  label: Schema.String,
  grade: ReviewGradeSchema,
  event_time: Schema.String,
})
type RawReviewEventRow = Schema.Schema.Type<typeof RawReviewEventRowSchema>

const CountRowSchema = Schema.Struct({ count: NonNegativeInteger })
type CountRow = Schema.Schema.Type<typeof CountRowSchema>
const RawTableNameRowSchema = Schema.Struct({ name: Schema.String })
type RawTableNameRow = Schema.Schema.Type<typeof RawTableNameRowSchema>


type NoRows = Record<string, never>
type ReviewStateName = Schema.Schema.Type<typeof ReviewStateNameSchema>

const reviewScheduler = fsrs({ enable_fuzz: false })


export function enrollCardCandidate(db: Database, cardId: number): ReviewState
export function enrollCardCandidate(db: Database, ledgerDb: Database | undefined, cardId: number): ReviewState
export function enrollCardCandidate(
  db: Database,
  ledgerDbOrCardId: Database | number | undefined,
  cardIdMaybe?: number,
): ReviewState {
  const ledgerDb = typeof ledgerDbOrCardId === "number" || ledgerDbOrCardId === undefined ? db : ledgerDbOrCardId
  const requestedCardId = typeof ledgerDbOrCardId === "number" ? ledgerDbOrCardId : cardIdMaybe
  if (requestedCardId === undefined) throw new TypeError("card id is required")
  const cardId = Schema.decodeUnknownSync(PositiveInteger)(requestedCardId)
  const candidateRow = ledgerDb
    .query<RawCardCandidateRow, [number]>(
      "SELECT id, front, back, status, created_at FROM card_candidates WHERE id = ?",
    )
    .get(cardId)
  if (candidateRow === null) throw new CardCandidateNotFoundError(cardId)
  const candidate = Schema.decodeUnknownSync(RawCardCandidateRowSchema)(candidateRow)
  if (candidate.status !== "approved") throw new CardCandidateNotApprovedError(cardId)

  ensureReadingTables(db)
  const now = new Date(nowIso())
  const initialCard = createEmptyCard(now)
  return db.transaction((itemId: number) => {
    db.query<NoRows, [
      string,
      number,
      string,
      number,
      number,
      number,
      number,
      string,
      string | null,
      number,
      number,
      number,
    ]>(
      `INSERT INTO review_state
         (item_kind, item_id, due, stability, difficulty, reps, lapses, state, last_review,
          scheduled_days, learning_steps, state_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_kind, item_id) DO NOTHING`,
    ).run(
      CARD_ITEM_KIND,
      itemId,
      initialCard.due.toISOString(),
      initialCard.stability,
      initialCard.difficulty,
      initialCard.reps,
      initialCard.lapses,
      stateName(initialCard.state),
      initialCard.last_review?.toISOString() ?? null,
      initialCard.scheduled_days,
      initialCard.learning_steps,
      0,
    )
    const stateRow = db
      .query<RawReviewStateRow, [string, number]>(
        `SELECT id, item_kind, item_id, due, stability, difficulty, reps, lapses, state,
                last_review, scheduled_days, learning_steps, state_version
         FROM review_state
         WHERE item_kind = ? AND item_id = ?`,
      )
      .get(CARD_ITEM_KIND, itemId)
    if (stateRow === null) throw new Error("enrolled card state could not be loaded")
    return toReviewState(stateRow)
  })(cardId)
}

export function buildReviewSession(
  db: Database,
  limit = DEFAULT_REVIEW_LIMIT,
  options: ReviewSessionOptions = {},
): ReviewSessionItem[] {
  ensureReadingTables(db)
  const normalizedLimit = normalizeReviewLimit(limit)
  const now = new Date(nowIso())
  const queueDueItems = db
    .query<RawReviewQueueRow, [string]>(
      `${reviewQueueSelectSql()}
       WHERE qi.status NOT IN ('known', 'discarded')
         AND rs.item_id IS NOT NULL
         AND datetime(rs.due) <= datetime(?)
       ORDER BY datetime(rs.due) ASC, qi.id ASC`,
    )
    .all(now.toISOString())
    .map((row) => decodeReviewQueueRow(row, "due"))
  const cardDueItems = hasTable(db, "card_candidates")
    ? db
        .query<RawReviewCardRow, [string]>(
          `${reviewCardSelectSql()}
           WHERE cc.status = 'approved'
             AND datetime(rs.due) <= datetime(?)
           ORDER BY datetime(rs.due) ASC, cc.id ASC`,
        )
        .all(now.toISOString())
        .map((row) => decodeReviewCardRow(row, "due"))
    : []
  const dueItems = [...queueDueItems, ...cardDueItems].sort(compareReviewDueItems)
  const newItems = db
    .query<RawReviewQueueRow, []>(
      `${reviewQueueSelectSql()}
       WHERE qi.status NOT IN ('known', 'discarded')
         AND rs.item_id IS NULL
       ORDER BY qi.priority DESC, datetime(qi.created_at) ASC, qi.id ASC`,
    )
    .all()
    .map((row) => decodeReviewQueueRow(row, "new"))

  return interleaveReviewItems(dueItems, newItems, normalizedLimit, options.explain === true, now).map(
    ({ createdAt: _createdAt, ...item }) => item,
  )
}

export function simulateReview(grades: readonly ReviewGrade[]): ReviewSimulationStep[] {
  const initialReviewAt = new Date(nowIso())
  let reviewAt = initialReviewAt
  let card = createEmptyCard(initialReviewAt)
  const steps: ReviewSimulationStep[] = []
  for (const grade of grades) {
    const normalizedGrade = normalizeReviewGrade(grade)
    const nextCard = reviewScheduler.next(card, reviewAt, normalizedGrade).card
    steps.push({
      grade: reviewGradeName(normalizedGrade),
      due: nextCard.due.toISOString(),
      intervalDays: Math.max(0, (nextCard.due.getTime() - reviewAt.getTime()) / DAY_MS),
      stability: nextCard.stability,
      difficulty: nextCard.difficulty,
    })
    card = nextCard
    reviewAt = nextCard.due
  }
  return steps
}

export interface ReviewItemReference {
  itemKind: ReviewItemKind
  itemId: number
}

export function gradeReviewItem(
  db: Database,
  itemId: number,
  rating: Rating | ReviewGrade,
  itemKind?: ReviewItemKind,
): GradeReviewResult | null
export function gradeReviewItem(
  db: Database,
  item: ReviewItemReference,
  rating: Rating | ReviewGrade,
): GradeReviewResult | null
export function gradeReviewItem(
  db: Database,
  itemOrId: number | ReviewItemReference,
  rating: Rating | ReviewGrade,
  itemKindArg?: ReviewItemKind,
): GradeReviewResult | null {
  ensureReadingTables(db)
  const item: ReviewItemReference =
    typeof itemOrId === "number"
      ? { itemKind: itemKindArg ?? REVIEW_ITEM_KIND, itemId: itemOrId }
      : itemOrId
  const itemId = Schema.decodeUnknownSync(PositiveInteger)(item.itemId)
  const itemKind = Schema.decodeUnknownSync(ReviewItemKindSchema)(item.itemKind)
  const grade = normalizeReviewGrade(rating)
  return db.transaction((reference: ReviewItemReference, selectedGrade: Grade) => {
    let queueItem: RawQueueStatusRow | null = null
    if (reference.itemKind === REVIEW_ITEM_KIND) {
      const queueRow = db.query<RawQueueStatusRow, [number]>("SELECT id, status FROM queue_items WHERE id = ?").get(reference.itemId)
      if (queueRow === null) return null
      queueItem = Schema.decodeUnknownSync(RawQueueStatusRowSchema)(queueRow)
    } else {
      if (!hasTable(db, "card_candidates")) return null
      const candidateRow = db
        .query<RawCardCandidateRow, [number]>(
          "SELECT id, front, back, status, created_at FROM card_candidates WHERE id = ?",
        )
        .get(reference.itemId)
      if (candidateRow === null) return null
      const candidate = Schema.decodeUnknownSync(RawCardCandidateRowSchema)(candidateRow)
      if (candidate.status !== "approved") return null
    }

    const priorRow = db
      .query<RawReviewStateRow, [string, number]>(
        `SELECT id, item_kind, item_id, due, stability, difficulty, reps, lapses, state,
                last_review, scheduled_days, learning_steps, state_version
         FROM review_state
         WHERE item_kind = ? AND item_id = ?`,
      )
      .get(reference.itemKind, reference.itemId)
    const priorState = priorRow === null ? null : decodeReviewStateRow(priorRow)
    if (reference.itemKind === CARD_ITEM_KIND && priorState === null) return null
    const now = new Date(nowIso())
    const card = priorState === null ? createEmptyCard(now) : cardFromReviewState(priorState, now)
    const nextCard = reviewScheduler.next(card, now, selectedGrade).card
    const priorStateVersion = priorState?.state_version ?? 0
    const derivedStateVersion = priorStateVersion + 1
    const nextState = stateName(nextCard.state)
    const due = nextCard.due.toISOString()
    const lastReview = nextCard.last_review?.toISOString() ?? null

    db.query<NoRows, [
      string,
      number,
      string,
      number,
      number,
      number,
      number,
      string,
      string | null,
      number,
      number,
      number,
    ]>(
      `INSERT INTO review_state
         (item_kind, item_id, due, stability, difficulty, reps, lapses, state, last_review,
          scheduled_days, learning_steps, state_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_kind, item_id) DO UPDATE SET
         due = excluded.due,
         stability = excluded.stability,
         difficulty = excluded.difficulty,
         reps = excluded.reps,
         lapses = excluded.lapses,
         state = excluded.state,
         last_review = excluded.last_review,
         scheduled_days = excluded.scheduled_days,
         state_version = excluded.state_version`,
    ).run(
      reference.itemKind,
      reference.itemId,
      due,
      nextCard.stability,
      nextCard.difficulty,
      nextCard.reps,
      nextCard.lapses,
      nextState,
      lastReview,
      nextCard.scheduled_days,
      nextCard.learning_steps,
      derivedStateVersion,
    )
    const eventTime = now.toISOString()
    db.query<NoRows, [string, number, string, string, number, number]>(
      `INSERT INTO review_events
         (item_kind, item_id, event_time, grade, prior_state_version, derived_state_version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(reference.itemKind, reference.itemId, eventTime, reviewGradeName(selectedGrade), priorStateVersion, derivedStateVersion)
    if (queueItem?.status === "new") {
      db.query<NoRows, [string, number]>("UPDATE queue_items SET status = 'keep', updated_at = ? WHERE id = ?").run(
        eventTime,
        reference.itemId,
      )
    }
    return {
      queueItemId: reference.itemId,
      itemKind: reference.itemKind,
      itemId: reference.itemId,
      due,
      state: nextState,
      reps: nextCard.reps,
    }
  })( { itemKind, itemId }, grade)
}
export function listReviewEvents(db: Database, limit = 20): ReviewEvent[] {
  ensureReadingTables(db)
  const normalizedLimit = normalizeReviewLimit(limit)
  const cardJoin = hasTable(db, "card_candidates")
    ? "LEFT JOIN card_candidates cc ON cc.id = re.item_id AND re.item_kind = 'card_candidate'"
    : ""
  const labelExpression = hasTable(db, "card_candidates")
    ? "COALESCE(qi.word, cc.front, re.item_kind || ' #' || re.item_id)"
    : "COALESCE(qi.word, re.item_kind || ' #' || re.item_id)"
  const rows = db
    .query<RawReviewEventRow, [number]>(
      `SELECT re.id,
              re.item_kind,
              re.item_id,
              ${labelExpression} AS label,
              re.grade,
              re.event_time
       FROM review_events re
       LEFT JOIN queue_items qi ON qi.id = re.item_id AND re.item_kind = 'queue_item'
       ${cardJoin}
       ORDER BY re.id DESC
       LIMIT ?`,
    )
    .all(normalizedLimit)
  return rows.map((row) => {
    const event = Schema.decodeUnknownSync(RawReviewEventRowSchema)(row)
    return {
      id: event.id,
      itemKind: event.item_kind,
      itemId: event.item_id,
      label: event.label,
      grade: event.grade,
      eventTime: event.event_time,
    }
  })
}

export function getReviewDueCounts(db: Database): ReviewDueCounts {
  ensureReadingTables(db)
  const now = nowIso()
  const dueQueue = countRows(
    db
      .query<CountRow, [string]>(
        `SELECT COUNT(*) AS count
         FROM queue_items qi
         JOIN review_state rs ON rs.item_kind = 'queue_item' AND rs.item_id = qi.id
         WHERE qi.status NOT IN ('known', 'discarded') AND datetime(rs.due) <= datetime(?)`,
      )
      .get(now),
  )
  const newQueue = countRows(
    db
      .query<CountRow, []>(
        `SELECT COUNT(*) AS count
         FROM queue_items qi
         LEFT JOIN review_state rs ON rs.item_kind = 'queue_item' AND rs.item_id = qi.id
         WHERE qi.status NOT IN ('known', 'discarded') AND rs.item_id IS NULL`,
      )
      .get(),
  )
  const dueCards = hasTable(db, "card_candidates")
    ? countRows(
        db
          .query<CountRow, [string]>(
            `SELECT COUNT(*) AS count
             FROM card_candidates cc
             JOIN review_state rs ON rs.item_kind = 'card_candidate' AND rs.item_id = cc.id
             WHERE cc.status = 'approved' AND datetime(rs.due) <= datetime(?)`,
          )
          .get(now),
      )
    : 0
  const newCards = hasTable(db, "card_candidates")
    ? countRows(
        db
          .query<CountRow, []>(
            `SELECT COUNT(*) AS count
             FROM card_candidates cc
             LEFT JOIN review_state rs ON rs.item_kind = 'card_candidate' AND rs.item_id = cc.id
             WHERE cc.status = 'approved' AND rs.item_id IS NULL`,
          )
          .get(),
      )
    : 0
  const enrolledCards = hasTable(db, "card_candidates")
    ? countRows(
        db
          .query<CountRow, []>(
            `SELECT COUNT(*) AS count
             FROM card_candidates cc
             JOIN review_state rs ON rs.item_kind = 'card_candidate' AND rs.item_id = cc.id`,
          )
          .get(),
      )
    : 0
  return { dueNow: dueQueue + dueCards, newAvailable: newQueue + newCards, enrolledCards }
}

function normalizeReviewGrade(rating: Rating | ReviewGrade): Grade {
  if (typeof rating === "number") {
    if (rating === Rating.Again || rating === Rating.Hard || rating === Rating.Good || rating === Rating.Easy) return rating
    throw new Error("invalid review grade")
  }
  const decoded = Schema.decodeUnknownSync(ReviewGradeSchema)(rating)
  switch (decoded) {
    case "again":
      return Rating.Again
    case "hard":
      return Rating.Hard
    case "good":
      return Rating.Good
    case "easy":
      return Rating.Easy
  }
}

function reviewGradeName(rating: Grade): ReviewGrade {
  switch (rating) {
    case Rating.Again:
      return "again"
    case Rating.Hard:
      return "hard"
    case Rating.Good:
      return "good"
    case Rating.Easy:
      return "easy"
  }
}

function cardFromReviewState(state: RawReviewStateRow, now: Date): CardInput {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: elapsedDays(state.last_review, now),
    scheduled_days: state.scheduled_days,
    learning_steps: state.learning_steps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.last_review,
  }
}

function elapsedDays(lastReview: string | null, now: Date): number {
  if (lastReview === null) return 0
  const elapsed = (now.getTime() - new Date(lastReview).getTime()) / DAY_MS
  return elapsed > 0 ? elapsed : 0
}

function stateName(state: State): ReviewStateName {
  switch (state) {
    case State.New:
      return "New"
    case State.Learning:
      return "Learning"
    case State.Review:
      return "Review"
    case State.Relearning:
      return "Relearning"
  }
}

function decodeReviewStateRow(row: RawReviewStateRow): RawReviewStateRow {
  return Schema.decodeUnknownSync(RawReviewStateRowSchema)(row)
}
function toReviewState(row: RawReviewStateRow): ReviewState {
  const state = decodeReviewStateRow(row)
  return {
    id: state.id,
    itemKind: state.item_kind,
    itemId: state.item_id,
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    lastReview: state.last_review,
    scheduledDays: state.scheduled_days,
    learningSteps: state.learning_steps,
    stateVersion: state.state_version,
  }
}

function countRows(row: CountRow | null): number {
  if (row === null) throw new Error("review count could not be loaded")
  return Schema.decodeUnknownSync(CountRowSchema)(row).count
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .query<RawTableNameRow, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName)
  return row !== null && Schema.decodeUnknownSync(RawTableNameRowSchema)(row).name === tableName
}

function decodeReviewQueueRow(row: RawReviewQueueRow, phase: ReviewPhase): ReviewSessionCandidate {
  const item = Schema.decodeUnknownSync(RawReviewQueueRowSchema)(row)
  return {
    queueItemId: item.queue_item_id,
    itemKind: REVIEW_ITEM_KIND,
    word: item.word,
    pinyin: item.pinyin,
    gloss: item.gloss,
    phase,
    due: item.due,
    priority: item.priority,
    provenance: decodeProvenance(item),
    createdAt: item.created_at,
  }
}

function decodeReviewCardRow(row: RawReviewCardRow, phase: ReviewPhase): ReviewSessionCandidate {
  const item = Schema.decodeUnknownSync(RawReviewCardRowSchema)(row)
  return {
    queueItemId: item.card_id,
    itemKind: CARD_ITEM_KIND,
    word: item.front,
    pinyin: null,
    gloss: null,
    front: item.front,
    back: item.back,
    phase,
    due: item.due,
    priority: 0,
    provenance: null,
    createdAt: item.created_at,
  }
}
function decodeProvenance(item: RawReviewQueueRow): QueueProvenance | null {
  if (
    item.doc_id === null ||
    item.doc_title === null ||
    item.paragraph_idx === null ||
    item.start === null ||
    item.end === null ||
    item.sentence === null
  ) {
    return null
  }
  return {
    docId: item.doc_id,
    markId: item.mark_id,
    docTitle: item.doc_title,
    paragraphIdx: item.paragraph_idx,
    start: item.start,
    end: item.end,
    sentence: item.sentence,
  }
}

function interleaveReviewItems(
  dueItems: readonly ReviewSessionCandidate[],
  newItems: readonly ReviewSessionCandidate[],
  limit: number,
  explain: boolean,
  now: Date,
): ReviewSessionCandidate[] {
  const result: ReviewSessionCandidate[] = []
  let previous: ReviewSessionCandidate | null = null
  for (const phaseItems of [dueItems, newItems]) {
    const remaining = [...phaseItems]
    while (remaining.length > 0 && result.length < limit) {
      let selectedIndex = remaining.findIndex((item) => previous === null || !sharesGuardFamily(previous, item))
      if (selectedIndex < 0) selectedIndex = 0
      const selected = remaining.splice(selectedIndex, 1)[0]
      if (selected === undefined) break
      if (explain) {
        selected.explain = {
          slot: result.length + 1,
          reasons: explainReasons(selected, previous, remaining, selectedIndex, now),
        }
      }
      result.push(selected)
      previous = selected
    }
    if (result.length >= limit) break
  }
  return result
}

function explainReasons(
  item: ReviewSessionCandidate,
  previous: ReviewSessionCandidate | null,
  remaining: readonly ReviewSessionCandidate[],
  selectedIndex: number,
  now: Date,
): string[] {
  const reasons: string[] = []
  if (item.phase === "due") {
    reasons.push(`due · ${formatDueDelta(item.due, now)}`)
  } else {
    const jumped = remaining
      .slice(0, selectedIndex)
      .filter(
        (candidate) =>
          candidate.createdAt < item.createdAt ||
          (candidate.createdAt === item.createdAt && candidate.queueItemId < item.queueItemId),
      )
      .length
    reasons.push(`new · priority ${item.priority} — jumped ${jumped} item${jumped === 1 ? "" : "s"}`)
  }
  if (selectedIndex > 0 && previous !== null) {
    const displaced = remaining[0]
    const shared = displaced === undefined ? null : sharedHanCharacter(previous.word, displaced.word)
    if (shared !== null) {
      reasons.push(`shifted +${selectedIndex} · shares ${shared} with prev`)
    } else {
      reasons.push(`shifted +${selectedIndex} · separated from ${previous.word}`)
    }
  }
  return reasons
}

function formatDueDelta(due: string | null, now: Date): string {
  if (due === null) return "now"
  const deltaMs = now.getTime() - new Date(due).getTime()
  if (deltaMs < 0) return `in ${formatDuration(-deltaMs)}`
  if (deltaMs < 60_000) return "now"
  return `${formatDuration(deltaMs)} overdue`
}

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}


function sharesGuardFamily(left: ReviewSessionItem, right: ReviewSessionItem): boolean {
  if (left.itemKind !== REVIEW_ITEM_KIND || right.itemKind !== REVIEW_ITEM_KIND) return false
  if (left.word === right.word) return true
  const leftCharacters = new Set<string>()
  for (const character of left.word) {
    if (isHan(character)) leftCharacters.add(character)
  }
  for (const character of right.word) {
    if (leftCharacters.has(character)) return true
  }
  return false
}
function sharedHanCharacter(left: string, right: string): string | null {
  if (left === right) return left.slice(0, 1) || null
  const leftCharacters = new Set<string>()
  for (const character of left) {
    if (isHan(character)) leftCharacters.add(character)
  }
  for (const character of right) {
    if (leftCharacters.has(character)) return character
  }
  return null
}

function isHan(character: string): boolean {
  const codePoint = character.codePointAt(0)
  return codePoint !== undefined && ((codePoint >= 0x3400 && codePoint <= 0x4dbf) || (codePoint >= 0x4e00 && codePoint <= 0x9fff))
}
function compareReviewDueItems(left: ReviewSessionItem, right: ReviewSessionItem): number {
  const leftDue = left.due ?? ""
  const rightDue = right.due ?? ""
  const dueOrder = leftDue.localeCompare(rightDue)
  if (dueOrder !== 0) return dueOrder
  if (left.itemKind !== right.itemKind) return left.itemKind.localeCompare(right.itemKind)
  return left.queueItemId - right.queueItemId
}


function reviewCardSelectSql(): string {
  return `SELECT cc.id AS card_id,
                 cc.front,
                 cc.back,
                 cc.status,
                 cc.created_at,
                 rs.due
          FROM card_candidates cc
          JOIN review_state rs
            ON rs.item_kind = 'card_candidate' AND rs.item_id = cc.id`
}

function reviewQueueSelectSql(): string {
  return `SELECT qi.id AS queue_item_id,
                 qi.word,
                 qi.pinyin,
                 qi.gloss,
                 qi.status,
                 qi.priority,
                 qi.created_at,
                 qi.mark_id,
                 rs.due,
                 rd.id AS doc_id,
                 rd.title AS doc_title,
                 rm.paragraph_idx,
                 rm.start,
                 rm.end,
                 rm.sentence
          FROM queue_items qi
          LEFT JOIN review_state rs
            ON rs.item_kind = 'queue_item' AND rs.item_id = qi.id
          LEFT JOIN reading_marks rm ON rm.id = qi.mark_id
          LEFT JOIN reading_docs rd ON rd.id = rm.doc_id`
}

function normalizeReviewLimit(limit: number): number {
  return Number.isFinite(limit) && Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_REVIEW_LIMIT
}

function nowIso(): string {
  return new Date().toISOString()
}
