// ---------------------------------------------------------------------------
// Pure view-model: types, selection, spec mutations, debounce queue
// No DOM dependencies — testable with bun test
// ---------------------------------------------------------------------------

// -- JSON utility types --
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// -- Scene spec types --

export interface SceneAsset {
  id: string;
  kind: string;
  path: string;
}

export interface SceneTimeline {
  bpm?: number;
  beats?: number[];
}

export interface KeyframeEntry {
  t: number;
  v: number;
  ease?: string;
}

export interface OscParams {
  amp: number;
  freqBeats: number;
  phasePerClone: number;
  center: number;
}

export interface BeatParams {
  every: number;
  from: number;
  to: number;
  attack: number;
  decay: number;
}

export interface TrackSpec {
  prop: string;
  mode: "keyframes" | "osc" | "beat";
  keyframes?: KeyframeEntry[];
  osc?: OscParams;
  beat?: BeatParams;
}

export interface CloneSpec {
  count: number;
  layout: "grid" | "orbit" | "spiral" | "line" | "scatter";
  spacing: number;
  radius: number;
  seed: number;
  stagger: number;
}

export interface ObjectSpec {
  id: string;
  kind: "plane" | "sprite" | "text" | "group";
  asset?: string;
  text?: string;
  font?: string;
  color?: string;
  size: [number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  opacity: number;
  clone?: CloneSpec;
  tracks?: TrackSpec[];
}

export interface BeatReactive {
  param: string;
  every: number;
  amount: number;
  decay: number;
}

export interface PostPassSpec {
  pass: string;
  params: Record<string, number>;
  beatReactive?: BeatReactive;
}

export interface CameraSpec {
  fov: number;
  position: [number, number, number];
  lookAt: [number, number, number];
  tracks?: TrackSpec[];
}

export interface AudioSpec {
  asset?: string;
  offsetSeconds?: number;
  gainDb?: number;
}

export interface SceneSpec {
  schemaVersion?: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  background?: string;
  timeline?: SceneTimeline;
  assets?: SceneAsset[];
  camera?: CameraSpec;
  objects?: ObjectSpec[];
  post?: PostPassSpec[];
  audio?: AudioSpec;
}

// -- Selection model (discriminated union) --

export type Selection =
  | { type: "none" }
  | { type: "camera" }
  | { type: "timeline" }
  | { type: "object"; id: string }
  | { type: "pass"; index: number }
  | { type: "asset"; id: string }
  | { type: "audio" };

export function selectionKey(sel: Selection): string {
  switch (sel.type) {
    case "none": return "none";
    case "camera": return "camera";
    case "timeline": return "timeline";
    case "object": return `object:${sel.id}`;
    case "pass": return `pass:${sel.index}`;
    case "asset": return `asset:${sel.id}`;
    case "audio": return "audio";
  }
}

// -- Server types --

export interface SpecEntry {
  path: string;
  mtime: string;
  bytes: number;
}

export interface AssetEntry {
  path: string;
  kind: string;
  bytes: number;
}

export interface RenderEntry {
  path: string;
  mtime: string;
  bytes: number;
  manifest: JsonValue | null;
}

export interface ReportEntry {
  path: string;
  title: string;
  date: string;
  agent: string;
  status: string;
  excerpt: string;
  media: string[];
  mtime: string;
}

export interface SceneRuntimeGlobal {
  init(spec: JsonValue, opts: { width: number; height: number; fps: number; assetBaseUrl: string }): Promise<void>;
  renderFrame(frame: number): void;
  durationInFrames(): number;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    SceneRuntime?: SceneRuntimeGlobal;
  }
}

// ---------------------------------------------------------------------------
// Ensure helpers — lazily create optional arrays/objects
// ---------------------------------------------------------------------------

export function ensureCamera(spec: SceneSpec): CameraSpec {
  if (spec.camera === undefined) {
    spec.camera = { fov: 46, position: [0, 0, 7], lookAt: [0, 0, 0], tracks: [] };
  }
  return spec.camera;
}

