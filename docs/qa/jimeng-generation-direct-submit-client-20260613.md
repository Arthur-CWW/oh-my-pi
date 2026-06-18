# Jimeng generation direct submit client — 2026-06-13

## Scope

Adds no-live-spend direct submit helpers for `/mweb/v1/aigc_draft/generate`:

- `buildJimengGenerationHeaders`
- `executeJimengVideoDirectSubmit`
- `executeJimengText2ImageSubmit`

These bridge existing direct request planners to `JimengClient.requestText` with injected fetch/client support. They do not poll, download artifacts, open a browser, or make live calls in tests.

## Verified behavior

- Builds Jimeng web headers from `JimengSessionBundle`.
- Submits existing text/video and text/image direct plans to `/mweb/v1/aigc_draft/generate` through injected mock fetch.
- Parses JSON at the boundary.
- Calls shared risk-control detection.
- Rejects nonzero provider `ret`.
- Returns endpoint, HTTP status, provider ret/errmsg, response hash, submit id, history id, request body, and parsed response body.

## Verification

From `packages/jimeng-client`:

```bash
mise exec -- bun test ./test/generation-contract.test.ts
mise exec -- bun run typecheck
```

Observed 2026-06-13:

- `bun test ./test/generation-contract.test.ts`: 10 pass.
- `bun run typecheck`: pass.

## Remaining gates

`/mweb/v1/aigc_draft/generate` stays `partial`: live submit/poll/download for lip-sync, end-frame, multi-frame, or omni-reference still needs passive capture compare or explicit spend/task-state approval.
