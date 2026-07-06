import type * as React from "react"

import type { Note } from "@/api"
import { cn } from "@/lib/utils"
import { EmptyHint, InlineError, Section, TimeAgo, focusRing } from "./atoms"
import { Markdown } from "./Markdown"
import { Skeleton } from "./ui/skeleton"

function Row({ note, index, focused, onFocus }: { note: Note; index: number; focused: boolean; onFocus: () => void }): React.JSX.Element {
  return (
    <article data-vim-panel="notes" data-vim-index={index} onMouseEnter={onFocus} className={cn(focusRing(focused), "p-3")}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium leading-snug">{note.question}</h3>
        <TimeAgo iso={note.createdAt} className="pt-0.5" />
      </div>
      {note.body ? <Markdown source={note.body} className="mt-2 font-serif text-[13px] text-foreground/90" /> : null}
      {note.sources.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {note.sources.map((source) =>
            source.url ? (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:border-primer/30 hover:text-primer"
              >
                {source.title || source.ref}
              </a>
            ) : (
              <span key={source.id} className="inline-flex max-w-full items-center truncate rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {source.title || source.ref}
              </span>
            ),
          )}
        </div>
      ) : null}
    </article>
  )
}

export function NotesPanel({
  notes,
  loading,
  error,
  active,
  isFocused,
  onFocus,
}: {
  notes: Note[]
  loading: boolean
  error: string | null
  active: boolean
  isFocused: (index: number) => boolean
  onFocus: (index: number) => void
}): React.JSX.Element {
  return (
    <Section id="notes" label="notes" count={notes.length} active={active} caption="Synthesized answers the dæmon chose to keep, with their sources.">
      {error && notes.length === 0 ? (
        <InlineError message={error} />
      ) : loading && notes.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : notes.length === 0 ? (
        <EmptyHint>No notes yet. Kept answers will collect here.</EmptyHint>
      ) : (
        <div className="space-y-2">
          {notes.map((note, index) => (
            <Row key={note.id} note={note} index={index} focused={isFocused(index)} onFocus={() => onFocus(index)} />
          ))}
        </div>
      )}
    </Section>
  )
}
