# @wirebabel/jimeng-client

TypeScript Jimeng/Dreamina direct-client helpers ported from the `slotok` `reverse-jimeng` branch (`3c9c803 refactor(provider): move jimeng direct runner into workspace package`).

This package contains only local client code and tests. It does **not** include captured cookies, raw network captures, or generated media.

## What was brought over

- Confirmed endpoint notes: `../../docs/provider/jimeng-direct-client-endpoints.md`
- SSE submit-id parsing
- Capture-template patching for:
  - image text prompts
  - video text prompts
  - first/last frame URI payload injection placeholders
- Direct submit/poll/download helpers
- Structured errors and risk-control detection (`ret=1019` / `shark not pass`)

## Risk controls

- Keep generation concurrency at `1`.
- Use bounded polling and stop on risk-control responses.
- Do not brute-force retries or spam repeated prompts.
- Refresh browser session/cookies explicitly when auth expires.

## Direct-client CLI

```bash
bun run jimeng:cli -- \
  --op video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle.json \
  --prompt "一只柴犬在海边冲浪，电影感，16:9" \
  --durationSec 3 \
  --dryRun
```

`--dryRun` writes a patched plan only. Without `--dryRun`, commands submit live and can consume paid quota.

## Dreamina-compatible direct CLI

`jimeng-dreamina` mirrors the official `dreamina` command vocabulary where the frontend endpoint has been reversed, but uses local capture templates + session bundles instead of the VIP-gated official generator commands.

```bash
# inspect support matrix
bun packages/jimeng-client/src/dreamina-compatible-cli.ts capabilities

# dry-run text2video request patching
bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle.json \
  --prompt "赛博海豹，电影感，无文字" \
  --duration=3 \
  --ratio=16:9 \
  --model_version=3.0fast \
  --dryRun
```

Important behavior: this compat CLI is live by default, matching normal generation tools. Use `--dryRun` when you do not want to spend credits.

## Browser-backed proxy CLI

`jimeng-browser-proxy` uses the logged-in background Helium/CDP Jimeng profile as a session holder, then runs the direct client with a fresh browser session bundle. This is the preferred bridge while endpoint contracts are still being reversed.

```bash
# refresh a local session bundle from the background browser profile
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --cdp http://127.0.0.1:9340 \
  --target-url jimeng.jianying.com \
  --session-out data/jimeng-lab/raw/session-bundle-current.json

# dry-run current workbench text-to-image from a capture template
bun packages/jimeng-client/src/browser-proxy-cli.ts text2image \
  --cdp http://127.0.0.1:9340 \
  --target-url "type=image" \
  --capture data/jimeng-captures/<run>/capture-template.raw.json \
  --prompt "韩系美妆健身UGC创作者，手机自拍，无文字，无水印" \
  --dryRun
```

The proxy does not foreground the browser. It still live-submits without `--dryRun`, so keep concurrency at `1` and stop on auth/risk-control responses.

## Background network recorder

Passive CDP recorder for frontend API reversal:

```bash
bun packages/jimeng-client/src/network-recorder.ts --help

bun packages/jimeng-client/src/network-recorder.ts \
  --target-url jimeng.jianying.com \
  --flow manual-upload \
  --durationSec 0
```

Default output stays under ignored `data/jimeng-captures/**` and includes raw JSONL, a capture template, and a redacted summary. Do not commit raw captures, cookies, signed URLs, or generated media.
