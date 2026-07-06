import { X } from "lucide-react"
import type * as React from "react"

const KEYS: { keys: string[]; label: string }[] = [
  { keys: ["j", "k"], label: "focus item down / up" },
  { keys: ["[", "]"], label: "cycle panel" },
  { keys: ["g", "G"], label: "first / last item" },
  { keys: ["Enter"], label: "open · activate" },
  { keys: ["a", "r"], label: "approve / reject card" },
  { keys: ["Esc", "q"], label: "close · clear focus" },
  { keys: ["?"], label: "toggle this help" },
]

export function KeymapOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
      <div className="relative z-10 m-auto mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight">Keyboard</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <dl className="mt-3 divide-y divide-border/60">
          {KEYS.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-1.5">
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd className="flex shrink-0 gap-1">
                {row.keys.map((key) => (
                  <kbd key={key} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/60">Keys are inert while typing; Esc blurs the field first.</p>
      </div>
    </div>
  )
}
