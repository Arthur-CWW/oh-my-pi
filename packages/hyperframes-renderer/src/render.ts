#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface Transition {
  variant: string;
  durationSeconds: number;
  delaySeconds: number;
  easing?: string;
}

interface Layer {
  type: string;
  zIndex: number;
  in: Transition;
  out: Transition;
  props: Record<string, unknown>;
}

interface TimeRange {
  startSeconds: number;
  endSeconds: number;
  startFrame?: number;
  endFrame?: number;
}

interface Beat {
  beatIndex: number;
  timeRange: TimeRange;
  chapterId: string;
  label: string;
  mode: string;
  transition?: { in?: Transition; out?: Transition };
  layers: Layer[];
  caption?: string;
  emphasis?: string;
  motionCue?: string;
  sfx?: string;
}

interface PlateAsset {
  path: string;
  description?: string;
}

interface LayerPlan {
  schemaVersion: string;
  videoId: string;
  title: string;
  durationSeconds: number;
  fps: number;
  sourceManifest?: string;
  ttsManifest?: string;
  palette?: Record<string, string>;
  plateAssets?: Record<string, PlateAsset>;
  beats: Beat[];
}

interface CliArgs {
  layerPlan: string;
  out: string;
  modelId: string;
  workflowId: string;
  render: boolean;
  audio?: string;
}
function usage(): string {
  return `hyperframes-render --layer-plan <path> --out <dir> [options]

Options:
  --layer-plan <path>   Required. Path to the TikTok layer-plan JSON.
  --out <dir>           Required. Output directory for the HyperFrames project.
  --model-id <id>       Optional. Default: manual-baseline.
  --workflow-id <id>    Optional. Default: hyperframes-local-baseline.
  --render              Optional. If set, runs "npx hyperframes render --output recreate.mp4" in the output dir.
  --audio <path>        Optional. Narration audio file (overrides ttsManifest in plan).
`;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n\n${usage()}\n`);
  process.exit(1);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function stringProp(value: unknown): string | undefined {
  return isString(value) ? value : undefined;
}

function numberProp(value: unknown): number | undefined {
  return isNumber(value) ? value : undefined;
}

function getString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (!isString(value)) {
    throw new Error(`Expected "${key}" to be a string`);
  }
  return value;
}

function getNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (!isNumber(value)) {
    throw new Error(`Expected "${key}" to be a number`);
  }
  return value;
}

function getOptionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return isString(value) ? value : undefined;
}

function getOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return isNumber(value) ? value : undefined;
}

function getObject(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = obj[key];
  if (!isObject(value)) {
    throw new Error(`Expected "${key}" to be an object`);
  }
  return value;
}

function getOptionalObject(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = obj[key];
  return isObject(value) ? value : undefined;
}

function getArray(obj: Record<string, unknown>, key: string): unknown[] {
  const value = obj[key];
  if (!isArray(value)) {
    throw new Error(`Expected "${key}" to be an array`);
  }
  return value;
}

function validateTransition(value: unknown): Transition {
  if (!isObject(value)) {
    throw new Error("Transition must be an object");
  }
  return {
    variant: getString(value, "variant"),
    durationSeconds: getNumber(value, "durationSeconds"),
    delaySeconds: getOptionalNumber(value, "delaySeconds") ?? 0,
    easing: getOptionalString(value, "easing"),
  };
}

function validateLayer(value: unknown): Layer {
  if (!isObject(value)) {
    throw new Error("Layer must be an object");
  }
  return {
    type: getString(value, "type"),
    zIndex: getNumber(value, "zIndex"),
    in: validateTransition(value.in),
    out: validateTransition(value.out),
    props: getOptionalObject(value, "props") ?? {},
  };
}

function validateBeat(value: unknown): Beat {
  if (!isObject(value)) {
    throw new Error("Beat must be an object");
  }
  const timeRangeObj = getObject(value, "timeRange");
  const timeRange: TimeRange = {
    startSeconds: getNumber(timeRangeObj, "startSeconds"),
    endSeconds: getNumber(timeRangeObj, "endSeconds"),
    startFrame: getOptionalNumber(timeRangeObj, "startFrame"),
    endFrame: getOptionalNumber(timeRangeObj, "endFrame"),
  };
  const layers = getArray(value, "layers").map(validateLayer);
  const beat: Beat = {
    beatIndex: getNumber(value, "beatIndex"),
    timeRange,
    chapterId: getString(value, "chapterId"),
    label: getString(value, "label"),
    mode: getString(value, "mode"),
    layers,
    caption: getOptionalString(value, "caption"),
    emphasis: getOptionalString(value, "emphasis"),
    motionCue: getOptionalString(value, "motionCue"),
    sfx: getOptionalString(value, "sfx"),
  };
  const transitionObj = getOptionalObject(value, "transition");
  if (transitionObj) {
    beat.transition = {
      in: transitionObj.in ? validateTransition(transitionObj.in) : undefined,
      out: transitionObj.out ? validateTransition(transitionObj.out) : undefined,
    };
  }
  return beat;
}

function validatePalette(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const palette: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (isString(v)) {
      palette[key] = v;
    }
  }
  return palette;
}

function validatePlateAssets(value: unknown): Record<string, PlateAsset> | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const assets: Record<string, PlateAsset> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!isObject(v)) {
      continue;
    }
    assets[key] = {
      path: getString(v, "path"),
      description: getOptionalString(v, "description"),
    };
  }
  return assets;
}

function validateLayerPlan(value: unknown): LayerPlan {
  if (!isObject(value)) {
    throw new Error("Layer plan must be an object");
  }
  const beats = getArray(value, "beats").map(validateBeat);
  return {
    schemaVersion: getString(value, "schemaVersion"),
    videoId: getString(value, "videoId"),
    title: getString(value, "title"),
    durationSeconds: getNumber(value, "durationSeconds"),
    fps: getNumber(value, "fps"),
    sourceManifest: getOptionalString(value, "sourceManifest"),
    ttsManifest: getOptionalString(value, "ttsManifest"),
    palette: validatePalette(value.palette),
    plateAssets: validatePlateAssets(value.plateAssets),
    beats,
  };
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: {
    layerPlan: string | undefined;
    out: string | undefined;
    modelId: string;
    workflowId: string;
    render: boolean;
    audio: string | undefined;
  } = {
    layerPlan: undefined,
    out: undefined,
    modelId: "manual-baseline",
    workflowId: "hyperframes-local-baseline",
    render: false,
    audio: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--layer-plan":
        i++;
        parsed.layerPlan = argv[i];
        break;
      case "--out":
        i++;
        parsed.out = argv[i];
        break;
      case "--model-id":
        i++;
        if (isString(argv[i])) {
          parsed.modelId = argv[i];
        }
        break;
      case "--workflow-id":
        i++;
        if (isString(argv[i])) {
          parsed.workflowId = argv[i];
        }
        break;
      case "--render":
        parsed.render = true;
        break;
      case "--audio":
        i++;
        if (isString(argv[i])) {
          parsed.audio = argv[i];
        }
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!isString(parsed.layerPlan)) {
    throw new Error("--layer-plan is required");
  }
  if (!isString(parsed.out)) {
    throw new Error("--out is required");
  }
  return {
    layerPlan: parsed.layerPlan,
    out: parsed.out,
    modelId: parsed.modelId,
    workflowId: parsed.workflowId,
    render: parsed.render,
    audio: parsed.audio,
  };
}

function readJsonFile(filePath: string): unknown {
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function placeholderColor(props: Record<string, unknown>): string {
  const placeholder = props.placeholder;
  if (isObject(placeholder)) {
    const color = stringProp(placeholder.color);
    if (color) {
      return color;
    }
  }
  return "#1a1a1e";
}

function layerBaseStyle(layer: Layer): string {
  return `position:absolute;left:0;top:0;width:100%;height:100%;z-index:${layer.zIndex};`;
}

function placeholderDiv(layer: Layer): string {
  return `<div class="layer layer-placeholder" data-layer-type="${escapeHtml(layer.type)}" style="${layerBaseStyle(layer)}background:${placeholderColor(layer.props)};display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);font-size:3vh;">${escapeHtml(layer.type)}</div>`;
}

function positionStyle(position: string): string {
  switch (position) {
    case "upperThird":
      return "left:10%;top:5%;";
    case "center":
      return "left:50%;top:50%;transform:translate(-50%,-50%);";
    case "lowerThird":
    default:
      return "left:10%;bottom:5%;";
  }
}

function renderBackgroundLayer(layer: Layer, palette?: Record<string, string>): string {
  const color = stringProp(layer.props.color) ?? palette?.background ?? "#0a0a0c";
  const vignette = layer.props.vignette;
  let overlay = "";
  if (isObject(vignette)) {
    const strength = numberProp(vignette.strength) ?? 0;
    const vColor = stringProp(vignette.color) ?? "#000000";
    if (strength > 0) {
      overlay = `<div class="layer-vignette" style="position:absolute;inset:0;background:radial-gradient(circle,transparent 40%,${escapeHtml(vColor)} 100%);opacity:${strength};pointer-events:none;"></div>`;
    }
  }
  return `<div class="layer layer-background" data-layer-type="BackgroundLayer" style="${layerBaseStyle(layer)}background-color:${escapeHtml(color)};">${overlay}</div>`;
}

function renderGridOverlay(layer: Layer, palette?: Record<string, string>): string {
  const color = stringProp(layer.props.color) ?? palette?.grid_color ?? "rgba(255,255,255,0.08)";
  const opacity = numberProp(layer.props.opacity) ?? 1;
  const divisions = isObject(layer.props.divisions)
    ? {
        x: numberProp(layer.props.divisions.x) ?? 6,
        y: numberProp(layer.props.divisions.y) ?? 10,
      }
    : { x: 6, y: 10 };
  const bg = `linear-gradient(to right,${escapeHtml(color)} 1px,transparent 1px),linear-gradient(to bottom,${escapeHtml(color)} 1px,transparent 1px)`;
  return `<div class="layer layer-grid" data-layer-type="GridOverlay" style="${layerBaseStyle(layer)}background-image:${bg};background-size:${100 / divisions.x}% ${100 / divisions.y}%;opacity:${opacity};pointer-events:none;"></div>`;
}

function renderFlashOverlay(layer: Layer, palette?: Record<string, string>): string {
  const color = stringProp(layer.props.color) ?? palette?.accent ?? "#ff2a2a";
  const intensity = numberProp(layer.props.intensity) ?? 1;
  const blend = stringProp(layer.props.blendMode) ?? "screen";
  return `<div class="layer layer-flash" data-layer-type="FlashOverlay" style="${layerBaseStyle(layer)}background-color:${escapeHtml(color)};opacity:${intensity};mix-blend-mode:${escapeHtml(blend)};pointer-events:none;"></div>`;
}
const ASSET_PROP_KEYS = new Set(["src", "plateUrl", "fromPlate", "toPlate", "imageUrl", "videoUrl", "clipUrl", "placeholderImage", "placeholderImagePath", "placeholderMediaPath"]);


function resolveAssetPath(value: string, baseDir: string): string | null {
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return null;
  }
  const direct = path.resolve(value);
  if (fs.existsSync(direct)) {
    return direct;
  }
  const fromLayerPlan = path.resolve(baseDir, value);
  return fs.existsSync(fromLayerPlan) ? fromLayerPlan : null;
}

function rewriteLayerPlanAssets(plan: LayerPlan, options: { layerPlanPath: string; outDir: string }): LayerPlan {
  const layerPlanDir = path.dirname(path.resolve(options.layerPlanPath));
  const assetDir = path.join(options.outDir, "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  const copied = new Map<string, string>();
  let assetIndex = 0;

  const rewriteValue = (value: unknown): unknown => {
    if (!isString(value)) {
      return value;
    }
    const resolved = resolveAssetPath(value, layerPlanDir);
    if (!resolved) {
      return value;
    }
    const existing = copied.get(resolved);
    if (existing) {
      return existing;
    }
    const ext = path.extname(resolved) || ".asset";
    const rel = `assets/asset-${assetIndex}${ext}`;
    assetIndex += 1;
    fs.copyFileSync(resolved, path.join(options.outDir, rel));
    copied.set(resolved, rel);
    return rel;
  };

  return {
    ...plan,
    beats: plan.beats.map((beat) => ({
      ...beat,
      layers: beat.layers.map((layer) => {
        const props: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(layer.props)) {
          props[key] = ASSET_PROP_KEYS.has(key) ? rewriteValue(value) : value;
        }
        return { ...layer, props };
      }),
    })),
  };
}


function renderPlateLayer(layer: Layer): string {
  const src = stringProp(layer.props.src) ?? stringProp(layer.props.plateUrl);
  const fit = stringProp(layer.props.fit) ?? "cover";
  const opacity = numberProp(layer.props.opacity) ?? 1;
  const desaturate = numberProp(layer.props.desaturate) ?? 0;
  const blur = numberProp(layer.props.blur) ?? 0;
  const filters: string[] = [];
  if (desaturate > 0) {
    filters.push(`grayscale(${desaturate})`);
  }
  if (blur > 0) {
    filters.push(`blur(${blur}px)`);
  }
  const filterStyle = filters.length > 0 ? `filter:${filters.join(" ")};` : "";
  if (src) {
    return `<img class="layer layer-plate" data-layer-type="PlateLayer" src="${escapeHtml(src)}" style="${layerBaseStyle(layer)}object-fit:${escapeHtml(fit)};opacity:${opacity};${filterStyle}" alt="" />`;
  }
  return placeholderDiv(layer);
}

function renderClipLayer(layer: Layer): string {
  const src =
    stringProp(layer.props.src) ??
    stringProp(layer.props.videoUrl) ??
    stringProp(layer.props.clipUrl);
  const placeholder =
    stringProp(layer.props.placeholderImage) ??
    stringProp(layer.props.placeholderImagePath) ??
    stringProp(layer.props.placeholderMediaPath);
  const missing = layer.props.missingLiveMedia === true || layer.props.mediaAvailable === false || !src;
  const generatedClipId = stringProp(layer.props.generatedClipId) ?? stringProp(layer.props.clipId) ?? "generated clip";
  const reason = stringProp(layer.props.missingLiveMediaReason) ?? stringProp(layer.props.plannedArtifactPath) ?? "missing local MP4";
  if (!missing && src) {
    return `<video class="layer layer-clip" src="${escapeHtml(src)}" muted playsinline style="${layerBaseStyle(layer)}object-fit:cover;background:#02040a;"></video>`;
  }
  const base = placeholder
    ? `<img src="${escapeHtml(placeholder)}" alt="" style="${layerBaseStyle(layer)}object-fit:cover;opacity:0.74;" />`
    : placeholderDiv({ ...layer, type: "ClipLayerPlaceholder" });
  return `${base}<div class="layer layer-clip-placeholder-label" style="${layerBaseStyle(layer)}display:flex;align-items:flex-end;justify-content:center;padding:0 6% 9%;box-sizing:border-box;color:rgba(236,246,255,0.92);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;"><div style="width:100%;padding:24px;border:1px solid rgba(183,215,255,0.28);border-radius:24px;background:rgba(3,7,16,0.68);box-shadow:0 0 50px rgba(120,170,255,0.16);"><div style="font-size:26px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">Generated clip placeholder</div><div style="margin-top:10px;font-size:20px;">${escapeHtml(generatedClipId)}</div><div style="margin-top:8px;font-size:16px;color:rgba(236,246,255,0.62);">${escapeHtml(reason)}</div></div></div>`;
}

function renderSplitRevealLayer(layer: Layer): string {
  const fromPlate = stringProp(layer.props.fromPlate);
  const toPlate = stringProp(layer.props.toPlate);
  if (fromPlate && toPlate) {
    return `<div class="layer layer-split-reveal" data-layer-type="SplitRevealLayer" style="${layerBaseStyle(layer)}display:flex;"><img class="split-from" src="${escapeHtml(fromPlate)}" style="width:50%;height:100%;object-fit:cover;" alt="" /><img class="split-to" src="${escapeHtml(toPlate)}" style="width:50%;height:100%;object-fit:cover;" alt="" /></div>`;
  }
  return placeholderDiv(layer);
}

function renderTypographyLayer(layer: Layer): string {
  const lines = isArray(layer.props.lines) ? layer.props.lines : [];
  const align = stringProp(layer.props.align) ?? "center";
  const position = isObject(layer.props.position)
    ? {
        x: numberProp(layer.props.position.x) ?? 0.5,
        y: numberProp(layer.props.position.y) ?? 0.5,
      }
    : { x: 0.5, y: 0.5 };
  const fontFamily = stringProp(layer.props.fontFamily) ?? "sans-serif";
  const maxWidth = numberProp(layer.props.maxWidth) ?? 0.9;
  const lineHeight = numberProp(layer.props.lineHeight) ?? 1.25;
  const textShadow = isObject(layer.props.textShadow)
    ? `${numberProp(layer.props.textShadow.x) ?? 0}px ${numberProp(layer.props.textShadow.y) ?? 0}px ${numberProp(layer.props.textShadow.blur) ?? 0}px ${stringProp(layer.props.textShadow.color) ?? "rgba(0,0,0,0.8)"}`
    : "none";
  const lineHtml = lines
    .map((line) => {
      if (!isObject(line)) {
        return "";
      }
      const variant = stringProp(line.variant) ?? "caption";
      const color = stringProp(line.color) ?? "#ffffff";
      const text = stringProp(line.text) ?? "";
      return `<div class="type-line type-${escapeHtml(variant)}" style="color:${escapeHtml(color)};">${escapeHtml(text)}</div>`;
    })
    .join("");
  const xTransform = align === "left" ? "0" : align === "right" ? "-100%" : "-50%";
  return `<div class="layer layer-typography" data-layer-type="TypographyLayer" style="position:absolute;left:${position.x * 100}%;top:${position.y * 100}%;width:${maxWidth * 100}%;transform:translate(${xTransform},-50%);text-align:${escapeHtml(align)};font-family:${escapeHtml(fontFamily)};line-height:${lineHeight};text-shadow:${textShadow};z-index:${layer.zIndex};">${lineHtml}</div>`;
}

function renderCounterLayer(layer: Layer, palette?: Record<string, string>): string {
  const value = numberProp(layer.props.value) ?? 0;
  const prefix = stringProp(layer.props.prefix) ?? "";
  const suffix = stringProp(layer.props.suffix) ?? "";
  const label = stringProp(layer.props.label) ?? "";
  const color = stringProp(layer.props.color) ?? palette?.accent ?? "#ff2a2a";
  return `<div class="layer layer-counter" data-layer-type="CounterLayer" style="position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);text-align:center;color:${escapeHtml(color)};z-index:${layer.zIndex};"><div class="counter-value" style="font-size:8vh;font-weight:800;">${escapeHtml(prefix)}${value}${escapeHtml(suffix)}</div><div class="counter-label" style="font-size:2.5vh;opacity:0.8;">${escapeHtml(label)}</div></div>`;
}

function renderDocumentLayer(layer: Layer): string {
  const title = stringProp(layer.props.title) ?? "";
  const body = isArray(layer.props.body)
    ? layer.props.body
        .map((b) => (isString(b) ? escapeHtml(b) : ""))
        .join("<br/>")
    : "";
  return `<div class="layer layer-document" data-layer-type="DocumentLayer" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:80%;padding:4vh;background:rgba(245,245,240,0.95);color:#111;z-index:${layer.zIndex};"><h2 style="margin-top:0;">${escapeHtml(title)}</h2><p style="margin-bottom:0;">${body}</p></div>`;
}

