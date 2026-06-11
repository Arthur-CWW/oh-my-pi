# Jimeng Omni Video Plan - 2026-06-11

Purpose: add a dry-run, compare-ready request plan for Dreamina Web `全能参考` / Seedance omni-reference video generation. This is the high-value G1 path for UGC reference-profile remix: swap in a new persona/reference image while preserving motion, timing, or pose from a reference video.

External cross-check:

- `iptag/jimeng-api` documents `omni_reference` video mode for mixed image/video inputs and Seedance 2.0 models.
- Their implementation builds `unified_edit_input.material_list` plus prompt-derived `meta_list`, uses `functionMode="omni_reference"`, and targets `/mweb/v1/aigc_draft/generate`.

CLI dry-run proof:

```bash
/Users/arthur/.local/share/mise/shims/bun packages/jimeng-client/src/browser-proxy-cli.ts omni-video-plan \
  --prompt '@image_file_1 as the new Korean beauty host, mimic timing and hand gestures from @video_file_1, swap the hook to a cushion foundation CTA, realistic TikTok phone footage' \
  --materials '[{"type":"image","fieldName":"image_file_1","uri":"tos-cn-i-tb4s082cfz/kbeauty-persona.png","width":1080,"height":1920,"format":"png"},{"type":"video","fieldName":"video_file_1","vid":"v03870g10004d8k1u4nog65hb08dnhig","width":1080,"height":1920,"durationSec":8}]' \
  --modelVersion jimeng-video-seedance-2.0 \
  --ratio 9:16 \
  --durationSec 8 \
  --fps 24 \
  --seed 20260611 \
  --submitId submit-omni-kbeauty-reference \
  --outDir data/jimeng-lab/proof-20260611-omni-video-plan
```

Output:

- `data/jimeng-lab/proof-20260611-omni-video-plan/raw/omni-video-plan-20260611122544-dry-run-plan.json`
- `data/jimeng-lab/proof-20260611-omni-video-plan/normalized/omni-video-plan-20260611122544-summary.json`

Normalized summary:

- endpoint: `/mweb/v1/aigc_draft/generate`
- query: `da_version=3.3.17`
- model req key: `dreamina_seedance_40_pro`
- function mode: `omni_reference`
- draft min feature: `AIGC_Video_UnifiedEdit`
- material counts: image `1`, video `1`
- prompt meta spans: image ref, text, video ref, text
- live submit: `false`

Verification:

```bash
/Users/arthur/.local/share/mise/shims/bun test packages/jimeng-client/test/video-plan.test.ts
/Users/arthur/.local/share/mise/shims/bun run --cwd packages/jimeng-client typecheck
```

Latest targeted result:

- `video-plan.test.ts`: 6 pass
- `typecheck`: pass

Next gate:

- Passively capture Dreamina/Jimeng all-around reference generation and compare this dry-run plan through `jimeng-browser-proxy request-plan-compare`.
- Live submit remains approval-gated because `/mweb/v1/aigc_draft/generate` can spend credits and create provider-side job state.
