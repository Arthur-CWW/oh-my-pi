// ---------------------------------------------------------------------------
// Label view — yazi-style three-pane media labeler
//
// Rendering strategy (2026-07-03 rewrite):
//   • TanStack virtual-core virtualizes grid rows — only visible + overscan
//     rows exist in the DOM.
//   • Cells are stable DOM elements: navigation (j/k/h/l) toggles CSS
//     classes on ≤2 cells, never rebuilds the grid.
//   • Media discipline: cells render a dark placeholder with type/duration
//     badges. Only the focused cell + detail pane get a <video> element
//     (max 2 in the DOM at any time).
//   • Full grid rebuild only on data changes (load, filter, sort).
// ---------------------------------------------------------------------------

import {
  type LabelNavState,
  type LabelAction,
  LABEL_KEYMAP_HELP,
  mapLabelKey,
  visualRange,
  nextUnlabeled,
  buildAutoplayQueue,
} from "./keymap";
import { reportClientError } from "../error-report";
import { isNotePanelOpen, openNotePanel } from "../notes";
import {
  type CellPatch,
  computeMovePatch,
  computeVisualPatch,
  computeMarkPatch,
  computeClearPatch,
  computeLabelPatch,
} from "./view-model";
import {
  Virtualizer,
  observeElementRect,
  observeElementOffset,
  elementScroll,
} from "@tanstack/virtual-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorpusItem {
  tweetId: string;
  date?: string;
  text?: string;
  mediaType: "video" | "gif";
  file: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  labels: string[];
}

export interface GroupInfo {
  name: string;
  key: string | null;
  count: number;
}

type SortMode = "date" | "duration" | "unlabeled";

