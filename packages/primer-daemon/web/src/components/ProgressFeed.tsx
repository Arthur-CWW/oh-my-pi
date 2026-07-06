import type * as React from "react"

import type { ProgressEntry } from "@/api"
import { cn } from "@/lib/utils"
import { EmptyHint, InlineError, KindBadge, RefChip, Section, TimeAgo, focusRing } from "./atoms"
import { Skeleton } from "./ui/skeleton"

function Row({ entry, index, focused, onFocus }: { entry: ProgressEntry; index: number; focused: boolean; onFocus: () => void }): React.JSX.Element {
  return (
    <div data-vim-panel="progress" data-vim-index={index} onMouseEnter={onFocus} className={cn(focusRing(focused), "px-3 py-2.5")}>
      <div className="flex items-center gap-2">
        <KindBadge kind={entry.kind} />
        <TimeAgo iso={entry.createdAt} className="ml-auto" />
      </div>
      <p className="mt-1.5 text-sm font-medium leading-snug">{entry.title}</p>
      {entry.body ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.body}</p> : null}
      {entry.refs.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entry.refs.map((ref, i) =>
            /^https?:\/\//.test(ref) ? (
              <a
                key={i}
                href={ref}
                target="_blank"
                rel="noreferrer"
                className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground underline decoration-transparent underline-offset-2 transition-colors hover:text-primer hover:decoration-primer/50"
              >
                {ref}
              </a>
            ) : (
              <RefChip key={i}>{ref}</RefChip>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ProgressFeed({
  entries,
  loading,
  error,
  active,
  isFocused,
  onFocus,
}: {
  entries: ProgressEntry[]
  loading: boolean
  error: string | null
  active: boolean
  isFocused: (index: number) => boolean
  onFocus: (index: number) => void
}): React.JSX.Element {
  return (
    <Section
      id="progress"
      label="progress"
      count={entries.length}
      active={active}
      caption="Agent activity — milestones, commits, notes, proofs as they happen."
    >
      {error && entries.length === 0 ? (
        <InlineError message={error} />
      ) : loading && entries.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyHint>No activity yet. Agent milestones will stream in here.</EmptyHint>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, index) => (
            <Row key={entry.id} entry={entry} index={index} focused={isFocused(index)} onFocus={() => onFocus(index)} />
          ))}
        </div>
      )}
    </Section>
  )
}
