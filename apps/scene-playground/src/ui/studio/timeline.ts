// ---------------------------------------------------------------------------
// Timeline strip — SVG horizontal lanes with keyframe dots and beat grid
// Singleton drag state for keyframe dot dragging (no listener leaks).
// ---------------------------------------------------------------------------

import { type SceneSpec, type Selection, clamp, selectionKey, specDurationInFrames } from "./state";

export interface TimelineCallbacks {
  onSeek(frame: number): void;
  onKeyframeDrag(objectId: string, trackIndex: number, kfIndex: number, newT: number): void;
}

// -- Singleton keyframe drag state --
interface KfDrag {
  svg: SVGSVGElement;
  circle: SVGCircleElement;
  objectId: string;
  trackIndex: number;
  kfIndex: number;
  totalWidth: number;
  duration: number;
  cbs: TimelineCallbacks;
}

let kfDrag: KfDrag | null = null;
let kfDragInstalled = false;

function installKfDragListeners(): void {
  if (kfDragInstalled) return;
  kfDragInstalled = true;
  window.addEventListener("mousemove", (e) => {
    if (kfDrag === null) return;
    const rect = kfDrag.svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = (e.clientX - rect.left) / rect.width * kfDrag.totalWidth;
    const PX_PER_SEC = kfDrag.totalWidth / kfDrag.duration;
    const newT = clamp(relX / PX_PER_SEC, 0, kfDrag.duration);
    kfDrag.circle.setAttribute("cx", String(newT * PX_PER_SEC));
    kfDrag.cbs.onKeyframeDrag(kfDrag.objectId, kfDrag.trackIndex, kfDrag.kfIndex, newT);
  });
  window.addEventListener("mouseup", () => { kfDrag = null; });
}

// -- Track prop → color mapping --
function trackColor(prop: string): string {
  if (prop.includes("position")) return "#8ef7ff";
  if (prop.includes("rotation")) return "#ffd666";
  if (prop.includes("scale")) return "#99ffb5";
  if (prop.includes("opacity")) return "#ffb4b4";
  if (prop.includes("fov")) return "#c4b5fd";
  return "#a7a7b4";
}

const NS = "http://www.w3.org/2000/svg";
const PX_PER_SEC = 60;
const LANE_H = 26;
const HEADER_H = 18;
const KF_R = 5;

