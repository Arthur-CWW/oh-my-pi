/** @jsxImportSource react */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Badge, type BadgeProps } from "../components/ui/badge"
import { Button, type ButtonProps } from "../components/ui/button"
import { Card } from "../components/ui/card"
import { Textarea } from "../components/ui/textarea"
import { cn } from "../lib/cn"
import { toneClasses, ugcDesignTokens, type UgcTone } from "./tokens"

export function WorkbenchShell(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "grid min-h-screen grid-cols-[220px_minmax(0,1fr)] overflow-hidden text-xs tracking-normal",
        ugcDesignTokens.surface.app,
        props.className,
      )}
    />
  )
}

export function WorkbenchSidebar(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <aside
      {...props}
      className={cn("flex min-h-screen flex-col gap-3 p-3", ugcDesignTokens.surface.sidebar, props.className)}
    />
  )
}

export function WorkbenchMain(props: React.HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cn("flex min-h-screen min-w-0 flex-col", props.className)} />
}

export function WorkbenchTopbar(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <header
      {...props}
      className={cn(
        "flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/80 px-4",
        props.className,
      )}
    />
  )
}

export function WorkbenchContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_276px]", props.className)} />
}

export function WorkbenchCanvas(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...props}
      className={cn("relative min-w-0 overflow-hidden border-r border-border", ugcDesignTokens.surface.canvas, props.className)}
    />
  )
}

export function InspectorPanel(props: React.HTMLAttributes<HTMLElement>) {
  return <aside {...props} className={cn("min-w-0 overflow-auto bg-[#f4f3ef] p-3", props.className)} />
}

export function PanelCard(props: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof panelCardVariants>) {
  const { className, tone, density, ...rest } = props
  return <Card {...rest} className={cn(panelCardVariants({ tone, density }), className)} />
}

const panelCardVariants = cva("overflow-hidden", {
  variants: {
    tone: {
      default: ugcDesignTokens.surface.panel,
      muted: ugcDesignTokens.surface.panelMuted,
      floating: ugcDesignTokens.surface.floating,
      selected: "border-primary/60 bg-card shadow-[0_0_0_1px_hsl(var(--primary)/0.24)]",
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

export function SidebarRow(props: ButtonProps & {
  readonly active?: boolean
  readonly icon?: React.ReactNode
  readonly shortcut?: string
  readonly count?: string | number
}) {
  const { active, icon, shortcut, count, children, className, ...buttonProps } = props
  return (
    <Button
      type="button"
      variant={active ? "selected" : "ghost"}
      size="sm"
      className={cn("w-full justify-start px-2 font-normal", className)}
      {...buttonProps}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {shortcut ? <kbd className="rounded border border-border bg-background px-1 text-[10px] text-muted-foreground">{shortcut}</kbd> : null}
      {count !== undefined ? <span className="text-[11px] text-muted-foreground">{count}</span> : null}
    </Button>
  )
}

export function ToolbarCluster(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm", props.className)} />
}

export function MetricRow(props: {
  readonly label: string
  readonly value: React.ReactNode
  readonly tone?: UgcTone
  readonly className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5", props.className)}>
      <span className={ugcDesignTokens.text.label}>{props.label}</span>
      <strong className={cn("min-w-0 truncate text-right text-xs font-semibold", props.tone && props.tone !== "neutral" && toneClasses(props.tone))}>
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
  readonly actions?: React.ReactNode
  readonly runButton?: React.ReactNode
  readonly className?: string
}) {
  return (
    <PanelCard tone="floating" density="compact" className={cn("flex items-end gap-2", props.className)}>
      <Textarea
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
        className="min-h-10 flex-1 border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
      />
      {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
      {props.runButton}
    </PanelCard>
  )
}
