import type { ReactNode } from 'react'
import type { QuoteTweet, ResolvedUrl, Tweet as TweetType } from '../types'

interface TweetProps {
  tweet: TweetType
}

const tcoPattern = /https:\/\/t\.co\/[A-Za-z0-9]+/g

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function formatCount(count: number | null | undefined) {
  if (typeof count !== 'number') {
    return null
  }

  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M'
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K'
  }
  return count.toString()
}

function renderTweetText(text: string, urls: ResolvedUrl[]): ReactNode {
  if (!urls?.length) {
    return text
  }

  const elements: ReactNode[] = []
  let lastIndex = 0
  const matches = [...text.matchAll(tcoPattern)]

  matches.forEach((match, index) => {
    const matchText = match[0]
    const start = match.index ?? 0
    const end = start + matchText.length

    if (lastIndex < start) {
      elements.push(text.slice(lastIndex, start))
    }

    const resolved = urls.find((item) => item.occurrence === index) || urls.find((item) => item.short === matchText)
    const href = resolved?.expanded ?? matchText
    const label = resolved?.display ?? matchText

    elements.push(
      <a
        key={`${matchText}-${start}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        className="text-blue-400 hover:underline break-all"
      >
        {label}
      </a>
    )

    lastIndex = end
  })

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex))
  }

  return elements
}

function QuoteCard({ quote }: { quote: QuoteTweet }) {
  const reply = formatCount(quote.reply_count)
  const retweets = formatCount(quote.retweet_count)
  const favorites = formatCount(quote.favorite_count)

  return (
    <div className="rounded-xl border border-gray-800 bg-black/30">
      <div className="p-3 space-y-3">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-gray-600 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 text-sm text-gray-500">
              <span className="font-semibold text-white">{quote.author_name}</span>
              <span>{quote.author_handle}</span>
              {quote.created_at && (
                <>
                  <span>·</span>
                  <span>{formatDate(quote.created_at)}</span>
                </>
              )}
            </div>
            {quote.text ? (
              <p className="text-white text-sm leading-normal whitespace-pre-wrap">
                {renderTweetText(quote.text, quote.resolved_urls)}
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                {quote.unavailable_reason ?? 'Quoted tweet is unavailable.'}
              </p>
            )}
          </div>
        </div>

        {quote.media_urls && (
          <div className="rounded-2xl overflow-hidden">
            <img
              src={quote.media_urls}
              alt="Quoted tweet media"
              className="max-w-full h-auto"
              loading="lazy"
            />
          </div>
        )}

        {(reply || retweets || favorites) && (
          <div className="flex items-center space-x-4 text-xs text-gray-500">
            {reply && (
              <div className="flex items-center space-x-1">
                <span>💬</span>
                <span>{reply}</span>
              </div>
            )}
            {retweets && (
              <div className="flex items-center space-x-1">
                <span>🔄</span>
                <span>{retweets}</span>
              </div>
            )}
            {favorites && (
              <div className="flex items-center space-x-1">
                <span>❤️</span>
                <span>{favorites}</span>
              </div>
            )}
          </div>
        )}

        {quote.in_archive && quote.jump_to_id && (
          <div className="text-xs">
            <a
              href={`#${quote.jump_to_id}`}
              className="text-blue-400 hover:underline"
            >
              View quoted tweet in archive
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function Tweet({ tweet }: TweetProps) {
  const getTwitterUrl = () => {
    return `https://twitter.com/GCRClassic/status/${tweet.tweet_id}`
  }

  return (
    <div
      id={`t-${tweet.tweet_id}`}
      className="border-b border-gray-800 p-4 hover:bg-gray-900 transition-colors"
    >
      {/* Tweet Header */}
      <div className="flex items-start space-x-3 mb-2">
        {/* Avatar */}
        <div className="w-12 h-12 bg-gray-600 rounded-full flex-shrink-0"></div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-bold text-white">GCRClassic</span>
            <span className="text-gray-500">@GCRClassic</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-500">{formatDate(tweet.created_at)}</span>
          </div>
          
          {/* Tweet Type Indicator */}
          {tweet.type !== 'Tweet' && (
            <div className="text-gray-500 text-sm mb-2">
              {tweet.type === 'Reply' ? 'Replied to' : 'Retweeted'}
            </div>
          )}
        </div>
      </div>

      {/* Tweet Content */}
      <div className="mb-3">
        <p className="text-white text-[15px] leading-normal whitespace-pre-wrap">
          {renderTweetText(tweet.text, tweet.resolved_urls)}
        </p>
      </div>

      {tweet.quote_tweet && (
        <div className="mb-3">
          <QuoteCard quote={tweet.quote_tweet} />
        </div>
      )}

      {/* Media */}
      {tweet.media_urls && (
        <div className="mb-3 rounded-2xl overflow-hidden">
          <img 
            src={tweet.media_urls} 
            alt="Tweet media"
            className="max-w-full h-auto"
          />
        </div>
      )}

      {/* Engagement Metrics */}
      <div className="flex justify-between text-gray-500 text-sm">
        <div className="flex items-center space-x-4">
          <button className="flex items-center space-x-1 hover:text-blue-400 transition-colors">
            <span>💬</span>
            <span>{formatCount(tweet.reply_count) ?? tweet.reply_count}</span>
          </button>
          <button className="flex items-center space-x-1 hover:text-green-400 transition-colors">
            <span>🔄</span>
            <span>{formatCount(tweet.retweet_count) ?? tweet.retweet_count}</span>
          </button>
          <button className="flex items-center space-x-1 hover:text-red-400 transition-colors">
            <span>❤️</span>
            <span>{formatCount(tweet.favorite_count) ?? tweet.favorite_count}</span>
          </button>
          <button className="flex items-center space-x-1 hover:text-blue-400 transition-colors">
            <span>🔖</span>
            <span>{formatCount(tweet.bookmark_count) ?? tweet.bookmark_count}</span>
          </button>
        </div>
        
        {/* Views */}
        <div className="flex items-center space-x-1">
          <span>👁️</span>
          <span>{formatCount(tweet.view_count) ?? tweet.view_count}</span>
        </div>
      </div>

      {/* Original Tweet Link */}
      <div className="mt-2 pt-2 border-t border-gray-800">
        <a 
          href={getTwitterUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 text-sm hover:underline"
        >
          View original tweet
        </a>
      </div>
    </div>
  )
}

export default Tweet
