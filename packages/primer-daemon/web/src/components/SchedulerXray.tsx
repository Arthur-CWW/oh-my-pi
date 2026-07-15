import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import {
  type PipelineStats,
  type QueueItem,
  type ReviewEvent,
  type ReviewGrade,
  type ReviewSessionItem,
  type ReviewSimulationStep,
  getPipelineStats,
  getQueue,
  getReviewEvents,
  getReviewSession,
  simulateReview,
} from "@/api"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"

const GRADES: Array<{ grade: ReviewGrade; label: string; key: string; tone: string }> = [
  { grade: "again", label: "Again", key: "1", tone: "border-rose-400/30 text-rose-300 hover:bg-rose-400/10" },
  { grade: "hard", label: "Hard", key: "2", tone: "border-amber-400/30 text-amber-300 hover:bg-amber-400/10" },
  { grade: "good", label: "Good", key: "3", tone: "border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10" },
  { grade: "easy", label: "Easy", key: "4", tone: "border-sky-400/30 text-sky-300 hover:bg-sky-400/10" },
]

const PRESETS: Array<{ label: string; grades: ReviewGrade[] }> = [
  { label: "all good ×8", grades: Array.from({ length: 8 }, () => "good" as const) },
  { label: "good good again good…", grades: ["good", "good", "again", "good"] },
]

const STRATA: Array<{ status: QueueItem["status"]; label: string; color: string }> = [
  { status: "new", label: "new", color: "bg-amber-400/70" },
  { status: "keep", label: "keep", color: "bg-emerald-400/70" },
  { status: "known", label: "known", color: "bg-sky-400/70" },
  { status: "discarded", label: "discarded", color: "bg-rose-400/60" },
]

