# GPT Pro Prompt 04 — Model/API/vendor menu for Arcads-like AI UGC system

You are my AI video model scout and systems cost engineer. Use web browsing/deep research. I need a current, practical model/API menu for building an Arcads.ai-style AI UGC/video ad generator quickly, with later open/local options.

Use project sources for Arcads evidence. Arcads public API exposes image models (`gpt-image`, `gpt-image-2`, `nano-banana`, `nano-banana-2`, `soul`, `grok_image`, `seedream`, `seedream_5_lite`), video models (`sora2`, `sora2-pro`, `veo31`, `kling-2.6`, `kling-3.0`, `grok-video`, `seedance`, `seedance-2.0`, `happy-horse`), talking actors (`arcads_1.0`, `audio_driven`, `omnihuman`), and ElevenLabs voice import.

I want to prototype with different open models/APIs where possible, not just copy Arcads' vendor stack.

## Deliverables

For every task below, produce a ranked matrix:

Task | Fastest viable prototype | Best quality API | Best open/local option | Cheapest scalable option | Cost/latency notes | Integration notes | Failure modes

Tasks:

1. LLM planning/script/hook generation.
2. Product URL/page ingestion and brand extraction.
3. Product image cleanup/upscale/background removal.
4. AI influencer/persona image generation.
5. Consistent character generation across images.
6. Product-in-hand / app-screen / clothing try-on image generation.
7. Image-to-video / start-frame video.
8. Text-to-video B-roll.
9. Video-to-video / reference motion / actor replacement.
10. Talking-head / lipsync from image + script/audio.
11. Custom actor / digital twin from user-uploaded video.
12. TTS.
13. Voice cloning / speech-to-speech.
14. Transcription/captions.
15. Translation/localization + multilingual lipsync.
16. Video editing add/swap/remove object.
17. Segmentation/background removal.
18. Video upscale/interpolation/cleanup.
19. Caption/text overlay rendering.
20. Final composition/render/export.
21. Analytics / creative scoring / performance feedback.

## Specific comparison needs

Please investigate and compare relevant options such as:

- OpenAI, Anthropic, Gemini for LLMs.
- OpenAI image/video, Google Veo, Sora, Runway, Luma, Pika, Kling, Minimax/Hailuo, Seedance/ByteDance, Jimeng/Dreamina, Higgsfield, Grok, Fal, Replicate, Runpod.
- ElevenLabs, Cartesia, PlayHT, OpenAI TTS, Deepgram, Fish Audio, Resemble, Coqui/XTTS.
- Whisper/faster-whisper/Deepgram/AssemblyAI for captions.
- Wav2Lip, SadTalker, LivePortrait, MuseTalk, Hallo, AniPortrait, EchoMimic, OmniHuman-like open options if available.
- ComfyUI/Wan/I2V/VACE/AnimateDiff/FLUX/SDXL/Seedream alternatives where practical.
- Remotion, ffmpeg, MoviePy, Canvas/Sharp for composition.

## Output requirements

### 1. Executive recommendation

Pick the default stack for:

- 48-hour demo;
- 1-week internal tool;
- 1-month MVP;
- later local RTX 3090 experiments.

### 2. Provider abstraction design

Design TypeScript interfaces for provider adapters:

- `generateImage`
- `generateVideo`
- `generateSpeech`
- `lipsync`
- `transcribe`
- `translate`
- `composeRender`

Include common request/response metadata fields.

### 3. Cost routing policy

Give a policy for routing cheap vs expensive models, caching, retries, batching, and fallback.

### 4. Key unknowns

What should I test manually before committing to vendors?

Be current, cite sources, and mark uncertainty/confidence.
