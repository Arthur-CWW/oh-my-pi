import { useState } from "react"
import type * as React from "react"

import { DashboardView } from "./components/DashboardView"
import { Header } from "./components/Header"
import { KeymapOverlay } from "./components/KeymapOverlay"
import { ReadLibrary } from "./components/ReadLibrary"
import { Reader } from "./components/Reader"
import { ReviewView } from "./components/ReviewView"
import { ShadowView } from "./components/ShadowView"
import { useHashRoute } from "./hooks/useHashRoute"

// ---------------------------------------------------------------------------
// Context-sensitive keymap definitions
// ---------------------------------------------------------------------------

const READER_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["click"], label: "look up word · auto-queue" },
  { keys: ["j", "k"], label: "focus paragraph down / up" },
  { keys: ["g", "G"], label: "first / last paragraph" },
  { keys: ["u"], label: "undo mark (in popup)" },
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
  { keys: ["j", "k"], label: "focus item down / up" },
  { keys: ["g", "G"], label: "first / last item" },
  { keys: ["s"], label: "keep (save for review)" },
  { keys: ["m"], label: "mark known" },
  { keys: ["x"], label: "discard" },
  { keys: ["Enter", "o"], label: "open provenance" },
  { keys: ["Esc"], label: "clear focus" },
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

// ---------------------------------------------------------------------------
// App — thin router shell
// ---------------------------------------------------------------------------

export default function App(): React.JSX.Element {
  const route = useHashRoute()
  const [helpOpen, setHelpOpen] = useState(false)
  const toggleHelp = () => setHelpOpen((v) => !v)

  // Map route view to nav segment for Header highlighting
  const routeSegment =
    route.view === "reader" || route.view === "library" ? "read"
    : route.view === "review" ? "review"
    : route.view === "shadow" ? "shadow"
    : ""

  // Pick keymap for current route
  const keymapKeys =
    route.view === "reader"
      ? READER_KEYS
      : route.view === "library"
        ? LIBRARY_KEYS
        : route.view === "review"
          ? REVIEW_KEYS
          : route.view === "shadow"
            ? SHADOW_KEYS
            : undefined

  // Route content
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
    case "shadow":
      content = <ShadowView onShowHelp={toggleHelp} />
      break
    default:
      // Dashboard manages its own KeymapOverlay via useVimNav
      return (
        <div className="min-h-svh bg-background text-foreground">
          <Header routeSegment={routeSegment} />
          <DashboardView />
        </div>
      )
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header routeSegment={routeSegment} />
      {content}
      {helpOpen && keymapKeys ? (
        <KeymapOverlay keys={keymapKeys} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  )
}
