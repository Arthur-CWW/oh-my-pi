# GPT-Pro Research Prompts

## TTS/lipsync + modular AI UGC pipeline research

Status: submitted asynchronously via `llm_frontend_browser` on 2026-06-03. Runtime session notes should live under `data/research/**`, not in this tracked doc.

When using a Pi prompt or LLM handoff that supports file expansion, prefer including context with `@file` references rather than copying large docs by hand.

```txt
You are doing high-effort product/technical research for a macOS/TypeScript/ffmpeg video workflow project.

If your runner supports @file inclusion, include:
- @docs/state/video-creative-direction.md
- @docs/plans/layered-video-graph.md
- @docs/plans/video-asset-library.md
- @docs/plans/tts-lipsync-research.md
- @docs/plans/ai-ugc-format-mining.md
- @docs/plans/machine-roles.md

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

## AI UGC full-influencer market / clean-room clone research

Status: submitted asynchronously via `llm_frontend_browser` on 2026-06-03. Runtime session notes should live under `data/research/**`, not in this tracked doc.

```txt
You are doing high-effort market/product/technical research for a macOS/TypeScript/ffmpeg shortform-video workflow project.

If your runner supports @file inclusion, include:
- @docs/state/video-creative-direction.md
- @docs/plans/layered-video-graph.md
- @docs/plans/video-asset-library.md
- @docs/plans/ai-ugc-format-mining.md
- @docs/schemas/video-asset-catalog-v0.sql

Context:
- We are building a modular, editable, reversible shortform-video pipeline: closer to ComfyUI graph nodes + video-editor layers than one-shot text-to-video.
- The pipeline should support surreal/brainrot videos, but also less-brainrotty AI UGC/ad videos.
- We care about separable components: persona/character, hook/script/dialogue, product/demo slot, background, props/overlays, voice/TTS, lipsync or fake mouth-motion, captions, filters/effects, scheduling/posting/analytics.
- We want a clean-room product/workflow blueprint for building something similar to the most successful AI UGC/full-AI-influencer tools, not stealing code, bypassing paywalls, copying trademarks, or cloning private identities.
- We have a Mac source machine, Framework laptop for archive/data jobs, and Ubuntu desktop with RTX 3090 24GB VRAM. Automation/API/CLI support matters.
- Important rule: video models should not render readable text; captions/subtitles/text overlays happen in post.
- We want central asset metadata: prompts, tags, intended use, provenance, vibe scores, alpha/loopability, workflow usage.

Research objective:
Find the most popular / highest-revenue AI UGC tool(s) for creating “full AI influencers” and explain how to build a clean-room clone or better open/modular alternative.

Define “full AI influencer” explicitly. It may include persistent persona/character identity, consistent face/body/voice across many posts, UGC-style ad video generation, AI avatars/spokespeople, hook/script generation, product/demo slots, caption templates, format cloning/de-editing/remixing, batch generation, posting/scheduling/analytics, and brand/product onboarding.

Research tasks:

1. Market ranking by revenue/popularity
   - Rank AI UGC / AI influencer / avatar ad tools by best available evidence of revenue, ARR, funding, traffic, user count, adoption, pricing, customer logos, creator/community buzz, and headcount.
   - Include at least: Arcads AI, HeyGen, Synthesia, Creatify, Higgsfield Marketing Studio / AI Influencer Studio, Bluma, viral.app, Fastlane/Fast Lane, RentAHuman, Hooked, Affogato, Captions, D-ID, Tavus, Akool, Colossyan, Hour One, Rephrase-style tools, Photo AI, RenderNet, and any newer/bigger candidates.
   - Be explicit when revenue is private/uncertain. Use proxies and confidence scores. Provide source links.

2. Identify the best target to copy/learn from
   - Which tool is likely highest revenue overall?
   - Which is most relevant specifically for full AI influencer / AI UGC ad creation?
   - Which has the best product workflow to emulate for our modular graph/layer pipeline?
   - Which has the strongest moat? Which parts are commodity?

3. Product teardown
   - For the top 3–5 tools, decompose their product into workflows, features, data model, provider/model stack if inferable, UX, pricing, output quality, and distribution strategy.
   - Identify their core user jobs-to-be-done.
   - Identify likely technical architecture and integrations.
   - Identify what they probably do with templates, actors/avatars, scripts, voices, lipsync, captions, b-roll, product images, approvals, and analytics.

4. Clean-room clone blueprint
   - Give a concrete MVP spec to build a similar or better modular tool.
   - Include architecture, node graph model, asset catalog tables, provider adapters, queueing/polling, ffmpeg/Remotion render stack, TTS/lipsync stack, caption system, format-template schema, and analytics.
   - Include what to build first in 1 week, 1 month, and 3 months.
   - Include what to outsource to APIs vs build locally/open-source.
   - Include anti-goals and legal/ethical constraints: do not clone private identities, do not copy proprietary videos verbatim, do not bypass paywalls or terms, avoid deceptive disclosure issues.

5. Competitive differentiation for us
   - We want editable layers and reversible graph nodes, not a black-box generator.
   - We want reusable asset/vibe metadata, not just final videos.
   - We want to support surreal/brainrot and normal UGC in one pipeline.
   - Suggest ways to beat incumbents on remixability, transparency, local control, format mining, and creative weirdness.

Return:
- Executive recommendation first.
- Ranked market table with evidence links and confidence.
- Top product to study/clone clean-room and why.
- Feature teardown table.
- Clean-room MVP blueprint.
- Technical architecture diagram in text.
- Suggested data model / tables.
- Provider/model/API stack recommendations.
- Build roadmap: 1-day benchmark, 1-week MVP, 1-month prototype, 3-month product.
- Risks/unknowns and fastest validation tests.
```

## Follow-up collection commands

After the ChatGPT jobs finish, collect to ignored research artifacts.

TTS/lipsync:

```ts
llm_frontend_browser({
  action: "wait",
  provider: "chatgpt",
  session: "2ad91c31",
  responseTimeoutMs: 900000,
  outputFile: "data/research/tts-lipsync-gptpro.md"
})
```

AI UGC market / clean-room clone:

```ts
llm_frontend_browser({
  action: "wait",
  provider: "chatgpt",
  session: "b62dd3aa",
  responseTimeoutMs: 900000,
  outputFile: "data/research/ai-ugc-market-gptpro.md"
})
```
