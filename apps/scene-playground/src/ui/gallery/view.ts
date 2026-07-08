// ---------------------------------------------------------------------------
// Gallery view — poster-grid showcase of every playable scene-lab artifact
//
// Rendering strategy:
//   • The grid is a flat, stable DOM of cards (no pagination — 26 reports is
//     fine flat). Cards are created once per data/filter change.
//   • Navigation (j/k/h/l) patches the `focused` CSS class on ≤2 cards and
//     swaps a single live <video>. It NEVER rebuilds the grid.
//   • Media discipline: offscreen cells are poster-image placeholders. Only the
//     focused video card holds a live muted <video>; the expand overlay owns
//     the sound-on player and tears down the grid video while open — so at most
//     one <video> plays at any instant (well within the ≤2 budget).
//   • Full rebuild only on data changes (load, filter cycle).
// ---------------------------------------------------------------------------

import { reportClientError } from "../error-report";
import type { ReportEntry } from "../studio/state";
import {
  type GalleryArtifact,
  type GalleryFilter,
  type GalleryRender,
  buildArtifacts,
  countKinds,
  filterArtifacts,
} from "./data";
import { GALLERY_KEYMAP_HELP, cycleFilter, mapGalleryKey, type GalleryNavState } from "./keymap";

export interface GalleryCallbacks {
  /** Switch to the REPORTS view and reveal the given report dir. */
  openReport(reportPath: string): void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let artifacts: GalleryArtifact[] = [];
let filtered: GalleryArtifact[] = [];
let filter: GalleryFilter = "all";
let focus = 0;
let overlayOpen = false;
let helpVisible = false;

let mounted = false;
let container: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let callbacks: GalleryCallbacks | null = null;

// DOM references (created once on mount)
let gridEl: HTMLElement;
let overlayEl: HTMLElement;
let helpEl: HTMLElement;

/** filtered-index → live card DOM element. */
const cellMap = new Map<number, HTMLElement>();

// Video discipline: at most one grid video + one overlay video, never both live.
let focusedVideo: HTMLVideoElement | null = null;
let overlayVideo: HTMLVideoElement | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function mountGalleryView(root: HTMLElement, statusLine: HTMLElement, cb: GalleryCallbacks): void {
  container = root;
  statusEl = statusLine;
  callbacks = cb;
  if (!mounted) {
    root.innerHTML = buildShell();
    gridEl = root.querySelector<HTMLElement>(".gallery-grid")!;
    overlayEl = root.querySelector<HTMLElement>(".gallery-overlay")!;
    helpEl = root.querySelector<HTMLElement>(".gallery-help-overlay")!;
    overlayEl.addEventListener("click", (e) => {
      const t = e.target;
      if (t === overlayEl || (t instanceof HTMLElement && t.classList.contains("gallery-overlay-backdrop"))) closeOverlay();
    });
    mounted = true;
  }
  void loadData();
}

export function unmountGalleryView(): void {
  teardownFocusedVideo();
  teardownOverlayVideo();
  overlayOpen = false;
  helpVisible = false;
  if (mounted) {
    overlayEl.classList.add("hidden");
    overlayEl.innerHTML = "";
    helpEl.classList.add("hidden");
  }
}

export function handleGalleryKeydown(e: KeyboardEvent): void {
  const navState: GalleryNavState = {
    focus,
    total: filtered.length,
    cols: currentCols(),
    overlayOpen,
    helpVisible,
  };
  const action = mapGalleryKey(e.key, navState);
  if (action.type === "none") return;
  e.preventDefault();

  switch (action.type) {
    case "move": {
      const old = focus;
      focus = action.index;
      if (old !== focus) {
        cellMap.get(old)?.classList.remove("focused");
        cellMap.get(focus)?.classList.add("focused");
        mountFocusedVideo();
        cellMap.get(focus)?.scrollIntoView({ block: "nearest" });
      }
      updateStatus();
      break;
    }
    case "open": {
      const a = filtered[focus];
      if (a === undefined) break;
      if (a.kind === "toy") {
        window.open(mediaUrl(a), "_blank", "noopener");
        break;
      }
      openOverlay(a);
      break;
    }
    case "close-overlay":
      closeOverlay();
      break;
    case "toggle-play":
      if (overlayVideo !== null) {
        if (overlayVideo.paused) void overlayVideo.play().catch(() => {});
        else overlayVideo.pause();
      }
      break;
    case "open-report": {
      const a = filtered[focus];
      if (a === undefined || a.reportPath === "" || callbacks === null) break;
      callbacks.openReport(a.reportPath);
      break;
    }
    case "cycle-filter":
      filter = cycleFilter(filter);
      focus = 0;
      applyFilter();
      renderGrid();
      updateStatus();
      break;
    case "help-toggle":
      helpVisible = !helpVisible;
      renderHelp();
      updateStatus();
      break;
  }
}

// ---------------------------------------------------------------------------
// Shell HTML
// ---------------------------------------------------------------------------

function buildShell(): string {
  return `
    <div class="gallery-layout">
      <div class="gallery-grid"></div>
      <div class="gallery-hint-strip">
        <kbd>j</kbd><kbd>k</kbd><kbd>h</kbd><kbd>l</kbd> nav
        <span class="hint-sep">·</span>
        <kbd>enter</kbd> expand / open toy
        <span class="hint-sep">·</span>
        <kbd>space</kbd> play/pause
        <span class="hint-sep">·</span>
        <kbd>o</kbd> report
        <span class="hint-sep">·</span>
        <kbd>f</kbd> filter
        <span class="hint-sep">·</span>
        <kbd>?</kbd> help
      </div>
    </div>
    <div class="gallery-overlay hidden"></div>
    <div class="gallery-help-overlay hidden"></div>
  `;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadData(): Promise<void> {
  try {
    const [reportsRes, rendersRes] = await Promise.all([fetch("/api/reports"), fetch("/api/renders")]);
    const reports = (await reportsRes.json()) as ReportEntry[];
    const renders = (await rendersRes.json()) as GalleryRender[];
    artifacts = buildArtifacts(reports, renders);
    filter = "all";
    focus = 0;
    applyFilter();
    renderGrid();
    updateStatus();
  } catch (err) {
    if (gridEl) gridEl.innerHTML = `<div class="gallery-empty">Failed to load gallery</div>`;
    reportClientError(`Gallery load failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function applyFilter(): void {
  filtered = filterArtifacts(artifacts, filter);
  if (focus >= filtered.length) focus = Math.max(0, filtered.length - 1);
}

// ---------------------------------------------------------------------------
// Grid rendering — full rebuild only for data changes
// ---------------------------------------------------------------------------

function renderGrid(): void {
  teardownFocusedVideo();
  cellMap.clear();
  if (!gridEl) return;
  gridEl.innerHTML = "";
  if (filtered.length === 0) {
    const scope = filter === "all" ? "" : `${filter} `;
    gridEl.innerHTML = `<div class="gallery-empty">No ${scope}artifacts yet</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < filtered.length; i += 1) {
    const cell = createCard(filtered[i]!, i);
    cellMap.set(i, cell);
    frag.appendChild(cell);
  }
  gridEl.appendChild(frag);
  mountFocusedVideo();
}

function createCard(a: GalleryArtifact, fi: number): HTMLElement {
  const card = document.createElement("article");
  card.className = "gallery-card";
  card.dataset.fi = String(fi);
  if (fi === focus) card.classList.add("focused");

  const thumb = document.createElement("div");
  thumb.className = "gallery-thumb";
  if (a.poster !== null) {
    const img = document.createElement("img");
    img.className = "gallery-poster";
    img.src = posterUrl(a.poster);
    img.loading = "lazy";
    img.alt = "";
    img.addEventListener("error", () => markBroken(card, a, "poster"));
    thumb.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "gallery-noposter";
    ph.textContent = a.title || a.fileName;
    thumb.appendChild(ph);
  }

  const kind = document.createElement("span");
  kind.className = `gallery-kind kind-${a.kind}`;
  kind.textContent = a.kind === "toy" ? "TOY" : a.origin === "render" ? "RENDER" : "VIDEO";
  thumb.appendChild(kind);

  const broken = document.createElement("span");
  broken.className = "gallery-broken";
  broken.textContent = "media error";
  thumb.appendChild(broken);

  card.appendChild(thumb);

  const info = document.createElement("div");
  info.className = "gallery-info";
  const title = document.createElement("div");
  title.className = "gallery-title";
  title.textContent = a.title || a.label || a.fileName;
  info.appendChild(title);
  if (a.label !== "" && a.label !== "render") {
    const sub = document.createElement("div");
    sub.className = "gallery-file";
    sub.textContent = a.label;
    info.appendChild(sub);
  }
  const meta = document.createElement("div");
  meta.className = "gallery-meta";
  const time = document.createElement("time");
  time.textContent = a.date;
  meta.appendChild(time);
  if (a.agent !== "") {
    const agent = document.createElement("span");
    agent.className = "gallery-agent";
    agent.textContent = a.agent;
    meta.appendChild(agent);
  }
  info.appendChild(meta);
  card.appendChild(info);

  card.addEventListener("click", () => {
    if (focus === fi) {
      if (a.kind === "toy") window.open(mediaUrl(a), "_blank", "noopener");
      else openOverlay(a);
      return;
    }
    const old = focus;
    focus = fi;
    cellMap.get(old)?.classList.remove("focused");
    card.classList.add("focused");
    mountFocusedVideo();
    updateStatus();
  });

  return card;
}

function markBroken(card: HTMLElement, a: GalleryArtifact, what: string): void {
  card.classList.add("has-broken");
  reportClientError(`Gallery ${what} failed to load: ${a.src}`);
}

// ---------------------------------------------------------------------------
// Video discipline
// ---------------------------------------------------------------------------

function teardownFocusedVideo(): void {
  if (focusedVideo !== null) {
    focusedVideo.pause();
    focusedVideo.removeAttribute("src");
    focusedVideo.load();
    focusedVideo.remove();
    focusedVideo = null;
  }
}

function teardownOverlayVideo(): void {
  if (overlayVideo !== null) {
    overlayVideo.pause();
    overlayVideo.removeAttribute("src");
    overlayVideo.load();
    overlayVideo.remove();
    overlayVideo = null;
  }
}

/** Mount a muted, looping, inline video on the focused card (video cards only). */
function mountFocusedVideo(): void {
  teardownFocusedVideo();
  if (overlayOpen) return; // overlay owns the single live video while open
  const a = filtered[focus];
  if (a === undefined || a.kind !== "video") return;
  const cell = cellMap.get(focus);
  if (cell === undefined) return;
  const thumb = cell.querySelector<HTMLElement>(".gallery-thumb");
  if (thumb === null) return;

  const video = document.createElement("video");
  video.src = mediaUrl(a);
  video.className = "gallery-thumb-video";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.addEventListener("error", () => markBroken(cell, a, "video"));
  thumb.appendChild(video);
  void video.play().catch(() => {});
  focusedVideo = video;
}

// ---------------------------------------------------------------------------
// Overlay player — large, sound-on, spacebar play/pause, Esc close
// ---------------------------------------------------------------------------

function openOverlay(a: GalleryArtifact): void {
  overlayOpen = true;
  teardownFocusedVideo(); // overlay is now the single live video
  overlayEl.innerHTML = `
    <div class="gallery-overlay-backdrop"></div>
    <div class="gallery-overlay-stage">
      <video class="gallery-overlay-video" playsinline controls></video>
      <div class="gallery-overlay-caption">
        <span class="gallery-overlay-title">${esc(a.title || a.fileName)}</span>
        ${a.label !== "" && a.label !== "render" ? `<span class="gallery-overlay-file">${esc(a.label)}</span>` : ""}
        ${a.agent !== "" ? `<span class="gallery-overlay-agent">${esc(a.agent)}</span>` : ""}
        <span class="gallery-overlay-date">${esc(a.date)}</span>
      </div>
      <div class="gallery-overlay-hint"><kbd>space</kbd> play/pause <span class="hint-sep">·</span> <kbd>esc</kbd> close</div>
    </div>`;
  overlayEl.classList.remove("hidden");

  const video = overlayEl.querySelector<HTMLVideoElement>(".gallery-overlay-video")!;
  video.muted = false;
  video.autoplay = true;
  video.playsInline = true;
  video.src = mediaUrl(a);
  video.addEventListener("error", () => reportClientError(`Gallery overlay video failed to load: ${a.src}`));
  void video.play().catch(() => {});
  overlayVideo = video;
  updateStatus();
}

function closeOverlay(): void {
  overlayOpen = false;
  teardownOverlayVideo();
  overlayEl.classList.add("hidden");
  overlayEl.innerHTML = "";
  mountFocusedVideo(); // restore grid autoplay on the focused card
  updateStatus();
}

// ---------------------------------------------------------------------------
// Help overlay
// ---------------------------------------------------------------------------

function renderHelp(): void {
  if (!helpEl) return;
  helpEl.classList.toggle("hidden", !helpVisible);
  if (helpVisible) {
    helpEl.innerHTML = `<div class="help-card"><h3>Gallery Keys</h3><table>${GALLERY_KEYMAP_HELP.map(
      ([key, desc]) => `<tr><td><kbd>${esc(key)}</kbd></td><td>${esc(desc)}</td></tr>`,
    ).join("")}</table><p class="help-dismiss">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</p></div>`;
    helpEl.addEventListener(
      "click",
      () => {
        helpVisible = false;
        renderHelp();
        updateStatus();
      },
      { once: true },
    );
  }
}

// ---------------------------------------------------------------------------
// Status + geometry helpers
// ---------------------------------------------------------------------------

function updateStatus(): void {
  if (statusEl === null) return;
  const { videos, toys } = countKinds(artifacts);
  const cur = filtered[focus];
  const focusLabel = cur !== undefined ? ` · ${cur.title || cur.fileName}` : "";
  const mode = overlayOpen ? "  \u25b6 PLAYING" : helpVisible ? "  ?" : "";
  statusEl.textContent = `GALLERY  ${videos} videos · ${toys} toys  filter:${filter}${focusLabel}${mode}`;
}

/** Columns in the first rendered row, read from live geometry so j/k jump one visual row. */
function currentCols(): number {
  if (filtered.length === 0) return 1;
  const first = cellMap.get(0);
  if (first === undefined) return 1;
  const top0 = first.offsetTop;
  let cols = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    const el = cellMap.get(i);
    if (el === undefined || el.offsetTop !== top0) break;
    cols += 1;
  }
  return Math.max(1, cols);
}

function mediaUrl(a: GalleryArtifact): string {
  return a.origin === "render"
    ? `/asset?path=${encodeURIComponent(a.src)}`
    : `/report?path=${encodeURIComponent(a.src)}`;
}

function posterUrl(poster: string): string {
  return `/report?path=${encodeURIComponent(poster)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export function galleryCss(): string {
  return `
/* === Gallery view === */
.gallery-view-root { height: calc(100vh - 32px - 24px); }
.gallery-layout {
  height: 100%;
  display: grid;
  grid-template-rows: 1fr 24px;
  background: var(--canvas);
  min-height: 0;
}
.gallery-grid {
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-4);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  grid-auto-rows: min-content;
  gap: var(--space-3);
  align-content: start;
}
.gallery-empty {
  grid-column: 1 / -1;
  color: var(--text-dim);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-12);
}

/* -- Card -- */
.gallery-card {
  position: relative;
  border: 1px solid var(--panel-border);
  border-radius: var(--radius);
  background: var(--panel-bg);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) var(--ease-out), transform var(--dur-quick) var(--ease-out);
}
.gallery-card:hover { border-color: var(--panel-border-strong); }
.gallery-card.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 0 18px color-mix(in oklab, var(--accent), transparent 62%);
}
.gallery-card.focused .gallery-title { color: var(--text-primary); }

