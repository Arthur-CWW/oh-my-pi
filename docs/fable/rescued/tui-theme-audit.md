> Rescued 2026-07-13 from /Users/arthur/agents/local/tui-theme-audit.md

# TUI Theme Invalidation Audit

## Propagation Chain (macOS theme change)

```
MacAppearanceObserver (pi-natives FFI, CFDistributedNotificationCenter)
  -> callback(appearance)
  -> macOSReportedAppearance = appearance  [theme.ts:2438]
  -> reevaluateAutoTheme("macOS fallback") [theme.ts:2439]
     -> getDefaultTheme() -> detectTerminalBackground()
        Tier 1: terminalReportedAppearance (OSC 11)
        Tier 2: COLORFGBG env var
        Tier 3: macOSReportedAppearance (only in Zellij on macOS)
     -> loadTheme(resolved) [theme.ts:2415]
     -> theme = loadedTheme   [theme.ts:2417] (global var reassignment)
     -> notifyThemeChange()   [theme.ts:2418]
        -> themeEpoch++       [theme.ts:2322]
        -> onThemeChangeCallback?.() [theme.ts:2323]
```

**Important**: `shouldUseMacOSAppearanceFallback()` returns true ONLY when `process.platform === "darwin" && !!Bun.env.ZELLIJ`. So the MacAppearanceObserver is only started in Zellij on macOS. For non-Zellij terminals, theme changes come via:
- Mode 2031 push notifications -> 100ms debounce -> re-query OSC 11 -> handleOsc11Response -> appearance callback -> onTerminalAppearanceChange -> reevaluateAutoTheme
- OSC 11 polling (30s interval, only if Mode 2031 not confirmed) -> same path

## onThemeChange Callback (single subscriber)

Location: `interactive-mode.ts:854`
```ts
onThemeChange(() => {
    this.#clearWorkingMessageAccentCache();
    clearRenderCache();          // markdown L2 LRU
    this.ui.invalidate();        // marks all components dirty
    this.updateEditorBorderColor();
    this.ui.requestRender();
});
```

## Cache Inventory

### 1. Syntax Highlight Color Cache
- **File**: `theme.ts:2668-2689`
- **Vars**: `cachedHighlightColorsFor: Theme`, `cachedHighlightColors: NativeHighlightColors`
- **Key**: identity comparison `cachedHighlightColorsFor !== t`
- **Invalidation**: self-healing on next call when global `theme` changes (new Theme instance)
- **Risk**: NONE

### 2. Syntax Highlight LRU Cache
- **File**: `theme.ts:2705-2727`
- **Vars**: `highlightCache: LRUCache<string, string>` (max 256), `highlightCacheTheme: Theme`
- **Key**: identity comparison `highlightCacheTheme !== highlightTheme`
- **Invalidation**: self-healing — cleared on next `highlightCached()` call when theme identity changes
- **Risk**: NONE. ANSI color codes baked into cached strings; correctly invalidated.

### 3. Markdown Theme Cache
- **File**: `theme.ts:2757-2791`
- **Vars**: `cachedMarkdownTheme: MarkdownTheme`, `cachedMarkdownThemeRef: Theme`
- **Key**: identity comparison `cachedMarkdownThemeRef === theme`
- **Invalidation**: self-healing on next `getMarkdownTheme()` call
- **Risk**: NONE. But note: closures inside capture global `theme` at construction time. Since `theme` is a module-level `var`, closures like `(text) => theme.fg("mdHeading", text)` always read the current global, which is correct.

### 4. Markdown Render L2 Cache (LRU)
- **File**: `tui/components/markdown.ts:62`
- **Var**: `renderCache: LRUCache<string, readonly string[]>` (max 512)
- **Key**: includes `objectId(this.#theme)` — numeric id per MarkdownTheme object
- **Invalidation**: explicitly cleared by `clearRenderCache()` called from onThemeChange
- **Risk**: NONE

### 5. Tool Rendered String Cache (per-block memo)
- **File**: `tools/render-utils.ts:799-834`
- **Type**: `RenderedStringCache { theme, expanded, salt, content, value }`
- **Key**: `cache.theme === theme` (identity)
- **Invalidation**: self-healing — new Theme instance mismatches cached identity
- **Risk**: NONE. Every ToolExecutionComponent holds its own cache instance.

### 6. ToolExecutionComponent Display Key
- **File**: `tool-execution.ts:708`
- **Key string**: includes `getThemeEpoch()` — epoch bumps on theme change
- **Invalidation**: epoch change forces rebuild via `#buildRenderContext()`
- **Risk**: NONE

### 7. Working Message Accent Cache
- **File**: `interactive-mode.ts:416-418`
- **Vars**: `#workingMessageAccentCacheKey`, `#workingMessageAccentCacheValue`, `#workingMessageAccentCacheHasValue`
- **Key**: `{ sessionAccentEnabled, sessionName, accentSurfaceLuminance }`
- **Invalidation**: explicitly cleared by `#clearWorkingMessageAccentCache()` from onThemeChange
- **Risk**: NONE

### 8. Shimmer Compiled Palette Cache
- **File**: `theme/shimmer.ts:82-106`
- **Vars**: `[kCompiledFor]`, `[kCompiled]` symbols on palette objects
- **Key**: `p[kCompiledFor] === theme` (identity)
- **Invalidation**: self-healing — ShimmerTheme is derived from Theme, new instance = cache miss
- **Risk**: LOW. ShimmerTheme is typically the Theme itself. If shimmerSegments is called with a stale ShimmerTheme reference that was captured before the theme change, it would use stale colors until the next capture. But shimmer is called from render paths that read the global theme fresh.

