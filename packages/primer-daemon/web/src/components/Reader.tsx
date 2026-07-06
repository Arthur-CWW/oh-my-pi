import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import {
  type CreateMarkResult,
  type DictResult,
  type Mark,
  type ReaderDoc,
  createMark,
  deleteMark,
  dictBest,
  dictLookup,
  getKnownWords,
  getReaderDoc,
} from "@/api"
import { navigate } from "@/hooks/useHashRoute"
import { type Segment, classifyWord, extractSentence, isHan, parsePinyin, segmentText, toneColor } from "@/lib/segmentation"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Popup state
// ---------------------------------------------------------------------------

interface PopupState {
  word: string
  paragraphIdx: number
  start: number
  end: number
  anchorRect: DOMRect
  dict: DictResult | null
  loading: boolean
  markResult: CreateMarkResult | null
  undone: boolean
}

// ---------------------------------------------------------------------------
// Word styling
// ---------------------------------------------------------------------------

const UNKNOWN_STYLE = "underline decoration-amber-500/40 decoration-dotted decoration-1 underline-offset-4"
const QUEUED_STYLE = "underline decoration-sky-400/30 decoration-dotted decoration-1 underline-offset-4"
const MARKED_STYLE = "bg-emerald-400/10 rounded-sm"

// ---------------------------------------------------------------------------
// Pinyin display
// ---------------------------------------------------------------------------

