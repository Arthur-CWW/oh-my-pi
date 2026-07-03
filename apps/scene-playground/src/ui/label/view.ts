// ---------------------------------------------------------------------------
// Label view — yazi-style three-pane media labeler
// ---------------------------------------------------------------------------

import {
  type LabelNavState,
  type LabelAction,
  LABEL_KEYMAP_HELP,
  mapLabelKey,
  visualRange,
  nextUnlabeled,
} from "./keymap";

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
let gridPane: HTMLElement;
let detailPane: HTMLElement;
let filterInput: HTMLInputElement;
let helpOverlayEl: HTMLElement;

// Track playing video so we stop it on blur
let activeVideo: HTMLVideoElement | null = null;

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
  pauseActive();
}

export function handleLabelKeydown(e: KeyboardEvent): void {
  const target = e.target;
  if (target instanceof HTMLInputElement && target.classList.contains("label-filter-input")) {
    if (e.key === "Escape") {
      e.preventDefault();
      target.blur();
      state.filterFocused = false;
      return;
    }
    return; // let input handle other keys
  }
  // Inline add-group input
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

  const navState: LabelNavState = {
    focus: state.focus,
    total: state.filteredIndices.length,
    cols: state.cols,
    marks: state.marks,
    visualAnchor: state.visualAnchor,
    filterFocused: state.filterFocused,
    inspecting: state.inspecting,
  };

  // 'a' for add-group (not in keymap — only relevant in label view)
  if (e.key === "a" && !state.inspecting && !state.filterFocused) {
    e.preventDefault();
    promptAddGroup();
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
        <div class="label-grid"></div>
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
    const [corpusRes, groupsRes] = await Promise.all([
      fetch("/api/corpus"),
      fetch("/api/label-groups"),
    ]);
    const corpus: CorpusItem[] = await corpusRes.json();
    const groups: GroupInfo[] = await groupsRes.json();
    state.items = corpus;
    state.groups = groups;
    applyFilter();
    renderAll();
  } catch (err) {
    if (gridPane) gridPane.innerHTML = `<div class="label-empty">Failed to load corpus</div>`;
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

  // Sort
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
        return a - b; // preserve original order within groups
      });
    case "date":
      return indices.slice().sort((a, b) => {
        const da = items[a]!.date ?? "";
        const db = items[b]!.date ?? "";
        return da < db ? 1 : da > db ? -1 : 0; // newest first
      });
    case "duration":
      return indices.slice().sort((a, b) => {
        return (items[b]!.durationSeconds ?? 0) - (items[a]!.durationSeconds ?? 0);
      });
  }
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

function applyAction(action: LabelAction): void {
  switch (action.type) {
    case "move":
      state.focus = action.index;
      renderGrid();
      renderDetail();
      updateStatus();
      scrollFocusIntoView();
      break;

    case "visual-start":
      state.visualAnchor = state.focus;
      renderGrid();
      break;

    case "visual-clear":
      state.visualAnchor = null;
      state.marks = new Set();
      renderGrid();
      break;

    case "toggle-mark": {
      const next = new Set(state.marks);
      if (next.has(action.index)) next.delete(action.index);
      else next.add(action.index);
      state.marks = next;
      renderGrid();
      break;
    }

    case "assign-group": {
      const group = groupForKey(action.key);
      if (group === null) break;
      const realIndices = action.indices.map((fi) => state.filteredIndices[fi]).filter((i): i is number => i !== undefined);
      void assignBatch(realIndices, group.name);
      // Advance to next unlabeled
      const labeledSet = buildLabeledSet();
      for (const ri of realIndices) labeledSet.add(ri);
      const mappedSet = new Set<number>();
      for (const ri of labeledSet) {
        const fi = state.filteredIndices.indexOf(ri);
        if (fi >= 0) mappedSet.add(fi);
      }
      state.focus = nextUnlabeled(state.focus, state.filteredIndices.length, mappedSet);
      state.visualAnchor = null;
      state.marks = new Set();
      flashGroup(group.name);
      renderAll();
      break;
    }

    case "unassign": {
      const realIndices = action.indices.map((fi) => state.filteredIndices[fi]).filter((i): i is number => i !== undefined);
      void unassignBatch(realIndices);
      renderAll();
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

    case "none":
      break;
  }
}

// ---------------------------------------------------------------------------
// API calls (optimistic — fire and don't await in the render path)
// ---------------------------------------------------------------------------

async function assignBatch(itemIndices: number[], groupName: string): Promise<void> {
  // Optimistic local update
  for (const idx of itemIndices) {
    const item = state.items[idx];
    if (item !== undefined && !item.labels.includes(groupName)) {
      item.labels.push(groupName);
    }
  }
  // Fire PUTs
  for (const idx of itemIndices) {
    const item = state.items[idx];
    if (item === undefined) continue;
    fetch("/api/labels", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: item.file, group: groupName, op: "add" }),
    }).catch(() => {/* optimistic — ignore */});
  }
  // Refresh group counts
  void refreshGroups();
}

