# Jimeng Generation Plan Snapshots - 2026-06-11

Purpose: keep the highest-value G1 generation lane moving without live spend by snapshotting representative UGC request contracts before approval-gated live submit/capture.

Snapshot test:

- `packages/jimeng-client/test-vitest/generation-plans.snapshot.test.ts`
- `packages/jimeng-client/test-vitest/__snapshots__/generation-plans.snapshot.test.ts.snap`

Covered workflows:

1. `korean-beauty-persona-still`
   - CLI shape: `jimeng-browser-proxy text2image-plan --prompt '韩系美妆UGC创作者在自然光卧室里展示补水精华，真实手机自拍视频感，无文字，无水印' --modelVersion jimeng-5.0 --resolution 2k --ratio 9:16 --sampleStrength 0.62`
   - Proves: direct image submit contract, `high_aes_general_v50`, 2k 9:16 dimensions, `ImageBasicGenerate` scene options, negative prompt path.

2. `faceless-protein-bar-hook-video`
   - CLI shape: `jimeng-browser-proxy text2video-plan --prompt '竖屏手机广告，蛋白棒从包装里掰开，镜头切到巧克力夹心拉丝，前三秒强钩子，真实UGC产品测评风格' --ratio 9:16 --videoResolution 720p --durationSec 5 --fps 24`
   - Proves: direct video submit contract, `dreamina_ic_generate_video_model_vgfm_3.0_fast`, commerce info, `BasicVideoGenerateButton` scene options, text-only vertical video path.

3. `reference-profile-pose-transfer-frames`
   - CLI shape: `jimeng-browser-proxy text2video-plan --prompt '保留参考视频的手势节奏和镜头推进，换成新护肤品展示，自拍视频质感，轻微手持晃动，自然口播停顿' --firstFrameUri tos-cn-i-tb4s082cfz/reference-start.png --lastFrameUri tos-cn-i-tb4s082cfz/reference-end.png --ratio 9:16 --videoResolution 1080p --durationSec 5`
   - Proves: first/end-frame provider URI paths for reference-profile pose/timing transfer.

4. `omni-reference-profile-transfer`
   - CLI shape: `jimeng-browser-proxy omni-video-plan --prompt '@image_file_1 as the new Korean beauty host, mimic timing and hand gestures from @video_file_1, swap the hook to a cushion foundation CTA' --materials '[{"type":"image","fieldName":"image_file_1","uri":"tos-cn-i-tb4s082cfz/kbeauty-persona.png","width":1080,"height":1920},{"type":"video","fieldName":"video_file_1","vid":"v03870g10004d8k1u4nog65hb08dnhig","width":1080,"height":1920,"durationSec":8}]' --modelVersion jimeng-video-seedance-2.0 --durationSec 8`
   - Proves: Seedance omni-reference `unified_edit_input.material_list`, prompt-derived `meta_list`, `functionMode="omni_reference"`, and mixed image/video material refs for reference-profile remix. See `docs/qa/jimeng-omni-video-plan-20260611.md`.

Verification:

```bash
cd packages/jimeng-client
/Users/arthur/.local/share/mise/shims/bun run typecheck
/Users/arthur/.local/share/mise/shims/bun run test
/Users/arthur/.local/share/mise/shims/bun run test:vitest
```

Latest result:

- `typecheck`: pass
- `bun test ./test`: 256 pass
- `vitest run test-vitest`: 2 files / 3 tests pass

Next highest-value step:

- Approval-gated G1 live capture/compare for `/mweb/v1/aigc_draft/generate`, using the highest-value examples above, especially `omni-video-plan` for all-around reference/profile transfer.
- If live capture is not approved, stay inside G1 with additional request builders, compare gates, and schema fixtures rather than switching to unrelated no-spend metadata reads.
