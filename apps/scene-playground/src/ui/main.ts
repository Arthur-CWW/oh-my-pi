// ---------------------------------------------------------------------------
// Scene Playground — main orchestrator
// Preserves: reports view, SSE, markdown renderer, all existing routes/panes
// New: studio v2 with tree, inspector, viewport, timeline, source, keymap
// ---------------------------------------------------------------------------

import "./error-report";

import {
  type AssetEntry,
  type JsonValue,
  type ReportEntry,
  type RenderEntry,
  type SceneSpec,
  type Selection,
  type SpecEntry,
  addObject,
  addOrEnsureAsset,
  clamp,
  createDebounce,
  escapeHtml,
  moveKeyframe,
  parseSpec,
  rewriteAssetsForPreview,
  serializeSpec,
  specDurationInFrames,
  stemFromPath,
} from "./studio/state";
import { renderTree, type TreeCallbacks } from "./studio/tree";
import { renderInspector, type InspectorCallbacks } from "./studio/inspector";
import { createViewport, type ViewportHandle } from "./studio/viewport";
import { renderTimeline, type TimelineCallbacks } from "./studio/timeline";
import { createSourceEditor, getDoc, setDoc, setDirtyDot, setSpecLabel, type SourceState } from "./studio/source";
import { applyDelete, KEYMAP_HELP, mapKey } from "./studio/keymap";
import { mountLabelView, unmountLabelView, handleLabelKeydown, labelCss } from "./label/view";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let spec: SceneSpec | null = null;
let selection: Selection = { type: "none" };
let selectedSpecPath = "";
let playing = true;
let currentFrame = 0;
let currentView: "reports" | "studio" | "label" = "reports";
let studioInitialized = false;
let specsList: SpecEntry[] = [];
let filesystemAssets: AssetEntry[] = [];
let sourceState: SourceState | null = null;
let viewportHandle: ViewportHandle | null = null;
let helpVisible = false;

const DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app missing");

app.innerHTML = `
  <style>${css()}</style>
  <nav class="topnav">
    <span class="brand">scene playground</span>
    <button class="nav-btn active" data-view="reports">reports</button>
    <button class="nav-btn" data-view="studio">studio</button>
    <button class="nav-btn" data-view="label">label</button>
  <section id="reports-view" class="reports-view">
    <div id="report-feed" class="report-feed muted">loading reports\u2026</div>
  </section>
  <div id="studio-view" class="studio-view hidden">
    <aside class="rail left" id="tree-rail">
      <div id="tree-container" class="tree-container"></div>
    </aside>
    <section class="stage-col">
      <div id="runtime-state" class="runtime-state">runtime pending</div>
      <div id="preview" class="preview"></div>
      <div id="transport" class="transport"></div>
      <div id="timeline-container" class="timeline-container"></div>
    </section>
    <aside class="rail right" id="inspector-rail">
      <div class="inspector-wrap">
        <div class="panel-title">Inspector</div>
        <div id="inspector-container" class="inspector-container"></div>
      </div>
      <div class="source-wrap">
        <div id="editor-head" class="editor-head"></div>
        <div id="editor-container" class="editor-container"></div>
      </div>
    </aside>
  </div>
  <div id="label-view" class="label-view-root hidden"></div>
  <div id="help-overlay" class="help-overlay hidden"></div>
  <footer id="status">SSE: connecting\u2026</footer>
`;

const reportFeed = mustEl<HTMLDivElement>("report-feed");
const reportsView = mustEl<HTMLElement>("reports-view");
const studioView = mustEl<HTMLDivElement>("studio-view");
const statusLine = mustEl<HTMLElement>("status");
const runtimeState = mustEl<HTMLDivElement>("runtime-state");
const preview = mustEl<HTMLDivElement>("preview");
const treeContainer = mustEl<HTMLDivElement>("tree-container");
const inspectorContainer = mustEl<HTMLDivElement>("inspector-container");
const editorHead = mustEl<HTMLDivElement>("editor-head");
const editorContainer = mustEl<HTMLDivElement>("editor-container");
const transportContainer = mustEl<HTMLDivElement>("transport");
const timelineContainer = mustEl<HTMLDivElement>("timeline-container");
const helpOverlay = mustEl<HTMLDivElement>("help-overlay");

// ---------------------------------------------------------------------------
// Debounced reinit pipeline
// ---------------------------------------------------------------------------

let reinitGeneration = 0;
const reinitDebounce = createDebounce(() => void reinitPipeline(), DEBOUNCE_MS);

