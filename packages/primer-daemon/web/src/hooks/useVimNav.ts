import { useCallback, useEffect, useRef, useState } from "react"

/**
 * One navigable panel. `count` is the number of j/k-addressable items; the
 * activate/approve/reject callbacks receive the focused item index.
 */
export interface VimPanel {
  id: string
  count: number
  onActivate?: (index: number) => void
  onApprove?: (index: number) => void
  onReject?: (index: number) => void
}

export interface VimNavOptions {
  /** Ordered — `[` / `]` cycle through this list. */
  panels: VimPanel[]
  overlayOpen: boolean
  onCloseOverlay: () => void
}

export interface VimNav {
  activePanel: number
  focusedIndex: number
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  isActivePanel: (id: string) => boolean
  isFocused: (id: string, index: number) => boolean
  /** Sync focus from pointer interaction (hover / click). */
  focus: (id: string, index: number) => void
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
}

const prefersReducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

function scrollToTarget(panelId: string, index: number): void {
  requestAnimationFrame(() => {
    const selector = index < 0 ? `[data-vim-panel="${panelId}"]` : `[data-vim-panel="${panelId}"][data-vim-index="${index}"]`
    const el = document.querySelector(selector)
    el?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" })
  })
}

/**
 * Keyboard-first navigation across a registry of panels. A single window
 * listener reads the latest options/state through refs, so the handler is
 * stable and the behaviour is easy to reason about by reading this file:
 *
 *   j / k   move item focus (clamped)      g / G   first / last item
 *   [ / ]   cycle active panel             Enter   activate focused item
 *   a / r   approve / reject focused item  ? q     help / clear
 *   Esc     blur input · close overlay · clear focus
 *
 * All keys are inert while typing; Esc always blurs the active field first.
 */
export function useVimNav(options: VimNavOptions): VimNav {
  const [activePanel, setActivePanel] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [helpOpen, setHelpOpen] = useState(false)

  const optRef = useRef(options)
  optRef.current = options
  const stateRef = useRef({ activePanel, focusedIndex, helpOpen })
  stateRef.current = { activePanel, focusedIndex, helpOpen }

  const focus = useCallback((id: string, index: number) => {
    const idx = optRef.current.panels.findIndex((p) => p.id === id)
    if (idx < 0) return
    setActivePanel(idx)
    setFocusedIndex(index)
    scrollToTarget(id, index)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const { panels, overlayOpen, onCloseOverlay } = optRef.current
      const { activePanel: ap, focusedIndex: fi, helpOpen: help } = stateRef.current

      if (e.key === "Escape") {
        if (isTyping()) {
          ;(document.activeElement as HTMLElement | null)?.blur()
        } else if (help) {
          setHelpOpen(false)
        } else if (overlayOpen) {
          onCloseOverlay()
        } else {
          setFocusedIndex(-1)
        }
        e.preventDefault()
        return
      }

      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === "?") {
        setHelpOpen((v) => !v)
        e.preventDefault()
        return
      }
      if (e.key === "q") {
        if (help) setHelpOpen(false)
        else if (overlayOpen) onCloseOverlay()
        else setFocusedIndex(-1)
        e.preventDefault()
        return
      }

      // Remaining keys drive panel navigation; suppressed while a layer is open.
      if (help || overlayOpen) return
      const panel = panels[ap]
      if (!panel) return

      switch (e.key) {
        case "[":
        case "]": {
          const dir = e.key === "]" ? 1 : -1
          const next = (ap + dir + panels.length) % panels.length
          setActivePanel(next)
          setFocusedIndex(-1)
          scrollToTarget(panels[next].id, -1)
          e.preventDefault()
          break
        }
        case "j": {
          if (panel.count === 0) break
          const next = Math.min(fi + 1, panel.count - 1)
          setFocusedIndex(next)
          scrollToTarget(panel.id, next)
          e.preventDefault()
          break
        }
        case "k": {
          if (panel.count === 0) break
          const next = Math.max(fi - 1, 0)
          setFocusedIndex(next)
          scrollToTarget(panel.id, next)
          e.preventDefault()
          break
        }
        case "g": {
          if (panel.count === 0) break
          setFocusedIndex(0)
          scrollToTarget(panel.id, 0)
          e.preventDefault()
          break
        }
        case "G": {
          if (panel.count === 0) break
          const last = panel.count - 1
          setFocusedIndex(last)
          scrollToTarget(panel.id, last)
          e.preventDefault()
          break
        }
        case "Enter":
          if (fi >= 0) {
            panel.onActivate?.(fi)
            e.preventDefault()
          }
          break
        case "a":
          if (fi >= 0) {
            panel.onApprove?.(fi)
            e.preventDefault()
          }
          break
        case "r":
          if (fi >= 0) {
            panel.onReject?.(fi)
            e.preventDefault()
          }
          break
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Keep focus in range as panels grow/shrink underneath us.
  const active = options.panels[activePanel]
  useEffect(() => {
    if (active && focusedIndex >= active.count) setFocusedIndex(active.count - 1)
  }, [active, focusedIndex])

  return {
    activePanel,
    focusedIndex,
    helpOpen,
    setHelpOpen,
    isActivePanel: (id) => options.panels[activePanel]?.id === id,
    isFocused: (id, index) => options.panels[activePanel]?.id === id && focusedIndex === index,
    focus,
  }
}
