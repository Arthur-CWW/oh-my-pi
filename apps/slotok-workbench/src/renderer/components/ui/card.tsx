/** @jsxImportSource react */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/cn"

export const cardVariants = cva(
  "border border-border bg-card text-card-foreground transition-all duration-150",
  {
    variants: {
      variant: {
        default: "rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)]",
        flat: "rounded-md shadow-none",
        panel: "rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)]",
        selected: "rounded-lg border-primary shadow-[0_0_0_1px_hsl(var(--primary))]",
      },
      density: {
        default: "",
        compact: "text-xs",
        roomy: "",
      },
    },
    defaultVariants: {
      variant: "default",
      density: "default",
    },
  },
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, density, ...props }: CardProps) {
  return <div {...props} className={cn(cardVariants({ variant, density, className }))} />
}

export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("flex flex-col gap-1.5 p-3.5", props.className)} />
}

export function CardTitle(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 {...props} className={cn("text-sm font-semibold leading-5 tracking-normal", props.className)} />
}

export function CardContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("p-3.5 pt-0", props.className)} />
}
