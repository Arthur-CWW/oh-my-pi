import { Check, X } from "lucide-react"
import type * as React from "react"

import type { Card, CardStatus } from "@/api"
import { cn } from "@/lib/utils"
import { EmptyHint, InlineError, RefChip, Section, focusRing } from "./atoms"
import { Button } from "./ui/button"
import { Skeleton } from "./ui/skeleton"

function Candidate({
  card,
  index,
  focused,
  onFocus,
  onSet,
}: {
  card: Card
  index: number
  focused: boolean
  onFocus: () => void
  onSet: (id: number, status: CardStatus) => void
}): React.JSX.Element {
  return (
    <div data-vim-panel="cards" data-vim-index={index} onMouseEnter={onFocus} className={cn(focusRing(focused), "p-3")}>
      <p className="font-medium leading-snug">{card.front}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{card.back}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" data-card-approve={card.id} onClick={() => onSet(card.id, "approved")} className="h-7 gap-1.5 px-2.5">
          <Check className="size-3.5" /> Approve
          <kbd className="ml-0.5 rounded bg-primary-foreground/15 px-1 font-mono text-[10px]">a</kbd>
        </Button>
        <Button variant="outline" size="sm" onClick={() => onSet(card.id, "rejected")} className="h-7 gap-1.5 px-2.5 text-muted-foreground">
          <X className="size-3.5" /> Reject
          <kbd className="ml-0.5 rounded bg-muted px-1 font-mono text-[10px]">r</kbd>
        </Button>
        {card.url ? (
          <a href={card.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-primer hover:underline">
            source
          </a>
        ) : card.sourceRef ? (
          <span className="ml-auto">
            <RefChip>{card.sourceRef}</RefChip>
          </span>
        ) : null}
      </div>
    </div>
  )
}

function ResolvedRow({ card, onSet }: { card: Card; onSet: (id: number, status: CardStatus) => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full",
          card.status === "approved" ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground/70",
        )}
      >
        {card.status === "approved" ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <span className="truncate text-muted-foreground/80">{card.front}</span>
      <button
        type="button"
        onClick={() => onSet(card.id, "candidate")}
        className="ml-auto shrink-0 text-[11px] text-muted-foreground/60 underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        undo
      </button>
    </div>
  )
}

export function CardsPanel({
  candidates,
  resolved,
  loading,
  error,
  actionError,
  active,
  isFocused,
  onFocus,
  onSet,
}: {
  candidates: Card[]
  resolved: Card[]
  loading: boolean
  error: string | null
  actionError: string | null
  active: boolean
  isFocused: (index: number) => boolean
  onFocus: (index: number) => void
  onSet: (id: number, status: CardStatus) => void
}): React.JSX.Element {
  return (
    <Section
      id="cards"
      label="review"
      count={candidates.length}
      active={active}
      caption="Approve or reject candidate cards — your taste trains what the dæmon surfaces next."
    >
      {actionError ? <div className="mb-2"><InlineError message={actionError} /></div> : null}

      {error && candidates.length === 0 && resolved.length === 0 ? (
        <InlineError message={error} />
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : candidates.length === 0 && resolved.length === 0 ? (
        <EmptyHint>No cards yet. Approve candidates as the dæmon proposes them.</EmptyHint>
      ) : (
        <div className="space-y-4">
          {candidates.length > 0 ? (
            <div className="space-y-2">
              {candidates.map((card, index) => (
                <Candidate key={card.id} card={card} index={index} focused={isFocused(index)} onFocus={() => onFocus(index)} onSet={onSet} />
              ))}
            </div>
          ) : (
            <EmptyHint>Queue clear — every candidate reviewed.</EmptyHint>
          )}

          {resolved.length > 0 ? (
            <div className="space-y-0.5 border-t border-border/60 pt-3">
              <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground/50">reviewed ({resolved.length})</p>
              {resolved.map((card) => (
                <ResolvedRow key={card.id} card={card} onSet={onSet} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  )
}
