// ---------------------------------------------------------------------------
// Keymap — vim-native keyboard interaction (pure, tested via exports)
// ---------------------------------------------------------------------------

import {
  type SceneSpec,
  type Selection,
  collectSelectableItems,
  removeObject,
  removePass,
  selectionKey,
} from "./state";

export type KeymapAction =
  | { type: "select"; selection: Selection }
  | { type: "play-toggle" }
  | { type: "delete" }
  | { type: "step-frame"; direction: -1 | 1; big: boolean }
  | { type: "focus-inspector" }
  | { type: "focus-tree" }
  | { type: "show-help" }
  | { type: "none" };

/** Given the current selection and a key event, return an action. Pure function. */
export function mapKey(
  key: string,
  shift: boolean,
  spec: SceneSpec | null,
  selection: Selection,
): KeymapAction {
  if (spec === null) return { type: "none" };

  const items = collectSelectableItems(spec);
  const currentIdx = items.findIndex((s) => selectionKey(s) === selectionKey(selection));

  switch (key) {
    // Navigation
    case "j":
    case "ArrowDown": {
      const next = currentIdx < items.length - 1 ? currentIdx + 1 : currentIdx;
      const sel = items[next];
      return sel !== undefined ? { type: "select", selection: sel } : { type: "none" };
    }
    case "k":
    case "ArrowUp": {
      const prev = currentIdx > 0 ? currentIdx - 1 : 0;
      const sel = items[prev];
      return sel !== undefined ? { type: "select", selection: sel } : { type: "none" };
    }
    case "g": // gg → first item (simplified: single g goes to first)
    case "Home": {
      const first = items[0];
      return first !== undefined ? { type: "select", selection: first } : { type: "none" };
    }
    case "G":
    case "End": {
      const last = items.at(-1);
      return last !== undefined ? { type: "select", selection: last } : { type: "none" };
    }

    // Selection → inspector focus
    case "Enter":
    case "l":
    case "ArrowRight":
      return { type: "focus-inspector" };

    // Back to tree
    case "Escape":
    case "h":
    case "ArrowLeft":
      return { type: "focus-tree" };

    // Playback
    case " ":
      return { type: "play-toggle" };

    // Frame stepping
    case "[":
      return { type: "step-frame", direction: -1, big: shift };
    case "]":
      return { type: "step-frame", direction: 1, big: shift };

    // Delete
    case "Delete":
    case "Backspace":
    case "x":
      return { type: "delete" };

    // Help overlay
    case "?":
      return { type: "show-help" };

    default:
      return { type: "none" };
  }
}

/** Process a delete action on the current selection. Returns new selection. */
export function applyDelete(spec: SceneSpec, selection: Selection): Selection {
  if (selection.type === "object") {
    removeObject(spec, selection.id);
    return { type: "none" };
  }
  if (selection.type === "pass") {
    removePass(spec, selection.index);
    return { type: "none" };
  }
  return selection;
}

/** Keymap help text for the overlay */
export const KEYMAP_HELP = [
  ["j / \u2193", "Next item"],
  ["k / \u2191", "Previous item"],
  ["g / Home", "First item"],
  ["G / End", "Last item"],
  ["Enter / l", "Focus inspector"],
  ["Esc / h", "Back to tree"],
  ["Space", "Play / pause"],
  ["[ / ]", "Step frame (Shift = beat jump)"],
  ["x / Del", "Delete selected"],
  ["?", "Toggle this help"],
] as const;
