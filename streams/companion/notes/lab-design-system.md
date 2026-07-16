# Motion Lab design system

`apps/ai-companion-rtc/public/lab/lab.css` is the current source stylesheet for the Motion Lab; `bun run build:lab` emits it as `/dist/lab.css`, and `lab.html` loads that bundle. Keep the shared tokens and primitives here aligned with the `public/lab/` components.

## Laws

1. **Radius is structural, not decorative.** Use 0px for rails/tabs/tracks, 2px for controls and clips, and at most 4px for panels. Pills are reserved for circular status dots; do not make capsule buttons or badges.
2. **One hairline per visual group.** A group gets a background shade, not a box outline. Use `.hairline`, a tab underline, or a boundary between adjacent tracks only when a divider conveys structure. Never put borders on nested containers.
3. **Elevation comes from the surface ladder.** `bg0` is the app, `bg1` the work area, `bg2` a panel/group, `bg3` a control, and `bg4` hover/selection/raised content. Shadows are reserved for transient overlays such as tooltips.
4. **Spacing uses 2/4/6/8/12px only.** A dense editor should reveal hierarchy through alignment and shade, not empty space. Default panel padding is 8px; 12px is for major pane separation only.
5. **Type is compact and hierarchical.** Use 11px for control/meta copy, 12px for normal UI, 13px for emphasized rows, and 15px for pane titles. Use weight before increasing size.
6. **Icons lead actions.** Unambiguous actions are icon-only buttons with `aria-label` and `.tooltip`. Add visible text only where the operation would otherwise be ambiguous. The accent is for current/live state, not decoration.
7. **States must not rely on color alone.** Pair color with a selected edge, icon, label, or status dot. Every interactive element must retain the shared focus ring.

## Tokens

| Family | Tokens | Meaning |
| --- | --- | --- |
| Surface | `--lab-bg-0` … `--lab-bg-4` | Warm-dark elevation ladder, darkest to lightest |
| Lines | `--lab-line`, `--lab-line-strong` | Dividers and the rare control outline |
| Text | `--lab-text`, `--lab-text-secondary`, `--lab-text-muted` | Primary, supporting, and metadata text |
| Accent | `--lab-accent`, `--lab-accent-hover`, `--lab-accent-ink` | Selected/live action and readable ink on accent |
| Semantic | `--lab-live`, `--lab-success`, `--lab-warn`, `--lab-error` | Runtime and validation state |
| Focus | `--lab-focus` | Shared 2px keyboard focus ring |
| Radius | `--lab-radius-0`, `--lab-radius-2`, `--lab-radius-4` | Rails, controls, panels |
| Space | `--lab-space-2`, `--lab-space-4`, `--lab-space-6`, `--lab-space-8`, `--lab-space-12` | The complete spacing scale |
| Type | `--lab-type-11`, `--lab-type-12`, `--lab-type-13`, `--lab-type-15` | Meta, body, emphasis, title |
| Weight | `--lab-weight-normal`, `--lab-weight-medium`, `--lab-weight-strong` | 450, 600, 700 |
| Control | `--lab-control-sm`, `--lab-control` | 24px and 28px control heights |

## Components

- `.btn` with `.btn--sm`, `.btn--quiet`, `.btn--solid`, or `.btn--danger`
- `.chip` for compact filters/toggles
- `.field` for inputs, selects, and textareas
- `.slider` for range inputs
- `.group` and `.group__heading` for one shade-step section, without a border
- `.hairline` for the single intentional divider in a group
- `.badge` with `.badge--live`, `.badge--success`, `.badge--warn`, or `.badge--error`
- `.tooltip[data-tooltip]` for terse hover/focus help
- `.tabs` and `.tab[aria-selected]`
- `.track` and `.clip`, with optional `.clip--video`, `.clip--audio`, and `.clip--motion`

## Standalone gallery

This markup is a historical token gallery, retained as a design reference rather than a served route. The live surface is `/lab` and its implementation lives under `apps/ai-companion-rtc/public/lab/`.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/dist/lab.css">
  <title>Lab system gallery</title>
