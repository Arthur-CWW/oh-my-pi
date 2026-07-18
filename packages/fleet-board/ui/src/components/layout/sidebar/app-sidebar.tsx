import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Activity, Command, Layers3, Search } from "lucide-react"
import { useViewStore } from "@/store/view-store"

const sections = [
  { id: "fleet", label: "Fleet", icon: Activity },
  { id: "register", label: "Register", icon: Layers3 },
] as const

export function AppSidebar() {
  const section = useViewStore((state) => state.section)
  const setSection = useViewStore((state) => state.setSection)
  const setSearchQuery = useViewStore((state) => state.setSearchQuery)
  return (
    <Sidebar collapsible="none" className="border-r border-sidebar-border">
      <SidebarHeader className="h-14 border-b border-sidebar-border px-3">
        <div className="flex h-full items-center gap-2 px-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"><Command className="size-3.5" /></div>
          <span className="font-semibold tracking-tight">Fleet board</span>
          <span className="ml-auto rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">live</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sections.map(({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton isActive={section === id} onClick={() => setSection(id)} tooltip={label}>
                    <Icon /><span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">Shortcuts</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setSearchQuery("")}><Search /><span>Clear search</span><span className="ml-auto text-[10px] text-muted-foreground">⌘ K</span></SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
