# AI UGC Format Mining Plan

## Goal

Build a reusable inspiration/analysis lane for AI UGC and shortform ad formats: identify popular formats, decompose them into editable graph layers, and later feed them into the pipeline recipe format.

This is related to, but separate from, the Pleometric/brainrot archive. The same graph should support both:

- surreal/postmodern/brainrot videos
- more conventional AI UGC videos where the influencer/character, hook, product, captions, background, and effects are swappable

## What Arthur described

Desired end state:

- not one-shot whole-video generation
- components behave like editable video-editor layers / ComfyUI-style graph nodes
- separate character, background, props, hook text, dialogue, TTS, captions, filters, motion, and analysis
- reusable brainrot elements such as dangling keys, rockets, math boards, UI overlays, etc.
- later support AI UGC workflows that clone high-level popular formats while swapping the influencer/persona and hook/product
- later support reference-profile remixing: archive/decompose a public or rights-cleared TikTok/UGC/faceless profile, preserve pose/timing/template mechanics, and swap in a synthetic persona, new voice, product, hooks, captions, and CTA
- eventually research a niche, identify successful profiles/campaigns/templates, and turn those into abstract clean-room format templates

## Likely tool Arthur was trying to remember

From recent Firefox/X history, **Bluma** is the closest semantic match:

- X post: `https://x.com/_alisawu/status/2032191984891543814`
- title snippet: “introducing Bluma. the all-in-one platform for AI UGC. we’re the first to de-edit videos - breaking them into scenes, captions, and elements automatically. Bluma lets you create winning organic short-form and paid ads with our asset generator and node-based canvas...”

Other strong candidates from history:

- **Arcads AI** — `https://x.com/arcads_ai`, `https://www.arcads.ai/`
- **viral.app** — `https://viral.app/`
- **Higgsfield Marketing Studio / AI Influencer Studio** — `https://higgsfield.ai/marketing-studio/product`, `https://higgsfield.ai/ai-influencer-studio`
- **Fast Lane / Fastlane** — mentioned in Sumaiya post: `https://x.com/4_emon2115/status/2051843718294983165`
- **RentAHuman** — `https://rentahuman.ai/`
- **Photo AI** — Levels mention of talking videos/UGC influencers: `https://x.com/levelsio/status/2029639384023117858`

External search also surfaced:

- **Hooked** — `https://www.hooked.so/`
- **Affogato** — `https://affogato.ai/`
- **HeyGen/Synthesia/Creatify-style AI avatar ad tools**

## GPT-Pro AI UGC market research distillation

Source: ignored artifact `data/research/ai-ugc-market-gptpro.md`, collected on 2026-06-03. Treat it as external research advice: verify public market claims before relying on them in user-facing docs or product decisions.

### Working definition: full AI influencer

A “full AI influencer” is a persistent synthetic-media system, not just a one-off talking-head clip. Minimum reusable components:

- persistent visual identity / character reference
- persona bible: niche, tone, backstory, boundaries, allowed uses
- repeatable voice or licensed cloned voice
- hook/script generation and rewrite loops
- video/avatar/lipsync or stylized fake-mouth motion
- product/demo/proof slot for UGC ads
- captions, price cards, CTAs, labels, and disclosures rendered in post
- batch variants and campaign/analytics feedback
- asset provenance, consent, prompt/model metadata, and vibe/format tags

### Top tools to study clean-room

