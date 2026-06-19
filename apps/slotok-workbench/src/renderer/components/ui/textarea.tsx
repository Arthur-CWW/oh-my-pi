/** @jsxImportSource react */
import * as React from "react"
import { cn } from "../../lib/cn"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-20 w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs leading-5 text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
))
