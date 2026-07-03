import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, basicSetup } from "codemirror";

type AssetKind = "image" | "audio" | "video";
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface SpecEntry {
  path: string;
  mtime: string;
  bytes: number;
}

interface AssetEntry {
  path: string;
  kind: AssetKind;
  bytes: number;
}

interface RenderEntry {
  path: string;
  mtime: string;
  bytes: number;
  manifest: JsonValue | null;
}

interface ReportEntry {
  path: string;
  title: string;
  date: string;
  agent: string;
  status: string;
  excerpt: string;
  media: string[];
  mtime: string;
}

interface SceneRuntimeGlobal {
  init(spec: JsonValue, opts: { width: number; height: number; fps: number; assetBaseUrl: string }): Promise<void>;
  renderFrame(frame: number): void;
  durationInFrames(): number;
  start(): void;
  stop(): void;
}

interface SceneAsset extends JsonObject {
  id: string;
  kind: string;
  path: string;
}

interface SceneTimeline extends JsonObject {
  bpm?: number;
  beats?: number[];
}

interface SceneSpec extends JsonObject {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  assets?: SceneAsset[];
  timeline?: SceneTimeline;
}

declare global {
  interface Window {
    SceneRuntime?: SceneRuntimeGlobal;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("#app missing");

app.innerHTML = `
  <style>${css()}</style>
  <nav class="topnav">
    <span class="brand">scene playground</span>
    <button class="nav-btn active" data-view="reports">reports</button>
    <button class="nav-btn" data-view="studio">studio</button>
  </nav>
  <section id="reports-view" class="reports-view">
    <div id="report-feed" class="report-feed muted">loading reports…</div>
  </section>
  <div id="studio-view" class="studio-view" style="display:none">
    <aside class="rail left">
      <div class="panel"><div class="panel-title">specs</div><div id="spec-list" class="list muted">loading…</div></div>
      <div class="panel grow"><div class="panel-title">assets</div><div id="asset-list" class="tree muted">loading…</div></div>
    </aside>
    <section class="stage-col">
      <div id="runtime-state" class="runtime-state">runtime pending</div>
      <div id="preview" class="preview"></div>
      <div class="transport">
        <button id="play-toggle">pause</button>
        <input id="scrub" type="range" min="0" max="0" value="0" />
        <span id="beat" class="beat">beat</span>
        <span id="frame-readout">0 / 0</span>
      </div>
      <div class="panel renders"><div class="panel-title">renders</div><div id="render-list" class="render-list muted">loading…</div></div>
    </section>
    <aside class="rail right">
      <div class="editor-head"><span id="current-spec">no spec selected</span><button id="save-spec">save</button></div>
      <div id="editor" class="editor"></div>
    </aside>
  </div>
  <footer id="status">SSE: connecting…</footer>
`;

const reportFeed = mustElement<HTMLDivElement>("report-feed");
const specList = mustElement<HTMLDivElement>("spec-list");
const assetList = mustElement<HTMLDivElement>("asset-list");
const renderList = mustElement<HTMLDivElement>("render-list");
const statusLine = mustElement<HTMLElement>("status");
const runtimeState = mustElement<HTMLDivElement>("runtime-state");
const preview = mustElement<HTMLDivElement>("preview");
const playToggle = mustElement<HTMLButtonElement>("play-toggle");
const scrub = mustElement<HTMLInputElement>("scrub");
const beat = mustElement<HTMLSpanElement>("beat");
const frameReadout = mustElement<HTMLSpanElement>("frame-readout");
const currentSpec = mustElement<HTMLSpanElement>("current-spec");
const saveSpec = mustElement<HTMLButtonElement>("save-spec");
const reportsView = mustElement<HTMLElement>("reports-view");
const studioView = mustElement<HTMLDivElement>("studio-view");

let selectedSpecPath = "";
let editor = new EditorView({
  parent: mustElement<HTMLDivElement>("editor"),
  doc: "",
  extensions: [basicSetup, json(), oneDark, EditorView.lineWrapping],
});
let playing = true;
let beatTimer = 0;
let currentSpecObject: SceneSpec | null = null;
let studioInitialized = false;
let currentView: "reports" | "studio" = "reports";

await boot();

async function boot(): Promise<void> {
  await refreshReports();
  wireEvents();
  connectEvents();
}

async function initStudio(): Promise<void> {
  if (studioInitialized) return;
  studioInitialized = true;
  await ensureRuntime();
  await Promise.all([refreshSpecs(), refreshAssets(), refreshRenders()]);
}

function wireEvents(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".nav-btn")) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view as "reports" | "studio" | undefined;
      if (target === undefined || target === currentView) return;
      switchView(target);
    });
  }
  saveSpec.addEventListener("click", saveCurrentSpec);
  playToggle.addEventListener("click", () => {
    setPlayback(!playing);
  });
  scrub.addEventListener("input", () => {
    if (window.SceneRuntime === undefined) return;
    setPlayback(false);
    const frame = Number.parseInt(scrub.value, 10);
    window.SceneRuntime.renderFrame(frame);
    updateFrameReadout(frame);
  });
  window.setInterval(updateBeatIndicator, 50);
}

