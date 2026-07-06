import { Search, SearchX } from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import { type AskStreamMeta, type EvidenceHit, askStream, getAskConfig } from "@/api"
import { usePolled } from "@/hooks/usePolled"
import { readerRefUrl } from "@/lib/reader-link"
import { relativeShort } from "@/lib/relative-time"
import { cn } from "@/lib/utils"
import { SUBSTRATE_LABEL, Section } from "./atoms"
import { EvidenceList } from "./EvidenceList"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Field, FieldDescription } from "./ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group"
import { Spinner } from "./ui/spinner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip"

const EXAMPLES = [
  "what have I been reading about spaced repetition and flashcards?",
  "what have I been reading about Nick Land and Meltdown?",
  "what have I been reading about HSK and Chinese learning?",
]

/** submitting → (meta) streaming → done | stopped (user abort) | error. */
type Phase = "submitting" | "streaming" | "done" | "stopped" | "error"

interface Turn {
  id: number
  question: string
  phase: Phase
  meta: AskStreamMeta | null
  text: string
  elapsedMs: number | null
  error: string | null
  evidenceOpen: boolean
}

const CITATION = /\[([^\]\n]{1,80})\]/g
const prefersReducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
const isTypingTarget = (): boolean => {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
}

/** A resolved `[ref]` becomes a provenance tooltip and, when the source has a
 * url (or a reader deep-link), a link; unresolved refs render as plain chips. */