/* -- Thumb -- */
.gallery-thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--panel-bg-elevated);
  overflow: hidden;
}
.gallery-poster, .gallery-thumb-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gallery-thumb-video { z-index: 1; background: var(--canvas); }
.gallery-noposter {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-3);
  text-align: center;
  color: var(--text-dim);
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-upper);
  text-transform: uppercase;
  background: radial-gradient(circle at 50% 40%, var(--panel-bg-hover), var(--canvas) 75%);
}

/* -- Kind badge -- */
.gallery-kind {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
  z-index: 2;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: var(--tracking-upper);
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  text-transform: uppercase;
  background: rgba(0, 0, 0, 0.6);
  color: var(--text-secondary);
  border: 1px solid var(--panel-border);
}
.gallery-kind.kind-toy { color: var(--accent-2); border-color: color-mix(in oklab, var(--accent-2), transparent 55%); }
.gallery-kind.kind-video { color: var(--accent); border-color: color-mix(in oklab, var(--accent), transparent 55%); }

/* -- Broken badge -- */
.gallery-broken {
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
  z-index: 3;
  display: none;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: var(--tracking-upper);
  text-transform: uppercase;
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  background: var(--error-bg);
  color: var(--error);
  border: 1px solid var(--error-border);
}
.gallery-card.has-broken .gallery-broken { display: inline-block; }
.gallery-card.has-broken .gallery-noposter,
.gallery-card.has-broken .gallery-thumb { background: var(--error-bg); }

