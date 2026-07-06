import { useCallback, useEffect, useRef, useState } from "react"
import type * as React from "react"

import { type ReaderDocSummary, createReaderDoc, getReaderDocs } from "@/api"
import { navigate } from "@/hooks/useHashRoute"
import { cn } from "@/lib/utils"
import { focusRing } from "./atoms"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"

// ---------------------------------------------------------------------------
// Doc row
// ---------------------------------------------------------------------------

function DocRow({
  doc,
  index,
  focused,
  onFocus,
}: {
  doc: ReaderDocSummary
  index: number
  focused: boolean
  onFocus: () => void
}): React.JSX.Element {
  return (
    <div
      data-vim-panel="docs"
      data-vim-index={index}
      onMouseEnter={onFocus}
      onClick={() => navigate(`/read/${doc.id}`)}
      className={cn(
        focusRing(focused),
        "flex cursor-pointer items-baseline justify-between gap-4 px-3 py-2.5",
      )}
    >
      <div className="min-w-0">
        <span className="text-sm font-medium">{doc.title}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {doc.paragraphCount}段
          {doc.markCount > 0 ? ` · ${doc.markCount} marks` : ""}
        </span>
      </div>
      <time className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
        {new Date(doc.createdAt).toLocaleDateString()}
      </time>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReadLibrary
// ---------------------------------------------------------------------------

export function ReadLibrary({ onShowHelp }: { onShowHelp: () => void }): React.JSX.Element {
  const [docs, setDocs] = useState<ReaderDocSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [showPaste, setShowPaste] = useState(false)
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const filterRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // Fetch docs
  useEffect(() => {
    let alive = true
    getReaderDocs().then(
      (d) => {
        if (alive) setDocs(d)
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load docs")
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const filtered =
    docs?.filter((d) => !filter || d.title.toLowerCase().includes(filter.toLowerCase())) ?? []

  // Submit new doc — raw text, let backend split paragraphs
  const onSubmit = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault()
      if (!title.trim() || !text.trim()) return
      setSubmitting(true)
      try {
        const result = await createReaderDoc(title.trim(), text)
        navigate(`/read/${result.id}`)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to create document")
        setSubmitting(false)
      }
    },
    [title, text],
  )

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
        if (showFilter) {
          setShowFilter(false)
          setFilter("")
          e.preventDefault()
          return
        }
        if (showPaste) {
          setShowPaste(false)
          e.preventDefault()
          return
        }
        setFocusIdx(-1)
        e.preventDefault()
        return
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === "?") {
        onShowHelp()
        e.preventDefault()
        return
      }

      switch (e.key) {
        case "j":
          if (filtered.length > 0) setFocusIdx((i) => Math.min(i + 1, filtered.length - 1))
          e.preventDefault()
          break
        case "k":
          if (filtered.length > 0) setFocusIdx((i) => Math.max(i - 1, 0))
          e.preventDefault()
          break
        case "g":
          if (filtered.length > 0) setFocusIdx(0)
          e.preventDefault()
          break
        case "G":
          if (filtered.length > 0) setFocusIdx(filtered.length - 1)
          e.preventDefault()
          break
        case "Enter": {
          const doc = filtered[focusIdx]
          if (doc) navigate(`/read/${doc.id}`)
          e.preventDefault()
          break
        }
        case "/":
          setShowFilter(true)
          requestAnimationFrame(() => filterRef.current?.focus())
          e.preventDefault()
          break
        case "n":
          setShowPaste(true)
          requestAnimationFrame(() => titleRef.current?.focus())
          e.preventDefault()
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [filtered, focusIdx, showFilter, showPaste, onShowHelp])

  // Scroll focused into view
  useEffect(() => {
    if (focusIdx < 0) return
    const el = document.querySelector(
      `[data-vim-panel="docs"][data-vim-index="${focusIdx}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focusIdx])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Reading</h2>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => {
            setShowPaste((v) => !v)
            if (!showPaste) requestAnimationFrame(() => titleRef.current?.focus())
          }}
        >
          {showPaste ? "cancel" : "+ paste"}
        </Button>
      </div>

      {showFilter && (
        <div className="mt-3">
          <Input
            ref={filterRef}
            placeholder="filter docs…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setFocusIdx(-1)
            }}
            className="h-8 text-sm"
          />
        </div>
      )}

      {showPaste && (
        <form onSubmit={onSubmit} className="mt-4 space-y-3 rounded-lg border border-border/60 bg-card p-4">
          <Input
            ref={titleRef}
            placeholder="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-sm"
            disabled={submitting}
          />
          <Textarea
            placeholder="paste Chinese text here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-32 text-sm"
            disabled={submitting}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={submitting || !title.trim() || !text.trim()}>
              {submitting ? "saving…" : "save & read"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPaste(false)}>
              cancel
            </Button>
          </div>
        </form>
      )}

      {error && <p className="mt-3 text-xs text-destructive/80">{error}</p>}

      <div className="mt-4 space-y-1">
        {docs === null && !error && (
          <p className="py-8 text-center text-sm text-muted-foreground/60">loading…</p>
        )}
        {docs !== null && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground/60">
            {filter ? "no matches" : "no documents yet — paste one above"}
          </p>
        )}
        {filtered.map((doc, i) => (
          <DocRow
            key={doc.id}
            doc={doc}
            index={i}
            focused={focusIdx === i}
            onFocus={() => setFocusIdx(i)}
          />
        ))}
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground/35">
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">j</kbd>/
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">k</kbd> navigate ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Enter</kbd> open ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">/</kbd> filter ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">n</kbd> new ·{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">?</kbd> help
      </p>
    </div>
  )
}