async function reinitPipeline(): Promise<void> {
  if (spec === null || window.SceneRuntime === undefined) return;
  const gen = ++reinitGeneration;
  const savedFrame = viewportHandle !== null ? viewportHandle.getFrame() : currentFrame;

  window.SceneRuntime.stop();
  const liveSpec = rewriteAssetsForPreview(spec);
  await window.SceneRuntime.init(liveSpec as unknown as JsonValue, {
    width: liveSpec.width, height: liveSpec.height, fps: liveSpec.fps, assetBaseUrl: "",
  });

  // Stale generation — a newer reinit was requested during await; bail
  if (gen !== reinitGeneration) return;

  const canvas = document.querySelector<HTMLCanvasElement>("canvas#scene");
  if (canvas !== null) {
    preview.textContent = "";
    preview.append(canvas);
  }

  const total = specDurationInFrames(liveSpec);
  const frame = clamp(savedFrame, 0, Math.max(0, total - 1));
  window.SceneRuntime.renderFrame(frame);
  currentFrame = frame;

  if (playing) window.SceneRuntime.start();

  runtimeState.textContent = spec.assets?.some((a) => a.kind === "videoFrames")
    ? "runtime ready \u2014 videoFrames: offline-only" : "runtime ready";
  runtimeState.classList.remove("error");

  // Sync source editor
  if (sourceState !== null && sourceState.mode === "editor") {
    setDoc(sourceState.editor, serializeSpec(spec));
  }

  updateViewport();
}

// ---------------------------------------------------------------------------
// Panel refresh
// ---------------------------------------------------------------------------

function refreshPanels(): void {
  if (spec === null) return;

  const treeCbs: TreeCallbacks = {
    onSelect(sel) { selection = sel; refreshPanels(); if (viewportHandle !== null && sel.type === "object") viewportHandle.flashObject(); },
    onMutate() { touchSpec(); },
    onLoadSpec(path) { void loadSpec(path); },
  };
  renderTree(treeContainer, spec, selection, specsList, selectedSpecPath, filesystemAssets, treeCbs);

  const inspCbs: InspectorCallbacks = { onChange() { touchSpec(true); } };
  renderInspector(inspectorContainer, spec, selection, inspCbs);

  const tlCbs: TimelineCallbacks = {
    onSeek(frame) { seekToFrame(frame); },
    onKeyframeDrag(objectId, trackIndex, kfIndex, newT) {
      if (spec !== null) { moveKeyframe(spec, { objectId }, trackIndex, kfIndex, newT); reinitDebounce.schedule(); }
    },
  };
  renderTimeline(timelineContainer, spec, currentFrame, selection, tlCbs);

  updateViewport();
}

function updateViewport(): void {
  if (viewportHandle !== null && spec !== null) {
    viewportHandle.updateState(playing, currentFrame, spec);
  }
}

function touchSpec(skipPanelRefresh = false): void {
  if (sourceState !== null) {
    sourceState.dirty = true;
    setDirtyDot(editorHead, true);
  }
  if (!skipPanelRefresh) refreshPanels();
  reinitDebounce.schedule();
}

function seekToFrame(frame: number): void {
  currentFrame = frame;
  playing = false;
  if (window.SceneRuntime !== undefined) {
    window.SceneRuntime.stop();
    window.SceneRuntime.renderFrame(frame);
  }
  refreshPanels();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

await boot();

async function boot(): Promise<void> {
  await refreshReports();
  wireEvents();
  connectEvents();
}

function wireEvents(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".nav-btn")) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view as "reports" | "studio" | "label" | undefined;
      if (target !== undefined && target !== currentView) switchView(target);
    });
  }

  // Global keymap
  window.addEventListener("keydown", (e) => {
    if (currentView === "label") { handleLabelKeydown(e); return; }
    if (currentView !== "studio") return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      // Inside form controls: only handle Escape
      if (e.key === "Escape") { (target as HTMLElement).blur(); e.preventDefault(); }
      return;
    }
    // Check if inside CodeMirror
    if (target instanceof HTMLElement && target.closest(".cm-editor") !== null) return;

    // Close help overlay on Escape or ?
    if (helpVisible && (e.key === "Escape" || e.key === "?")) {
      e.preventDefault();
      toggleHelp();
      return;
    }

    const action = mapKey(e.key, e.shiftKey, spec, selection);
    switch (action.type) {
      case "select":
        e.preventDefault();
        selection = action.selection;
        refreshPanels();
        if (viewportHandle !== null && action.selection.type === "object") viewportHandle.flashObject();
        break;
      case "play-toggle":
        e.preventDefault();
        togglePlayback();
        break;
      case "delete":
        if (spec !== null) {
          e.preventDefault();
          selection = applyDelete(spec, selection);
          touchSpec();
        }
        break;
      case "step-frame": {
        e.preventDefault();
        if (spec === null) break;
        const bpm = spec.timeline?.bpm ?? 120;
        const step = action.big ? Math.round(spec.fps * 60 / bpm) : 1;
        seekToFrame(clamp(currentFrame + action.direction * step, 0, Math.max(0, specDurationInFrames(spec) - 1)));
        break;
      }
      case "focus-inspector":
        e.preventDefault();
        inspectorContainer.querySelector<HTMLElement>(".scrub-value, select, input")?.focus();
        break;
      case "focus-tree":
        e.preventDefault();
        treeContainer.querySelector<HTMLElement>(".tree-row")?.focus();
        break;
      case "show-help":
        e.preventDefault();
        toggleHelp();
        break;
      case "none":
        break;
    }
  });
}

