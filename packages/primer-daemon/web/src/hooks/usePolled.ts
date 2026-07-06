import { useCallback, useEffect, useRef, useState } from "react"

export interface Polled<T> {
  data: T | null
  error: string | null
  loading: boolean
  refetch: () => void
}

/**
 * Fetch on mount, keep the last good value on error, and optionally re-poll on
 * an interval. `loading` only reports the very first fetch — subsequent polls
 * refresh in place with no flicker.
 */
export function usePolled<T>(fetcher: () => Promise<T>, intervalMs: number | null = null): Polled<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const alive = useRef(true)

  const run = useCallback(() => {
    fetcherRef.current().then(
      (next) => {
        if (!alive.current) return
        setData(next)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (!alive.current) return
        setError(cause instanceof Error ? cause.message : "Request failed")
        setLoading(false)
      },
    )
  }, [])

  useEffect(() => {
    alive.current = true
    run()
    if (intervalMs === null) {
      return () => {
        alive.current = false
      }
    }
    const id = window.setInterval(run, intervalMs)
    return () => {
      alive.current = false
      window.clearInterval(id)
    }
  }, [run, intervalMs])

  return { data, error, loading, refetch: run }
}
