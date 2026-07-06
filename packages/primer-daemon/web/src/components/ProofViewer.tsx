import { FileText, X } from "lucide-react"
import type * as React from "react"

import { getProof } from "@/api"
import { usePolled } from "@/hooks/usePolled"
import { InlineError } from "./atoms"
import { Markdown } from "./Markdown"
import { ScrollArea } from "./ui/scroll-area"
import { Skeleton } from "./ui/skeleton"

export function ProofViewer({ name, onClose }: { name: string; onClose: () => void }): React.JSX.Element {
  const { data, error, loading } = usePolled(() => getProof(name), null)

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={`Proof ${name}`}>
      <button type="button" aria-label="Close proof" onClick={onClose} className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
      <div className="relative z-10 m-auto mx-4 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <header className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
          <FileText className="size-4 shrink-0 text-primer" />
          <h3 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">{name}</h3>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">esc</kbd> to close
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : error ? (
              <InlineError message={error} />
            ) : data ? (
              <Markdown source={data.markdown} />
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
