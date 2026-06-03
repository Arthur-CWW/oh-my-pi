# Video Creative Direction State

This is the living **taste ledger / vibe bible / creative north-star** for Arthur's video workflow project.

Purpose: preserve the idiosyncratic preferences that matter more than generic task specs, so future agents do not flatten the project into a bland “AI talking head generator.”

## Maintenance rule

Keep this doc healthy and synchronized with Arthur's session-level guidance.

When Arthur states a new durable creative preference, aesthetic direction, workflow principle, tool/machine fact, or anti-goal, update this doc in the same session unless he says not to. Do not only keep it in chat memory.

Maintenance expectations:

- add new durable guidance to the relevant section
- append dated items to the care log
- reconcile contradictions instead of piling up stale notes
- preserve Arthur's idiosyncratic wording when it carries vibe/taste
- separate durable direction from one-off implementation details

## Short name

Use this doc as the canonical:

```txt
Video Creative Direction State
```

Other useful names for the concept:

- taste ledger
- vibe bible
- creative north-star
- aesthetic state
- preference state
- memetic direction brief
- vibe ontology

## North star

Build a modular, editable, reversible video-generation pipeline — closer to **ComfyUI graph nodes + video-editor layers** than a one-shot text-to-video prompt.

The prototype videos are not the end goal. The end goal is the pipeline:

```txt
inspiration archive
→ format decomposition
→ script/hook/dialogue
→ character assets
→ prop/brainrot assets
→ backgrounds/scenes
→ motion/video generation
→ TTS/audio
→ lipsync or fake mouth-motion
→ subtitles/text overlays
→ filters/effects
→ final render
→ model/human analysis
→ remix
```

Each component should be separately editable, inspectable, replaceable, cacheable, and reusable.

## Hard creative/technical rules

1. **Do not one-shot the whole video if layers can be separated.**
2. **Never ask video models to render readable text.** Add subtitles/text in post with ffmpeg/Remotion/CapCut-like local layers.
3. **Chinese visual-generation prompts are preferred** for Jimeng/Dreamina-style models.
4. **Dialogue can be English** even when visual prompts are Chinese.
5. **Every asset should carry metadata:** prompt, provider, model, tags, intended use, vibe scores, provenance, dimensions, duration, alpha/loopability.
6. **Preverbal/vibe components matter as much as semantic content.** Tags like `seal` or `rocket` are not enough; record the felt quality.
7. **Generate assets as reusable primitives, not just final outputs.** Characters, dangling keys, captions, backgrounds, filters, sound stings, etc. should be remixable.
8. **Account/risk safety matters.** Do not get banned by X/Twitter. Do not brute-force rate limits, auth challenges, or Jimeng risk controls.
9. **The system should later support both brainrot art videos and less-brainrotty AI UGC/ad videos.**
10. **When composing Pi/LLM prompts, use `@path/to/file` references where supported** so the prompt can auto-include maintained context docs instead of manually pasting or duplicating them.
11. **Dreamina/Jimeng direct tooling should behave like real generation tooling: live submit by default, `--dryRun` as the explicit opt-out.** Do not add hidden “yes spend credits” gates that make the default path a no-op; instead keep commands clear, short, logged, concurrency 1, and credit-aware.

## What Arthur actually cares about

- A pipeline that feels like an editable creative instrument, not a black-box generator.
- Separating character generation from backgrounds, props, text, voice, lipsync, and final composition.
- Building an asset library of “vibe primitives” that can be recombined.
- Capturing weird internet-native references: niche humor, Chinese memes, abstract/brainrot aesthetics, postmodern absurdity.
- TikTok/anime “aura edit” montage language: character-centric mythic glamor, hardstyle/Versatile-style beat energy, kinetic panel cuts, glow/contrast, and caption/text swaps.
- Pleometric-style surreal/postmodern talking-head videos, but not merely copying Pleometric.
- AI UGC format cloning at the structural level: swap influencer/persona, hook, product, captions, and scene format.
- Understanding why successful shortform videos work: hook, pacing, captions, visual clutter, authority signals, cringe, emotional pressure.
- Keeping prompts/provenance/tags/vibes in a centralized SQLite catalog.
- Using the prototype to discover the pipeline architecture, not to optimize one throwaway video.