interface LabelViewState {
  items: CorpusItem[];
  filteredIndices: number[];
  groups: GroupInfo[];
  focus: number;
  marks: Set<number>;
  visualAnchor: number | null;
  inspecting: boolean;
  filterFocused: boolean;
  filterText: string;
  sortMode: SortMode;
  helpVisible: boolean;
  cols: number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let state: LabelViewState = {
  items: [],
  filteredIndices: [],
  groups: [],
  focus: 0,
  marks: new Set(),
  visualAnchor: null,
  inspecting: false,
  filterFocused: false,
  filterText: "",
  sortMode: "unlabeled",
  helpVisible: false,
  cols: 4,
};

let mounted = false;
let container: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;

// DOM references (created once on mount)
let groupsPane: HTMLElement;
let gridPane: HTMLElement;       // scroll container
let gridInner: HTMLElement;      // absolute-positioned inner for virtualizer
let detailPane: HTMLElement;
let filterInput: HTMLInputElement;
let helpOverlayEl: HTMLElement;

// Virtualizer
let virtualizer: Virtualizer<HTMLElement, HTMLElement> | null = null;
let virtualizerCleanup: (() => void) | null = null;
/** Map from filtered-index → live cell DOM element (only cells in visible rows). */
const cellMap = new Map<number, HTMLElement>();
/** Map from row index → live row DOM element. */
const rowMap = new Map<number, HTMLElement>();

// Video discipline: at most 2 <video> elements in the DOM at any time
let focusedCellVideo: HTMLVideoElement | null = null;

// Autoplay state
let autoplayActive = false;
let autoplayQueue: number[] = [];  // filtered indices
let autoplayPosition = -1;
let autoplayGifTimer: ReturnType<typeof setTimeout> | null = null;

// Save status
let saveStatusTimer: ReturnType<typeof setTimeout> | null = null;

/** corpus media_path → note body, for cell markers + the detail-pane note. */
const noteMap = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function mountLabelView(root: HTMLElement, statusLine: HTMLElement): void {
  container = root;
  statusEl = statusLine;
  if (!mounted) {
    root.innerHTML = buildShell();
    groupsPane = root.querySelector<HTMLElement>(".label-groups")!;
    gridPane = root.querySelector<HTMLElement>(".label-grid")!;
    gridInner = root.querySelector<HTMLElement>(".label-grid-inner")!;
    detailPane = root.querySelector<HTMLElement>(".label-detail")!;
    filterInput = root.querySelector<HTMLInputElement>(".label-filter-input")!;
    helpOverlayEl = root.querySelector<HTMLElement>(".label-help-overlay")!;
    wireFilterInput();
    wireGroupsPane();
    wireGridResize();
    mounted = true;
  }
  void loadData();
}

export function unmountLabelView(): void {
  teardownFocusedVideo();
  if (autoplayGifTimer !== null) { clearTimeout(autoplayGifTimer); autoplayGifTimer = null; }
  autoplayActive = false;
  autoplayQueue = [];
  autoplayPosition = -1;
  if (saveStatusTimer !== null) { clearTimeout(saveStatusTimer); saveStatusTimer = null; }
  if (virtualizerCleanup) { virtualizerCleanup(); virtualizerCleanup = null; }
  virtualizer = null;
}

export function handleLabelKeydown(e: KeyboardEvent): void {
  if (isNotePanelOpen()) return;
  const target = e.target;
  if (target instanceof HTMLInputElement && target.classList.contains("label-filter-input")) {
    if (e.key === "Escape") {
      e.preventDefault();
      target.blur();
      state.filterFocused = false;
      return;
    }
    return;
  }
  if (target instanceof HTMLInputElement && target.classList.contains("group-add-input")) {
    if (e.key === "Escape") { e.preventDefault(); target.remove(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const name = target.value.trim();
      target.remove();
      if (name.length > 0) void addGroup(name);
      return;
    }
    return;
  }
  if (target instanceof HTMLInputElement && target.classList.contains("command-input")) {
    if (e.key === "Escape") { e.preventDefault(); target.remove(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = target.value.trim();
      target.remove();
      const match = raw.match(/^:?group\s+(.+)$/);
      if (match?.[1]) void addGroup(match[1].trim());
      return;
    }
    return;
  }

  const navState: LabelNavState = {
    focus: state.focus,
    total: state.filteredIndices.length,
    cols: state.cols,
    marks: state.marks,
    visualAnchor: state.visualAnchor,
    filterFocused: state.filterFocused,
    inspecting: state.inspecting,
  };

  if ((e.key === "a" || e.key === "g") && !state.inspecting && !state.filterFocused) {
    e.preventDefault();
    promptAddGroup();
    return;
  }

  if (e.key === ":" && !state.inspecting && !state.filterFocused) {
    e.preventDefault();
    promptCommand();
    return;
  }

  const action = mapLabelKey(e.key, e.shiftKey, navState);
  if (action.type === "none") return;
  e.preventDefault();
  applyAction(action);
}

// ---------------------------------------------------------------------------
// Shell HTML
// ---------------------------------------------------------------------------

function buildShell(): string {
  return `
    <div class="label-layout">
      <aside class="label-groups"></aside>
      <section class="label-center">
        <div class="label-toolbar">
          <input type="text" class="label-filter-input" placeholder="/ filter (group:name)" />
        </div>
        <div class="label-grid">
          <div class="label-grid-inner"></div>
        </div>
        <div class="label-hint-strip">
          <kbd>j</kbd><kbd>k</kbd><kbd>h</kbd><kbd>l</kbd> nav
          <span class="hint-sep">·</span>
          <kbd>v</kbd> visual
          <span class="hint-sep">·</span>
          <kbd>space</kbd> mark
          <span class="hint-sep">·</span>
          <kbd>1-9</kbd> group
          <span class="hint-sep">·</span>
          <kbd>a</kbd><kbd>g</kbd> add group
          <span class="hint-sep">·</span>
          <kbd>:</kbd> command
          <span class="hint-sep">·</span>
          <kbd>i</kbd> inspect
          <span class="hint-sep">·</span>
          <kbd>p</kbd> autoplay
          <span class="hint-sep">·</span>
          <kbd>u</kbd> unlabel
          <span class="hint-sep">·</span>
          <kbd>/</kbd> filter
          <span class="hint-sep">·</span>
          <kbd>n</kbd> note
          <span class="hint-sep">·</span>
          <kbd>?</kbd> help
          <span class="label-save-status"></span>
        </div>
      </section>
      <aside class="label-detail"></aside>
    </div>
    <div class="label-help-overlay hidden"></div>
  `;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadData(): Promise<void> {
  try {
    const [corpusRes, groupsRes, notesRes] = await Promise.all([
      fetch("/api/corpus"),
      fetch("/api/label-groups"),
      fetch("/api/notes"),
    ]);
    const corpus: CorpusItem[] = await corpusRes.json();
    const groups: GroupInfo[] = await groupsRes.json();
    const notes = (await notesRes.json()) as Array<{ item_key: string; body: string }>;
    noteMap.clear();
    for (const n of notes) noteMap.set(n.item_key, n.body);
    state.items = corpus;
    state.groups = groups;
    // Seed "interesting" group (key 4) if absent — Arthur explicitly wants this bucket
    if (!state.groups.some((g) => g.name === "interesting")) {
      void (async () => {
        try {
          await fetch("/api/label-groups", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "interesting", key: "4" }),
          });
          await refreshGroups();
        } catch { /* best effort on boot */ }
      })();
    }
    applyFilter();
    renderAll();
  } catch (err) {
    if (gridPane) gridInner.innerHTML = `<div class="label-empty">Failed to load corpus</div>`;
  }
}

// ---------------------------------------------------------------------------
// Filtering & sorting
// ---------------------------------------------------------------------------

function applyFilter(): void {
  const text = state.filterText.trim().toLowerCase();
  let indices = state.items.map((_, i) => i);

  if (text.length > 0) {
    const groupMatch = text.match(/^group:(.+)$/);
    if (groupMatch) {
      const gname = groupMatch[1]!.trim();
      indices = indices.filter((i) => state.items[i]!.labels.some((l) => l.toLowerCase().includes(gname)));
    } else {
      indices = indices.filter((i) => {
        const item = state.items[i]!;
        return (
          (item.text?.toLowerCase().includes(text) ?? false) ||
          item.tweetId.includes(text) ||
          item.labels.some((l) => l.toLowerCase().includes(text))
        );
      });
    }
  }

  indices = sortIndices(indices);
  state.filteredIndices = indices;
  state.focus = Math.min(state.focus, Math.max(0, indices.length - 1));
  state.marks = new Set();
  state.visualAnchor = null;
}

function sortIndices(indices: number[]): number[] {
  const items = state.items;
  switch (state.sortMode) {
    case "unlabeled":
      return indices.slice().sort((a, b) => {
        const al = items[a]!.labels.length;
        const bl = items[b]!.labels.length;
        if (al === 0 && bl > 0) return -1;
        if (al > 0 && bl === 0) return 1;
        return a - b;
      });
    case "date":
      return indices.slice().sort((a, b) => {
        const da = items[a]!.date ?? "";
        const db = items[b]!.date ?? "";
        return da < db ? 1 : da > db ? -1 : 0;
      });
    case "duration":
      return indices.slice().sort((a, b) => {
        return (items[b]!.durationSeconds ?? 0) - (items[a]!.durationSeconds ?? 0);
      });
  }
}

// ---------------------------------------------------------------------------
// Action dispatch — incremental updates for navigation, full for data changes
// ---------------------------------------------------------------------------

function applyAction(action: LabelAction): void {
  // Manual navigation stops autoplay
  if (autoplayActive && (action.type === "move" || action.type === "visual-clear")) {
    stopAutoplay();
  }

  switch (action.type) {
    case "move": {
      const oldFocus = state.focus;
      const oldAnchor = state.visualAnchor;
      state.focus = action.index;

      // Focus patches: O(2) cell mutations
      const focusPatches = computeMovePatch(oldFocus, state.focus);
      applyCellPatches(focusPatches);

      // Visual range patches (if in visual mode)
      if (state.visualAnchor !== null) {
        const vp = computeVisualPatch(oldAnchor, oldFocus, state.visualAnchor, state.focus);
        applyCellPatches(vp);
      }

      // Swap video element between cells
      updateFocusedVideo(oldFocus, state.focus);

      renderDetail();
      updateStatus();
      scrollFocusIntoView();
      break;
    }

    case "visual-start": {
      state.visualAnchor = state.focus;
      // The focused cell gains "visual"
      const cell = cellMap.get(state.focus);
      if (cell) cell.classList.add("visual");
      updateStatus();
      break;
    }

    case "visual-clear": {
      const patches = computeClearPatch(state.visualAnchor, state.focus, state.marks);
      state.visualAnchor = null;
      state.marks = new Set();
      applyCellPatches(patches);
      updateStatus();
      break;
    }

    case "toggle-mark": {
      const wasMarked = state.marks.has(action.index);
      const patches = computeMarkPatch(action.index, wasMarked);
      const next = new Set(state.marks);
      if (wasMarked) next.delete(action.index);
      else next.add(action.index);
      state.marks = next;
      applyCellPatches(patches);
      updateStatus();
      break;
    }

    case "assign-group": {
      const group = groupForKey(action.key);
      if (group === null) break;
      const realIndices = action.indices
        .map((fi) => state.filteredIndices[fi])
        .filter((i): i is number => i !== undefined);
      void assignBatch(realIndices, group.name);

      // Update labeled class on affected cells
      for (const fi of action.indices) {
        const lp = computeLabelPatch(fi, true);
        applyCellPatches(lp);
      }

      // Advance to next unlabeled
      const labeledSet = buildLabeledSet();
      for (const ri of realIndices) labeledSet.add(ri);
      const mappedSet = new Set<number>();
      for (const ri of labeledSet) {
        const fi = state.filteredIndices.indexOf(ri);
        if (fi >= 0) mappedSet.add(fi);
      }
      const oldFocus = state.focus;
      state.focus = nextUnlabeled(state.focus, state.filteredIndices.length, mappedSet);
      state.visualAnchor = null;
      state.marks = new Set();

      // Focus move patches
      applyCellPatches(computeMovePatch(oldFocus, state.focus));
      updateFocusedVideo(oldFocus, state.focus);

      flashGroup(group.name);
      renderDetail();
      renderGroups();
      updateStatus();
      scrollFocusIntoView();
      break;
    }

    case "unassign": {
      const realIndices = action.indices
        .map((fi) => state.filteredIndices[fi])
        .filter((i): i is number => i !== undefined);
      void unassignBatch(realIndices);
      // Update labeled class
      for (const fi of action.indices) {
        const lp = computeLabelPatch(fi, false);
        applyCellPatches(lp);
        // Also update chips in the cell
        const cell = cellMap.get(fi);
        if (cell) {
          const meta = cell.querySelector(".grid-meta");
          if (meta) meta.innerHTML = "";
        }
      }
      renderDetail();
      renderGroups();
      updateStatus();
      break;
    }

    case "inspect-toggle":
      state.inspecting = !state.inspecting;
      renderDetail();
      break;

    case "filter-focus":
      if (state.filterFocused) {
        filterInput.blur();
        state.filterFocused = false;
      } else {
        filterInput.focus();
        state.filterFocused = true;
      }
      break;

    case "help-toggle":
      state.helpVisible = !state.helpVisible;
      renderHelp();
      break;

    case "cycle-sort":
      state.sortMode = state.sortMode === "unlabeled" ? "date" : state.sortMode === "date" ? "duration" : "unlabeled";
      applyFilter();
      renderAll();
      break;

    case "autoplay-toggle":
      if (autoplayActive) {
        stopAutoplay();
      } else {
        startAutoplay();
      }
      break;

    case "note":
      openNoteForFocused();
      break;

    case "none":
      break;
  }
}

// ---------------------------------------------------------------------------
// Autoplay — play through a queue of items, advancing on video end
// ---------------------------------------------------------------------------

function startAutoplay(): void {
  // Build queue from filtered items
  const filteredItems = state.filteredIndices.map((i) => ({
    labels: state.items[i]!.labels,
  }));
  const groupNames = state.groups.map((g) => g.name);
  autoplayQueue = buildAutoplayQueue(filteredItems, groupNames);
  if (autoplayQueue.length === 0) return;

  autoplayActive = true;
  // Start at the current focus if it's in the queue, else first item
  autoplayPosition = autoplayQueue.indexOf(state.focus);
  if (autoplayPosition < 0) autoplayPosition = 0;

  // Move to the first autoplay item
  const oldFocus = state.focus;
  state.focus = autoplayQueue[autoplayPosition]!;
  applyCellPatches(computeMovePatch(oldFocus, state.focus));
  updateFocusedVideo(oldFocus, state.focus);
  renderDetail();
  updateStatus();
  scrollFocusIntoView();
  wireAutoplayEnded();
}

function stopAutoplay(): void {
  autoplayActive = false;
  autoplayQueue = [];
  autoplayPosition = -1;
  if (autoplayGifTimer !== null) {
    clearTimeout(autoplayGifTimer);
    autoplayGifTimer = null;
  }
  // Re-render detail to restore loop on current video
  renderDetail();
  updateStatus();
}

function autoplayAdvance(): void {
  if (!autoplayActive) return;
  autoplayPosition++;
  if (autoplayPosition >= autoplayQueue.length) {
    stopAutoplay();
    return;
  }
  const oldFocus = state.focus;
  state.focus = autoplayQueue[autoplayPosition]!;
  applyCellPatches(computeMovePatch(oldFocus, state.focus));
  updateFocusedVideo(oldFocus, state.focus);
  renderDetail();
  updateStatus();
  scrollFocusIntoView();
  wireAutoplayEnded();
}

function wireAutoplayEnded(): void {
  if (!autoplayActive) return;
  if (autoplayGifTimer !== null) {
    clearTimeout(autoplayGifTimer);
    autoplayGifTimer = null;
  }

  const itemIdx = state.filteredIndices[state.focus];
  if (itemIdx === undefined) return;
  const item = state.items[itemIdx]!;
  const ext = item.file.split(".").pop()?.toLowerCase();

  if (ext === "gif") {
    // GIFs have no ended event — auto-advance after duration or 3s
    const ms = (item.durationSeconds ?? 3) * 1000;
    autoplayGifTimer = setTimeout(autoplayAdvance, ms);
    return;
  }

  // Wire the detail pane video's ended event
  const video = detailPane?.querySelector<HTMLVideoElement>("video.detail-preview");
  if (video) {
    video.loop = false;
    video.addEventListener("ended", autoplayAdvance, { once: true });
  }
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

function applyCellPatches(patches: CellPatch[]): void {
  for (const p of patches) {
    const cell = cellMap.get(p.index);
    if (!cell) continue;
    if (p.add) for (const c of p.add) cell.classList.add(c);
    if (p.remove) for (const c of p.remove) cell.classList.remove(c);
  }
}

// ---------------------------------------------------------------------------
// API calls — optimistic update, then verify response and show save status
// ---------------------------------------------------------------------------

async function assignBatch(itemIndices: number[], groupName: string): Promise<void> {
  // Save old labels for revert on failure
  const snapshots = new Map<number, string[]>();
  for (const idx of itemIndices) {
    const item = state.items[idx];
    if (item !== undefined) {
      snapshots.set(idx, item.labels.slice());
      if (!item.labels.includes(groupName)) item.labels.push(groupName);
    }
  }
  const results = await Promise.allSettled(
    itemIndices
      .map((idx) => state.items[idx])
      .filter((item): item is CorpusItem => item !== undefined)
      .map((item) =>
        fetch("/api/labels", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mediaPath: item.file, group: groupName, op: "add" }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
          }
        }),
      ),
  );
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    // Revert optimistic mutations
    for (const [idx, old] of snapshots) {
      const item = state.items[idx];
      if (item) item.labels = old;
    }
    const msg = `${failures.length} label save(s) failed: ${failures[0]!.reason}`;
    showSaveStatus(false, msg);
  } else {
    showSaveStatus(true, "saved");
  }
  void refreshGroups();
}

