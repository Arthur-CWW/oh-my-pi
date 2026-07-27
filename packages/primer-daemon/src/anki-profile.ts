import { readFileSync } from "node:fs"
import { Schema } from "effect"

import type { DaemonPaths } from "./paths"

const NonNegativeInteger = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)

const ReviewedCardSchema = Schema.Struct({
  word: Schema.String,
  starred: Schema.Boolean,
})

const ReviewedSnapshotSchema = Schema.Struct({
  schema: Schema.Literal("primer-anki-reviewed.v1"),
  snapshot_at: Schema.String,
  query: Schema.String,
  reviewed_count: NonNegativeInteger,
  review_event_count: NonNegativeInteger,
  starred_count: NonNegativeInteger,
  cards: Schema.Array(ReviewedCardSchema),
})

const ReviewedSnapshotJsonSchema = Schema.fromJsonString(ReviewedSnapshotSchema)

export interface AnkiProfile {
  readonly snapshotAt: string | null
  readonly query: string | null
  readonly cardCount: number
  readonly reviewEventCount: number
  readonly starredCount: number
  readonly words: readonly string[]
}

const EMPTY_ANKI_PROFILE: AnkiProfile = {
  snapshotAt: null,
  query: null,
  cardCount: 0,
  reviewEventCount: 0,
  starredCount: 0,
  words: [],
}

export function readAnkiProfile(path: string): AnkiProfile {
  let source: string
  try {
    source = readFileSync(path, "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) return EMPTY_ANKI_PROFILE
    throw error
  }

  const snapshot = Schema.decodeUnknownSync(ReviewedSnapshotJsonSchema)(source)
  const words = [...new Set(snapshot.cards.map((card) => card.word.trim()).filter((word) => word.length > 0))].sort()

  return {
    snapshotAt: snapshot.snapshot_at,
    query: snapshot.query,
    cardCount: snapshot.reviewed_count,
    reviewEventCount: snapshot.review_event_count,
    starredCount: snapshot.starred_count,
    words,
  }
}

export function listPrimerKnownWords(
  paths: Pick<DaemonPaths, "ankiProfile">,
): { words: string[] } {
  return { words: [...readAnkiProfile(paths.ankiProfile).words] }
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
