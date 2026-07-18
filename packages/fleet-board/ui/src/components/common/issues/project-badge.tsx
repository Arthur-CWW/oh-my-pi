import { Badge } from "@/components/ui/badge"

export function ProjectBadge({ project }: { project: { name: string } }) {
  return (
    <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[10px] font-medium">
      {project.name}
    </Badge>
  )
}
