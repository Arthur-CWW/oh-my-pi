import { useEffect, useState } from "react"
import type * as React from "react"

import { DashboardView } from "./components/DashboardView"
import { CardTable } from "./components/CardTable"
import { EnrichView } from "./components/EnrichView"
import { FeedbackWidget } from "./components/FeedbackWidget"
import { Header } from "./components/Header"
import { KeymapOverlay } from "./components/KeymapOverlay"
import { PipelineMap } from "./components/PipelineMap"
import { ReadLibrary } from "./components/ReadLibrary"
import { Reader } from "./components/Reader"
import { ReviewInbox } from "./components/ReviewInbox"
import { ReviewView } from "./components/ReviewView"
import { SchedulerXray } from "./components/SchedulerXray"
import { ShadowView } from "./components/ShadowView"
import { TabsReview } from "./components/TabsReview"
import { useHashRoute } from "./hooks/useHashRoute"
import { logEvent, useTelemetry } from "./hooks/useTelemetry"
// ---------------------------------------------------------------------------
// Context-sensitive keymap definitions
// ---------------------------------------------------------------------------

const READER_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["click"], label: "look up word · auto-queue" },
  { keys: ["Space"], label: "play / pause" },
  { keys: ["P"], label: "toggle pinyin" },
  { keys: ["[", "]"], label: "decrease / increase playback rate" },
  { keys: ["j", "k"], label: "focus paragraph down / up" },
  { keys: ["g", "G"], label: "first / last paragraph" },
  { keys: ["u"], label: "undo mark (in popup)" },
  { keys: ["p"], label: "push priority (in popup)" },
  { keys: ["Esc"], label: "close popup · back to library" },
  { keys: ["?"], label: "toggle this help" },
]

const LIBRARY_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["j", "k"], label: "focus doc down / up" },
  { keys: ["g", "G"], label: "first / last doc" },
  { keys: ["Enter"], label: "open focused doc" },
  { keys: ["/"], label: "filter docs" },
  { keys: ["n"], label: "new document (paste)" },
  { keys: ["Esc"], label: "close filter / paste form" },
  { keys: ["?"], label: "toggle this help" },
]

const REVIEW_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["j", "k"], label: "focus item down / up (triage)" },
  { keys: ["g", "G"], label: "first / last item (triage)" },
  { keys: ["s"], label: "keep (save for review)" },
  { keys: ["m"], label: "mark known" },
  { keys: ["x"], label: "discard" },
  { keys: ["Enter", "o"], label: "open provenance" },
  { keys: ["Space"], label: "reveal answer (session)" },
  { keys: ["1", "2", "3", "4"], label: "grade again / hard / good / easy (session)" },
  { keys: ["Esc"], label: "clear focus · hide answer" },
  { keys: ["?"], label: "toggle this help" },
]

const INBOX_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["j", "k"], label: "focus review card down / up" },
  { keys: ["Enter"], label: "respond to focused card · send from input" },
  { keys: ["Shift", "Enter"], label: "newline in response" },
  { keys: ["Esc"], label: "exit response input" },
  { keys: ["?"], label: "toggle this help" },
]

const SHADOW_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Space"], label: "play / pause" },
  { keys: ["j", "k"], label: "focus sentence down / up" },
  { keys: ["h", "l"], label: "jump back / forward + play" },
  { keys: ["Enter"], label: "play focused sentence" },
  { keys: ["r"], label: "A-B loop sentence" },
  { keys: ["p"], label: "toggle pinyin / hanzi / both" },
  { keys: ["g", "G"], label: "first / last sentence" },
  { keys: ["Esc"], label: "stop loop · pause" },
  { keys: ["?"], label: "toggle this help" },
]

const ENRICH_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["r"], label: "run enrichment for focused item" },
  { keys: ["j", "k"], label: "focus enrichment record down / up" },
  { keys: ["Enter"], label: "open focused record" },
  { keys: ["e"], label: "open enrichment surface" },
  { keys: ["?"], label: "toggle this help" },
]

const SCHEDULER_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["r"], label: "refresh session and telemetry" },
  { keys: ["1", "2", "3", "4"], label: "add again / hard / good / easy simulation grade" },
  { keys: ["Backspace"], label: "remove last simulation grade" },
  { keys: ["p"], label: "preset all good ×8" },
  { keys: ["g"], label: "preset good / good / again / good…" },
  { keys: ["?"], label: "toggle this help" },
]

