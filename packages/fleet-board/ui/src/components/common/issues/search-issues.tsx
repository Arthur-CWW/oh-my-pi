import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { useViewStore } from "@/store/view-store"

export function SearchIssues() {
  const searchQuery = useViewStore((state) => state.searchQuery)
  const setSearchQuery = useViewStore((state) => state.setSearchQuery)
  return (
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search live rows" className="h-9 pl-9" aria-label="Search live rows" />
    </div>
  )
}
