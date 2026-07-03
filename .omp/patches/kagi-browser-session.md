# Kagi browser-session search

## Kind

Not an OMP source patch. This is repo-owned extension/tool behavior in `packages/web-access`.

## Current implementation

- `packages/web-access/src/kagi.ts`
- `packages/web-access/src/search.ts`
- registered through `packages/web-access/src/index.ts`

## Behavior contract

The repo web-access extension can search Kagi using the user's signed-in browser account session, avoiding a separate Kagi API key when possible.

Required behavior:

1. Prefer a cached Kagi browser session when fresh.
2. Capture Kagi session from Firefox cookies when available.
3. Capture Kagi session from Chrome CDP when available.
4. Query Kagi's browser/session search endpoint and parse streamed/socket-style results into the repo `SearchResponse` shape.
5. Fall back according to the web-access search policy when Kagi browser search is unavailable.

## Why this is not an OMP patch

The stale `oh-my-pi/` tree contains older upstream Kagi browser-session code under `oh-my-pi/packages/coding-agent/src/web/kagi.ts`, but this repo did not modify that file. `git diff --name-only -- oh-my-pi` shows only Agent Hub files changed in the vendored OMP tree.

Kagi browser-session support is maintained as our own Pi/OMP extension package instead of patching upstream OMP.