function CitationChip({ label, hit }: { label: string; hit: EvidenceHit | undefined }): React.JSX.Element {
  const base = "mx-0.5 inline-flex items-center rounded bg-primer/12 px-1 py-px align-baseline font-mono text-[11px] leading-none text-primer/90"
  if (!hit) return <span className={base}>{label}</span>
  const href = hit.url ?? readerRefUrl(hit.ref)
  const chip = href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cn(base, "transition-colors hover:bg-primer/25")}>
      {label}
    </a>
  ) : (
    <span className={cn(base, "cursor-help")}>{label}</span>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-[16rem] space-y-0.5">
        <p className="font-medium capitalize">
          {SUBSTRATE_LABEL[hit.source]}
          {hit.kind ? <span className="font-normal opacity-70"> · {hit.kind}</span> : null}
        </p>
        <p className="opacity-90">{hit.title || hit.ref}</p>
        {hit.timestamp ? <p className="tabular-nums opacity-70">{relativeShort(hit.timestamp)}</p> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Render answer prose, lifting inline [ref] tokens into accent citation chips. */
function withCitations(text: string, refIndex: Map<string, EvidenceHit>): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const flat = text.replace(/\n/g, " ")
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  CITATION.lastIndex = 0
  while ((m = CITATION.exec(flat)) !== null) {
    if (m.index > last) nodes.push(flat.slice(last, m.index))
    nodes.push(<CitationChip key={k++} label={m[1]} hit={refIndex.get(m[1])} />)
    last = m.index + m[0].length
  }
  if (last < flat.length) nodes.push(flat.slice(last))
  return nodes
}

function FinalAnswer({ text, hits, model, elapsedMs }: { text: string; hits: EvidenceHit[]; model: string; elapsedMs: number | null }): React.JSX.Element {
  const refIndex = useMemo(() => new Map(hits.map((h) => [h.ref, h] as const)), [hits])
  const paragraphs = text.trim().split(/\n{2,}/)
  return (
    <div className="space-y-3">
      <div className="space-y-2.5 font-serif text-[15px] leading-relaxed text-foreground/95">
        {paragraphs.map((p, i) => (
          <p key={i}>{withCitations(p, refIndex)}</p>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {model ? <span className="inline-flex items-center rounded-md border border-primer/25 bg-primer/5 px-1.5 py-0.5 font-medium text-primer/90">{model}</span> : null}
        {elapsedMs !== null ? <span className="tabular-nums">{(elapsedMs / 1000).toFixed(1)}s</span> : <span className="italic opacity-70">stopped</span>}
      </div>
    </div>
  )
}

/** Live answer: raw text (formatting preserved) with a blinking caret at the tail. */
function StreamingAnswer({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-foreground/95">
      {text}
      <span aria-hidden className="ml-px inline-block h-[1.05em] w-0.5 translate-y-[0.14em] animate-pulse rounded-full bg-primer/70 align-baseline" />
    </p>
  )
}

function CalmNotice({ children, detail }: { children: React.ReactNode; detail?: string | null }): React.JSX.Element {
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{children}</p>
      {detail ? <p className="text-[11px] text-muted-foreground/60">{detail}</p> : null}
    </div>
  )
}

function NoEvidence(): React.JSX.Element {
  return (
    <Empty className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle className="text-sm">No matching evidence</EmptyTitle>
        <EmptyDescription>Nothing in your substrates matched. Try broader terms or a nearby topic.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function Working({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground/80">
      <Spinner className="size-3.5 text-primer/70" />
      {label}
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
  const abortRef = useRef<AbortController | null>(null)
  const latestRef = useRef<HTMLDivElement | null>(null)

  const latestId = turns.length > 0 ? turns[turns.length - 1].id : -1
  const submitting = turns.some((t) => t.phase === "submitting")

  // Escape aborts an in-flight stream, taking precedence over vim-nav. Capture
  // phase + stopPropagation keeps the same keystroke from also clearing focus;
  // when no stream runs (or the field is focused) Escape falls through.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || !abortRef.current || isTypingTarget()) return
      abortRef.current.abort()
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      abortRef.current?.abort()
    }
  }, [])

  const setEvidenceOpen = (id: number, open: boolean): void => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, evidenceOpen: open } : t)))
  }

  const submit = (question: string): void => {
    const text = question.trim()
    if (!text) return
    abortRef.current?.abort() // abort any prior stream before starting a new one
    const controller = new AbortController()
    abortRef.current = controller
    const id = nextId.current++
    setTurns((prev) => [...prev, { id, question: text, phase: "submitting", meta: null, text: "", elapsedMs: null, error: null, evidenceOpen: false }])
    setDraft("")
    onEvidence([])
    requestAnimationFrame(() => latestRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }))

    void askStream(
      text,
      undefined,
      {
        onMeta: (meta) => {
          setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, phase: "streaming", meta } : t)))
          onEvidence(meta.hits)
        },
        onDelta: (chunk) => {
          setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, text: t.text + chunk } : t)))
        },
        onDone: ({ elapsedMs }) => {
          if (abortRef.current === controller) abortRef.current = null
          setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, phase: "done", elapsedMs, evidenceOpen: t.text.trim() === "" && (t.meta?.hits.length ?? 0) > 0 } : t)))
        },
        onError: (message) => {
          if (abortRef.current === controller) abortRef.current = null
          setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, phase: "error", error: message, evidenceOpen: true } : t)))
        },
      },
      controller.signal,
    ).catch((cause: unknown) => {
      const aborted = controller.signal.aborted
      if (abortRef.current === controller) abortRef.current = null
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== id || t.phase === "done" || t.phase === "stopped" || t.phase === "error") return t
          if (aborted) return { ...t, phase: "stopped", evidenceOpen: t.text.trim() === "" ? (t.meta?.hits.length ?? 0) > 0 : t.evidenceOpen }
          return { ...t, phase: "error", error: cause instanceof Error ? cause.message : "Ask failed", evidenceOpen: true }
        }),
      )
    })
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    submit(draft)
  }

  const renderTurn = (turn: Turn, isLatest: boolean): React.JSX.Element => {
    const hits = turn.meta?.hits ?? []
    const hasText = turn.text.trim() !== ""
    const willSynthesize = turn.meta?.synthesisEnabled === true && hits.length > 0
    return (
      <>
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm leading-snug text-secondary-foreground">{turn.question}</p>
        </div>

        {turn.phase === "submitting" ? <Working label="searching your substrates…" /> : null}
        {turn.meta && turn.meta.terms.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {turn.meta.terms.map((term) => (
              <span key={term} className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {term}
              </span>
            ))}
          </div>
        ) : null}

        {turn.phase === "streaming" ? hasText ? <StreamingAnswer text={turn.text} /> : willSynthesize ? <Working label="composing an answer…" /> : null : null}
        {(turn.phase === "done" || turn.phase === "stopped") && hasText ? <FinalAnswer text={turn.text} hits={hits} model={turn.meta?.model ?? ""} elapsedMs={turn.elapsedMs} /> : null}
        {turn.phase === "done" && !hasText && hits.length > 0 ? (
          <CalmNotice>{turn.meta?.synthesisEnabled ? "Retrieval only — no answer was synthesized." : "Retrieval only — synthesis is disabled."}</CalmNotice>
        ) : null}
        {turn.phase === "stopped" && !hasText ? <CalmNotice>Stopped before an answer arrived.</CalmNotice> : null}
        {turn.phase === "error" ? (
          <CalmNotice detail={turn.error}>{turn.meta ? (hits.length > 0 ? "Synthesis failed — the retrieved sources are shown below." : "Synthesis failed before any sources were retrieved.") : "The request couldn’t be completed."}</CalmNotice>
        ) : null}

        {hits.length > 0 ? (
          <EvidenceList hits={hits} open={turn.evidenceOpen} onOpenChange={(open) => setEvidenceOpen(turn.id, open)} nav={isLatest} isFocused={isFocused} onFocus={onFocus} />
        ) : turn.phase === "done" && turn.meta ? (
          <NoEvidence />
        ) : null}
      </>
    )
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Section id="ask" label="ask" active={active}>
        <form onSubmit={onSubmit}>
          <Field className="gap-1.5">
            <InputGroup>
              <InputGroupInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask your reading dæmon…" disabled={submitting} aria-label="Ask a question" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton type="submit" variant="default" size="sm" disabled={submitting || draft.trim() === ""}>
                  {submitting ? <Spinner className="size-3.5" /> : <Search className="size-3.5" />}
                  Ask
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription className="px-1 text-[11px] text-muted-foreground/70">
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
            </FieldDescription>
          </Field>
        </form>

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
                <div key={turn.id} ref={isLatest ? latestRef : undefined} className={cn("scroll-mt-20 space-y-3", !isLatest && "opacity-80")}>
                  {renderTurn(turn, isLatest)}
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </TooltipProvider>
  )
}
