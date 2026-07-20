import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import { type AnkiProfile, type Card, type CardStatus, enrollCardCandidate, getAnkiProfile, getCardCandidates } from "@/api"
import { cn } from "@/lib/utils"
import { EmptyHint, InlineError } from "./atoms"
import { Button } from "./ui/button"
import { Skeleton } from "./ui/skeleton"

type CardTableStatus = CardStatus | "enrolled"
type CardFilter = "all" | CardTableStatus

const FILTERS: Array<{ value: CardFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "candidate", label: "候选" },
  { value: "approved", label: "通过" },
  { value: "rejected", label: "弃用" },
  { value: "enrolled", label: "已入复习" },
]

const STATUS_CLASS: Record<CardTableStatus, string> = {
  candidate: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  enrolled: "border-sky-400/30 bg-sky-400/10 text-sky-300",
}

const STATUS_LABEL: Record<CardTableStatus, string> = {
  candidate: "候选",
  approved: "通过",
  rejected: "弃用",
  enrolled: "已入复习",
}

function cardStatus(card: Card): CardTableStatus {
  return card.enrolled === true ? "enrolled" : card.status
}

const HAN_RUN = /\p{Script=Han}+/u
const CHINESE_SPAN = /[\p{Script=Han}][\p{Script=Han}\u3000 ，。！？；：、…“”‘’《》—·]*/gu
const COUNT_FORMAT = new Intl.NumberFormat("zh-CN")
const BRACKET_GLOSS = /\([^)]*\)|\[[^\]]*]|\{[^}]*}|（[^）]*）|【[^】]*】/g

