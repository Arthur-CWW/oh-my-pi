import { Loader2, Search } from "lucide-react"
import { type FormEvent, useRef, useState } from "react"
import type * as React from "react"

import { type AskResponse, type EvidenceHit, ask, getAskConfig } from "@/api"
import { usePolled } from "@/hooks/usePolled"
import { cn } from "@/lib/utils"
import { EmptyHint, InlineError, Section } from "./atoms"
import { EvidenceList } from "./EvidenceList"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Skeleton } from "./ui/skeleton"

const EXAMPLES = [
  "what have I been reading about spaced repetition and flashcards?",
  "what have I been reading about Nick Land and Meltdown?",
  "what have I been reading about HSK and Chinese learning?",
]

interface Turn {
  id: number
  question: string
  status: "loading" | "done" | "error"
  response: AskResponse | null
  error: string | null
  evidenceOpen: boolean
}

const CITATION = /\[([^\]\n]{1,80})\]/g

/** Render answer prose, lifting inline [ref] tokens into small accent chips. */
function withCitations(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const flat = text.replace(/\n/g, " ")
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  CITATION.lastIndex = 0
  while ((m = CITATION.exec(flat)) !== null) {
    if (m.index > last) nodes.push(flat.slice(last, m.index))
    nodes.push(
      <span
        key={k++}
        className="mx-0.5 inline-flex items-center rounded bg-primer/12 px-1 py-px align-baseline font-mono text-[11px] leading-none text-primer/90"
      >
        {m[1]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < flat.length) nodes.push(flat.slice(last))
  return nodes
}

function AnswerBody({ response }: { response: AskResponse }): React.JSX.Element {
  const { answer, answerError } = response
  if (answer) {
    const paragraphs = answer.text.trim().split(/\n{2,}/)
    return (
      <div className="space-y-3">
        <div className="space-y-2.5 font-serif text-[15px] leading-relaxed text-foreground/95">
          {paragraphs.map((p, i) => (
            <p key={i}>{withCitations(p)}</p>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center rounded-md border border-primer/25 bg-primer/5 px-1.5 py-0.5 font-medium text-primer/90">{answer.model}</span>
          <span className="tabular-nums">{(answer.elapsedMs / 1000).toFixed(1)}s</span>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">Retrieval only — showing sources without a synthesized answer.</p>
      {answerError ? <p className="text-[11px] text-muted-foreground/60">{answerError}</p> : null}
    </div>
  )
}

function AnswerSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-2 pt-1">
      <Skeleton className="h-3.5 w-[92%]" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-[78%]" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  )
}

export function AskPanel({
  active,
  isFocused,
  onFocus,
  onEvidence,
}: {
  active: boolean
  isFocused: (index: number) => boolean
  onFocus: (index: number) => void
  onEvidence: (hits: EvidenceHit[]) => void
}): React.JSX.Element {
  const config = usePolled(getAskConfig, null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState("")
  const nextId = useRef(0)

  const busy = turns.some((t) => t.status === "loading")
  const latestId = turns.length > 0 ? turns[turns.length - 1].id : -1

  const submit = (question: string): void => {
    const text = question.trim()
    if (!text || busy) return
    const id = nextId.current++
    setTurns((prev) => [...prev, { id, question: text, status: "loading", response: null, error: null, evidenceOpen: true }])
    setDraft("")
    onEvidence([])
    ask(text).then(
      (response) => {
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, status: "done", response, evidenceOpen: response.answer === null } : t)))
        onEvidence(response.hits)
      },
      (cause: unknown) => {
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, status: "error", error: cause instanceof Error ? cause.message : "Ask failed" } : t)))
        onEvidence([])
      },
    )
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    submit(draft)
  }

  const setEvidenceOpen = (id: number, open: boolean): void => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, evidenceOpen: open } : t)))
  }

  return (
    <Section id="ask" label="ask" active={active}>
      <form onSubmit={onSubmit} className="relative">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask your reading dæmon…"
          className="pr-20"
          disabled={busy}
          aria-label="Ask a question"
        />
        <Button type="submit" size="sm" disabled={busy || draft.trim() === ""} className="absolute right-1 top-1 h-7 gap-1.5 px-2.5">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          Ask
        </Button>
      </form>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground/70">
        {config.data ? (
          config.data.synthesisEnabled ? (
            <>
              answers via <span className="font-medium text-foreground/70">{config.data.model}</span>
            </>
          ) : (
            "retrieval only — synthesis disabled"
          )
        ) : (
          "\u2026"
        )}
      </p>

      {turns.length === 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground/70">Try asking…</p>
          <div className="flex flex-col gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => submit(ex)}
                className="group flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primer/30 hover:bg-accent/40 hover:text-foreground"
              >
                <Search className="size-3.5 shrink-0 text-primer/70" />
                <span className="leading-snug">{ex}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {[...turns].reverse().map((turn) => {
            const isLatest = turn.id === latestId
            return (
              <div key={turn.id} className={cn("space-y-3", !isLatest && "opacity-80")}>
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm leading-snug text-secondary-foreground">{turn.question}</p>
                </div>
                {turn.status === "loading" ? <AnswerSkeleton /> : null}
                {turn.status === "error" && turn.error ? <InlineError message={turn.error} /> : null}
                {turn.response ? (
                  <div className="space-y-3">
                    <AnswerBody response={turn.response} />
                    <EvidenceList
                      hits={turn.response.hits}
                      open={turn.evidenceOpen}
                      onOpenChange={(open) => setEvidenceOpen(turn.id, open)}
                      nav={isLatest}
                      isFocused={isFocused}
                      onFocus={onFocus}
                    />
                    {turn.response.hits.length === 0 ? <EmptyHint>No matching evidence in the substrates.</EmptyHint> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