async function unassignBatch(itemIndices: number[]): Promise<void> {
  for (const idx of itemIndices) {
    const item = state.items[idx];
    if (item === undefined) continue;
    for (const g of item.labels) {
      fetch("/api/labels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaPath: item.file, group: g, op: "remove" }),
      }).catch(() => {/* optimistic */});
    }
    item.labels = [];
  }
  void refreshGroups();
}

async function addGroup(name: string): Promise<void> {
  await fetch("/api/label-groups", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
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

function pauseActive(): void {
  if (activeVideo !== null) {
    activeVideo.pause();
    activeVideo = null;
  }
}

function scrollFocusIntoView(): void {
  const cell = gridPane?.querySelector<HTMLElement>(".grid-cell.focused");
  cell?.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll(): void {
  renderGroups();
  renderGrid();
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
  statusEl.textContent = `LABEL  ${labeled}/${total} labeled  sort:${sortLabel}${modeLabel}`;
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

function renderGrid(): void {
  if (!gridPane) return;
  pauseActive();
  const indices = state.filteredIndices;
  if (indices.length === 0) {
    gridPane.innerHTML = `<div class="label-empty">${state.items.length === 0 ? "No corpus loaded" : "No items match filter"}</div>`;
    return;
  }

  // Compute visual range
  let vLo = -1, vHi = -1;
  if (state.visualAnchor !== null) {
    [vLo, vHi] = visualRange(state.visualAnchor, state.focus);
  }

  const cells = indices.map((itemIdx, fi) => {
    const item = state.items[itemIdx]!;
    const isFocused = fi === state.focus;
    const isMarked = state.marks.has(fi);
    const isVisual = fi >= vLo && fi <= vHi;
    const classes = ["grid-cell"];
    if (isFocused) classes.push("focused");
    if (isMarked) classes.push("marked");
    if (isVisual) classes.push("visual");
    if (item.labels.length > 0) classes.push("labeled");

    const ext = item.file.split(".").pop()?.toLowerCase();
    const isRealGif = ext === "gif";
    const assetPath = `/asset?path=data/inspiration/pleometric/${encodeURIComponent(item.file)}`;

    let thumb: string;
    if (isRealGif) {
      thumb = `<img src="${assetPath}" class="grid-thumb" loading="lazy" />`;
    } else {
      // For focused cell, we'll play it via JS after render
      thumb = `<video src="${assetPath}" class="grid-thumb" preload="metadata" muted loop playsinline></video>`;
    }

    const chips = item.labels.map((l) => `<span class="grid-chip">${esc(l)}</span>`).join("");

    return `<div class="${classes.join(" ")}" data-fi="${fi}">
      ${thumb}
      <div class="grid-meta">${chips}</div>
    </div>`;
  }).join("");

  gridPane.innerHTML = cells;
  gridPane.style.setProperty("--label-cols", String(state.cols));

  // Play focused video
  const focusedCell = gridPane.querySelector<HTMLElement>(".grid-cell.focused");
  if (focusedCell) {
    const video = focusedCell.querySelector<HTMLVideoElement>("video");
    if (video) {
      activeVideo = video;
      video.play().catch(() => {});
    }
    focusedCell.scrollIntoView({ block: "nearest" });
  }

  // Wire click handlers
  for (const cell of gridPane.querySelectorAll<HTMLElement>(".grid-cell")) {
    cell.addEventListener("click", () => {
      const fi = Number(cell.dataset.fi);
      if (!Number.isNaN(fi)) {
        state.focus = fi;
        renderGrid();
        renderDetail();
        updateStatus();
      }
    });
  }
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
  const assetPath = `/asset?path=data/inspiration/pleometric/${encodeURIComponent(item.file)}`;
  const ext = item.file.split(".").pop()?.toLowerCase();
  const isRealGif = ext === "gif";

  const preview = isRealGif
    ? `<img src="${assetPath}" class="detail-preview" />`
    : `<video src="${assetPath}" class="detail-preview" autoplay muted loop playsinline></video>`;

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
    renderGrid();
    renderDetail();
    updateStatus();
  });
  filterInput.addEventListener("focus", () => { state.filterFocused = true; });
  filterInput.addEventListener("blur", () => { state.filterFocused = false; });
}

function wireGroupsPane(): void {
  groupsPane.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".group-row");
    if (row?.dataset.group) {
      // Click group → filter to that group
      state.filterText = `group:${row.dataset.group}`;
      filterInput.value = state.filterText;
      applyFilter();
      renderGrid();
      renderDetail();
      updateStatus();
    }
  });
}

function wireGridResize(): void {
  if (!gridPane) return;
  const computeCols = () => {
    const w = gridPane.clientWidth;
    state.cols = Math.max(2, Math.floor(w / 160));
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

/* -- Center grid -- */
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
.label-grid {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-2);
  display: grid;
  grid-template-columns: repeat(var(--label-cols, 4), 1fr);
  gap: var(--space-2);
  align-content: start;
}
.label-empty {
  grid-column: 1 / -1;
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
.grid-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

/* -- Help overlay (reuse studio pattern) -- */
.label-help-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0,0,0,0.6);
  display: grid;
  place-items: center;
}
`;
}