| Priority | Tool(s) | Why they matter | Clean-room learning target |
|---|---|---|---|
| P0 | **Arcads AI** | Best direct AI UGC ad-factory reference: actors, product demos/holding, scripts, subtitles, remixing, API, batch variants. | Abstract UGC ad workflow, actor/persona taxonomy, product/demo slots, caption/remix steps. Do **not** copy actors, templates, examples, or private/paywalled flows. |
| P0 | **Bluma** | Closest conceptual match for de-editing, node-based canvas, scene/caption/element remixing. | Clean-room scene graph, timing grammar, overlay/caption slot extraction, node-canvas UX ideas. |
| P0 | **Higgsfield Marketing Studio / AI Influencer Studio** | Strong future-shape competitor: consistent characters/brands and model orchestration around product/social videos. | Character/brand consistency fields, product-ingest workflow, provider/model-router abstraction. |
| P1 | **Creatify / TopView.ai** | Product URL or image → ad variants; ecommerce/app performance workflow. | Product-brief extraction, claims/shot-list generation, URL-to-video template slots, batch variant UX. |
| P1 | **Captions / Mirage** | Best reference for shortform editor polish: captions, cuts, b-roll, music/SFX, digital twins, publishing loop. | Local caption/timeline/edit-layer UX; render text in post, not through video models. |
| P1 | **HeyGen / Tavus / D-ID / Akool** | Avatar/video API and digital-twin infrastructure references. | Provider job lifecycle, polling/webhooks, avatar/voice IDs, consent/rights fields, localization. |
| P2 | **Synthesia** | Likely revenue/enterprise benchmark, but less UGC-native. | Compliance, avatar licensing, localization, enterprise review/brand-safety workflow. |
| P2 | **viral.app** | UGC campaign tracking/creator ops rather than generation. | Creative IDs, campaign queues, metrics import, audience/project model. |
| P2 | **Fastlane / Affogato-RenderNet / Photo AI** | Persistent AI influencer, trend remix, scheduling, and identity-consistency references. | Persona persistence, scheduler loop, image identity references, trend-to-format abstraction. |

Research takeaway:

```txt
Synthesia = likely revenue/enterprise benchmark
HeyGen = strong self-serve/API/avatar benchmark
Arcads = most direct AI UGC ad workflow to study
Higgsfield = most dangerous future competitor / model-orchestration shape
Bluma = closest architectural inspiration for de-edit + node/layer remixing
```

### Clean-room clone blueprint

Product thesis:

```txt
Arcads-style AI UGC output + Bluma-style de-editing + Higgsfield-style model orchestration
+ Captions-style editor polish + ComfyUI-style graph control + local asset provenance.
```

Build an **AI UGC Graph Workbench** where each final video is compiled from reusable graph nodes and editable timeline layers:

```txt
product_brief
→ format_template
→ persona_profile / character_reference
→ hook_script_variants
→ TTS / voice
→ avatar_lipsync OR stylized_fake_mouth
→ product_demo / broll / props / backgrounds
→ captions_text_overlays_disclosures rendered in post
→ Remotion/ffmpeg render
→ QC: safe-area, no generated text, claims, license/consent, audio
→ analytics import / variant report
```

Clean-room boundaries:

- Study public behavior, public docs, own licensed exports, and user-owned references only.
- Store abstract format grammar: shot durations, scene roles, hook/body/CTA shape, caption safe areas, overlay timing, product slot placement, cut rhythm.
- For profile-level references, store abstract pose/timing/gesture/shot/caption-template mechanics and posting strategy. Prefer faceless profiles first because they are easier to abstract without likeness risk.
- Do **not** store or reuse source pixels, original captions, original audio, creator likenesses, brand marks, proprietary templates, or paywalled workflow details.
- Do not clone private identities, celebrities, real creators, or fake testimonials.
- Keep Arthur's hard rule: video/image models should not render readable text; captions and text overlays are post-render layers.
- Every asset/node should record provenance, prompt/model/run metadata, consent status, allowed uses, and vibe/format tags.

First MVP shape:

- Product URL/image/screen-recording → structured product brief and approved/forbidden claims.
- Three abstract format templates: talking-head product cutaway, app-demo explainer, surreal/brainrot overlay variant.
- One synthetic-original persona with persona bible, visual reference, voice, and allowed-use metadata.
- Hook/script generator producing variant scripts.
- TTS/avatar provider adapters as pluggable nodes; dry/mock nodes are acceptable until paid usage is explicitly approved.
- Caption renderer in Remotion/ffmpeg/libass with safe-area checks.
- SQLite/Postgres asset catalog linking prompts, model runs, outputs, costs, rights, vibes, and workflow usage.
- Variant grid/report with creative IDs and manual metrics import.