function togglePlayback(): void {
  playing = !playing;
  if (window.SceneRuntime !== undefined) {
    if (playing) window.SceneRuntime.start();
    else window.SceneRuntime.stop();
  }
  updateViewport();
}

function toggleHelp(): void {
  helpVisible = !helpVisible;
  helpOverlay.classList.toggle("hidden", !helpVisible);
  if (helpVisible) {
    helpOverlay.innerHTML = `<div class="help-card"><h3>Keyboard Shortcuts</h3><table>${
      KEYMAP_HELP.map(([key, desc]) => `<tr><td><kbd>${escapeHtml(key)}</kbd></td><td>${escapeHtml(desc)}</td></tr>`).join("")
    }</table><p class="help-dismiss">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</p></div>`;
    helpOverlay.addEventListener("click", () => toggleHelp(), { once: true });
  }
}

function switchView(target: "reports" | "studio" | "label"): void {
  if (currentView === "label") unmountLabelView();
  currentView = target;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".nav-btn")) {
    btn.classList.toggle("active", btn.dataset.view === target);
  }
  reportsView.classList.toggle("hidden", target !== "reports");
  studioView.classList.toggle("hidden", target !== "studio");
  const labelView = document.getElementById("label-view");
  if (labelView !== null) labelView.classList.toggle("hidden", target !== "label");
  if (target === "reports") {
    // Pause runtime and viewport RAF when leaving studio
    if (window.SceneRuntime !== undefined) window.SceneRuntime.stop();
    if (viewportHandle !== null) viewportHandle.destroy();
    playing = false;
  } else if (target === "studio") {
    void initStudio();
  } else if (target === "label") {
    const lv = document.getElementById("label-view");
    const st = document.getElementById("status");
    if (lv !== null && st !== null) mountLabelView(lv, st);
  }
}

// ---------------------------------------------------------------------------
// Studio init
// ---------------------------------------------------------------------------

async function initStudio(): Promise<void> {
  if (studioInitialized) return;
  studioInitialized = true;

  await ensureRuntime();

  // Fetch specs and assets in parallel
  const [specs, assets] = await Promise.all([
    fetchJson<SpecEntry[]>("/api/specs"),
    fetchJson<AssetEntry[]>("/api/assets"),
  ]);
  specsList = specs;
  filesystemAssets = assets;

  // Create source editor
  sourceState = createSourceEditor(editorContainer, editorHead, {
    onSave() { void saveCurrentSpec(); },
    onSpecParsed(text) {
      try {
        spec = parseSpec(text);
        refreshPanels();
        reinitDebounce.schedule();
      } catch { /* invalid json, ignore */ }
    },
  });

  // Create viewport
  viewportHandle = createViewport(preview, transportContainer, {
    onPlayToggle(p) {
      playing = p;
      if (window.SceneRuntime !== undefined) {
        if (p) window.SceneRuntime.start();
        else window.SceneRuntime.stop();
      }
    },
    onScrub(frame) {
      currentFrame = frame;
      playing = false;
      if (window.SceneRuntime !== undefined) {
        window.SceneRuntime.stop();
        window.SceneRuntime.renderFrame(frame);
      }
      updateViewport();
    },
    onFrameTick(frame) {
      currentFrame = frame;
      // Lightweight playhead update — move the SVG line without rebuilding timeline
      const ph = timelineContainer.querySelector<SVGLineElement>(".timeline-svg line[stroke='#ff4fd8']");
      if (ph !== null && spec !== null) {
        const px = String((frame / spec.fps) * 60); // PX_PER_SEC = 60
        ph.setAttribute("x1", px);
        ph.setAttribute("x2", px);
        // Auto-scroll playhead into view
        const containerWidth = timelineContainer.clientWidth;
        const pxNum = Number(px);
        if (containerWidth > 0 && pxNum > timelineContainer.scrollLeft + containerWidth - 40) {
          timelineContainer.scrollLeft = pxNum - containerWidth / 2;
        }
      }
    },
  });

  // Handle insert-asset custom event from inspector
  inspectorContainer.addEventListener("insert-asset", ((e: CustomEvent) => {
    if (spec === null) return;
    const { assetId, kind, path } = e.detail as { assetId: string; kind: string; path: string };
    addOrEnsureAsset(spec, assetId, kind, path);
    addObject(spec, "plane", assetId);
    touchSpec();
  }) as EventListener);

  // Load first spec
  if (specs.length > 0) {
    await loadSpec(specs[0]!.path);
  }
}

// ---------------------------------------------------------------------------
// Spec loading / saving
// ---------------------------------------------------------------------------

