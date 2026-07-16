import { useCallback, useEffect, useRef, useState } from "react"
import type * as React from "react"

import {
  type QueueItem,
  type QueueStatus,
  type ReviewGrade,
  type ReviewSessionItem,
  type ReviewSessionMode,
  getQueue,
  getReviewSession,
  gradeReview,
  setQueueStatus,
} from "@/api"
import { navigate, readerUrl } from "@/hooks/useHashRoute"
import { logEvent } from "@/hooks/useTelemetry"
import { cn } from "@/lib/utils"
import { focusRing } from "./atoms"
import { Button } from "./ui/button"

// ---------------------------------------------------------------------------
// Status badge colors
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<QueueStatus, string> = {
  new: "bg-amber-500/15 text-amber-400",
  keep: "bg-emerald-500/15 text-emerald-400",
  discarded: "bg-rose-500/15 text-rose-400/80",
  known: "bg-sky-500/15 text-sky-400",
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const FILTERS: Array<{ key: QueueStatus | "all"; label: string }> = [
  { key: "new", label: "New" },
  { key: "keep", label: "Keep" },
  { key: "known", label: "Known" },
  { key: "discarded", label: "Discarded" },
  { key: "all", label: "All" },
]
const GRADE_OPTIONS: Array<{ grade: ReviewGrade; key: string; label: string; hint: string }> = [
  { grade: "again", key: "1", label: "Again", hint: "forgetting" },
  { grade: "hard", key: "2", label: "Hard", hint: "difficult" },
  { grade: "good", key: "3", label: "Good", hint: "remembered" },
  { grade: "easy", key: "4", label: "Easy", hint: "effortless" },
]

type ReviewMode = "triage" | "session"

const EMPTY_GRADE_COUNTS: Record<ReviewGrade, number> = {
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
}


// ---------------------------------------------------------------------------
// Queue row
// ---------------------------------------------------------------------------

function QueueRow({
  item,
  focused,
  onFocus,
  onStatus,
  onProvenance,
}: {
  item: QueueItem
  focused: boolean
  onFocus: () => void
  onStatus: (status: QueueStatus) => void
  onProvenance: () => void
}): React.JSX.Element {
  // Highlight the queued word inside its sentence context
  const sentenceHtml = (() => {
    if (!item.provenance?.sentence) return null
    const sentence = item.provenance.sentence
    const idx = sentence.indexOf(item.word)
    if (idx < 0) return sentence
    const before = sentence.slice(0, idx)
    const after = sentence.slice(idx + item.word.length)
    return (
      <>
        {before}
        <span className="font-medium text-foreground">{item.word}</span>
        {after}
      </>
    )
  })()

  return (
    <div
      data-vim-panel="queue"
      data-vim-index={item.id}
      onMouseEnter={onFocus}
      className={cn(focusRing(focused), "px-3 py-2.5")}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-medium">{item.word}</span>
        {item.pinyin && <span className="text-sm text-muted-foreground">{item.pinyin}</span>}
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", STATUS_STYLE[item.status])}>
          {item.status}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/50">
          {item.lookupCount}×
        </span>
      </div>

      {item.gloss && (
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{item.gloss}</p>
      )}

      {sentenceHtml && (
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground/80">{sentenceHtml}</p>
      )}

      {item.provenance?.docTitle && (
        <p className="mt-1 text-[11px] text-muted-foreground/50">{item.provenance.docTitle}</p>
      )}

      {/* action buttons — visible on focus */}
      <div className={cn("mt-2 flex items-center gap-1", focused ? "opacity-100" : "opacity-0")}>
        <Button variant="ghost" size="xs" onClick={() => onStatus("keep")} disabled={item.status === "keep"}>
          keep <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">s</kbd>
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onStatus("known")} disabled={item.status === "known"}>
          known <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">m</kbd>
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onStatus("discarded")} disabled={item.status === "discarded"}>
          discard <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">x</kbd>
        </Button>
        {item.provenance && (
          <Button variant="ghost" size="xs" onClick={onProvenance} className="ml-auto">
            source <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">o</kbd>
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReviewView
// ---------------------------------------------------------------------------

export function ReviewView({ onShowHelp }: { onShowHelp: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<ReviewMode>("triage")
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<QueueStatus | "all">("new")
  const [focusIdx, setFocusIdx] = useState(-1)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const [sessionItems, setSessionItems] = useState<ReviewSessionItem[] | null>(null)
  const [sessionMode, setSessionMode] = useState<ReviewSessionMode>("full")
  const [sessionIndex, setSessionIndex] = useState(0)
  const [sessionRevealed, setSessionRevealed] = useState(false)
  const [sessionCounts, setSessionCounts] = useState<Record<ReviewGrade, number>>(EMPTY_GRADE_COUNTS)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const sessionItemsRef = useRef(sessionItems)
  sessionItemsRef.current = sessionItems
  const sessionIndexRef = useRef(sessionIndex)
  sessionIndexRef.current = sessionIndex
  const sessionRevealedRef = useRef(sessionRevealed)
  sessionRevealedRef.current = sessionRevealed
  const sessionBusyRef = useRef(sessionBusy)
  sessionBusyRef.current = sessionBusy

  // Fetch queue
  useEffect(() => {
    let alive = true
    setItems(null)
    setError(null)
    setFocusIdx(-1)
    getQueue(filter === "all" ? "all" : filter, 200).then(
      (d) => { if (alive) setItems(d) },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Failed to load queue") },
    )
    return () => { alive = false }
  }, [filter])

  // Fetch a fresh review session when entering session mode or switching its mode.
  useEffect(() => {
    if (mode !== "session") return
    let alive = true
    setSessionItems(null)
    setSessionError(null)
    setSessionIndex(0)
    setSessionRevealed(false)
    setSessionCounts({ ...EMPTY_GRADE_COUNTS })
    getReviewSession(undefined, false, sessionMode).then(
      (d) => { if (alive) setSessionItems(d.items) },
      (e: unknown) => { if (alive) setSessionError(e instanceof Error ? e.message : "Failed to load review session") },
    )
    return () => { alive = false }
  }, [mode, sessionMode])

  // Optimistic status update (matching CardsPanel pattern)
  const handleStatus = useCallback(
    (idx: number, status: QueueStatus) => {
      const snapshot = itemsRef.current
      if (!snapshot) return
      const item = snapshot[idx]
      if (!item) return

      // Optimistic
      setItems(snapshot.map((it, i) => (i === idx ? { ...it, status } : it)))

      setQueueStatus(item.id, status).then(
        (updated) => {
          logEvent("triage_status", { queueItemId: updated.id, status: updated.status })
          setItems((prev) => (prev ? prev.map((it) => (it.id === updated.id ? updated : it)) : prev))
        },
        () => {
          // Revert
          setItems(snapshot)
        },
      )
    },
    [],
  )

  const handleProvenance = useCallback(
    (idx: number) => {
      const item = items?.[idx]
      if (!item?.provenance) return
      navigate(readerUrl(item.provenance.docId, item.provenance.markId ?? undefined))
    },
    [items],
  )

  const handleSessionProvenance = useCallback(() => {
    const item = sessionItemsRef.current?.[sessionIndexRef.current]
    if (!item?.provenance) return
    navigate(readerUrl(item.provenance.docId, item.provenance.markId ?? undefined))
  }, [])

  const handleGrade = useCallback((grade: ReviewGrade) => {
    const item = sessionItemsRef.current?.[sessionIndexRef.current]
    if (!item || !sessionRevealedRef.current || sessionBusyRef.current) return
    setSessionBusy(true)
    setSessionError(null)
    gradeReview(item.queueItemId, grade).then(
      () => {
        logEvent("session_grade", { queueItemId: item.queueItemId, grade })
        if (sessionIndexRef.current + 1 >= (sessionItemsRef.current?.length ?? 0)) logEvent("session_complete", { count: sessionItemsRef.current?.length ?? 0 })
        setSessionCounts((prev) => ({ ...prev, [grade]: prev[grade] + 1 }))
        setSessionIndex((prev) => prev + 1)
        setSessionRevealed(false)
      },
      (e: unknown) => {
        setSessionError(e instanceof Error ? e.message : "Failed to save grade")
      },
    ).finally(() => setSessionBusy(false))
  }, [])

  // Triage keyboard controls.
  useEffect(() => {
    if (mode !== "triage") return
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable

      if (e.key === "Escape") {
        if (typing) { el?.blur(); e.preventDefault(); return }
        setFocusIdx(-1)
        e.preventDefault()
        return
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === "?") { onShowHelp(); e.preventDefault(); return }

      const list = itemsRef.current ?? []
      switch (e.key) {
        case "j":
          if (list.length > 0) setFocusIdx((i) => Math.min(i + 1, list.length - 1))
          e.preventDefault()
          break
        case "k":
          if (list.length > 0) setFocusIdx((i) => Math.max(i - 1, 0))
          e.preventDefault()
          break
        case "g":
          setFocusIdx(0)
          e.preventDefault()
          break
        case "G":
          if (list.length > 0) setFocusIdx(list.length - 1)
          e.preventDefault()
          break
        case "Enter":
        case "o":
          if (focusIdx >= 0) handleProvenance(focusIdx)
          e.preventDefault()
          break
        case "s":
          if (focusIdx >= 0) handleStatus(focusIdx, "keep")
          e.preventDefault()
          break
        case "m":
          if (focusIdx >= 0) handleStatus(focusIdx, "known")
          e.preventDefault()
          break
        case "x":
          if (focusIdx >= 0) handleStatus(focusIdx, "discarded")
          e.preventDefault()
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode, focusIdx, handleStatus, handleProvenance, onShowHelp])

  // Session keyboard controls: space reveals, 1–4 grade the revealed card.
  useEffect(() => {
    if (mode !== "session") return
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable

      if (e.key === "Escape") {
        if (typing) {
          el?.blur()
        } else {
          setSessionRevealed(false)
        }
        e.preventDefault()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "?") {
        onShowHelp()
        e.preventDefault()
        return
      }
      if ((e.key === "f" || e.key === "q") && sessionIndexRef.current === 0 && !sessionRevealedRef.current) {
        setSessionMode(e.key === "q" ? "quick" : "full")
        e.preventDefault()
        return
      }
      if (e.key === " " || e.key === "Spacebar") {
        if (sessionItemsRef.current?.[sessionIndexRef.current] && !sessionBusyRef.current) {
          setSessionRevealed((value) => !value)
        }
        e.preventDefault()
        return
      }
      const option = GRADE_OPTIONS.find((candidate) => candidate.key === e.key)
      if (option) {
        handleGrade(option.grade)
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode, handleGrade, onShowHelp])

  // Scroll focused queue row into view.
  useEffect(() => {
    if (focusIdx < 0 || !items) return
    const item = items[focusIdx]
    if (!item) return
    const el = document.querySelector(
      `[data-vim-panel="queue"][data-vim-index="${item.id}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focusIdx, items])

  const sessionItem = sessionItems?.[sessionIndex] ?? null
  const sessionComplete = sessionItems !== null && sessionIndex >= sessionItems.length

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Review Queue</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            className={cn(mode === "triage" && "bg-accent text-foreground")}
            onClick={() => setMode("triage")}
          >
            triage
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={cn(mode === "session" && "bg-accent text-foreground")}
            onClick={() => setMode("session")}
          >
            session
          </Button>
        </div>
      </div>

      {mode === "triage" ? (
        <>
          {/* filter tabs */}
          <div className="mt-3 flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && <p className="mt-3 text-xs text-destructive/80">{error}</p>}

          <div className="mt-4 space-y-1.5">
            {items === null && !error && (
              <p className="py-8 text-center text-sm text-muted-foreground/60">loading…</p>
            )}
            {items !== null && items.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground/60">
                no items — look up words while reading to fill the queue
              </p>
            )}
            {items?.map((item, i) => (
              <QueueRow
                key={item.id}
                item={item}
                focused={focusIdx === i}
                onFocus={() => setFocusIdx(i)}
                onStatus={(status) => handleStatus(i, status)}
                onProvenance={() => handleProvenance(i)}
              />
            ))}
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground/35">
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">j</kbd>/
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">k</kbd> navigate ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">s</kbd> keep ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">m</kbd> known ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">x</kbd> discard ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">o</kbd> source ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">?</kbd> help
          </p>
        </>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
            <span className="text-[11px] text-muted-foreground">session mode</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                className={cn(sessionMode === "full" && "bg-accent text-foreground")}
                onClick={() => setSessionMode("full")}
              >
                full <kbd className="ml-1 text-[10px] text-muted-foreground">f</kbd>
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className={cn(sessionMode === "quick" && "bg-accent text-foreground")}
                onClick={() => setSessionMode("quick")}
              >
                quick sweep (tired) <kbd className="ml-1 text-[10px] text-muted-foreground">q</kbd>
              </Button>
            </div>
          </div>
          {sessionError && <p className="mb-3 text-xs text-destructive/80">{sessionError}</p>}
          {sessionItems === null && !sessionError && (
            <p className="py-8 text-center text-sm text-muted-foreground/60">loading…</p>
          )}
          {sessionComplete && (
            <div className="rounded-xl border border-border/60 bg-muted/10 px-5 py-8 text-center">
              <h3 className="text-lg font-semibold">Session complete</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Reviewed {sessionItems.length} {sessionItems.length === 1 ? "item" : "items"}.
              </p>
              <div className="mt-5 grid grid-cols-4 gap-2">
                {GRADE_OPTIONS.map((option) => (
                  <div key={option.grade} className="rounded-lg bg-muted/40 px-2 py-2">
                    <div className="text-lg font-semibold tabular-nums">{sessionCounts[option.grade]}</div>
                    <div className="text-[10px] text-muted-foreground">{option.label}</div>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" className="mt-6" onClick={() => setMode("triage")}>
                back to triage
              </Button>
            </div>
          )}
          {sessionItem && !sessionComplete && (
            <div
              data-vim-panel="review-session"
              data-vim-index={sessionItem.queueItemId}
              className={cn(focusRing(true), "reading-surface")}
            >
              <div className="flex items-center justify-between gap-2 px-4 pt-4">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-foreground">{sessionItem.phase}</span>
                  <span className="tabular-nums">priority {sessionItem.priority}</span>
                </div>
                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px]">
                  {sessionMode === "quick" ? "quick sweep (tired)" : "full"}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground/60">
                  {sessionIndex + 1} / {sessionItems?.length ?? 0}
                </span>
              </div>
              <div className="px-4 pb-5 pt-8 text-center">
                <div className="text-6xl font-medium leading-none tracking-tight" lang="zh">
                  {sessionItem.word}
                </div>
                {!sessionRevealed ? (
                  <p className="mt-6 text-sm text-muted-foreground">Press space to reveal</p>
                ) : (
                  <div className="mt-6 space-y-2">
                    {sessionItem.pinyin && <p className="text-base text-muted-foreground">{sessionItem.pinyin}</p>}
                    {sessionItem.gloss && <p className="text-sm text-muted-foreground">{sessionItem.gloss}</p>}
                  </div>
                )}
              </div>
              {sessionItem.provenance && (
                <div className="border-t border-border/50 px-4 py-3">
                  <Button variant="ghost" size="xs" onClick={handleSessionProvenance}>
                    {sessionItem.provenance.docTitle}
                  </Button>
                </div>
              )}
              {sessionRevealed && (
                <div className="grid grid-cols-4 gap-1 border-t border-border/50 p-3">
                  {GRADE_OPTIONS.map((option) => (
                    <Button
                      key={option.grade}
                      variant="secondary"
                      size="sm"
                      disabled={sessionBusy}
                      onClick={() => handleGrade(option.grade)}
                    >
                      <span className="font-mono text-xs">{option.key}</span>
                      <span className="ml-1">{option.label}</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="mt-6 text-center text-[11px] text-muted-foreground/35">
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">space</kbd> reveal ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">1</kbd>–
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">4</kbd> grade ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">?</kbd> help
          </p>
        </div>
      )}
    </div>
  )
}