function targetFromCard(card: Card): string {
  const sourceTokens = card.sourceRef?.split(/[\/\\._:#\-\s]+/u).filter(Boolean) ?? []
  const sourceTarget = sourceTokens.reverse().find((token) => HAN_RUN.test(token))?.match(HAN_RUN)?.[0]
  return sourceTarget ?? `${card.front}\n${card.back}`.match(HAN_RUN)?.[0] ?? "词"
}

function chineseContext(card: Card, target: string): string[] {
  const text = `${card.back}\n${card.front}`.replace(BRACKET_GLOSS, "\n")
  const spans = text.match(CHINESE_SPAN) ?? []
  const seen = new Set<string>()

  return spans
    .map((span) => span.replace(/\s+/g, " ").trim())
    .filter((span) => {
      const comparison = span.replace(/[，。！？；：、…“”‘’《》—·]+$/u, "")
      if (comparison === target || !comparison.includes(target) || seen.has(span)) return false
      seen.add(span)
      return true
    })
    .slice(0, 4)
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
  const status = cardStatus(card)
  const target = targetFromCard(card)
  const contexts = chineseContext(card, target)
  const targetSize = target.length <= 2 ? "text-4xl" : target.length <= 4 ? "text-3xl" : "text-2xl"

  return (
    <button
      ref={cardRef}
      type="button"
      data-card-table-card={card.id}
      data-card-table-index={index}
      aria-label={`打开习得卡片：${target}`}
      onFocus={onFocus}
      onClick={onOpen}
      className={cn(
        "group mb-3 w-full break-inside-avoid rounded-2xl border bg-card p-4 text-left text-card-foreground shadow-sm transition-[border-color,box-shadow,background-color] duration-150 hover:border-primer/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        focused ? "border-primer/60 ring-1 ring-primer/50" : "border-border/80",
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground/60">习得</span>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", STATUS_CLASS[status])}>
          {STATUS_LABEL[status]}
        </span>
      </span>
      <span className={cn("mt-3 block font-semibold leading-tight tracking-tight", targetSize)}>{target}</span>
      {contexts.length > 0 ? (
        <span className="mt-3 block text-sm leading-6 text-muted-foreground">
          {contexts.map((context) => <span key={context} className="block">{context}</span>)}
        </span>
      ) : null}
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
  const target = targetFromCard(card)
  const contexts = chineseContext(card, target)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-table-detail-title"
        className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.18em] text-primer/80">习得卡片</p>
            <h2 id="card-table-detail-title" className="mt-2 text-4xl font-semibold leading-tight tracking-tight">{target}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭卡片详情" className="rounded-md px-2 py-1 text-lg text-muted-foreground hover:bg-accent hover:text-foreground">
            ×
          </button>
        </div>

        {contexts.length > 0 ? (
          <div className="mt-6 rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[10px] tracking-[0.14em] text-muted-foreground/70">语境</p>
            <div className="mt-2 space-y-2">
              {contexts.map((context) => <p key={context} className="text-lg leading-relaxed">{context}</p>)}
            </div>
          </div>
        ) : null}

        <p className="mt-4 rounded-xl bg-primer/5 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          先认目标，再回到语境；需要时才展开英文辅助。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("rounded-full border px-2 py-1 font-medium", STATUS_CLASS[status])}>{STATUS_LABEL[status]}</span>
          {card.sourceRef ? <span title={card.sourceRef} className="max-w-56 truncate rounded bg-muted px-2 py-1">{card.sourceRef}</span> : null}
          {card.url ? (
            <a href={card.url} target="_blank" rel="noreferrer" className="text-primer underline-offset-2 hover:underline">
              出处 ↗
            </a>
          ) : null}
        </div>

        <details className="mt-5 rounded-xl border border-border/70">
          <summary className="cursor-pointer px-4 py-3 text-sm text-muted-foreground hover:text-foreground">英文辅助</summary>
          <div className="grid gap-3 border-t border-border/70 p-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] tracking-wide text-muted-foreground/60">提示</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{card.front}</p>
            </div>
            <div>
              <p className="text-[10px] tracking-wide text-muted-foreground/60">解释</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{card.back}</p>
            </div>
          </div>
        </details>

        {actionError ? <div className="mt-4"><InlineError message={actionError} /></div> : null}
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground/70">Esc 关闭</p>
          {canEnroll ? (
            <Button type="button" onClick={onEnroll} disabled={actionBusy} className="h-9">
              {actionBusy ? "加入中…" : "加入复习"}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export function CardTable(): React.JSX.Element {
  const [cards, setCards] = useState<Card[] | null>(null)
  const [ankiProfile, setAnkiProfile] = useState<AnkiProfile | null>(null)
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
    Promise.all([getCardCandidates("all", 500), getAnkiProfile()]).then(
      ([loadedCards, loadedProfile]) => {
        if (alive) {
          setCards(loadedCards)
          setAnkiProfile(loadedProfile)
        }
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
          <p className="text-[11px] tracking-[0.2em] text-primer/80">习得面板</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">卡片桌面</h1>
          <p className="mt-1 text-sm text-muted-foreground">{filter === "all" ? `${allCards.length} 张` : `${visibleCards.length} 张${FILTERS.find((option) => option.value === filter)?.label ?? ""}卡片`} · j/k 移动 · Enter 打开</p>
          {ankiProfile ? (
            <p className="mt-1 text-xs tabular-nums text-muted-foreground" aria-label="Anki 同步状态">
              {ankiProfile.snapshotAt === null
                ? "Anki 尚未同步"
                : `Anki 同步于 ${ankiProfile.snapshotAt} · 已复习 ${COUNT_FORMAT.format(ankiProfile.cardCount)} 张 · 星标 ${COUNT_FORMAT.format(ankiProfile.starredCount)} 张 · 复习事件 ${COUNT_FORMAT.format(ankiProfile.reviewEventCount)} 次`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="按状态筛选卡片">
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
        <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">
          {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="mb-3 h-36 break-inside-avoid rounded-2xl" />)}
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <EmptyHint>{filter === "all" ? "还没有候选卡片。" : `目前没有${FILTERS.find((option) => option.value === filter)?.label ?? ""}卡片。`}</EmptyHint>
        </div>
      ) : (
        <div className="columns-1 gap-3 sm:columns-2 xl:columns-3" aria-label="Card table">
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
