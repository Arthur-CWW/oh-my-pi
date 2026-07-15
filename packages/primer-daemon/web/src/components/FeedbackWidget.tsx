import { useEffect, useMemo, useState } from "react"
import type * as React from "react"

import { submitFeedback, type FeedbackVerdict } from "@/api"
import { logEvent } from "@/hooks/useTelemetry"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Textarea } from "./ui/textarea"

const VERDICTS: Array<{ value: FeedbackVerdict; key: string; label: string; tone: string }> = [
  { value: "good", key: "1", label: "Good", tone: "text-emerald-400" },
  { value: "wrong", key: "2", label: "Wrong", tone: "text-rose-400" },
  { value: "confusing", key: "3", label: "Confusing", tone: "text-amber-400" },
  { value: "idea", key: "4", label: "Idea", tone: "text-sky-400" },
]

const KEY_TO_VERDICT: Record<string, FeedbackVerdict> = {
  "1": "good",
  "2": "wrong",
  "3": "confusing",
  g: "good",
  w: "wrong",
  c: "confusing",
  i: "idea",
}

export function FeedbackWidget(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<FeedbackVerdict>("good")
  const [note, setNote] = useState("")
  const [openedAt, setOpenedAt] = useState(() => new Date().toISOString())
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const surface = typeof window === "undefined" ? "/" : window.location.hash.replace(/^#/, "") || "/"
  const contextPreview = useMemo(() => JSON.stringify({ route: surface, timestamp: openedAt }), [openedAt, surface])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (event.key === "!") {
        event.preventDefault()
        setOpenedAt(new Date().toISOString())
        setOpen(true)
        return
      }
      if (!open) return
      const next = KEY_TO_VERDICT[event.key.toLowerCase()]
      if (next) {
        event.preventDefault()
        setVerdict(next)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 2_500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const submit = () => {
    setBusy(true)
    const context = { route: surface, timestamp: openedAt }
    submitFeedback({ surface, verdict, note: note.trim() || undefined, context }).then(
      () => {
        logEvent("feedback_submitted", { route: surface, verdict })
        setBusy(false)
        setOpen(false)
        setNote("")
        setToast("Feedback saved")
      },
      () => {
        setBusy(false)
        setToast("Feedback could not be saved")
      },
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="fixed right-4 bottom-4 z-40 rounded-full border-border/80 bg-background/90 text-xs font-semibold shadow-sm backdrop-blur"
        aria-label="Give feedback"
        onClick={() => {
          setOpenedAt(new Date().toISOString())
          setOpen(true)
        }}
      >
        !
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vibe check</DialogTitle>
            <DialogDescription>What did this surface feel like?</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {VERDICTS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={verdict === option.value ? "secondary" : "outline"}
                className="justify-between"
                onClick={() => setVerdict(option.value)}
              >
                <span className={option.tone}>{option.label}</span>
                <kbd className="font-mono text-[10px] text-muted-foreground">{option.key} · {option.value[0]}</kbd>
              </Button>
            ))}
          </div>

          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note for the next pass…"
            rows={4}
            aria-label="Feedback note"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground/65">captured context · {contextPreview}</p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Send feedback"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <div role="status" className="fixed right-4 bottom-16 z-40 rounded-md border border-border/80 bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm">
          {toast}
        </div>
      ) : null}
    </>
  )
}