function renderDiagramLayer(layer: Layer, palette?: Record<string, string>): string {
  const data = isArray(layer.props.data) ? layer.props.data : [];
  const colors = isArray(layer.props.colors)
    ? layer.props.colors.map((c) => (isString(c) ? c : "#ffffff"))
    : [];
  const bars = data
    .map((datum, index) => {
      if (!isObject(datum)) {
        return "";
      }
      const label = stringProp(datum.label) ?? "";
      const rawValue = numberProp(datum.value) ?? 0;
      const value = Math.max(0, Math.min(1, rawValue));
      const color = colors[index % colors.length] ?? palette?.accent ?? "#ff2a2a";
      return `<div class="diagram-bar" style="display:flex;align-items:center;margin:0.5vh 0;"><div class="bar" style="width:${value * 60}%;height:2vh;background:${escapeHtml(color)};margin-right:2%;"></div><div class="bar-label" style="font-size:2vh;color:#fff;">${escapeHtml(label)}</div></div>`;
    })
    .join("");
  return `<div class="layer layer-diagram" data-layer-type="DiagramLayer" style="position:absolute;left:10%;top:30%;width:80%;z-index:${layer.zIndex};">${bars}</div>`;
}

function renderMapLayer(layer: Layer, palette?: Record<string, string>): string {
  const baseColor = stringProp(layer.props.baseColor) ?? "rgba(255,255,255,0.12)";
  const highlightColor = stringProp(layer.props.highlightColor) ?? palette?.accent ?? "#ff2a2a";
  const markers = isArray(layer.props.markers) ? layer.props.markers : [];
  const markerHtml = markers
    .map((marker) => {
      if (!isObject(marker)) {
        return "";
      }
      const x = numberProp(marker.x) ?? 0;
      const y = numberProp(marker.y) ?? 0;
      const label = stringProp(marker.label) ?? "";
      return `<div class="map-marker" style="position:absolute;left:${x * 100}%;top:${y * 100}%;transform:translate(-50%,-50%);text-align:center;"><div style="width:1.5vh;height:1.5vh;background:${escapeHtml(highlightColor)};border-radius:50%;margin:0 auto;"></div><div style="font-size:1.8vh;color:#fff;white-space:nowrap;">${escapeHtml(label)}</div></div>`;
    })
    .join("");
  return `<div class="layer layer-map" data-layer-type="MapLayer" style="${layerBaseStyle(layer)}background:${escapeHtml(baseColor)};">${markerHtml}</div>`;
}

