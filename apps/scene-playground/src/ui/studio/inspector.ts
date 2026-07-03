// ---------------------------------------------------------------------------
// Inspector panel — typed controls for the current selection (right panel)
// Uses singleton drag state to avoid listener leaks on re-render.
// ---------------------------------------------------------------------------

import {
  type SceneSpec,
  type Selection,
  type TrackSpec,
  addKeyframe,
  addTrack,
  clamp,
  ensureCamera,
  escapeHtml,
  formatNum,
  rerollSeed,
  removeKeyframe,
  removeTrack,
  setAudioProp,
  setCameraProp,
  setCloneProp,
  setKeyframeProp,
  setObjectProp,
  setPassProp,
  setSceneProp,
  setTimelineProp,
  setTrackProp,
} from "./state";

// ---------------------------------------------------------------------------
// Singleton drag state — one set of window listeners, never leaked
// ---------------------------------------------------------------------------

interface DragState {
  span: HTMLElement;
  onChange: (v: number) => void;
  startVal: number;
  startX: number;
  step: number;
  min: number;
  max: number;
}

let activeDrag: DragState | null = null;
let dragListenersInstalled = false;

function installDragListeners(): void {
  if (dragListenersInstalled) return;
  dragListenersInstalled = true;
  window.addEventListener("mousemove", (e) => {
    if (activeDrag === null) return;
    document.body.style.userSelect = "none";
    const dx = e.clientX - activeDrag.startX;
    const sens = e.shiftKey ? activeDrag.step * 0.1 : e.altKey ? activeDrag.step * 0.01 : activeDrag.step;
    const v = clamp(activeDrag.startVal + dx * sens, activeDrag.min, activeDrag.max);
    activeDrag.span.textContent = formatNum(v);
    activeDrag.onChange(v);
  });
  window.addEventListener("mouseup", () => {
    activeDrag = null;
    document.body.style.userSelect = "";
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InspectorCallbacks {
  onChange(): void;
}

export function renderInspector(
  container: HTMLElement,
  spec: SceneSpec | null,
  selection: Selection,
  cbs: InspectorCallbacks,
): void {
  installDragListeners();
  container.textContent = "";
  if (spec === null) { container.textContent = "no spec loaded"; return; }

  switch (selection.type) {
    case "none": container.innerHTML = '<div class="inspector-empty">select an item in the tree</div>'; break;
    case "camera": renderCameraPanel(container, spec, cbs); break;
    case "timeline": renderTimelinePanel(container, spec, cbs); break;
    case "object": renderObjectPanel(container, spec, selection.id, cbs); break;
    case "pass": renderPassPanel(container, spec, selection.index, cbs); break;
    case "asset": renderAssetPanel(container, spec, selection.id); break;
    case "audio": renderAudioPanel(container, spec, cbs); break;
  }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function renderCameraPanel(c: HTMLElement, spec: SceneSpec, cbs: InspectorCallbacks): void {
  const cam = spec.camera ?? ensureCamera(spec);
  section(c, "Camera");
  numField(c, "FOV", cam.fov, 1, 179, 1, (v) => { setCameraProp(spec, "fov", v); cbs.onChange(); });
  vec3Field(c, "Position", cam.position, (i, v) => { setCameraProp(spec, `position.${i}`, v); cbs.onChange(); });
  vec3Field(c, "LookAt", cam.lookAt, (i, v) => { setCameraProp(spec, `lookAt.${i}`, v); cbs.onChange(); });
  section(c, "Camera Tracks");
  trackList(c, spec, "camera", cbs);
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function renderTimelinePanel(c: HTMLElement, spec: SceneSpec, cbs: InspectorCallbacks): void {
  section(c, "Timeline");
  const tl = spec.timeline ?? { bpm: 120 };
  numField(c, "BPM", tl.bpm ?? 120, 20, 300, 1, (v) => { setTimelineProp(spec, "bpm", v); cbs.onChange(); });

  const row = fieldRow(c, "Beats");
  const ta = document.createElement("textarea");
  ta.className = "inspector-textarea";
  ta.placeholder = "e.g. 0.5, 1.0, 2.0";
  ta.value = (tl.beats ?? []).join(", ");
  ta.addEventListener("change", () => {
    const beats = ta.value.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
    setTimelineProp(spec, "beats", beats.length > 0 ? beats : undefined);
    cbs.onChange();
  });
  row.append(ta);

  section(c, "Scene");
  numField(c, "Width", spec.width, 1, 7680, 1, (v) => { setSceneProp(spec, "width", Math.round(v)); cbs.onChange(); });
  numField(c, "Height", spec.height, 1, 7680, 1, (v) => { setSceneProp(spec, "height", Math.round(v)); cbs.onChange(); });
  numField(c, "FPS", spec.fps, 1, 120, 1, (v) => { setSceneProp(spec, "fps", Math.round(v)); cbs.onChange(); });
  numField(c, "Duration", spec.durationSeconds, 0.1, 600, 0.1, (v) => { setSceneProp(spec, "durationSeconds", v); cbs.onChange(); });
  colorField(c, "Background", spec.background ?? "#050507", (v) => { setSceneProp(spec, "background", v); cbs.onChange(); });
}

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

function renderObjectPanel(c: HTMLElement, spec: SceneSpec, id: string, cbs: InspectorCallbacks): void {
  const obj = spec.objects?.find((o) => o.id === id);
  if (obj === undefined) { c.textContent = "object not found"; return; }

  section(c, `Object: ${obj.id}`);
  dropdownField(c, "Kind", obj.kind, ["plane", "sprite", "text", "group"], (v) => {
    setObjectProp(spec, id, "kind", v); cbs.onChange();
  });

  if (obj.kind === "text") {
    textField(c, "Text", obj.text ?? "", (v) => { setObjectProp(spec, id, "text", v); cbs.onChange(); });
    textField(c, "Font", obj.font ?? "", (v) => { setObjectProp(spec, id, "font", v); cbs.onChange(); });
    colorField(c, "Color", obj.color ?? "#ffffff", (v) => { setObjectProp(spec, id, "color", v); cbs.onChange(); });
  }

  if (obj.kind === "plane" || obj.kind === "sprite") {
    assetPicker(c, "Asset", obj.asset ?? "", spec, (v) => { setObjectProp(spec, id, "asset", v); cbs.onChange(); });
  }

  vec2Field(c, "Size", obj.size, (i, v) => { setObjectProp(spec, id, `size.${i}`, v); cbs.onChange(); });
  vec3Field(c, "Position", obj.position, (i, v) => { setObjectProp(spec, id, `position.${i}`, v); cbs.onChange(); });
  vec3Field(c, "Rotation", obj.rotation, (i, v) => { setObjectProp(spec, id, `rotation.${i}`, v); cbs.onChange(); });
  numField(c, "Scale", obj.scale, 0.01, 20, 0.01, (v) => { setObjectProp(spec, id, "scale", v); cbs.onChange(); });
  numField(c, "Opacity", obj.opacity, 0, 1, 0.01, (v) => { setObjectProp(spec, id, "opacity", v); cbs.onChange(); });

  // Clone group
  section(c, "Clone");
  if (obj.clone !== undefined) {
    numField(c, "Count", obj.clone.count, 1, 64, 1, (v) => { setCloneProp(spec, id, "count", Math.round(v)); cbs.onChange(); });
    dropdownField(c, "Layout", obj.clone.layout, ["grid", "orbit", "spiral", "line", "scatter"], (v) => {
      setCloneProp(spec, id, "layout", v); cbs.onChange();
    });
    numField(c, "Spacing", obj.clone.spacing, 0, 20, 0.01, (v) => { setCloneProp(spec, id, "spacing", v); cbs.onChange(); });
    numField(c, "Radius", obj.clone.radius, 0, 20, 0.01, (v) => { setCloneProp(spec, id, "radius", v); cbs.onChange(); });
    numField(c, "Stagger", obj.clone.stagger, 0, 2, 0.001, (v) => { setCloneProp(spec, id, "stagger", v); cbs.onChange(); });

    const seedRow = fieldRow(c, "Seed");
    const seedVal = document.createElement("span");
    seedVal.className = "scrub-value";
    seedVal.textContent = String(obj.clone.seed);
    seedRow.append(seedVal);
    const reroll = document.createElement("button");
    reroll.className = "inspector-btn-inline";
    reroll.textContent = "\u{1F3B2}";
    reroll.title = "Reroll seed";
    reroll.addEventListener("click", () => { rerollSeed(spec, id); cbs.onChange(); });
    seedRow.append(reroll);
  } else {
    const addBtn = document.createElement("button");
    addBtn.className = "inspector-btn";
    addBtn.textContent = "Add Clone Group";
    addBtn.addEventListener("click", () => { setCloneProp(spec, id, "count", 4); cbs.onChange(); });
    c.append(addBtn);
  }

  // Tracks
  section(c, "Tracks");
  trackList(c, spec, { objectId: id }, cbs);
}

// ---------------------------------------------------------------------------
// Post pass
// ---------------------------------------------------------------------------

function renderPassPanel(c: HTMLElement, spec: SceneSpec, index: number, cbs: InspectorCallbacks): void {
  const pass = spec.post?.[index];
  if (pass === undefined) { c.textContent = "pass not found"; return; }

  section(c, `Pass: ${pass.pass}`);
  dropdownField(c, "Type", pass.pass, ["bloom", "vhs", "chromaticAberration", "glitch"], (v) => {
    setPassProp(spec, index, "pass", v); cbs.onChange();
  });

  section(c, "Params");
  for (const [key, value] of Object.entries(pass.params)) {
    if (typeof value === "number") {
      numField(c, key, value, 0, 2, 0.01, (v) => { setPassProp(spec, index, `params.${key}`, v); cbs.onChange(); }, true);
    }
  }

  if (pass.beatReactive !== undefined) {
    section(c, "Beat Reactive");
    textField(c, "Param", pass.beatReactive.param, (v) => { setPassProp(spec, index, "beatReactive.param", v); cbs.onChange(); });
    numField(c, "Every", pass.beatReactive.every, 1, 16, 1, (v) => { setPassProp(spec, index, "beatReactive.every", v); cbs.onChange(); });
    numField(c, "Amount", pass.beatReactive.amount, 0, 2, 0.01, (v) => { setPassProp(spec, index, "beatReactive.amount", v); cbs.onChange(); });
    numField(c, "Decay", pass.beatReactive.decay, 0, 2, 0.01, (v) => { setPassProp(spec, index, "beatReactive.decay", v); cbs.onChange(); });
  } else {
    const addBr = document.createElement("button");
    addBr.className = "inspector-btn";
    addBr.textContent = "Add Beat Reactive";
    addBr.addEventListener("click", () => {
      setPassProp(spec, index, "beatReactive", { param: "strength", every: 1, amount: 0.3, decay: 0.25 });
      cbs.onChange();
    });
    c.append(addBr);
  }
}

// ---------------------------------------------------------------------------
// Asset (read-only info + insert button)
// ---------------------------------------------------------------------------

function renderAssetPanel(c: HTMLElement, spec: SceneSpec, assetId: string): void {
  const asset = spec.assets?.find((a) => a.id === assetId);
  section(c, `Asset: ${assetId}`);
  if (asset !== undefined) {
    infoRow(c, "Kind", asset.kind);
    infoRow(c, "Path", asset.path);
  } else {
    c.append(document.createTextNode("Asset not in spec. Double-click in tree to insert."));
  }
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

function renderAudioPanel(c: HTMLElement, spec: SceneSpec, cbs: InspectorCallbacks): void {
  const audio = spec.audio ?? {};
  section(c, "Audio");
  assetPicker(c, "Asset", audio.asset ?? "", spec, (v) => { setAudioProp(spec, "asset", v); cbs.onChange(); }, "audio");
  numField(c, "Offset (s)", audio.offsetSeconds ?? 0, 0, spec.durationSeconds, 0.01, (v) => { setAudioProp(spec, "offsetSeconds", v); cbs.onChange(); });
  numField(c, "Gain (dB)", audio.gainDb ?? 0, -60, 12, 0.1, (v) => { setAudioProp(spec, "gainDb", v); cbs.onChange(); });
}

// ---------------------------------------------------------------------------
// Track list (shared: camera + objects)
// ---------------------------------------------------------------------------

function trackList(
  c: HTMLElement,
  spec: SceneSpec,
  target: "camera" | { objectId: string },
  cbs: InspectorCallbacks,
): void {
  const addBtn = document.createElement("button");
  addBtn.className = "inspector-btn";
  addBtn.textContent = "+ Add Track";
  addBtn.addEventListener("click", () => { addTrack(spec, target); cbs.onChange(); });
  c.append(addBtn);

  const tracks = target === "camera" ? spec.camera?.tracks : spec.objects?.find((o) => o.id === (target as { objectId: string }).objectId)?.tracks;
  if (tracks === undefined || tracks.length === 0) return;

  for (let ti = 0; ti < tracks.length; ti += 1) {
    const track = tracks[ti]!;
    const div = document.createElement("div");
    div.className = "track-editor";

    const head = document.createElement("div");
    head.className = "track-head";
    head.innerHTML = `<span>${ti}: ${escapeHtml(track.prop)}</span>`;
    const delBtn = document.createElement("button");
    delBtn.className = "tree-delete";
    delBtn.textContent = "\u00D7";
    delBtn.addEventListener("click", () => { removeTrack(spec, target, ti); cbs.onChange(); });
    head.append(delBtn);
    div.append(head);

    dropdownField(div, "Prop", track.prop, ["position.x", "position.y", "position.z", "rotation.x", "rotation.y", "rotation.z", "scale", "opacity"], (v) => {
      setTrackProp(spec, target, ti, "prop", v); cbs.onChange();
    });
    dropdownField(div, "Mode", track.mode, ["keyframes", "osc", "beat"], (v) => {
      setTrackProp(spec, target, ti, "mode", v); cbs.onChange();
    });

    if (track.mode === "keyframes") {
      keyframeEditor(div, spec, target, ti, track, cbs);
    } else if (track.mode === "osc" && track.osc !== undefined) {
      numField(div, "Amp", track.osc.amp, 0, 100, 0.001, (v) => { setTrackProp(spec, target, ti, "osc.amp", v); cbs.onChange(); });
      numField(div, "FreqBeats", track.osc.freqBeats, 0.01, 32, 0.01, (v) => { setTrackProp(spec, target, ti, "osc.freqBeats", v); cbs.onChange(); });
      numField(div, "Phase/Clone", track.osc.phasePerClone, 0, 6.28, 0.01, (v) => { setTrackProp(spec, target, ti, "osc.phasePerClone", v); cbs.onChange(); });
      numField(div, "Center", track.osc.center, -100, 100, 0.01, (v) => { setTrackProp(spec, target, ti, "osc.center", v); cbs.onChange(); });
    } else if (track.mode === "beat" && track.beat !== undefined) {
      numField(div, "Every", track.beat.every, 1, 16, 1, (v) => { setTrackProp(spec, target, ti, "beat.every", v); cbs.onChange(); });
      numField(div, "From", track.beat.from, -10, 10, 0.01, (v) => { setTrackProp(spec, target, ti, "beat.from", v); cbs.onChange(); });
      numField(div, "To", track.beat.to, -10, 10, 0.01, (v) => { setTrackProp(spec, target, ti, "beat.to", v); cbs.onChange(); });
      numField(div, "Attack", track.beat.attack, 0, 2, 0.001, (v) => { setTrackProp(spec, target, ti, "beat.attack", v); cbs.onChange(); });
      numField(div, "Decay", track.beat.decay, 0, 2, 0.001, (v) => { setTrackProp(spec, target, ti, "beat.decay", v); cbs.onChange(); });
    }

    c.append(div);
  }
}

// ---------------------------------------------------------------------------
// Keyframe table editor
// ---------------------------------------------------------------------------

function keyframeEditor(
  c: HTMLElement,
  spec: SceneSpec,
  target: "camera" | { objectId: string },
  ti: number,
  track: TrackSpec,
  cbs: InspectorCallbacks,
): void {
  const kfs = track.keyframes ?? [];
  if (kfs.length > 0) {
    const table = document.createElement("table");
    table.className = "keyframe-table";
    table.innerHTML = "<thead><tr><th>t</th><th>v</th><th>ease</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (let ki = 0; ki < kfs.length; ki += 1) {
      const kf = kfs[ki]!;
      const tr = document.createElement("tr");

      const mkCell = (type: string, val: string, onChange: (v: string) => void): HTMLTableCellElement => {
        const td = document.createElement("td");
        const inp = document.createElement("input");
        inp.type = type;
        inp.value = val;
        if (type === "number") { inp.step = "0.01"; inp.min = "0"; inp.max = String(spec.durationSeconds); }
        inp.addEventListener("change", () => onChange(inp.value));
        td.append(inp);
        return td;
      };

      tr.append(mkCell("number", String(kf.t), (v) => { setKeyframeProp(spec, target, ti, ki, "t", Number(v)); cbs.onChange(); }));
      tr.append(mkCell("number", String(kf.v), (v) => { setKeyframeProp(spec, target, ti, ki, "v", Number(v)); cbs.onChange(); }));
      tr.append(mkCell("text", kf.ease ?? "linear", (v) => { setKeyframeProp(spec, target, ti, ki, "ease", v); cbs.onChange(); }));

      const delTd = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "tree-delete";
      delBtn.textContent = "\u00D7";
      delBtn.addEventListener("click", () => { removeKeyframe(spec, target, ti, ki); cbs.onChange(); });
      delTd.append(delBtn);
      tr.append(delTd);

      tbody.append(tr);
    }
    table.append(tbody);
    c.append(table);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "inspector-btn";
  addBtn.textContent = "+ Keyframe";
  addBtn.addEventListener("click", () => { addKeyframe(spec, target, ti); cbs.onChange(); });
  c.append(addBtn);
}

// ---------------------------------------------------------------------------
// Reusable field widgets
// ---------------------------------------------------------------------------

function section(c: HTMLElement, title: string): void {
  const el = document.createElement("div");
  el.className = "inspector-section";
  el.innerHTML = `<h4>${escapeHtml(title)}</h4>`;
  c.append(el);
}

function fieldRow(c: HTMLElement, label: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "inspector-field";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  row.append(lbl);
  c.append(row);
  return row;
}

function numField(
  c: HTMLElement,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
  showLive = false,
): void {
  const row = fieldRow(c, label);
  const span = scrubSpan(value, min, max, step, onChange);
  row.append(span);
  if (showLive) {
    const live = document.createElement("span");
    live.className = "scrub-live";
    live.textContent = formatNum(value);
    row.append(live);
  }
}

function scrubSpan(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
  const span = document.createElement("span");
  span.className = "scrub-value";
  span.textContent = formatNum(value);
  span.title = "Drag to adjust \u2022 Shift=fine \u2022 Alt=ultra-fine";
  span.tabIndex = 0;
  span.addEventListener("mousedown", (e) => {
    activeDrag = { span, onChange, startVal: value, startX: e.clientX, step, min, max };
    e.preventDefault();
  });
  // Keyboard: j/k or arrows adjust value
  span.addEventListener("keydown", (e) => {
    const dir = (e.key === "ArrowUp" || e.key === "k") ? 1 : (e.key === "ArrowDown" || e.key === "j") ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const mult = e.shiftKey ? 0.1 : e.altKey ? 0.01 : 1;
    value = clamp(value + dir * step * mult, min, max);
    span.textContent = formatNum(value);
    onChange(value);
  });
  return span;
}

function vec2Field(c: HTMLElement, label: string, value: [number, number], onChange: (i: number, v: number) => void): void {
  const row = fieldRow(c, label);
  for (let i = 0; i < 2; i += 1) {
    const ax = document.createElement("span");
    ax.className = "axis-label";
    ax.textContent = ["W", "H"][i]!;
    row.append(ax);
    row.append(scrubSpan(value[i]!, 0, 100, 0.01, (v) => onChange(i, v)));
  }
}

function vec3Field(c: HTMLElement, label: string, value: [number, number, number], onChange: (i: number, v: number) => void): void {
  const row = fieldRow(c, label);
  const axes = ["X", "Y", "Z"];
  for (let i = 0; i < 3; i += 1) {
    const ax = document.createElement("span");
    ax.className = "axis-label";
    ax.textContent = axes[i]!;
    row.append(ax);
    row.append(scrubSpan(value[i]!, -100, 100, 0.01, (v) => onChange(i, v)));
  }
}

function dropdownField<T extends string>(c: HTMLElement, label: string, value: T, options: readonly T[], onChange: (v: T) => void): void {
  const row = fieldRow(c, label);
  const sel = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    o.selected = opt === value;
    sel.append(o);
  }
  sel.addEventListener("change", () => onChange(sel.value as T));
  row.append(sel);
}

function textField(c: HTMLElement, label: string, value: string, onChange: (v: string) => void): void {
  const row = fieldRow(c, label);
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = value;
  inp.addEventListener("change", () => onChange(inp.value));
  row.append(inp);
}

function colorField(c: HTMLElement, label: string, value: string, onChange: (v: string) => void): void {
  const row = fieldRow(c, label);
  const inp = document.createElement("input");
  inp.type = "color";
  inp.value = value;
  inp.addEventListener("input", () => onChange(inp.value));
  row.append(inp);
}

function assetPicker(c: HTMLElement, label: string, value: string, spec: SceneSpec, onChange: (v: string) => void, filterKind?: string): void {
  const row = fieldRow(c, label);
  const sel = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "(none)";
  sel.append(none);
  for (const asset of spec.assets ?? []) {
    if (filterKind !== undefined && asset.kind !== filterKind) continue;
    const o = document.createElement("option");
    o.value = asset.id;
    o.textContent = `${asset.id} (${asset.kind})`;
    o.selected = asset.id === value;
    sel.append(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  row.append(sel);
}

function infoRow(c: HTMLElement, label: string, value: string): void {
  const row = fieldRow(c, label);
  const span = document.createElement("span");
  span.className = "info-value";
  span.textContent = value;
  span.title = value;
  row.append(span);
}
