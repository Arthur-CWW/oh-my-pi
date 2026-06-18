export type ArchiveCaptureSource = "frontend" | "api" | "tool" | "manual" | "unknown"

export type ArchiveMediaType = "image" | "video" | "gif" | "unknown"

export type ArchiveRunStatus = "planned" | "running" | "completed" | "partial" | "failed" | "aborted"

export type ArchiveTweetFilter = "media" | "videos" | "images" | "replies" | "quotes"

export interface ArchiveScope {
  tweets: boolean
  replies: boolean
  quotes: boolean
  media: boolean
  /** Hard safety invariant for this project: do not archive likes/bookmarks. */
  excludeLikesBookmarks: true
}

export interface ArchiveUser {
  id: string
  username: string
  displayName?: string
  avatarUrl?: string
  profileUrl?: string
  description?: string
  verified?: boolean
  protected?: boolean
  capturedAt?: string
}

export interface ArchiveMediaVariant {
  url: string
  contentType?: string
  bitrate?: number
}

export interface ArchiveMedia {
  id: string
  tweetId: string
  type: ArchiveMediaType
  remoteUrl?: string
  localPath?: string
  previewImageUrl?: string
  altText?: string
  width?: number
  height?: number
  durationMs?: number
  variants?: ArchiveMediaVariant[]
  capturedAt?: string
  source?: ArchiveCaptureSource
}

export interface ArchivePublicMetrics {
  replies?: number
  reposts?: number
  likes?: number
  quotes?: number
  views?: number
}

export interface ArchiveTweet {
  id: string
  authorId: string
  username?: string
  url: string
  text: string
  createdAt?: string
  conversationId?: string
  inReplyToTweetId?: string
  inReplyToUserId?: string
  replyToUsername?: string
  quotedTweetId?: string
  quotedTweetUrl?: string
  mediaIds: string[]
  language?: string
  publicMetrics?: ArchivePublicMetrics
  capturedAt: string
  source?: ArchiveCaptureSource
}

export interface ArchiveTweetTimelineProvenance {
  tweetId: string
  sourceLane?: string
  observedAt: string
  retweetedByUsername?: string
  retweetedByDisplayName?: string
  detailUrl?: string
}

export interface ArchiveConversation {
  id: string
  rootTweetId?: string
  tweetIds: string[]
  capturedAt: string
  source?: ArchiveCaptureSource
}

export interface ArchiveRunError {
  message: string
  code?: string
  at?: string
  url?: string
}

export interface ArchiveRun {
  id: string
  target: string
  query?: string
  scope: ArchiveScope
  source: ArchiveCaptureSource
  tool?: string
  status: ArchiveRunStatus
  startedAt: string
  finishedAt?: string
  tweetIds: string[]
  userIds: string[]
  mediaIds: string[]
  errors?: ArchiveRunError[]
}

export interface ArchiveLabel {
  id: string
  entityType: "tweet" | "media" | "conversation" | "user"
  entityId: string
  label: string
  createdAt: string
  note?: string
}

export interface ArchiveNote {
  id: string
  entityType: "tweet" | "media" | "conversation" | "user"
  entityId: string
  text: string
  createdAt: string
  updatedAt?: string
}

export interface ArchiveSnapshot {
  users: ArchiveUser[]
  tweets: ArchiveTweet[]
  media: ArchiveMedia[]
  conversations: ArchiveConversation[]
  runs: ArchiveRun[]
  labels?: ArchiveLabel[]
  notes?: ArchiveNote[]
}

export interface ArchiveSearchQuery {
  from?: string
  to?: string
  since?: string
  until?: string
  filters: ArchiveTweetFilter[]
  terms: string[]
  phrases: string[]
  labels: string[]
  categories: string[]
  hasNote?: boolean
}

export type ArchiveEntityName =
  | "users"
  | "tweets"
  | "media"
  | "conversations"
  | "archiveRuns"
  | "labels"
  | "notes"

export const ENTITY_FILE_NAMES: Record<ArchiveEntityName, string> = {
  users: "users.jsonl",
  tweets: "tweets.jsonl",
  media: "media.jsonl",
  conversations: "conversations.jsonl",
  archiveRuns: "archive-runs.jsonl",
  labels: "labels.jsonl",
  notes: "notes.jsonl",
}

export const DEFAULT_ARCHIVE_SCOPE: ArchiveScope = Object.freeze({
  tweets: true,
  replies: true,
  quotes: true,
  media: true,
  excludeLikesBookmarks: true,
})

export function createArchiveScope(overrides: Partial<Omit<ArchiveScope, "excludeLikesBookmarks">> = {}): ArchiveScope {
  return {
    ...DEFAULT_ARCHIVE_SCOPE,
    ...overrides,
    excludeLikesBookmarks: true,
  }
}
