import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import {
  type CreateMarkResult,
  type DictResult,
  type Mark,
  type QueueItem,
  type ReaderAlignment,
  type ReaderAlignmentChar,
  type ReaderAlignmentSentence,
  type ReaderDoc,
  type ReaderMedia,
  createMark,
  deleteMark,
  dictBest,
  dictLookup,
  getKnownWords,
  getQueue,
  getReaderDoc,
  getReaderMedia,
  getReaderMediaAlignment,
  setQueuePriority,
} from "@/api"
import { navigate } from "@/hooks/useHashRoute"
import { logEvent } from "@/hooks/useTelemetry"
import { ZhDictCard } from "@/components/ZhDictCard"
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
  priority: number
  prioritySaving: boolean
  undone: boolean
}

// ---------------------------------------------------------------------------
// Word styling
// ---------------------------------------------------------------------------

const UNKNOWN_STYLE = "underline decoration-amber-500/40 decoration-dotted decoration-1 underline-offset-4"
const QUEUED_STYLE = "underline decoration-sky-400/30 decoration-dotted decoration-1 underline-offset-4"
const PRIORITY_STYLE = "underline decoration-sky-300/70 decoration-solid decoration-2 underline-offset-4"
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
  onPriority,
}: {
  popup: PopupState
  onClose: () => void
  onUndo: () => void
  onPriority: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  // Position — clamp to viewport after render
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    const { anchorRect } = popup
    let top = anchorRect.bottom + 8
    let left = anchorRect.left
    // Clamp right edge (card is w-80 = 320px)
    if (left + 320 > window.innerWidth - 12) left = window.innerWidth - 332
    if (left < 8) left = 8
    // Clamp bottom — flip above if needed
    if (top + 360 > window.innerHeight) top = anchorRect.top - 368
    if (top < 8) top = 8
    setPos({ top, left })
  }, [popup])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onKeyDown={undefined} />
      <div ref={ref} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }} className="w-80">
        <ZhDictCard word={popup.word} />

        {popup.markResult && !popup.undone && (
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-border/70 bg-popover px-3 py-2 shadow-xl">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              queued
            </span>
            <button
              type="button"
              onClick={onPriority}
              disabled={popup.prioritySaving}
              className={cn(
                "text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground",
                popup.prioritySaving && "cursor-wait opacity-50",
              )}
            >
              {popup.priority > 0 ? `priority ↑${popup.priority}` : "push ↑ priority"}{" "}
              <kbd className="ml-0.5 rounded bg-muted px-1 font-mono text-[10px]">p</kbd>
            </button>
            <button
              type="button"
              onClick={onUndo}
              className="ml-auto text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              undo <kbd className="ml-0.5 rounded bg-muted px-1 font-mono text-[10px]">u</kbd>
            </button>
          </div>
        )}
        {popup.undone && (
          <div className="mt-1 rounded-lg border border-border/70 bg-popover px-3 py-2 shadow-xl">
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
  priorityWords,
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
  priorityWords: ReadonlySet<string>
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
        const isPriority = priorityWords.has(seg.text)

        let wordStyle = ""
        if (hasMark) wordStyle = cn(MARKED_STYLE, isPriority && PRIORITY_STYLE)
        else if (isPriority) wordStyle = PRIORITY_STYLE
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
function MediaParagraph({
  sentence,
  paragraphIdx,
  knownWords,
  queuedWords,
  priorityWords,
  markedSurfaces,
  markMap,
  focused,
  activeCharIdx,
  showPinyin,
  onWordClick,
  onCharClick,
  onFocus,
}: {
  sentence: ReaderAlignmentSentence
  paragraphIdx: number
  knownWords: ReadonlySet<string>
  queuedWords: ReadonlySet<string>
  priorityWords: ReadonlySet<string>
  markedSurfaces: ReadonlySet<string>
  markMap: ReadonlyMap<string, number>
  focused: boolean
  activeCharIdx: number | null
  showPinyin: boolean
  onWordClick: (word: string, pIdx: number, seg: Segment, rect: DOMRect) => void
  onCharClick: (pIdx: number, charIdx: number, char: ReaderAlignmentChar) => void
  onFocus: () => void
}): React.JSX.Element {
  const segments = useMemo(() => segmentText(sentence.text), [sentence.text])
  const units = useMemo(() => {
    const result: Array<{ text: string; offset: number; charIdx: number | null; char: ReaderAlignmentChar | null }> = []
    let offset = 0
    let charIdx = 0
    for (const text of Array.from(sentence.text)) {
      const block = sentence.chars[charIdx]
      const unit = { text, offset, charIdx: block?.ch === text ? charIdx : null, char: block?.ch === text ? block : null }
      result.push(unit)
      offset += text.length
      if (unit.char !== null) charIdx += 1
    }
    return result
  }, [sentence])

  return (
    <p
      data-vim-panel="paragraphs"
      data-vim-index={paragraphIdx}
      data-media-sentence={paragraphIdx}
      onMouseEnter={onFocus}
      className={cn(
        "scroll-mt-24 rounded-md px-2 py-2 transition-colors",
        focused && "bg-accent/25 ring-1 ring-ring/15",
      )}
      style={{ maxWidth: "68ch" }}
    >
      {units.map((unit, unitIdx) => {
        const { text, offset, charIdx, char } = unit
        if (!char || charIdx === null) {
          return <span key={`${unitIdx}:${text}`}>{text}</span>
        }
        const seg =
          segments.find((candidate) => offset >= candidate.offset && offset < candidate.offset + candidate.text.length) ??
          ({ text, offset, isWordLike: isHan(text) } satisfies Segment)
        const segEnd = seg.offset + seg.text.length
        const markId = markMap.get(`${paragraphIdx}:${seg.offset}:${segEnd}`)
        const cls = classifyWord(seg.text, knownWords, queuedWords, markedSurfaces)
        const isPriority = priorityWords.has(seg.text)
        const han = isHan(text)
        let wordStyle = ""
        if (markId !== undefined) wordStyle = cn(MARKED_STYLE, isPriority && PRIORITY_STYLE)
        else if (isPriority) wordStyle = PRIORITY_STYLE
        else if (cls === "unknown") wordStyle = UNKNOWN_STYLE
        else if (cls === "queued") wordStyle = QUEUED_STYLE

        return (
          <ruby
            key={`${unitIdx}:${text}`}
            data-media-char={`${paragraphIdx}:${charIdx}`}
            data-mark-id={markId}
            onClick={(ev) => {
              const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
              if ((ev.ctrlKey || ev.altKey) && han) {
                // Long-press fallback on touch should eventually call this same lookup path.
                onWordClick(seg.text, paragraphIdx, seg, rect)
                return
              }
              onCharClick(paragraphIdx, charIdx, char)
            }}
            className={cn(
              "inline-block rounded-sm",
              han && "cursor-pointer transition-colors hover:bg-accent/40",
              activeCharIdx === charIdx && "bg-amber-300/35 text-amber-100",
              wordStyle,
            )}
          >
            {text}
            {showPinyin && char.pinyin && <rt className="px-0.5 text-[10px] font-normal text-muted-foreground/65">{char.pinyin}</rt>}
          </ruby>
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
  const [priorityByWord, setPriorityByWord] = useState<Map<string, number>>(new Map())
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [focusPara, setFocusPara] = useState(-1)
  const [media, setMedia] = useState<ReaderMedia | null>(null)
  const [alignment, setAlignment] = useState<ReaderAlignment | null>(null)
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const [showPinyin, setShowPinyin] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [activeMediaChar, setActiveMediaChar] = useState<{ sentenceIdx: number; charIdx: number } | null>(null)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const userScrollOverrideRef = useRef(false)

  // Derived sets
  const markedSurfaces = useMemo(
    () => (doc ? new Set(doc.marks.map((m) => m.surface)) : new Set<string>()),
    [doc],
  )

  const priorityWords = useMemo(() => new Set(priorityByWord.keys()), [priorityByWord])

  // Mark lookup map: "pIdx:start:end" → markId
  const markMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!doc) return map
    for (const m of doc.marks) {
      map.set(`${m.paragraphIdx}:${m.start}:${m.end}`, m.id)
    }
    return map
  }, [doc])
  // Load doc, word state, and optional attached media.
  useEffect(() => {
    let alive = true
    setError(null)
    setDoc(null)
    setMedia(null)
    setAlignment(null)
    setMediaNotice(null)
    setPlaying(false)
    setActiveMediaChar(null)
    setPlaybackRate(1)
    userScrollOverrideRef.current = false
    setPriorityByWord(new Map())
    Promise.all([getReaderDoc(docId), getKnownWords()]).then(
      ([d, words]) => {
        if (!alive) return
        setDoc(d)
        setKnownWords(new Set(words))
        setQueuedWords(new Set(d.marks.map((m) => m.surface)))
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load document")
      },
    )
    void getReaderMedia(docId).then(
      (meta) =>
        getReaderMediaAlignment(docId).then(
          (a) => {
            if (!alive) return
            setMedia(meta)
            setAlignment(a)
          },
          () => {
            if (alive) setMediaNotice("Media alignment unavailable; showing the document text.")
          },
        ),
      (e: unknown) => {
        // A 404 is the normal no-media case; other failures are still non-fatal.
        if (alive && !(e instanceof Error && e.message.includes("404"))) {
          setMediaNotice("Media unavailable; showing the document text.")
        }
      },
    )
    getQueue("all", 500).then(
      (items: QueueItem[]) => {
        if (!alive) return
        setPriorityByWord(
          new Map(items.filter((item) => item.priority > 0).map((item) => [item.word, item.priority])),
        )
      },
      () => {
        // Priority highlighting is best-effort; the document remains readable if unavailable.
      },
    )
    return () => {
      alive = false
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
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
  }, [markId, doc, alignment])

  // Word click → dict lookup + auto-mark
  const onWordClick = useCallback(
    (word: string, pIdx: number, seg: Segment, rect: DOMRect) => {
      if (!doc) return
      const paragraphText = alignment?.sentences[pIdx]?.text ?? doc.paragraphs[pIdx]
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
        priority: priorityByWord.get(word) ?? 0,
        prioritySaving: false,
        undone: false,
      }
      setPopup(state)

      // Dictionary lookup (with fallback to best-prefix match)
      dictLookup(word)
        .catch(() => dictBest(word).catch(() => ({ word, entries: [] }) as DictResult))
        .then((result) => {
          logEvent("word_lookup", { word })
          setPopup((prev) => (prev?.word === word ? { ...prev, dict: result, loading: false } : prev))
        })

      // Auto-record mark
      createMark({ docId: doc.id, paragraphIdx: pIdx, start, end, surface: word, sentence }).then(
        (result) => {
          setPopup((prev) => (
            prev?.word === word
              ? { ...prev, markResult: result, priority: result.queueItem.priority }
              : prev
          ))
          setPriorityByWord((prev) => {
            if (result.queueItem.priority <= 0) return prev
            const next = new Map(prev)
            next.set(word, result.queueItem.priority)
            return next
          })
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
    [doc, alignment, priorityByWord],
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

  const onPriority = useCallback(() => {
    const current = popup
    const queueItem = current?.markResult?.queueItem
    if (!queueItem || current.prioritySaving) return
    const priority = current.priority > 0 ? current.priority + 1 : 1
    setPopup((prev) => (prev ? { ...prev, prioritySaving: true } : prev))
    setQueuePriority(queueItem.id, priority).then(
      (updated) => {
        logEvent("priority_push", { queueItemId: updated.id, priority: updated.priority })
        setPriorityByWord((prev) => {
          const next = new Map(prev)
          next.set(updated.word, updated.priority)
          return next
        })
        setPopup((prev) => {
          if (!prev || prev.markResult?.queueItem.id !== updated.id) return prev
          return {
            ...prev,
            priority: updated.priority,
            prioritySaving: false,
            markResult: { ...prev.markResult, queueItem: updated },
          }
        })
      },
      () => {
        setPopup((prev) => (prev ? { ...prev, prioritySaving: false } : prev))
      },
    )
  }, [popup])

  const mediaCharRanges = useMemo(() => {
    const ranges: Array<{ sentenceIdx: number; charIdx: number; startMs: number }> = []
    alignment?.sentences.forEach((sentence, sentenceIdx) => {
      sentence.chars.forEach((char, charIdx) => {
        ranges.push({ sentenceIdx, charIdx, startMs: char.startMs })
      })
    })
    return ranges
  }, [alignment])

  const updateActiveMediaChar = useCallback(() => {
    const element = mediaRef.current
    if (!element || mediaCharRanges.length === 0) return
    const nowMs = element.currentTime * 1000
    let low = 0
    let high = mediaCharRanges.length - 1
    let best = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (mediaCharRanges[mid].startMs <= nowMs) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    if (best < 0) {
      setActiveMediaChar(null)
      return
    }
    const next = mediaCharRanges[best]
    setActiveMediaChar((previous) =>
      previous?.sentenceIdx === next.sentenceIdx && previous.charIdx === next.charIdx
        ? previous
        : { sentenceIdx: next.sentenceIdx, charIdx: next.charIdx },
    )
    setFocusPara((previous) => (previous === next.sentenceIdx ? previous : next.sentenceIdx))
  }, [mediaCharRanges])

  const seekToMediaChar = useCallback(
    (sentenceIdx: number, charIdx: number, char: ReaderAlignmentChar) => {
      const element = mediaRef.current
      if (!element) return
      element.currentTime = Math.max(0, char.startMs / 1000)
      setActiveMediaChar({ sentenceIdx, charIdx })
      setFocusPara(sentenceIdx)
      userScrollOverrideRef.current = false
      logEvent("media_seek", { docId, ms: char.startMs })
      void element.play().catch(() => {
        // Browser autoplay policy can reject only when no user gesture was available.
      })
    },
    [docId],
  )

  const handleMediaPlay = useCallback(() => {
    const element = mediaRef.current
    setPlaying(true)
    logEvent("media_play", { docId, ms: Math.round((element?.currentTime ?? 0) * 1000) })
  }, [docId])

  const handleMediaPause = useCallback(() => {
    const element = mediaRef.current
    setPlaying(false)
    logEvent("media_pause", { docId, ms: Math.round((element?.currentTime ?? 0) * 1000) })
  }, [docId])

  const toggleMediaPlayback = useCallback(() => {
    const element = mediaRef.current
    if (!element) return
    if (element.paused) void element.play().catch(() => undefined)
    else element.pause()
  }, [])

  const cyclePlaybackRate = useCallback((direction: 1 | -1) => {
    const rates = [0.75, 1, 1.25]
    setPlaybackRate((current) => {
      const index = rates.indexOf(current)
      const currentIndex = index < 0 ? 1 : index
      const next = rates[(currentIndex + direction + rates.length) % rates.length]
      if (mediaRef.current) mediaRef.current.playbackRate = next
      return next
    })
  }, [])

  // A requestAnimationFrame loop keeps alignment smooth between sparse timeupdate events.
  useEffect(() => {
    if (!playing || !alignment || mediaCharRanges.length === 0) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      return
    }
    const tick = () => {
      updateActiveMediaChar()
      frameRef.current = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [alignment, mediaCharRanges.length, playing, updateActiveMediaChar])

  useEffect(() => {
    const sentenceIdx = activeMediaChar?.sentenceIdx
    if (sentenceIdx == null || userScrollOverrideRef.current) return
    const element = document.querySelector(`[data-media-sentence="${sentenceIdx}"]`) as HTMLElement | null
    element?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [activeMediaChar?.sentenceIdx])

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

      // u = undo, p = push priority while popup open
      if (popup) {
        if (e.key === "u") {
          onUndo()
          e.preventDefault()
        } else if (e.key === "p") {
          onPriority()
          e.preventDefault()
        }
        return
      }

      if (alignment) {
        if (e.code === "Space" || e.key === " ") {
          toggleMediaPlayback()
          e.preventDefault()
          return
        }
        if (e.key === "p" || e.key === "P") {
          setShowPinyin((visible) => !visible)
          e.preventDefault()
          return
        }
        if (e.key === "[") {
          cyclePlaybackRate(-1)
          e.preventDefault()
          return
        }
        if (e.key === "]") {
          cyclePlaybackRate(1)
          e.preventDefault()
          return
        }
      }

      const paraCount = alignment?.sentences.length ?? doc?.paragraphs.length ?? 0
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
  }, [alignment, cyclePlaybackRate, doc, onPriority, onShowHelp, onUndo, popup, toggleMediaPlayback])

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
      {media && alignment && (
        media.kind === "video" ? (
          <video
            ref={(node) => {
              mediaRef.current = node
            }}
            src={`/api/reader/docs/${docId}/media/file`}
            className="sticky top-16 z-30 ml-auto mb-4 block w-56 rounded-lg border border-border/60 bg-black/90 shadow-lg"
            playsInline
            preload="metadata"
            onPlay={handleMediaPlay}
            onPause={handleMediaPause}
            onEnded={() => setPlaying(false)}
            aria-label="Reader video"
          />
        ) : (
          <audio
            ref={(node) => {
              mediaRef.current = node
            }}
            src={`/api/reader/docs/${docId}/media/file`}
            preload="metadata"
            onPlay={handleMediaPlay}
            onPause={handleMediaPause}
            onEnded={() => setPlaying(false)}
            className="sr-only"
            aria-hidden="true"
          />
        )
      )}

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

      {mediaNotice && <p className="mb-4 text-xs text-muted-foreground/55">{mediaNotice}</p>}

      {/* reading surface */}
      <div
        className="reading-surface space-y-5"
        onWheelCapture={() => {
          userScrollOverrideRef.current = true
        }}
      >
        {alignment && media
          ? alignment.sentences.map((sentence, idx) => (
              <MediaParagraph
                key={sentence.idx}
                sentence={sentence}
                paragraphIdx={idx}
                knownWords={knownWords}
                queuedWords={queuedWords}
                priorityWords={priorityWords}
                markedSurfaces={markedSurfaces}
                markMap={markMap}
                focused={focusPara === idx}
                activeCharIdx={
                  sentence.charTiming === "native" && activeMediaChar?.sentenceIdx === idx ? activeMediaChar.charIdx : null
                }
                showPinyin={showPinyin}
                onWordClick={onWordClick}
                onCharClick={seekToMediaChar}
                onFocus={() => setFocusPara(idx)}
              />
            ))
          : doc.paragraphs.map((para, idx) => (
              <ReaderParagraph
                key={idx}
                text={para}
                paragraphIdx={idx}
                knownWords={knownWords}
                queuedWords={queuedWords}
                priorityWords={priorityWords}
                markedSurfaces={markedSurfaces}
                markMap={markMap}
                focused={focusPara === idx}
                onWordClick={onWordClick}
                onFocus={() => setFocusPara(idx)}
              />
            ))}
      </div>

      {popup && <WordPopup popup={popup} onClose={closePopup} onUndo={onUndo} onPriority={onPriority} />}

      <p className="mt-8 text-[11px] text-muted-foreground/35">
        {alignment ? (
          <>
            click a character to play from there ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Space</kbd> play / pause ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">P</kbd> pinyin ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">[</kbd>/<kbd className="rounded bg-muted px-1 font-mono text-[10px]">]</kbd>{" "}
            rate ({playbackRate}×) · ctrl/alt-click look up
          </>
        ) : (
          <>
            click any word to look up ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">j</kbd>/
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">k</kbd> paragraphs ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">u</kbd> undo ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">p</kbd> priority (in popup) ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Esc</kbd> close ·{" "}
            <kbd className="rounded bg-muted px-1 font-mono text-[10px]">?</kbd> help
          </>
        )}
      </p>
    </div>
  )
}
