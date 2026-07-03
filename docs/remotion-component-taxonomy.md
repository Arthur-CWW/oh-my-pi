# Remotion Layer-Primitive Taxonomy

This document defines the composable layer primitives used to assemble short-form documentary recreations in Remotion. Every beat in a layer plan is a stack of these primitives rendered back-to-front. The goal is to replace monolithic scene components with small, inspectable, reusable layers that can be mixed, timed, and debugged independently.

---

## 1. Composition model

### 1.1 Layer stack

Each beat renders a fixed list of layers in ascending `zIndex` order. The renderer is responsible for wrapping each layer in a Remotion `<Sequence>` with the beat's absolute time range and applying the layer's `in` and `out` animation envelopes.

```text
z 0  BackgroundLayer      (solid, gradient, or subtle grain)
z 1  PlateLayer           (B-roll still / video, Ken Burns, parallax)
z 2  PresenterLayer       (A-roll host / synthetic talking head)
z 3  GridOverlay          (optional informational grid)
z 4  DocumentLayer        (paper, card, seal, stamp)
z 5  DiagramLayer         (chart, flow, hierarchy)
z 6  MapLayer             (region highlight, marker drop)
z 7  CounterLayer         (animated number)
z 8  TypographyLayer      (caption, title, subtitle)
z 9  FlashOverlay         (full / edge flash, transition accent)
z 10 SplitRevealLayer     (wipe / panel reveal between beats)
```

### 1.2 A-roll vs B-roll separation

| Mode | Dominant layer | Background layer rule |
|---|---|---|
| `a_roll` | `PresenterLayer` | `PlateLayer` is dimmed, blurred, or desaturated; opacity ≤ 0.35. |
| `b_roll` | `PlateLayer` | `PresenterLayer` absent or used only as a small side panel. |
| `mixed` | Both share focus | `PlateLayer` at 0.45–0.65 opacity with a dark gradient vignette; `PresenterLayer` occupies no more than 40 % of frame width. |

### 1.3 Motion budget

- One **dominant** motion per beat (e.g. a Ken Burns pan, a counter, or a text stagger).
- Transitions last 0.3–0.8 s.
- Avoid moving text and moving background in the same direction.
- Flash overlays and SFX are synced to narration emphasis, not decorative.

### 1.4 Layer envelope schema

Every layer accepts at least:

```ts
{
  type: string;
  zIndex: number;
  in: { variant: string; durationSeconds: number; delaySeconds: number };
  out: { variant: string; durationSeconds: number; delaySeconds: number };
  props: Record<string, unknown>;
}
```

`in` / `out` durations are relative to the beat start and end. `delaySeconds` offsets the trigger after the beat begins.

---

## 2. Primitives

### 2.1 `BackgroundLayer`

Solid or textured backdrop. Always at `zIndex` 0.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `color` | `string` | CSS color (hex, rgb, rgba). |
| `gradient` | `{ from: string; to: string; angle?: number }` | Optional linear gradient override. |
| `noise` | `{ opacity: number; size: number }` | Optional film grain / noise texture. |
| `vignette` | `{ strength: number; color: string }` | Dark edge falloff. |

**Animation variants**

- `fade` — opacity 0 → 1.
- `colorShift` — animate `gradient` stop colors.
- `pulse` — slow opacity oscillation for tense passages.

**Combination rules**

- Required on every beat.
- Must not animate if a `PlateLayer` is already animating.

---

### 2.2 `PlateLayer`

A still image or video plate used for B-roll. This is the primary visual evidence layer.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `src` | `string` | Asset path or URL. |
| `fit` | `"cover" \| "contain" \| "fill"` | Object fit. |
| `opacity` | `number` | 0–1. |
| `kenBurns` | `{ start: Rect; end: Rect; easing: string }` | Animated crop / pan. Rect = `{ x, y, scale }` normalized to frame. |
| `desaturate` | `number` | 0 = color, 1 = B&W. |
| `overlayColor` | `string` | Tint overlay, e.g. `rgba(10,10,12,0.45)`. |
| `blur` | `number` | Gaussian blur px. |

