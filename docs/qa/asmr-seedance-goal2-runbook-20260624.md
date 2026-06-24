# ASMR Seedance Goal 2 runbook - 2026-06-24

Purpose: operate the SynthID-conditioned Jimeng/Seedance I2V lane without spend by default, and make the live-access boundary explicit when Arthur's standing approval applies.

## Dry-run command

No provider submit, poll, media download, or credit spend:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts seedance-image2video-plan \
  --prompt '<Seedance prompt, no generated text>' \
  --firstFrameUri '<tos/provider-uri-or-dry-run-placeholder>' \
  --firstFrameHash '<canonical-source-sha256>' \
  --firstFrameProvenance '<optional-analysis-tags.v1.json>' \
  --synthIdMarked true \
  --conditioningParams '{"resize_policy":"provider_safe_even_dimensions","denoise_strength":0.12}' \
  --runId asmr-seedance-goal2-dry-run-001 \
  --createdAt 2026-06-24T00:00:00.000Z \
  --seed 2026062401 \
  --durationSec 5 \
  --ratio 9:16 \
  --outDir data/asmr-companion/goal2/seedance-plan
```

Workspace bin alias, when linked/installed, is equivalent and keeps existing `jimeng-browser-proxy` command names intact:

```bash
seedance-image2video-plan --prompt '<prompt>' --firstFrameHash '<sha256>' --outDir data/asmr-companion/goal2/seedance-plan
```

Dry-run artifact contract:

- `raw/<runId>-dry-run-plan.json` - Jimeng direct first-frame video request body with `live_submit=false`.
- `normalized/<runId>-first-frame-conditioning.json` - canonical URI/path/hash, optional `analysis-tags.v1` sidecar details, SynthID evidence, pre/post hashes, and conditioning params.
- `normalized/<runId>-dry-run-response-placeholder.json` - no-submit provider-job placeholder.
- `normalized/generated-video-clips.v1.json` - `@wirebabel/media-contracts` compatible downstream handoff.
- `normalized/<runId>-summary.json` - reviewer-friendly summary.
- `artifacts/<runId>.mp4` - planned artifact path only; no MP4 is created by dry-run.

## SynthID / Gemini first-frame invariant

- Source truth for quality comparison is the canonical first-frame still/hash and the conditioned output/hash.
- If the sidecar, CLI flag, sidecar paths, or tags indicate Gemini/SynthID/C2PA/AI-origin risk, dry-run records conditioning before provider upload.
- The conditioning manifest is a quality/debug record, not a provenance policy.
- Hash continuity is useful for A/B comparison: original source hash -> conditioning record or actual conditioned-image hash -> provider uploaded URI -> `generated-video-clips.v1` firstFrame fields.
- Local paths and optional sidecars must be repo-relative POSIX paths; provider video handoff must use provider URIs, not `file://` or `local-reference://` derivative paths.

## Live split and prerequisites

Run live inside the standing approval in `docs/plans/asmr-companion-overnight-goals.md` when it is needed to judge E2E quality:

- Jimeng/Seedance only for this lane; Dreamina is excluded.
- Max Jimeng/Seedance live video jobs: 6 unless Arthur raises it; use existing codebase/provider concurrency caps.
- Output root: `data/asmr-companion/overnight-live/20260624/jimeng-seedance/`.
- Session source: existing logged-in Firefox/Chrome profile or ignored refreshed bundle such as `data/jimeng-lab/raw/session-bundle-current.json`; never print cookies/tokens.
- Dry-run requires no Jimeng session, API key, or subscription access; live requires a usable Jimeng account/session with available VIP credits or balance confirmed by preflight.
- Adjacent API-key providers and LLM/image subscriptions may create first-frame candidates; Goal 2 consumes their image/hash/conditioning notes and never reads or prints raw secrets.

Read-only preflight before any live submit:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts account-credit \
  --session <ignored-session-bundle.json> \
  --outDir data/asmr-companion/overnight-live/20260624/preflight/jimeng-account-credit

bun packages/jimeng-client/src/browser-proxy-cli.ts account-config \
  --session <ignored-session-bundle.json> \
  --outDir data/asmr-companion/overnight-live/20260624/preflight/jimeng-account-config

bun packages/jimeng-client/src/browser-proxy-cli.ts commerce-pricing \
  --session <ignored-session-bundle.json> \
  --outDir data/asmr-companion/overnight-live/20260624/preflight/jimeng-pricing
```

Live handoff pattern after dry-run acceptance:

1. Condition the SynthID/Gemini-marked candidate locally or with an approved conditioning tool, then keep the actual conditioned sha256 for comparison.
2. Upload the conditioned first frame under the live root using the existing Jimeng upload path, recording normalized upload output and redacted proof.
3. Submit `image2video`/first-frame live jobs inside the approved caps with the uploaded provider URI, same prompt/seed/duration/ratio where useful for A/B, and the same run id lineage.
4. Record provider job id, request/response paths, generated MP4 path, and final `generated-video-clips.v1` update if downstream steps need it.

## Rate limits and stop conditions

- On 429/rate-limit: back off only within the approved job cap; stop after repeated throttling and record the last response.
- Stop immediately on 401/403, expired session, CAPTCHA, new terms/compliance prompt, `ret=1019`, `shark-not-pass`, changed pricing, unavailable balance, unexpected charge, cap overrun, secret exposure risk, or any request to hide/omit material run records.
- Do not brute-force retries or automate around risk controls.

## Downstream readiness

Goals 4/5 should consume `normalized/generated-video-clips.v1.json` and treat Goal 2 as owner of provider/session/conditioning details. Downstream code should not infer provider access state from raw Jimeng request bodies.
