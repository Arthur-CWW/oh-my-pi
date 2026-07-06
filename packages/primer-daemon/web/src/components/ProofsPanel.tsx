import { ChevronRight } from "lucide-react"
import type * as React from "react"

import type { ProofSummary } from "@/api"
import { cn } from "@/lib/utils"
import { EmptyHint, InlineError, Section, TimeAgo, focusRing } from "./atoms"
import { Skeleton } from "./ui/skeleton"

export function ProofsPanel({
  proofs,
  loading,
  error,
  active,
  isFocused,
  onFocus,
  onOpen,
}: {
  proofs: ProofSummary[]
  loading: boolean
  error: string | null
  active: boolean
  isFocused: (index: number) => boolean
  onFocus: (index: number) => void
  onOpen: (name: string) => void
}): React.JSX.Element {
  return (
    <Section id="proofs" label="proofs" count={proofs.length} active={active} caption="Review contracts for finished tasks — read these instead of the code.">
      {error && proofs.length === 0 ? (
        <InlineError message={error} />
      ) : loading && proofs.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : proofs.length === 0 ? (
        <EmptyHint>No proofs yet. Finished tasks land here as review contracts.</EmptyHint>
      ) : (
        <div className="space-y-1.5">
          {proofs.map((proof, index) => (
            <button
              key={proof.name}
              type="button"
              data-vim-panel="proofs"
              data-vim-index={index}
              onMouseEnter={() => onFocus(index)}
              onClick={() => onOpen(proof.name)}
              className={cn(focusRing(isFocused(index)), "flex w-full items-center gap-2 px-3 py-2 text-left")}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-snug">{proof.title || proof.name}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground/60">{proof.name}</p>
              </div>
              <TimeAgo iso={proof.mtime} />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
            </button>
          ))}
        </div>
      )}
    </Section>
  )
}