async function loadSpec(path: string): Promise<void> {
  selectedSpecPath = path;
  const text = await fetchText(`/api/spec?path=${encodeURIComponent(path)}`);
  try {
    spec = parseSpec(text);
  } catch (err) {
    runtimeState.textContent = err instanceof Error ? err.message : "invalid JSON";
    runtimeState.classList.add("error");
    return;
  }

  if (sourceState !== null) {
    setDoc(sourceState.editor, text);
    sourceState.dirty = false;
    setDirtyDot(editorHead, false);
  }
  setSpecLabel(editorHead, path);

  currentFrame = 0;
  selection = { type: "none" };

  if (window.SceneRuntime !== undefined) {
    const liveSpec = rewriteAssetsForPreview(spec);
    window.SceneRuntime.stop();
    await window.SceneRuntime.init(liveSpec as unknown as JsonValue, {
      width: liveSpec.width, height: liveSpec.height, fps: liveSpec.fps, assetBaseUrl: "",
    });
    const canvas = document.querySelector<HTMLCanvasElement>("canvas#scene");
    if (canvas !== null) { preview.textContent = ""; preview.append(canvas); }
    if (playing) window.SceneRuntime.start();
    runtimeState.textContent = spec.assets?.some((a) => a.kind === "videoFrames")
      ? "runtime ready \u2014 videoFrames: offline-only" : "runtime ready";
    runtimeState.classList.remove("error");
  }

  refreshPanels();
}

async function saveCurrentSpec(): Promise<void> {
  if (selectedSpecPath.length === 0 || sourceState === null) return;
  // If in source mode, use the source pane text; else use editor
  const text = getDoc(sourceState.editor);
  const response = await fetch(`/api/spec?path=${encodeURIComponent(selectedSpecPath)}`, { method: "PUT", body: text });
  if (!response.ok) throw new Error(await response.text());
  sourceState.dirty = false;
  setDirtyDot(editorHead, false);
  statusLine.textContent = `saved ${selectedSpecPath}`;

  // Re-parse to keep in sync
  try {
    spec = parseSpec(text);
    refreshPanels();
    reinitDebounce.schedule();
  } catch { /* leave spec as-is */ }
}

// ---------------------------------------------------------------------------
// Reports (preserved from v1)
// ---------------------------------------------------------------------------

async function refreshReports(): Promise<void> {
  const reports = await fetchJson<ReportEntry[]>("/api/reports");
  reportFeed.textContent = "";
  if (reports.length === 0) { reportFeed.textContent = "no reports yet"; return; }
  for (const report of reports) reportFeed.append(createReportCard(report));
}

function createReportCard(report: ReportEntry): HTMLElement {
  const card = document.createElement("article");
  card.className = "report-card";
  const statusClass = report.status === "shipped" ? "status-shipped"
    : report.status === "partial" ? "status-partial"
    : report.status === "blocked" ? "status-blocked" : "";

  let mediaHtml = "";
  for (const mediaPath of report.media) {
    const src = `/report?path=${encodeURIComponent(mediaPath)}`;
    const name = mediaPath.split("/").pop() ?? mediaPath;
    if (/\.png$/i.test(name)) mediaHtml += `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" />`;
    else if (/\.mp4$/i.test(name)) mediaHtml += `<video src="${escapeHtml(src)}" preload="metadata" controls></video>`;
  }

  card.innerHTML = `<div class="report-head">
    <h3 class="report-title">${escapeHtml(report.title)}</h3>
    <div class="report-meta">
      <time>${escapeHtml(report.date)}</time>
      <span class="report-agent">${escapeHtml(report.agent)}</span>
      ${statusClass.length > 0 ? `<span class="status-pill ${statusClass}">${escapeHtml(report.status)}</span>` : ""}
    </div>
  </div>
  <p class="report-excerpt">${escapeHtml(report.excerpt)}</p>
  ${mediaHtml.length > 0 ? `<div class="report-media">${mediaHtml}</div>` : ""}
  <button class="report-toggle" data-report-path="${escapeHtml(report.path)}">expand</button>
  <div class="report-body"></div>`;

  const toggle = card.querySelector<HTMLButtonElement>(".report-toggle");
  const body = card.querySelector<HTMLDivElement>(".report-body");
  if (toggle !== null && body !== null) {
    toggle.addEventListener("click", async () => {
      if (body.classList.contains("open")) { body.classList.remove("open"); toggle.textContent = "expand"; return; }
      if (body.innerHTML.length === 0) {
        const md = await fetchText(`/report?path=${encodeURIComponent(report.path + "/report.md")}`);
        body.innerHTML = renderMarkdown(stripFrontMatter(md));
      }
      body.classList.add("open");
      toggle.textContent = "collapse";
    });
  }
  return card;
}

function stripFrontMatter(md: string): string {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.trim() === "") return lines.slice(i + 1).join("\n").trim();
  }
  return md;
}

