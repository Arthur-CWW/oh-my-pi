/** @jsxImportSource react */
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { Badge, type BadgeProps } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card } from "../components/ui/card"
import { Sidebar as SidebarPrimitive, SidebarMenuButton, type SidebarMenuButtonProps } from "../components/ui/sidebar"
import { Textarea } from "../components/ui/textarea"
import { cn } from "../lib/cn"
import { toneClasses, ugcDesignTokens, type UgcTone } from "./tokens"

export function WorkbenchShell(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <main
      {...props}
      className={cn(
        "grid h-dvh min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden text-xs tracking-normal bg-background text-foreground",
        props.className,
      )}
    />
  )
}

export function WorkbenchSidebar(props: React.HTMLAttributes<HTMLElement>) {
  const { className, children, ...rest } = props
  return (
    <SidebarPrimitive {...rest} className={cn("gap-3 p-3", className)}>
      {children}
    </SidebarPrimitive>
  )
}

export function WorkbenchMain(props: React.HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cn("flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden", props.className)} />
}

export function WorkbenchTopbar(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <header
      {...props}
      className={cn(
        "flex h-12 shrink-0 items-center justify-between border-b border-border/85 bg-white px-4",
        props.className,
      )}
    />
  )
}

export function WorkbenchContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,30vw)] overflow-hidden", props.className)} />
}

export function WorkbenchCanvas(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...props}
      className={cn("relative min-w-0 overflow-hidden border-r border-border bg-background", props.className)}
    />
  )
}

export function InspectorPanel(props: React.HTMLAttributes<HTMLElement>) {
  return <aside {...props} className={cn("min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-muted/30 border-l border-border/80 p-3", props.className)} />
}

export function PanelCard(props: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof panelCardVariants>) {
  const { className, tone, density, ...rest } = props
  return <Card {...rest} className={cn(panelCardVariants({ tone, density }), className)} />
}

const panelCardVariants = cva("overflow-hidden", {
  variants: {
    tone: {
      default: "border border-zinc-200 bg-white text-zinc-900 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)]",
      muted: "border border-zinc-200 bg-zinc-50 text-zinc-900",
      floating: "border border-zinc-200 bg-white/95 shadow-md backdrop-blur-md",
      selected: "border-primary bg-white shadow-[0_0_0_1.5px_hsl(var(--primary))]",
    },
    density: {
      compact: "p-2",
      default: "p-3",
      roomy: "p-4",
    },
  },
  defaultVariants: {
    tone: "default",
    density: "default",
  },
})

export function PanelHeader(props: {
  readonly eyebrow?: string
  readonly title: string
  readonly actions?: React.ReactNode
  readonly className?: string
}) {
  return (
    <header className={cn("mb-3 flex items-start justify-between gap-3", props.className)}>
      <div className="min-w-0">
        {props.eyebrow ? <p className={ugcDesignTokens.text.label}>{props.eyebrow}</p> : null}
        <h2 className={ugcDesignTokens.text.title}>{props.title}</h2>
      </div>
      {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
    </header>
  )
}

export function SidebarRow(props: SidebarMenuButtonProps & {
  readonly active?: boolean
  readonly icon?: React.ReactNode
  readonly shortcut?: string
  readonly count?: string | number
}) {
  const { active, icon, shortcut, count, children, className, ...buttonProps } = props
  return (
    <SidebarMenuButton
      type="button"
      variant={active ? "selected" : "default"}
      size="default"
      className={cn("w-full justify-start rounded-md px-2.5", className)}
      {...buttonProps}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {shortcut ? <kbd className="rounded-[4px] border border-zinc-200 bg-zinc-50 px-1.5 text-[10px] font-semibold text-zinc-500">{shortcut}</kbd> : null}
      {count !== undefined ? <span className="text-[11px] text-zinc-500">{count}</span> : null}
    </SidebarMenuButton>
  )
}

export function ToolbarCluster(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-sm", props.className)} />
}

export function MetricRow(props: {
  readonly label: string
  readonly value: React.ReactNode
  readonly tone?: UgcTone
  readonly className?: string
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(5.5rem,0.42fr)_minmax(0,1fr)] items-start gap-3 py-1.5", props.className)}>
      <span className={cn(ugcDesignTokens.text.label, "pt-0.5")}>{props.label}</span>
      <strong className={cn("min-w-0 break-words text-right text-xs font-semibold leading-5", props.tone && props.tone !== "neutral" && toneClasses(props.tone))}>
        {props.value}
      </strong>
    </div>
  )
}

