import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import {
  type Alignment,
  type AlignmentChar,
  type AlignmentSentence,
  charAtTime,
  detectTone,
  parseAlignment,
  sentenceAtTime,
} from "@/lib/alignment"
import { toneColor } from "@/lib/segmentation"
import { cn } from "@/lib/utils"
import { Button } from "./ui/button"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DisplayMode = "both" | "hanzi" | "pinyin"

interface LoadedState {
  alignment: Alignment
  audioUrl: string
}

// ---------------------------------------------------------------------------
// File loader (drag-drop + picker)
// ---------------------------------------------------------------------------

function FileLoader({ onLoaded }: { onLoaded: (state: LoadedState) => void }): React.JSX.Element {
  const [alignmentFile, setAlignmentFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const processFiles = useCallback(
    async (alignment: File, audio: File) => {
      try {
        const text = await alignment.text()
        const parsed = parseAlignment(JSON.parse(text))
        const url = URL.createObjectURL(audio)
        onLoaded({ alignment: parsed, audioUrl: url })
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to parse alignment JSON")
      }
    },
    [onLoaded],
  )

  // Auto-load when both files are set
  useEffect(() => {
    if (alignmentFile && audioFile) processFiles(alignmentFile, audioFile)
  }, [alignmentFile, audioFile, processFiles])

  const handleDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault()
      setDragOver(false)
      const files = Array.from(ev.dataTransfer.files)
      for (const f of files) {
        if (f.name.endsWith(".json")) setAlignmentFile(f)
        else if (/\.(mp3|wav|m4a|ogg|webm)$/i.test(f.name)) setAudioFile(f)
      }
    },
    [],
  )

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <h2 className="text-base font-semibold tracking-tight">Shadow</h2>
      <p className="mt-1 text-xs text-muted-foreground/70">
        Drop an alignment JSON + audio file, or pick them below.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "mt-6 flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-8 py-16 text-center transition-colors",
          dragOver ? "border-primer/60 bg-primer/5" : "border-border/50",
        )}
      >
        <p className="text-sm text-muted-foreground">drag & drop files here</p>
        <p className="text-xs text-muted-foreground/50">alignment .json + audio .mp3/.wav</p>

        <div className="mt-4 flex gap-3">
          <label className="cursor-pointer rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
            {alignmentFile ? alignmentFile.name : "pick alignment .json"}
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && setAlignmentFile(e.target.files[0])}
            />
          </label>
          <label className="cursor-pointer rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
            {audioFile ? audioFile.name : "pick audio"}
            <input
              type="file"
              accept=".mp3,.wav,.m4a,.ogg,.webm"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-destructive/80">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Char component
// ---------------------------------------------------------------------------

