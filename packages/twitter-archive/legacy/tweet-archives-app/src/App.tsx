import { useEffect, useState } from 'react'
import Tweet from './components/Tweet'
import type { Tweet as TweetType } from './types'

function App() {
  const [tweets, setTweets] = useState<TweetType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTweets()
  }, [])

  const fetchTweets = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/tweets')
      const data = await response.json()
      setTweets(data)
    } catch (error) {
      console.error('Error fetching tweets:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-xl">Loading tweets...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto border-x border-border min-h-screen">
        {/* Header */}
        <header className="sticky top-0 bg-background/80 backdrop-blur-sm border-b border-border p-4">
          <h1 className="text-xl font-bold text-foreground">GCRClassic Archive</h1>
          <p className="text-muted-foreground text-sm">{tweets.length} tweets</p>
        </header>

        {/* Tweet List */}
        <main className="space-y-4 p-4">
          {tweets.map((tweet) => (
            <Tweet key={tweet.tweet_id} tweet={tweet} />
          ))}
        </main>
      </div>
    </div>
  )
}

export default App