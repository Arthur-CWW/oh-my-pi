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
    <div className={cn("inline-flex rounded-md border border-zinc-200/80 bg-zinc-100/50 p-0.5", props.className)}>
      {props.items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "rounded-[4px] border border-transparent bg-transparent font-medium text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
            props.size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs",
            props.value === item.value && "bg-white text-zinc-900 border-zinc-200/30 shadow-sm font-semibold",
          )}
          onClick={() => props.onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
