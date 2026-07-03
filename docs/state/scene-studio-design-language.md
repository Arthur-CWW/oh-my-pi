# Scene Studio Design Language

Extracted from Open Design (vendor/nexu-io--open-design) via live boot +
static design-system analysis. Sources: OD web app runtime tokens (dark mode),
OD design-systems/default, linear-app, cursor, mission-control, hud, plus
the OD primitives/components CSS.

## Extraction Path

**Live boot succeeded.** Open Design daemon + Next.js web runtime started via
`pnpm tools-dev start web --namespace agents-local` on Node 24.13.1 / pnpm
10.33.2. Computed CSS custom properties extracted from the running dark-mode
page. Static analysis of design-systems/** for supplementary palette/component
data.

---

## Alive software (Bret Victor)

The studio designs against dead software. Creation is mediated by direct
interaction with the artifact, not by staring at code; every control gives
immediate visible feedback; the artifact is always live. The design telos:
**make small edits and play with artifacts/workflows feel immediate for a
vim-native power user.**

- Every property change in the inspector is reflected in the Three.js viewport
  within the same frame — no compile step, no save-and-reload loop.
- Transport controls (play/pause, scrub, beat tap) manipulate the live scene
  directly; the timeline is not a representation of the scene, it IS the scene
  state unfolded over time.
- Vim-style keyboard interaction is a first-class design constraint: `j`/`k`
  list navigation, modal focus (inspector vs. tree vs. viewport), keymap
  overlay accessible via `?`. All panel focus transitions must be instant
  (no 200ms ease-in that would feel sluggish under rapid `Ctrl-w` cycling).
- The editor should feel like a musical instrument: low latency, muscle memory,
  no confirmation dialogs in the hot path.

---

## 1. Palette

### OD App Chrome (dark mode — computed from running instance)

| Token | Hex | Role |
|-------|-----|------|
| `--bg` / `--bg-app` | `#1a1917` | App canvas, deepest surface |
| `--bg-panel` | `#222120` | Panel/sidebar background |
| `--bg-subtle` | `#252321` | Hover/secondary surface |
| `--bg-muted` | `#2e2c29` | Tertiary fill, pressed states |
| `--bg-elevated` | `#2a2825` | Floating/elevated surfaces |
| `--bg-fill-tertiary` | `rgba(255,255,255,0.06)` | Lightest translucent fill |
| `--bg-fill-secondary` | `rgba(255,255,255,0.10)` | Mid translucent fill |
| `--bg-fill` | `rgba(255,255,255,0.16)` | Heavy translucent fill |

### Text

| Token | Hex | Role |
|-------|-----|------|
| `--text` | `#e8e4dc` | Primary text (warm off-white) |
| `--text-strong` | `#f2ede4` | Emphasized headings |
| `--text-muted` | `#9a9690` | Secondary / labels |
| `--text-soft` | `#6e6b65` | Tertiary / captions |
| `--text-faint` | `#4e4b46` | Placeholder / disabled |

### Borders

| Token | Hex | Role |
|-------|-----|------|
| `--border` | `#333128` | Standard panel divider |
| `--border-strong` | `#46433c` | Emphasized / hover borders |
| `--border-soft` | `#2a2825` | Subtle inner separator |

### Accent (OD brand orange)

| Token | Value | Role |
|-------|-------|------|
| `--accent` | `#c96442` | Primary CTA / brand action |
| `--accent-strong` | lighter via color-mix | Hover state |
| `--accent-soft` | darker tint | Soft background |
| `--accent-tint` | muted tint | Ghost button hover fill |

### Semantic Status

| Token | Hex | Role |
|-------|-----|------|
| `--green` | `#4caf72` | Success |
| `--red` | `#e06b65` | Error / danger |
| `--amber` | `#e09a40` | Warning |
| `--blue` | `#6b8fe8` | Info / selected |
| `--purple` | `#a87dd4` | Special / brand accent 2 |

### Selected State (separate from accent)

| Token | Value | Role |
|-------|-------|------|
| `--selected` | `#2563eb` | Active option indicator |
| `--selected-soft` | `rgba(37,99,235,0.16)` | Selection tint fill |

### OD App Chrome (light mode — from tokens.css)

| Token | Hex |
|-------|-----|
| `--bg` / `--bg-app` | `#faf9f7` |
| `--bg-panel` | `#fdfcfa` |
| `--bg-subtle` | `#f4f5f7` |
| `--text` | `#1a1916` |
| `--text-muted` | `#74716b` |
| `--accent` | `#c96442` |
| `--border` | `#e1e5eb` |

### Reference: Linear (dark-mode-native editor)

| Role | Hex | Notes |
|------|-----|-------|
| Background | `#08090a` | Near-black canvas |
| Surface | `#191a1b` | Cards, dropdowns |
| Text primary | `#f7f8f8` | Not pure white |
| Text secondary | `#d0d6e0` | Silver-gray |
| Text tertiary | `#8a8f98` | Muted |
| Text quaternary | `#62666d` | Timestamps |
| Border | `rgba(255,255,255,0.08)` | Semi-transparent white |
| Border soft | `rgba(255,255,255,0.05)` | Ultra-subtle |
| Accent | `#5e6ad2` | Indigo-violet CTA |
| Accent hover | `#828fff` | Lighter interactive |
| Button bg | `rgba(255,255,255,0.02)` | Near-invisible fill |

### Reference: Mission Control (dense telemetry)

| Role | Hex |
|------|-----|
| Background | `#090b12` / `#0B1120` |
| Surface | `#121722` / `#111827` |
| Data primary | `#FFB800` (amber) |
| Data secondary | `#00D4FF` (cyan) |
| Alert | `#FF4757` |
| Text primary | `#E8F0FE` |
| Text secondary | `#8BA3C7` |

---

## 2. Typography

### OD Web App Font Stacks

```
--sans:  -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI",
         "Noto Sans", Roboto, "Helvetica Neue", Arial, sans-serif
--serif: "Source Serif Pro", "Source Serif 4", "Iowan Old Style",
         "Apple Garamond", Georgia, "Times New Roman", serif
--mono:  ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace
```

### OD Design System Default (artifact generation)

```
--font-display: "Inter", -apple-system, system-ui, sans-serif  (weight 600)
--font-body:    "Inter", -apple-system, system-ui, sans-serif  (weight 400)
--font-mono:    ui-monospace, "JetBrains Mono", monospace
```

### OD App Body Size

- Base font-size: **13.5px** (body), line-height 1.5
- Code font-size: **13px**, line-height 1.65
- Prose font-size: **15px**, line-height 1.75

### OD Design System Type Scale (px)

```
--text-xs:   12    --text-sm:   14    --text-base: 16
--text-lg:   20    --text-xl:   24    --text-2xl:  32
--text-3xl:  48    --text-4xl:  64
```

### Mission Control Type Scale (dense variant)

```
--text-xs:   11    --text-sm:   12    --text-base: 14
--text-lg:   16    --text-xl:   20    --text-2xl:  28
--text-3xl:  40    --text-4xl:  56
```

### Leading / Tracking

| Token | OD Default | Linear | Mission Control |
|-------|-----------|--------|-----------------|
| `--leading-body` | 1.5 | 1.5 | 1.45 |
| `--leading-tight` | 1.2 | 1.00 | 1.06 |
| `--tracking-display` | -0.01em | -0.022em | -0.025em |

### Typography patterns worth noting

- **Linear's weight 510**: a custom intermediate weight between regular (400)
  and medium (500). Creates subtle emphasis without heaviness.
- **Cursor's three-voice system**: gothic display, serif body, mono code. Each
  serves a distinct role.
- **Mission Control**: monospace for ALL data readouts, sans for labels only.
  Panel titles are 13px uppercase 600-weight tracked at 0.08em.
- **HUD**: monospace everywhere (IBM Plex Mono / JetBrains Mono), uppercase
  labels at 10px, display at 32px weight 700.

---

## 3. Spacing Scale

OD uses a 4px base grid, consistent across all design systems:

```
--space-1:   4px     --space-2:   8px     --space-3:  12px
--space-4:  16px     --space-5:  20px     --space-6:  24px
--space-8:  32px     --space-12: 48px     --space-20: 80px
```

### OD App Chrome Specific Measurements (from CSS)

- Tab chrome height: **38px** (workspace-tabs-chrome)
- Tab button size: **28x28px**
- Tab padding: `0 8px 0 6px`
- Drawer width: `min(456px, 92vw)`
- Drawer height: `clamp(480px, 68vh, 640px)`
- Panel internal padding: 22px (drawer head), 14px gap
- Eyebrow labels: 11px / 500 weight / 0.02em tracking / uppercase

### Mission Control Panel Structure

- Panel padding: 16px (`--space-4`)
- Panel header margin-bottom: 12px, padding-bottom: 8px
- Panel title: 13px / 600 weight / uppercase / 0.08em tracking
- Grid gap: 8px between telemetry cells

---

## 4. Panel Chrome

### Borders

- **Standard**: `1px solid var(--border)` — `#333128` dark, `#e1e5eb` light
- **Emphasized**: `var(--border-strong)` — `#46433c` dark
- **Subtle**: `var(--border-soft)` — `#2a2825` dark
- **Half-pixel trick**: OD uses `transform: scaleY(0.5)` on 1px pseudo-elements
  for ultra-thin dividers (see shell.css workspace-tabs-chrome::after)
- **color-mix borders**: `color-mix(in srgb, var(--border) 64%, transparent)`
  for translucent edges

### Radii

| Token | Size | Usage |
|-------|------|-------|
| `--radius-xs` | 4px | Inline code, micro-chips |
| `--radius-sm` | 6px | Buttons, inputs, controls |
| `--radius` | 8px | Cards, menus, general containers |
| `--radius-md` | 10px | Medium containers |
| `--radius-lg` | 12px | Large panels, drawers |
| `--radius-pill` | 999px | Pills, status chips |

### Shadows

| Token | Dark Mode Value |
|-------|----------------|
| `--shadow-xs` | `0 1px 0 rgba(0,0,0,0.2)` |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.2)` |
| `--shadow-md` | `0 6px 24px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.25)` |
| `--shadow-lg` | `0 24px 60px rgba(0,0,0,0.6), 0 8px 16px rgba(0,0,0,0.3)` |

### Panel Headers (OD Drawer Pattern)

- Background: `color-mix(in srgb, var(--bg-subtle) 36%, var(--bg-panel))`
- Bottom border: `1px solid color-mix(in srgb, var(--border) 70%, transparent)`
- Title: 21px / 600 weight / line-height 1.2
- Eyebrow: 11px / 500 weight / uppercase / 0.02em tracking / `--text-faint`
- Status chips: 24px min-height, pill radius, 3px 9px padding

---

## 5. Control Styles

### Buttons (OD primitives)

| Variant | Background | Border | Text | Padding |
|---------|-----------|--------|------|---------|
| Default | `--bg-panel` | `1px solid --border` | `--text` | 6px 12px |
| Primary | `--accent` | `--accent` | white, 500 weight | 6px 12px |
| Primary ghost | `--bg-panel` | `--accent` | `--accent`, 500 weight | 6px 12px |
| Ghost | transparent | `--border` | `--text` | 6px 12px |
| Subtle | `--bg-subtle` | transparent | `--text` | 6px 12px |
| Icon | — | — | — | 6px 10px, 13px font |
| Disabled | — | — | — | opacity: 0.5 |

All buttons: `border-radius: var(--radius-sm)` (6px).
Transition: `background/border-color/color/box-shadow 120ms var(--ease-out)`.
Focus: `outline: 2px solid var(--accent); outline-offset: 2px`.
Hover: `background: var(--bg-subtle); border-color: var(--border-strong)`.

### Inputs

- Background: `--bg-panel`
- Border: `1px solid --border`, radius `--radius-sm` (6px)
- Padding: `7px 10px`
- Placeholder color: `--text-faint`
- Focus: border-color shifts to `--selected` (`#2563eb`)
- Transition: `border-color/box-shadow 120ms ease`

### Select (Custom)

OD implements a custom select component (`.od-select`):
- Trigger: styled like input, padding 7px 10px, flex with chevron SVG
- Chevron rotates 180deg on expand
- Menu: `--bg-panel` background, `1px solid --border`, radius `--radius`,
  shadow `--shadow-md`, max-height 320px with scroll
- Options: 7px 10px padding, hover `--bg-subtle`
- Selected: check icon at 12px, `--accent` color
- Group labels: 11px / 500 weight / uppercase / `--text-faint`

### Sliders (inferred from OD design-system patterns)

Not directly present in OD web chrome. Mission Control uses:
- Track: 2px height, `--border` color
- Thumb: 12px circle, `--accent` fill, 2px border
- Active range: `--accent` fill

---

## 6. Layer List & Inspector Interaction Patterns

### Tab Chrome (worth stealing)

OD's workspace tabs behave like browser tabs:
- 38px chrome height, horizontally scrollable strip
- Active tab: darker background, no bottom border (merges with content)
- Tab close button: appears on hover only
- New tab "+": 28x28px, sticky right when strip overflows
- Overflow: fade shadow (`-8px 0 10px -9px color-mix(...)`) on the "+" button
- App-region drag on the chrome strip for window dragging

### Drawer / Inspector Pattern

- Slides in from right: `translateX(18px)` to `translateX(0)`, 220ms ease-out
- Backdrop: 18% dark overlay with 1px blur
- Width: `min(456px, 92vw)` — responsive bounded
- Height: `clamp(480px, 68vh, 640px)`
- Header structure: icon + titles column (eyebrow + h2) + status chips
- Sections separated by subtle border-bottom
- Close button: top-right, icon-only

### Tool/Status Pills (worth stealing)

Per-semantic tinted chips with a consistent pattern:
- Background: semantic color at ~15% opacity (e.g. `rgba(38,222,129,0.15)`)
- Text: full semantic color
- Border: semantic color at ~30% opacity
- Font: 10-11px, 600 weight, uppercase, 0.05em tracking
- Radius: 2px (badge) or pill (tag)

### Design System Selector

OD uses a select-style dropdown for switching design systems, styled as:
- Pill-shaped trigger with current system name
- Dropdown with grouped options (categories)
- Selected state: check mark + accent tint background

---

## 7. Iconography Approach

OD uses **Remix Icon** (remixicon.woff2, 184KB webfont):
- Icon font referenced via CSS classes (`ri-*`)
- Consistent 16px base size, sometimes 14px or 12px
- Color inherits from `currentColor`
- Used in tab chrome, buttons, status indicators, navigation
- No SVG icon system — purely font-based

For mission-critical data display, Mission Control and HUD use inline SVGs for
precision alignment at small sizes.

---

## 8. Motion

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Canonical UI ease |
| `--dur-quick` | 120ms | Hover, focus, micro-states |
| `--dur-enter` | 200ms | Panel/drawer entrance |
| `--dur-exit` | 140ms | Dismissal (faster = decisive) |

OD animation philosophy:
- Default ease-out for ALL UI transitions (not ease-in, which feels sluggish)
- Asymmetric: enter ~200ms, exit ~140ms
- Accordion: `grid-template-rows: 0fr → 1fr` with opacity fade
- Never animate from `scale(0)` — start from `scale(0.9)` minimum
- Keep elements mounted, toggle CSS class for exit transitions

---

## Adaptation Notes: Scene Studio Context

Our context: a **dark, dense, monospace-forward editor** for beat-synced
Three.js scenes. Think: a timeline editor crossed with a scene graph
inspector, not a chat/artifact viewer. Key adaptation decisions:

### Surface palette adaptation

Take OD's warm dark palette (`#1a1917` family) but shift slightly cooler for a
code-editor feel. OD's warm browns suit a product workspace; our Three.js
editor needs the neutrality of a code environment. Reference Linear's
near-black `#08090a` but don't go that dark — we need panel differentiation.
Target: `#0f1012` canvas, `#18191c` panels, `#1e2024` raised surfaces.

### Typography adaptation

- **Monospace primary**: all property values, timestamps, numeric readouts,
  code expressions use monospace (JetBrains Mono / Berkeley Mono fallback).
  This is the Mission Control / HUD pattern.
- **System sans for labels**: panel titles, section headers, UI chrome use
  system sans at 11-12px. No display font needed.
- **Dense base size**: 12px base (not 13.5px). Our panels show keyframe data,
  transform matrices, material properties — density matters.
- **Leading**: 1.4 for mono readouts, 1.2 for panel headers (tight).

### Accent adaptation

OD's brand orange (`#c96442`) is warm and assertive. For a code editor:
- Primary accent: a cool blue (`#5b8def`) — timeline playhead, selected
  keyframes, active inspector fields. Close to OD's `--selected` (`#2563eb`)
  but lighter for dark backgrounds.
- Secondary accent: a warm amber (`#d4a054`) — beat markers, audio waveform
  peaks. Nods to Mission Control's data-primary.
- Avoid two-accent confusion: blue = interactive selection, amber = temporal
  data. Never mixed.

### Spacing adaptation

Keep OD's 4px grid but use the Mission Control dense variant:
- 4px micro gaps inside controls
- 6px between control rows in inspector
- 8px panel internal padding (not 22px like OD drawers)
- 2px between timeline tracks

### Control adaptation

Steal OD's control patterns wholesale but tighten:
- Buttons: 4px 8px padding (not 6px 12px), radius 4px (not 6px)
- Inputs: 5px 8px padding, radius 4px
- Font size in controls: 11px
- Ghost/subtle variants are the default; primary is rare

### Border/panel adaptation

- Use semi-transparent white borders like Linear (`rgba(255,255,255,0.08)`)
  instead of OD's opaque warm browns — cleaner in a code editor context
- Panel headers: 11px uppercase, 500 weight, tracked — the Mission Control
  pattern
- No shadows between panels. Luminance stepping only (Linear's approach).
  Shadows reserved for floating surfaces (dropdowns, context menus).

### Interaction patterns to steal

1. **Tab chrome with overflow fade** (OD) — for scene tabs
2. **Status pills with semantic tints** (OD) — for render status, sync state
3. **Drawer slide-in from right** (OD) — for property inspector
4. **Dense telemetry grid** (Mission Control) — for transform/material readouts
5. **Half-pixel dividers** (OD) — `scaleY(0.5)` pseudo-elements between
   timeline tracks
6. **Custom select with grouped options** (OD) — for material/texture pickers

### What to avoid

- OD's warm brown color bias (suits product, not code)
- OD's generous padding (22px headers, 14px gaps) — too loose for our density
- OD's serif font stack — no editorial voice in a scene editor
- OD's brand orange as primary accent — too warm for technical precision
- Mission Control's amber-on-navy (too themed; we need neutral)
- HUD's phosphor green (game-y, not professional)