// ---------------------------------------------------------------------------
// Minimal markdown renderer (preserved)
// ---------------------------------------------------------------------------

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  const para: string[] = [];

  function flushParagraph(): void {
    if (para.length > 0) { out.push(`<p>${para.join(" ")}</p>`); para.length = 0; }
  }
  function closeList(): void {
    if (inList) { out.push("</ul>"); inList = false; }
  }

  for (const line of lines) {
    if (inCode) {
      if (line.trimStart().startsWith("```")) { inCode = false; out.push("</code></pre>"); }
      else out.push(escapeHtml(line) + "\n");
      continue;
    }
    if (line.trimStart().startsWith("```")) { flushParagraph(); closeList(); inCode = true; out.push("<pre><code>"); continue; }

    const headingMatch = /^(#{1,6})\s+(.+)/.exec(line);
    if (headingMatch !== null) {
      flushParagraph(); closeList();
      const level = headingMatch[1]!.length;
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2]!)}</h${level}>`);
      continue;
    }

    const listMatch = /^[-*]\s+(.+)/.exec(line);
    if (listMatch !== null) {
      flushParagraph();
      if (!inList) { inList = true; out.push("<ul>"); }
      out.push(`<li>${inlineMarkdown(listMatch[1]!)}</li>`);
      continue;
    }

    if (line.trim() === "") { flushParagraph(); closeList(); continue; }
    closeList();
    para.push(inlineMarkdown(line));
  }
  flushParagraph(); closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("");
}

function inlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const decoded = href.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    if (/^(https?:\/\/|\/|#|\.)/i.test(decoded)) {
      return `<a href="${href}" target="_blank">${label}</a>`;
    }
    return label;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Runtime / SSE (preserved)
// ---------------------------------------------------------------------------

async function ensureRuntime(): Promise<void> {
  const response = await fetch("/runtime.js", { cache: "no-store" });
  if (!response.ok) {
    runtimeState.textContent = "runtime not built \u2014 build packages/scene-renderer first";
    runtimeState.classList.add("error");
    return;
  }
  await loadRuntimeScript();
  runtimeState.textContent = "runtime ready";
  runtimeState.classList.remove("error");
}

async function loadRuntimeScript(): Promise<void> {
  const prior = document.querySelector<HTMLScriptElement>("script[data-scene-runtime]");
  prior?.remove();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const script = document.createElement("script");
  script.dataset.sceneRuntime = "true";
  script.src = `/runtime.js?cache=${Date.now()}`;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error("runtime.js load failed"));
  document.head.append(script);
  await promise;
}

function connectEvents(): void {
  const source = new EventSource("/events");
  source.onopen = () => { statusLine.textContent = "SSE: connected"; };
  source.onmessage = async (message) => {
    const event = JSON.parse(message.data) as { type: string; path: string };
    statusLine.textContent = `SSE: ${event.type} ${event.path}`;
    if (event.type === "spec-changed") {
      specsList = await fetchJson<SpecEntry[]>("/api/specs");
      if (event.path === selectedSpecPath) await loadSpec(selectedSpecPath);
      else refreshPanels();
    } else if (event.type === "report-added") {
      await refreshReports();
      const first = reportFeed.firstElementChild;
      if (first !== null) { first.classList.add("flash"); setTimeout(() => first.classList.remove("flash"), 2400); }
    }
  };
  source.onerror = () => { statusLine.textContent = "SSE: reconnecting\u2026"; };
}

// ---------------------------------------------------------------------------
// Utilities (preserved)
// ---------------------------------------------------------------------------

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.text();
}

function mustEl<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`#${id} missing`);
  return element as T;
}

// ---------------------------------------------------------------------------
// CSS — uses design tokens from tokens.css, all Studio v2 + report styles
// ---------------------------------------------------------------------------