## Reference profile remix lane

This lane is secondary priority, but it should shape schemas and UI from the start.

Example target shape:

```txt
reference profile
→ archive index
→ video samples
→ pose/timing extraction
→ transcript/hook-template extraction
→ caption/text-template extraction
→ profile format bible
→ synthetic persona/product/voice swap
→ candidate batch
```

Data to capture per reference profile:

- profile handle/source URL and capture permissions
- selected sample videos and rationale
- shot rhythm, camera framing, pose/gesture cadence, and transition timing
- hook families, voice-line structure, CTA pattern, and non-CTA posting strategy
- caption/text layout, safe areas, typography mechanics, and overlay timing
- what must be swapped: identity, exact voice, exact text, brand marks, source pixels/audio, and product

Niche research later uses the same structure, but starts from a market/category query instead of a named reference profile.

## Recent Firefox/X history leads

Found by querying local Firefox `places.sqlite` for recent UGC / AI influencer / creator / CapCut-like terms.

### Tool/product pages

| Tool/site | URL | Notes |
|---|---|---|
| Bluma | `https://x.com/_alisawu/status/2032191984891543814` | de-edit videos into scenes/captions/elements; node-based canvas |
| Arcads AI | `https://x.com/arcads_ai`, `https://www.arcads.ai/` | AI UGC ads; often mentioned with Claude workflows |
| viral.app | `https://viral.app/` | UGC marketing OS; tracking/projects/audience checking |
| Higgsfield AI Influencer Studio | `https://higgsfield.ai/ai-influencer-studio` | AI influencers |
| Higgsfield Marketing Studio product ads | `https://higgsfield.ai/marketing-studio/product` | product → ad workflows |
| Higgsfield apps | `https://higgsfield.ai/apps` | model/tool hub |
| RentAHuman | `https://rentahuman.ai/login?...` | UGC creator/bounty workflow |
| Rork UGC academy docs | `https://docs.rork.com/rork-playbook/untitled-page-2` | creator/influencer growth playbook |
| Content Rewards / creator campaigns | `https://x.com/alexxgrowth/status/2056813144413258185` | agency/campaign format tracking |

### X posts/accounts worth archiving for UGC playbooks

