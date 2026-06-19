/** @jsxImportSource react */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/cn"

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 tracking-normal",
  {
    variants: {
      variant: {
        default: "border-zinc-200 bg-zinc-100 text-zinc-800",
        outline: "border-zinc-200/80 bg-transparent text-zinc-500",
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
        warning: "border-amber-500/20 bg-amber-500/10 text-amber-700",
        danger: "border-red-500/20 bg-red-500/10 text-red-700",
        info: "border-blue-500/20 bg-blue-500/10 text-blue-700",
        agent: "border-violet-500/20 bg-violet-500/10 text-violet-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cn(badgeVariants({ variant, className }))}
    />
  )
}
