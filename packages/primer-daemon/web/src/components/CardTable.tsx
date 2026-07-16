import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import { type Card, type CardStatus, enrollCardCandidate, getCardCandidates } from "@/api"
import { cn } from "@/lib/utils"
import { EmptyHint, InlineError } from "./atoms"
import { Button } from "./ui/button"
import { Skeleton } from "./ui/skeleton"

type CardTableStatus = CardStatus | "enrolled"
type CardFilter = "all" | CardTableStatus

const FILTERS: Array<{ value: CardFilter; label: string }> = [
  { value: "all", label: "all" },
  { value: "candidate", label: "candidate" },
  { value: "approved", label: "approved" },
  { value: "rejected", label: "rejected" },
  { value: "enrolled", label: "enrolled" },
]

const STATUS_CLASS: Record<CardTableStatus, string> = {
  candidate: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  enrolled: "border-sky-400/30 bg-sky-400/10 text-sky-300",
}

function cardStatus(card: Card): CardTableStatus {
  return card.enrolled === true ? "enrolled" : card.status
}

function jitterFor(id: number): { rotation: number; offset: number } {
  let mixed = Math.imul(id ^ 0x9e3779b9, 0x45d9f3b)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
  mixed ^= mixed >>> 16
  return {
    rotation: (mixed >>> 0) % 7 - 3,
    offset: (mixed >>> 4) % 7 - 3,
  }
}

function CardFace({
  card,
  index,
  focused,
  cardRef,
  onFocus,
  onOpen,
}: {
  card: Card
  index: number
  focused: boolean
  cardRef: (element: HTMLButtonElement | null) => void
  onFocus: () => void
  onOpen: () => void
}): React.JSX.Element {
  const jitter = jitterFor(card.id)
  const status = cardStatus(card)

  return (
    <button
      ref={cardRef}
      type="button"
      data-card-table-card={card.id}
      data-card-table-index={index}
      aria-label={`Open card: ${card.front}`}
      onFocus={onFocus}
      onClick={onOpen}
      className={cn(
        "group relative mb-4 flex min-h-44 w-full break-inside-avoid flex-col overflow-hidden rounded-2xl border bg-card p-5 text-left text-card-foreground shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        focused ? "border-primer/60 ring-1 ring-primer/50" : "border-border/80",
      )}
      style={{
        transform: `rotate(${jitter.rotation / 2}deg) translateY(${jitter.offset}px)`,
        contentVisibility: "auto",
      }}
    >
      <span className={cn("absolute right-3 top-3 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", STATUS_CLASS[status])}>
        {status}
      </span>
      <span className="relative mt-5 flex min-h-28 flex-1 items-center justify-center text-center">
        <span className="text-4xl font-semibold leading-tight tracking-tight transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0 sm:text-5xl">
          {card.front}
        </span>
        <span className="absolute inset-0 flex items-center justify-center px-2 text-base leading-relaxed text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          {card.back}
        </span>
      </span>
      <span className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground/70">
        <span className="truncate">{card.sourceRef ?? "ledger candidate"}</span>
        <span className="shrink-0 uppercase tracking-wide">hover to peek</span>
      </span>
    </button>
  )
}