async function unassignBatch(itemIndices: number[]): Promise<void> {
  // Save old labels for revert on failure
  const snapshots = new Map<number, string[]>();
  const promises: Promise<Response>[] = [];
  for (const idx of itemIndices) {
    const item = state.items[idx];
    if (item === undefined) continue;
    snapshots.set(idx, item.labels.slice());
    for (const g of item.labels) {
      promises.push(
        fetch("/api/labels", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mediaPath: item.file, group: g, op: "remove" }),
        }),
      );
    }
    item.labels = [];
  }
  const results = await Promise.allSettled(
    promises.map((p) =>
      p.then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
      }),
    ),
  );
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    // Revert optimistic mutations
    for (const [idx, old] of snapshots) {
      const item = state.items[idx];
      if (item) item.labels = old;
    }
    showSaveStatus(false, `${failures.length} remove(s) failed: ${failures[0]!.reason}`);
  } else {
    showSaveStatus(true, "removed");
  }
  void refreshGroups();
}

async function addGroup(name: string): Promise<void> {
  try {
    const res = await fetch("/api/label-groups", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showSaveStatus(false, `group create failed: ${(body as { error?: string }).error ?? res.status}`);
    } else {
      showSaveStatus(true, `group "${name}" created`);
    }
  } catch (err) {
    showSaveStatus(false, `group create failed: ${err instanceof Error ? err.message : "network error"}`);
  }
  await refreshGroups();
  renderGroups();
}