| Account/post | URL | Why it matters |
|---|---|---|
| Alisa / Bluma launch | `https://x.com/_alisawu/status/2032191984891543814` | direct match for de-edit/node-canvas idea |
| Gaurav / Fastlane AI UGC army | `https://x.com/gauravsbuilding/status/2051446977850982746` | website → hyper-realistic AI influencer → thousands of videos cloned from viral content |
| Sumaiya / Fast Lane slideshow autopost | `https://x.com/4_emon2115/status/2051843718294983165` | AI influencer produced slideshow, auto-posted to TikTok/Instagram/YouTube |
| Ayo Mosuro / clone winning UGC ad | `https://x.com/ayomosuro/status/2051473492030492853` | “Clone any winning UGC ad in 4 minutes with claude code + seedance 2.0” |
| Ayo Mosuro / workflow friction | `https://x.com/ayomosuro/status/2056870515101327458` | toolchain fragmentation problem statement |
| Ernesto / Claude + Arcads | `https://x.com/ErnestoSOFTWARE/status/2056467666471461023` | Arcads positioned as UGC market disruption |
| Ernesto / AI influencers guide | `https://x.com/ErnestoSOFTWARE/status/204711138989062654` | AI influencer scaling thread; URL may need verification if typo from history/title |
| Noah Frydberg / Claude x Arcads guide | `https://x.com/maverickecom/status/2054584568661819527` | step-by-step AI UGC workflow |
| Noah Frydberg / authority figure UGC | `https://x.com/maverickecom/status/2056070933048172694` | AI authority figure ads |
| Alex Nguyen / Nano Banana → Veo → Arcads | `https://x.com/alexcooldev/status/2037554793833697323` | structured AI influencer workflow |
| Alex Nguyen / AI influencer content at scale | `https://x.com/alexcooldev/status/2056060717942677643` | massive AI influencer content guide |
| Alex Nguyen / AI influencer accounts | `https://x.com/alexcooldev/status/2040871993067839583` | grow account first, promote later |
| Joseph Choi / AI UGC playbook | `https://x.com/JosephKChoi/status/2054606103778898391` | app growth through UGC formats |
| Joseph Choi / UGC strategy video | `https://x.com/JosephKChoi/status/2026014121255182805` | founder tests formats before creators |
| Joseph Choi / clone hook across creators | `https://x.com/JosephKChoi/status/2016566310474277050` | format propagation pattern |
| Mike / viral.app projects | `https://x.com/mikey_starts/status/1939704543559635290` | UGC tracking tool |
| Mike / UGC is about content not followers | `https://x.com/mikey_starts/status/2042560567337201732` | content-first strategy |
| Roy / UGC farm thread | `https://x.com/im_roy_lee/status/1928629670343221536` | viral UGC farm operations |
| Jason UGC / clay videos | `https://x.com/jasonugc/status/2042324678023242033` | emerging format category |
| Jah Jiren / AI clone | `https://x.com/Jahjiren/status/2055696686144438657` | AI clone/app marketing workflow |
| Pounds / realistic AI influencer affiliate method | `https://x.com/pounddz/status/2017380582238666903` | organic affiliate AI influencer method |

## First 10 format-mining targets v1

Focus on reusable mechanics, not private identity cloning or verbatim copies. For each item, capture only the public/product information needed to describe the format, then rewrite the mechanics as abstract slots: hook type, persona role, shot rhythm, product/demo slot, caption style, CTA, and reusable layers.

No X scraping is approved in the current step. Product-site/doc teardowns can be done from public pages when coordinator approves. X leads should wait for explicit public-capture approval and should inspect only the target post/thread/media in the main content column.

| Rank | Target | Why first | Clean-room extraction | Initial format ID |
|---|---|---|---|---|
| 1 | **Bluma** launch / YC / public product artifacts — `https://x.com/_alisawu/status/2032191984891543814` | Closest to de-edit + node/layer remix architecture. | Scene graph, caption/element slots, variant graph, editor affordances. Do not copy UI/trade dress/source videos. | `fmt-deedit-node-canvas-v0` |
| 2 | **Arcads AI** public workflow/docs — `https://www.arcads.ai/` | Best direct AI UGC ad factory. | Actor/persona slot, product/demo slot, script/emotion/language/caption/remix/batch steps. | `fmt-actor-product-ugc-v0` |
| 3 | **Higgsfield Marketing Studio / AI Influencer Studio** — `https://higgsfield.ai/marketing-studio/product`, `https://higgsfield.ai/ai-influencer-studio` | Consistent character + product/brand video + model orchestration. | Product-ingest fields, persona/identity consistency controls, model/provider-chain slots. | `fmt-consistent-influencer-marketing-v0` |
| 4 | **Creatify / TopView-style product URL → ad** public workflows | Ecommerce/app product-to-ad variants. | Product brief extraction, claims, shot list, avatar/b-roll/caption batch-variant slots. | `fmt-url-to-ad-variants-v0` |
| 5 | **Captions / Mirage-style AI editor** public workflow | Strong reference for caption/editor polish after generation. | Edit decision list, b-roll/music/SFX layers, caption timing/styles, publish loop. | `fmt-ai-editor-caption-polish-v0` |
| 6 | **HeyGen / Tavus / D-ID-style avatar API** public docs/workflows | Provider adapter and digital-twin/lipsync infrastructure. | Render job lifecycle, polling/webhooks, avatar/voice IDs, translation, consent fields. | `fmt-avatar-api-provider-node-v0` |
| 7 | Ayo Mosuro “clone winning UGC ad” — `https://x.com/ayomosuro/status/2051473492030492853` | High-signal public lead for abstracting winning-ad skeletons. | What is swapped vs preserved: timing, hook, captions, persona, b-roll, provider nodes. | `fmt-winning-ad-skeleton-v0` |
| 8 | Gaurav / Fastlane AI UGC army — `https://x.com/gauravsbuilding/status/2051446977850982746` | Website/product → AI influencer → many videos loop. | Product-ingest inputs, persona consistency, batch generation, scheduling/autopost loop. | `fmt-website-to-influencer-army-v0` |
| 9 | Noah Frydberg / Arcads + Alex Nguyen provider-chain leads — `https://x.com/maverickecom/status/2054584568661819527`, `https://x.com/alexcooldev/status/2037554793833697323` | LLM prompt → provider-chain workflow references. | Script prompt sections, provider handoff boundaries, character refs, what gets cached/regenerated. | `fmt-llm-to-provider-chain-v0` |
| 10 | Joseph Choi / Roy / Mike ops leads — `https://x.com/JosephKChoi/status/2016566310474277050`, `https://x.com/im_roy_lee/status/1928629670343221536`, `https://x.com/mikey_starts/status/1939704543559635290` | Hook propagation, UGC farm operations, and campaign tracking. | Hook family, creator/persona swap, campaign queue, review cadence, metrics/creative IDs. | `fmt-ugc-ops-loop-v0` |

