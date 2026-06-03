export interface ArchiveUser {
  id: string
  username: string
  displayName?: string
  avatarUrl?: string
  profileUrl?: string
}

export interface ArchiveMedia {
  id: string
  tweetId: string
  type: "image" | "video" | "gif" | "unknown"
  remoteUrl?: string
  localPath?: string
  altText?: string
  width?: number
  height?: number
  durationMs?: number
}

export interface ArchiveTweet {
  id: string
  authorId: string
  url: string
  text: string
  createdAt?: string
  conversationId?: string
  inReplyToTweetId?: string
  inReplyToUserId?: string
  quotedTweetId?: string
  mediaIds: string[]
  capturedAt: string
}

export interface ArchiveConversation {
  id: string
  rootTweetId?: string
  tweetIds: string[]
  capturedAt: string
}

export interface ArchiveRun {
  id: string
  target: string
  startedAt: string
  finishedAt?: string
  tweetIds: string[]
  userIds: string[]
  mediaIds: string[]
}

export interface ArchiveSnapshot {
  users: ArchiveUser[]
  tweets: ArchiveTweet[]
  media: ArchiveMedia[]
  conversations: ArchiveConversation[]
  runs: ArchiveRun[]
}