function setPlayback(nextPlaying: boolean): void {
  if (window.SceneRuntime === undefined) return;
  window.SceneRuntime.stop();
  playing = nextPlaying;
  playToggle.textContent = playing ? "pause" : "play";
  if (playing) window.SceneRuntime.start();
}


function switchView(target: "reports" | "studio"): void {
  currentView = target;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".nav-btn")) {
    btn.classList.toggle("active", btn.dataset.view === target);
  }
  if (target === "reports") {
    reportsView.style.display = "";
    studioView.style.display = "none";
  } else {
    reportsView.style.display = "none";
    studioView.style.display = "grid";
    void initStudio();
    editor.requestMeasure();
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

async function refreshReports(): Promise<void> {
  const reports = await fetchJson<ReportEntry[]>("/api/reports");
  reportFeed.textContent = "";
  if (reports.length === 0) {
    reportFeed.textContent = "no reports yet";
    return;
  }
  for (const report of reports) {
    reportFeed.append(createReportCard(report));
  }
}

function createReportCard(report: ReportEntry): HTMLElement {
  const card = document.createElement("article");
  card.className = "report-card";

  const statusClass = report.status === "shipped" ? "status-shipped"
    : report.status === "partial" ? "status-partial"
    : report.status === "blocked" ? "status-blocked"
    : "";

  let mediaHtml = "";
  for (const mediaPath of report.media) {
    const src = `/report?path=${encodeURIComponent(mediaPath)}`;
    const name = mediaPath.split("/").pop() ?? mediaPath;
    if (/\.png$/i.test(name)) {
      mediaHtml += `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" />`;
    } else if (/\.mp4$/i.test(name)) {
      mediaHtml += `<video src="${escapeHtml(src)}" preload="metadata" controls></video>`;
    }
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
      if (body.classList.contains("open")) {
        body.classList.remove("open");
        toggle.textContent = "expand";
        return;
      }
      if (body.innerHTML.length === 0) {
        const md = await fetchText(`/report?path=${encodeURIComponent(report.path + "/report.md")}`);
        const stripped = stripFrontMatter(md);
        body.innerHTML = renderMarkdown(stripped);
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
// Minimal markdown renderer
// ---------------------------------------------------------------------------

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  const para: string[] = [];

  function flushParagraph(): void {
    if (para.length > 0) {
      out.push(`<p>${para.join(" ")}</p>`);
      para.length = 0;
    }
  }

  function closeList(): void {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    if (inCode) {
      if (line.trimStart().startsWith("```")) {
        inCode = false;
        out.push("</code></pre>");
      } else {
        out.push(escapeHtml(line) + "\n");
      }
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      closeList();
      inCode = true;
      out.push("<pre><code>");
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)/.exec(line);
    if (headingMatch !== null) {
      flushParagraph();
      closeList();
      const level = headingMatch[1]!.length;
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2]!)}</h${level}>`);
      continue;
    }

    const listMatch = /^[-*]\s+(.+)/.exec(line);
    if (listMatch !== null) {
      flushParagraph();
      if (!inList) {
        inList = true;
        out.push("<ul>");
      }
      out.push(`<li>${inlineMarkdown(listMatch[1]!)}</li>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }

    closeList();
    para.push(inlineMarkdown(line));
  }
  flushParagraph();
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("");
}

function inlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  return result;
}

// ---------------------------------------------------------------------------
// Studio — specs, assets, renders, runtime preview
// ---------------------------------------------------------------------------

async function ensureRuntime(): Promise<void> {
  const response = await fetch("/runtime.js", { cache: "no-store" });
  if (!response.ok) {
    runtimeState.textContent = "runtime not built — build packages/scene-renderer/dist/runtime.js for live preview";
    runtimeState.classList.add("error");
    return;
  }
  await loadRuntimeScript();
  runtimeState.textContent = "runtime ready";
  runtimeState.classList.remove("error");
}

async function refreshSpecs(): Promise<void> {
  const specs = await fetchJson<SpecEntry[]>("/api/specs");
  specList.textContent = "";
  if (specs.length === 0) {
    specList.textContent = "no specs yet — create *.scene.json under workflows/scene-lab/specs";
    return;
  }
  for (const spec of specs) {
    const button = document.createElement("button");
    button.className = `row ${spec.path === selectedSpecPath ? "active" : ""}`;
    button.innerHTML = `<span>${escapeHtml(spec.path)}</span><time>${new Date(spec.mtime).toLocaleTimeString()}</time>`;
    button.addEventListener("click", () => loadSpec(spec.path));
    specList.append(button);
  }
  const firstSpec = specs[0];
  if (selectedSpecPath.length === 0 && firstSpec !== undefined) await loadSpec(firstSpec.path);
}

async function loadSpec(path: string): Promise<void> {
  selectedSpecPath = path;
  currentSpec.textContent = path;
  const text = await fetchText(`/api/spec?path=${encodeURIComponent(path)}`);
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  await initPreviewFromEditor();
  await refreshSpecs();
}

async function saveCurrentSpec(): Promise<void> {
  if (selectedSpecPath.length === 0) return;
  const response = await fetch(`/api/spec?path=${encodeURIComponent(selectedSpecPath)}`, { method: "PUT", body: editor.state.doc.toString() });
  if (!response.ok) throw new Error(await response.text());
  statusLine.textContent = `saved ${selectedSpecPath}`;
  await initPreviewFromEditor();
  await refreshSpecs();
}

async function initPreviewFromEditor(): Promise<void> {
  if (window.SceneRuntime === undefined) return;
  let spec: SceneSpec;
  try {
    spec = parseSceneSpec(editor.state.doc.toString());
  } catch (error) {
    runtimeState.textContent = error instanceof Error ? error.message : "invalid JSON";
    runtimeState.classList.add("error");
    return;
  }
  const liveSpec = rewriteAssetsForPreview(spec);
  currentSpecObject = liveSpec;
  preview.textContent = "";
  window.SceneRuntime.stop();
  await window.SceneRuntime.init(liveSpec, { width: liveSpec.width, height: liveSpec.height, fps: liveSpec.fps, assetBaseUrl: "" });
  const canvas = document.querySelector<HTMLCanvasElement>("canvas#scene");
  if (canvas !== null) preview.append(canvas);
  const totalFrames = window.SceneRuntime.durationInFrames();
  scrub.max = String(Math.max(0, totalFrames - 1));
  scrub.value = "0";
  setPlayback(true);
  updateFrameReadout(0);
  runtimeState.textContent = spec.assets?.some((asset) => asset.kind === "videoFrames") === true ? "runtime ready — videoFrames: offline-only" : "runtime ready";
  runtimeState.classList.remove("error");
}

