# Video Creative Direction State

This is the living **taste ledger / vibe bible / creative north-star** for Arthur's video workflow project.

Purpose: preserve the idiosyncratic preferences that matter more than generic task specs, so future agents do not flatten the project into a bland “AI talking head generator.”

## Maintenance rule

Keep this doc useful, not exhaustive.

Update it only when a preference, workflow principle, tool fact, or creative direction is likely to matter across many future sessions. Do **not** store every aside or transient research detail.

Maintenance expectations:

- edit the canonical sections first; use the care log only for durable changes worth preserving
- reconcile contradictions instead of piling up stale notes
- preserve Arthur's idiosyncratic wording only when it carries real taste/vibe
- separate durable direction from one-off implementation details
- if a detail feels low-signal, leave it in chat or ask before storing it

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
→ TTS / ASMR stems / spatial audio
→ lipsync, avatar control, or fake mouth-motion
→ subtitles/text overlays
→ filters/effects
→ final render
→ model/human analysis
→ remix
```

Terminal-state direction: think bigger than short-video rendering. The long-term endpoint is an **ASMR universe / audio-visual novel / lightweight game-like experience** where characters, entities, speakers, props, overlays, and rooms are layered as editable artifacts. It should feel closer to a small mobile-friendly game engine than a static render: Live2D/VRM/WebGL/WebAudio first, Unreal-like ideas only if they can be reduced into portable primitives. Spatial audio matters: speakers/entities should be movable in 2D/3D space like game objects, with ASMR voice/foley/music tied to scene state.

Pleometric/artifact-library direction: after the current ASMR/Seedance proof, critique before building. Do not jump straight to an “artifact combinator language.” First design the smallest system an agent would actually want to use: a SQLite-backed library of entities/artifacts/effects with previews, metadata, and simple composition actions. The user mostly views and tweaks through an ad hoc web/HyperFrames-like viewer; agents operate the data/code path. Effects/combinators can emerge from repeated operations such as line trains, synchronized copies, JoJo/aura overlays, camera moves, cut rhythms, masks, and audio-sync bindings.


Each component should be separately editable, inspectable, replaceable, cacheable, and reusable.

## Operating principles

### Durable defaults

1. **Separate layers when possible.** Prefer editable characters, backgrounds, props, captions, voice, lipsync, and effects over one-shot whole-video prompts.
2. **Render readable text in post.** Add subtitles, typography, UI labels, and captions after generation instead of relying on video models for text.
3. **Generate reusable primitives, not just final outputs.** Characters, props, overlays, backgrounds, caption styles, filters, and audio stings should be remixable.
4. **Track pipeline metadata as DAG state, not bureaucracy.** Store prompt, provider/model, endpoint, parameters, tags, intended use, vibe notes, dimensions/duration, artifact paths, and workflow usage when that helps reconstruct, compare, rerun, or swap providers. This metadata should converge into centralized SQLite; keep it practical and searchable.
5. **Respect account/rate-limit boundaries.** Health/preflight checks are fine; auth/risk-control bypass attempts are not part of the workflow.

### Strong preferences

- Preverbal/vibe qualities matter; tags like `seal` or `rocket` are not enough.
- Chinese visual-generation prompts are preferred for Jimeng/Dreamina-style models; dialogue can still be English.
- The system has two primary product directions: `brainrot` creation (Pleometric-style surreal/postmodern meme video pipelines) and `ugc-ads` / UGC Studio for making ads. Treat them as first-class lanes/facets in workspace data, reference tagging, filters, prompts, provider defaults, and UI copy.
- For AI UGC experiments, prefer cheap pay-as-you-go APIs over another creator SaaS subscription.
- This lane is mostly hacking/learning, not production. Cheap iteration can default to Kie or similar providers; keep fal/others as fallback or benchmark.
- Provider/API reversal should rank by UGC workflow value first, implementation speed second, and no-spend/ease only as a tie-breaker. Do not substitute low-value read-only routes for higher-value generation, persona/voice, lip-sync, reference-control, or template-mining gaps. When credits are tiny, use dry-run JSON planning and cheap image routes inside the highest-value workflow family; live video/avatar routes are fine inside a named cap with provider, output root, and stop conditions.
- For bulk video understanding/tagging, prefer API benchmarks with local caches/error logs over subscription UI automation; compare OpenRouter/Kie/direct Google on real corpus samples before committing spend.
- Code quality still matters: provider adapters, logging, manifests, spend caps, retries/fallbacks, and reproducible metadata over throwaway spaghetti.
- For Seedance/Jimeng image-to-video, the priority is better video quality. Gemini/Gemini-app/SynthID artifacting is a pixel-conditioning problem: SynthID encodes generation metadata into pixels, which can damage later I2V conditioning. Keep provider/endpoint/model metadata in the pipeline DB/manifests; remove or condition pixel artifacts when they hurt the video.
- For AI companion / AI girlfriend work, split realtime intimacy from offline media generation: realtime loop is persona + memory + STT/TTS + WebAudio spatial ASMR + VRM/Live2D avatar; Seedance/Dreamina/Sonic/Remotion belong to offline render/candidate lanes.

### Tooling notes

- Use `@path/to/file` references in Pi/LLM prompts when supported.
- Jimeng/Seedance direct tooling may live-submit inside an approved bounded envelope; `--dryRun` remains the explicit no-spend path outside that envelope. Keep commands clear, short, logged, concurrency-1, credit-aware, and artifact-backed under ignored `data/**`. For the current ASMR overnight run, Arthur confirmed Jimeng is logged in on Firefox and Chrome; prefer those existing profiles or an ignored refreshed session bundle, with Helium only as fallback. Dreamina needs Arthur reconfirmation before anyone depends on it.
- KIE-backed UGC generation should be the current cheap/default frontend provider while Jimeng reversal remains in progress. Keep KIE dry-run-first in the browser, use Seedream/ByteDance Lite as the frugal routes, and only submit live jobs through named capped envelope actions.
- Jimeng should use a background browser-session proxy while endpoints are still moving: reuse an already logged-in Firefox/Chrome profile or ignored session bundle as the token/session holder, refresh session bundles from it, then graduate stable operations into direct `fetch` clients. Keep reversing every UGC-useful GenAI endpoint, not only text-to-image: reference uploads, persona/subject/character tools, voice, lip-sync/digital human, pose/style/depth controls, image/video generation, canvas edits, asset library, and explore/template APIs. Pick the most important endpoint family first, then the fastest implementation inside that family.
- Jimeng's voice layer is now a usable UGC primitive: built-in voices can be cataloged from the signed `dreamina_tone` feed, and `/mweb/v1/tts_generate` returns base64 MP3 audio for direct TTS. Use this for quick persona voice prototyping while custom voice and subject voice generation still need separate captured contracts.
- Jimeng local reference-image upload is now a usable UGC primitive: `jimeng-browser-proxy upload-image --file <path>` turns a local PNG/JPEG/WebP into a committed ImageX provider URI under `tos-cn-i-tb4s082cfz/...`. Use this for first-frame image-to-video, reference/persona, and image-to-image payload work instead of browser-assisted image upload when possible.
- Jimeng reference-image inspection is now a usable no-spend primitive: `jimeng-browser-proxy describe-image --image <path>` uploads to ImageX when needed, then calls `/mweb/v1/get_image_description` and `/mweb/v1/face_recognize`. Use it to preflight persona/reference images and record provider URI plus description/face-count metadata before wiring deeper pose/control/reference controls.
- Jimeng ControlNet preview is now a usable no-spend UGC primitive: `jimeng-browser-proxy controlnet-preview --image <path> --control pose|depth|canny` uploads to ImageX when needed, calls `/mweb/v1/blend_preview`, saves a local preview PNG, and records the frontend save-param patch for later pose/depth/outline reference payloads. Pose also calls `/mweb/v1/pose_detect`. Style/reference payload controls remain next mapping targets.
- Jimeng object/saliency segmentation is now a usable no-spend UGC primitive: `jimeng-browser-proxy object-mask --image <path> --mode canvas|default|both` uploads to ImageX when needed, calls `/mweb/v1/saliency_seg`, and saves local mask PNGs. Use this for persona cutouts, object isolation, background-paint/reference workflows, and later clean composition controls.
- Jimeng saved subject/persona lifecycle is now usable for no-spend CRUD: `jimeng-browser-proxy subjects --limit 20`, `subject-create`, `subject-update`, and `subject-delete` call `/mweb/v1/dreamina_subject/{get,create,update,delete}` and record subject ids/names/image refs/voice refs while redacting signed media URLs. `subject-generate-voice --dryRun` records the known `image_uri` request shape, but live subject voice generation and custom voice generation still need an approved envelope or captured UI submit inside its cap.
- Jimeng overseas/alternate short-video feed mining is now a usable no-spend primitive: `jimeng-browser-proxy overseas-short-videos --limit 5` calls `/mweb/v1/feed_short_video` and records durable video ids, durations, dimensions, audio flags, ranking signals, and metadata effect ids while redacting signed cover/media URLs. Use it alongside `short-videos` for reference-profile and niche-template research.
- Jimeng first-frame image-to-video is now a usable UGC primitive: `jimeng-browser-proxy image2video --image <path>` uploads a local reference still, injects `first_frame_image`, submits/polls/downloads an MP4 when inside an approved envelope, and exposes duration, ratio, resolution, model, and seed flags. Next Jimeng reversal priority is VOD/video upload plus end-frame/multi-frame/deeper reference controls, not an async daemon.
- For provider/API proof-of-work, tests are necessary but not sufficient when the output is media. Save local artifact bundles under ignored `data/**` with the exact command, manifest, and playable/listenable audio or video so Arthur can inspect the result directly.
- Jimeng/Dreamina proof prompts should be useful, Chinese, and in-distribution for AI UGC work. Avoid throwaway demo prompts; use Korean-beauty, TikTok-profile, persona, reference-upload, product demo, hook/CTA, or campaign prompts that could actually feed the UGC pipeline.
- For Jimeng/Dreamina reversal, use approved bounded live/capture matrices as the fastest source of truth when credits are available: run useful Chinese UGC examples inside the named provider cap and `data/**` output root, save raw/normalized JSON and artifacts, infer contracts/scaffolds from them, then test through replayed fixtures and Vitest snapshots. Hand-written dry-run planners are fallback/compare-gate work when live capture is blocked, risky, or intentionally deferred.
- Jimeng/Dreamina CLI work can become async-by-default later, after API contracts settle: submit/write a local job record first, optionally `--wait`/`--sync`, then persist request/response JSON, artifacts, and normalized summaries under ignored `data/**`. Defer the daemon/job phase while endpoint coverage is still the active work.
- Jimeng/Dreamina reveng should checkpoint one feature slice at a time. After a coherent API section is implemented, tested, proven, and documented, git save that slice before moving to the next feature.
- For the UGC/video pipeline, keep serialization JSON-first: recipes, manifests, timelines, provider prompt cards, and reports should be plain versioned JSON unless there is a strong later reason to add another format.

## What Arthur actually cares about

- A pipeline that feels like an editable creative instrument, not a black-box generator.
- Separating character generation from backgrounds, props, text, voice, lipsync, and final composition.
- Building an asset library of “vibe primitives” that can be recombined.
- Capturing weird internet-native references: niche humor, Chinese memes, abstract/brainrot aesthetics, postmodern absurdity.
- TikTok/anime “aura edit” montage language: character-centric mythic glamor, hardstyle/Versatile-style beat energy, kinetic panel cuts, glow/contrast, and caption/text swaps.
- Pleometric-style surreal/postmodern talking-head videos, but not merely copying Pleometric.
- AI UGC format cloning at the structural level: swap influencer/persona, hook, product, captions, and scene format.
- Understanding why successful shortform videos work: hook, pacing, captions, visual clutter, authority signals, cringe, emotional pressure.
- Building comparison-ready decompositions: reference video → timestamped layer/asset decomposition; generated video → same decomposition; diff the two to optimize prompts, assets, providers, and edits.
- A single local-first pipeline workbench/GUI for browsing all pipeline data: runs, elements, versions, metrics, artifacts, DAG stages, annotations, custom viewers, and rerun/resume controls.
- The workbench is closer to “Cursor/Zed for AI TikTok/video pipeline engineering” than a dashboard: orchestrate agents, terminals, provider runs, DAG stages, evals, artifacts, and infinite-remix loops.
- Slotok's default UI should follow the Codex-like light workbench design language captured in `docs/state/slotok-design-language.md`, not the current dark/orange analytics-dashboard shell.
- Keyboard-first / vim-like interaction should be a default for review tools: `j/k`, `/`, `gg/G`, `g<letter>` view switching, quick annotations, and fast batch navigation.
- The workbench should support generated/hot-swappable data views: raw JSON is always available, but selected elements should also have purpose-built visual React/Solid/HTML renderers that can be iterated quickly, potentially with Pi/Codex assistance.
- The AI UGC UI direction should feel like **Figma for UGC ads**: open-ended canvas first, tastefully minimal chrome, floating prompt/workspace command surface, and a real video-editor/layers/timeline view rather than only campaign tables or constrained dashboards.
- Prefer secondary controls in lightweight floating modals/popovers over always-visible heavy side menus when exploring campaign setup, layer generation, assets, provider route, or JSON recipe settings.
- The primary AI UGC workflow is **creative exploration over many generated candidates**, not manual attribute editing. The user directs one agent to generate, critique, fork, and revise batches of personas, hooks, clips, CTAs, and campaigns.
- Treat synthetic influencers as **whole personas / TikTok profiles**, not single figures or one-off ads: appearance, voice, accent, interests, niche, posting style, promoted products, non-ad posts, CTA behavior, and continuity all need to be tracked.
- Support “babble and prune”: generate many variations early, flip through playable examples quickly, annotate what works, ask the agent for broad changes, fork directions, and only expose detailed layer controls during late fine-tuning.
- ComfyUI-style node graphs are useful as a developer/pipeline view, but the primary creative UI should operate at higher abstractions: persona collections, format explorations, campaign branches, snapshot history, and agent instructions.
- Future reference-profile workflows should decompose a TikTok/influencer/faceless profile into reusable mechanics: pose/timing, gesture rhythm, shot structure, caption/text template, hook families, voice-line structure, CTA pattern, and posting strategy. The swapped output should use a synthetic/right-cleared persona, voice, product, hook copy, and captions.
- Korean-beauty/K-pop-idol-like influencer aesthetics are a genre worth exploring for AI UGC persona work because they are visually optimized and striking; keep this as a creative lane rather than treating the pasted ABG paywall/onboarding screen as a UX reference.
- Keep prompts, provider/model/endpoint choices, params, artifact paths, tags, vibes, and rerun lineage in a centralized SQLite catalog so the DAG can reconstruct artifacts and rerun steps with different providers.
- Using the prototype to discover the pipeline architecture, not to optimize one throwaway video.

## Prototype concepts

One-off scripts and run-specific creative targets belong in `docs/drafts/`, not in this durable state doc.

- `docs/drafts/post-labor-seal-video.md` — early surreal seal prototype and lesson about adding text/voice in post.

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
- What provider, model, endpoint, and parameters generated it?
- What source/internet reference inspired it?
- What semantic tags apply?
- What vibe axes does it activate?
- Does it conflict with subtitles?
- Which workflow runs, DAG nodes, and provider jobs used it?

Runtime DB target:

```txt
data/asset-catalog/assets.sqlite
```

Schema doc:

```txt
docs/schemas/video-asset-catalog-v0.sql
```

Near-term catalog plan:

- Treat provider metadata as internal DAG state: useful for rerun, comparison, provider swaps, and debugging; not a reader-facing requirement checklist.
- Use SQLite first because agents can query/mutate it cheaply and Arthur can review it through simple generated views. Keep recipes/manifests JSON-first at the edges.
- Track five practical object families before inventing new vocabulary:
  - `entities`: characters, speakers, props, rooms, products, abstract meme objects, and ASMR presence anchors.
  - `assets`: concrete files/provider refs such as images, cutouts, masks, video clips, audio stems, captions, prompt cards, and reference samples.
  - `effects`: reusable operations like aura/glow, line trains, synchronized copies, mask reveals, beat zooms, camera moves, caption-safe treatments, and spatial-audio bindings.
  - `compositions`: small layer stacks/timelines that connect entities/assets/effects into Remotion/HyperFrames-ready outputs.
  - `provider_jobs`: prompt, provider/model/endpoint, request params, output refs, hashes, rerun lineage, and stop-condition metadata as internal DAG state.
- First viewer should be ad hoc and review-oriented: browse cards, play media, inspect JSON, tag vibes, mark keep/reject, and tweak notes. A full node editor can wait.
- Avoid a premature artifact-combinator DSL. Repeated agent operations should harden into helper functions, then schema fields, and only much later into a language if plain SQLite + JSON stops being enough.

Concrete first implementation slice: create the catalog schema, import the accepted ASMR companion proof bundle as one composition with linked provider jobs/assets/effects, and expose a read-only viewer page that proves Arthur can inspect the generated clip, spatial audio master, overlays, and DAG metadata without reading raw manifests first.


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

The primary UX should move through progressive abstraction levels:

```txt
concept / product / offer
→ persona exploration
→ format exploration
→ hook + clip batch generation
→ prune / annotate / fork
→ CTA and non-CTA campaign mix
→ metrics review
→ final layer-level tuning
→ export / schedule / rerun
```

At the early stage, the UI should feel more like a fast review and exploration surface than a manual editor:

- show many persona/profile or clip candidates as playable examples
- let the user flick through examples within each stage of the workflow
- keep notes and critiques attached to candidates, branches, and snapshots
- let the agent apply instructions across a selected set, such as changing enthusiasm, accent, CTA pressure, hook families, or persona niche
- preserve a snapshot/fork/checkpoint history so dead-end branches can be abandoned and strong directions can be expanded

Persona/profile generation should track a richer collection model:

- stable synthetic identity and appearance
- voice, accent, speaking style, energy, mannerisms, and interests
- niche, special interest, promoted-product lane, and audience assumptions
- reusable image/video references when selected for the workflow or generated, with source/use notes attached
- profile-level non-ad content strategy for follower-building posts
- ad content strategy for hooks, proof, demos, CTAs, and conversion tests

Campaign generation should support mixed posting strategies:

- direct CTA ads with CTA variants and performance tracking
- non-CTA persona-building posts, dances, edits, trends, or cutesy/viral filler where strategically useful
- A/B tests across hooks, CTAs, personas, formats, scripts, captions, and proof slots

Reference/profile remixing should be treated as an editable local artpiece/workflow lane:

```txt
reference archive
→ video/sample selection
→ pose/timing/gesture extraction
→ transcript/voice-line and hook-template extraction
→ caption/text/template extraction
→ format/profile bible
→ persona / voice / product / remix swap
→ generated batch
→ compare against the desired vibe/mechanics
```

Useful variants:

- faceless profile remixing is easier because the style is mostly templates, timing, b-roll, hooks, captions, and posting strategy
- direct source references, characters, music, trademarks, or likeness can be used as local remix/artpiece ingredients when Arthur wants that; keep them as intentional source/use choices instead of default exclusions
- niche research should eventually discover successful profiles/campaigns/templates in a target market and turn them into reusable format templates

Important source/reference preference:

- Keep source/reference handling lightweight; avoid default gates that are unrelated to the current creative workflow.
- Keep source/reference notes only when they help iteration, search, reruns, comparison, or handoff.
- If a workflow is meant for public/commercial release, handle clearance as a later explicit distribution constraint, not as a default constraint on local remix exploration.

Tool leads, source URLs, provider price tables, and market teardowns belong in:

- `docs/plans/ai-ugc-format-mining.md`
- `docs/research/arcads-alternative/`
- `docs/research/ai-ugc-providers/`

## Tool/machine preferences

- Main Mac: source-of-truth repo, logged-in browsers, Jimeng/Dreamina capture, Gemini CLI, ChatGPT Pro research.
- Official `dreamina` generator commands may be VIP-gated or silently fail for the current account; build and prefer a Dreamina-compatible direct client backed by reversed Jimeng frontend endpoints/captures.
- Desktop GPU: RTX 3090; good candidate for ComfyUI/local model experiments, but setup is currently messy/incomplete.
- Framework laptop: long-running data/archive worker; good disk; not source-of-truth editing machine initially.

## Active work and research

Active lanes, run coordination, and implementation tasks belong in `docs/plans/` and `data/coordination/`, not in this durable taste ledger.

Start with `docs/plans/README.md` for the current lane map.

## Care log

### 2026-06-20

Arthur clarified:

- TikTok references are bootstrap fuel stock for our own generation pipeline, not the final goal. Decompose reference videos to extract structural mechanics (hook, pacing, shot rhythm, caption templates, CTA patterns), then feed those mechanics into synthetic generation. Treat TikTok as reference material, not as the distribution target or literal-copy endpoint.
- Decomposition should support interchangeable analysis lanes: frame/VTT screenshot+transcript analysis and native full-video Gemini understanding. Implement both lanes, run them on the same reference, and compare/evaluate which captures structural detail better per format or content category.
- Use OMP/Antigravity OAuth (`google-antigravity/gemini-3.5-flash-low`) for Gemini Flash orchestration and decomposition where possible. OMP account ranking should pick the higher-headroom account when multiple Antigravity OAuth logins are available, so decomposition runs do not silently burn paid API quota.
- Use specialized personas or sort docs per pipeline stage to inject intelligence and refine skills. Each pipeline stage (decomposition, persona generation, script/hook, asset generation, TTS/audio, composition, review) should have a tailored agent brief with stage-specific heuristics, quality gates, and reference examples.
- OMP `--mode rpc` and `rpc-ui` can stream `AgentSessionEvent` and subagent events. This is a documented future path for a Slotok web monitoring bridge that would surface live pipeline orchestration in the workbench. Document as planned, not as implemented — no live RPC bridge or Slotok event ingestion exists yet.
- Use Jimeng reverse-engineered APIs for persona/profile creation and remix exploration. Direct creator/source references are allowed for local artpiece experiments when Arthur wants them; for public/commercial outputs, decide any identity/clearance boundary explicitly at that later distribution step instead of injecting it into every creative plan.

### 2026-06-09

Arthur clarified:

- For the UGC Studio UI implementation stack, maintain React + Tailwind + shadcn as the primary route. Remove the old Solid UGC Studio implementation instead of keeping two competing UI stacks.
- UGC Studio should be local-first in Electron: persist workspaces, personas, campaigns, candidates, provider jobs, branch snapshots, notes, archives, and exports locally first; network/provider calls should be explicit jobs with cached request/response metadata.
- KIE is the near-term generation provider for the workbench, but should stay frugal: browser actions should build dry-run JSON by default, expose credit checks, use cheap image routes before video, and cap live submissions tightly because the current account only has a small credit balance.
- For the Arcads/Higgsfield-style website demo, the preferred direction is “Figma for UGC ads”: an open canvas with video artboards, editable layer stacks/timeline, floating prompt/workspace command, and secondary menus in modal surfaces. The earlier generated designs were too constrained and missed the video editor/layer view.
- The product should focus on creative exploration of whole AI UGC personas, TikTok-profile-like collections, formats, and campaigns rather than only single ads or single clips. The user mostly directs one agent to generate, critique, fork, and revise batches; detailed layer editing is a late-stage/fine-tuning mode.
- ComfyUI-style graphs are valuable for a developer/pipeline view, but too granular as the default creative surface. The main UI should expose stages, examples, branches, notes, playable candidates, and snapshot history; users should be able to flick through many generated examples at each stage.
- Campaigns should track both CTA/conversion tests and non-CTA persona-building posts. The system should support branching exploration, pruning dead ends, returning to earlier checkpoints, and expanding promising influencer/persona directions.
- Add a future reference-profile-remix lane: archive/decompose selected TikTok/UGC/faceless profiles, capture pose/timing/template mechanics, and swap in synthetic personas, new voice, new product, new hooks, and new captions. Korean-beauty/K-pop-idol-like influencer aesthetics are a promising creative genre; the pasted ABG paywall flow is not a UX target.
- Jimeng/Dreamina voice/TTS reversal is confirmed enough for pipeline prototyping: config probes, built-in voice library replay, and direct MP3 TTS are implemented; custom voice, subject/persona voice generation, lip-sync generation, and canvas/reference-video flows remain the next captured-contract work.
- Provider API QA should include real output artifacts when practical: for TTS/audio and video generation, save the playable files plus exact commands in an ignored proof directory, not only unit tests.

### 2026-06-08

Arthur clarified:

- For large-scale video understanding/tagging, benchmark API providers on the downloaded corpus instead of relying on Gemini subscription UI limits.
- Prefer providers that can be logged/cached/retried cleanly; track cache misses, provider errors, usage, credits, and estimated costs.
- Kie.ai and direct Google Gemini API keys may both be used for controlled evals; treat Kie Gemini caching as unproven unless docs/results show otherwise.
- Video understanding outputs should decompose references into timestamped layers, assets-to-generate, provider/API experiment matrices, and comparison-ready features so generated videos can be decomposed and diffed against targets later.
- Pipeline review tooling should feel fast and local-first: preload batches into the browser, cache aggressively, keep annotations local, support DAG/data/detail views, and use CDP automation for background GUI smoke tests/screenshots/iteration rather than foreground browser control.
- Naming/vision candidates include Slotok, Cursor for TikTok, infinite remix machine, and torment-nexus/infinite-experience-machine inspired language; preserve the weird memetic ambition instead of flattening it into “video dashboard.”

### 2026-06-05

Arthur clarified:

- Start the Arcads/Higgsfield alternative by making the CLIs first.
- Keep pipeline serialization simple with JSON, not YAML.

### 2026-06-04

Arthur clarified:

- Research target: build an Arcads.ai-style alternative blueprint, including likely stack/models, feature decomposition, and fast prototype path for AI UGC and AI influencer generation.
- Cheap AI UGC direction: avoid another subscription; prefer low-cost PAYG APIs for experiments. Kie can be the cheap default, with fal/others as fallback or benchmarks.
- Keep local tooling clean even when providers are hacky: adapters, logs, manifests, spend caps, and reproducible metadata.

### 2026-06-03

Arthur clarified:

- The prototype is for discovering the pipeline; individual videos are secondary.
- The workflow should feel like editable video-editor layers / ComfyUI graph nodes.
- Fun/stupid brainrot primitives, niche internet humor, and Chinese meme aesthetics are good.
- Preverbal vibe qualities matter as much as semantic tags.
- Keep centralized metadata for prompts, providers, tags, vibes, intended use, source notes, and rerun lineage.
- Archive public inspiration with account safety in mind; skip likes/private/locked content.
- Prefer Dreamina/Jimeng direct-client behavior that actually submits live jobs by default, with `--dryRun` as the opt-out.
- New creative lane: TikTok/anime “aura edit” montage energy — hardstyle/Versatile-style music, mythic character focus, panel motion, glow/contrast, and text/dialogue replaced in post.
- For anime/manga-style lanes, prefer user-provided/licensed assets or original generated assets over scanlation/piracy scraping.
