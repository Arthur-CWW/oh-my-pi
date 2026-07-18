import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { Activity, Command, Grid2X2, Layers3, List, Search, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { SearchIssues } from "@/components/common/issues/search-issues"
import AllIssues from "@/components/common/issues/all-issues"
import { useFleetSnapshot } from "@/data/fleet-adapter"
import type { Status } from "@/data/types"
import { MainLayout } from "@/components/layout/main-layout"
import { useViewStore } from "@/store/view-store"

const SessionView = lazy(() => import("@/components/session/session-view"))

function sessionRoute(hash: string) {
  const match = hash.match(/^#\/session\/([^/?#]+)/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function Header({ onOpenPalette, statuses }: { onOpenPalette: () => void; statuses: Status[] }) {
  const section = useViewStore((state) => state.section)
  const viewType = useViewStore((state) => state.viewType)
  const setViewType = useViewStore((state) => state.setViewType)
  const statusFilter = useViewStore((state) => state.statusFilter)
  const setStatusFilter = useViewStore((state) => state.setStatusFilter)
  const sectionName = section === "fleet" ? "Fleet" : "Register"
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-3 border-b border-border/70 px-5 py-2">
      <div className="flex items-center gap-2">
        {section === "fleet" ? <Activity className="size-4 text-muted-foreground" /> : <Layers3 className="size-4 text-muted-foreground" />}
        <h1 className="text-sm font-semibold">{sectionName}</h1>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Live</span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="hidden h-8 gap-2 text-xs text-muted-foreground sm:flex" onClick={onOpenPalette}>
          <Search className="size-3.5" />
          Search
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">⌘ K</kbd>
        </Button>
        <Button variant={viewType === "list" ? "secondary" : "ghost"} size="icon" className="size-8" onClick={() => setViewType("list")} aria-label="List view"><List className="size-4" /></Button>
        <Button variant={viewType === "grid" ? "secondary" : "ghost"} size="icon" className="size-8" onClick={() => setViewType("grid")} aria-label="Board view"><Grid2X2 className="size-4" /></Button>
        <select value={statusFilter ?? "all"} onChange={(event) => setStatusFilter(event.target.value === "all" ? null : event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring" aria-label="Filter by status">
          <option value="all">All statuses</option>
          {statuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Button variant="ghost" size="icon" className="size-8" onClick={onOpenPalette} aria-label="Open command palette"><Command className="size-4" /></Button>
      </div>
    </header>
  )
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sessionId, setSessionId] = useState(() => typeof window === "undefined" ? null : sessionRoute(window.location.hash))
  const snapshot = useFleetSnapshot()
  const section = useViewStore((state) => state.section)
  const setSection = useViewStore((state) => state.setSection)
  const setViewType = useViewStore((state) => state.setViewType)
  const setSearchQuery = useViewStore((state) => state.setSearchQuery)
  const statuses = useMemo(() => {
    const rows = section === "fleet" ? snapshot.sessions : snapshot.cards
    const unique = new Map<string, Status>()
    for (const row of rows) unique.set(row.status.id, row.status)
    return [...unique.values()]
  }, [section, snapshot.cards, snapshot.sessions])

  useEffect(() => {
    document.documentElement.classList.add("dark")
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    const onHashChange = () => setSessionId(sessionRoute(window.location.hash))
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("hashchange", onHashChange)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("hashchange", onHashChange)
    }
  }, [])

  const chooseView = (viewType: "list" | "grid") => {
    setViewType(viewType)
    setPaletteOpen(false)
  }
  const chooseSection = (nextSection: "fleet" | "register") => {
    setSection(nextSection)
    setPaletteOpen(false)
    if (window.location.hash.startsWith("#/session/")) window.location.hash = "#/"
  }

  if (sessionId) {
    return <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading session…</div>}><SessionView sessionId={sessionId} /></Suspense>
  }

  return (
    <MainLayout header={<Header onOpenPalette={() => setPaletteOpen(true)} statuses={statuses} />}>
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/50 px-5 py-3">
          <SearchIssues />
          <div className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground md:flex"><SlidersHorizontal className="size-3.5" /> Live snapshot · refreshes every 5s</div>
        </div>
        <AllIssues snapshot={snapshot} />
      </div>
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Jump to a session or switch views…" />
        <CommandList>
          <CommandEmpty>No live sessions or commands found.</CommandEmpty>
          <CommandGroup heading="Sessions">
            {snapshot.sessions.map((session) => (
              <CommandItem key={session.id} value={`${session.identifier} ${session.title} ${session.sessionId ?? ""}`} onSelect={() => { if (session.sessionId) window.location.hash = `#/session/${encodeURIComponent(session.sessionId)}`; setPaletteOpen(false) }}>
                <Activity /><span className="truncate">{session.title}</span><CommandShortcut>{session.identifier}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Navigate">
            <CommandItem onSelect={() => chooseView("list")}><List /><span>Show list view</span><CommandShortcut>⌘ L</CommandShortcut></CommandItem>
            <CommandItem onSelect={() => chooseView("grid")}><Grid2X2 /><span>Show board view</span><CommandShortcut>⌘ B</CommandShortcut></CommandItem>
            <CommandItem onSelect={() => chooseSection("fleet")}><Activity /><span>Show Fleet sessions</span></CommandItem>
            <CommandItem onSelect={() => chooseSection("register")}><Layers3 /><span>Show Register cards</span></CommandItem>
            <CommandItem onSelect={() => { setSearchQuery(""); setPaletteOpen(false) }}><Search /><span>Clear search</span></CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </MainLayout>
  )
}