function renderTimelineLayer(layer: Layer, palette?: Record<string, string>): string {
  const orientation = stringProp(layer.props.orientation) ?? "horizontal";
  const events = isArray(layer.props.events) ? layer.props.events : [];
  const activeIndex = numberProp(layer.props.activeIndex) ?? 0;
  const connectorColor = stringProp(layer.props.connectorColor) ?? "rgba(255,255,255,0.3)";
  const isVertical = orientation === "vertical";
  const items = events
    .map((event, index) => {
      if (!isObject(event)) {
        return "";
      }
      const year = stringProp(event.year) ?? String(numberProp(event.year) ?? "");
      const label = stringProp(event.label) ?? "";
      const active = index === activeIndex;
      const color = active ? palette?.accent ?? "#ff2a2a" : "#ffffff";
      return `<div class="timeline-event" style="margin:${isVertical ? "1vh 0" : "0 2vh"};text-align:center;color:${escapeHtml(color)};"><div class="timeline-year" style="font-weight:800;">${escapeHtml(year)}</div><div class="timeline-label" style="font-size:2vh;">${escapeHtml(label)}</div></div>`;
    })
    .join("");
  const borderProp = isVertical ? "border-left" : "border-top";
  return `<div class="layer layer-timeline" data-layer-type="TimelineLayer" style="position:absolute;left:5%;top:40%;width:90%;display:flex;flex-direction:${isVertical ? "column" : "row"};justify-content:space-around;align-items:center;${borderProp}:2px solid ${escapeHtml(connectorColor)};padding-${isVertical ? "left" : "top"}:2vh;z-index:${layer.zIndex};">${items}</div>`;
}

