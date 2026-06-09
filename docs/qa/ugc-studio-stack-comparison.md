# UGC Studio Stack Comparison QA

Date: 2026-06-09

## Claim

The existing Solid UGC Studio remains available as the baseline route, while a React + Tailwind + shadcn-style route is available for side-by-side UX comparison and is wired to a frugal KIE provider proxy through the local daemon.

## Routes

- Solid baseline: `http://127.0.0.1:47521/ugc-studio/`
- React comparison: `http://127.0.0.1:47521/react-ugc-studio/`
- KIE proxy daemon: `http://127.0.0.1:47522/api/ugc/kie/*`

## Screenshots

Baseline screenshots captured before the React route:

- `docs/qa/ugc-studio-stack-comparison/before/00-route-index.png`
- `docs/qa/ugc-studio-stack-comparison/before/01-solid-review-canvas.png`
- `docs/qa/ugc-studio-stack-comparison/before/02-ugc-persona-atlas.png`
- `docs/qa/ugc-studio-stack-comparison/before/03-ugc-exploration-board.png`
- `docs/qa/ugc-studio-stack-comparison/before/04-ugc-batch-review.png`
- `docs/qa/ugc-studio-stack-comparison/before/05-ugc-campaign-branch-map.png`
- `docs/qa/ugc-studio-stack-comparison/before/06-ugc-reference-profile-remix.png`
- `docs/qa/ugc-studio-stack-comparison/before/07-ugc-final-layer-editor.png`
- `docs/qa/ugc-studio-stack-comparison/before/08-ugc-developer-graph.png`

After screenshots:

- `docs/qa/ugc-studio-stack-comparison/after/09-solid-current-ugc-studio.png`
- `docs/qa/ugc-studio-stack-comparison/after/10-react-shadcn-persona-atlas.png`
- `docs/qa/ugc-studio-stack-comparison/after/11-react-kie-provider-dry-run.png`

## Provider Proof

No paid KIE calls were made for this QA. The CLI and browser both exercised dry-run request construction.

```bash
bun run ugc -- provider kie plan \
  --operation image-text \
  --prompt "韩系美妆健身UGC创作者，真实自然，手机自拍构图，干净背景，无文字，无水印" \
  --aspect-ratio 9:16 \
  --json
```

Expected summary:

- provider: `kie`
- model: `seedream/5-lite-text-to-image`
- estimated cost: `$0.02`
- endpoint: `POST /api/v1/jobs/createTask`
- mode: dry-run JSON only

Local daemon checks:

```bash
curl -sS http://127.0.0.1:47522/api/ugc/kie/capabilities
curl -sS -X POST http://127.0.0.1:47522/api/ugc/kie/plan \
  -H 'Content-Type: application/json' \
  --data '{"operation":"image-text","prompt":"韩系美妆健身UGC创作者，真实自然，手机自拍构图，干净背景，无文字，无水印","aspectRatio":"9:16","quality":"basic"}'
```

## Verification Commands

```bash
bun run ugc:typecheck
bun run ugc:test
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
```

All commands passed on 2026-06-09.

## Notes

- React route uses Vite plugin filters so React JSX files are transformed by `@vitejs/plugin-react`, while the existing Solid route stays under `vite-plugin-solid`.
- KIE live submissions are explicit only. The React UI caps live submission at `$0.05`, which currently enables only the cheapest image route.
- The daemon credit endpoint defaults to dry-run; add `?live=true` only when a real credit check is intended.
