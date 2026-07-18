import type { Issue } from "@/data/types"
import { cn } from "@/lib/utils"
import { AssigneeUser } from "./assignee-user"
import { LabelBadge } from "./label-badge"

function sessionHref(issue: Issue) {
  return issue.kind === "session" && issue.sessionId ? `#/session/${encodeURIComponent(issue.sessionId)}` : null
}

export function IssueGrid({ issue }: { issue: Issue }) {
  const href = sessionHref(issue)
  const priorityId = issue.priority?.id
  const priorityClass = priorityId === "urgent" ? "text-red-400" : priorityId === "high" ? "text-orange-400" : priorityId === "medium" ? "text-yellow-400" : priorityId === "low" ? "text-blue-400" : "text-muted-foreground"
  const identifier = <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className={cn("size-2 rounded-full", priorityId === "urgent" ? "bg-red-400" : priorityId === "high" ? "bg-orange-400" : priorityId === "medium" ? "bg-yellow-400" : priorityId === "low" ? "bg-blue-400" : "bg-muted-foreground/60")} />{issue.identifier}</span>
  const title = <h3 className="line-clamp-3 text-sm font-semibold leading-5">{issue.title}</h3>
  return (
    <article className="flex min-h-36 w-[280px] flex-col gap-3 rounded-lg border border-border/70 bg-card p-3 shadow-xs transition-colors hover:border-ring/60 hover:bg-sidebar/40">
      <div className="flex items-center justify-between gap-2">
        {href ? <a href={href} className={cn("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", priorityClass)}>{identifier}</a> : identifier}
        <AssigneeUser user={issue.assignee} />
      </div>
      {href ? <a href={href} className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}</a> : title}
      <div className="mt-auto flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <LabelBadge labels={issue.labels} />
          {issue.workstream && <span className="truncate rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">{issue.workstream}</span>}
        </div>
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: issue.status.color }} title={issue.status.name} />
      </div>
    </article>
  )
}