function DetailPopover({
  card,
  actionBusy,
  actionError,
  onClose,
  onEnroll,
}: {
  card: Card
  actionBusy: boolean
  actionError: string | null
  onClose: () => void
  onEnroll: () => void
}): React.JSX.Element {
  const status = cardStatus(card)
  const canEnroll = status === "approved"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-table-detail-title"
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">card detail</p>
            <h2 id="card-table-detail-title" className="mt-1 text-3xl font-semibold tracking-tight">{card.front}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close card detail" className="rounded-md px-2 py-1 text-lg text-muted-foreground hover:bg-accent hover:text-foreground">
            ×
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">front</p>
            <p className="mt-2 whitespace-pre-wrap text-xl leading-relaxed">{card.front}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">back</p>
            <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-muted-foreground">{card.back}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("rounded-full border px-2 py-1 font-medium", STATUS_CLASS[status])}>{status}</span>
          {card.sourceRef ? <code className="break-all rounded bg-muted px-2 py-1">{card.sourceRef}</code> : null}
          {card.url ? (
            <a href={card.url} target="_blank" rel="noreferrer" className="text-primer underline-offset-2 hover:underline">
              open provenance ↗
            </a>
          ) : null}
        </div>

        {actionError ? <div className="mt-4"><InlineError message={actionError} /></div> : null}
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground/70">Esc closes · source opens in a new tab</p>
          {canEnroll ? (
            <Button type="button" onClick={onEnroll} disabled={actionBusy} className="h-9">
              {actionBusy ? "Enrolling…" : "Enroll for review"}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export function CardTable(): React.JSX.Element {
  const [cards, setCards] = useState<Card[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<CardFilter>("all")
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [openCardId, setOpenCardId] = useState<number | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    let alive = true
    setError(null)
    getCardCandidates("all", 500).then(
      (loaded) => {
        if (alive) setCards(loaded)
      },
      (cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Failed to load cards")
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const allCards = cards ?? []
  const counts = useMemo(() => {
    const result: Record<CardFilter, number> = { all: allCards.length, candidate: 0, approved: 0, rejected: 0, enrolled: 0 }
    for (const card of allCards) result[cardStatus(card)] += 1
    return result
  }, [allCards])
  const visibleCards = useMemo(
    () => (filter === "all" ? allCards : allCards.filter((card) => cardStatus(card) === filter)),
    [allCards, filter],
  )
  const openCard = openCardId === null ? null : allCards.find((card) => card.id === openCardId) ?? null

  const focusCard = useCallback((index: number) => {
    if (visibleCards.length === 0) return
    const nextIndex = (index + visibleCards.length) % visibleCards.length
    setFocusedIndex(nextIndex)
    cardRefs.current[nextIndex]?.focus()
  }, [visibleCards.length])

  useEffect(() => {
    setFocusedIndex((current) => Math.min(current, Math.max(visibleCards.length - 1, 0)))
    cardRefs.current = []
  }, [filter, visibleCards.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (openCard !== null) {
        if (event.key === "Escape") {
          event.preventDefault()
          setOpenCardId(null)
          setActionError(null)
        }
        return
      }
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return
      if (event.key === "j" || event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault()
        focusCard(focusedIndex + 1)
      } else if (event.key === "k" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault()
        focusCard(focusedIndex - 1)
      } else if (event.key === "Enter") {
        const card = visibleCards[focusedIndex]
        if (card) {
          event.preventDefault()
          setOpenCardId(card.id)
          setActionError(null)
        }
      } else if (event.key === "Escape") {
        setActionError(null)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [focusCard, focusedIndex, openCard, visibleCards])

  const handleEnroll = useCallback(() => {
    if (openCard === null || cardStatus(openCard) !== "approved" || actionBusy) return
    setActionBusy(true)
    setActionError(null)
    enrollCardCandidate(openCard.id).then(
      () => {
        setCards((current) => current?.map((card) => (card.id === openCard.id ? { ...card, enrolled: true } : card)) ?? current)
      },
      (cause: unknown) => setActionError(cause instanceof Error ? cause.message : "Could not enroll card"),
    ).finally(() => setActionBusy(false))
  }, [actionBusy, openCard])

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 min-[1200px]:max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-primer/80">the deck</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Cards on the table</h1>
          <p className="mt-1 text-sm text-muted-foreground">{filter === "all" ? `${allCards.length} cards` : `${visibleCards.length} ${filter} cards`} · j/k or arrows move · Enter opens</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter cards by status">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === option.value ? "border-primer/50 bg-primer/10 text-foreground" : "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {option.label} <span className="tabular-nums opacity-70">{counts[option.value]}</span>
            </button>
          ))}
        </div>
      </header>

      {error ? <InlineError message={error} /> : null}
      {cards === null && error === null ? (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
          {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="mb-4 h-44 break-inside-avoid rounded-2xl" />)}
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <EmptyHint>{filter === "all" ? "No card candidates yet." : `No ${filter} cards right now.`}</EmptyHint>
        </div>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4" aria-label="Card table">
          {visibleCards.map((card, index) => (
            <CardFace
              key={card.id}
              card={card}
              index={index}
              focused={focusedIndex === index}
              cardRef={(element) => { cardRefs.current[index] = element }}
              onFocus={() => setFocusedIndex(index)}
              onOpen={() => {
                setOpenCardId(card.id)
                setActionError(null)
              }}
            />
          ))}
        </div>
      )}

      {openCard ? (
        <DetailPopover
          card={openCard}
          actionBusy={actionBusy}
          actionError={actionError}
          onClose={() => {
            setOpenCardId(null)
            setActionError(null)
          }}
          onEnroll={handleEnroll}
        />
      ) : null}
    </main>
  )
}
