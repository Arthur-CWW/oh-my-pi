export type TweetKind = 'Tweet' | 'Reply' | 'Retweet'

export interface ResolvedUrl {
  short: string
  expanded: string
  display: string
  occurrence: number
}

export interface QuoteTweet {
  tweet_id: string
  text: string | null
  created_at: string | null
  type: TweetKind | null
  bookmark_count: number | null
  favorite_count: number | null
  retweet_count: number | null
  reply_count: number | null
  view_count: number | null
  media_type: string | null
  media_urls: string | null
  resolved_urls: ResolvedUrl[]
  in_archive: boolean
  author_name: string
  author_handle: string
  jump_to_id?: string
  unavailable_reason?: string
}

export interface Tweet {
  tweet_id: string
  text: string
  language: string
  type: TweetKind
  bookmark_count: number
  favorite_count: number
  retweet_count: number
  reply_count: number
  view_count: number
  created_at: string
  client: string
  hashtags: string | null
  urls: string | null
  media_type: string | null
  media_urls: string | null
  resolved_urls: ResolvedUrl[]
  quote_tweet?: QuoteTweet
  archive_state: string
  archive_updated_at: string | null
  archive_snapshot_path: string | null
  archive_source: string | null
  archive_error: string | null
}