**Animation variants**

- `none` — static.
- `slowZoom` — `start.scale` → `end.scale` over beat duration.
- `pan` — translate from `start` to `end`.
- `parallax` — subtle opposite-direction motion to foreground text.
- `flashIn` — 0 opacity → full with a single-frame bright flash.

**Combination rules**

- In `a_roll` mode, opacity ≤ 0.35 and blur ≥ 2 px.
- Only one `PlateLayer` per beat unless used in a cross-fade transition.
- Ken Burns must stay within safe margins (no hard edge creep).

---

### 2.3 `PresenterLayer`

A-roll host or synthetic presenter. If no real footage exists, this layer renders a generated / placeholder bust with a mask.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `src` | `string \| null` | Video or image path; `null` triggers placeholder. |
| `placeholder` | `{ kind: "bust" \| "silhouette" \| "avatar"; color: string }` | Used when `src` is null. |
| `position` | `"center" \| "lowerThird" \| "sideLeft" \| "sideRight"` | Frame region. |
| `mask` | `"circle" \| "roundedRect" \| "soft"` | Edge treatment. |
| `shadow` | `{ color: string; blur: number; x: number; y: number }` | Contact shadow. |
| `scale` | `number` | Relative size. |

**Animation variants**

- `slideUp` — enter from bottom.
- `slideInSide` — enter from configured side.
- `fade` — opacity only.
- `subtleBreath` — tiny continuous scale/y oscillation to avoid deadness.

**Combination rules**

- Required for `a_roll` beats; optional in `mixed`.
- Must be partially overlapped by typography, never fully covered.
- Placeholder mode should be flagged so the renderer can substitute a generated asset later.

---

### 2.4 `TypographyLayer`

Text overlays: titles, captions, subtitles, labels.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `lines` | `{ text: string; variant: "title" \| "caption" \| "label" \| "pinyin"; color?: string }[]` | Text lines, top-to-bottom. |
| `fontFamily` | `"serif" \| "sans" \| "mono"` | Global fallback stack. |
| `align` | `"left" \| "center" \| "right"` | Horizontal alignment. |
| `position` | `{ x: number; y: number; anchor: string }` | Normalized coordinates + anchor. |
| `maxWidth` | `number` | 0–1 relative to frame width. |
| `lineHeight` | `number` | Multiplier. |
| `textShadow` | `{ color: string; blur: number }` | Legibility shadow. |
| `stroke` | `{ color: string; width: number }` | Outline for high-contrast moments. |

**Animation variants**

- `fadeUp` — opacity + translateY.
- `staggerLines` — each line enters 0.08–0.15 s after the previous.
- `typewriter` — characters reveal sequentially.
- `scalePop` — overshoot scale on enter.
- `slideIn` — from left/right.

**Combination rules**

- Max two active `TypographyLayer`s per beat (one primary, one label).
- Titles use `serif` + `scalePop`; captions use `sans` + `fadeUp`.
- Pinyin overlays should be smaller, mono-spaced, and slightly dim.

---

### 2.5 `CounterLayer`

Animated number reveal for statistics.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `value` | `number` | Final value. |
| `startValue` | `number` | Starting value; defaults to 0. |
| `prefix` | `string` | e.g. "$", "¥". |
| `suffix` | `string` | e.g. "%", "×", " billion". |
| `decimals` | `number` | 0, 1, 2. |
| `formatter` | `"compact" \| "percent" \| "plain"` | Display formatting. |
| `color` | `string` | Number color. |
| `label` | `string` | Optional small label below the number. |
| `pulseOnComplete` | `boolean` | Brief scale pulse when target reached. |

**Animation variants**

