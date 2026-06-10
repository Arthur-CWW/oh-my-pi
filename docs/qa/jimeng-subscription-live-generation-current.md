# Jimeng Subscription Live Generation Current Smoke

Date: 2026-06-10

Claim: the current logged-in subscription account can produce real generated media through `jimeng-browser-proxy`, not just accepted API calls.

## Results

| Path | Result | Artifact |
|---|---:|---|
| TTS | `ret=0`, MP3 audio, `6.960000s` | `data/jimeng-lab/proof-20260610-subscription-live-generation-current/tts/artifacts/直爽女大-7597003459665072686.mp3` |
| Text-to-video | `status=50`, H.264, `704x1248`, `3.016667s` | `data/jimeng-lab/proof-20260610-subscription-live-generation-current/text2video/artifacts/ac113d71-3f4f-4996-a82f-ba1329ba44c5-00.mp4` |
| Image-to-video | `status=50`, H.264, `704x1248`, `3.016667s` | `data/jimeng-lab/proof-20260610-subscription-live-generation-current/image2video/artifacts/31019287-2207-49f2-86d6-ef85b0826b60-00.mp4` |
| Text-to-image | blocked | stale workbench capture still returns `ret=3018`, `errmsg=permission denied`; needs fresh background CDP submit capture |

Validation thumbnails:

- `data/jimeng-lab/proof-20260610-subscription-live-generation-current/_validation/text2video-thumb-1s.jpg`
- `data/jimeng-lab/proof-20260610-subscription-live-generation-current/_validation/image2video-thumb-1s.jpg`

Full ignored proof manifest:

- `data/jimeng-lab/proof-20260610-subscription-live-generation-current/manifest.md`

## Rerun

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts session \
  --session-out data/jimeng-lab/raw/session-bundle-current.json

bun packages/jimeng-client/src/browser-proxy-cli.ts tts \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --voice-id 7597003459665072686 \
  --voice-title '直爽女大' \
  --text '这是一次订阅账号的真实接口测试。三秒内讲清楚产品卖点，语气自然一点。' \
  --outDir data/jimeng-lab/proof-20260610-subscription-live-generation-current/tts

bun packages/jimeng-client/src/browser-proxy-cli.ts text2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --prompt '韩系美妆UGC创作者在明亮卧室里拿起一瓶精华，真实手机自拍质感，前三秒展示熬夜后底妆卡粉痛点，动作自然，画面干净，无字幕，无水印，不要生成可读文字。' \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061011 \
  --outDir data/jimeng-lab/proof-20260610-subscription-live-generation-current/text2video \
  --pollIntervalMs 10000 \
  --maxPolls 40

bun packages/jimeng-client/src/browser-proxy-cli.ts image2video \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \
  --prompt '韩系美妆达人手机自拍风格，手里拿着一瓶精华自然靠近镜头，像真实TikTok种草开场，表情自然，明亮卧室自然光，无字幕，无水印，不要生成可读文字。' \
  --durationSec 3 \
  --ratio 9:16 \
  --videoResolution 720p \
  --modelVersion 3.0fast \
  --seed 2026061012 \
  --outDir data/jimeng-lab/proof-20260610-subscription-live-generation-current/image2video \
  --pollIntervalMs 10000 \
  --maxPolls 40
```

Live generation consumes subscription quota. Run concurrency `1`.