export function StatusBadge(props: BadgeProps & { readonly tone?: UgcTone }) {
  const { tone = "neutral", className, variant, ...rest } = props
  const mappedVariant = variant ?? (
    tone === "success" ? "success"
      : tone === "warning" ? "warning"
        : tone === "danger" ? "danger"
          : tone === "agent" ? "agent"
            : tone === "active" ? "info"
              : "default"
  )
  return <Badge variant={mappedVariant} className={className} {...rest} />
}

export function ScoreMeter(props: {
  readonly label: string
  readonly value: number
  readonly tone?: "default" | "warning" | "success"
}) {
  const value = Math.max(0, Math.min(100, props.value))
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className={ugcDesignTokens.text.label}>{props.label}</span>
        <strong className="text-[11px] font-semibold text-foreground">{value}</strong>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            props.tone === "warning" ? "bg-amber-500" : props.tone === "success" ? "bg-emerald-500" : "bg-primary",
          )}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}

export function CommandSurface(props: {
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly leading?: React.ReactNode
  readonly actions?: React.ReactNode
  readonly runButton?: React.ReactNode
  readonly className?: string
}) {
  return (
    <PanelCard data-ugc-command-surface tone="floating" density="compact" className={cn("flex min-w-0 items-end gap-2 rounded-xl", props.className)}>
      {props.leading ? <div className="grid h-8 w-8 shrink-0 place-items-center text-primary">{props.leading}</div> : null}
      <Textarea
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
        className="min-h-10 min-w-0 flex-1 border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
      />
      {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
      {props.runButton}
    </PanelCard>
  )
}

export function EmptyState(props: {
  readonly icon?: React.ReactNode
  readonly title: string
  readonly body?: React.ReactNode
  readonly action?: React.ReactNode
  readonly className?: string
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-muted-foreground", props.className)}>
      {props.icon ? <div className="grid h-10 w-10 place-items-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-400">{props.icon}</div> : null}
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">{props.title}</p>
        {props.body ? <p className="max-w-sm text-xs leading-5">{props.body}</p> : null}
      </div>
      {props.action}
    </div>
  )
}

export function NavDrawer(props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className={cn(
            WorkbenchSidebar({}).props.className,
            "fixed inset-y-0 left-0 z-50 w-[260px] max-w-[82vw] border-r",
          )}
          data-ugc-nav-drawer
        >
          <DialogPrimitive.Title className="sr-only">Workspace navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Switch Slotok workbench views.</DialogPrimitive.Description>
          {props.children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function InspectorActionResult(props: {
  readonly state: "idle" | "running" | "done" | "errored"
  readonly summary?: string
  readonly detail?: string
  readonly className?: string
}) {
  const tone: UgcTone = props.state === "errored" ? "danger" : props.state === "done" ? "success" : props.state === "running" ? "active" : "neutral"
  const label = props.state === "idle" ? "Not run yet" : props.state === "running" ? "Running…" : props.state === "done" ? "Last result" : "Failed"
  return (
    <div className={cn("grid gap-1 rounded-md border border-zinc-200 bg-zinc-50/60 p-2 text-[11px] leading-4", props.className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{label}</span>
        <StatusBadge tone={tone}>{props.state}</StatusBadge>
      </div>
      {props.summary ? <span className="truncate text-zinc-700">{props.summary}</span> : null}
      {props.detail ? <span className="text-muted-foreground">{props.detail}</span> : null}
    </div>
  )
}
