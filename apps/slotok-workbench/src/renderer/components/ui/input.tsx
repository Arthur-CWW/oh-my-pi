/** @jsxImportSource react */
import * as React from "react"
import { cn } from "../../lib/cn"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
))

Input.displayName = "Input"