## Current creative target

Initial concept:

```txt
A surreal talking seal summarizes a teortaxes-ish tweet about automation, post-labor economy,
permanent underclass, state/oligarchic power centralization, and trying to convert wealth
into equity/stake in the posthuman economy.
```

Attempted dialogue:

```txt
Automation ate the market. By 2040, labor is a fossil. The underclass is permanent, anon.
```

Important lesson from the bad generated test:

```txt
Dreamina/Jimeng should generate visuals only. Text, subtitles, typography, and voice happen in post.
```

## Vibe ontology v0

These are not rigid categories. They are handles for the aesthetic/memetic qualities Arthur cares about.

### Core vibe axes

| Axis | Meaning |
|---|---|
| `post-labor-dread` | automation, useless labor, permanent underclass, future market irrelevance |
| `agency-anxiety` | wanting ownership/equity/stake before the posthuman economy locks in |
| `oligarchic-centralization` | state/corporate/elite power consolidation, closed futures |
| `market-ritual` | charts, rockets, number-go-up mysticism, finance as cult ceremony |
| `cute-menace` | cute animal/mascot but spiritually threatening or existentially bleak |
| `abstract-chinese-internet` | 抽象, 魔性, 土味, 赛博, 内卷, 电子木鱼-like meme energy |
| `bureaucratic-absurdity` | forms, stamps, official notices, fake institutions, procedural surrealism |
| `brainrot-density` | overstimulating props, jingles, captions, loops, novelty, speed |
| `caption-safe-composition` | whether an asset leaves room for readable subtitle overlays |
| `artifact-consciousness` | deliberately aware of AI slop/artifact soup without relying on broken output |

### Useful memetic ingredients

- dangling keys / baby sensory attention bait
- rockets and financial charts as market ritual
- seal/animal host as absurd authority figure
- mathematical symbols and cold automation diagrams
- Chinese stamps, QR codes, red seals, official forms
- “电子木鱼” / merit-clicking ritual energy
- 内卷 / 打工人 / 赛博打工人 motifs
- surreal UI overlays, dashboards, leaderboards, token meters
- glitchy but controlled captions and kinetic typography
- product/ad UGC tropes: selfie authority, podcast authority, bedroom testimonial, app demo, pain-point hook

## Asset-library direction

Assets should be tracked as composable primitives:

```txt
character / background / prop / overlay / mask / audio / caption-style / filter / scene-template / format-template
```

Each asset should answer:

- What is it?
- What stage/layer is it for?
- Is it loopable?
- Does it have alpha or a usable mask?
- What prompt generated it?
- What provider/model generated it?
- What source/internet reference inspired it?
- What semantic tags apply?
- What vibe axes does it activate?
- Does it conflict with subtitles?
- Which workflow runs used it?

Runtime DB target:

```txt
data/asset-catalog/assets.sqlite
```

Schema doc:

```txt
docs/schemas/video-asset-catalog-v0.sql
```

## AI UGC direction

The future AI UGC system should decompose popular videos/formats into reusable structures:

```txt
format
→ hook type
→ character/persona
→ scene setup
→ shot rhythm
→ caption style
→ product/demo slot
→ proof/authority slot
→ CTA slot
```

Then swap:

- influencer/persona
- product/app
- hook text
- visual proof
- voice
- captions
- background
- filters

Important ethical/product constraint:

- Clone high-level format mechanics and pacing, not private identities or copyrighted videos verbatim.

Likely remembered tool from browsing history:

```txt
Bluma — described as de-editing videos into scenes, captions, and elements with a node-based canvas.
```

Other relevant tools/leads:

