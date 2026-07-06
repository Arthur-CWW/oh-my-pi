import { useCallback, useSyncExternalStore } from "react"

// ---------------------------------------------------------------------------
// Route types
// ---------------------------------------------------------------------------

export type Route =
  | { view: "dashboard" }
  | { view: "library" }
  | { view: "reader"; docId: number; markId: number | null }
  | { view: "review" }
  | { view: "shadow" }

// ---------------------------------------------------------------------------
// Parse / navigate
// ---------------------------------------------------------------------------

function parseHash(hash: string): Route {
  const h = hash.startsWith("#") ? hash.slice(1) : hash

  if (h === "/read" || h === "/read/") return { view: "library" }

  const readerMatch = /^\/read\/(\d+)/.exec(h)
  if (readerMatch) {
    const docId = Number(readerMatch[1])
    const markParam = /[?&]mark=(\d+)/.exec(h)
    return { view: "reader", docId, markId: markParam ? Number(markParam[1]) : null }
  }

  if (h === "/review" || h === "/review/") return { view: "review" }
  if (h === "/shadow" || h === "/shadow/") return { view: "shadow" }

  return { view: "dashboard" }
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path}`
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function getSnapshot(): string {
  return window.location.hash
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("hashchange", cb)
  return () => window.removeEventListener("hashchange", cb)
}

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot)
  return parseHash(hash)
}

/** Build a reader URL with optional mark anchor. */
export function readerUrl(docId: number, markId?: number): string {
  return markId != null ? `#/read/${docId}?mark=${markId}` : `#/read/${docId}`
}
