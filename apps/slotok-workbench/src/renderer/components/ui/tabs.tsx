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
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-secondary p-1">
      {props.items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "rounded-sm border border-transparent bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
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
