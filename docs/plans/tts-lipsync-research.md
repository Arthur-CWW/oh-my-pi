# TTS + Lipsync Research and Benchmark Plan

## Goal

Find a practical high-quality stack for short surreal/postmodern talking-head clips from a stylized animal reference image, with English dialogue, good voice quality, optional lipsync, ffmpeg subtitles, and automation from macOS.

The immediate target is a talking seal video where the video model generates visuals only, while TTS/subtitles/lipsync are added in post.

## Owner paths

This lane may edit:

- `docs/plans/tts-lipsync-research.md`

Runtime artifacts should stay ignored under:

- `data/research/**`
- `data/tts-lipsync-bench/**`
- `data/coordination/tts-lipsync.status.md`

Do not edit `packages/jimeng-client/**`, `packages/twitter-archive/**`, root configs, or pipeline schema docs without handoff.

## Questions to answer

1. Best hosted TTS APIs for 5–15s brainrot/essay clips?
2. Best local TTS fallback that can run on macOS?
3. Best hosted lipsync/talking-head APIs for stylized/non-human faces?
4. Best local/open-source lipsync models for stylized/non-human faces?
5. Which options support API/CLI automation and no watermark?
6. Cost, latency, duration limits, commercial terms, and reliability?
7. What fallback pipeline works if animal-face lipsync fails?

## Candidate provider categories

TTS:

- ElevenLabs
- Cartesia
- PlayHT
- OpenAI TTS
- Azure/Google/AWS neural voices
- local Kokoro / XTTS / Piper-style fallbacks

Lipsync/talking-head:

- Sync Labs
- Hedra
- D-ID
- HeyGen-style APIs
- Runway/Act-One-style tools if API/export is available
- Replicate-hosted models
- Local/open models: Wav2Lip, MuseTalk, SadTalker, LivePortrait, LatentSync, AniPortrait-style projects

## GPT-Pro research prompt

Recommended async prompt to ChatGPT Pro or another high-effort model:

```txt
Research the best current TTS + lipsync/talking-head APIs and open-source models for creating short surreal/postmodern talking-head videos from a static stylized animal image, e.g. a seal.

Context:
- We are building a macOS/TypeScript/ffmpeg automation pipeline.
- Video generation may come from Dreamina/Jimeng, but it often cannot render readable text and may not produce audio.
- We will add English spoken dialogue and subtitles in post.
- The target style is surreal/postmodern/brainrot talking-head shortform video inspired by Pleometric-like internet video language.
- We need 5–15 second clips first, eventually batched.

Requirements:
- English spoken dialogue.
- API or CLI usable from automation.
- Good voice quality with controllable tone; dry, ironic, documentary, or brainrot delivery.
- Lipsync/talking-head support for non-human/stylized faces if possible.
- No visible watermark if possible.
- Clear commercial/creative usage terms.
- Cost, latency, max duration, output formats, and rate limits.
- Compare hosted APIs vs local/open-source models.
- Include concrete curl/python/node examples where possible.
- Include an evaluation plan and fallback options if lipsync fails on animal faces.

Return:
1. Ranked table of TTS options.
2. Ranked table of lipsync/talking-head options.
3. Recommended practical stack for the first prototype.
4. Recommended local/open-source fallback stack.
5. Exact benchmark plan using one seal image and one 6-second dialogue line.
6. Risks/unknowns and how to test them quickly.
```

Suggested output file:

```txt
data/research/tts-lipsync-gptpro.md
```

## Benchmark fixture

Reference image:

```txt
data/dreamina/reference/talking-seal-underclass.png
```

Dialogue:

```txt
Automation ate the market. By 2040, labor is a fossil. The underclass is permanent, anon.
```

Target duration:

```txt
6 seconds
```

Subtitle rule:

- never ask video model to render text
- generate `.ass` or `.srt` locally
- burn or overlay with ffmpeg after audio/video/lipsync

## Evaluation rubric

Score 1–5:

| Criterion | Meaning |
|---|---|
| Voice quality | Naturalness, charisma, comic timing |
| Controllability | Can specify tone/pace/emphasis |
| Stylized face support | Handles seal/non-human face without melting |
| Lip accuracy | Mouth movement plausibly matches speech |
| Visual preservation | Does not destroy reference image/style |
| Automation | API/CLI quality, docs, auth simplicity |
| Cost/latency | Cheap enough for iteration |
| Watermark/rights | Usable output, acceptable terms |

Minimum viable prototype:

- excellent TTS
- subtitles in post
- either acceptable lipsync or deliberately stylized no-lipsync workaround

## Fallback pipelines

If real lipsync fails on the seal:

1. **Static talking-card pipeline**
   - animate image subtly with zoom/pan/glitch
   - add excellent TTS
   - add subtitles and kinetic typography in ffmpeg/After Effects-style local rendering

2. **Mouth-flap fake lipsync**
   - local mask/warp or simple jaw-open cycles triggered by audio amplitude
   - intentionally surreal, not photorealistic

3. **Human narrator cutaway**
   - Dreamina generates seal visual montage
   - voiceover carries meaning
   - subtitles/text overlays in post

4. **Provider talking-head pass**
   - use best API only when it demonstrably handles stylized animal images

## Implementation handoff after research

Once a provider stack is selected, hand off to the serialization/pipeline lane with:

- provider name and auth method
- request/response examples
- max duration and output format
- cost estimate per 10-second clip
- required source assets
- command/API examples
- benchmark output paths

Do not add provider code until the pipeline format owner has defined where adapters should live.

## Handoff prompt for a worker agent

```txt
You are the TTS/lipsync research lane in /Users/arthur/agents/web-access.
Read docs/plans/README.md and docs/plans/tts-lipsync-research.md.
Only edit docs/plans/tts-lipsync-research.md unless explicitly handed off; write research outputs under ignored data/research/** and benchmark artifacts under data/tts-lipsync-bench/**.
Run or launch the GPT-Pro research prompt if approved. Then produce a ranked recommendation and a tiny benchmark plan for the seal fixture. Do not edit Jimeng or Twitter archive code.
```