function CharSpan({
  char,
  active,
  mode,
  onClick,
}: {
  char: AlignmentChar
  active: boolean
  mode: DisplayMode
  onClick: () => void
}): React.JSX.Element {
  const tone = detectTone(char.pinyin)
  const cls = toneColor(tone)

  return (
    <span
      onClick={onClick}
      className={cn(
        "relative inline-flex cursor-pointer flex-col items-center transition-colors",
        active && "rounded-sm bg-primer/20",
        !active && "hover:bg-accent/30",
      )}
      style={{ padding: "2px 1px" }}
    >
      {(mode === "both" || mode === "pinyin") && (
        <span className={cn("text-[11px] leading-none", cls)}>{char.pinyin}</span>
      )}
      {(mode === "both" || mode === "hanzi") && (
        <span className="leading-snug">{char.ch}</span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sentence row
// ---------------------------------------------------------------------------

function SentenceRow({
  sentence,
  sentenceIdx,
  activeCharIdx,
  focused,
  mode,
  onCharClick,
  onSentenceClick,
  onFocus,
}: {
  sentence: AlignmentSentence
  sentenceIdx: number
  activeCharIdx: number | null
  focused: boolean
  mode: DisplayMode
  onCharClick: (sentenceIdx: number, charIdx: number) => void
  onSentenceClick: (sentenceIdx: number) => void
  onFocus: () => void
}): React.JSX.Element {
  // Walk through text chars, render AlignmentChars for CJK and plain spans for punctuation
  const rendered = useMemo(() => {
    const elements: React.JSX.Element[] = []
    let charI = 0
    for (let ti = 0; ti < sentence.text.length; ti++) {
      const textChar = sentence.text[ti]
      // Match against next alignment char
      if (charI < sentence.chars.length && sentence.chars[charI].ch === textChar) {
        const ci = charI
        elements.push(
          <CharSpan
            key={ti}
            char={sentence.chars[ci]}
            active={activeCharIdx === ci}
            mode={mode}
            onClick={() => onCharClick(sentenceIdx, ci)}
          />,
        )
        charI++
      } else {
        // Punctuation or whitespace — render inline
        elements.push(
          <span key={ti} className="inline-flex items-end leading-snug">
            {mode === "both" && <span className="text-[11px] leading-none opacity-0">&nbsp;</span>}
            <span>{textChar}</span>
          </span>,
        )
      }
    }
    return elements
  }, [sentence, sentenceIdx, activeCharIdx, mode, onCharClick])

  return (
    <div
      data-vim-panel="shadow-sentences"
      data-vim-index={sentenceIdx}
      onMouseEnter={onFocus}
      onClick={() => onSentenceClick(sentenceIdx)}
      className={cn(
        "scroll-mt-32 cursor-pointer rounded-lg px-3 py-2 transition-colors",
        focused ? "bg-accent/30 ring-1 ring-ring/20" : "hover:bg-accent/15",
      )}
    >
      <div className="reading-surface flex flex-wrap items-end gap-x-0.5">
        {rendered}
      </div>
      {sentence.charTiming === "interpolated" && (
        <span className="mt-1 block text-[10px] text-muted-foreground/30">interpolated timing</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed control
// ---------------------------------------------------------------------------

const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0]

function SpeedControl({
  speed,
  onSpeed,
}: {
  speed: number
  onSpeed: (s: number) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSpeed(s)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] tabular-nums font-medium transition-colors",
            Math.abs(speed - s) < 0.01
              ? "bg-accent text-foreground"
              : "text-muted-foreground/60 hover:text-foreground",
          )}
        >
          {s}×
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ShadowPlayer — the loaded shadowing surface
// ---------------------------------------------------------------------------

function ShadowPlayer({
  alignment,
  audioUrl,
  onShowHelp,
}: {
  alignment: Alignment
  audioUrl: string
  onShowHelp: () => void
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [focusSentence, setFocusSentence] = useState(0)
  const [mode, setMode] = useState<DisplayMode>("both")
  const [speed, setSpeed] = useState(0.8)
  const [looping, setLooping] = useState<{ startMs: number; endMs: number } | null>(null)

  const loopRef = useRef(looping)
  loopRef.current = looping

  // Active char/sentence from playback position
  const activeChar = useMemo(() => charAtTime(alignment.sentences, currentMs), [alignment, currentMs])
  const activeSentenceIdx = useMemo(() => sentenceAtTime(alignment.sentences, currentMs), [alignment, currentMs])

  // Sync speed to audio element
  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = speed
  }, [speed])

  // timeupdate → track position + A-B loop enforcement
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => {
      const ms = Math.round(audio.currentTime * 1000)
      setCurrentMs(ms)
      // A-B loop: seek back when past endMs
      const loop = loopRef.current
      if (loop && ms >= loop.endMs) {
        audio.currentTime = loop.startMs / 1000
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    audio.addEventListener("timeupdate", onTime)
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    return () => {
      audio.removeEventListener("timeupdate", onTime)
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
    }
  }, [])

  // Seek + play helpers
  const seekAndPlay = useCallback((ms: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
    audio.play().catch(() => {})
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [])

  // Char click → seek to that char's start
  const onCharClick = useCallback(
    (sentenceIdx: number, charIdx: number) => {
      const char = alignment.sentences[sentenceIdx]?.chars[charIdx]
      if (char) {
        setLooping(null)
        seekAndPlay(char.startMs)
      }
    },
    [alignment, seekAndPlay],
  )

  // Sentence click → play sentence
  const onSentenceClick = useCallback(
    (sentenceIdx: number) => {
      const s = alignment.sentences[sentenceIdx]
      if (s) {
        setLooping(null)
        setFocusSentence(sentenceIdx)
        seekAndPlay(s.startMs)
      }
    },
    [alignment, seekAndPlay],
  )

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === "?") { onShowHelp(); e.preventDefault(); return }

      const sentences = alignment.sentences

      switch (e.key) {
        case " ": {
          e.preventDefault()
          togglePlay()
          break
        }
        case "j": {
          const next = Math.min(focusSentence + 1, sentences.length - 1)
          setFocusSentence(next)
          setLooping(null)
          const el = document.querySelector(`[data-vim-index="${next}"]`) as HTMLElement | null
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
          e.preventDefault()
          break
        }
        case "k": {
          const next = Math.max(focusSentence - 1, 0)
          setFocusSentence(next)
          setLooping(null)
          const el = document.querySelector(`[data-vim-index="${next}"]`) as HTMLElement | null
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
          e.preventDefault()
          break
        }
        case "h": {
          // Jump back one sentence and play
          const prev = Math.max(focusSentence - 1, 0)
          setFocusSentence(prev)
          setLooping(null)
          if (sentences[prev]) seekAndPlay(sentences[prev].startMs)
          e.preventDefault()
          break
        }
        case "l": {
          // Jump forward one sentence and play
          const next = Math.min(focusSentence + 1, sentences.length - 1)
          setFocusSentence(next)
          setLooping(null)
          if (sentences[next]) seekAndPlay(sentences[next].startMs)
          e.preventDefault()
          break
        }
        case "Enter": {
          // Play focused sentence
          const s = sentences[focusSentence]
          if (s) {
            setLooping(null)
            seekAndPlay(s.startMs)
          }
          e.preventDefault()
          break
        }
        case "r": {
          // A-B loop on focused sentence
          const s = sentences[focusSentence]
          if (s) {
            setLooping({ startMs: s.startMs, endMs: s.endMs })
            seekAndPlay(s.startMs)
          }
          e.preventDefault()
          break
        }
        case "Escape": {
          // Stop loop / pause
          if (looping) {
            setLooping(null)
          } else {
            audioRef.current?.pause()
          }
          e.preventDefault()
          break
        }
        case "p": {
          // Cycle display mode
          setMode((m) => (m === "both" ? "hanzi" : m === "hanzi" ? "pinyin" : "both"))
          e.preventDefault()
          break
        }
        case "g": {
          setFocusSentence(0)
          e.preventDefault()
          break
        }
        case "G": {
          setFocusSentence(sentences.length - 1)
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [alignment, focusSentence, looping, onShowHelp, seekAndPlay, togglePlay])

  // Format time as m:ss.d
  const formatTime = (ms: number) => {
    const s = ms / 1000
    const m = Math.floor(s / 60)
    const sec = (s % 60).toFixed(1)
    return `${m}:${Number(sec) < 10 ? "0" : ""}${sec}`
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-sm font-medium tracking-tight">
          {alignment.media.file.split("/").pop() ?? "Shadow"}
        </h2>
        <p className="text-xs text-muted-foreground/60">
          {alignment.sentences.length} sentence{alignment.sentences.length !== 1 ? "s" : ""} ·{" "}
          {formatTime(alignment.media.durationMs)} · {alignment.media.asr}
        </p>
      </div>

      {/* Controls bar */}
      <div className="sticky top-[57px] z-20 flex items-center gap-3 rounded-lg border border-border/50 bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
        <Button variant="ghost" size="xs" onClick={togglePlay} className="tabular-nums">
          {playing ? "⏸" : "▶"}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">{formatTime(currentMs)}</span>
        <SpeedControl speed={speed} onSpeed={setSpeed} />
        <div className="ml-auto flex items-center gap-1">
          {(["both", "hanzi", "pinyin"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                mode === m ? "bg-accent text-foreground" : "text-muted-foreground/60 hover:text-foreground",
              )}
            >
              {m === "both" ? "拼+汉" : m === "hanzi" ? "汉字" : "拼音"}
            </button>
          ))}
        </div>
        {looping && (
          <span className="rounded-full bg-primer/15 px-2 py-0.5 text-[10px] font-medium text-primer">
            looping
          </span>
        )}
      </div>

      {/* Sentences */}
      <div className="mt-4 space-y-2">
        {alignment.sentences.map((sentence, idx) => (
          <SentenceRow
            key={idx}
            sentence={sentence}
            sentenceIdx={idx}
            activeCharIdx={activeChar?.sentenceIdx === idx ? activeChar.charIdx : null}
            focused={focusSentence === idx}
            mode={mode}
            onCharClick={onCharClick}
            onSentenceClick={onSentenceClick}
            onFocus={() => setFocusSentence(idx)}
          />
        ))}
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="auto" />

      <p className="mt-8 text-[11px] text-muted-foreground/35">
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Space</kbd> play/pause ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">j</kbd>/
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">k</kbd> focus ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">h</kbd>/
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">l</kbd> jump+play ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Enter</kbd> play sentence ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">r</kbd> loop ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">p</kbd> toggle display ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">?</kbd> help
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ShadowView — outer shell (file loader → player)
// ---------------------------------------------------------------------------

export function ShadowView({ onShowHelp }: { onShowHelp: () => void }): React.JSX.Element {
  const [loaded, setLoaded] = useState<LoadedState | null>(null)

  if (!loaded) {
    return <FileLoader onLoaded={setLoaded} />
  }

  return <ShadowPlayer alignment={loaded.alignment} audioUrl={loaded.audioUrl} onShowHelp={onShowHelp} />
}