export function renderTimeline(
  container: HTMLElement,
  spec: SceneSpec | null,
  frame: number,
  selection: Selection,
  cbs: TimelineCallbacks,
): void {
  installKfDragListeners();
  container.textContent = "";
  if (spec === null || spec.durationSeconds <= 0) return;

  const totalFrames = specDurationInFrames(spec);
  const totalWidth = spec.durationSeconds * PX_PER_SEC;
  const bpm = spec.timeline?.bpm ?? 120;
  const beatSec = 60 / bpm;
  const beatCount = Math.ceil(spec.durationSeconds / beatSec);

  // Collect objects that have tracks
  const lanes = (spec.objects ?? []).filter((o) => (o.tracks?.length ?? 0) > 0);
  const totalHeight = HEADER_H + lanes.length * LANE_H + 4;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "timeline-svg");
  svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);
  svg.setAttribute("width", String(totalWidth));
  svg.setAttribute("height", String(totalHeight));

  // -- Beat grid lines --
  for (let b = 0; b <= beatCount; b += 1) {
    const x = b * beatSec * PX_PER_SEC;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(totalHeight));
    line.setAttribute("stroke", b % 4 === 0 ? "#2a2a38" : "#18181f");
    line.setAttribute("stroke-width", b % 4 === 0 ? "1" : "0.5");
    svg.append(line);

    // Beat number label on downbeats
    if (b % 4 === 0) {
      const txt = document.createElementNS(NS, "text");
      txt.setAttribute("x", String(x + 2));
      txt.setAttribute("y", "12");
      txt.setAttribute("fill", "#444");
      txt.setAttribute("font-size", "9");
      txt.setAttribute("font-family", "monospace");
      txt.textContent = String(b);
      svg.append(txt);
    }
  }

  // -- Lanes --
  for (let li = 0; li < lanes.length; li += 1) {
    const obj = lanes[li]!;
    const y = HEADER_H + li * LANE_H;
    const isSelected = selection.type === "object" && selection.id === obj.id;

    // Lane background
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", String(y));
    bg.setAttribute("width", String(totalWidth));
    bg.setAttribute("height", String(LANE_H));
    bg.setAttribute("fill", isSelected ? "#171725" : li % 2 === 0 ? "#0d0d14" : "#101018");
    svg.append(bg);

    // Object label
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", "4");
    label.setAttribute("y", String(y + LANE_H / 2 + 3));
    label.setAttribute("fill", isSelected ? "#8ef7ff" : "#555");
    label.setAttribute("font-size", "9");
    label.setAttribute("font-family", "monospace");
    label.textContent = obj.id;
    svg.append(label);

    const tracks = obj.tracks ?? [];
    const trackH = Math.max(4, (LANE_H - 4) / Math.max(1, tracks.length));

    for (let ti = 0; ti < tracks.length; ti += 1) {
      const track = tracks[ti]!;
      const tY = y + 2 + ti * trackH;
      const color = trackColor(track.prop);

      // Track span bar
      const bar = document.createElementNS(NS, "rect");
      bar.setAttribute("x", "0");
      bar.setAttribute("y", String(tY));
      bar.setAttribute("width", String(totalWidth));
      bar.setAttribute("height", String(Math.max(1, trackH - 1)));
      bar.setAttribute("fill", color);
      bar.setAttribute("opacity", "0.18");
      svg.append(bar);

      // Keyframe dots (draggable)
      if (track.mode === "keyframes" && track.keyframes !== undefined) {
        for (let ki = 0; ki < track.keyframes.length; ki += 1) {
          const kf = track.keyframes[ki]!;
          const cx = kf.t * PX_PER_SEC;
          const cy = tY + trackH / 2;

          const circle = document.createElementNS(NS, "circle");
          circle.setAttribute("cx", String(cx));
          circle.setAttribute("cy", String(cy));
          circle.setAttribute("r", String(KF_R));
          circle.setAttribute("fill", color);
          circle.setAttribute("stroke", "#eee");
          circle.setAttribute("stroke-width", "1");
          circle.setAttribute("cursor", "ew-resize");

          circle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            kfDrag = {
              svg,
              circle,
              objectId: obj.id,
              trackIndex: ti,
              kfIndex: ki,
              totalWidth,
              duration: spec.durationSeconds,
              cbs,
            };
          });

          svg.append(circle);
        }
      }
    }
  }

  // -- Playhead --
  const phX = (frame / spec.fps) * PX_PER_SEC;
  const ph = document.createElementNS(NS, "line");
  ph.setAttribute("x1", String(phX));
  ph.setAttribute("y1", "0");
  ph.setAttribute("x2", String(phX));
  ph.setAttribute("y2", String(totalHeight));
  ph.setAttribute("stroke", "#ff4fd8");
  ph.setAttribute("stroke-width", "1.5");
  ph.setAttribute("pointer-events", "none");
  svg.append(ph);

  // -- Click-to-seek (single listener on SVG) --
  svg.addEventListener("click", (e) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = (e.clientX - rect.left) / rect.width * totalWidth;
    const seekFrame = Math.round(relX / PX_PER_SEC * spec.fps);
    cbs.onSeek(clamp(seekFrame, 0, Math.max(0, totalFrames - 1)));
  });

  container.append(svg);

  // Auto-scroll playhead into view
  const containerWidth = container.clientWidth;
  if (containerWidth > 0 && phX > container.scrollLeft + containerWidth - 40) {
    container.scrollLeft = phX - containerWidth / 2;
  }
}
