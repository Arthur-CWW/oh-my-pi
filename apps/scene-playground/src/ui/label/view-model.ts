// ---------------------------------------------------------------------------
// Label view-model — pure patch computation for incremental DOM updates
// ---------------------------------------------------------------------------

import { visualRange } from "./keymap";

/** Describes a CSS class change on a single grid cell. */
export interface CellPatch {
  /** Filtered index of the cell */
  index: number;
  /** Classes to add */
  add?: readonly string[];
  /** Classes to remove */
  remove?: readonly string[];
}

// ---------------------------------------------------------------------------
// Focus move
// ---------------------------------------------------------------------------

/** Returns the minimal patches to move focus from one cell to another. */
export function computeMovePatch(oldFocus: number, newFocus: number): CellPatch[] {
  if (oldFocus === newFocus) return [];
  return [
    { index: oldFocus, remove: ["focused"] },
    { index: newFocus, add: ["focused"] },
  ];
}

// ---------------------------------------------------------------------------
// Mark toggle
// ---------------------------------------------------------------------------

/** Returns the patch for toggling a mark on a cell. */
export function computeMarkPatch(index: number, wasMarked: boolean): CellPatch[] {
  return wasMarked
    ? [{ index, remove: ["marked"] }]
    : [{ index, add: ["marked"] }];
}

// ---------------------------------------------------------------------------
// Visual mode
// ---------------------------------------------------------------------------

/**
 * Computes the minimal set of cell patches when visual state changes.
 * Handles: entering visual mode, extending selection via focus move,
 * and clearing visual mode entirely.
 */
export function computeVisualPatch(
  oldAnchor: number | null,
  oldFocus: number,
  newAnchor: number | null,
  newFocus: number,
): CellPatch[] {
  const oldSet = rangeToSet(oldAnchor, oldFocus);
  const newSet = rangeToSet(newAnchor, newFocus);

  const patches: CellPatch[] = [];

  // Cells that lost visual
  for (const idx of oldSet) {
    if (!newSet.has(idx)) patches.push({ index: idx, remove: ["visual"] });
  }
  // Cells that gained visual
  for (const idx of newSet) {
    if (!oldSet.has(idx)) patches.push({ index: idx, add: ["visual"] });
  }

  return patches;
}

function rangeToSet(anchor: number | null, focus: number): Set<number> {
  if (anchor === null) return new Set();
  const [lo, hi] = visualRange(anchor, focus);
  const s = new Set<number>();
  for (let i = lo; i <= hi; i++) s.add(i);
  return s;
}

// ---------------------------------------------------------------------------
// Label change (data mutation — targeted text update)
// ---------------------------------------------------------------------------

/** Patch for when an item's labeled state changes. */
export function computeLabelPatch(index: number, hasLabels: boolean): CellPatch[] {
  return hasLabels
    ? [{ index, add: ["labeled"] }]
    : [{ index, remove: ["labeled"] }];
}

// ---------------------------------------------------------------------------
// Bulk clear — used on visual-clear / escape
// ---------------------------------------------------------------------------

/** Patches to remove visual+marked from all affected cells. */
export function computeClearPatch(
  visualAnchor: number | null,
  focus: number,
  marks: ReadonlySet<number>,
): CellPatch[] {
  const patches: CellPatch[] = [];

  if (visualAnchor !== null) {
    const [lo, hi] = visualRange(visualAnchor, focus);
    for (let i = lo; i <= hi; i++) {
      patches.push({ index: i, remove: ["visual"] });
    }
  }

  for (const m of marks) {
    patches.push({ index: m, remove: ["marked"] });
  }

  return patches;
}