- `countUp` — numeric interpolation.
- `odometer` — vertical digit scroll.
- `tick` — integer ticks with frame holds.
- `pulse` — value arrives with a flash.

**Combination rules**

- Pair with a `TypographyLayer` that explains the unit.
- Use `tick` for years / unemployment; `countUp` for currency / ratios.
- Do not run more than one counter at a time.

---

### 2.6 `DiagramLayer`

Data visualization: bar, line, flow, hierarchy, or comparison.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `kind` | `"bar" \| "line" \| "pie" \| "flow" \| "hierarchy" \| "venn"` | Diagram type. |
| `data` | `unknown[]` | Series / nodes / edges. |
| `colors` | `string[]` | Accent palette. |
| `axes` | `{ showX: boolean; showY: boolean; labels: string[] }` | Axis configuration. |
| `labels` | `{ position: string; format: string }` | Data label style. |
| `animate` | `boolean` | Grow / draw on enter. |

**Animation variants**

- `growBars` — height 0 → value.
- `drawLine` — path stroke draw.
- `revealNodes` — nodes fade in, edges follow.
- `wipe` — left-to-right reveal.

**Combination rules**

- Keep diagrams simple (≤5 bars, ≤4 nodes) for short beats.
- Must include a title via a linked `TypographyLayer`.
- Use the beat accent color for the most important element.

---

### 2.7 `MapLayer`

Stylized region / city highlight, not a full GIS map.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `region` | `string` | Logical region name, e.g. `"china-tier-1"`. |
| `baseColor` | `string` | Map fill. |
| `highlightColor` | `string` | Selected region. |
| `markers` | `{ id: string; x: number; y: number; label?: string }[]` | Normalized marker positions. |
| `labels` | `{ text: string; x: number; y: number }[]` | Region labels. |
| `zoom` | `{ x: number; y: number; scale: number }` | Animated focus region. |

**Animation variants**

- `pinDrop` — markers fall in with a small bounce.
- `regionPulse` — highlighted region throbs.
- `pathTrace` — draw a route between markers.
- `zoomTo` — animated zoom into a marker cluster.

**Combination rules**

- Use only when geography is part of the argument.
- Keep labels minimal; rely on a `TypographyLayer` for explanation.

---

### 2.8 `TimelineLayer`

Horizontal or vertical event timeline.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `orientation` | `"horizontal" \| "vertical"` | Layout. |
| `events` | `{ year: number; label: string; active?: boolean }[]` | Chronological points. |
| `activeIndex` | `number` | Currently highlighted event. |
| `connectorColor` | `string` | Line color. |
| `markerStyle` | `"dot" \| "flag" \| "stamp"` | Marker shape. |

**Animation variants**

- `tickThrough` — progress line advances to active event.
- `expandNode` — active marker scales up.
- `focusActive` — non-active events dim.

**Combination rules**

- Use with `DocumentLayer` for directive / policy cards.
- Avoid more than 6 events on a single beat.

---

### 2.9 `FlashOverlay`

Momentary light / color burst for emphasis or transition punctuation.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `color` | `string` | Flash color. |
| `intensity` | `number` | 0–1 opacity peak. |
| `shape` | `"full" \| "edges" \| "center" \| "bars"` | Coverage shape. |
| `durationSeconds` | `number` | Flash hold + fade. |
| `blendMode` | `"normal" \| "screen" \| "overlay"` | CSS blend mode. |

**Animation variants**

- `hardCut` — single frame full intensity.
- `fadeBurst` — quick rise and fall.
- `strobe` — 2–3 rapid flashes (use sparingly).
- `edgeFlash` — bright vertical / horizontal bands.

**Combination rules**

- Must be triggered by a specific narration emphasis, not random.
- Do not stack multiple `FlashOverlay`s in one beat.
- White or accent-color only; match the beat's emotional register.

---

### 2.10 `SplitRevealLayer`