Suggested first pass artifacts under `data/ai-ugc-format-mining/`:

```txt
format-decomposition-queue-v1.md     # queue state and per-source notes
sources/<source-id>.md               # one normalized teardown per source/post/tool
formats/<format-id>.json             # abstract reusable format template
```

## Format decomposition template

For each source video/post, extract:

```json
{
  "formatId": "ugc-<slug>",
  "source": {
    "platform": "x",
    "url": "https://x.com/...",
    "author": "...",
    "capturedAt": "..."
  },
  "structure": {
    "hook": {
      "text": "...",
      "durationSec": 1.5,
      "style": "shock|curiosity|pain|authority|demo"
    },
    "scenes": [
      {
        "id": "scene_1",
        "durationSec": 2.0,
        "camera": "selfie|podcast|screen-record|street|broll",
        "character": "spokesperson|doctor|founder|customer|mascot",
        "background": "bedroom|car|podcast|office|surreal",
        "props": ["phone", "product", "chart"],
        "captionStyle": "..."
      }
    ],
    "cta": {
      "text": "..."
    }
  },
  "assetsNeeded": {
    "character": "ai_influencer_or_mascot",
    "product": "product_image_or_url",
    "voice": "tts_voice",
    "captions": "local_ass_style"
  },
  "editableLayers": ["character", "hook_text", "product_visual", "captions", "background", "broll", "music_sfx", "filters"]
}
```

## CapCut lane idea

CapCut is useful as a reference for:

- captions and karaoke text effects
- auto-cut/jump-cut rhythm
- filters/LUTs
- stickers/effects/transitions
- templates
- beauty/background/motion features

But it should be a separate reveng task later.

Initial safe approach:

1. Inventory installed CapCut app/files if present.
2. Inspect exported project/template files if user creates small throwaway examples.
3. Recreate the useful effects locally with ffmpeg/Remotion/Canvas instead of depending on CapCut Pro.
4. Only reverse frontend/network APIs if needed and allowed; do not bypass paid features.

## Owner paths

This lane may edit:

- `docs/plans/ai-ugc-format-mining.md`
- future source only after coordinator approval, likely `packages/twitter-archive/**` for capture and `packages/video-pipeline/**` for format schemas

Runtime artifacts:

- `data/ai-ugc-format-mining/**`
- `data/twitter-archive/ugc-sources/**`
- `data/coordination/ai-ugc-format-mining.status.md`