/* -- Info -- */
.gallery-info { padding: var(--space-2) var(--space-3) var(--space-3); display: flex; flex-direction: column; gap: 3px; }
.gallery-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-secondary);
  line-height: var(--leading-tight);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.gallery-file {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.gallery-agent {
  color: var(--text-secondary);
  background: var(--panel-bg-active);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-pill);
  padding: 1px 7px;
}

/* -- Hint strip -- */
.gallery-hint-strip {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-3);
  background: var(--panel-bg);
  border-top: 1px solid var(--panel-border-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
}
.gallery-hint-strip kbd {
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

/* -- Expand overlay -- */
.gallery-overlay { position: fixed; inset: 0; z-index: 220; display: grid; place-items: center; }
.gallery-overlay-backdrop { position: absolute; inset: 0; background: rgba(6, 7, 9, 0.86); backdrop-filter: blur(2px); }
.gallery-overlay-stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 88vw;
  max-height: 88vh;
  align-items: center;
}
.gallery-overlay-video {
  max-width: 88vw;
  max-height: 74vh;
  border-radius: var(--radius-md);
  border: 1px solid var(--panel-border-strong);
  background: #000;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
}
.gallery-overlay-caption {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  justify-content: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.gallery-overlay-title { color: var(--text-primary); font-weight: 600; }
.gallery-overlay-file { font-family: var(--font-mono); color: var(--text-muted); }
.gallery-overlay-agent {
  color: var(--text-secondary);
  background: var(--panel-bg-active);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
}
.gallery-overlay-date { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.gallery-overlay-hint { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-dim); }
.gallery-overlay-hint kbd {
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--panel-bg-active);
  border: 1px solid var(--panel-border);
  color: var(--text-secondary);
}

/* -- Help overlay (shares .help-card from main) -- */
.gallery-help-overlay { position: fixed; inset: 0; z-index: 240; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; }
`;
}