function PinyinDisplay({ pinyin }: { pinyin: string }): React.JSX.Element {
  const syllables = parsePinyin(pinyin)
  if (syllables.length === 0) return <span className="text-muted-foreground">{pinyin}</span>
  return (
    <span>
      {syllables.map((s, i) => (
        <span key={i} className={cn(toneColor(s.tone), i > 0 && "ml-0.5")}>
          {s.text}
          {s.tone < 5 ? s.tone : ""}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Word popup
// ---------------------------------------------------------------------------

function WordPopup({
  popup,
  onClose,
  onUndo,
}: {
  popup: PopupState
  onClose: () => void
  onUndo: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  // Position — clamp to viewport after render
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    const { anchorRect } = popup
    let top = anchorRect.bottom + 8
    let left = anchorRect.left
    // Clamp right edge
    if (left + 288 > window.innerWidth - 12) left = window.innerWidth - 300
    if (left < 8) left = 8
    // Clamp bottom — flip above if needed
    if (top + 240 > window.innerHeight) top = anchorRect.top - 248
    if (top < 8) top = 8
    setPos({ top, left })
  }, [popup])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onKeyDown={undefined} />
      <div
        ref={ref}
        style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }}
        className="w-72 rounded-lg border border-border/70 bg-popover p-3 shadow-xl"
      >
        {/* word + traditional */}
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-medium">{popup.word}</span>
          {popup.dict?.entries[0]?.traditional && popup.dict.entries[0].traditional !== popup.word && (
            <span className="text-sm text-muted-foreground">{popup.dict.entries[0].traditional}</span>
          )}
        </div>

        {popup.loading && <p className="mt-2 text-xs text-muted-foreground/60">looking up…</p>}

        {popup.dict && popup.dict.entries.length > 0 && (
          <div className="mt-2 space-y-2">
            {popup.dict.entries.slice(0, 3).map((entry, i) => (
              <div key={i}>
                <PinyinDisplay pinyin={entry.pinyin} />
                <ul className="mt-0.5">
                  {entry.definitions.slice(0, 4).map((def, j) => (
                    <li key={j} className="text-xs leading-relaxed text-muted-foreground">{def}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {popup.dict && popup.dict.entries.length === 0 && !popup.loading && (
          <p className="mt-2 text-xs text-muted-foreground/60">no dictionary entry</p>
        )}

        {popup.markResult && !popup.undone && (
          <div className="mt-2.5 flex items-center gap-2 border-t border-border/40 pt-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              queued
            </span>
            <button
              type="button"
              onClick={onUndo}
              className="text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              undo <kbd className="ml-0.5 rounded bg-muted px-1 font-mono text-[10px]">u</kbd>
            </button>
          </div>
        )}
        {popup.undone && (
          <div className="mt-2.5 border-t border-border/40 pt-2">
            <span className="text-[11px] text-muted-foreground/50">removed from queue</span>
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Paragraph
// ---------------------------------------------------------------------------

function ReaderParagraph({
  text,
  paragraphIdx,
  knownWords,
  queuedWords,
  markedSurfaces,
  markMap,
  focused,
  onWordClick,
  onFocus,
}: {
  text: string
  paragraphIdx: number
  knownWords: ReadonlySet<string>
  queuedWords: ReadonlySet<string>
  markedSurfaces: ReadonlySet<string>
  markMap: ReadonlyMap<string, number> // "pIdx:start:end" → markId
  focused: boolean
  onWordClick: (word: string, pIdx: number, seg: Segment, rect: DOMRect) => void
  onFocus: () => void
}): React.JSX.Element {
  const segments = useMemo(() => segmentText(text), [text])

  return (
    <p
      data-vim-panel="paragraphs"
      data-vim-index={paragraphIdx}
      onMouseEnter={onFocus}
      className={cn(
        "scroll-mt-24 rounded-md px-2 py-1 transition-colors",
        focused && "bg-accent/25 ring-1 ring-ring/15",
      )}
      style={{ maxWidth: "68ch" }}
    >
      {segments.map((seg, i) => {
        const segEnd = seg.offset + seg.text.length
        const markKey = `${paragraphIdx}:${seg.offset}:${segEnd}`
        const markId = markMap.get(markKey)
        const hasMark = markId !== undefined
        const han = isHan(seg.text)
        const cls = classifyWord(seg.text, knownWords, queuedWords, markedSurfaces)

        let wordStyle = ""
        if (hasMark) wordStyle = MARKED_STYLE
        else if (cls === "unknown") wordStyle = UNKNOWN_STYLE
        else if (cls === "queued") wordStyle = QUEUED_STYLE

        return (
          <span
            key={i}
            data-mark-id={markId}
            onClick={
              han
                ? (ev: React.MouseEvent) => {
                    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                    onWordClick(seg.text, paragraphIdx, seg, rect)
                  }
                : undefined
            }
            className={cn(
              han && "cursor-pointer transition-colors hover:bg-accent/40",
              wordStyle,
            )}
          >
            {seg.text}
          </span>
        )
      })}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export function Reader({
  docId,
  markId,
  onShowHelp,
}: {
  docId: number
  markId: number | null
  onShowHelp: () => void
}): React.JSX.Element {
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [knownWords, setKnownWords] = useState<Set<string>>(new Set())
  const [queuedWords, setQueuedWords] = useState<Set<string>>(new Set())
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [focusPara, setFocusPara] = useState(-1)

  // Derived sets
  const markedSurfaces = useMemo(
    () => (doc ? new Set(doc.marks.map((m) => m.surface)) : new Set<string>()),
    [doc],
  )

  // Mark lookup map: "pIdx:start:end" → markId
  const markMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!doc) return map
    for (const m of doc.marks) {
      map.set(`${m.paragraphIdx}:${m.start}:${m.end}`, m.id)
    }
    return map
  }, [doc])

  // Load doc + known words (once)
  useEffect(() => {
    let alive = true
    Promise.all([getReaderDoc(docId), getKnownWords()]).then(
      ([d, words]) => {
        if (!alive) return
        setDoc(d)
        setKnownWords(new Set(words))
        // Seed queued words from existing marks
        setQueuedWords(new Set(d.marks.map((m) => m.surface)))
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load document")
      },
    )
    return () => {
      alive = false
    }
  }, [docId])

  // Scroll to mark=<id> anchor
  useEffect(() => {
    if (markId == null || !doc) return
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-mark-id="${markId}"]`) as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ block: "center", behavior: "smooth" })
      // Flash animation
      el.style.transition = "background-color 0.3s"
      el.style.backgroundColor = "oklch(0.8 0.115 78 / 35%)"
      setTimeout(() => {
        el.style.backgroundColor = ""
      }, 1500)
    })
  }, [markId, doc])

  // Word click → dict lookup + auto-mark
  const onWordClick = useCallback(
    (word: string, pIdx: number, seg: Segment, rect: DOMRect) => {
      if (!doc) return
      const paragraphText = doc.paragraphs[pIdx]
      if (!paragraphText) return

      const start = seg.offset
      const end = seg.offset + seg.text.length
      const sentence = extractSentence(paragraphText, start, end)

      const state: PopupState = {
        word,
        paragraphIdx: pIdx,
        start,
        end,
        anchorRect: rect,
        dict: null,
        loading: true,
        markResult: null,
        undone: false,
      }
      setPopup(state)

      // Dictionary lookup (with fallback to best-prefix match)
      dictLookup(word)
        .catch(() => dictBest(word).catch(() => ({ word, entries: [] }) as DictResult))
        .then((result) => {
          setPopup((prev) => (prev?.word === word ? { ...prev, dict: result, loading: false } : prev))
        })

      // Auto-record mark
      createMark({ docId: doc.id, paragraphIdx: pIdx, start, end, surface: word, sentence }).then(
        (result) => {
          setPopup((prev) => (prev?.word === word ? { ...prev, markResult: result } : prev))
          setQueuedWords((prev) => new Set(prev).add(word))
          setDoc((prev) => {
            if (!prev) return prev
            const newMark: Mark = { id: result.markId, paragraphIdx: pIdx, start, end, surface: word, kind: "lookup" }
            return { ...prev, marks: [...prev.marks, newMark] }
          })
        },
        () => {
          /* mark creation failed — dictionary popup still works */
        },
      )
    },
    [doc],
  )

  // Undo mark
  const onUndo = useCallback(() => {
    if (!popup?.markResult) return
    const mid = popup.markResult.markId
    const word = popup.word
    setPopup((prev) => (prev ? { ...prev, undone: true } : prev))
    deleteMark(mid).then(
      () => {
        setDoc((prev) => {
          if (!prev) return prev
          return { ...prev, marks: prev.marks.filter((m) => m.id !== mid) }
        })
        // Remove from queued if no other marks exist for this word
        setDoc((prev) => {
          if (!prev) return prev
          const stillMarked = prev.marks.some((m) => m.surface === word)
          if (!stillMarked) {
            setQueuedWords((q) => {
              const next = new Set(q)
              next.delete(word)
              return next
            })
          }
          return prev
        })
      },
      () => {
        /* undo failed — popup already shows undone state */
      },
    )
  }, [popup])

  const closePopup = useCallback(() => setPopup(null), [])

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable

      if (e.key === "Escape") {
        if (typing) {
          el?.blur()
          e.preventDefault()
          return
        }
        if (popup) {
          setPopup(null)
          e.preventDefault()
          return
        }
        navigate("/read")
        e.preventDefault()
        return
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === "?") {
        onShowHelp()
        e.preventDefault()
        return
      }

      // u = undo while popup open
      if (popup) {
        if (e.key === "u") {
          onUndo()
          e.preventDefault()
        }
        return
      }

      const paraCount = doc?.paragraphs.length ?? 0
      switch (e.key) {
        case "j":
          if (paraCount > 0) {
            setFocusPara((i) => Math.min(i + 1, paraCount - 1))
            e.preventDefault()
          }
          break
        case "k":
          if (paraCount > 0) {
            setFocusPara((i) => Math.max(i - 1, 0))
            e.preventDefault()
          }
          break
        case "g":
          setFocusPara(0)
          e.preventDefault()
          break
        case "G":
          if (paraCount > 0) setFocusPara(paraCount - 1)
          e.preventDefault()
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [doc, popup, closePopup, onUndo, onShowHelp])

  // Scroll focused paragraph
  useEffect(() => {
    if (focusPara < 0) return
    const el = document.querySelector(
      `[data-vim-panel="paragraphs"][data-vim-index="${focusPara}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focusPara])

  // --- Render ---

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm text-destructive/80">{error}</p>
        <button
          type="button"
          onClick={() => navigate("/read")}
          className="mt-3 text-xs text-muted-foreground underline"
        >
          back to library
        </button>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground/60">loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      {/* breadcrumb */}
      <div className="mb-6 flex items-baseline gap-3">
        <button
          type="button"
          onClick={() => navigate("/read")}
          className="text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          ← library
        </button>
        <h2 className="text-sm font-medium tracking-tight">{doc.title}</h2>
        {doc.marks.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground/50">
            {doc.marks.length} mark{doc.marks.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* reading surface */}
      <div className="reading-surface space-y-5">
        {doc.paragraphs.map((para, idx) => (
          <ReaderParagraph
            key={idx}
            text={para}
            paragraphIdx={idx}
            knownWords={knownWords}
            queuedWords={queuedWords}
            markedSurfaces={markedSurfaces}
            markMap={markMap}
            focused={focusPara === idx}
            onWordClick={onWordClick}
            onFocus={() => setFocusPara(idx)}
          />
        ))}
      </div>

      {popup && <WordPopup popup={popup} onClose={closePopup} onUndo={onUndo} />}

      <p className="mt-8 text-[11px] text-muted-foreground/35">
        click any word to look up ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">j</kbd>/
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">k</kbd> paragraphs ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">u</kbd> undo ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Esc</kbd> close ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">?</kbd> help
      </p>
    </div>
  )
}
