import type * as React from "react"

import { type EvidenceSource, getStatus } from "@/api"
import { usePolled } from "@/hooks/usePolled"
import { ageMs, relativeShort } from "@/lib/relative-time"
import { cn } from "@/lib/utils"
import { SUBSTRATE_LABEL } from "./atoms"

const DAY = 86_400_000

function freshnessDot(exists: boolean, mtime: string | null): string {
  if (!exists) return "bg-muted-foreground/40"
  const age = ageMs(mtime)
  if (age === null) return "bg-muted-foreground/40"
  if (age < DAY) return "bg-emerald-400/80"
  if (age < 7 * DAY) return "bg-amber-400/80"
  return "bg-rose-400/70"
}

function FreshnessChip({ name, exists, mtime }: { name: EvidenceSource; exists: boolean; mtime: string | null }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", freshnessDot(exists, mtime))} />
      <span className="font-medium text-foreground/80">{SUBSTRATE_LABEL[name]}</span>
      <span className="tabular-nums">{exists ? relativeShort(mtime) : "absent"}</span>
    </span>
  )
}

function Ledger({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <span className="text-[11px] text-muted-foreground">
      <span className="font-medium tabular-nums text-foreground/80">{value}</span> {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Nav — driven by routeSegment prop from App (re-renders on every route change)
// ---------------------------------------------------------------------------

const NAV_LINKS: Array<{ href: string; label: string; segment: string }> = [
  { href: "#/", label: "Dashboard", segment: "" },
  { href: "#/read", label: "Read", segment: "read" },
  { href: "#/review", label: "Review", segment: "review" },
  { href: "#/shadow", label: "Shadow", segment: "shadow" },
]

function Nav({ segment }: { segment: string }): React.JSX.Element {
  return (
    <nav className="flex items-center gap-0.5">
      {NAV_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors",
            link.segment === segment
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {link.label}
        </a>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function Header({ routeSegment = "" }: { routeSegment?: string }): React.JSX.Element {
  const { data, error } = usePolled(getStatus, 30_000)

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto w-full max-w-3xl px-4 py-3 min-[1200px]:max-w-6xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-semibold tracking-tight">Primer</h1>
              <span className="text-xs text-muted-foreground">dæmon</span>
            </div>
            <Nav segment={routeSegment} />
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {error ? (
            <span className="text-[11px] text-destructive/80">substrate status unavailable</span>
          ) : data ? (
            <>
              {data.substrates.map((s) => (
                <FreshnessChip key={s.name} name={s.name} exists={s.exists} mtime={s.mtime} />
              ))}
              <span aria-hidden className="mx-0.5 h-3 w-px bg-border" />
              <Ledger label="notes" value={data.ledger.notes} />
              <Ledger label="cards" value={data.ledger.cards} />
              <Ledger label="progress" value={data.ledger.progress} />
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/60">connecting…</span>
          )}
        </div>
      </div>
    </header>
  )
}