</head>
<body class="lab-body">
  <main style="max-width:560px;margin:12px auto;display:grid;gap:12px">
    <nav class="tabs" aria-label="Gallery sections">
      <button class="tab" aria-selected="true">Motion</button>
      <button class="tab" aria-selected="false">Face</button>
    </nav>

    <section class="group">
      <h2 class="group__heading">
        Transport
        <span class="badge badge--live">Live</span>
      </h2>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="btn btn--solid tooltip" aria-label="Play" data-tooltip="Play">
          <svg class="icon" aria-hidden="true"><use href="/icons/icons.svg#play"></use></svg>
        </button>
        <button class="btn btn--quiet tooltip" aria-label="Pause" data-tooltip="Pause">
          <svg class="icon" aria-hidden="true"><use href="/icons/icons.svg#pause"></use></svg>
        </button>
        <button class="btn btn--danger tooltip" aria-label="Record" data-tooltip="Record">
          <svg class="icon" aria-hidden="true"><use href="/icons/icons.svg#record"></use></svg>
        </button>
        <button class="chip" aria-pressed="true">Loop</button>
      </div>
      <hr class="hairline">
      <label style="display:grid;gap:4px;color:var(--lab-text-secondary)">
        Intensity <input class="slider" type="range" value="65">
      </label>
      <input class="field" value="Idle → greet" aria-label="Clip name">
    </section>

    <section class="group">
      <h2 class="group__heading">Timeline <span class="badge">00:04.8</span></h2>
      <div class="track" style="height:32px">
        <div class="clip clip--motion is-selected" style="left:8%;width:46%">Greeting</div>
      </div>
      <div class="track" style="height:32px">
        <div class="clip clip--audio" style="left:24%;width:58%">Voice</div>
      </div>
    </section>
  </main>
</body>
</html>
```

The TypeScript helper creates the same sprite markup safely:

```ts
import { icon } from "./icons.ts";

const play = document.querySelector<HTMLButtonElement>("#play");
play?.prepend(icon("play"));
```

Put the accessible label on the owning button; `icon()` intentionally returns a presentational `aria-hidden` SVG.

## Icon inventory

The sprite is `/icons/icons.svg`. Reference a symbol with `<svg class="icon" aria-hidden="true"><use href="/icons/icons.svg#play"></use></svg>`.

Available IDs: `play`, `pause`, `stop`, `square`, `skip-back`, `skip-forward`, `record`, `circle`, `scissors`, `video`, `music`, `user`, `user-round`, `face`, `scan-face`, `bone`, `skeleton`, `person-standing`, `eye`, `eye-off`, `sliders-horizontal`, `zoom`, `zoom-in`, `zoom-out`, `layers`, `activity`, `cpu`, `folder`, `download`, `refresh`, `refresh-cw`, `lock`, `chevron-left`, `chevron-right`, `chevron-up`, `chevron-down`, `x`, `check`, and `sparkles`.

The artwork is vendored from Lucide 0.468.0 under its ISC license; the source/license notice remains in the sprite.

## Building future panels

1. Start with one `.group` per semantic section. Do not put another framed card inside it.
2. Give the section a `.group__heading`; put status or a single compact action at its right edge.
3. Lay out rows on the spacing scale. Use a shade step to separate regions; add at most one `.hairline` when the regions need an explicit boundary.
4. Use the shared primitives without overriding their height, radius, or border. Panel CSS should define layout, not restyle controls.
5. For an icon-only action, use `.btn.btn--quiet.tooltip`, `aria-label`, `data-tooltip`, and a sprite icon. For dangerous actions, change only the variant.
6. Use `.tabs` for sibling views, `.chip` for compact modes/filters, and `.badge` for non-interactive state. Do not use chips as status decoration.
7. Add a new token or primitive only when at least two panels share the need. Additive panel-specific colors must derive from the surface ladder or a semantic token.
