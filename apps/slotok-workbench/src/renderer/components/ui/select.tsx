/** @jsxImportSource react */
import * as React from "react"
import { cn } from "../../lib/cn"

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
))

Select.displayName = "Select"
