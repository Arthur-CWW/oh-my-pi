# Jimeng Direct Compare Gates QA - 2026-06-11

## Claim

The Jimeng client now has no-spend, no-session compare gates for direct text-to-image and direct text/video/frame-to-video request builders. The CLI can compare a saved dry-run plan against passive raw CDP or capture-template submit evidence before any paid live submit is claimed.

The subject voice and voice-clone request-shape dry-runs also run without loading a browser session.

## Verification

Run from `/Users/arthur/agents/web-access`.

```bash
bun run --cwd packages/jimeng-client test
bun run --cwd packages/jimeng-client typecheck
```

Result:

- `239 pass`, `0 fail`, `1299 expect()` calls across `47` Jimeng test files.
- `tsc --noEmit` passed.

## CLI Smokes

Direct video compare:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2video-plan \
  --prompt "韩系美妆UGC创作者手机自拍视频，展示补水精华，真实自然光" \
  --ratio 9:16 \
  --durationSec 5 \
  --seed 20260611 \
  --submitId cli-smoke-text2video-compare \
  --outDir data/jimeng-lab/cli-text2video-compare-smoke

bun packages/jimeng-client/src/browser-proxy-cli.ts text2video-compare \
  --plan data/jimeng-lab/cli-text2video-compare-smoke/raw/text2video-plan-20260611091214-dry-run-plan.json \
  --rawNetwork data/jimeng-lab/cli-text2video-compare-smoke/raw/raw-network.jsonl \
  --outDir data/jimeng-lab/cli-text2video-compare-smoke
```

Observed output: `text2video-compare saved match=true candidates=1`.

Direct image compare:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2image-plan \
  --prompt "韩系美妆达人在自然光卧室里展示补水精华" \
  --modelVersion jimeng-5.0 \
  --resolution 2k \
  --ratio 9:16 \
  --sampleStrength 0.7 \
  --seed 123456 \
  --submitId cli-smoke-text2image-compare \
  --outDir data/jimeng-lab/cli-text2image-compare-smoke

bun packages/jimeng-client/src/browser-proxy-cli.ts text2image-compare \
  --plan data/jimeng-lab/cli-text2image-compare-smoke/raw/text2image-plan-20260611092126-dry-run-plan.json \
  --rawNetwork data/jimeng-lab/cli-text2image-compare-smoke/raw/raw-network.jsonl \
  --outDir data/jimeng-lab/cli-text2image-compare-smoke
```

Observed output: `text2image-compare saved match=true candidates=1`.

Sessionless dry-run request plans:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-generate-voice \
  --imageUri tos-cn-i-demo/avatar.png \
  --dryRun \
  --outDir data/jimeng-lab/cli-sessionless-dryruns

bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-submit \
  --audioVid v03870g10004d8k1u4nog65hb08dnhig \
  --name "Kbeauty reference voice" \
  --dryRun \
  --outDir data/jimeng-lab/cli-sessionless-dryruns

bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-query \
  --taskIds task-demo-1 \
  --dryRun \
  --outDir data/jimeng-lab/cli-sessionless-dryruns

bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-update \
  --voice-id voice-demo-1 \
  --name "Updated voice" \
  --dryRun \
  --outDir data/jimeng-lab/cli-sessionless-dryruns

bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-delete \
  --voice-id voice-demo-1 \
  --dryRun \
  --outDir data/jimeng-lab/cli-sessionless-dryruns
```

Observed output:

- `subject-generate-voice dry run saved`
- `voice-clone-submit dry run saved`
- `voice-clone-query dry run saved`
- `voice-clone-update dry run saved`
- `voice-clone-delete dry run saved`

Coverage registry:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts triage-coverage \
  --decisions keep \
  --outDir data/jimeng-lab/triage-coverage-current
```

Observed output: `triage-coverage saved decisions=keep families=9 missing=0`.

## Caveats

- No paid generation was run for this QA pass.
- The raw-network files used for compare smokes were local CDP-shaped fixtures generated from the dry-run plan, not live browser captures.
- Live submit remains gated on passive capture comparison plus explicit approval.