async function refreshGroups(): Promise<void> {
  try {
    const res = await fetch("/api/label-groups");
    state.groups = await res.json();
    renderGroups();
  } catch { /* ignore */ }
}

function showSaveStatus(ok: boolean, detail: string): void {
  const el = container?.querySelector<HTMLElement>(".label-save-status");
  if (!el) return;
  if (saveStatusTimer !== null) {
    clearTimeout(saveStatusTimer);
    saveStatusTimer = null;
  }
  const ts = new Date().toLocaleTimeString();
  el.textContent = ok ? `\u2713 ${detail} ${ts}` : `\u2717 ${detail}`;
  el.className = `label-save-status ${ok ? "save-ok" : "save-fail"}`;
  if (ok) {
    saveStatusTimer = setTimeout(() => {
      el.className = "label-save-status";
      el.textContent = "";
    }, 4000);
  } else {
    // Report failed saves to the server error log via the capped beacon helper
    reportClientError(`Label persistence failure: ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Reference notes
// ---------------------------------------------------------------------------

function openNoteForFocused(): void {
  const fi = state.focus;
  const itemIdx = state.filteredIndices[fi];
  if (itemIdx === undefined) return;
  const item = state.items[itemIdx];
  if (item === undefined) return;
  const key = item.file;
  openNotePanel({
    itemKey: key,
    title: item.text ? item.text.slice(0, 80) : item.file,
    initialBody: noteMap.get(key) ?? "",
    onSaved: (savedKey, body) => {
      const has = body.trim().length > 0;
      if (has) noteMap.set(savedKey, body);
      else noteMap.delete(savedKey);
      // Cell may have been recycled by the virtualizer since the panel opened,
      // so re-resolve it at save time rather than capturing a stale reference.
      const cell = cellMap.get(fi) ?? null;
      if (cell !== null) cell.classList.toggle("has-note", has);
      if (state.focus === fi) renderDetail();
      showSaveStatus(true, has ? "note saved" : "note cleared");
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupForKey(key: string): GroupInfo | null {
  return state.groups.find((g) => g.key === key) ?? null;
}

function buildLabeledSet(): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < state.items.length; i++) {
    if (state.items[i]!.labels.length > 0) s.add(i);
  }
  return s;
}

function labeledCount(): number {
  let count = 0;
  for (const item of state.items) {
    if (item.labels.length > 0) count++;
  }
  return count;
}

function assetPath(file: string): string {
  return `/asset?path=data/inspiration/pleometric/${encodeURIComponent(file)}`;
}

// ---------------------------------------------------------------------------
// Video discipline — max 2 <video> in DOM: focused cell + detail pane
// ---------------------------------------------------------------------------

function teardownFocusedVideo(): void {
  if (focusedCellVideo !== null) {
    focusedCellVideo.pause();
    focusedCellVideo.removeAttribute("src");
    focusedCellVideo.remove();
    focusedCellVideo = null;
  }
}

function updateFocusedVideo(oldFocus: number, newFocus: number): void {
  teardownFocusedVideo();

  if (oldFocus === newFocus) return;

  const cell = cellMap.get(newFocus);
  if (!cell) return;

  const itemIdx = state.filteredIndices[newFocus];
  if (itemIdx === undefined) return;
  const item = state.items[itemIdx]!;

  // Only create video for non-gif media
  const ext = item.file.split(".").pop()?.toLowerCase();
  if (ext === "gif") return;

  const video = document.createElement("video");
  video.src = assetPath(item.file);
  video.className = "grid-thumb grid-thumb-video";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  // Insert before .grid-meta (or append)
  const meta = cell.querySelector(".grid-meta");
  if (meta) cell.insertBefore(video, meta);
  else cell.appendChild(video);
  video.play().catch(() => {});
  focusedCellVideo = video;
}

/** Mount video on the focused cell if it's currently visible in the DOM. */
function ensureFocusedVideo(): void {
  teardownFocusedVideo();
  const cell = cellMap.get(state.focus);
  if (!cell) return;

  const itemIdx = state.filteredIndices[state.focus];
  if (itemIdx === undefined) return;
  const item = state.items[itemIdx]!;

  const ext = item.file.split(".").pop()?.toLowerCase();
  if (ext === "gif") return;

  const video = document.createElement("video");
  video.src = assetPath(item.file);
  video.className = "grid-thumb grid-thumb-video";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  const meta = cell.querySelector(".grid-meta");
  if (meta) cell.insertBefore(video, meta);
  else cell.appendChild(video);
  video.play().catch(() => {});
  focusedCellVideo = video;
}

// ---------------------------------------------------------------------------
// Virtualizer setup
// ---------------------------------------------------------------------------

function computeRowHeight(): number {
  if (!gridPane) return 160;
  const gap = 8;
  const pad = 16; // 8px left + 8px right from row padding
  const w = gridPane.clientWidth - pad - (state.cols - 1) * gap;
  return Math.floor(w / state.cols);
}

function setupVirtualizer(): void {
  // Cleanup previous
  if (virtualizerCleanup) { virtualizerCleanup(); virtualizerCleanup = null; }
  cellMap.clear();
  rowMap.clear();
  gridInner.innerHTML = "";

  const totalItems = state.filteredIndices.length;
  if (totalItems === 0) {
    gridInner.innerHTML = `<div class="label-empty">${
      state.items.length === 0 ? "No corpus loaded" : "No items match filter"
    }</div>`;
    return;
  }

  const totalRows = Math.ceil(totalItems / state.cols);
  const rowHeight = computeRowHeight();
  const interRowGap = 8;

  virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
    count: totalRows,
    getScrollElement: () => gridPane,
    estimateSize: () => rowHeight + interRowGap,
    gap: 0,
    paddingStart: 8,
    paddingEnd: 8,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: () => {
      renderVirtualRows();
    },
  });

  // Mount
  virtualizerCleanup = virtualizer._didMount();
  virtualizer._willUpdate();

  // Initial render
  renderVirtualRows();
}

// ---------------------------------------------------------------------------
// Virtual row rendering
// ---------------------------------------------------------------------------

function renderVirtualRows(): void {
  if (!virtualizer || !gridInner) return;

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  gridInner.style.height = `${totalSize}px`;

  // Determine which rows the virtualizer wants visible
  const visibleRowIndices = new Set(items.map((v) => v.index));

  // Remove rows that scrolled out
  for (const [rowIdx, rowEl] of rowMap) {
    if (!visibleRowIndices.has(rowIdx)) {
      // Remove cells from cellMap
      const startFi = rowIdx * state.cols;
      for (let c = 0; c < state.cols; c++) {
        const fi = startFi + c;
        // If the focused video is on this cell, tear it down
        if (fi === state.focus) teardownFocusedVideo();
        cellMap.delete(fi);
      }
      rowEl.remove();
      rowMap.delete(rowIdx);
    }
  }

  // Create/update visible rows
  for (const vItem of items) {
    const existing = rowMap.get(vItem.index);
    if (existing) {
      // Just update position
      existing.style.transform = `translateY(${vItem.start}px)`;
      existing.style.height = `${vItem.size}px`;
      continue;
    }

    // Create new row
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";
    rowEl.style.position = "absolute";
    rowEl.style.top = "0";
    rowEl.style.left = "0";
    rowEl.style.width = "100%";
    rowEl.style.transform = `translateY(${vItem.start}px)`;
    rowEl.style.height = `${vItem.size}px`;
    rowEl.style.display = "grid";
    rowEl.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
    rowEl.style.gap = "8px";
    rowEl.style.padding = "0 8px";
    rowEl.style.boxSizing = "border-box";

    const startFi = vItem.index * state.cols;
    const totalItems = state.filteredIndices.length;

    for (let c = 0; c < state.cols && startFi + c < totalItems; c++) {
      const fi = startFi + c;
      const cell = createCell(fi);
      rowEl.appendChild(cell);
      cellMap.set(fi, cell);
    }

    gridInner.appendChild(rowEl);
    rowMap.set(vItem.index, rowEl);
  }

  // Ensure focused video is mounted if focused cell just became visible
  if (focusedCellVideo === null && cellMap.has(state.focus)) {
    ensureFocusedVideo();
  }
}

// ---------------------------------------------------------------------------
// Cell creation — placeholder-first, no media elements
// ---------------------------------------------------------------------------

function createCell(fi: number): HTMLElement {
  const itemIdx = state.filteredIndices[fi]!;
  const item = state.items[itemIdx]!;

  const cell = document.createElement("div");
  cell.className = "grid-cell";
  cell.dataset.fi = String(fi);

  // Apply current state classes
  if (fi === state.focus) cell.classList.add("focused");
  if (state.marks.has(fi)) cell.classList.add("marked");
  if (state.visualAnchor !== null) {
    const [vLo, vHi] = visualRange(state.visualAnchor, state.focus);
    if (fi >= vLo && fi <= vHi) cell.classList.add("visual");
  }
  if (item.labels.length > 0) cell.classList.add("labeled");
  if (noteMap.has(item.file)) cell.classList.add("has-note");

  // Placeholder with thumbnail + badges — NO media element
  const placeholder = document.createElement("div");
  placeholder.className = "grid-placeholder";

  // Thumbnail image (lazy-loaded from /api/thumb)
  const thumbSrc = `/api/thumb?path=data/inspiration/pleometric/${encodeURIComponent(item.file)}`;
  const thumbImg = document.createElement("img");
  thumbImg.src = thumbSrc;
  thumbImg.className = "grid-thumb-img";
  thumbImg.loading = "lazy";
  thumbImg.alt = "";
  placeholder.appendChild(thumbImg);

  // Badges overlay
  const badgeRow = document.createElement("div");
  badgeRow.className = "grid-badge-row";

  const typeBadge = document.createElement("span");
  typeBadge.className = "grid-badge grid-badge-type";
  typeBadge.textContent = item.mediaType;
  badgeRow.appendChild(typeBadge);

  if (item.durationSeconds !== undefined) {
    const durBadge = document.createElement("span");
    durBadge.className = "grid-badge grid-badge-dur";
    durBadge.textContent = formatDuration(item.durationSeconds);
    badgeRow.appendChild(durBadge);
  }
  placeholder.appendChild(badgeRow);

  cell.appendChild(placeholder);

  // Label chips
  const meta = document.createElement("div");
  meta.className = "grid-meta";
  for (const l of item.labels) {
    const chip = document.createElement("span");
    chip.className = "grid-chip";
    chip.textContent = l;
    meta.appendChild(chip);
  }
  cell.appendChild(meta);

  // Click handler
  cell.addEventListener("click", () => {
    const oldFocus = state.focus;
    state.focus = fi;
    applyCellPatches(computeMovePatch(oldFocus, fi));
    updateFocusedVideo(oldFocus, fi);
    renderDetail();
    updateStatus();
  });

  return cell;
}

function formatDuration(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Scroll to focused cell
// ---------------------------------------------------------------------------

function scrollFocusIntoView(): void {
  if (!virtualizer) return;
  const row = Math.floor(state.focus / state.cols);
  const items = virtualizer.getVirtualItems();
  if (items.some((v) => v.index === row)) return; // already visible
  virtualizer.scrollToIndex(row, { align: "auto" });
}

// ---------------------------------------------------------------------------
// Rendering — full rebuilds only for data changes
// ---------------------------------------------------------------------------

function renderAll(): void {
  renderGroups();
  setupVirtualizer();
  renderDetail();
  renderHelp();
  updateStatus();
}

function updateStatus(): void {
  if (statusEl === null) return;
  const labeled = labeledCount();
  const total = state.items.length;
  const sortLabel = state.sortMode === "unlabeled" ? "unlabeled-first" : state.sortMode;
  const modeLabel = state.visualAnchor !== null ? " VISUAL" : state.marks.size > 0 ? ` ${state.marks.size} marked` : "";
  const autoLabel = autoplayActive ? ` \u25b6 ${autoplayPosition + 1}/${autoplayQueue.length}` : "";
  statusEl.textContent = `LABEL  ${labeled}/${total} labeled  sort:${sortLabel}${modeLabel}${autoLabel}`;
}

function renderGroups(): void {
  if (!groupsPane) return;
  const rows = state.groups.map((g) => {
    const keyBadge = g.key !== null ? `<span class="group-key">${esc(g.key)}</span>` : "";
    return `<div class="group-row" data-group="${esc(g.name)}">
      ${keyBadge}<span class="group-name">${esc(g.name)}</span><span class="group-count">${g.count}</span>
    </div>`;
  }).join("");
  groupsPane.innerHTML = `
    <div class="groups-header">
      <span class="groups-title">GROUPS</span>
      <span class="groups-add-hint">a: add</span>
    </div>
    ${rows}
  `;
}

function renderDetail(): void {
  if (!detailPane) return;
  const fi = state.focus;
  const itemIdx = state.filteredIndices[fi];
  if (itemIdx === undefined) {
    detailPane.innerHTML = `<div class="detail-empty">No item focused</div>`;
    return;
  }
  const item = state.items[itemIdx]!;
  const src = assetPath(item.file);
  const note = noteMap.get(item.file) ?? "";
  const ext = item.file.split(".").pop()?.toLowerCase();
  const isRealGif = ext === "gif";

  const loopAttr = autoplayActive ? "" : " loop";
  const preview = isRealGif
    ? `<img src="${src}" class="detail-preview" />`
    : `<video src="${src}" class="detail-preview" autoplay muted${loopAttr} playsinline></video>`;

  const chips = item.labels.length > 0
    ? item.labels.map((l) => `<span class="detail-chip">${esc(l)}</span>`).join("")
    : `<span class="detail-no-label">unlabeled</span>`;

  const dur = item.durationSeconds !== undefined ? `${item.durationSeconds.toFixed(1)}s` : "—";
  const dims = item.width !== undefined && item.height !== undefined ? `${item.width}×${item.height}` : "";

  detailPane.innerHTML = `
    <div class="detail-content${state.inspecting ? " inspecting" : ""}">
      ${preview}
      <div class="detail-info">
        <div class="detail-labels">${chips}</div>
        <div class="detail-row"><span class="detail-label">type</span><span class="detail-val">${esc(item.mediaType)}</span></div>
        <div class="detail-row"><span class="detail-label">duration</span><span class="detail-val">${dur}</span></div>
        ${dims ? `<div class="detail-row"><span class="detail-label">size</span><span class="detail-val">${dims}</span></div>` : ""}
        ${item.date ? `<div class="detail-row"><span class="detail-label">date</span><span class="detail-val">${esc(item.date)}</span></div>` : ""}
        ${item.text ? `<div class="detail-text">${esc(item.text)}</div>` : ""}
        ${item.sourceUrl ? `<div class="detail-row"><span class="detail-label">source</span><a class="detail-link" href="https://x.com/i/status/${esc(item.tweetId)}" target="_blank">tweet</a></div>` : ""}
        ${note ? `<div class="detail-note"><span class="detail-note-label">note</span><div class="detail-note-body">${esc(note)}</div></div>` : ""}
      </div>
    </div>
  `;
}

function renderHelp(): void {
  if (!helpOverlayEl) return;
  helpOverlayEl.classList.toggle("hidden", !state.helpVisible);
  if (state.helpVisible) {
    helpOverlayEl.innerHTML = `<div class="help-card"><h3>Label Keyboard Shortcuts</h3><table>${
      LABEL_KEYMAP_HELP.map(([key, desc]) => `<tr><td><kbd>${esc(key)}</kbd></td><td>${esc(desc)}</td></tr>`).join("")
    }</table><p class="help-dismiss">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</p></div>`;
    helpOverlayEl.addEventListener("click", () => {
      state.helpVisible = false;
      renderHelp();
    }, { once: true });
  }
}

function flashGroup(name: string): void {
  const row = groupsPane?.querySelector<HTMLElement>(`.group-row[data-group="${CSS.escape(name)}"]`);
  if (!row) return;
  row.classList.add("flash");
  setTimeout(() => row.classList.remove("flash"), 400);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireFilterInput(): void {
  filterInput.addEventListener("input", () => {
    state.filterText = filterInput.value;
    applyFilter();
    renderAll();
  });
  filterInput.addEventListener("focus", () => { state.filterFocused = true; });
  filterInput.addEventListener("blur", () => { state.filterFocused = false; });
}

function wireGroupsPane(): void {
  groupsPane.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".group-row");
    if (row?.dataset.group) {
      state.filterText = `group:${row.dataset.group}`;
      filterInput.value = state.filterText;
      applyFilter();
      renderAll();
    }
  });
}

function wireGridResize(): void {
  if (!gridPane) return;
  const computeCols = () => {
    const w = gridPane.clientWidth;
    const oldCols = state.cols;
    state.cols = Math.max(2, Math.floor(w / 160));
    if (oldCols !== state.cols && state.filteredIndices.length > 0) {
      // Rebuild virtualizer with new column count
      setupVirtualizer();
    }
  };
  const ro = new ResizeObserver(computeCols);
  ro.observe(gridPane);
  computeCols();
}

function promptAddGroup(): void {
  const existing = groupsPane.querySelector<HTMLInputElement>(".group-add-input");
  if (existing) { existing.focus(); return; }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "group-add-input";
  input.placeholder = "group name…";
  groupsPane.appendChild(input);
  input.focus();
}

function promptCommand(): void {
  const existing = container?.querySelector<HTMLInputElement>(".command-input");
  if (existing) { existing.focus(); return; }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "command-input";
  input.placeholder = ":group name";
  // Place at the bottom of the hint strip
  const strip = container?.querySelector<HTMLElement>(".label-hint-strip");
  if (strip) strip.appendChild(input);
  else { groupsPane.appendChild(input); }
  input.focus();
}

// ---------------------------------------------------------------------------
// Escape helper
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// CSS for the label view
// ---------------------------------------------------------------------------

export function labelCss(): string {
  return `
/* === Label view layout === */
.label-layout {
  height: calc(100vh - 32px - 24px);
  display: grid;
  grid-template-columns: 180px 1fr 260px;
  gap: 1px;
  background: var(--panel-border);
}

/* -- Groups pane (left) -- */
.label-groups {
  background: var(--panel-bg);
  overflow-y: auto;
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
}
.groups-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-2);
  border-bottom: 1px solid var(--panel-border-subtle);
}
.groups-title {
  color: var(--text-secondary);
  text-transform: uppercase;
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-upper);
  font-weight: 600;
}
.groups-add-hint {
  color: var(--text-dim);
  font-size: var(--text-xs);
}
.group-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  transition: background var(--dur-quick) var(--ease-out), border-color 0.35s var(--ease-out);
  border-left: 2px solid transparent;
}
.group-row:hover { background: var(--panel-bg-hover); }
.group-row.flash {
  background: var(--accent);
  border-left-color: var(--accent);
}
.group-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-xs);
  background: var(--panel-bg-active);
  border: 1px solid var(--panel-border);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: 700;
  flex-shrink: 0;
}
.group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
.group-count {
  color: var(--text-dim);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.group-add-input {
  display: block;
  width: calc(100% - var(--space-4));
  margin: var(--space-1) var(--space-2);
  padding: var(--space-1);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  background: var(--control-bg);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
}
.command-input {
  display: inline-block;
  width: 160px;
  margin-left: var(--space-2);
  padding: 2px var(--space-1);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  background: var(--control-bg);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
}

/* -- Center pane -- */
.label-center {
  background: var(--canvas);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.label-toolbar {
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--panel-border);
  background: var(--panel-bg);
  flex-shrink: 0;
}
.label-filter-input {
  width: 100%;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  padding: var(--space-1) var(--space-2);
}
.label-filter-input:focus {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* -- Virtual grid -- */
.label-grid {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}
.label-grid-inner {
  position: relative;
  width: 100%;
}
.label-empty {
  color: var(--text-dim);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-8);
}

/* -- Grid cells -- */
.grid-cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  border: 2px solid transparent;
  background: var(--panel-bg);
  cursor: pointer;
  transition: border-color var(--dur-quick) var(--ease-out);
}
.grid-cell.focused {
  border-color: var(--accent);
  box-shadow: 0 0 12px color-mix(in oklab, var(--accent), transparent 60%);
}
.grid-cell.marked {
  border-color: var(--accent-2);
}
.grid-cell.visual {
  border-color: var(--accent);
  background: color-mix(in oklab, var(--accent), transparent 85%);
}
.grid-cell.labeled::after {
  content: "";
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.grid-cell.has-note::before {
  content: "";
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
  z-index: 3;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-2);
  box-shadow: 0 0 6px color-mix(in oklab, var(--accent-2), transparent 40%);
}