### 9. Editor Theme (EditorTheme object)
- **File**: `theme.ts:2805-2812`, consumed by `Editor` constructor
- **Invalidation**: `getEditorTheme()` creates a new object each call, but `Editor.#theme` is set at construction and never updated.
- **Risk**: MEDIUM. The EditorTheme contains `borderColor`, `selectList`, `symbols`, `hintStyle` — all closures that capture the global `theme` var (not the Theme instance), so color changes propagate. But `symbols.boxRound` is resolved at construction from `theme.boxRound` (which returns a fresh object from `this.#symbols`). If symbols change (e.g. preset switch), the editor's box-drawing chars are stale. For color-only theme changes (dark/light), this is fine since symbols don't change.

### 10. StatusLineComponent
- **File**: `status-line/component.ts`
- **Caches**: git branch, git status (1s TTL), PR lookup, usage (5min TTL), context usage memo, effective settings
- **Theme access**: reads global `theme` import directly in render path, not cached
- **Invalidation**: `invalidate()` called by many paths; theme change triggers full re-render via `ui.invalidate() + ui.requestRender()`
- **Risk**: NONE for theme colors. Segment renderers call `theme.fg()`, `theme.icon.*`, etc. fresh each render.

## Surfaces That Read Global Theme Directly (No Cache)

| Function | File | Risk |
|---|---|---|
| `getSymbolTheme()` | theme.ts:2741 | NONE — fresh each call |
| `getSelectListTheme()` | theme.ts:2793 | NONE — fresh each call |
| `getEditorTheme()` | theme.ts:2805 | NONE — fresh each call (but Editor caches result) |
| `getSettingsListTheme()` | theme.ts:2814 | NONE — fresh each call |
| `getSeparator()` | separators.ts:8 | NONE — reads theme.sep fresh |
| `renderSegment()` | segments.ts | NONE — reads theme.fg/icon fresh |
| `renderStatusLine()` | tui/status-line.ts:32 | NONE — takes theme param |
| `renderFramedMessage()` | message-frame.ts | NONE — reads global theme fresh |
| `fgOrPlain()` | theme.ts:2103 | NONE — reads global theme |

## Cursor Shape Assessment

### Current State
- **No DECSCUSR sequences** exist anywhere in the codebase
- Hardware cursor: show/hide only (`\x1b[?25h` / `\x1b[?25l` DECTCEM)
- Hardware cursor positioning: `\x1b[row;colH` and `\x1b[colG`
- Software cursor glyph: `▏` (or `|` for ASCII preset) rendered inline via `cursorOverride` or default cursor char
- `#useTerminalCursor` flag: when true, TUI positions hardware cursor at edit position; when false, renders software glyph
- The `cursorOverride` field (editor.ts:382-385) allows replacing the software cursor glyph with any ANSI-styled string

### For Vim Mode Cursor Shape
DECSCUSR sequences (`\x1b[N q`):
- 0: default, 1: blinking block, 2: steady block
- 3: blinking underline, 4: steady underline
- 5: blinking bar, 6: steady bar

Terminal support: Ghostty, kitty, wezterm, iTerm2, VS Code terminal, Windows Terminal, Alacritty all support DECSCUSR.

**Implementation approach**: Emit DECSCUSR in the cursor-update path of `tui.ts:3333-3336` alongside the cursor position/visibility write. Save terminal's cursor shape on enter, restore on exit (alongside existing DECTCEM restore).

**Accessibility fallback** (no cursor-shape control): The existing software cursor glyph mechanism (`cursorOverride`) can swap between `▏` (insert/bar), `█` or `▊` (normal/block), `▁` (replace/underline) as a non-color, non-escape-dependent fallback.

## Copy/Paste Semantics

### The Problem (Arthur's Objection)
The `Editor.render()` method (editor.ts:786-989) renders box-drawing frame characters as inline text:
```
╭── [status line content] ──────────╮
│ user text here                    │
╰─ ▏                               ╯
```
These characters (`╭╮╰╯│─▏`) are part of the rendered output string. Terminal text selection captures them alongside user text. Copy/paste from terminal includes frame glyphs.

### Current Border Control
- `Editor.#borderVisible` (editor.ts:468): boolean, controls whether border is drawn
- `Editor.setBorderVisible(false)` exists and suppresses all frame rendering
- Without border: editor renders just the text content lines, no box-drawing chars
- `Editor.#promptGutter` (editor.ts:390): optional prefix string shown when borderless

### Paste Input Paths
1. **Bracketed paste** (`\x1b[200~...201~`): BracketedPasteHandler strips markers, delivers clean text to `#handlePaste()`. Works correctly.
2. **Kitty enhanced paste** (OSC 5522): Routes through `pasteText()` method. Works correctly.
3. **Image paste** (Ctrl+V): readImageFromClipboard via native FFI. Works correctly.
4. **Raw text paste** (Ctrl+Shift+V): readTextFromClipboard, bypasses large-paste dialog. Works correctly.

### Programmatic Copy
- `/copy` commands use `copyToClipboard()` which writes to OSC 52 or pbcopy/xclip — clean text, no frame glyphs.
- `/dump` exports session text — clean, no frame glyphs.

### Fix for Frame Glyph Pollution
Set `borderVisible = false` and use a prompt gutter (e.g. `> ` or just a colored cursor) for the editor. The status line content currently in the top border (`getTopBorder()`) would need to move to a separate component rendered above the editor.
