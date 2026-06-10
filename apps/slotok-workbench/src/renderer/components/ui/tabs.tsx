/** @jsxImportSource react */
import * as React from "react"
import { cn } from "../../lib/cn"

export interface TabItem<T extends string> {
  value: T
  label: string
}

export function Tabs<T extends string>(props: {
  value: T
  items: readonly TabItem<T>[]
  onValueChange: (value: T) => void
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <div className={cn("inline-flex rounded-md border border-border bg-secondary p-1", props.className)}>
      {props.items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "rounded-sm border border-transparent bg-transparent font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            props.size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
            props.value === item.value && "bg-background text-foreground shadow-sm",
          )}
          onClick={() => props.onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