/* -- Placeholder (thumbnail + badges) -- */
.grid-placeholder {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--panel-bg-elevated);
  overflow: hidden;
}
.grid-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.grid-badge-row {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 3px;
  padding: 3px;
  background: linear-gradient(transparent, rgba(0,0,0,0.6));
}
.grid-badge {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  line-height: 1.3;
}
.grid-badge-type {
  background: rgba(0,0,0,0.5);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-upper);
  font-weight: 600;
}
.grid-badge-dur {
  background: transparent;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* -- Focused cell video overlays placeholder -- */
.grid-thumb-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}

.grid-meta {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 2px;
  padding: 2px;
  flex-wrap: wrap;
  z-index: 2;
}
.grid-chip {
  background: rgba(0,0,0,0.7);
  color: var(--text-secondary);
  font-size: 9px;
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* -- Hint strip (permanent, bottom of center pane) -- */
.label-hint-strip {
  flex-shrink: 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  background: var(--panel-bg);
  border-top: 1px solid var(--panel-border-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
}
.label-hint-strip kbd {
  display: inline-block;
  padding: 0 3px;
  border-radius: var(--radius-xs);
  background: var(--panel-bg-active);
  border: 1px solid var(--panel-border);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.5;
}
.hint-sep {
  color: var(--text-dim);
  margin: 0 1px;
}

/* -- Detail pane (right) -- */
.label-detail {
  background: var(--panel-bg);
  overflow-y: auto;
  padding: var(--space-2);
}
.detail-empty {
  color: var(--text-dim);
  font-size: var(--text-sm);
  padding: var(--space-4);
  text-align: center;
}
.detail-content { display: flex; flex-direction: column; gap: var(--space-2); }
.detail-content.inspecting .detail-preview {
  max-height: none;
}
.detail-preview {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: var(--radius);
  background: var(--canvas);
}
.detail-info { display: flex; flex-direction: column; gap: var(--space-1); }
.detail-labels { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.detail-chip {
  background: var(--panel-bg-active);
  border: 1px solid var(--panel-border);
  color: var(--accent);
  font-size: var(--text-xs);
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
}
.detail-no-label {
  color: var(--text-dim);
  font-size: var(--text-xs);
  font-style: italic;
}
.detail-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
.detail-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
  min-width: 52px;
  text-align: right;
  flex-shrink: 0;
}
.detail-val { color: var(--text-secondary); }
.detail-text {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  border-top: 1px solid var(--panel-border-subtle);
  padding-top: var(--space-1);
  margin-top: var(--space-1);
}
.detail-link {
  color: var(--accent);
  text-decoration: none;
  font-size: var(--text-sm);
}
.detail-link:hover { text-decoration: underline; }
.detail-note {
  border-top: 1px solid var(--panel-border-subtle);
  padding-top: var(--space-2);
  margin-top: var(--space-1);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.detail-note-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-upper);
  color: var(--accent-2);
  font-weight: 600;
}
.detail-note-body {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  white-space: pre-wrap;
  word-break: break-word;
  border-left: 2px solid color-mix(in oklab, var(--accent-2), transparent 45%);
  padding-left: var(--space-2);
}

/* -- Help overlay (reuse studio pattern) -- */
.label-help-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0,0,0,0.6);
  display: grid;
  place-items: center;
}

/* -- Save status indicator (inside hint strip) -- */
.label-save-status {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  transition: opacity 0.3s var(--ease-out);
  white-space: nowrap;
}
.label-save-status:empty { display: none; }
.label-save-status.save-ok {
  color: var(--success);
}
.label-save-status.save-fail {
  color: var(--error);
  font-weight: 600;
}
`;
}
