import { useMemo } from "react"
import { cn } from "@/lib/utils"
import type { FleetSnapshotState } from "@/data/types"
import type { Issue, Status } from "@/data/types"
import { useViewStore } from "@/store/view-store"
import { GroupIssues } from "./group-issues"

function formatUpdatedAt(value: string | null) {
  if (!value) return "never"
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? "unknown time" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function uniqueStatuses(issues: Issue[]) {
  const statuses = new Map<string, Status>()
  for (const issue of issues) statuses.set(issue.status.id, issue.status)
  return [...statuses.values()]
}

function uniqueWorkstreams(issues: Issue[]) {
  return [...new Set(issues.map((issue) => issue.workstream?.trim()).filter((workstream): workstream is string => Boolean(workstream)))].sort((left, right) => left.localeCompare(right))
}

export default function AllIssues({ snapshot }: { snapshot: FleetSnapshotState }) {
  const section = useViewStore((state) => state.section)
  const viewType = useViewStore((state) => state.viewType)
  const searchQuery = useViewStore((state) => state.searchQuery.trim().toLowerCase())
  const statusFilter = useViewStore((state) => state.statusFilter)
  const workstreamFilter = useViewStore((state) => state.workstreamFilter)
  const setWorkstreamFilter = useViewStore((state) => state.setWorkstreamFilter)
  const sourceIssues = section === "fleet" ? snapshot.sessions : snapshot.cards
  const statuses = useMemo(() => uniqueStatuses(sourceIssues), [sourceIssues])
  const workstreams = useMemo(() => uniqueWorkstreams(snapshot.sessions), [snapshot.sessions])
  const visibleIssues = sourceIssues.filter((issue) => {
    if (statusFilter && issue.status.id !== statusFilter) return false
    if (section === "fleet" && workstreamFilter && issue.workstream !== workstreamFilter) return false
    if (!searchQuery) return true
    return [issue.identifier, issue.title, issue.sessionId, issue.workstream, issue.state, issue.phase, issue.todoHead].filter(Boolean).join(" ").toLowerCase().includes(searchQuery)
  })
  const stale = Boolean(snapshot.error && snapshot.lastSuccessfulAt)

  return (
    <div className="flex flex-col">
      {section === "fleet" && workstreams.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-5 py-2">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">Workstreams</span>
          <button type="button" onClick={() => setWorkstreamFilter(null)} className={cn("rounded-full border px-2.5 py-1 text-[11px] transition-colors", !workstreamFilter ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:bg-muted")}>All</button>
          {workstreams.map((workstream) => (
            <button key={workstream} type="button" onClick={() => setWorkstreamFilter(workstreamFilter === workstream ? null : workstream)} className={cn("rounded-full border px-2.5 py-1 text-[11px] transition-colors", workstreamFilter === workstream ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:bg-muted")}>{workstream}</button>
          ))}
        </div>
      )}
      {stale && <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-200">Showing the last successful snapshot from {formatUpdatedAt(snapshot.lastSuccessfulAt)}. Live refresh failed.</div>}
      {snapshot.loading && !snapshot.lastSuccessfulAt && sourceIssues.length === 0 ? (
        <div className="p-8 text-sm text-muted-foreground">Loading live {section === "fleet" ? "fleet sessions" : "register cards"}…</div>
      ) : snapshot.error && !snapshot.lastSuccessfulAt && sourceIssues.length === 0 ? (
        <div className="p-8 text-sm text-destructive">Unable to load live data: {snapshot.error.message}</div>
      ) : visibleIssues.length === 0 ? (
        <div className="p-8 text-sm text-muted-foreground">{searchQuery || statusFilter || workstreamFilter ? "No matching live rows." : `No ${section === "fleet" ? "sessions" : "register cards"} found.`}</div>
      ) : (
        <div className={cn("w-full", viewType === "grid" ? "overflow-x-auto" : "overflow-hidden")}>
          <div className={cn("flex min-w-0 gap-5 p-5", viewType === "grid" ? "min-w-max items-start" : "flex-col")}>
            {statuses.map((status) => {
              const grouped = visibleIssues.filter((issue) => issue.status.id === status.id)
              return <GroupIssues key={status.id} status={status} issues={grouped} count={grouped.length} />
            })}
          </div>
        </div>
      )}
    </div>
  )
}