function parseSceneSpec(source: string): SceneSpec {
  const parsed = JSON.parse(source) as JsonValue;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("scene spec must be a JSON object");
  const object = parsed as JsonObject;
  if (typeof object.width !== "number" || typeof object.height !== "number" || typeof object.fps !== "number" || typeof object.durationSeconds !== "number") {
    throw new Error("scene spec needs numeric width, height, fps, durationSeconds");
  }
  return object as SceneSpec;
}

function rewriteAssetsForPreview(spec: SceneSpec): SceneSpec {
  const copy = structuredClone(spec) as SceneSpec;
  const skipped = new Set<string>();
  copy.assets = (copy.assets ?? []).flatMap((asset) => {
    if (asset.kind === "videoFrames") {
      skipped.add(asset.id);
      return [];
    }
    return [{ ...asset, path: `asset?path=${encodeURIComponent(asset.path)}` }];
  });
  if (skipped.size > 0 && Array.isArray(copy.objects)) {
    copy.objects = copy.objects.filter((value) => {
      if (value === null || Array.isArray(value) || typeof value !== "object") return true;
      const asset = (value as JsonObject).asset;
      return typeof asset !== "string" || !skipped.has(asset);
    });
  }
  return copy;
}

async function refreshAssets(): Promise<void> {
  const assets = await fetchJson<AssetEntry[]>("/api/assets");
  assetList.textContent = "";
  if (assets.length === 0) {
    assetList.textContent = "no allowed assets found";
    return;
  }
  for (const asset of assets) {
    const button = document.createElement("button");
    button.className = "row asset";
    button.innerHTML = `<span>${escapeHtml(asset.path)}</span><b>${asset.kind}</b>`;
    button.addEventListener("click", async () => {
      const snippet = JSON.stringify({ id: stem(asset.path), kind: asset.kind === "video" ? "videoFrames" : asset.kind, path: asset.path });
      await navigator.clipboard.writeText(snippet);
      statusLine.textContent = `copied asset snippet: ${asset.path}`;
    });
    assetList.append(button);
  }
}

