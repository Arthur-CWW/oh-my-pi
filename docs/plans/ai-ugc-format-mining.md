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

## Format decomposition template

For each source video/post, extract:

```yaml
formatId: ugc-<slug>
source:
  platform: x
  url: https://x.com/...
  author: ...
  capturedAt: ...
structure:
  hook:
    text: ...
    durationSec: 1.5
    style: shock|curiosity|pain|authority|demo
  scenes:
    - id: scene_1
      durationSec: 2.0
      camera: selfie|podcast|screen-record|street|broll
      character: spokesperson|doctor|founder|customer|mascot
      background: bedroom|car|podcast|office|surreal
      props: [phone, product, chart]
      captionStyle: ...
  cta:
    text: ...
assetsNeeded:
  character: ai_influencer_or_mascot
  product: product_image_or_url
  voice: tts_voice
  captions: local_ass_style
editableLayers:
  - character
  - hook_text
  - product_visual
  - captions
  - background
  - broll
  - music_sfx
  - filters
```

## CapCut lane idea

CapCut is useful as a reference for:

- captions and karaoke text effects
- auto-cut/jump-cut rhythm
- filters/LUTs
- stickers/effects/transitions
- templates
- beauty/background/motion features

But it should be a separate reverse-engineering task later.

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
