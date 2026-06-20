/** @jsxImportSource react */
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/cn"

export function Sidebar(props: React.HTMLAttributes<HTMLElement>) {
  return (
    <aside
      {...props}
      data-slot="sidebar"
      className={cn(
        "flex h-dvh min-h-0 flex-col overflow-hidden border-r border-border/80 bg-muted/30 text-sidebar-foreground",
        props.className,
      )}
    />
  )
}

export function SidebarHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-slot="sidebar-header" className={cn("flex shrink-0 flex-col gap-2 p-3", props.className)} />
}

export function SidebarContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-slot="sidebar-content" className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3", props.className)} />
}

export function SidebarFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-slot="sidebar-footer" className={cn("flex shrink-0 flex-col gap-2 border-t border-border/70 p-3", props.className)} />
}

export function SidebarGroup(props: React.HTMLAttributes<HTMLElement>) {
  return <section {...props} data-slot="sidebar-group" className={cn("grid gap-1.5", props.className)} />
}

export function SidebarGroupLabel(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} data-slot="sidebar-group-label" className={cn("mx-1 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground", props.className)} />
}

export function SidebarMenu(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-slot="sidebar-menu" className={cn("grid gap-0.5", props.className)} />
}

export function SidebarMenuItem(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-slot="sidebar-menu-item" className={cn("min-w-0", props.className)} />
}

const sidebarMenuButtonVariants = cva(
  "inline-flex min-w-0 appearance-none items-center gap-2 rounded-md border border-solid border-transparent bg-transparent font-medium tracking-normal text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        selected: "bg-primary/10 text-primary border-primary/20 font-semibold hover:bg-primary/15",
      },
      size: {
        default: "h-8 px-2.5 text-xs",
        icon: "h-7 w-7 justify-center p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface SidebarMenuButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  asChild?: boolean
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp ref={ref} data-slot="sidebar-menu-button" className={cn(sidebarMenuButtonVariants({ variant, size, className }))} {...props} />
  },
)
SidebarMenuButton.displayName = "SidebarMenuButton"

export function SidebarRail(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-slot="sidebar-rail" className={cn("flex flex-col items-center gap-2 px-2 py-3", props.className)} />
}
