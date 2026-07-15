import { useEffect } from "react"

import { postUiEvents, type JsonObject, type UiEventInput } from "@/api"

const FLUSH_INTERVAL_MS = 5_000
const EVENTS_ENDPOINT = "/api/events"

const pendingEvents: UiEventInput[] = []
let flushInFlight: Promise<void> | null = null

/** Queue a small interaction record for the next telemetry flush. */
export function logEvent(kind: string, payload?: JsonObject): void {
  pendingEvents.push(payload ? { kind, payload } : { kind })
}

function sendBeacon(): boolean {
  if (pendingEvents.length === 0 || typeof navigator.sendBeacon !== "function") return false

  const batch = pendingEvents.splice(0, pendingEvents.length)
  const body = new Blob([JSON.stringify({ events: batch })], { type: "application/json" })
  if (navigator.sendBeacon(EVENTS_ENDPOINT, body)) return true

  pendingEvents.unshift(...batch)
  return false
}

export async function flushTelemetry(): Promise<void> {
  if (pendingEvents.length === 0) return
  if (flushInFlight) return flushInFlight

  const batch = pendingEvents.splice(0, pendingEvents.length)
  const request = postUiEvents(batch).then(
    () => undefined,
    () => {
      pendingEvents.unshift(...batch)
    },
  )
  flushInFlight = request.finally(() => {
    flushInFlight = null
  })
  return flushInFlight
}

function flushOnExit(): void {
  if (!sendBeacon()) void flushTelemetry()
}

/** Install the shared five-second + lifecycle flush loop once per app shell. */
export function useTelemetry(): { logEvent: typeof logEvent; flush: typeof flushTelemetry } {
  useEffect(() => {
    const interval = window.setInterval(() => void flushTelemetry(), FLUSH_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushOnExit()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pagehide", flushOnExit)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pagehide", flushOnExit)
      void flushTelemetry()
    }
  }, [])

  return { logEvent, flush: flushTelemetry }
}
