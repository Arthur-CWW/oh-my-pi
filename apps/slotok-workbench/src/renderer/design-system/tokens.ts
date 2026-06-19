export const ugcDesignTokens = {
  radius: {
    control: "rounded-md", // 6px
    panel: "rounded-lg",   // 8px
    canvas: "rounded-xl",  // 12px
  },
  density: {
    controlHeight: "h-8",
    toolbarHeight: "h-11",
    sidebarWidth: "w-[220px]",
    inspectorWidth: "w-[minmax(300px,30vw)]",
  },
  surface: {
    app: "bg-zinc-50/50 text-zinc-900",
    sidebar: "border-r border-zinc-200/50 bg-zinc-100/30 shadow-none",
    canvas: "bg-white",
    panel: "border border-zinc-200 bg-white text-zinc-900 shadow-sm",
    panelMuted: "border border-zinc-100 bg-zinc-50 text-zinc-900",
    floating: "border border-zinc-200 bg-white/95 shadow-md backdrop-blur-md",
  },
  text: {
    label: "text-[11px] font-medium leading-4 text-zinc-500",
    body: "text-xs leading-5 text-zinc-800",
    title: "text-sm font-semibold leading-5 text-zinc-900",
    heading: "text-base font-semibold leading-6 text-zinc-900",
  },
  gap: {
    xs: "gap-1",
    sm: "gap-2",
    md: "gap-3",
    lg: "gap-4",
  },
} as const

export type UgcTone = "neutral" | "active" | "success" | "warning" | "danger" | "agent"

export function toneClasses(tone: UgcTone): string {
  switch (tone) {
    case "active":
      return "border-blue-500 bg-blue-50/50 text-blue-700"
    case "success":
      return "border-emerald-500/20 bg-emerald-50 text-emerald-700"
    case "warning":
      return "border-amber-500/20 bg-amber-50 text-amber-700"
    case "danger":
      return "border-red-500/20 bg-red-50 text-red-700"
    case "agent":
      return "border-violet-500/20 bg-violet-50 text-violet-700"
    case "neutral":
    default:
      return "border-zinc-200 bg-white text-zinc-900"
  }
}
