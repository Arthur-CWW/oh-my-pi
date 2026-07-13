# libghostty feasibility for OMP

Research snapshot: Ghostty commit `a3ac713b777b7d85e260a2367c0d7e5498c8b5ea`.

## Recommendation

Adopt a narrowly pinned **libghostty-vt pilot for embedded PTY panes only**. Keep OMP's renderer, layout, lifecycle, and cell diff. Do not adopt the full Ghostty GUI embedding surface. Prefer a small Node-API native shim over raw `bun:ffi`.

This directly fits OMP's sibling/subagent pane direction: PTY bytes enter libghostty-vt; the shim returns bounded dirty-row/cell snapshots; OMP renders them in its existing cockpit.

## What is usable

- `libghostty-vt` is a cross-platform C/Zig VT engine for parsing, cursor/screen state, scrollback, reflow, styles, Unicode, input encoding, selection, and incremental render state. Ghostty documents macOS/Linux/Windows/WASM support: [README](https://github.com/ghostty-org/ghostty/blob/a3ac713b777b7d85e260a2367c0d7e5498c8b5ea/README.md#L151-L170).
- Its API is explicitly incomplete and unstable; breaking changes are expected: [vt.h](https://github.com/ghostty-org/ghostty/blob/a3ac713b777b7d85e260a2367c0d7e5498c8b5ea/include/ghostty/vt.h#L4-L26).
- The full `include/ghostty.h` embedding API is explicitly not general-purpose and currently serves Ghostty's native Apple app: [ghostty.h](https://github.com/ghostty-org/ghostty/blob/a3ac713b777b7d85e260a2367c0d7e5498c8b5ea/include/ghostty.h#L1-L6).
- MIT licensed: [LICENSE](https://github.com/ghostty-org/ghostty/blob/a3ac713b777b7d85e260a2367c0d7e5498c8b5ea/LICENSE#L1-L17).

## Integration shape

Native shim API:

```text
create(cols, rows, maxScrollback) -> handle
feed(handle, bytes)
resize(handle, cols, rows, cellWidthPx, cellHeightPx)
snapshot(handle, outputBuffer) -> dirty rows, cursor, cells/styles/colors
destroy(handle)
```

Keep Ghostty pointers, callbacks, and borrowed memory native. Return only OMP-owned packed snapshots.

Relevant APIs:

- `ghostty_terminal_new`, `ghostty_terminal_vt_write`, `ghostty_terminal_resize`: [terminal.h](https://github.com/ghostty-org/ghostty/blob/a3ac713b777b7d85e260a2367c0d7e5498c8b5ea/include/ghostty/vt/terminal.h#L1212-L1316).
- `ghostty_render_state_update` and begin/end update: [render.h](https://github.com/ghostty-org/ghostty/blob/a3ac713b777b7d85e260a2367c0d7e5498c8b5ea/include/ghostty/vt/render.h#L325-L409).
- Cell/grapheme/style/color access: [render.h](https://github.com/ghostty-org/ghostty/blob/a3ac713b777b7d85e260a2367c0d7e5498c8b5ea/include/ghostty/vt/render.h#L627-L750).

Use render-state dirty rows, not grid refs, for frame-rate rendering.

## Boundary choice

Bun labels `bun:ffi` experimental and recommends Node-API for production: [Bun FFI](https://bun.sh/docs/runtime/ffi), [Bun Node-API](https://bun.sh/docs/runtime/node-api).

Strong precedent exists in [`coder/libghostty-vt-node`](https://github.com/coder/libghostty-vt-node/blob/e222ffe744ad57f41c4f1893ba3963e92006be42/README.md#L1-L49), which exposes TypeScript `createTerminal().feed/resize/snapshot` via Node-API while keeping GUI rendering out of scope.

Official architecture precedent: Ghostty's [`ghostling`](https://github.com/ghostty-org/ghostling/blob/f9034e43a50a2f3a8101e35497f486090c1ddd6e/README.md#L29-L34) feeds PTY bytes into libghostty-vt and owns its renderer separately.

## Evidence

The researched commit built successfully with Zig 0.15.2 using:

```sh
zig build -Demit-lib-vt -Doptimize=ReleaseFast
```

Its `example/c-vt-stream` compiled and ran against the generated macOS dylib, producing the expected styled/cursor/erase/multiline output.

## Decision

- **Pilot now:** one isolated readonly/live PTY pane behind a feature flag, pinned Ghostty commit, Node-API shim, conformance fixtures.
- **Keep:** OMP renderer and interaction model.
- **Watch:** full GUI/GPU embedding API.
- **Do not:** replace OMP's TUI or make dozens of raw FFI calls.
