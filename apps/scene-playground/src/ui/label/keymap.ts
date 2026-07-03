// ---------------------------------------------------------------------------
// Label view keymap — pure, tested vim-native interaction
// ---------------------------------------------------------------------------

export type LabelMode = "normal" | "visual";

export interface LabelNavState {
  /** Index of focused cell in the flat item list */
  focus: number;
  /** Total items in the grid */
  total: number;
  /** Number of columns in the current grid layout */
  cols: number;
  /** Indices of individually marked items (Space-toggled) */
  marks: ReadonlySet<number>;
  /** Visual-mode anchor index (set on `v`); null when not in visual mode */
  visualAnchor: number | null;
  /** Whether the filter input is focused */
  filterFocused: boolean;
  /** Whether inspect (detail) pane has focus */
  inspecting: boolean;
}

export type LabelAction =
  | { type: "move"; index: number }
  | { type: "visual-start" }
  | { type: "visual-clear" }
  | { type: "toggle-mark"; index: number }
  | { type: "assign-group"; key: string; indices: number[] }
  | { type: "unassign"; indices: number[] }
  | { type: "inspect-toggle" }
  | { type: "filter-focus" }
  | { type: "help-toggle" }
  | { type: "cycle-sort" }
  | { type: "none" };

/** Compute the visual-mode selected range (inclusive, ordered). */
export function visualRange(anchor: number, focus: number): [number, number] {
  return anchor <= focus ? [anchor, focus] : [focus, anchor];
}

/** All "effective" indices: visual range if active, else marks, else just focus. */
export function effectiveIndices(state: LabelNavState): number[] {
  if (state.visualAnchor !== null) {
    const [lo, hi] = visualRange(state.visualAnchor, state.focus);
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
  }
  if (state.marks.size > 0) return Array.from(state.marks).sort((a, b) => a - b);
  return [state.focus];
}

/** Clamp an index into [0, total-1]. */
function clampIdx(idx: number, total: number): number {
  if (total === 0) return 0;
  return idx < 0 ? 0 : idx >= total ? total - 1 : idx;
}

/** Grid-aware navigation: move within a 2D grid. */
export function gridMove(
  focus: number,
  cols: number,
  total: number,
  dir: "up" | "down" | "left" | "right",
): number {
  if (total === 0) return 0;
  const row = Math.floor(focus / cols);
  const col = focus % cols;
  switch (dir) {
    case "up": return clampIdx(focus - cols, total);
    case "down": return clampIdx(focus + cols, total);
    case "left": return col > 0 ? focus - 1 : focus;
    case "right": return col < cols - 1 && focus < total - 1 ? focus + 1 : focus;
  }
}

/**
 * Find the next unlabeled item index after `from` (wraps around).
 * `labeledSet` contains indices of items that have at least one label.
 */
export function nextUnlabeled(from: number, total: number, labeledSet: ReadonlySet<number>): number {
  if (total === 0) return 0;
  for (let offset = 1; offset < total; offset++) {
    const idx = (from + offset) % total;
    if (!labeledSet.has(idx)) return idx;
  }
  // All labeled — advance by one
  return clampIdx(from + 1, total);
}

/** Pure key mapper. Returns an action given the current state and key event. */
export function mapLabelKey(
  key: string,
  _shift: boolean,
  state: LabelNavState,
): LabelAction {
  // When filter input is focused, only Escape escapes
  if (state.filterFocused) {
    return key === "Escape" ? { type: "filter-focus" } : { type: "none" };
  }

  // When inspecting, Escape exits inspect
  if (state.inspecting) {
    return key === "Escape" || key === "i" ? { type: "inspect-toggle" } : { type: "none" };
  }

  const inVisual = state.visualAnchor !== null;

  // Digit keys 1-9: assign group
  if (key >= "1" && key <= "9") {
    return { type: "assign-group", key, indices: effectiveIndices(state) };
  }

  switch (key) {
    // Grid navigation
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

    // First / last
    case "g":
    case "Home":
      return { type: "move", index: 0 };
    case "G":
    case "End":
      return { type: "move", index: Math.max(0, state.total - 1) };

    // Visual mode
    case "v":
      return inVisual ? { type: "visual-clear" } : { type: "visual-start" };

    // Space: toggle mark on focused item
    case " ":
      return { type: "toggle-mark", index: state.focus };

    // Escape: clear visual/marks
    case "Escape":
      return { type: "visual-clear" };

    // Inspect
    case "i":
      return { type: "inspect-toggle" };

    // Unassign
    case "u":
      return { type: "unassign", indices: effectiveIndices(state) };

    // Filter
    case "/":
      return { type: "filter-focus" };

    // Help
    case "?":
      return { type: "help-toggle" };

    // Sort cycle
    case "s":
      return { type: "cycle-sort" };

    default:
      return { type: "none" };
  }
}

export const LABEL_KEYMAP_HELP = [
  ["j/k", "Move down / up"],
  ["h/l", "Move left / right"],
  ["g / G", "First / last item"],
  ["v", "Visual mode (range select)"],
  ["Space", "Toggle mark on item"],
  ["1-9", "Assign marked to group N"],
  ["u", "Remove labels from item(s)"],
  ["i", "Inspect focused item"],
  ["Esc", "Clear marks / exit mode"],
  ["/", "Filter (text or group:<name>)"],
  ["s", "Cycle sort order"],
  ["?", "Toggle this help"],
] as const;
