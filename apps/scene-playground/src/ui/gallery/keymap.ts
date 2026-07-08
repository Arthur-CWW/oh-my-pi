// ---------------------------------------------------------------------------
// Gallery view keymap — pure, tested vim-native interaction
//
// Navigation is CSS-class-patch only (never a grid rebuild). Overlay + help
// modes swallow grid keys so focus never drifts underneath a modal.
// ---------------------------------------------------------------------------

import type { GalleryFilter } from "./data";

export interface GalleryNavState {
  focus: number;
  total: number;
  cols: number;
  overlayOpen: boolean;
  helpVisible: boolean;
}

export type GalleryAction =
  | { type: "move"; index: number }
  | { type: "open" }
  | { type: "close-overlay" }
  | { type: "toggle-play" }
  | { type: "open-report" }
  | { type: "cycle-filter" }
  | { type: "help-toggle" }
  | { type: "none" };

function clampIdx(idx: number, total: number): number {
  if (total <= 0) return 0;
  if (idx < 0) return 0;
  if (idx >= total) return total - 1;
  return idx;
}

/** Grid-aware navigation within a `cols`-wide grid. Column edges clamp. */
export function gridMove(focus: number, cols: number, total: number, dir: "up" | "down" | "left" | "right"): number {
  if (total === 0) return 0;
  const col = focus % cols;
  switch (dir) {
    case "up": return clampIdx(focus - cols, total);
    case "down": return clampIdx(focus + cols, total);
    case "left": return col > 0 ? focus - 1 : focus;
    case "right": return col < cols - 1 && focus < total - 1 ? focus + 1 : focus;
  }
}

const FILTER_ORDER: readonly GalleryFilter[] = ["all", "videos", "toys"];

/** all → videos → toys → all. */
export function cycleFilter(current: GalleryFilter): GalleryFilter {
  const i = FILTER_ORDER.indexOf(current);
  return FILTER_ORDER[(i + 1) % FILTER_ORDER.length]!;
}

/** Pure key mapper. Returns an action given the current key + nav state. */
export function mapGalleryKey(key: string, state: GalleryNavState): GalleryAction {
  // Overlay open: only playback + close keys are live.
  if (state.overlayOpen) {
    if (key === "Escape") return { type: "close-overlay" };
    if (key === " ") return { type: "toggle-play" };
    return { type: "none" };
  }

  // Help open: ? or Esc dismisses; everything else is inert.
  if (state.helpVisible) {
    if (key === "?" || key === "Escape") return { type: "help-toggle" };
    return { type: "none" };
  }

  switch (key) {
    case "j":
    case "ArrowDown":
      return { type: "move", index: gridMove(state.focus, state.cols, state.total, "down") };
    case "k":
    case "ArrowUp":
      return { type: "move", index: gridMove(state.focus, state.cols, state.total, "up") };
    case "h":
    case "ArrowLeft":
      return { type: "move", index: gridMove(state.focus, state.cols, state.total, "left") };
    case "l":
    case "ArrowRight":
      return { type: "move", index: gridMove(state.focus, state.cols, state.total, "right") };
    case "Home":
      return { type: "move", index: 0 };
    case "G":
    case "End":
      return { type: "move", index: Math.max(0, state.total - 1) };
    case "Enter":
      return { type: "open" };
    case "o":
      return { type: "open-report" };
    case "f":
      return { type: "cycle-filter" };
    case "?":
      return { type: "help-toggle" };
    default:
      return { type: "none" };
  }
}

export const GALLERY_KEYMAP_HELP = [
  ["j / k", "Move down / up"],
  ["h / l", "Move left / right"],
  ["G", "Jump to last"],
  ["Enter", "Expand video with sound · open toy in new tab"],
  ["Space", "Play / pause (overlay)"],
  ["Esc", "Close overlay / help"],
  ["o", "Open parent report"],
  ["f", "Filter: all → videos → toys"],
  ["?", "Toggle this help"],
] as const;
