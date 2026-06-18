import type { DevUiMediaView, DevUiQuotedTweetView, DevUiTweetGroupView, DevUiTweetView } from "./dev-ui-server"

type MarkdownQuotedTweet = Partial<DevUiQuotedTweetView> & {
  readonly media?: readonly DevUiMediaView[]
}

type MarkdownTweet = DevUiTweetView & {
  readonly quotedTweet?: MarkdownQuotedTweet
}

type MarkdownTweetGroup = Omit<DevUiTweetGroupView, "tweets"> & {
  readonly tweets: readonly MarkdownTweet[]
}

export function buildTweetGroupMarkdown(group: MarkdownTweetGroup): string {
  const lines: string[] = [
    `# ${group.title || "Tweet group"}`,
    "",
    `- Group: ${group.groupId}`,
    `- Kind: ${group.kind}`,
    `- Tweets: ${group.tweets.length}`,
    `- Latest: ${group.latestAt || "unknown"}`,
  ]

  for (const tweet of group.tweets) {
    lines.push("", `## ${tweetAuthor(tweet)}`, "", `- Author: ${tweetAuthor(tweet)} (${tweet.authorId})`, `- Tweet ID: ${tweet.id}`, `- URL: ${tweet.url}`)
    if (tweet.createdAt) lines.push(`- Created: ${tweet.createdAt}`)
    lines.push(`- Captured: ${tweet.capturedAt}`)
    if (tweet.source) lines.push(`- Source: ${tweet.source}`)
    lines.push(`- Metrics: ${formatMetrics(tweet.publicMetrics)}`)
    if (tweet.annotation.bookmarked || tweet.annotation.attributed || tweet.annotation.note) {
      lines.push(`- Local annotations: ${formatAnnotations(tweet)}`)
    }
    if (tweet.inReplyToTweetId) lines.push(`- Replying to: ${tweet.inReplyToTweetId}`)
    lines.push("", tweet.text.trim().length > 0 ? tweet.text : "[no text]")

    if (tweet.media.length > 0) {
      lines.push("", "Media:")
      for (const media of tweet.media) {
        lines.push(`- ${formatMedia(media)}`)
      }
    }

    const quoteLines = formatQuote(tweet)
    if (quoteLines.length > 0) {
      lines.push("", "Quote:", ...quoteLines)
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`
}

function tweetAuthor(tweet: Pick<DevUiTweetView, "username" | "authorId">): string {
  return tweet.username ? `@${tweet.username}` : tweet.authorId
}

function formatMetrics(metrics: DevUiTweetView["publicMetrics"]): string {
  return [
    `replies ${metrics?.replies ?? 0}`,
    `reposts ${metrics?.reposts ?? 0}`,
    `likes ${metrics?.likes ?? 0}`,
    `quotes ${metrics?.quotes ?? 0}`,
    `views ${metrics?.views ?? 0}`,
  ].join(" · ")
}

function formatAnnotations(tweet: DevUiTweetView): string {
  const annotations: string[] = []
  if (tweet.annotation.bookmarked) annotations.push("local bookmark")
  if (tweet.annotation.attributed) annotations.push("archive attribute")
  if (tweet.annotation.note) annotations.push(`note: ${tweet.annotation.note}`)
  return annotations.join("; ")
}

function formatMedia(media: DevUiMediaView): string {
  const parts: string[] = [media.type]
  if (media.localPath) parts.push(`local ${media.localPath}`)
  if (media.remoteUrl) parts.push(`remote ${media.remoteUrl}`)
  if (media.previewUrl) parts.push(`preview ${media.previewUrl}`)
  if (media.altText) parts.push(`alt ${media.altText}`)
  return parts.join("; ")
}

function formatQuote(tweet: MarkdownTweet): readonly string[] {
  if (tweet.quotedTweet) {
    const quote = tweet.quotedTweet
    const quoteAuthor = quote.username ? `@${quote.username}` : quote.displayName ?? quote.id ?? "quoted tweet"
    const lines = [`- Author: ${quote.displayName && quote.username ? `${quote.displayName} (${quoteAuthor})` : quoteAuthor}`]
    if (quote.url) lines.push(`- URL: ${quote.url}`)
    if (quote.createdAt) lines.push(`- Created: ${quote.createdAt}`)
    if (quote.capturedAt) lines.push(`- Captured: ${quote.capturedAt}`)
    if (quote.source) lines.push(`- Source: ${quote.source}`)
    lines.push(`- Metrics: ${formatMetrics(quote.publicMetrics)}`)
    if (quote.text) lines.push("", quote.text)
    if (quote.media && quote.media.length > 0) {
      lines.push("", "Quoted media:")
      for (const media of quote.media) lines.push(`- ${formatMedia(media)}`)
    }
    return lines
  }

  if (!tweet.quotedTweetId && !tweet.quotedTweetUrl) return []
  const lines: string[] = []
  if (tweet.quotedTweetId) lines.push(`- Tweet ID: ${tweet.quotedTweetId}`)
  if (tweet.quotedTweetUrl) lines.push(`- URL: ${tweet.quotedTweetUrl}`)
  return lines
}