- Arcads AI
- Higgsfield Marketing Studio / AI Influencer Studio
- viral.app
- Fastlane/Fast Lane
- RentAHuman
- Hooked
- Affogato
- HeyGen / Synthesia / Creatify-style tools

Current research direction:

- Identify the most popular / highest-revenue AI UGC or full-AI-influencer tools using public evidence and proxies.
- Arcads.ai is now a primary product to reverse-map clean-room: infer the full stack/model choices from public behavior, then design a feature-by-feature equivalent that can be prototyped quickly with open models and/or commodity APIs.
- Study the best product workflows clean-room: what to emulate, what is commodity, what is moat.
- “Copy them” means build a similar/better modular workflow from public behavior and first principles, not stealing code, bypassing paywalls, copying trademarks, or cloning private identities.

## Tool/machine preferences

- Main Mac: source-of-truth repo, logged-in browsers, Jimeng/Dreamina capture, Gemini CLI, ChatGPT Pro research.
- Official `dreamina` generator commands may be VIP-gated or silently fail for the current account; build and prefer a Dreamina-compatible direct client backed by reversed Jimeng frontend endpoints/captures.
- Desktop GPU: RTX 3090; good candidate for ComfyUI/local model experiments, but setup is currently messy/incomplete.
- Framework laptop: long-running data/archive worker; good disk; not source-of-truth editing machine initially.

## Current parallel lanes

- Jimeng/Dreamina frontend API reversal: find true image-to-video/multimodal payloads.
- TTS/lipsync research: high-quality voice first; lipsync if stylized/non-human faces work.
- Pleometric + UGC source archive: public tweets/videos/articles, no likes, respectful capture.
- Layered pipeline serialization: YAML recipe + JSON run manifest + SQLite asset catalog.
- Brainrot asset pack: generate stupid/fun composable overlays/props as graph primitives.
- Desktop GPU/ComfyUI rehab: use 3090 for local experiments if worth the setup cost.

## Care log

### 2026-06-04

Arthur clarified:

- New GPT-Pro research prompt target: build an Arcads.ai alternative blueprint, including the whole likely stack/models, feature-by-feature product decomposition, and a fast prototype path using different open models/APIs for AI UGC, people/video inputs, formats/templates, and AI influencer generation.

### 2026-06-03

Arthur clarified:

- Use the prototype to build the pipeline; the individual video is secondary.
- Components should be separable like video-editor layers.
- End goal resembles ComfyUI/reversible graph nodes.
- Make fun/stupid brainrot assets too, not only talking heads.
- Niche internet humor and Chinese internet memes are good.
- Maintain centralized SQLite metadata for tags/prompts/intended use.
- Preverbal evocative/vibe components matter at least as much as semantic meaning.
- Archive future accounts too, not only Pleometric; yes to tweets/replies/quotes/media, no to likes.
- Avoid getting banned by Twitter/X; consider a different account first.
- Maintain state docs as living memory: if Arthur gives new durable preferences or direction in a session, update the state docs so they stay synchronized with what he actually cares about.
- When writing prompts for new Pi/LLM sessions, use `@file/path` context references where possible so maintained docs are auto-included rather than copied by hand.
- New GPT-Pro research target: find the most popular/highest-revenue AI UGC/full-AI-influencer tool(s), then produce a clean-room blueprint for building a similar or better modular graph/layer alternative.
- Official `dreamina` generator commands are not the source of truth if account tier/VIP gates block them. Build a Dreamina-compatible direct client from reversed web endpoints. Its default should be live generation like the official CLI; `--dryRun` is the flag for no-spend planning, not the default behavior.
- New creative lane: TikTok-style Griffith/anime “aura edit” montage energy — hardstyle/Versatile-style music, mythic character focus, panel motion, glow/contrast, and replacing dialogue/text in post.
- Legal/provenance constraint for this lane: use user-provided/licensed manga/anime assets or original generated character-inspired assets; do not rely on scraping scanlation/piracy sources as the input pipeline.
