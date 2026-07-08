import { describe, expect, test } from "bun:test";
import {
  type GalleryNavState,
  cycleFilter,
  gridMove,
  mapGalleryKey,
} from "../src/ui/gallery/keymap";

// ---------------------------------------------------------------------------
// gridMove — grid-aware navigation with column-edge clamping
// ---------------------------------------------------------------------------

describe("gridMove", () => {
  // A 3-column grid over 8 cells:
  //   0 1 2
  //   3 4 5
  //   6 7
  const COLS = 3;
  const TOTAL = 8;

  test("down adds one row, clamped to last cell", () => {
    expect(gridMove(1, COLS, TOTAL, "down")).toBe(4);
    // 6 + 3 = 9 → past the end → clamp to last index (7)
    expect(gridMove(6, COLS, TOTAL, "down")).toBe(7);
  });

  test("up subtracts one row, clamped to 0", () => {
    expect(gridMove(4, COLS, TOTAL, "up")).toBe(1);
    // 1 - 3 = -2 → clamp to 0
    expect(gridMove(1, COLS, TOTAL, "up")).toBe(0);
  });

  test("left moves within a row but stops at the left column edge", () => {
    expect(gridMove(4, COLS, TOTAL, "left")).toBe(3);
    // 3 is the left column (col 0) → no wrap to previous row
    expect(gridMove(3, COLS, TOTAL, "left")).toBe(3);
  });

  test("right moves within a row but stops at the right column edge and last cell", () => {
    expect(gridMove(3, COLS, TOTAL, "right")).toBe(4);
    // 5 is the right column (col 2) → no wrap to next row
    expect(gridMove(5, COLS, TOTAL, "right")).toBe(5);
    // 7 is the last cell in a short final row (col 1) → right is blocked by total
    expect(gridMove(7, COLS, TOTAL, "right")).toBe(7);
  });

  test("empty grid never moves off zero", () => {
    expect(gridMove(0, COLS, 0, "down")).toBe(0);
    expect(gridMove(0, COLS, 0, "right")).toBe(0);
  });

  test("single column behaves like a vertical list", () => {
    expect(gridMove(2, 1, 5, "down")).toBe(3);
    expect(gridMove(2, 1, 5, "up")).toBe(1);
    // left/right are inert in a 1-wide grid
    expect(gridMove(2, 1, 5, "left")).toBe(2);
    expect(gridMove(2, 1, 5, "right")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// cycleFilter — all → videos → toys → all
// ---------------------------------------------------------------------------

describe("cycleFilter", () => {
  test("advances through the ring and wraps", () => {
    expect(cycleFilter("all")).toBe("videos");
    expect(cycleFilter("videos")).toBe("toys");
    expect(cycleFilter("toys")).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// mapGalleryKey — grid mode
// ---------------------------------------------------------------------------

function nav(overrides: Partial<GalleryNavState> = {}): GalleryNavState {
  return {
    focus: 0,
    total: 10,
    cols: 4,
    overlayOpen: false,
    helpVisible: false,
    ...overrides,
  };
}

describe("mapGalleryKey (grid mode)", () => {
  test("j/k/h/l map to grid moves with computed target index", () => {
    const state = nav({ focus: 5, cols: 4, total: 10 });
    expect(mapGalleryKey("j", state)).toEqual({ type: "move", index: 9 });
    expect(mapGalleryKey("k", state)).toEqual({ type: "move", index: 1 });
    expect(mapGalleryKey("h", state)).toEqual({ type: "move", index: 4 });
    expect(mapGalleryKey("l", state)).toEqual({ type: "move", index: 6 });
  });

  test("arrow keys alias the hjkl moves", () => {
    const state = nav({ focus: 5, cols: 4, total: 10 });
    expect(mapGalleryKey("ArrowDown", state)).toEqual(mapGalleryKey("j", state));
    expect(mapGalleryKey("ArrowUp", state)).toEqual(mapGalleryKey("k", state));
    expect(mapGalleryKey("ArrowLeft", state)).toEqual(mapGalleryKey("h", state));
    expect(mapGalleryKey("ArrowRight", state)).toEqual(mapGalleryKey("l", state));
  });

  test("Home jumps to first, G/End jump to last", () => {
    const state = nav({ focus: 5, total: 10 });
    expect(mapGalleryKey("Home", state)).toEqual({ type: "move", index: 0 });
    expect(mapGalleryKey("G", state)).toEqual({ type: "move", index: 9 });
    expect(mapGalleryKey("End", state)).toEqual({ type: "move", index: 9 });
  });

  test("G on an empty grid clamps to 0 (never -1)", () => {
    expect(mapGalleryKey("G", nav({ focus: 0, total: 0 }))).toEqual({ type: "move", index: 0 });
  });

  test("Enter opens, o opens the report, f cycles the filter, ? toggles help", () => {
    const state = nav();
    expect(mapGalleryKey("Enter", state)).toEqual({ type: "open" });
    expect(mapGalleryKey("o", state)).toEqual({ type: "open-report" });
    expect(mapGalleryKey("f", state)).toEqual({ type: "cycle-filter" });
    expect(mapGalleryKey("?", state)).toEqual({ type: "help-toggle" });
  });

  test("n opens the reference-note panel", () => {
    expect(mapGalleryKey("n", nav())).toEqual({ type: "open-note" });
  });

  test("unmapped keys are inert", () => {
    expect(mapGalleryKey("x", nav())).toEqual({ type: "none" });
    expect(mapGalleryKey("Tab", nav())).toEqual({ type: "none" });
  });
});

// ---------------------------------------------------------------------------
// mapGalleryKey — overlay mode swallows grid keys
// ---------------------------------------------------------------------------

describe("mapGalleryKey (overlay open)", () => {
  const state = nav({ overlayOpen: true });

  test("Escape closes the overlay, Space toggles playback", () => {
    expect(mapGalleryKey("Escape", state)).toEqual({ type: "close-overlay" });
    expect(mapGalleryKey(" ", state)).toEqual({ type: "toggle-play" });
  });

  test("grid navigation and actions are swallowed so focus never drifts under the modal", () => {
    for (const key of ["j", "k", "h", "l", "Enter", "o", "f", "n", "?", "G"]) {
      expect(mapGalleryKey(key, state)).toEqual({ type: "none" });
    }
  });
});

// ---------------------------------------------------------------------------
// mapGalleryKey — help mode
// ---------------------------------------------------------------------------

describe("mapGalleryKey (help visible)", () => {
  const state = nav({ helpVisible: true });

  test("? and Escape both dismiss help", () => {
    expect(mapGalleryKey("?", state)).toEqual({ type: "help-toggle" });
    expect(mapGalleryKey("Escape", state)).toEqual({ type: "help-toggle" });
  });

  test("everything else is inert while help is up", () => {
    for (const key of ["j", "k", "Enter", "o", "f", "n", " "]) {
      expect(mapGalleryKey(key, state)).toEqual({ type: "none" });
    }
  });

  test("overlay takes precedence over help when both are somehow set", () => {
    // Overlay branch is checked first: Space is a playback toggle, not inert.
    expect(mapGalleryKey(" ", nav({ overlayOpen: true, helpVisible: true }))).toEqual({ type: "toggle-play" });
  });
});
