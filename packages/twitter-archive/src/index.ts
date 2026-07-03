import type {
  ArchiveCaptureSource,
  ArchiveMedia,
  ArchiveTweet,
  ArchiveTweetTimelineProvenance,
  ArchiveUser,
} from "./schema"
import type {
  SqliteArchiveJob,
  SqliteArchiveJobStatus,
  SqliteArchiveJobTargetType,
  SqliteJsonRecord,
  SqliteJsonValue,
} from "./sqlite-store"

export const REFERENCE_PROFILE_ARCHIVE_SCHEMA_VERSION = "twitter-reference-profile-archive/v1" as const

export type ReferenceProfileArchiveSchemaVersion = typeof REFERENCE_PROFILE_ARCHIVE_SCHEMA_VERSION

export type ReferenceProfileMechanicKind =
  | "pose-timing"
  | "gesture-rhythm"
  | "shot-structure"
  | "edit-cadence"
  | "hook-template"
  | "caption-layout"
  | "cta-pattern"
  | "posting-strategy"

export interface ReferenceProfileMechanicEvidence {
  readonly tweetId: ArchiveTweet["id"]
  readonly mediaId?: ArchiveMedia["id"]
  readonly timelineProvenance?: ArchiveTweetTimelineProvenance
  readonly note?: string
}

export interface ReferenceProfileMechanic {
  readonly kind: ReferenceProfileMechanicKind
  readonly summary: string
  readonly evidence: readonly ReferenceProfileMechanicEvidence[]
  readonly confidence?: number
}

export interface ReferenceProfileArchiveExport {
  readonly schemaVersion: ReferenceProfileArchiveSchemaVersion
  readonly source: "twitter-archive"
  readonly profile: ArchiveUser
  readonly sampledTweetIds: readonly ArchiveTweet["id"][]
  readonly sampledMediaIds?: readonly ArchiveMedia["id"][]
  readonly sourceLane?: string
  readonly sourceUrl?: string
  readonly capturedAt?: string
  readonly captureSource?: ArchiveCaptureSource
  readonly mechanics: readonly ReferenceProfileMechanic[]
  readonly preserve: readonly ReferenceProfileMechanicKind[]
  readonly swap: readonly string[]
  readonly blocked: readonly string[]
}

export const TWITTER_ARCHIVE_ARTIFACT_CANDIDATE_SOURCE = "artifact-extraction-candidate" as const

export type TwitterArchiveArtifactCandidateSource = typeof TWITTER_ARCHIVE_ARTIFACT_CANDIDATE_SOURCE

export interface TwitterArchiveArtifactCandidateQueueProvenance {
  readonly source: TwitterArchiveArtifactCandidateSource
  readonly artifactExtractionCandidateId?: string
  readonly promotionReason?: string
}

export interface TwitterArchiveArtifactCandidateQueueStatus {
  readonly sourceLane: SqliteArchiveJob["sourceLane"]
  readonly targetType: Extract<SqliteArchiveJobTargetType, "profile" | "status" | "search">
  readonly targetValue: SqliteArchiveJob["targetValue"]
  readonly status: SqliteArchiveJobStatus
  readonly priority: SqliteArchiveJob["priority"]
  readonly attempts: SqliteArchiveJob["attempts"]
  readonly createdAt: SqliteArchiveJob["createdAt"]
  readonly claimedAt?: SqliteArchiveJob["claimedAt"]
  readonly finishedAt?: SqliteArchiveJob["finishedAt"]
  readonly provenance: TwitterArchiveArtifactCandidateQueueProvenance
}

export function toTwitterArchiveArtifactCandidateQueueStatus(
  job: SqliteArchiveJob,
): TwitterArchiveArtifactCandidateQueueStatus | undefined {
  if (job.targetType !== "profile" && job.targetType !== "status" && job.targetType !== "search") {
    return undefined
  }
  const provenance = readArtifactCandidateQueueProvenance(job.provenance)
  if (!provenance) {
    return undefined
  }
  return {
    sourceLane: job.sourceLane,
    targetType: job.targetType,
    targetValue: job.targetValue,
    status: job.status,
    priority: job.priority,
    attempts: job.attempts,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt,
    finishedAt: job.finishedAt,
    provenance,
  }
}

function readArtifactCandidateQueueProvenance(
  value: SqliteArchiveJob["provenance"],
): TwitterArchiveArtifactCandidateQueueProvenance | undefined {
  const record = sqliteJsonRecord(value)
  const nestedCandidate = sqliteJsonRecord(record?.candidate)
  const nestedProvenance = sqliteJsonRecord(nestedCandidate?.provenance)
  const sourceRecord =
    record?.source === TWITTER_ARCHIVE_ARTIFACT_CANDIDATE_SOURCE
      ? record
      : nestedCandidate?.source === TWITTER_ARCHIVE_ARTIFACT_CANDIDATE_SOURCE
        ? nestedCandidate
        : nestedProvenance?.source === TWITTER_ARCHIVE_ARTIFACT_CANDIDATE_SOURCE
          ? nestedProvenance
          : undefined
  if (!sourceRecord) {
    return undefined
  }
  return {
    source: TWITTER_ARCHIVE_ARTIFACT_CANDIDATE_SOURCE,
    artifactExtractionCandidateId: sqliteJsonString(sourceRecord.artifactExtractionCandidateId),
    promotionReason: sqliteJsonString(sourceRecord.promotionReason),
  }
}

function sqliteJsonRecord(value: SqliteJsonValue | undefined): SqliteJsonRecord | undefined {
  return isSqliteJsonRecord(value) ? value : undefined
}

function isSqliteJsonRecord(value: SqliteJsonValue | undefined): value is SqliteJsonRecord {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
}

function sqliteJsonString(value: SqliteJsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export * from "./schema"
export * from "./paths"
export * from "./jsonl"
export * from "./jsonl-log"
export * from "./normalize"
export * from "./runs"
export * from "./search-query"
export * from "./provider-log"
export * from "./import-legacy-sqlite"
export * from "./capture-types"
export * from "./capture-policy"
export * from "./capture-queue"
export * from "./capture-classifier"
export * from "./capture-extractor"
export * from "./sqlite-store"
export * from "./sqlite-schema"
export * from "./effect-services"
export * from "./nitter"
export * from "./following-graph"
export * from "./nitter-search"
export * from "./wayback-import"
export * from "./media-download"
export * from "./browser-bookmarks"
export * from "./browser-history-queue"
export * from "./archive-job-worker"
export * from "./backfill-worker"
export * from "./queued-backfill-worker"
export * from "./dev-ui-server"
export * from "./dev-ui-markdown"