Wipe / panel transition between two visual states. This can be a beat-level transition or an internal reveal within a beat.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `direction` | `"left" \| "right" \| "up" \| "down" \| "diagonal" \| "blinds"` | Reveal direction. |
| `panels` | `number` | Number of slices / blinds. |
| `gap` | `number` | Pixel gap between panels. |
| `staggerSeconds` | `number` | Delay between panel reveals. |
| `fromPlate` | `string` | Source plate path (optional). |
| `toPlate` | `string` | Target plate path (optional). |

**Animation variants**

- `horizontalWipe` — single horizontal sweep.
- `verticalBlinds` — slatted vertical reveal.
- `diagonalSlice` — angled panels.
- `shutter` — panels open from center.

**Combination rules**

- Typically occupies the top of the stack during a transition.
- If `fromPlate` / `toPlate` are omitted, the renderer reveals the next beat's plate underneath.

---

### 2.11 `DocumentLayer`

Paper, card, decree, hukou, or official document visual.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `title` | `string` | Document header. |
| `body` | `string[]` | Body lines. |
| `seal` | `{ text: string; color: string }` | Circular / rectangular stamp. |
| `paperTexture` | `"plain" \| "lined" \| "aged" \| "official"` | Background style. |
| `folds` | `boolean` | Subtle crease shadows. |
| `rotate` | `number` | Slight tilt in degrees. |

**Animation variants**

- `unroll` — height expands from 0.
- `stamp` — seal stamps down with a small shake.
- `typeOnPaper` — body lines type out.
- `shuffle` — document slides in from a stack.

**Combination rules**

- Place above plate, below typography when typography comments on the document.
- Use `rotate` ≤ 3° to avoid looking broken.

---

### 2.12 `GridOverlay`

Subtle or analytical grid for visual structure.

**Core props**

| Prop | Type | Description |
|---|---|---|
| `color` | `string` | Grid line color. |
| `opacity` | `number` | 0–1. |
| `divisions` | `{ x: number; y: number }` | Number of cells. |
| `perspective` | `boolean` | Perspective floor / wall grid. |
| `animate` | `"none" \| "pulse" \| "draw"` | Entrance behavior. |

**Animation variants**

- `subtle` — static low-opacity lines.
- `dataGrid` — lines align to chart axes.
- `perspective` — converging lines.
- `pulse` — brief opacity oscillation on enter.

**Combination rules**

- Opacity ≤ 0.12 when behind text.
- Use `perspective` only with plate layers that have a horizontal subject.

---

## 3. Recommended pairings

| Narrative need | Typical stack |
|---|---|
| Hook title over B-roll | `BackgroundLayer` → `PlateLayer` → `GridOverlay` → `TypographyLayer` → `FlashOverlay` |
| Host explains data | `BackgroundLayer` → dimmed `PlateLayer` → `PresenterLayer` → `DiagramLayer` / `CounterLayer` → `TypographyLayer` |
| Statistic reveal | `BackgroundLayer` → `PlateLayer` → `TypographyLayer` → `CounterLayer` → `FlashOverlay` |
| Timeline policy | `BackgroundLayer` → `TimelineLayer` → `DocumentLayer` → `TypographyLayer` |
| Before / after censorship | `BackgroundLayer` → `PlateLayer` → `SplitRevealLayer` → `TypographyLayer` |
| Final synthesis | `BackgroundLayer` → dimmed `PlateLayer` → `PresenterLayer` → `TypographyLayer` → subtle `FlashOverlay` |

---

## 4. Renderer contract

A renderer consuming a layer plan must support:

1. Reading `beat.timeRange` as absolute `[fromSeconds, toSeconds)`.
2. Rendering each layer's `in` animation at beat start and `out` animation before beat end.
3. Respecting `zIndex` order and alpha blending.
4. Substituting `PresenterLayer.src: null` with a configured placeholder.
5. Resolving relative `PlateLayer.src` paths against the project root.
6. Ignoring unknown layer props rather than failing (forward compatibility).