export function SchedulerXray(): React.JSX.Element {
  const [session, setSession] = useState<ReviewSessionItem[] | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [events, setEvents] = useState<ReviewEvent[]>([])
  const [stats, setStats] = useState<PipelineStats | null>(null)
  const gradesRef = useRef<ReviewGrade[]>([])
  const [grades, setGrades] = useState<ReviewGrade[]>([])
  const [trajectory, setTrajectory] = useState<ReviewSimulationStep[]>([])
  const [loading, setLoading] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([getReviewSession(20, true), getQueue("all", 300), getPipelineStats(), getReviewEvents(20)]).then(
      ([nextSession, nextQueue, nextStats, nextEvents]) => {
        setSession(nextSession)
        setQueue(nextQueue)
        setStats(nextStats)
        setEvents(nextEvents)
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't load scheduler evidence"),
    ).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setSequence = useCallback((next: ReviewGrade[]) => {
    gradesRef.current = next
    setGrades(next)
    setSimulating(true)
    simulateReview(next).then(
      (result) => setTrajectory(result.steps),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't simulate FSRS"),
    ).finally(() => setSimulating(false))
  }, [])

  const appendGrade = useCallback((grade: ReviewGrade) => {
    setSequence([...gradesRef.current, grade])
  }, [setSequence])

  const removeLastGrade = useCallback(() => {
    setSequence(gradesRef.current.slice(0, -1))
  }, [setSequence])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return
      if (event.key === "r") {
        event.preventDefault()
        refresh()
        return
      }
      if (event.key === "Backspace") {
        event.preventDefault()
        removeLastGrade()
        return
      }
      const grade = GRADES.find((option) => option.key === event.key)
      if (grade) {
        event.preventDefault()
        appendGrade(grade.grade)
        return
      }
      const preset = event.key === "p" ? PRESETS[0] : event.key === "g" ? PRESETS[1] : undefined
      if (preset) {
        event.preventDefault()
        setSequence(preset.grades)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [appendGrade, refresh, removeLastGrade, setSequence])

  const queueCounts = useMemo(() => {
    const counts = { new: 0, keep: 0, known: 0, discarded: 0 }
    const priority = { new: 0, keep: 0, known: 0, discarded: 0 }
    for (const item of queue) {
      counts[item.status] += 1
      if (item.priority > 0) priority[item.status] += 1
    }
    return { counts, priority }
  }, [queue])

  const maxQueueCount = Math.max(1, ...Object.values(queueCounts.counts))

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/60">scheduler / x-ray</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Feel the queue decide</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">A transparent preview of the next session, its guard rails, and the FSRS trajectory behind each grade.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh session"} <kbd className="ml-1 text-[10px] text-muted-foreground">r</kbd>
        </Button>
      </header>

      {error ? <p className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-sm text-rose-200">{error}</p> : null}

      <Card>
        <CardHeader className="gap-1 border-b pb-4">
          <CardTitle className="text-base">Next session</CardTitle>
          <CardDescription>Due first, then priority-weighted new items, with shared-character shifts made visible.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-4 py-4">
          {session?.length ? (
            <div className="flex min-w-max gap-2">
              {session.map((item, index) => (
                <div key={item.queueItemId} className="w-44 rounded-lg border border-border/70 bg-muted/15 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xl font-medium leading-none">{item.word}</span>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">slot {item.explain?.slot ?? index + 1}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{item.phase}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">priority <span className="font-mono tabular-nums text-foreground">{item.priority}</span></p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(item.explain?.reasons ?? []).map((reason) => <Badge key={reason} variant="secondary" className="whitespace-normal text-left text-[10px] font-normal leading-tight">{reason}</Badge>)}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="py-6 text-sm text-muted-foreground">No review items yet. Add a marked word, then refresh to see its place in line.</p>}
        </CardContent>
      </Card>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="gap-1 border-b pb-4">
            <CardTitle className="text-base">Queue strata</CardTitle>
            <CardDescription>Priority-positive items glow inside each status bar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 py-5">
            {STRATA.map(({ status, label, color }) => {
              const count = queueCounts.counts[status] || stats?.queue[status] || 0
              const priorityCount = queueCounts.priority[status]
              const width = `${Math.max(count > 0 ? 8 : 0, (count / maxQueueCount) * 100)}%`
              const priorityWidth = count > 0 ? `${(priorityCount / count) * 100}%` : "0%"
              return (
                <div key={status}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{label}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{count} <span className="text-muted-foreground/50">· {priorityCount} priority</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50">
                    <div className={`relative h-full rounded-full ${color}`} style={{ width }}>
                      <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/50" style={{ width: priorityWidth }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 border-b pb-4">
            <CardTitle className="text-base">Recent reviews</CardTitle>
            <CardDescription>Newest first · last 20 saved grades</CardDescription>
          </CardHeader>
          <CardContent className="px-5 py-3">
            {events.length ? <div className="divide-y divide-border/50">{events.slice(0, 20).map((event) => <ReviewEventRow key={event.id} event={event} />)}</div> : <p className="py-5 text-sm text-muted-foreground">No review events yet. Grade one card and this tail becomes your trail.</p>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="gap-1 border-b pb-4">
          <CardTitle className="text-base">FSRS trajectory simulator</CardTitle>
          <CardDescription>Build a sequence without writing to the ledger. The next grade is always applied at the previous due date.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            {GRADES.map(({ grade, label, key, tone }) => <Button key={grade} variant="outline" size="sm" className={tone} onClick={() => appendGrade(grade)}>{label} <kbd className="ml-1 text-[10px] opacity-60">{key}</kbd></Button>)}
            <Button variant="ghost" size="sm" onClick={removeLastGrade} disabled={!grades.length}>Backspace</Button>
            <span className="ml-1 text-[11px] text-muted-foreground/50">sequence</span>
            {grades.length ? grades.map((grade, index) => <button type="button" key={`${index}-${grade}`} onClick={() => setSequence(grades.slice(0, index))} className="rounded-full border border-border bg-muted/30 px-2 py-0.5 font-mono text-[11px] lowercase text-muted-foreground hover:text-foreground">{grade}</button>) : <span className="text-xs text-muted-foreground">choose a grade</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => <Button key={preset.label} variant="ghost" size="xs" onClick={() => setSequence(preset.grades)}>{preset.label}</Button>)}
          </div>
          {simulating ? <p className="text-xs text-muted-foreground">Calculating the next due dates…</p> : trajectory.length ? <Trajectory steps={trajectory} /> : <p className="text-sm text-muted-foreground">Try “all good ×8” to watch stability stretch, then compare it with an Again.</p>}
        </CardContent>
      </Card>
    </main>
  )
}

function Trajectory({ steps }: { steps: ReviewSimulationStep[] }): React.JSX.Element {
  const max = Math.max(0.001, ...steps.map((step) => step.intervalDays))
  return <div className="space-y-2">{steps.map((step, index) => {
    const minutes = Math.max(1, step.intervalDays * 24 * 60)
    const maxMinutes = Math.max(1, max * 24 * 60)
    const width = `${Math.max(8, (Math.log1p(minutes) / Math.log1p(maxMinutes)) * 100)}%`
    return <div key={`${index}-${step.due}`} className="flex items-center gap-3 text-xs"><span className="w-5 shrink-0 font-mono text-muted-foreground/50">{index + 1}</span><span className="w-12 shrink-0 font-medium capitalize">{step.grade}</span><div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded bg-muted/30"><div className="flex h-full min-w-[8%] items-center rounded bg-primary/25 px-2 text-[10px] text-foreground/80" style={{ width }}><span className="truncate">{formatInterval(step.intervalDays)}</span></div></div><span className="w-32 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{formatDue(step.due)} · S {step.stability.toFixed(1)} · D {step.difficulty.toFixed(1)}</span></div>
  })}</div>
}

function ReviewEventRow({ event }: { event: ReviewEvent }): React.JSX.Element {
  return <div className="flex items-center gap-2 py-2 text-xs"><span className="min-w-0 flex-1 truncate font-medium">{event.label}</span><Badge variant="outline" className="text-[10px] capitalize">{event.grade}</Badge><span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatWhen(event.eventTime)}</span></div>
}

function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))}m`
  if (days < 1) return `${Math.round(days * 24)}h`
  return `${days.toFixed(days >= 10 ? 0 : 1)}d`
}

function formatDue(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatWhen(value: string): string {
  const date = new Date(value)
  const ageMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000))
  if (ageMinutes < 1) return "now"
  if (ageMinutes < 60) return `${ageMinutes}m`
  if (ageMinutes < 1_440) return `${Math.floor(ageMinutes / 60)}h`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
