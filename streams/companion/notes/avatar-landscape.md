# Avatar landscape — VRM + Live2D bodies for the companion (2026-07-03)

Groundwork for the hot-swappable-body layer ([GOAL.md](../GOAL.md)): 3D (VRM) and 2D (Live2D) are skins over one presence contract ([presence-recon.md](./presence-recon.md)). Clean-room discipline: libraries and licenses below are all official/first-party sources; prototype models downloaded into `data/avatar-models/<slug>/` (gitignored, local-only), each with its own `LICENSE-NOTES.md`.

## 1. VRM (3D) library landscape

### The standard web stack: `@pixiv/three-vrm`

- **Repo**: <https://github.com/pixiv/three-vrm> · **License**: MIT · **npm**: [`@pixiv/three-vrm`](https://www.npmjs.com/package/@pixiv/three-vrm)
- **Current version**: **v3.5.4**, published **2026-06-15** (npm registry publish timestamp `1781505555786`; [registry record](https://registry.npmjs.org/@pixiv/three-vrm/latest)). Actively maintained (v3.4.x–v3.5.x cadence through 2025-2026, [releases](https://github.com/pixiv/three-vrm/releases)).
- **three.js compat**: peer dependency `three >= 0.137`, developed/tested against `three ^0.180` ([registry record](https://registry.npmjs.org/@pixiv/three-vrm/latest)). The WebGPU path — `MToonNodeMaterial` on three's NodeMaterial system — **requires three r167+** and is flagged as break-prone while NodeMaterial stabilizes ([README](https://github.com/pixiv/three-vrm)).
- **Major-version context**: v3.0.0 ("WebGPU Support!") landed **2024-08-01**, introducing `MToonNodeMaterial` for `WebGPURenderer` ([v3.0.0 release](https://github.com/pixiv/three-vrm/releases/tag/v3.0.0)). The same monorepo ships [`@pixiv/three-vrm-animation`](https://www.jsdelivr.com/package/npm/@pixiv/three-vrm-animation) for `.vrma` VRM Animations.

### "New" VRM runtime candidates (2025-2026, non-three.js)

Searched for standalone/WebGPU VRM runtimes Arthur may have meant. In the web/TS ecosystem I found **no credible standalone successor to three-vrm**; the genuinely new "WebGPU VRM" thing inside the standard stack is three-vrm v3's `MToonNodeMaterial`. Outside TS, two active Rust/wgpu runtimes (WebGPU-native, wasm-deployable via Bevy) are the best matches:

| Library | What it is | License | Last release | Evidence |
|---|---|---|---|---|
| [`bevy_vrm1`](https://github.com/not-elm/bevy_vrm1) (not-elm) | VRM 1.0 + VRMA runtime for Bevy 0.18: spring bones, look-at, node constraints, MToon in WGSL. VRM 1.0-only; README warns "early stage of development" | MIT + Apache-2.0 dual | **v0.7.1, 2026-04-20** ([release](https://github.com/not-elm/bevy_vrm1/releases/tag/v0.7.1)) | active PRs on MToon lighting in 2026 |
| [`bevy_vrm`](https://github.com/unavi-xyz/bevy_vrm) (unavi-xyz) | Bevy plugin loading VRM 0.x **and** 1.0; MToon WGSL shader crate, spring bones; ships a hosted [wasm VRM viewer](https://unavi-xyz.github.io/bevy_vrm/) | MIT + Apache-2.0 dual | **v0.3.0, 2026-04-07** (Bevy 0.18) ([release](https://github.com/unavi-xyz/bevy_vrm/releases/tag/v0.3.0)) | part of the UNAVI open-metaverse stack |

If Arthur meant a specific TS library, the closest 2025-2026 web-adjacent motion was three.js WebGPURenderer going mainstream (r167+ → [three.js manual](https://threejs.org/manual/en/webgpurenderer.html)) — i.e. the "new renderer" is three's, not a new VRM lib.

## 2. Live2D (2D) library landscape

### Ground truth about the official SDK

The official [Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) is two layers: **CubismWebFramework** (TypeScript, source on [GitHub](https://github.com/Live2D/CubismWebFramework), Live2D Open Software License — physics, motions, expressions, model3.json plumbing) sitting on **Cubism Core** (`live2dcubismcore.js`) — the `.moc3` loader/evaluator, distributed **only as a proprietary minified binary blob** under the [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html). Third-party wrappers confirm this ("You need to install Live2D Cubism Core, a proprietary library for loading moc3 files" — [Moebytes/live2d-renderer](https://github.com/Moebytes/live2d-renderer)).

### The open-source clean-room reimplementation: **Purism Core** — identified with confidence

- **Name/author**: Purism Core, by the Sakura Motion Project (lead: [Ronsor](https://github.com/Ronsor)).
- **Repo**: <https://github.com/SakuraMotion/PurismCore> · **License**: **MIT** · first public release **v1.0.1, 2026-06-06** ([release](https://github.com/SakuraMotion/PurismCore/releases/tag/v1.0.1)).
- **Completeness** (per [README](https://github.com/SakuraMotion/PurismCore)): drop-in replacement for Live2D Cubism Core with "complete API and ABI compatibility" (both Core 5 ABI — VTube Studio et al. — and Core 6 ABI); loads `.moc3` up to Cubism 5.3 exports. Source tree has a from-scratch moc3 parser, deformers, art meshes, blend shapes, parameters, offscreen targets (`src/moc3.c`, `src/deformer.c`, `src/blendshape.c`, `src/offscreen.c`, …). Claims >10,000 conformance test cases plus ASAN/UBSAN fuzzing. Scope note: **physics/motion playback are not Core features** in Live2D's architecture — those live in the (source-available) Framework layer; Purism replaces exactly the proprietary blob.
- **Legally clean?** Their claim: a reimplementation "without any Live2D code", so "you can use, modify, and distribute this library without needing a special license from Live2D Inc."; Live2D/Cubism referenced nominatively as trademarks. This is a reimplementation, not a leaked SDK — consistent with the clean-room framing — but it is *their* claim, untested in court; README acknowledges "We currently do not think" Live2D will pursue users. For local prototyping the risk is negligible; for shipping, revisit.
- **Web fit caveat**: plain C99 targeting the native Core ABI; the platform table marks Emscripten/wasm as untested (`?`). Using it in the browser means compiling to wasm ourselves to stand in for `live2dcubismcore.js`. [INFERENCE] wrappers like pixi-live2d-display, which just take a `cubismCorePath`, should then run fully open — unverified, worth a spike.

### Hoshino Lina's **Ayagami** — track, but not vendorable yet

- **Identity**: Ayagami is the Rust clean-room Live2D renderer Lina is posting about publicly (posts on 2026-06-29 and 2026-07-06 mention open-source Live2D rendering, parameters, wasm/webgl/webgpu, Godot/C FFI plans).
- **Public source status, 2026-07-06**: no public repo found under `hoshinolina/` or `TokyoHackerGirls/`; `https://github.com/hoshinolina/ayagami` returns 404. The crates.io package [`ayagami`](https://crates.io/crates/ayagami) exists only as `0.0.0-reserved` (published 2026-06-14, 705 B, no README/source beyond placeholder).
- **Use decision**: do **not** vendor a placeholder or unrelated repo. For this stream, treat Ayagami as the preferred future Live2D body backend once real source lands. Watch `hoshinolina/ayagami`, `TokyoHackerGirls/ayagami`, and the crates.io crate for a non-reserved release.
- **Stopgap if body work must start before release**: use Hiyori + `pixi-live2d-display` for browser proof, or spike Purism Core wasm if the open-core requirement matters more than speed.

### Orientation one-liners

- [`pixi-live2d-display`](https://github.com/guansss/pixi-live2d-display) — MIT PixiJS plugin unifying Cubism 2.1/3/4 model handling behind one high-level API (motions, expressions, hit-testing, lip-sync-able mouth params); still requires the official proprietary Core blobs; upstream is slow-moving — last release [v0.5.0-beta, 2023-12-07](https://github.com/guansss/pixi-live2d-display/releases/tag/v0.5.0-beta) (Pixi v7), npm stable 0.4.0, ~13K weekly downloads.
- [`Inochi2D`](https://github.com/Inochi2D/inochi2d) — BSD-2-Clause D-language realtime-2D-puppet SDK with its **own format** (`.inp`/`.inx`, wasm builds available): not Live2D/moc3-compatible at all; a parallel ecosystem, relevant only if we ever author puppets natively instead of consuming Live2D assets.

## 3. Free cute anime-girl prototype models

| Model | Format | License (name → text) | Permits | Source |
|---|---|---|---|---|
| **Alicia Solid** (Niconi Solid-chan) | VRM 0.x | [Niconi Solid-chan License](https://3d.nicovideo.jp/alicia/rule.html) (Dwango) | Derivatives + their distribution/sale, **commercial OK for individuals/non-corporate groups** (corporations excluded), modification OK, no credit required ([work page](https://3d.nicovideo.jp/works/td32797)); embedded VRM meta: commercial Allow, violent/sexual Disallow | [3d.nicovideo.jp/works/td32797](https://3d.nicovideo.jp/works/td32797) (login-gated DL); official mirror in [vrm-c/UniVRM](https://github.com/vrm-c/UniVRM/tree/master/Tests/Models/Alicia_vrm-0.51) |
| **Seed-san** (VirtualCast) | VRM 1.0 | [VRM Public License 1.0](https://vrm.dev/en/licenses/1.0/) | Per embedded license settings: avatar use by everyone, **commercial incl. corporations**, modification + redistribution allowed, **credit required** | [vrm-c/vrm-specification samples](https://github.com/vrm-c/vrm-specification/tree/master/samples/Seed-san) |
| **Hatsune Miku** | VRM (fan/converted only) + official Live2D sample | [piapro Character License (PCL)](https://piapro.jp/license/pcl/summary) (Crypton) | Honest constraints: fan derivative creation + publication OK; **no ads/promotion use, commercial/paid-doujin use needs piapro application**; attribution text required ("この作品はピアプロ・キャラクター・ライセンスに基づいて…"). **No official downloadable VRM found**: Crypton's VRoid Hub model is view-only, "ダウンロード、再配布はできません" ([model page](https://hub.vroid.com/characters/3381543574629827407/models/4549641854869196320)). Live2D's official Miku sample is an "externally licensed character" governed by PCL and explicitly **excluded** from Live2D's General-User commercial allowance ([sample terms](https://www.live2d.com/en/learn/sample/model-terms/)) | [Live2D Miku sample](https://www.live2d.com/en/learn/sample/hatsune-miku/) |
| **Kizuna AI — "KAMATTE AI"** | VRM 0.x (official) | Kizuna AI Inc. [terms](https://kizunaai.com/terms/) + [creative guidelines](https://kizunaai.com/guideline/) | Official free release (2026-03-02) of the VRM + UnityPackage "to support creative activities", usage bound to their terms/derivative guidelines ([model page](https://kizunaai.com/download/kamatteaimodel/)) | [kizunaai.com/download/kamatteaimodel](https://kizunaai.com/download/kamatteaimodel/) |
| **VRoid sample models** (AvatarSample_A-C / VRoidPreset_A-Z) | VRM 0.x/1.0 | [pixiv sample-model conditions](https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z) | "Can be used by anyone in any kind of activity, be it for-profit or not", no credit needed, texture/parameter edits + re-upload allowed; prohibited: paid/as-is redistribution, CC0 relabeling, feeding character-creation services | [AvatarSample_A on VRoid Hub](https://hub.vroid.com/en/characters/2843975675147313744/models/5644550979324015604) (pixiv login to DL; also bundled with VRoid Studio) |
| **Hiyori Momose** (Live2D Inc.) | Live2D (.moc3 + runtime) | [Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) + [Sample Data ToU](https://www.live2d.com/en/learn/sample/model-terms/) | SDK-integration testing & learning; General Users / Small-Scale Enterprises (< ¥10M sales) may publish works commercially or non-commercially; **no character-design changes**, copyright notice on publication, **no redistribution** of the material | [sample page](https://www.live2d.com/en/learn/sample/momose-hiyori/) → [direct zip](https://cubism.live2d.com/sample-data/bin/hiyori/hiyori_en.zip) |
| **Mao / Kei / Epsilon / Haru …** (Live2D Inc.) | Live2D | same FMLA framework, all "[Live2D Original Characters](https://www.live2d.com/en/learn/sample/model-terms/)" | same as Hiyori (per-character quirk rules); note Natori/Tsumiki are *Collaboration Characters* → **non-commercial only** for general users | [sample collection](https://www.live2d.com/en/learn/sample/) |

## 4. Downloaded prototypes (local-only, `data/` is gitignored)

| Slug | Contents | Size |
|---|---|---|
| `data/avatar-models/alicia-solid-vrm/` | `AliciaSolid_vrm-0.51.vrm` + `LICENSE-NOTES.md` | 7,878,712 B (7.5 MiB) |
| `data/avatar-models/seed-san-vrm/` | `Seed-san.vrm` (VRM 1.0) + `LICENSE-NOTES.md` | 10,917,800 B (10.4 MiB) |
| `data/avatar-models/hiyori-momose-live2d/` | `hiyori_en.zip` + extracted `hiyori_free/` & `hiyori_pro/` (runtime: `.moc3` 236 KB free / 444 KB pro, model3/physics3/cdi3 json, textures, 8+10 motions) + `LICENSE-NOTES.md` | zip 46,195,926 B (44.1 MiB) |
| `data/avatar-models/kizuna-ai-kamatte-vrm1/` | Official archive, extracted `Kizuna_AI_KAMATTE_v2.vrm`, publisher README + `LICENSE-NOTES.md` | zip 44,949,291 B; VRM 19,341,528 B |
| `data/avatar-models/zzz-ellen-official-pmx/` | Official Ellen MMD archive, extracted PMX/textures/bundled rules + `LICENSE-NOTES.md` | zip 10,166,264 B; character PMX 3,677,010 B |

The first three were fetched from official sources on 2026-07-03; KAMATTE AI and Ellen were fetched from official sources on 2026-07-14. URLs, hashes and terms are recorded in each `LICENSE-NOTES.md`. VRM capability claims were verified against the embedded GLB/VRM extensions of the actual files, not just their web pages.

## 5. Recommendation

**First body prototype: Alicia Solid VRM rendered with `@pixiv/three-vrm` v3 (three.js r167+, WebGL now, WebGPU when we want it); Hiyori (free runtime) via `pixi-live2d-display` + official Cubism Core blob as the 2D skin.**

Rationale, one line each:

- *Alicia Solid*: the most permissive cute-anime-girl VRM that exists (individual commercial + modification, no credit), and it is literally the ecosystem's test asset — UniVRM and bevy_vrm1 ship it in-repo, so every runtime handles it.
- *Seed-san* (also downloaded): our VRM 1.0 coverage — exercises the newer meta/springbone/constraint path so the presence layer isn't accidentally VRM-0-shaped.
- *`@pixiv/three-vrm`*: MIT, actively released (v3.5.4, 2026-06), the only battle-tested web runtime; keeps the body a plain three.js scene node the WebAudio presence layer can position in the same space.
- *Hiyori + `pixi-live2d-display`*: fastest legal 2D path (sample data exists precisely for SDK-integration testing); mouth-open scalar from our `audio.energyFrame` contract is enough to drive it.
- *Purism Core / Ayagami*: track both as escape hatches from the proprietary Core blob. Purism Core is usable C99 now; Ayagami is the preferred Rust/WebGPU backend if Lina publishes real source. Don't block the first prototype on either.

## 6. Gacha & high-quality rigs

### Official gacha model releases

Official gacha publishers do release production-quality MMD assets, but these are **PMX authoring inputs, not browser-ready VRM**, and permission is normally narrower than an open-source license. Keep every archive and conversion under `data/avatar-models/`, preserve its bundled README, and never ship the source or converted model.

| Publisher / game | Official source | Format and access | Local-prototype terms |
|---|---|---|---|
| HoYoverse — **Genshin Impact** | [verified official Genshin account on APlayBox](https://www.aplaybox.com/u/680828836) (the older [HoYoLAB download guide](https://www.hoyolab.com/article/627614) points users to the official releases) | Character-by-character ZIPs, normally PMX + textures/toon files; APlayBox account/login may be required | Treat each archive README as controlling. The official-model rules prohibit redistribution, commercial use, R-18 and abusive/offensive uses; edits for fan animation are allowed only within the bundled rules. A general fan-merch permission is **not** a model-data redistribution license. |
| HoYoverse — **Honkai: Star Rail** | [verified official Star Rail APlayBox account](https://www.aplaybox.com/u/516827875) and [official Fan Creations Guide v1.0](https://hsr.hoyoverse.com/en-us/news/111203) | Character PMX ZIPs; APlayBox account/login may be required | The fan guide allows re-creation of publicly released content, but the downloaded model's README still controls model-data use. Preserve attribution/rules, keep use non-commercial, and do not redistribute source or converted data. |
| HoYoverse — **Zenless Zone Zero** | [official Bilibili campaign's model carousel](https://www.bilibili.com/blackboard/activity-vl9IMaaeyZ.html) | 18 direct, non-gated PMX ZIPs. We acquired its official Ellen archive into `data/avatar-models/zzz-ellen-official-pmx/`. | Ellen's bundled `readme【一定要看】.txt` expressly permits physics/weight/expression fixes, recolor, moderate clothing edits and spa/toon additions; it prohibits secondary distribution, parts extraction, commercial use, R-18, extremist religious propaganda, gore/horror and personal attacks. |
| Infold Games — **Love and Deepspace** | [official MMD gallery](https://loveanddeepspace.infoldgames.com/en-EN/m/gallery?type=mmd) and [official download announcement](https://x.com/Love_Deepspace/status/1816686550434087083) | Publisher-hosted character/chibi MMD downloads, typically PMX + textures | Infold says copyright remains with it and directs users to the rules inside each model file. Download and preserve that file before use; do not assume commercial or redistribution permission. |

This is a survey, not a blanket sublicense. Genshin/Star Rail releases that require APlayBox login have an exact manual path: sign in at the linked verified publisher profile, open the desired character model, accept the page terms, download the ZIP, place it in `data/avatar-models/<game>-<character>-official-pmx/`, and immediately add `LICENSE-NOTES.md` quoting the bundled README. Do not use mirrors when the first-party archive is available.

### PMX → VRM 1.0 conversion recipe (Ubuntu GPU box is fine)

This is the reproducible conversion path for the official archives; tonight's catalog does **not** depend on completing it.

1. Install [Blender 4.x](https://www.blender.org/download/), [mmd_tools](https://github.com/MMD-Blender/blender_mmd_tools) and the [VRM Add-on for Blender](https://vrm-addon-for-blender.info/en/). In Blender use **Edit → Preferences → Add-ons → Install from Disk**, install both ZIPs, enable both, then restart Blender.
2. Extract without losing non-ASCII names, then open Blender from that working directory so relative textures resolve:
   ```sh
   python3 -m zipfile -e zzz-ellen-official-mmd.zip source
   cd source
   blender
   ```
3. **File → Import → MikuMikuDance model (.pmd, .pmx)**. Import the character PMX (not the separate weapon) with scale `0.08` initially; verify upright metre scale and apply transforms only after the mesh, armature and textures are all present. Repair missing texture paths before changing materials.
4. Keep the original armature where possible. In the VRM panel create VRM 1.0 metadata and map required humanoid bones: hips, spine, chest, upperChest if present, neck, head, upper/lower arms, hands, upper/lower legs, feet; map eyes, shoulders, toes and finger chains when present. Resolve roll/axis and T-pose warnings before export.
5. Replace MMD shader nodes material-by-material with **MToon 1.0** materials. Map diffuse/base texture → Lit Color, shadow texture or a darkened base → Shade Color, toon ramp → shading shift/toony, edge color/size → outline color/width, sphere-map highlights → matcap or rim lighting where visually equivalent, and alpha textures → the matching opaque/cutout/transparent render mode. Do not copy MMD-only node graphs into the export and do not globally force one material preset.
6. Convert PMX morphs to VRM expressions. At minimum wire `happy`, `angry`, `sad`, `relaxed`, `surprised`, `blink`, `blinkLeft`, `blinkRight`, and visemes `aa`, `ih`, `ou`, `ee`, `oh`. Add custom expressions only for useful extra morphs. Set blink/look/mouth override flags so expressions do not double-drive those channels.
7. Rebuild secondary motion rather than mechanically translating rigid bodies. Group chains by intent (back hair, side hair, skirt, accessories); add VRM spring colliders to head/chest/hips as appropriate; map each PMX joint chain to one VRM Spring Bone chain; tune stiffness, gravity, drag and hit radius in a motion preview. PMX rigid-body constraints do not have a lossless VRM equivalent.
8. In the VRM validation panel clear all errors, export as **VRM 1.0**, then load the result in the [official VRM viewer](https://vrm-viewer.vrm.dev/) and locally in `/lab`. Verify neutral pose, every expression, eye look-at, lip sync, transparent materials, outlines and every spring group before adding a catalog entry.

### Native VRM pick: Kizuna AI “KAMATTE AI”

**Recommended local face+body upgrade: the official KAMATTE AI VRM 1.0**, acquired from [Kizuna AI Inc.'s first-party model page](https://kizunaai.com/download/kamatteaimodel/) into `data/avatar-models/kizuna-ai-kamatte-vrm1/`. It is now selectable in Motion Lab as `Kizuna AI — KAMATTE AI`.

Why this one: it is a polished first-party anime rig with all 9 materials using MToon 1.0, 4K textures, a full 54-bone humanoid map, eye look-at, 18 discoverable VRM expressions/visemes, and 36 Spring Bone groups across hair, skirt and accessories. The terms are clear enough for this **private, individual, non-commercial local prototype**, unlike a random Booth/VRoid Hub listing with mutable per-model settings. They are not permissive for shipping: [Kizuna AI's derivative-work guidelines](https://kizunaai.com/guideline/) forbid redistribution (including software embedding the model), commercial/corporate use without prior contact, and public-copyable avatars. See the local `LICENSE-NOTES.md`.

The quality trade-off is explicit: KAMATTE is expressive by VRM-standard channels but **not Perfect Sync**. A clean isolated `/lab` headless probe resolved `neutral-capability`, enumerated `aa, angry, blink, blinkleft, blinkright, ee, happy, ih, lookdown, lookleft, lookright, lookup, neutral, oh, ou, relaxed, sad, surprised`, found eye look-at and 24 runtime body bones, and found 36 spring groups in the VRM extension. It degrades to `degraded-vrm` / ARKit coverage `none`: all ARKit-52 channels are absent, including independent brow, cheek, nose, tongue and detailed lip/jaw shapes; speech uses `aa`; emotion uses the named VRM presets. That degradation is acceptable for the immediate embodiment upgrade and is precisely why the separate Perfect-Sync/ARKit donor remains necessary for face-mirror work.

The other native leads remain useful but do not beat this package tonight: VRoid presets have excellent broad reuse terms but generic sample styling and login-gated downloads; Seed-san is an excellent permissive VRM 1.0 conformance asset but not the strongest polished anime companion look; KAMATTE combines the best visual finish, MToon, expression breadth and spring setup in one non-gated official download.

### Casting result: Ellen first, Hu Tao/March 7th taste fork

The full evidence and 281-post Sico catalogue study are in [character-casting.md](./character-casting.md). The register is narrower than “polished anime girl”: flat/skinny and often boyish, sharp eye treatment, a strong hair/hat/horn silhouette, and Asuka/Yuno-style bratty-to-manic voltage. Sico’s repeated characters include Hu Tao (12 tagged posts and stated favorite), Yuno Gasai (11 `#yunogasai` plus 8 `#yuno`), Megumin, Misa, Frieren, Asuka, Taiga, Power, Rukia, A2, Jinx, Maka, and Astolfo; captions explicitly describe a “long stick,” “flat … pasta noodle build,” and earlier “femboy days.”

Ranked against that register, the official-model shortlist is: **(1) Ellen Joe**, the strongest lean/sharp/tomboy silhouette and bored-hostile energy; **(2) Hu Tao**, the strongest direct cosplay overlap and yandere-adjacent mischief but more ornate/feminine; **(3) March 7th**, direct cosplay overlap and a slim official rig but much softer/pastel energy. Arthur gets the taste fork, while Ellen proceeds rather than blocking motion work.

Ellen’s first-party ZZZ archive is already local at `data/avatar-models/zzz-ellen-official-pmx/`. The packet now also contains pinned MMD Tools v4.5.13 and VRM Add-on 4.4.0 archives plus `UBUNTU-DISPATCH.md`, an exact interactive Blender 4.2+ conversion handoff. Local Blender 5.0.1 exists, but a background factory-startup probe found neither required add-on enabled, so no VRM conversion or catalog entry is claimed. Expected post-conversion artifact: `output/ellen-joe.vrm`; it must pass the official viewer and `/lab` neutral/expression/spring probe before cataloging.
