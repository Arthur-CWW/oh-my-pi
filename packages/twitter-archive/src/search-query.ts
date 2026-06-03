import type { ArchiveMedia, ArchiveSearchQuery, ArchiveTweet, ArchiveTweetFilter } from "./schema"

const KNOWN_FILTERS = new Set<ArchiveTweetFilter>(["media", "videos", "images", "replies", "quotes"])

export function parseLocalSearchQuery(input: string): ArchiveSearchQuery {
  const query: ArchiveSearchQuery = {
    filters: [],
    terms: [],
    phrases: [],
    labels: [],
    categories: [],
  }

  for (const token of tokenize(input)) {
    const unquoted = unquote(token)
    const operator = parseOperator(unquoted)

    if (!operator) {
      if (isQuoted(token)) {
        query.phrases.push(unquoted)
      } else {
        query.terms.push(unquoted)
      }
      continue
    }

    const [key, value] = operator
    switch (key) {
      case "from":
        query.from = normalizeHandleValue(value)
        break
      case "to":
        query.to = normalizeHandleValue(value)
        break
      case "since":
        query.since = value
        break
      case "until":
        query.until = value
        break
      case "filter":
        if (KNOWN_FILTERS.has(value as ArchiveTweetFilter) && !query.filters.includes(value as ArchiveTweetFilter)) {
          query.filters.push(value as ArchiveTweetFilter)
        } else {
          query.terms.push(unquoted)
        }
        break
      case "label":
        query.labels.push(value)
        break
      case "category":
        query.categories.push(value)
        break
      case "has":
        if (value === "note") {
          query.hasNote = true
        } else {
          query.terms.push(unquoted)
        }
        break
      default:
        query.terms.push(unquoted)
        break
    }
  }

  return query
}

export function tweetMatchesSearch(
  tweet: ArchiveTweet,
  query: ArchiveSearchQuery,
  mediaById: ReadonlyMap<string, ArchiveMedia> = new Map(),
): boolean {
  const author = (tweet.username ?? tweet.authorId).toLowerCase()
  if (query.from && author !== query.from.toLowerCase()) {
    return false
  }

  const replyTarget = (tweet.replyToUsername ?? tweet.inReplyToUserId ?? "").toLowerCase()
  if (query.to && replyTarget !== query.to.toLowerCase()) {
    return false
  }

  if (query.since && tweet.createdAt && tweet.createdAt < query.since) {
    return false
  }

  if (query.until && tweet.createdAt && tweet.createdAt >= query.until) {
    return false
  }

  for (const filter of query.filters) {
    if (!matchesFilter(tweet, filter, mediaById)) {
      return false
    }
  }

  const text = tweet.text.toLowerCase()
  for (const term of query.terms) {
    if (!text.includes(term.toLowerCase())) {
      return false
    }
  }
  for (const phrase of query.phrases) {
    if (!text.includes(phrase.toLowerCase())) {
      return false
    }
  }

  return true
}

function matchesFilter(
  tweet: ArchiveTweet,
  filter: ArchiveTweetFilter,
  mediaById: ReadonlyMap<string, ArchiveMedia>,
): boolean {
  switch (filter) {
    case "media":
      return tweet.mediaIds.length > 0
    case "videos":
      return tweet.mediaIds.some((id) => mediaById.get(id)?.type === "video" || mediaById.get(id)?.type === "gif")
    case "images":
      return tweet.mediaIds.some((id) => mediaById.get(id)?.type === "image")
    case "replies":
      return tweet.inReplyToTweetId !== undefined || tweet.inReplyToUserId !== undefined
    case "quotes":
      return tweet.quotedTweetId !== undefined || tweet.quotedTweetUrl !== undefined
  }
}

function tokenize(input: string): string[] {
  return input.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? []
}

function isQuoted(token: string): boolean {
  return token.length >= 2 && token.startsWith('"') && token.endsWith('"')
}

function unquote(token: string): string {
  if (!isQuoted(token)) {
    return token
  }

  return token.slice(1, -1).replace(/\\"/g, '"')
}

function parseOperator(token: string): [string, string] | undefined {
  const separator = token.indexOf(":")
  if (separator <= 0) {
    return undefined
  }

  const key = token.slice(0, separator).toLowerCase()
  const value = token.slice(separator + 1)
  if (value.length === 0) {
    return undefined
  }

  return [key, value]
}

function normalizeHandleValue(value: string): string {
  return value.replace(/^@+/, "").toLowerCase()
}
