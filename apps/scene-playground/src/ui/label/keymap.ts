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
  | { type: "autoplay-toggle" }
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

  // When inspecting, Escape/i exits inspect; p toggles autoplay
  if (state.inspecting) {
    if (key === "Escape" || key === "i") return { type: "inspect-toggle" };
    if (key === "p") return { type: "autoplay-toggle" };
    return { type: "none" };
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

    // Autoplay
    case "p":
      return { type: "autoplay-toggle" };

    default:
      return { type: "none" };
  }
}

export const LABEL_KEYMAP_HELP = [
  ["j/k", "Move down / up"],
  ["h/l", "Move left / right"],
  ["Home / G", "First / last item"],
  ["v", "Visual mode (range select)"],
  ["Space", "Toggle mark on item"],
  ["1-9", "Assign marked to group N"],
  ["u", "Remove labels from item(s)"],
  ["a / g", "Add group (bind next digit)"],
  [":group name", "Create group by command"],
  ["i", "Inspect focused item"],
  ["p", "Autoplay labeled items"],
  ["Esc", "Clear marks / stop autoplay"],
  ["/", "Filter (text or group:<name>)"],
  ["s", "Cycle sort order"],
  ["?", "Toggle this help"],
] as const;
// ---------------------------------------------------------------------------
// Autoplay queue — pure, testable
// ---------------------------------------------------------------------------

export interface AutoplayItem {
  labels: readonly string[];
}

/**
 * Build a queue of item indices for autoplay, ordered by priority:
 *  1. Items in the "interesting" group, if any exist.
 *  2. Labeled items, round-robin across groups for diversity.
 *  3. All items in manifest order (fallback).
 */
export function buildAutoplayQueue(
  items: readonly AutoplayItem[],
  groupNames: readonly string[],
): number[] {
  // Priority 1: "interesting" group
  const interesting: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.labels.includes("interesting")) interesting.push(i);
  }
  if (interesting.length > 0) return interesting;

  // Priority 2: labeled items, round-robin across groups
  const byGroup = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    const labels = items[i]!.labels;
    if (labels.length === 0) continue;
    for (const g of labels) {
      let arr = byGroup.get(g);
      if (arr === undefined) { arr = []; byGroup.set(g, arr); }
      arr.push(i);
    }
  }

  if (byGroup.size > 0) {
    // Use provided group order; add unlisted groups at end
    const ordered = groupNames.filter((n) => byGroup.has(n));
    for (const [k] of byGroup) {
      if (!ordered.includes(k)) ordered.push(k);
    }

    const queue: number[] = [];
    const seen = new Set<number>();
    const cursors = new Map<string, number>();
    for (const g of ordered) cursors.set(g, 0);

    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const gName of ordered) {
        const arr = byGroup.get(gName)!;
        let c = cursors.get(gName)!;
        while (c < arr.length && seen.has(arr[c]!)) c++;
        if (c < arr.length) {
          queue.push(arr[c]!);
          seen.add(arr[c]!);
          cursors.set(gName, c + 1);
          advanced = true;
        }
      }
    }
    if (queue.length > 0) return queue;
  }

  // Priority 3: all items in order
  const all: number[] = [];
  for (let i = 0; i < items.length; i++) all.push(i);
  return all;
}
