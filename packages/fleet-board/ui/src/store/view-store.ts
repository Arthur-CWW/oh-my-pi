import { create } from "zustand"

export type ViewType = "list" | "grid"
export type Section = "fleet" | "register"

interface ViewState {
  viewType: ViewType
  section: Section
  searchQuery: string
  statusFilter: string | null
  workstreamFilter: string | null
  setViewType: (viewType: ViewType) => void
  setSection: (section: Section) => void
  setSearchQuery: (searchQuery: string) => void
  setStatusFilter: (statusId: string | null) => void
  setWorkstreamFilter: (workstream: string | null) => void
}

export const useViewStore = create<ViewState>((set) => ({
  viewType: "list",
  section: "fleet",
  searchQuery: "",
  statusFilter: null,
  workstreamFilter: null,
  setViewType: (viewType) => set({ viewType }),
  setSection: (section) => set({ section, statusFilter: null, workstreamFilter: null }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setWorkstreamFilter: (workstreamFilter) => set({ workstreamFilter }),
}))

