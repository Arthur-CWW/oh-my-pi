import { cn } from "@/lib/utils"
import type { Issue, Status } from "@/data/types"
import { useViewStore } from "@/store/view-store"
import { IssueGrid } from "./issue-grid"
import { IssueLine } from "./issue-line"

interface GroupIssuesProps {
  status: Status
  issues: Issue[]
  count: number
}

export function GroupIssues({ status, issues, count }: GroupIssuesProps) {
  const viewType = useViewStore((state) => state.viewType)
  const sortedIssues = [...issues].sort((left, right) => (left.priority?.id ?? "no-priority").localeCompare(right.priority?.id ?? "no-priority") || left.title.localeCompare(right.title))

  return (
    <section className={cn(viewType === "grid" ? "flex w-[300px] shrink-0 flex-col" : "w-full")}>
      <div className="flex h-11 items-center gap-2 px-5 text-xs font-semibold text-muted-foreground">
        <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} aria-hidden="true" />
        <span>{status.name}</span>
        <span className="text-muted-foreground/60">{count}</span>
      </div>
      {viewType === "grid" ? (
        <div className="flex min-h-36 flex-col gap-2">{sortedIssues.map((issue) => <IssueGrid key={issue.id} issue={issue} />)}</div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">{sortedIssues.map((issue) => <IssueLine key={issue.id} issue={issue} />)}</div>
      )}
    </section>
  )
}