export function ensureTimeline(spec: SceneSpec): SceneTimeline {
  if (spec.timeline === undefined) spec.timeline = { bpm: 120 };
  return spec.timeline;
}

export function ensureObjects(spec: SceneSpec): ObjectSpec[] {
  if (spec.objects === undefined) spec.objects = [];
  return spec.objects;
}

export function ensurePost(spec: SceneSpec): PostPassSpec[] {
  if (spec.post === undefined) spec.post = [];
  return spec.post;
}

export function ensureAssets(spec: SceneSpec): SceneAsset[] {
  if (spec.assets === undefined) spec.assets = [];
  return spec.assets;
}

export function ensureAudio(spec: SceneSpec): AudioSpec {
  if (spec.audio === undefined) spec.audio = {};
  return spec.audio;
}

// ---------------------------------------------------------------------------
// Find helpers
// ---------------------------------------------------------------------------

export function findObject(spec: SceneSpec, id: string): ObjectSpec | undefined {
  return spec.objects?.find((o) => o.id === id);
}

export function findObjectIndex(spec: SceneSpec, id: string): number {
  return spec.objects?.findIndex((o) => o.id === id) ?? -1;
}

// ---------------------------------------------------------------------------
// Nested property access — handles dotted paths like "position.0", "clone.count"
// ---------------------------------------------------------------------------

export function setNested(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    let next = current[key];
    if (next === undefined || next === null || typeof next !== "object") {
      next = {};
      current[key] = next;
    }
    current = next as Record<string, unknown>;
  }
  const lastKey = parts.at(-1)!;
  if (Array.isArray(current) && /^\d+$/.test(lastKey)) {
    current[Number(lastKey)] = value;
  } else {
    current[lastKey] = value;
  }
}

