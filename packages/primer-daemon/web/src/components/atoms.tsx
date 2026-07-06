import type * as React from "react"

import type { EvidenceSource } from "@/api"
import { relativeShort } from "@/lib/relative-time"
import { cn } from "@/lib/utils"

export const SUBSTRATE_LABEL: Record<EvidenceSource, string> = {
  browser: "browser",
  twitter: "tweets",
  reader: "reading",
}

/** Restrained, functional per-substrate dot — a scanning aid, not decoration. */
export const SUBSTRATE_DOT: Record<EvidenceSource, string> = {
  browser: "bg-sky-400/80",
  twitter: "bg-primer",
  reader: "bg-emerald-400/80",
}

/** Focus-ring treatment shared by every vim-navigable item. */
export const focusRing = (focused: boolean): string =>
  cn(
    "scroll-mt-24 rounded-lg border transition-colors",
    focused ? "border-ring/80 bg-accent/50 ring-1 ring-ring/70" : "border-border/60 bg-muted/10 hover:bg-accent/30",
  )

export function Section({
  id,
  label,
  caption,
  count,
  active,
  action,
  children,
}: {
  id: string
  label: string
  caption?: string
  count?: number
  active?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      data-vim-panel={id}
      aria-current={active ? "true" : undefined}
      className={cn(
        "scroll-mt-20 rounded-xl border bg-card text-card-foreground shadow-sm transition-colors",
        active ? "border-primer/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 px-4 pt-4">
        <span aria-hidden className={cn("h-3.5 w-[3px] rounded-full transition-colors", active ? "bg-primer" : "bg-transparent")} />
        <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
        {count !== undefined ? <span className="tabular-nums text-xs text-muted-foreground">{count}</span> : null}
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {caption ? <p className="px-4 pt-1 text-xs leading-relaxed text-muted-foreground/70">{caption}</p> : null}
      <div className="px-4 pb-4 pt-3">{children}</div>
    </section>
  )
}

export function SourceBadge({ source, kind }: { source: EvidenceSource; kind?: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", SUBSTRATE_DOT[source])} />
      {SUBSTRATE_LABEL[source]}
      {kind ? <span className="text-muted-foreground/60">· {kind}</span> : null}
    </span>
  )
}

export function RefChip({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <code className={cn("break-all rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground", className)}>{children}</code>
}

export function KindBadge({ kind }: { kind: string }): React.JSX.Element {
  return <span className="inline-flex items-center rounded-md border border-primer/25 bg-primer/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primer/90">{kind}</span>
}

export function TimeAgo({ iso, className }: { iso: string | null; className?: string }): React.JSX.Element {
  return (
    <time dateTime={iso ?? undefined} className={cn("shrink-0 tabular-nums text-xs text-muted-foreground/80", className)}>
      {relativeShort(iso)}
    </time>
  )
}

export function InlineError({ message }: { message: string }): React.JSX.Element {
  return <p className="text-xs text-destructive/80">{message}</p>
}

export function EmptyHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="py-1 text-sm text-muted-foreground/70">{children}</p>
}
