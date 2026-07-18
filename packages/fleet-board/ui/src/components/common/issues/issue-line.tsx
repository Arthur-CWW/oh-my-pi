import type { Issue } from "@/data/types"
import { cn } from "@/lib/utils"
import { AssigneeUser } from "./assignee-user"
import { LabelBadge } from "./label-badge"

function formatCreatedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? "Unknown date" : new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(date)
}

function sessionHref(issue: Issue) {
  return issue.kind === "session" && issue.sessionId ? `#/session/${encodeURIComponent(issue.sessionId)}` : null
}

export function IssueLine({ issue }: { issue: Issue }) {
  const href = sessionHref(issue)
  const priorityId = issue.priority?.id
  const priorityClass = priorityId === "urgent" ? "bg-red-400" : priorityId === "high" ? "bg-orange-400" : priorityId === "medium" ? "bg-yellow-400" : priorityId === "low" ? "bg-blue-400" : "bg-muted-foreground/60"
  const identifier = <span className="hidden w-14 shrink-0 text-xs font-medium text-muted-foreground sm:inline">{issue.identifier}</span>
  const title = <span className="truncate font-medium">{issue.title}</span>
  return (
    <div className="flex min-h-11 w-full items-center gap-2 border-b border-border/40 px-5 text-sm transition-colors last:border-b-0 hover:bg-sidebar/50">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", priorityClass)} title={issue.priority?.name ?? "No priority"} />
        {href ? <a href={href} className="contents focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{identifier}</a> : identifier}
        <span className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground" title={issue.status.name}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: issue.status.color }} aria-hidden="true" />
        </span>
        {href ? <a href={href} className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}</a> : title}
      </div>
      <div className="hidden items-center gap-2 lg:flex">
        <LabelBadge labels={issue.labels} />
        {issue.workstream && <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">{issue.workstream}</span>}
      </div>
      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{formatCreatedAt(issue.createdAt)}</span>
      <AssigneeUser user={issue.assignee} />
    </div>
  )
}
