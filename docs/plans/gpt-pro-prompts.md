# GPT-Pro Research Prompts

## TTS/lipsync + modular AI UGC pipeline research

Status: submitted asynchronously via `llm_frontend_browser` on 2026-06-03. Runtime session notes should live under `data/research/**`, not in this tracked doc.

```txt
You are doing high-effort product/technical research for a macOS/TypeScript/ffmpeg video workflow project.

Context:
- We are building a modular, editable, reversible shortform-video pipeline, closer to ComfyUI graph nodes + video-editor layers than one-shot text-to-video.
- The prototype is surreal/postmodern/brainrot talking-head videos inspired by Pleometric-like internet video language, but the same pipeline should later support less-brainrotty AI UGC/ad videos.
- Components should be separately swappable: source/inspiration, script/hook/dialogue, character asset, background, props/overlays, motion/video, TTS/audio, lipsync or fake mouth-motion, subtitles/text overlays, music/SFX, filters/effects, analysis.
- We have a Mac source machine, a Framework laptop for long-running archive/data jobs, and an Ubuntu desktop with RTX 3090 24GB VRAM. ComfyUI exists on the desktop but setup is messy.
- We can use local ffmpeg and Python, frontend tools, hosted APIs, or local/open-source models. Automation/API/CLI support matters.
- Important rule: never ask video models to render readable text; captions/subtitles/text overlays happen in post.
- Current test character is a stylized seal talking about automation/post-labor economy. Animal/stylized face support matters.
- We need central asset metadata: prompts, tags, intended use, provenance, vibe scores, alpha/loopability, workflow usage.

Research tasks:

1. TTS options
   - Rank current best hosted and local TTS options for 5–15 second English shortform clips.
   - Include ElevenLabs, Cartesia, OpenAI TTS, PlayHT, Azure/Google/AWS, Kokoro/XTTS/Piper-style local options, and any better current choices.
   - Compare naturalness, controllability, latency, API/CLI quality, cost, licensing/commercial usage, voice cloning, emotional control, and output formats.

2. Lipsync / talking-head options
   - Rank current best hosted and local/open-source lipsync/talking-head options.
   - Include Sync Labs, Hedra, D-ID, HeyGen-like APIs, Runway/Act-One-style tools if relevant, Replicate models, Wav2Lip, MuseTalk, SadTalker, LivePortrait, LatentSync, AniPortrait-style projects, and any newer/better tools.
   - Focus especially on whether they work with stylized/non-human faces like a seal or mascot.
   - Compare automation/API access, watermarking, max duration, cost, latency, failure modes, and commercial terms.

3. Modular pipeline recommendation
   - Recommend a first practical prototype stack where layers stay editable.
   - We care more about component quality and reusability than a single one-shot polished clip.
   - Include fallback strategies if lipsync fails on animal/stylized faces: stylized mouth-flap, amplitude-driven mouth mask, no-lipsync voiceover + strong captions, etc.
   - Specify which components should be local deterministic nodes vs provider/model nodes.

4. AI UGC / format cloning tools
   - Identify current tools/products that decompose or generate AI UGC/ad videos with swappable influencer/persona/hook/product/captions.
   - We saw references to Bluma, Arcads AI, Higgsfield Marketing Studio, viral.app, Fastlane/Fast Lane, RentAHuman, Hooked, Affogato, HeyGen/Synthesia/Creatify-style tools.
   - Explain which are closest to a node-based/de-edit/remix workflow and what we can learn from them.
   - Focus on ethical high-level format decomposition, not copying private identities or copyrighted videos verbatim.

5. Concrete benchmark plan
   - Provide an exact 1-day benchmark plan using a single stylized seal image and this dialogue:
     “Automation ate the market. By 2040, labor is a fossil. The underclass is permanent, anon.”
   - Include commands/API examples where possible.
   - Include what artifacts to save and what metadata to record in SQLite.
   - Include a scoring rubric for voice quality, lip plausibility, visual preservation, automation quality, cost, and modular editability.

Return format:
- Executive recommendation first.
- Ranked TTS table.
- Ranked lipsync/talking-head table.
- Recommended prototype graph with nodes and artifacts.
- Hosted stack, local/GPU stack, and cheapest fallback stack.
- AI UGC/de-edit tool notes.
- 1-day benchmark checklist.
- Risks/unknowns and how to test quickly.

Please be specific and practical: include exact provider/model names, API docs links or source repo links, rough pricing, duration limits, and example curl/python/node snippets where possible.
```

## Follow-up collection command

After the ChatGPT job finishes, collect to an ignored research artifact:

```ts
llm_frontend_browser({
  action: "wait",
  provider: "chatgpt",
  session: "latest",
  responseTimeoutMs: 900000,
  outputFile: "data/research/tts-lipsync-gptpro.md"
})
```