function renderPresenterLayer(layer: Layer): string {
  const src = stringProp(layer.props.src) ?? stringProp(layer.props.imageUrl);
  const position = stringProp(layer.props.position) ?? "lowerThird";
  const mask = stringProp(layer.props.mask) ?? "roundedRect";
  const scale = numberProp(layer.props.scale) ?? 0.6;
  const radius = mask === "roundedRect" ? "2vh" : "50%";
  const style = `position:absolute;${positionStyle(position)}width:${scale * 100}%;border-radius:${radius};object-fit:contain;z-index:${layer.zIndex};`;
  if (src) {
    return `<img class="layer layer-presenter" data-layer-type="PresenterLayer" src="${escapeHtml(src)}" style="${style}" alt="" />`;
  }
  return `<div class="layer layer-presenter layer-presenter-placeholder" data-layer-type="PresenterLayer" style="${style}aspect-ratio:3/4;background:${placeholderColor(layer.props)};display:flex;align-items:center;justify-content:center;font-size:2vh;color:rgba(255,255,255,0.4);">Presenter</div>`;
}
function renderLayer(layer: Layer, palette?: Record<string, string>, layerId?: string): string {
  const html = (() => {
    switch (layer.type) {
      case "BackgroundLayer":
        return renderBackgroundLayer(layer, palette);
      case "GridOverlay":
        return renderGridOverlay(layer, palette);
      case "FlashOverlay":
        return renderFlashOverlay(layer, palette);
      case "PlateLayer":
        return renderPlateLayer(layer);
      case "ClipLayer":
        return renderClipLayer(layer);
      case "SplitRevealLayer":
        return renderSplitRevealLayer(layer);
      case "TypographyLayer":
        return renderTypographyLayer(layer);
      case "CounterLayer":
        return renderCounterLayer(layer, palette);
      case "DocumentLayer":
        return renderDocumentLayer(layer);
      case "DiagramLayer":
        return renderDiagramLayer(layer, palette);
      case "MapLayer":
        return renderMapLayer(layer, palette);
      case "TimelineLayer":
        return renderTimelineLayer(layer, palette);
      case "PresenterLayer":
        return renderPresenterLayer(layer);
      default:
        return placeholderDiv(layer);
    }
  })();
  if (layerId) {
    return html.replace(/class="layer/, `id="${escapeHtml(layerId)}" data-layer-id="${escapeHtml(layerId)}" class="layer`);
  }
  return html;
}

function renderBeatClip(beat: Beat, palette?: Record<string, string>): string {
  const start = beat.timeRange.startSeconds.toFixed(3);
  const duration = (beat.timeRange.endSeconds - beat.timeRange.startSeconds).toFixed(3);
  const layers = [...beat.layers]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer, idx) => renderLayer(layer, palette, `layer-${beat.beatIndex}-${idx}-${layer.type}`))
    .join("\n          ");
  return `<div class="clip" id="clip-${beat.beatIndex}" data-clip-id="clip-${beat.beatIndex}" data-beat-index="${beat.beatIndex}" data-start="${start}" data-duration="${duration}" data-chapter="${escapeHtml(beat.chapterId)}">
          ${layers}
        </div>`;
}

function generateIndexHtml(plan: LayerPlan, opts: { workflowId: string; modelId: string; compositionId: string }): string {
  const clips = plan.beats.map((beat) => renderBeatClip(beat, plan.palette)).join("\n        ");
  const background = plan.palette?.background ?? "#0a0a0c";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(plan.title)}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: ${escapeHtml(background)}; overflow: hidden; }
    #composition { position: relative; width: 1080px; height: 1920px; margin: 0 auto; background: ${escapeHtml(background)}; overflow: hidden; }
    .clip { position: absolute; inset: 0; display: none; }
    .clip.active { display: block; }
    .layer { pointer-events: none; }
    .type-title { font-size: 6vh; font-weight: 800; }
    .type-caption { font-size: 3.5vh; font-weight: 600; }
    .type-line + .type-line { margin-top: 0.5em; }
  </style>
</head>
<body>
  <div id="composition" data-composition-id="${escapeHtml(opts.compositionId)}" data-start="0" data-width="1080" data-height="1920" data-fps="${plan.fps}" data-duration="${plan.durationSeconds.toFixed(3)}" data-workflow-id="${escapeHtml(opts.workflowId)}" data-model-id="${escapeHtml(opts.modelId)}">
    ${clips}
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script>
    (function () {
      var root = document.getElementById('composition');
      if (!root) return;
      var compositionId = root.dataset.compositionId;
      var clips = Array.from(root.querySelectorAll('.clip'));
      if (typeof gsap !== 'undefined') {
        var tl = gsap.timeline({ paused: true });
        clips.forEach(function (clip) {
          var start = parseFloat(clip.dataset.start || '0');
          var duration = parseFloat(clip.dataset.duration || '0');
          tl.set(clip, { display: 'block', opacity: 1 }, start);
          tl.set(clip, { display: 'none', opacity: 0 }, start + duration);
        });
        window.__timelines = window.__timelines || {};
        window.__timelines["${escapeHtml(opts.compositionId)}"] = tl;
        window.__hyperframesTimeline = tl;
        tl.seek(0);
      }
      window.__hyperframesComposition = root;
      window.__hyperframesClips = clips;
    })();
  </script>
</body>
</html>`;
}

function generateHyperframesJson(plan: LayerPlan, opts: { workflowId: string; modelId: string; compositionId: string }): unknown {
  const totalLayers = plan.beats.reduce((sum, beat) => sum + beat.layers.length, 0);
  return {
    schemaVersion: "hyperframes.project.v1",
    project: {
      name: plan.title,
      compositionId: opts.compositionId,
      width: 1080,
      height: 1920,
      fps: plan.fps,
      durationSeconds: plan.durationSeconds,
      totalBeats: plan.beats.length,
      totalLayers,
    },
    workflowId: opts.workflowId,
    modelId: opts.modelId,
    textPolicy: "post-layer",
    source: {
      videoId: plan.videoId,
      title: plan.title,
    },
    clips: plan.beats.map((beat) => ({
      beatIndex: beat.beatIndex,
      chapterId: beat.chapterId,
      label: beat.label,
      startSeconds: beat.timeRange.startSeconds,
      endSeconds: beat.timeRange.endSeconds,
      layers: beat.layers.map((layer) => ({
        type: layer.type,
        zIndex: layer.zIndex,
        media:
          stringProp(layer.props.src) ??
          stringProp(layer.props.videoUrl) ??
          stringProp(layer.props.clipUrl) ??
          stringProp(layer.props.placeholderImage) ??
          stringProp(layer.props.placeholderImagePath) ??
          stringProp(layer.props.placeholderMediaPath) ??
          stringProp(layer.props.fromPlate) ??
          stringProp(layer.props.toPlate) ??
          stringProp(layer.props.imageUrl) ??
          null,
      })),
    })),
    renderCommandHint: "npx hyperframes render --output recreate.mp4",
    commands: {
      render: "npx hyperframes render --output recreate.mp4",
      preview: "npx hyperframes preview",
    },
  };
}

function generateHyperframePlanJson(plan: LayerPlan, opts: { workflowId: string; modelId: string }, generatedAt: string): unknown {
  return {
    ...plan,
    schemaVersion: "tiktok-recreate.hyperframe-plan.v1",
    textPolicy: "post-layer",
    renderer: {
      name: "hyperframes",
      workflowId: opts.workflowId,
      modelId: opts.modelId,
      generatedAt,
    },
  };
}

function generateManifestJson(
  plan: LayerPlan,
  opts: { workflowId: string; modelId: string },
  generatedAt: string,
  renderRan: boolean,
  renderExitStatus: number | null,
  renderError: string | null,
  audioAttached: boolean,
  audioSource: string | null,
  audioMuxError: string | null
): unknown {
  return {
    schemaVersion: "tiktok-recreate.hyperframes-render.v1",
    sampleId: plan.videoId,
    title: plan.title,
    generatedAt,
    workflowId: opts.workflowId,
    modelId: opts.modelId,
    renderer: "hyperframes",
    textPolicy: "post-layer",
    paths: {
      indexHtml: "index.html",
      hyperframesJson: "hyperframes.json",
      hyperframePlanJson: "hyperframe-plan.json",
      manifestJson: "manifest.json",
      mp4: "recreate.mp4",
      frame003: "frame-003.png",
      frame030: "frame-030.png",
      assetsDir: "assets",
      ...(audioSource ? { audioPath: audioSource } : {}),
      audioAttached,
    },
    commands: {
      render: "npx hyperframes render --output recreate.mp4",
    },
    renderRan,
    renderExitStatus,
    renderError,
    ...(audioSource ? { audioSource } : {}),
    ...(audioMuxError ? { audioMuxError } : {}),
  };
}

function resolveNarrationPath(
  ttsManifest: string | undefined,
  explicitAudio: string | undefined,
  planDir: string
): string | undefined {
  if (explicitAudio) {
    const direct = path.resolve(explicitAudio);
    return fs.existsSync(direct) ? direct : undefined;
  }
  if (ttsManifest) {
    const manifestPath = fs.existsSync(path.resolve(ttsManifest))
      ? path.resolve(ttsManifest)
      : path.resolve(planDir, ttsManifest);
    if (!fs.existsSync(manifestPath)) return undefined;
    const manifestObj = readJsonFile(manifestPath);
    if (manifestObj && typeof manifestObj === "object" && !Array.isArray(manifestObj)) {
      const audioPaths = (manifestObj as Record<string, unknown>)["audioPaths"];
      if (audioPaths && typeof audioPaths === "object" && !Array.isArray(audioPaths)) {
        const mp3 = (audioPaths as Record<string, unknown>)["mp3"];
        if (typeof mp3 === "string") {
          const manifestDir = path.dirname(manifestPath);
          const audioPath = path.isAbsolute(mp3) ? mp3 : path.resolve(manifestDir, mp3);
          return fs.existsSync(audioPath) ? audioPath : undefined;
        }
      }
    }
  }
  return undefined;
}
async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  let plan: LayerPlan;
  try {
    plan = validateLayerPlan(readJsonFile(args.layerPlan));
  } catch (err) {
    fail(`Failed to read layer plan: ${err instanceof Error ? err.message : String(err)}`);
  }

  fs.mkdirSync(args.out, { recursive: true });
  plan = rewriteLayerPlanAssets(plan, { layerPlanPath: args.layerPlan, outDir: args.out });

  const compositionId = `hyperframes-${plan.videoId}-${args.workflowId}`;
  const generatedAt = new Date().toISOString();

  const html = generateIndexHtml(plan, {
    workflowId: args.workflowId,
    modelId: args.modelId,
    compositionId,
  });
  fs.writeFileSync(path.join(args.out, "index.html"), html, "utf8");

  const hyperframesJson = generateHyperframesJson(plan, {
    workflowId: args.workflowId,
    modelId: args.modelId,
    compositionId,
  });
  fs.writeFileSync(path.join(args.out, "hyperframes.json"), JSON.stringify(hyperframesJson, null, 2), "utf8");

  const hyperframePlanJson = generateHyperframePlanJson(plan, {
    workflowId: args.workflowId,
    modelId: args.modelId,
  }, generatedAt);
  fs.writeFileSync(path.join(args.out, "hyperframe-plan.json"), JSON.stringify(hyperframePlanJson, null, 2), "utf8");

  let renderRan = false;
  let renderExitStatus: number | null = null;
  let renderError: string | null = null;
  if (args.render) {
    renderRan = true;
    const result = spawnSync("npx", ["hyperframes", "render", "--output", "recreate.mp4"], {
      cwd: args.out,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    renderExitStatus = result.status ?? (result.signal ? 1 : null);
    if (result.error) {
      renderError = String(result.error);
    } else if (renderExitStatus !== 0 && renderExitStatus !== null) {
      const stderr = result.stderr?.toString("utf8") ?? "";
      renderError = stderr.trim() || `hyperframes render exited with status ${renderExitStatus}`;
    }
  }

  let audioAttached = false;
  let audioSource: string | null = null;
  let audioMuxError: string | null = null;
  const narrationPath = resolveNarrationPath(
    plan.ttsManifest,
    args.audio,
    path.dirname(path.resolve(args.layerPlan))
  );
  if (
    narrationPath &&
    fs.existsSync(narrationPath) &&
    renderRan &&
    renderExitStatus === 0 &&
    !renderError
  ) {
    audioSource = narrationPath;
    const ffCheck = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    if (ffCheck.status === 0) {
      const mp4 = path.join(args.out, "recreate.mp4");
      const tmp = path.join(args.out, "recreate.tmp.mp4");
      const mux = spawnSync("ffmpeg", [
        "-y", "-i", mp4, "-i", narrationPath,
        "-c:v", "copy", "-c:a", "aac", "-shortest",
        tmp,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      if (mux.status === 0) {
        fs.renameSync(tmp, mp4);
        audioAttached = true;
      } else {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        audioMuxError = mux.stderr?.toString("utf8")?.trim() || `ffmpeg exited with status ${mux.status}`;
        if (!audioMuxError) audioMuxError = "ffmpeg mux failed";
      }
    } else {
      audioMuxError = "ffmpeg not available";
    }
  }

  const manifestJson = generateManifestJson(
    plan,
    { workflowId: args.workflowId, modelId: args.modelId },
    generatedAt,
    renderRan,
    renderExitStatus,
    renderError,
    audioAttached,
    audioSource,
    audioMuxError
  );
  fs.writeFileSync(path.join(args.out, "manifest.json"), JSON.stringify(manifestJson, null, 2), "utf8");

  process.stdout.write(`HyperFrames project written to ${path.resolve(args.out)}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