export function getNested(obj: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split(".");
  let current: unknown = obj;
  for (const key of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      current = current[Number(key)];
    } else {
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Object mutations (all in-place, return spec for chaining)
// ---------------------------------------------------------------------------

export function setObjectProp(spec: SceneSpec, id: string, prop: string, value: unknown): SceneSpec {
  const obj = findObject(spec, id);
  if (obj === undefined) return spec;
  setNested(obj as unknown as Record<string, unknown>, prop, value);
  return spec;
}

const DEFAULT_OBJECTS: Record<string, Partial<ObjectSpec>> = {
  plane: { kind: "plane", size: [1.5, 2], position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, opacity: 1 },
  sprite: { kind: "sprite", size: [1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, opacity: 1 },
  text: { kind: "text", text: "TEXT", font: "900 72px Impact, sans-serif", color: "#ffffff", size: [4, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, opacity: 1 },
};

export function addObject(spec: SceneSpec, kind: "plane" | "sprite" | "text", assetId?: string): ObjectSpec {
  const defaults = DEFAULT_OBJECTS[kind]!;
  const objects = ensureObjects(spec);
  const existingIds = new Set(objects.map((o) => o.id));
  let n = 1;
  while (existingIds.has(`${kind}-${n}`)) n++;
  const id = `${kind}-${n}`;

  const obj: ObjectSpec = {
    id,
    kind,
    size: [...(defaults.size!)] as [number, number],
    position: [...(defaults.position!)] as [number, number, number],
    rotation: [...(defaults.rotation!)] as [number, number, number],
    scale: defaults.scale!,
    opacity: defaults.opacity!,
    tracks: [],
  };
  if (kind === "text") {
    obj.text = defaults.text!;
    obj.font = defaults.font!;
    obj.color = defaults.color!;
  }
  if (assetId !== undefined) obj.asset = assetId;
  objects.push(obj);
  return obj;
}

export function removeObject(spec: SceneSpec, id: string): SceneSpec {
  if (spec.objects !== undefined) {
    spec.objects = spec.objects.filter((o) => o.id !== id);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Camera mutations
// ---------------------------------------------------------------------------

export function setCameraProp(spec: SceneSpec, prop: string, value: unknown): SceneSpec {
  const cam = ensureCamera(spec);
  setNested(cam as unknown as Record<string, unknown>, prop, value);
  return spec;
}

// ---------------------------------------------------------------------------
// Timeline / audio / scene-level mutations
// ---------------------------------------------------------------------------

export function setTimelineProp(spec: SceneSpec, prop: string, value: unknown): SceneSpec {
  const tl = ensureTimeline(spec);
  setNested(tl as unknown as Record<string, unknown>, prop, value);
  return spec;
}

export function setAudioProp(spec: SceneSpec, prop: string, value: unknown): SceneSpec {
  const audio = ensureAudio(spec);
  setNested(audio as unknown as Record<string, unknown>, prop, value);
  return spec;
}

export function setSceneProp(spec: SceneSpec, prop: string, value: unknown): SceneSpec {
  // Schema-aware clamping for critical numeric fields
  if (prop === "width" || prop === "height") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return spec;
    (spec as unknown as Record<string, unknown>)[prop] = Math.round(clamp(n, 1, 7680));
  } else if (prop === "fps") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return spec;
    (spec as unknown as Record<string, unknown>)[prop] = Math.round(clamp(n, 1, 120));
  } else if (prop === "durationSeconds") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return spec;
    (spec as unknown as Record<string, unknown>)[prop] = clamp(n, 0.1, 600);
  } else {
    (spec as unknown as Record<string, unknown>)[prop] = value;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Clone mutations
// ---------------------------------------------------------------------------

export function setCloneProp(spec: SceneSpec, id: string, prop: string, value: unknown): SceneSpec {
  const obj = findObject(spec, id);
  if (obj === undefined) return spec;
  if (obj.clone === undefined) {
    obj.clone = { count: 2, layout: "grid", spacing: 1.2, radius: 3, seed: 42, stagger: 0.05 };
  }
  setNested(obj.clone as unknown as Record<string, unknown>, prop, value);
  return spec;
}

export function rerollSeed(spec: SceneSpec, id: string): SceneSpec {
  const obj = findObject(spec, id);
  if (obj?.clone !== undefined) {
    obj.clone.seed = Math.floor(Math.random() * 100000);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Post pass mutations
// ---------------------------------------------------------------------------

export function addPass(spec: SceneSpec, passName: string): SceneSpec {
  ensurePost(spec).push({ pass: passName, params: { strength: 0.2 } });
  return spec;
}

export function removePass(spec: SceneSpec, index: number): SceneSpec {
  const post = spec.post;
  if (post !== undefined && index >= 0 && index < post.length) {
    post.splice(index, 1);
  }
  return spec;
}

export function movePass(spec: SceneSpec, fromIndex: number, toIndex: number): SceneSpec {
  const post = spec.post;
  if (post === undefined) return spec;
  if (fromIndex < 0 || fromIndex >= post.length || toIndex < 0 || toIndex >= post.length) return spec;
  const [moved] = post.splice(fromIndex, 1);
  if (moved !== undefined) post.splice(toIndex, 0, moved);
  return spec;
}

export function setPassProp(spec: SceneSpec, index: number, prop: string, value: unknown): SceneSpec {
  const pass = spec.post?.[index];
  if (pass === undefined) return spec;
  setNested(pass as unknown as Record<string, unknown>, prop, value);
  return spec;
}

// ---------------------------------------------------------------------------
// Track mutations
// ---------------------------------------------------------------------------

export function addTrack(spec: SceneSpec, target: "camera" | { objectId: string }): SceneSpec {
  let tracks: TrackSpec[];
  if (target === "camera") {
    const cam = ensureCamera(spec);
    if (cam.tracks === undefined) cam.tracks = [];
    tracks = cam.tracks;
  } else {
    const obj = findObject(spec, target.objectId);
    if (obj === undefined) return spec;
    if (obj.tracks === undefined) obj.tracks = [];
    tracks = obj.tracks;
  }
  tracks.push({ prop: "scale", mode: "keyframes", keyframes: [{ t: 0, v: 1, ease: "linear" }] });
  return spec;
}

export function removeTrack(spec: SceneSpec, target: "camera" | { objectId: string }, index: number): SceneSpec {
  const tracks = target === "camera"
    ? ensureCamera(spec).tracks
    : findObject(spec, target.objectId)?.tracks;
  if (tracks !== undefined && index >= 0 && index < tracks.length) {
    tracks.splice(index, 1);
  }
  return spec;
}

export function setTrackProp(
  spec: SceneSpec,
  target: "camera" | { objectId: string },
  trackIndex: number,
  prop: string,
  value: unknown,
): SceneSpec {
  const tracks = target === "camera"
    ? ensureCamera(spec).tracks
    : findObject(spec, target.objectId)?.tracks;
  const track = tracks?.[trackIndex];
  if (track === undefined) return spec;
  if (prop === "mode") {
    track.mode = value as TrackSpec["mode"];
    if (track.mode === "keyframes" && track.keyframes === undefined) {
      track.keyframes = [{ t: 0, v: 0, ease: "linear" }];
    }
    if (track.mode === "osc" && track.osc === undefined) {
      track.osc = { amp: 1, freqBeats: 1, phasePerClone: 0, center: 0 };
    }
    if (track.mode === "beat" && track.beat === undefined) {
      track.beat = { every: 1, from: 0, to: 1, attack: 0.05, decay: 0.3 };
    }
  } else {
    setNested(track as unknown as Record<string, unknown>, prop, value);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Keyframe mutations
// ---------------------------------------------------------------------------

export function addKeyframe(spec: SceneSpec, target: "camera" | { objectId: string }, trackIndex: number): SceneSpec {
  const tracks = target === "camera"
    ? ensureCamera(spec).tracks
    : findObject(spec, target.objectId)?.tracks;
  const track = tracks?.[trackIndex];
  if (track === undefined || track.mode !== "keyframes") return spec;
  if (track.keyframes === undefined) track.keyframes = [];
  const last = track.keyframes.at(-1);
  const t = last !== undefined ? Math.min(last.t + 1, spec.durationSeconds) : 0;
  track.keyframes.push({ t, v: last?.v ?? 0, ease: "linear" });
  return spec;
}

export function removeKeyframe(spec: SceneSpec, target: "camera" | { objectId: string }, trackIndex: number, kfIndex: number): SceneSpec {
  const tracks = target === "camera"
    ? ensureCamera(spec).tracks
    : findObject(spec, target.objectId)?.tracks;
  const kfs = tracks?.[trackIndex]?.keyframes;
  if (kfs !== undefined && kfIndex >= 0 && kfIndex < kfs.length) {
    kfs.splice(kfIndex, 1);
  }
  return spec;
}

export function setKeyframeProp(
  spec: SceneSpec,
  target: "camera" | { objectId: string },
  trackIndex: number,
  kfIndex: number,
  prop: "t" | "v" | "ease",
  value: number | string,
): SceneSpec {
  const tracks = target === "camera"
    ? ensureCamera(spec).tracks
    : findObject(spec, target.objectId)?.tracks;
  const kf = tracks?.[trackIndex]?.keyframes?.[kfIndex];
  if (kf === undefined) return spec;
  if (prop === "t") {
    kf.t = clamp(Number(value), 0, spec.durationSeconds);
  } else if (prop === "v") {
    kf.v = Number(value);
  } else {
    kf.ease = String(value);
  }
  return spec;
}

export function moveKeyframe(
  spec: SceneSpec,
  target: "camera" | { objectId: string },
  trackIndex: number,
  kfIndex: number,
  newT: number,
): SceneSpec {
  const tracks = target === "camera"
    ? ensureCamera(spec).tracks
    : findObject(spec, target.objectId)?.tracks;
  const kf = tracks?.[trackIndex]?.keyframes?.[kfIndex];
  if (kf === undefined) return spec;
  kf.t = clamp(newT, 0, spec.durationSeconds);
  // Stable-sort keyframes by t so runtime interpolation order is correct
  const kfs = tracks?.[trackIndex]?.keyframes;
  if (kfs !== undefined) kfs.sort((a, b) => a.t - b.t);
  return spec;
}

// ---------------------------------------------------------------------------
// Asset mutations
// ---------------------------------------------------------------------------

export function addOrEnsureAsset(spec: SceneSpec, id: string, kind: string, path: string): SceneSpec {
  const assets = ensureAssets(spec);
  const existing = assets.find((a) => a.id === id);
  if (existing !== undefined) {
    existing.kind = kind;
    if (path.length > 0) existing.path = path;
  } else {
    assets.push({ id, kind, path });
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

export function parseSpec(text: string): SceneSpec {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("scene spec must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.width !== "number" || typeof obj.height !== "number" ||
      typeof obj.fps !== "number" || typeof obj.durationSeconds !== "number") {
    throw new Error("scene spec needs numeric width, height, fps, durationSeconds");
  }
  return parsed as SceneSpec;
}

export function serializeSpec(spec: SceneSpec): string {
  return JSON.stringify(spec, null, 2);
}

// ---------------------------------------------------------------------------
// Computed helpers
// ---------------------------------------------------------------------------

export function specDurationInFrames(spec: SceneSpec): number {
  return Math.ceil(spec.durationSeconds * spec.fps);
}

export function specTotalBeats(spec: SceneSpec): number {
  const bpm = spec.timeline?.bpm ?? 120;
  return spec.durationSeconds * (bpm / 60);
}

export function frameToSeconds(frame: number, fps: number): number {
  return frame / fps;
}

// ---------------------------------------------------------------------------
// Rewrite asset paths for live preview
// ---------------------------------------------------------------------------

export function rewriteAssetsForPreview(spec: SceneSpec): SceneSpec {
  const copy: SceneSpec = structuredClone(spec);
  const skipped = new Set<string>();
  copy.assets = (copy.assets ?? []).flatMap((asset) => {
    if (asset.kind === "videoFrames") {
      skipped.add(asset.id);
      return [];
    }
    return [{ ...asset, path: `asset?path=${encodeURIComponent(asset.path)}` }];
  });
  if (skipped.size > 0 && copy.objects !== undefined) {
    copy.objects = copy.objects.filter((obj) => obj.asset === undefined || !skipped.has(obj.asset));
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function stemFromPath(path: string): string {
  return path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "asset";
}

export function formatNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const fixed = v.toFixed(3);
  return fixed.replace(/\.?0+$/, "") || "0";
}

// ---------------------------------------------------------------------------
// Debounce queue
// ---------------------------------------------------------------------------

export interface DebounceHandle {
  schedule(): void;
  flush(): void;
  cancel(): void;
}

export function createDebounce(callback: () => void, delayMs: number): DebounceHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      clearTimeout(timer ?? undefined);
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    flush() {
      clearTimeout(timer ?? undefined);
      timer = null;
      callback();
    },
    cancel() {
      clearTimeout(timer ?? undefined);
      timer = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Selectable items list — for vim navigation in the tree
// ---------------------------------------------------------------------------

export function collectSelectableItems(spec: SceneSpec): Selection[] {
  const items: Selection[] = [
    { type: "camera" },
    { type: "timeline" },
  ];
  for (const obj of spec.objects ?? []) {
    items.push({ type: "object", id: obj.id });
  }
  for (let i = 0; i < (spec.post?.length ?? 0); i++) {
    items.push({ type: "pass", index: i });
  }
  for (const asset of spec.assets ?? []) {
    items.push({ type: "asset", id: asset.id });
  }
  if (spec.audio !== undefined) {
    items.push({ type: "audio" });
  }
  return items;
}