function css(): string {
  return `
/* === Reset & base (token-aware) === */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-mono); background: var(--canvas); color: var(--text-primary); overflow: hidden; }
button { font: inherit; color: var(--text-primary); background: var(--panel-bg-hover); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); cursor: pointer; font-size: var(--text-sm); transition: border-color var(--dur-quick) var(--ease-out); }
button:hover { border-color: var(--panel-border-strong); }
button:focus-visible { outline: none; box-shadow: var(--focus-ring); }
select, input[type="text"], input[type="number"] { font: inherit; background: var(--control-bg); border: 1px solid var(--control-border); border-radius: var(--radius-sm); color: var(--text-primary); padding: 2px var(--space-1); font-size: var(--text-sm); }
select:focus, input:focus { outline: none; box-shadow: var(--focus-ring); }
.hidden { display: none !important; }

/* === Top nav === */
.topnav { height: 32px; display: flex; align-items: center; gap: 2px; padding: 0 var(--space-3); background: var(--panel-bg); border-bottom: 1px solid var(--panel-border); }
.brand { color: var(--accent-2); letter-spacing: var(--tracking-upper); text-transform: uppercase; font-weight: 800; margin-right: var(--space-4); font-size: var(--text-sm); }
.nav-btn { background: none; border: 1px solid transparent; color: var(--text-muted); text-transform: uppercase; font-size: var(--text-xs); letter-spacing: var(--tracking-nav); padding: 3px var(--space-2); border-radius: var(--radius-sm); }
.nav-btn:hover { color: var(--text-primary); }
.nav-btn.active { color: var(--accent); background: var(--panel-bg-hover); border-color: var(--panel-border); }

/* === Footer === */
footer { height: 24px; display: flex; align-items: center; padding: 0 var(--space-2); background: var(--panel-bg); color: var(--accent); border-top: 1px solid var(--panel-border); font-size: var(--text-xs); }

/* === Reports view (preserved) === */
.reports-view { height: calc(100vh - 32px - 24px); overflow-y: auto; padding: var(--space-6) var(--space-8); }
.report-feed { max-width: 820px; }
.report-card { border: 1px solid var(--panel-border); background: var(--panel-bg); border-radius: var(--radius); padding: var(--space-4) var(--space-6); margin-bottom: var(--space-3); transition: border-color 1.8s var(--ease-spring); }
.report-card.flash { border-color: var(--accent); box-shadow: 0 0 16px color-mix(in oklab, var(--accent), transparent 80%); }
.report-head { margin-bottom: var(--space-1); }
.report-title { font-size: var(--text-lg); font-weight: 700; margin: 0 0 var(--space-1); color: var(--text-primary); }
.report-meta { display: flex; gap: var(--space-3); align-items: center; font-size: var(--text-sm); color: var(--text-muted); }
.report-agent { color: var(--text-secondary); }
.status-pill { padding: 2px var(--space-2); border-radius: var(--radius-pill); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.status-shipped { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
.status-partial { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-border); }
.status-blocked { background: var(--error-bg); color: var(--error); border: 1px solid var(--error-border); }
.report-excerpt { color: var(--text-secondary); font-size: var(--text-md); line-height: var(--leading-body); margin: var(--space-2) 0; }
.report-media { display: flex; gap: var(--space-2); flex-wrap: wrap; margin: var(--space-2) 0; }
.report-media img { max-width: 200px; max-height: 140px; border-radius: var(--radius); border: 1px solid var(--panel-border); object-fit: cover; }
.report-media video { max-width: 240px; max-height: 140px; border-radius: var(--radius); border: 1px solid var(--panel-border); background: var(--canvas); }
.report-toggle { color: var(--accent); cursor: pointer; font-size: var(--text-xs); background: none; border: none; padding: 2px 0; letter-spacing: 0.04em; text-transform: uppercase; }
.report-toggle:hover { color: var(--accent-hover); border: none; }
.report-body { display: none; margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--panel-border); color: var(--text-secondary); font-size: var(--text-md); line-height: 1.6; }
.report-body.open { display: block; }
.report-body h1, .report-body h2, .report-body h3 { color: var(--text-primary); margin: 14px 0 6px; }
.report-body h1 { font-size: 16px; } .report-body h2 { font-size: 14px; } .report-body h3 { font-size: var(--text-md); }
.report-body pre { background: var(--canvas); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: var(--space-2) var(--space-3); overflow-x: auto; margin: var(--space-2) 0; }
.report-body code { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); }
.report-body p code { background: var(--panel-bg-hover); padding: 1px 5px; border-radius: var(--radius-xs); }
.report-body ul { padding-left: 20px; margin: 6px 0; }
.report-body li { margin-bottom: 3px; }
.report-body a { color: var(--accent); text-decoration: none; }
.report-body a:hover { text-decoration: underline; }
.report-body strong { color: var(--text-primary); }

/* === Studio v2 grid === */
.studio-view { height: calc(100vh - 32px - 24px); display: grid; grid-template-columns: 220px minmax(400px, 1fr) 320px; gap: 1px; background: var(--panel-border); }

/* -- Rails -- */
.rail { background: var(--panel-bg); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.rail.right { display: grid; grid-template-rows: 1fr 1fr; }

/* -- Center stage -- */
.stage-col { background: var(--canvas); display: grid; grid-template-rows: 26px minmax(0, 1fr) 34px 140px; min-height: 0; }
.runtime-state { display: flex; align-items: center; padding: 0 var(--space-3); color: var(--success); background: var(--success-bg); border-bottom: 1px solid var(--success-border); font-size: var(--text-xs); }
.runtime-state.error { color: var(--error); background: var(--error-bg); border-color: var(--error-border); }
.preview { position: relative; overflow: hidden; display: grid; place-items: center; background: radial-gradient(circle at 50% 35%, var(--panel-bg-elevated), var(--canvas) 70%); }
.preview canvas { max-width: 100%; max-height: 100%; width: auto !important; height: auto !important; box-shadow: 0 0 40px rgba(0,0,0,0.6); }

/* -- Transport -- */
.transport { display: grid; grid-template-columns: 72px 1fr 56px 110px auto; gap: var(--space-2); align-items: center; padding: 0 var(--space-2); background: var(--panel-bg); border-top: 1px solid var(--panel-border); border-bottom: 1px solid var(--panel-border); font-size: var(--text-sm); }
.transport-btn { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-upper); padding: var(--space-1) var(--space-2); }
.transport-scrub { width: 100%; accent-color: var(--accent); }
.beat { text-align: center; border: 1px solid var(--panel-border); border-radius: var(--radius-pill); padding: 2px var(--space-1); color: var(--text-muted); font-size: var(--text-xs); transition: all var(--dur-quick); }
.beat.flash { color: var(--canvas); background: var(--accent); box-shadow: 0 0 14px var(--accent); }
.frame-readout { color: var(--text-secondary); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.res-badge { color: var(--text-dim); font-size: var(--text-xs); }

/* -- Timeline -- */
.timeline-container { height: 140px; overflow-x: auto; overflow-y: hidden; background: var(--canvas); border-top: 1px solid var(--panel-border); }
.timeline-svg { min-width: 100%; display: block; }

/* === Tree (left rail) === */
.tree-container { height: 100%; overflow-y: auto; padding: var(--space-1) 0; font-size: var(--text-sm); }
.tree-spec-selector { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--panel-border-subtle); }
.tree-spec-dropdown { width: 100%; font-size: var(--text-xs); background: var(--control-bg); border: 1px solid var(--control-border); border-radius: var(--radius-sm); color: var(--text-primary); padding: 3px var(--space-1); }
.tree-section-header { display: flex; align-items: center; padding: var(--space-1) var(--space-2); color: var(--text-secondary); text-transform: uppercase; font-size: var(--text-xs); letter-spacing: var(--tracking-upper); cursor: pointer; gap: var(--space-1); user-select: none; }
.tree-toggle { width: 12px; color: var(--text-dim); }
.tree-plus { background: none; border: 1px solid var(--panel-border); color: var(--text-muted); padding: 0 5px; font-size: 14px; line-height: 1; border-radius: var(--radius-sm); margin-left: auto; }
.tree-plus:hover { color: var(--accent); border-color: var(--accent); }
.tree-row { display: flex; align-items: center; padding: 3px var(--space-2) 3px 16px; cursor: pointer; gap: var(--space-1); border-left: 2px solid transparent; font-size: var(--text-sm); transition: background var(--dur-quick); }
.tree-row:hover { background: var(--panel-bg-hover); }
.tree-row.active { border-left-color: var(--accent); background: var(--panel-bg-active); color: var(--accent); }
.tree-row:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.tree-row-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tree-row-kind { color: var(--text-dim); font-size: var(--text-xs); }
.clone-badge { color: var(--accent-2); font-size: var(--text-xs); }
.tree-delete, .tree-mini-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 0 2px; }
.tree-delete:hover { color: var(--error); }
.tree-mini-btn:hover { color: var(--accent); }
.tree-row-btns { display: flex; gap: 1px; margin-left: auto; }
.tree-children { padding-left: var(--space-2); }

/* Popup menu */
.popup-menu { background: var(--panel-bg-elevated); border: 1px solid var(--panel-border-strong); border-radius: var(--radius); padding: var(--space-1); z-index: 100; box-shadow: var(--elev-raised); min-width: 120px; }
.popup-menu button { display: block; width: 100%; text-align: left; background: none; border: none; padding: var(--space-1) var(--space-2); cursor: pointer; font-size: var(--text-sm); border-radius: var(--radius-xs); }
.popup-menu button:hover { background: var(--panel-bg-active); color: var(--accent); }

/* === Inspector (right rail top) === */
.inspector-wrap { overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.inspector-wrap .panel-title { height: var(--panel-header-height); display: flex; align-items: center; padding: 0 var(--space-2); color: var(--text-secondary); text-transform: uppercase; font-size: var(--panel-header-label); letter-spacing: var(--tracking-upper); border-bottom: 1px solid var(--panel-border); flex-shrink: 0; }
.inspector-container { flex: 1; overflow-y: auto; padding: var(--space-2); }
.inspector-empty { color: var(--text-dim); font-size: var(--text-sm); padding: var(--space-4); text-align: center; }
.inspector-section { margin-bottom: var(--space-2); }
.inspector-section h4 { margin: 0 0 var(--space-1); font-size: var(--text-xs); color: var(--text-secondary); text-transform: uppercase; letter-spacing: var(--tracking-upper); border-bottom: 1px solid var(--panel-border-subtle); padding-bottom: 3px; font-weight: 600; }
.inspector-field { display: flex; align-items: center; gap: var(--space-1); margin: 3px 0; min-height: 22px; }
.inspector-field label { color: var(--text-muted); font-size: var(--text-xs); min-width: 52px; text-align: right; flex-shrink: 0; }
.inspector-field input, .inspector-field select { flex: 1; min-width: 0; }
.inspector-field input[type="color"] { width: 28px; height: 20px; padding: 0; border: 1px solid var(--control-border); flex: 0; }
.scrub-value { color: var(--accent); font-size: var(--text-sm); font-weight: 600; cursor: ew-resize; user-select: none; min-width: 44px; text-align: center; background: var(--control-bg); padding: 2px var(--space-1); border-radius: var(--radius-sm); border: 1px solid var(--control-border); transition: border-color var(--dur-quick); }
.scrub-value:hover { border-color: var(--accent); }
.scrub-value:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.axis-label { color: var(--text-dim); font-size: 9px; width: 10px; text-align: center; flex-shrink: 0; }
.scrub-live { color: var(--success); font-size: var(--text-xs); margin-left: 2px; }
.inspector-btn { width: 100%; margin-top: var(--space-1); padding: var(--space-1); font-size: var(--text-xs); background: var(--control-bg); border: 1px solid var(--control-border); color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; }
.inspector-btn:hover { border-color: var(--accent); color: var(--accent); }
.inspector-btn-inline { background: none; border: none; cursor: pointer; font-size: 16px; padding: 0 2px; }
.inspector-textarea { width: 100%; background: var(--control-bg); border: 1px solid var(--control-border); color: var(--text-primary); font-size: var(--text-xs); font-family: var(--font-mono); padding: var(--space-1); border-radius: var(--radius-sm); resize: vertical; min-height: 36px; }
.info-value { color: var(--text-secondary); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

/* Track editor */
.track-editor { background: var(--panel-bg-elevated); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: var(--space-1); margin: var(--space-1) 0; }
.track-head { display: flex; justify-content: space-between; align-items: center; font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-1); padding-bottom: 2px; border-bottom: 1px solid var(--panel-border-subtle); }
.keyframe-table { width: 100%; border-collapse: collapse; margin: var(--space-1) 0; }
.keyframe-table th, .keyframe-table td { padding: 2px 3px; font-size: var(--text-xs); text-align: left; }
.keyframe-table th { color: var(--text-dim); font-weight: 500; }
.keyframe-table input { width: 100%; min-width: 0; }

/* === Source editor (right rail bottom) === */
.source-wrap { overflow: hidden; display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--panel-border); }
.editor-head { height: var(--panel-header-height); display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-2); border-bottom: 1px solid var(--panel-border); flex-shrink: 0; }
.source-spec-label { color: var(--text-secondary); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dirty-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-2); flex-shrink: 0; }
.tab-btn { background: none; border: 1px solid transparent; color: var(--text-muted); font-size: var(--text-xs); padding: 2px var(--space-2); border-radius: var(--radius-sm); text-transform: uppercase; letter-spacing: var(--tracking-nav); }
.tab-btn.active { color: var(--accent); border-color: var(--panel-border); background: var(--panel-bg-hover); }
.save-btn { font-size: var(--text-xs); padding: 2px var(--space-2); background: var(--panel-bg-hover); }
.editor-container { flex: 1; overflow: hidden; position: relative; }
.editor { height: 100%; overflow: hidden; }
.source-view { height: 100%; overflow: auto; padding: var(--space-3); font-family: var(--font-mono); font-size: var(--text-md); white-space: pre-wrap; color: var(--text-secondary); background: var(--canvas); }
.cm-editor { height: 100%; font-size: var(--text-md); }

/* === Flash overlay === */
@keyframes flash-outline { 0% { opacity: 1; } 100% { opacity: 0; } }
.flash-overlay { position: absolute; inset: 0; border: 2px solid var(--accent); border-radius: var(--radius-sm); pointer-events: none; z-index: 2; animation: flash-outline 0.5s var(--ease-out) forwards; }

/* === Help overlay === */
.help-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.6); display: grid; place-items: center; }
.help-card { background: var(--panel-bg-elevated); border: 1px solid var(--panel-border-strong); border-radius: var(--radius-md); padding: var(--space-6); max-width: 400px; box-shadow: var(--elev-raised); }
.help-card h3 { font-size: var(--text-lg); margin-bottom: var(--space-3); color: var(--text-primary); }
.help-card table { width: 100%; border-collapse: collapse; }
.help-card td { padding: 3px var(--space-2); font-size: var(--text-sm); color: var(--text-secondary); }
.help-card kbd { background: var(--panel-bg-active); border: 1px solid var(--panel-border); border-radius: var(--radius-xs); padding: 1px 5px; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-primary); }
.help-dismiss { margin-top: var(--space-3); text-align: center; font-size: var(--text-xs); color: var(--text-dim); }

/* === Shared === */
.muted { color: var(--text-muted); font-size: var(--text-sm); }
${labelCss()}
`;
}
