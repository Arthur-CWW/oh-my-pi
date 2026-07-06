import { ChevronRight } from "lucide-react"
import type * as React from "react"

import type { EvidenceHit, EvidenceSource } from "@/api"
import { cn } from "@/lib/utils"
import { readerRefUrl } from "@/lib/reader-link"
import { RefChip, SUBSTRATE_DOT, SUBSTRATE_LABEL, SourceBadge, TimeAgo, focusRing } from "./atoms"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"

const ORDER: EvidenceSource[] = ["reader", "twitter", "browser"]

interface IndexedHit {
  hit: EvidenceHit
  index: number
}

function group(hits: EvidenceHit[]): { source: EvidenceSource; items: IndexedHit[] }[] {
  const buckets: Record<EvidenceSource, IndexedHit[]> = { reader: [], twitter: [], browser: [] }
  hits.forEach((hit, index) => {
    buckets[hit.source].push({ hit, index })
  })
  return ORDER.filter((s) => buckets[s].length > 0).map((source) => ({ source, items: buckets[source] }))
}

function EvidenceRow({
  hit,
  index,
  nav,
  focused,
  onFocus,
}: {
  hit: EvidenceHit
  index: number
  nav: boolean
  focused: boolean
  onFocus: () => void
}): React.JSX.Element {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug text-foreground/90">{hit.title || hit.ref}</span>
        <TimeAgo iso={hit.timestamp} className="pt-0.5" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <SourceBadge source={hit.source} kind={hit.kind} />
        <RefChip>{hit.ref}</RefChip>
      </div>
      {hit.snippet ? <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{hit.snippet}</p> : null}
    </>
  )

  const className = cn(focusRing(focused), "block px-2.5 py-2 text-sm")
  const panel = nav ? "ask" : undefined
  const vimIndex = nav ? index : undefined
  const hover = nav ? onFocus : undefined
  // Reader refs deep-link into the Talmudic reader; every other source
  // already carries its own url on the hit.
  const href = hit.url ?? readerRefUrl(hit.ref)

  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className} data-vim-panel={panel} data-vim-index={vimIndex} onMouseEnter={hover}>
      {inner}
    </a>
  ) : (
    <div className={className} data-vim-panel={panel} data-vim-index={vimIndex} onMouseEnter={hover}>
      {inner}
    </div>
  )
}

export function EvidenceList({
  hits,
  open,
  onOpenChange,
  nav,
  isFocused,
  onFocus,
}: {
  hits: EvidenceHit[]
  open: boolean
  onOpenChange: (open: boolean) => void
  nav: boolean
  isFocused: (index: number) => boolean
  onFocus: (index: number) => void
}): React.JSX.Element | null {
  if (hits.length === 0) return null
  const groups = group(hits)

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border border-border/60 bg-muted/20">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        evidence <span className="tabular-nums">({hits.length})</span>
        <span className="ml-auto flex items-center gap-2">
          {groups.map((g) => (
            <span key={g.source} className="inline-flex items-center gap-1 tabular-nums">
              <span aria-hidden className={cn("size-1.5 rounded-full", SUBSTRATE_DOT[g.source])} />
              {g.items.length}
            </span>
          ))}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        {groups.map((g) => (
          <div key={g.source} className="space-y-1">
            <div className="flex items-center gap-1.5 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground/60">
              <span aria-hidden className={cn("size-1.5 rounded-full", SUBSTRATE_DOT[g.source])} />
              {SUBSTRATE_LABEL[g.source]}
              <span className="tabular-nums">({g.items.length})</span>
            </div>
            {g.items.map(({ hit, index }) => (
              <EvidenceRow key={index} hit={hit} index={index} nav={nav} focused={nav && isFocused(index)} onFocus={() => onFocus(index)} />
            ))}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
