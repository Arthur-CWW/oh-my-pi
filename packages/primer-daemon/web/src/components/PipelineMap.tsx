import type * as React from "react"

import { getFeedback, getPipelineStats, getUiEvents, type FeedbackEvent, type PipelineStats, type UiEvent } from "@/api"
import { navigate } from "@/hooks/useHashRoute"
import { usePolled } from "@/hooks/usePolled"
import { cn } from "@/lib/utils"

interface Stage {
  key: string
  label: string
  count: number | null
  caption: string
  href: string
  tone: string
}

const VERDICT_DOT: Record<FeedbackEvent["verdict"], string> = {
  good: "bg-emerald-400",
  wrong: "bg-rose-400",
  confusing: "bg-amber-400",
  idea: "bg-sky-400",
}

function parsePayload(raw: UiEvent["payload"]): string | null {
  if (!raw) return null
  return JSON.stringify(raw) ?? null
}

function StageCard({ stage }: { stage: Stage }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => navigate(stage.href)}
      className="group flex min-w-0 flex-1 flex-col rounded-lg border border-border/75 bg-card/60 p-3 text-left transition-colors hover:border-foreground/30 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{stage.label}</span>
      <span className={cn("mt-2 text-3xl font-semibold tabular-nums tracking-tight", stage.tone)}>{stage.count === null ? "—" : stage.count}</span>
      <span className="mt-1 min-h-9 text-[11px] leading-relaxed text-muted-foreground">{stage.caption}</span>
      <span className="mt-2 text-[10px] text-muted-foreground/50 transition-colors group-hover:text-muted-foreground">open surface ↗</span>
    </button>
  )
}

function StageRail({ stages }: { stages: Stage[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-1.5">
      {stages.map((stage, index) => (
        <div key={stage.key} className="flex min-w-0 flex-1 items-center gap-1.5 md:contents">
          <StageCard stage={stage} />
          {index < stages.length - 1 ? (
            <span aria-hidden className="mx-auto shrink-0 text-muted-foreground/35 md:my-auto">↓<span className="hidden md:inline">→</span></span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function FeedbackPanel({ feedback, loading }: { feedback: FeedbackEvent[]; loading: boolean }): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border/70 bg-card/35">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">What Arthur did</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">feedback and interaction trail</p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/60">latest</span>
      </div>
      {loading ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">Listening for the first signal…</p>
      ) : feedback.length === 0 ? (
        <div className="px-4 py-6">
          <p className="text-sm text-muted-foreground">No feedback yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Press <kbd className="rounded border border-border px-1 font-mono">!</kbd> on any surface to leave a quick vibe check.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {feedback.slice(0, 12).map((item) => (
            <li key={item.id} className="flex gap-3 px-4 py-2.5">
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", VERDICT_DOT[item.verdict])} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs font-medium capitalize">{item.verdict}</span>
                  <span className="text-[11px] text-muted-foreground/55">{item.surface}</span>
                  <time className="ml-auto text-[10px] tabular-nums text-muted-foreground/45">{item.createdAt}</time>
                </div>
                <p className={cn("mt-0.5 truncate text-xs", item.note ? "text-muted-foreground" : "text-muted-foreground/45 italic")}>{item.note || "no note"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EventsPanel({ events, loading }: { events: UiEvent[]; loading: boolean }): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border/70 bg-card/35">
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Recent ui_events</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">quiet telemetry tail · flushed every 5s</p>
      </div>
      {loading ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">Waiting for interaction events…</p>
      ) : events.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground/65">No interaction events recorded yet. Navigate, look something up, or grade a card to start the trail.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {events.slice(0, 16).map((event) => (
            <li key={event.id} className="flex items-baseline gap-2 px-4 py-2">
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/65">{event.kind}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{parsePayload(event.payload) ?? "—"}</span>
              <time className="shrink-0 text-[10px] tabular-nums text-muted-foreground/40">{event.createdAt}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function buildStages(stats: PipelineStats | null): Stage[] {
  if (!stats) {
    return ["read", "mark", "queue", "enrich", "review", "events"].map((key) => ({ key, label: key, count: null, caption: "connecting…", href: "#/", tone: "text-foreground" }))
  }
  const queueTotal = stats.queue.new + stats.queue.keep + stats.queue.known + stats.queue.discarded
  return [
    { key: "read", label: "read", count: stats.docs, caption: "documents in the reading shelf", href: "#/read", tone: "text-foreground" },
    { key: "mark", label: "mark", count: stats.marks, caption: "marked words with provenance", href: "#/read", tone: "text-foreground" },
    { key: "queue", label: "queue", count: queueTotal, caption: `${stats.queue.new} new · ${stats.queue.keep} keep · ${stats.queue.known} known · ${stats.queue.discarded} discarded · ${stats.priorityPushed} priority pushed`, href: "#/review", tone: "text-amber-300" },
    { key: "enrich", label: "enrich", count: stats.enrichmentCount, caption: "generated playground records", href: "#/enrich", tone: "text-sky-300" },
    { key: "review", label: "review", count: stats.enrolledQueue + stats.enrolledCards, caption: `${stats.dueNow} due now · ${stats.newAvailable} new available`, href: "#/scheduler", tone: "text-emerald-300" },
    { key: "events", label: "events", count: stats.reviewEvents, caption: "review decisions written to the ledger", href: "#/scheduler", tone: "text-violet-300" },
  ]
}

export function PipelineMap(): React.JSX.Element {
  const stats = usePolled(getPipelineStats, 5_000)
  const feedback = usePolled(() => getFeedback(50), 5_000)
  const events = usePolled(() => getUiEvents(100), 5_000)
  const stages = buildStages(stats.data)

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 min-[1200px]:max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">pipeline map</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Chinese loop, in motion</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">A small evidence trail from reading to review. Click any stage to jump into the work.</p>
        </div>
        {stats.error ? <span className="text-xs text-destructive/80">stats unavailable</span> : null}
      </div>

      <StageRail stages={stages} />

      <div className="mt-5 grid gap-5 min-[1000px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <FeedbackPanel feedback={feedback.data ?? []} loading={feedback.loading} />
        <EventsPanel events={events.data ?? []} loading={events.loading} />
      </div>
    </main>
  )
}
