# Jimeng Lip-Sync Digital-Human Passive Capture - 2026-06-30

## Scope

Packet: `lip-sync-human`.

This pass used the dedicated background Helium Jimeng profile on CDP `http://127.0.0.1:9340`. It did not submit generation, upload media, create provider tasks, or spend credits.

## Evidence

- Session refresh succeeded:
  - `data/jimeng-lab/raw/session-bundle-current.json` local only, ignored.
- Packet manifest:
  - `data/jimeng-lab/packet-lip-sync-human-20260630/normalized/packet-plan/packet-manifest.md`
- Load capture:
  - `data/jimeng-captures/20260630-lip-sync-human-digitalhuman-load/redacted-summary.md`
  - Result: page load only exposed bootstrap/risk-token traffic and no useful Jimeng lip-sync API calls.
- Setup capture:
  - `data/jimeng-captures/20260630-lip-sync-human-digitalhuman-setup/redacted-summary.md`
  - Result: opening `音色` / `角色` / `资产库` in the background workbench emitted only `get_unread_count` plus analytics (`voice_select_panel`), not pre-process/generate payloads.
- Config refresh:
  - `data/jimeng-lab/packet-lip-sync-human-20260630/lip-sync-config-refresh/normalized/lip-sync-config-20260630013325-summary.json`
  - Result: image lip-sync models are `dreamina_lib_sync_image_master_1.5` and `dreamina_lib_sync_image_quick_1.5`; VOD/base model is `dreamina_lib_sync_base`.
- No-submit workbench preflight:
  - `data/jimeng-lab/packet-lip-sync-human-20260630/preflight-current-role/normalized/lip-sync-20260630015959-dfon15-preflight.json`
  - Result: `jimeng-browser-proxy lip-sync --preflight --transport cdp-ui` reached the real `type=digitalHuman` route, selected visible voice label `直爽女大`, populated TipTap `说话内容` and `动作描述`, and stopped before upload/submit/poll/download. `submitReady=false` in the no-upload state because the current workbench did not expose an enabled generate button.

## Background DOM State

Read-only DOM inspection confirmed the real route and logged-in workbench state:

- Route: `https://jimeng.jianying.com/ai-tool/generate/?type=digitalHuman&workspace=undefined`
- Visible digital-human controls: `角色`, `音色`, `说话内容`, `动作描述`, `数字人`, `快速模式`, `上传音频`
- Voice panel opens and shows reusable voice labels such as `直爽女大`, `低音炮`, `英气飒姐`, `纯净女声`, and `温柔软妹`.

## Status

The old blocker "find the real route" is cleared. The script/voice preflight path is also cleared for background CDP automation: the live TipTap editor exposes an `editor.commands.setContent` API, and the preflight artifact shows populated `说话内容` plus `动作描述` without provider spend.

The remaining blocker is provider task creation: pre-process and submit payloads are not emitted until an approved role/avatar upload or preselected avatar state enables generation and the workflow advances toward task creation.

Next step requires explicit approval because it may upload/create provider task state and spend credits:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync \
  --transport cdp-ui \
  --cdp http://127.0.0.1:9340 \
  --target-url "type=digitalHuman" \
  --image <local-persona-image.png> \
  --voice-id <voice-id-or-visible-label> \
  --voice-title "直爽女大" \
  --text "三秒告诉你为什么这款产品值得试。" \
  --prompt "自然看镜头，轻微点头，语气直接。" \
  --outDir data/jimeng-lab/packet-lip-sync-human-20260630/packet-artifacts/image-lipsync \
  --pollIntervalMs 3000 \
  --maxPolls 30
```

Stop on auth challenge, CAPTCHA, new terms prompt, `ret=1019`, `shark not pass`, or `JIMENG_LIP_SYNC_SUBMIT_DISABLED_AFTER_POPULATION`.
