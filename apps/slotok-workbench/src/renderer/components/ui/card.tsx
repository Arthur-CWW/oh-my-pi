/** @jsxImportSource react */
import * as React from "react"
import { cn } from "../../lib/cn"

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", props.className)} />
}

export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("flex flex-col gap-1.5 p-4", props.className)} />
}

export function CardTitle(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 {...props} className={cn("text-sm font-semibold leading-none", props.className)} />
}

export function CardContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("p-4 pt-0", props.className)} />
}
