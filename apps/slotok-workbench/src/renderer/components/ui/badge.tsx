/** @jsxImportSource react */
import * as React from "react"
import { cn } from "../../lib/cn"

export function Badge(props: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground",
        props.className,
      )}
    />
  )
}
