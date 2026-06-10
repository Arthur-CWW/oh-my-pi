export const ugcDesignTokens = {
  radius: {
    control: "rounded-md",
    panel: "rounded-lg",
    canvas: "rounded-xl",
  },
  density: {
    controlHeight: "h-8",
    toolbarHeight: "h-11",
    sidebarWidth: "w-[220px]",
    inspectorWidth: "w-[276px]",
  },
  surface: {
    app: "bg-[#f6f5f1] text-foreground",
    sidebar: "border-r border-border bg-[#f1f0ec]",
    canvas: "bg-[#f8f7f3]",
    panel: "border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgba(20,22,25,0.04)]",
    panelMuted: "border border-border bg-muted/35 text-card-foreground",
    floating: "border border-border bg-card/95 shadow-[0_16px_50px_rgba(20,22,25,0.14)] backdrop-blur",
  },
  text: {
    label: "text-[11px] font-medium leading-4 text-muted-foreground",
    body: "text-xs leading-5 text-foreground",
    title: "text-sm font-semibold leading-5 text-foreground",
    heading: "text-base font-semibold leading-6 text-foreground",
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
      return "border-primary/55 bg-primary/10 text-primary"
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "danger":
      return "border-red-200 bg-red-50 text-red-700"
    case "agent":
      return "border-violet-200 bg-violet-50 text-violet-700"
    case "neutral":
    default:
      return "border-border bg-card text-foreground"
  }
}