const PIPELINE_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["j", "k"], label: "move between pipeline stages" },
  { keys: ["Enter"], label: "open focused stage" },
  { keys: ["r"], label: "refresh pipeline counts" },
  { keys: ["!"], label: "leave a vibe check" },
  { keys: ["?"], label: "toggle this help" },
]

const CARDS_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["j", "k", "↑", "↓", "←", "→"], label: "focus card down / up" },
  { keys: ["Enter"], label: "open card detail" },
  { keys: ["Esc"], label: "close card detail" },
  { keys: ["?"], label: "toggle this help" },
]

const TABS_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["j", "k"], label: "focus tab down / up" },
  { keys: ["g", "G"], label: "first / last tab" },
  { keys: ["/"], label: "search tabs" },
  { keys: ["x"], label: "toggle select (review batch)" },
  { keys: ["A"], label: "select all visible" },
  { keys: ["Enter", "o"], label: "load tab content" },
  { keys: ["s"], label: "keep" },
  { keys: ["l"], label: "read later" },
  { keys: ["a"], label: "archive" },
  { keys: ["d"], label: "close duplicate" },
  { keys: ["e"], label: "exclude domain" },
  { keys: ["v"], label: "snapshot now" },
  { keys: ["Enter", "y"], label: "confirm · Esc cancel (in dialog)" },
  { keys: ["Esc"], label: "clear selection · focus" },
  { keys: ["?"], label: "toggle this help" },
]

// ---------------------------------------------------------------------------
// App — thin router shell
// ---------------------------------------------------------------------------

export default function App(): React.JSX.Element {
  const route = useHashRoute()
  useTelemetry()
  const [helpOpen, setHelpOpen] = useState(false)
  const toggleHelp = () => setHelpOpen((v) => !v)
  const routeKey = route.view === "reader" ? `${route.view}:${route.docId}:${route.markId ?? ""}` : route.view

  useEffect(() => {
    logEvent("nav", { route: typeof window === "undefined" ? "#/" : window.location.hash || "#/" })
  }, [routeKey])

  const routeSegment =
    route.view === "reader" || route.view === "library" ? "read"
    : route.view === "review" ? "review"
    : route.view === "shadow" ? "shadow"
    : route.view === "inbox" ? "inbox"
    : route.view === "enrich" ? "enrich"
    : route.view === "scheduler" ? "scheduler"
    : route.view === "pipeline" ? "pipeline"
    : route.view === "cards" ? "cards"
    : route.view === "tabs" ? "tabs"
    : ""

  const keymapKeys =
    route.view === "reader"
      ? READER_KEYS
      : route.view === "library"
        ? LIBRARY_KEYS
        : route.view === "review"
          ? REVIEW_KEYS
          : route.view === "inbox"
            ? INBOX_KEYS
            : route.view === "shadow"
              ? SHADOW_KEYS
              : route.view === "enrich"
              ? ENRICH_KEYS
              : route.view === "scheduler"
                ? SCHEDULER_KEYS
                : route.view === "pipeline"
                  ? PIPELINE_KEYS
                  : route.view === "cards"
                    ? CARDS_KEYS
                    : route.view === "tabs"
                      ? TABS_KEYS
                      : undefined

  let content: React.JSX.Element
  switch (route.view) {
    case "reader":
      content = <Reader docId={route.docId} markId={route.markId} onShowHelp={toggleHelp} />
      break
    case "library":
      content = <ReadLibrary onShowHelp={toggleHelp} />
      break
    case "review":
      content = <ReviewView onShowHelp={toggleHelp} />
      break
    case "inbox":
      content = <ReviewInbox />
      break
    case "cards":
      content = <CardTable />
      break
    case "shadow":
      content = <ShadowView onShowHelp={toggleHelp} />
      break
    case "enrich":
      content = <EnrichView />
      break
    case "scheduler":
      content = <SchedulerXray />
      break
    case "pipeline":
      content = <PipelineMap />
      break
    case "tabs":
      content = <TabsReview onShowHelp={toggleHelp} />
      break
    default:
      return (
        <div className="min-h-svh bg-background text-foreground">
          <Header routeSegment={routeSegment} />
          <DashboardView />
          <FeedbackWidget />
        </div>
      )
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header routeSegment={routeSegment} />
      {content}
      <FeedbackWidget />
      {helpOpen && keymapKeys ? (
        <KeymapOverlay keys={keymapKeys} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  )
}
