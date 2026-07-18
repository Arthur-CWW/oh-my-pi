import { Badge } from "@/components/ui/badge"
import type { Label } from "@/data/types"

export function LabelBadge({ labels }: { labels?: Label[] }) {
  return (
    <span className="flex items-center gap-1.5">
      {(labels ?? []).slice(0, 2).map((label) => (
        <Badge key={label.id} variant="outline" className="gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} aria-hidden="true" />
          {label.name}
        </Badge>
      ))}
    </span>
  )
}
