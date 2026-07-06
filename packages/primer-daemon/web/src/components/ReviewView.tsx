import { useCallback, useEffect, useRef, useState } from "react"
import type * as React from "react"

import { type QueueItem, type QueueStatus, getQueue, setQueueStatus } from "@/api"
import { navigate, readerUrl } from "@/hooks/useHashRoute"
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
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<QueueStatus | "all">("new")
  const [focusIdx, setFocusIdx] = useState(-1)
  const itemsRef = useRef(items)
  itemsRef.current = items

  // Fetch queue
  useEffect(() => {
    let alive = true
    setItems(null)
    setFocusIdx(-1)
    getQueue(filter === "all" ? "all" : filter, 200).then(
      (d) => { if (alive) setItems(d) },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Failed to load queue") },
    )
    return () => { alive = false }
  }, [filter])

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
      const p = item.provenance
      navigate(`/read/${p.docId}`)
    },
    [items],
  )

  // Keyboard
  useEffect(() => {
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
  }, [focusIdx, handleStatus, handleProvenance, onShowHelp])

  // Scroll focused into view
  useEffect(() => {
    if (focusIdx < 0 || !items) return
    const item = items[focusIdx]
    if (!item) return
    const el = document.querySelector(
      `[data-vim-panel="queue"][data-vim-index="${item.id}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focusIdx, items])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h2 className="text-base font-semibold tracking-tight">Review Queue</h2>

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
    </div>
  )
}
