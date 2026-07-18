import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { Assignee } from "@/data/types"
import { UserRound } from "lucide-react"

export function AssigneeUser({ user }: { user?: Assignee | null }) {
  if (!user) return <UserRound className="size-4 text-muted-foreground" aria-label="Unassigned" />
  return (
    <Avatar className="size-6 border border-border/70" title={user.name}>
      <AvatarImage src={user.avatarUrl} alt={user.name} />
      <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}