async function refreshRenders(): Promise<void> {
  const renders = await fetchJson<RenderEntry[]>("/api/renders");
  renderList.textContent = "";
  if (renders.length === 0) {
    renderList.textContent = "no renders yet";
    return;
  }
  for (const render of renders) {
    const card = document.createElement("article");
    card.className = "render-card";
    const manifest = render.manifest === null ? "no manifest" : escapeHtml(JSON.stringify(render.manifest).slice(0, 180));
    card.innerHTML = `<video controls src="/asset?path=${encodeURIComponent(render.path)}"></video><div><b>${escapeHtml(render.path)}</b><small>${manifest}</small></div>`;
    renderList.append(card);
  }
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

function connectEvents(): void {
  const source = new EventSource("/events");
  source.onopen = () => {
    statusLine.textContent = "SSE: connected";
  };
  source.onmessage = async (message) => {
    const event = JSON.parse(message.data) as { type: string; path: string };
    statusLine.textContent = `SSE: ${event.type} ${event.path}`;
    if (event.type === "spec-changed") {
      await refreshSpecs();
      if (event.path === selectedSpecPath) await loadSpec(selectedSpecPath);
    } else if (event.type === "render-added") {
      await refreshRenders();
    } else if (event.type === "report-added") {
      await refreshReports();
      const first = reportFeed.firstElementChild;
      if (first !== null) {
        first.classList.add("flash");
        window.setTimeout(() => first.classList.remove("flash"), 2400);
      }
    }
  };
  source.onerror = () => {
    statusLine.textContent = "SSE: reconnecting…";
  };
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function updateBeatIndicator(): void {
  if (currentSpecObject === null) return;
  const bpm = currentSpecObject.timeline?.bpm ?? 120;
  const secondsPerBeat = 60 / bpm;
  const phase = (performance.now() / 1000) % secondsPerBeat;
  if (phase < 0.08 && performance.now() - beatTimer > 180) {
    beatTimer = performance.now();
    beat.classList.add("flash");
    window.setTimeout(() => beat.classList.remove("flash"), 110);
  }
}

function updateFrameReadout(frame: number): void {
  const max = Number.parseInt(scrub.max, 10);
  frameReadout.textContent = `${frame} / ${max}`;
}

async function loadRuntimeScript(): Promise<void> {
  const prior = document.querySelector<HTMLScriptElement>("script[data-scene-runtime]");
  prior?.remove();
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.sceneRuntime = "true";
    script.src = `/runtime.js?cache=${Date.now()}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("runtime.js loaded but did not execute"));
    document.head.append(script);
  });
}

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

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`#${id} missing`);
  return element as T;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function stem(path: string): string {
  return path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "asset";
}

function css(): string {
  return `
:root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #07070a; color: #e8e8ee; }
* { box-sizing: border-box; }
body { margin: 0; overflow: hidden; }
button { font: inherit; color: inherit; background: #171720; border: 1px solid #333342; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
button:hover, .row.active { border-color: #8ef7ff; color: #8ef7ff; }

/* top nav */
.topnav { height: 34px; display: flex; align-items: center; gap: 2px; padding: 0 12px; background: #0d0d12; border-bottom: 1px solid #242431; }
.brand { color: #ff4fd8; letter-spacing: .08em; text-transform: uppercase; font-weight: 800; margin-right: 16px; font-size: 13px; }
.nav-btn { background: none; border: 1px solid transparent; color: #77778a; text-transform: uppercase; font-size: 11px; letter-spacing: .06em; padding: 4px 10px; border-radius: 4px; }
.nav-btn:hover { color: #e8e8ee; border-color: transparent; }
.nav-btn.active { color: #8ef7ff; background: #171720; border-color: #333342; }

/* views */
.reports-view { height: calc(100vh - 34px - 28px); overflow-y: auto; padding: 24px 32px; }
.studio-view { height: calc(100vh - 34px - 28px); display: grid; grid-template-columns: 300px minmax(420px, 1fr) 430px; gap: 1px; background: #242431; }

/* report feed */
.report-feed { max-width: 820px; }
.report-card { border: 1px solid #282836; background: #111119; border-radius: 10px; padding: 18px 22px; margin-bottom: 14px; transition: border-color 1.8s cubic-bezier(.16,1,.3,1); }
.report-card.flash { border-color: #8ef7ff; box-shadow: 0 0 16px rgba(142,247,255,.12); }
.report-head { margin-bottom: 4px; }
.report-title { font-size: 15px; font-weight: 700; margin: 0 0 6px; color: #e8e8ee; }
.report-meta { display: flex; gap: 12px; align-items: center; font-size: 12px; color: #77778a; }
.report-agent { color: #a7a7b4; }
.status-pill { padding: 2px 8px; border-radius: 999px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
.status-shipped { background: #0a1710; color: #99ffb5; border: 1px solid #1d3d28; }
.status-partial { background: #1b1a0d; color: #ffd666; border: 1px solid #504022; }
.status-blocked { background: #1b0d10; color: #ffb4b4; border: 1px solid #50222c; }
.report-excerpt { color: #a7a7b4; font-size: 13px; line-height: 1.55; margin: 10px 0; }
.report-media { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
.report-media img { max-width: 200px; max-height: 140px; border-radius: 6px; border: 1px solid #282836; object-fit: cover; }
.report-media video { max-width: 240px; max-height: 140px; border-radius: 6px; border: 1px solid #282836; background: #050507; }
.report-toggle { color: #8ef7ff; cursor: pointer; font-size: 11px; background: none; border: none; padding: 2px 0; letter-spacing: .04em; text-transform: uppercase; }
.report-toggle:hover { color: #c4fbff; border: none; }
.report-body { display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid #282836; color: #c8c8d0; font-size: 13px; line-height: 1.6; }
.report-body.open { display: block; }
.report-body h1, .report-body h2, .report-body h3 { color: #e8e8ee; margin: 14px 0 6px; }
.report-body h1 { font-size: 16px; } .report-body h2 { font-size: 14px; } .report-body h3 { font-size: 13px; }
.report-body pre { background: #0a0a12; border: 1px solid #282836; border-radius: 6px; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
.report-body code { font-family: inherit; font-size: 12px; color: #d4d4e8; }
.report-body p code { background: #171720; padding: 1px 5px; border-radius: 3px; }
.report-body ul { padding-left: 20px; margin: 6px 0; }
.report-body li { margin-bottom: 3px; }
.report-body a { color: #8ef7ff; text-decoration: none; }
.report-body a:hover { text-decoration: underline; }
.report-body strong { color: #e8e8ee; }

/* studio (existing layout, moved into view container) */
.rail, .stage-col { background: #0d0d12; min-height: 0; }
.rail { display: flex; flex-direction: column; padding: 12px; gap: 12px; }
.panel { border: 1px solid #282836; background: #111119; border-radius: 10px; min-height: 0; overflow: hidden; }
.panel.grow { flex: 1; }
.panel-title, .editor-head { height: 32px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-bottom: 1px solid #282836; color: #a7a7b4; text-transform: uppercase; font-size: 12px; }
.list, .tree { height: calc(100% - 32px); overflow: auto; padding: 8px; }
.row { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; margin-bottom: 6px; text-align: left; }
.row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row time, .row b, small { color: #77778a; font-size: 11px; font-weight: 500; }
.stage-col { display: grid; grid-template-rows: 32px minmax(0, 1fr) 42px 260px; }
.runtime-state { display: flex; align-items: center; padding: 0 12px; color: #99ffb5; background: #0a1710; border-bottom: 1px solid #1d3d28; }
.runtime-state.error { color: #ffb4b4; background: #1b0d10; border-color: #50222c; }
.preview { position: relative; overflow: hidden; display: grid; place-items: center; background: radial-gradient(circle at 50% 35%, #1c1c2a, #050507 70%); }
.preview canvas { max-width: 100%; max-height: 100%; width: auto !important; height: auto !important; box-shadow: 0 0 40px #000; }
.transport { display: grid; grid-template-columns: 90px 1fr 72px 120px; gap: 10px; align-items: center; padding: 6px 10px; background: #101018; border-top: 1px solid #282836; border-bottom: 1px solid #282836; }
.beat { text-align: center; border: 1px solid #333342; border-radius: 999px; padding: 4px; color: #77778a; }
.beat.flash { color: #07070a; background: #8ef7ff; box-shadow: 0 0 22px #8ef7ff; }
.renders { border: 0; border-radius: 0; }
.render-list { display: flex; gap: 10px; overflow-x: auto; padding: 10px; height: calc(100% - 32px); }
.render-card { width: 220px; flex: 0 0 220px; display: grid; gap: 6px; }
.render-card video { width: 220px; height: 124px; background: #000; }
.render-card b, .render-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.right { padding: 0; }
.editor-head { height: 38px; }
.editor { height: calc(100% - 38px); overflow: hidden; }
.cm-editor { height: 100%; font-size: 13px; }
footer { height: 28px; display: flex; align-items: center; padding: 0 10px; background: #050507; color: #8ef7ff; border-top: 1px solid #242431; font-size: 12px; }
.muted { color: #77778a; font-size: 12px; }
`;
}
