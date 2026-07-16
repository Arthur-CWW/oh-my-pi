# Eidoverse recon: mesh pipeline first, world stack second

Date: 2026-07-14

## Bottom line

**Rebuild the mesh pipeline now; do not fork Eidoverse yet.** Skye's public `eidoverse` “early repo” is only a one-file staging marker with **no framework source and no license**. The implemented source is `eidoverse-video`, but it is **AGPL-3.0**, architected around Deno + WebGPU/TSL + offline video rendering rather than our browser companion's Three.js + `@pixiv/three-vrm` + MToon, zero-allocation 60 Hz L0. It is excellent evidence and a clean-room design reference, not a drop-in dependency.

Skye's mesh recipe is the more immediate prize: **turnaround images → generated high-poly → agent-authored low-poly in headless Blender → UV/projection → caged bake → visual/ID-map critique loop**. The differentiator is not a novel mesh generator; it is assigning the hard unsolved step—purposeful game topology—to a capable coding model, then teaching it with art-director feedback and close probes. We can reproduce that shape with our existing Blender CLI/GPU lane without taking Eidoverse code.

## Source method and archive status

- Profile identity is explicit: X `@SkyeSharkie` links to GitHub [`SkyeShark`](https://github.com/SkyeShark).
- I attempted the required local archive sync through `packages/twitter-archive` against both configured public mirrors. `nitter.poast.org` returned HTTP 503; `nitter.tiekoetter.com` returned public pages but the package parser rejected Nitter's `Jul 14, 2026 · … UTC` timestamps.
- I then captured the same public timeline/search/thread pages through the mirror and imported **15 normalized, verbatim pipeline records** into `packages/twitter-archive/data/twitter-public-sources.sqlite` using the package's `public-source:import` path. The normalized import payload is retained at `local/eidoverse-skye-mesh-tweets.json`.
- Tweet permalinks below use `x.com`; capture evidence came from the corresponding public Nitter pages. Images/videos remain linked to Twitter CDN. No private content was accessed.

## The recent mesh pipeline, reconstructed

### What the pipeline actually is

1. **Create turnaround/concept inputs.** Sol uses `gptimage2` for multiview/turnaround images. Skye says Fable's equivalent can use local `z-image-turbo` or another local image model. Inputs are required; this is not yet text-to-finished-mesh autonomy.
2. **Generate a reference high-poly.** On Jul 10–11 the stated model was local **Hunyuan3D-2MV / Hunyuan-2 multiview**, followed by **octree remesh**. On Jul 14 Skye summarized the current stage as **Trellis**. Treat these as evolving interchangeable high-poly backends, not one locked implementation.
3. **Do not accept generator topology.** Meshy, Tripo, Hunyuan, and similar output are treated as high-poly/reference/blockout sources. Skye's central claim is that their generated low-poly hard-surface topology remains unsuitable.
4. **Have the coding model build the low-poly directly in headless Blender.** Fable/Sol inspect visual probes and create purposeful hard-surface pieces. Skye specifically recommends proper **bevel/boolean modeling rather than primitive accumulation**. The Jul 14 radio demo ends on a visible triangulated wireframe, so this is more than a beauty-render claim.
5. **Art-direct the geometry with bounded probes.** The human feedback loop calls out silhouette/footprint errors and encourages more geometry when the model becomes over-conservative. In the shown radio critique, budget is “up to 1600 tris”; corner brackets should be separate pieces whose footprints hug the high-poly rather than overhang it. Smooth edges only minimally.
6. **Use the sensor suite selectively.** The experimental surface sensor exposes ray casts, normal comparisons, sparse point-cloud surface positions, vertex welding/hole checks, etc. Skye's latest result is negative for raw geometry: resolution and back-and-forth make models use fewer/thicker forms. It is useful for **modular-kit assembly**, not current low-poly authorship. We should keep numeric geometry checks as validation, not the model's primary perceptual loop.
7. **UV and texture projection.** The Jul 11 attachment visibly shows a densely packed hard-surface UV atlas with large panel islands, bevel strips, radial islands, and narrow gutters. Skye says Fable authored the low-poly and projection; Sol authored turnarounds. The unresolved failures were high/low alignment and misaligned projection, not absence of UVs.
8. **Bake with an explicit cage.** The critique says the bake uses an “Alt+S-style cage”—a low-poly copy expanded along vertex normals. Geometry must be close enough to the corresponding high-poly region that rays do not land on neighbors. Slightly inset bracket footprints are preferred to overhang.
9. **Debug bake correspondence semantically.** Assign ID/debug colors to distinct high-poly surface types. A wrong hit then becomes obvious (example: black bracket texels accidentally sampling green case). Iterate with close renders, not only numbers.
10. **Materials/output.** The Jul 14 radio turntable shows distinct painted olive housing, metal corner guards, dark plastic/rubber controls, woven/perforated speaker, and orange display. Some uneven rim/handle shading and faceting remain; exact PBR map generation is not disclosed. Earlier Skye evidence says GPT Image 2 can reskin UV textures/secondary maps, but the current thread does not prove a final material-map recipe.
11. **Rig only when the asset needs it.** No rig appears in the hard-surface radio evidence. A separate Jul 11 reply says Fable “seems to rig rather well” but needs weight guidance and produces wonky animation. For props, validate pivots/hinges first; for characters, keep our existing canonical humanoid/VRM rig transfer and treat generated weights as a draft.
12. **Export and inspect.** The intended result is game-quality low-poly, not a render-only high-poly. Our fork should enforce GLB/VRM export, transform/scale conventions, material slots, triangle/texture budgets, manifoldness, normals/tangents, and a standard turntable + wireframe + UV + bake-debug contact sheet.

### Fork-vs-rebuild recommendation

**Rebuild the orchestration, watch Skye's promised prompt/context release.** The currently valuable IP is described in tweets and prompt coaching, not published source. Implement a provider-neutral manifest:

`concept inputs → multiview images → highpoly backend → octree/remesh cleanup → agent lowpoly Blender session → UV → cage + ID-map bake → validators → GLB/VRM export → review sheet`

Land it beside our existing Blender tooling (`scripts/blender/` and, when generalized, `packages/blender-cli/`), with generated artifacts under `data/avatar-models/<asset>/source/`. Keep the mesh-generation backend replaceable (Trellis vs Hunyuan3D-2MV), and keep the direct-modeling prompt/context as versioned data. Do **not** copy Eidoverse AGPL code into the companion app.

## Verbatim recent mesh/pipeline tweets

These are the relevant recent public posts/replies discovered by timeline plus searches for `trellis`, `headless blender`, `lowpoly`, `UV`, `rig`, `bake`, `modeling`, and `texture projection`.

> **Jul 14 08:49 UTC — [world-stack inventory](https://x.com/SkyeSharkie/status/2076952255195209874)**  
> Okay so I've got:  
> - 3d and material assets partially handled (improving)  
> - Character controller for vrms  
> - volumetric sky engine (also improving)  
> - creature creator (exploring improvements)  
> - cloth sim (improving)  
> - motion graphics overlays and in-world screens  
> - visual quality tweaks like N8AO, ICAA (incoming)  
> - plant generator (improving)  
> - flip particle effects for fluid sim and other use  
> - silhouette parallax occlusion shader  
>  
> I am working on adding:  
> - modular kit assembly and use  
> - city builder  
> - roads builder  
> - optimization improvements for high load systems like the volumetric sky  
>  
> I need/will be working on:  
> - oceans/lake surfaces  
> - terrain generation helper  
> - interactive elements to graduate eidoverse out of video version and into world version (some of my friends have already started working on this with the early repo!!)

> **Jul 14 08:57 — [controller status reply](https://x.com/SkyeSharkie/status/2076954144754237779)**  
> nah not yet, eidoverse controllers are waypoint based so far, when i move out of video into the world version that's when i'll start hooking up realtime; i'm still working on getting the models all the elements they need to properly holodeck the world around them

> **Jul 14 06:48 — [pipeline announcement + video](https://x.com/SkyeSharkie/status/2076921777306100149)**  
> okay! my whole pipeline for getting fable and sol to be able to 3d model good topology hard surface game models without using any additional paid services is WORKING... we just need to dial in their lowpoly geometry and baking techniques some more, the pipeline is images > trellis > model creates the lowpoly themselves with direct headless blender interaction > bake ... this will work with both of them because you can replace sol's gptimage2 imagegen in fable's version with z-image-turbo or another quality local image model

> **Jul 14 07:48 — [prompt/context plan + critique screenshot](https://x.com/SkyeSharkie/status/2076936931280363928)**  
> fable is a bit afraid of his own direct modeling with headless blender, by default, he wants to use procedural solutions, so a lot of encouragement and suggestions about how to help his visual probes be more meaningful to him is needed, once i get this down, i'll release something that has this same kind of context learned data in the prompting on git

> **Jul 14 07:34 — [target aesthetic reply](https://x.com/SkyeSharkie/status/2076933250703073722)**  
> all the latest ones are good at primitive building lowpoly aesthetics without any assistance, my pipeline is targeting more realistic aesthetics with proper hard surface lowpoly topology - btw, that example is extremely highpoly/not optimized

> **Jul 14 06:51 — [why the low-poly stage matters](https://x.com/SkyeSharkie/status/2076922637754970155)**  
> yes; fable and sol are probably the first models that can reach what is needed to do this - good lowpoly topology for hard surface on generated models has been unsolved so far, even meshy and tripo produce procedural garbage for hard surface lowpolies

> **Jul 14 08:15 — [modeling method reply](https://x.com/SkyeSharkie/status/2076943737972990267)**  
> you should actually be able to get them to do proper bevel/bool hard surface modeling rather than primitive accumulation

> **Jul 14 05:23 — [sensor-system negative result](https://x.com/SkyeSharkie/status/2076900254960824455)**  
> My continued experiments with the sensor system for 3d modeling show that where it is amazing at assisting models of various sizes and ages at assembling arbitrary modular kits, it actually DAMAGES their work with their own raw geometry due to the sensor resolution and additional back and forth causing them to err on the side of using less and thicker geometry

> **Jul 13 08:32 — [fully local target](https://x.com/SkyeSharkie/status/2076585432742260751)**  
> still trying to solve the fully local 3d model with good low topology thing with sol and fable - getting close, fable's lowpoly geo keeps getting better, but i'm still having to teach her stuff, once i get this framework locked in i will OS, it requires input images though, which means claude can't do it independently - i'll look into letting claude use local z-image-turbo for the input and make sure the final working system i release is setup for both claude and codex

> **Jul 12 08:54 — [human art-direction loop + video](https://x.com/SkyeSharkie/status/2076228569337114652)**  
> i've been guiding fable along with feedback, no manual modeling intervention and this is where we've gotten so far from the original... it's funny because this was my exact job for much of my AAA games career - managing and reviewing other artists and guiding them toward better work

> **Jul 11 05:46 — [Hunyuan/UV/projection stage + video/image](https://x.com/SkyeSharkie/status/2075818872348057954)**  
> Okay, I'm making actual progress on this with hunyuan3d-2mv locally, but the problem with it is that it doesn't create textures, which has me fumbling at methods that cause misaligned projections that like this mess. This also has issues of alignment between the highpoly and lowpoly geometry, but look at that UV... and the topology is only bad because its TOO low poly... I am so close to solving fully generated game quality topology hard surface models with no subscription to mesh generator services.  
>  
> GPT 5.6 Sol is me finding a good small footprint texture projection solution away from being a 3d model generator with no additional APIs thanks to gptimage. And once I dial that in, I can try local image models for Fable. Fable 3d modeled this lowpoly and did the texture projection, but Sol made the turn around images for it.

> **Jul 11 00:47 — [high-poly backend](https://x.com/SkyeSharkie/status/2075743646759244278)**  
> So none of the solutions for the high poly that didn't use a 3d model generator worked out. However, Hunyuan-2 multiview is very small and produces great results, for the highpoly in the skill I'm building, when you do an octree remesh on the output. Have to give up on avoiding mesh models, but this should still have great results on the lowpoly, I think.

> **Jul 10 19:34 — [division of labor](https://x.com/SkyeSharkie/status/2075665097612284102)**  
> that is, on the mesh generation - the image model was gptimage2 for the multi-view, but there are local solutions for that as well, the reason i'm doing this with gpt specifically is for the lowpoly payoff at the end, though ... there are tons of local solutions already for mesh production but they all produce poor lowpoly hard surface topology, even the cloud ones do as well, what i'm hoping for here is combining the models' lowpoly modeling ability, both Fable AND Sol with a generated highpoly to solve this problem

> **Jul 11 03:58 — [sensor details](https://x.com/SkyeSharkie/status/2075791891593896354)**  
> I built out, and am continuing to work on and test with various things, a sensor system with fable that reports the actual shapes of the mesh surfaces of arbitrary meshes, which models normally can't see precisely and just bounce back and forth between image probes and bounding boxes or, if they're present, physics meshes. It has various methods of “touching” the mesh surface that the model can use: raycasting checks, normal direction comparisons, and a sparse point cloud generation for getting surface positions with much less reporting numbers than vertex locations, vertex welding to find holes, etc.  
>  
> I'm still refining it, and was getting some tolerance issues on certain things that were confounding my results, but I think it can actually help improve raw 3d modeling as well as kit assembly. I just need to fix bugs and also prompt the models about using it it better. I'm testing it on smaller models and plan on testing it on some that don't have any vision supplement as well.

> **Jul 11 06:28 — [rigging reply](https://x.com/SkyeSharkie/status/2075829494909403571)**  
> a bit, Fable seems to rig rather well, but sometimes needs guidance on weights, animations are kinda wonk though, which is understandable

### Media evidence, described

- **Jul 14 pipeline video:** a turntable of an olive rugged radio/speaker with distinct metal, plastic/rubber, grille, and display regions. Early beauty frames show coherent silhouette but visible uneven/faceted guards, handle supports, circular rims, and some wavy highlight/shading. The final frame switches to an actual triangulated wireframe view. No UV, bake maps, armature, or readable Blender UI are shown.
- **Jul 14 critique screenshot:** the visible prompt diagnoses low-poly corner brackets overhanging their high-poly counterparts and sampling neighboring green case texels. It explicitly sets a 1,600-triangle ceiling, asks for a vertex-normal-expanded cage (“Alt+S-style”), minimal edge smoothing, close probes, and per-surface ID-color debug maps. The referenced geometry image itself is cropped out, so these are text claims, not visual topology proof.
- **Jul 11 UV image:** a dense cyan-on-black UV atlas with large beveled panel islands, long narrow bevel strips, radial fan/ring islands, and many small wedges. No obvious overlap is visible at the available resolution; gutters are sometimes narrow. No checker, texture, or bake result is present.
- **Jul 14 contact sheet:** 24 finished film frames (6×4) of a stylized flower character in a dark red room, titled “THE DASEIN BLUES.” It demonstrates Eidoverse's video output, subtitles, camera coverage, furniture/staging, and in-world character presentation; it contains no wireframe, UV, topology, or mesh-pipeline evidence.

## The early repo: located, but not adoptable

| Repository | Public facts | License | What is actually there | Decision |
|---|---|---|---|---|
| [`SkyeShark/eidoverse`](https://github.com/SkyeShark/eidoverse) | Public; description “staging repo for future expansion of eidoverse”; created/edited through four README commits, latest 2026-07-05; 1 star at capture | **No license** | One `README.md`: “future interactive expansion … Staging repository. Framework source not yet published here.” No code, package manifest, assets, issues, releases, or tags | **Not a fork target.** “Friends … working … with the early repo” cannot be verified from public contents. No vendoring path because there is no licensed source. |
| [`SkyeShark/eidoverse-video`](https://github.com/SkyeShark/eidoverse-video) | Public; updated 2026-07-13; 18 stars/3 forks at capture; Deno + WebGPU + Three.js/TSL prealpha video toolkit | **AGPL-3.0** | Real engine: VRM/Rapier locomotion, procedural world/creatures, sky, cloth/fluid/particles, SPOM, overlays/screens, assets/audio/render harness. README claims are backed by named source files such as `character_controller.js`, `sky_system.js`, `cloth_sim.js`, `parallax_occlusion.js` | **Reference/watch.** Do not import into the companion browser runtime without an explicit AGPL product decision. |
| [`SkyeShark/icaa-antialiasing`](https://github.com/SkyeShark/icaa-antialiasing) | Public Three.js WebGPU/TSL implementation and benchmark; current source in `src/ICAANode.js` | **MIT** | A real single-frame spatial AA node plus reproducible benchmark artifacts; not an npm package and not authored by N8Programs | **Watch/pilot after WebGPU.** Permissive, but our current renderer is WebGL. Potential future vendoring path: `vendor/skyeshark/icaa-antialiasing/src/ICAANode.js` after attribution/provenance review—not tonight. |

## Component decision map

Effort assumes one engineer familiar with `apps/ai-companion-rtc`; “clean-room” means use public behavior/API ideas but no AGPL source copy.

| Component | Public maturity and license | Fit/gap versus us | Decision | Effort and landing zone |
|---|---|---|---|---|
| 3D/material asset pipeline | Eidoverse Video has ~90 bundled models plus CC0 fetchers/PBR sets; engine/source AGPL, individual asset provenance varies. New direct-mesh pipeline not published. | We already own Blender transfer and VRM catalog; lack repeatable generated hard-surface low-poly/bake loop. | **Adopt-now, rebuild** | **M/L, 8–15d** pilot in `scripts/blender/`, graduate provider-neutral pieces to `packages/blender-cli/`; outputs `data/avatar-models/<asset>/source/`. |
| VRM character controller | Implemented AGPL: `character_controller.js`, Rapier physics, foot IK, slopes/stairs/vault/climb/jump/seat; robot adapter adds lidar/A*. Public reply says current controllers are **waypoint-based, not realtime input**. | Our L0 is a superior expression/gesture/face sole-writer, but it does not solve world locomotion, collision capsule, terrain contact, pathing, or foot planting. These belong beside—not inside—L0. | **Watch / clean-room spike** | **L, 12–20d**. Add separate `public/world-locomotion.ts`, feed bounded locomotion intent/phase into `vrm-body.ts`; never let physics write expression bones directly. |
| N8AO | [`n8ao`](https://github.com/N8python/n8ao), npm `n8ao`; **CC0-1.0**; mature WebGL post pass, 487 stars at capture; artist controls, half-res/quality modes, custom displacement/alpha clipping support. | Directly attacks our flat/cheap look through stable contact AO; MToon writes depth, so basic compatibility is plausible but must be measured around transparents/outlines. N8Programs authored **N8AO only**, not ICAA. | **Adopt-now** | **S, 1–3d** in `public/vrm-body.ts`: composer owns render, N8AO before AA/color output; preallocate passes/targets; resize only on viewport change; lab A/B + GPU timing. |
| ICAA | [`SkyeShark/icaa-antialiasing`](https://github.com/SkyeShark/icaa-antialiasing), **MIT**; source and benchmark public. Isoline-Coverage AA, single-frame, no history/LUT; README reports 0.038 ms Fast / 0.11–0.15 ms HQ at 1080p on laptop RTX 4090, but also admits SMAA wins temporal stability. **Not N8Programs.** | Excellent texture-preserving anime-edge idea and no temporal ghosting, but current companion is WebGLRenderer while ICAA is Three WebGPU/TSL. | **Watch** | **M, 4–7d after WebGPU renderer seam**. Future post node in `vrm-body.ts`; validate MToon outlines, hair alpha, motion shimmer, integrated-GPU cost. |
| Volumetric sky | Implemented AGPL in `sky_system.js`; world-space volumetric sky/cloud/storm/day-cycle, described as high load and still being optimized. | Ghost Room needs authored atmosphere, but a full world volumetric engine can consume the frame budget and is mostly invisible indoors. | **Adopt-now only as lightweight original room sky** | **S/M, 3–5d** in `public/scene.ts`: static/slow procedural sky dome + one bounded fog/volumetric-light layer outside windows; no per-frame allocations; full cloud marching stays watch. |
| Silhouette parallax occlusion / SPOM | Implemented AGPL in `parallax_occlusion.js` + `parallax_material.js`; flat and curved relief with silhouette-following geometry/self-shadow behavior. | High payoff for close walls/panels/props while preserving low mesh count; less relevant to deforming MToon bodies. | **Watch / clean-room prototype** | **M, 5–8d** as original shader helper beside `public/scene.ts`; first use Ghost Room wall/door relief, not avatar materials. |
| Cloth simulation | Implemented AGPL `cloth_sim.js`: mass-spring, wind, pinning, scene collision, settle pre-roll; README examples flags/capes/curtains. | Beyond VRM spring bones for capes/skirts, but the published system is scene cloth, not skinned hair/garment collision tied to humanoid rigs. L0 cannot absorb CPU/GC churn. | **Watch** | **L, 10–18d** GPU/worker cloth lane with fixed buffers; start cape/skirt panels, collision primitives from VRM; spring bones remain hair baseline. |
| Creature creator | AGPL `makeCreature`, broad procedural body/gait/accessory feature claims; prealpha but real source. | Useful for future non-human bodies, not today's companion hero avatar. | **Watch** | **L, 15–25d** eventual separate procedural-body package; do not complicate `vrm-body.ts`. |
| Motion graphics / in-world screens | AGPL `makeScreen`, `makeVideoScreen`, overlay/ASCII/text helpers; apparently operational. | We already have DOM UI and scene grammar; in-world screen is useful for Ghost Room media surfaces but not core character quality. | **Watch** | **S/M, 3–5d** original canvas/video texture helper in `public/scene.ts`; update textures only when content changes. |
| Plant generator | AGPL grass/terrain and tweeted SeedThree workflow; still “improving,” with planned GLB exports for performance. | Indoor companion has low immediate need; generated plants can be offline assets. | **Irrelevant now** | **S, 1–2d** later asset import, not runtime generation. |
| FLIP/particle/fluid | Tweet says “flip”; public README actually names 3D **MLS-MPM** liquid plus 2D stable fluids and GPU particles. That mismatch matters. AGPL. | Cinematic demos only; far outside voice/avatar critical path and expensive for 60 Hz. | **Irrelevant now** | **L/XL, 15–30d** only as an isolated scene effect with strict GPU tier. |
| Modular kits / city / roads / terrain | Kits and terrain exist in video repo; city/roads were “working on,” world terrain helper also listed as future—tweet and README timing differ. AGPL. Sensor is reported strong for kit assembly. | Useful later for world mode, not companion close-up register. | **Watch** | Kit assembly **M, 5–8d** offline Blender/scene authoring; city/roads **L/XL**. |
| Oceans/lakes | Interactive height-field water exists, but tweet calls ocean/lake surfaces future. AGPL. | Not Ghost Room/core companion. | **Irrelevant now** | Revisit with outdoor world mode. |

## Top three adopt-now integration sketches

### 1. Rebuild the mesh-authoring loop (highest leverage)

- Define an asset manifest with concept prompt, multiview images, high-poly backend/hash/license, scale/axis, triangle target, map set, rig class, and acceptance thresholds.
- Run high-poly generation off the realtime app; normalize via Blender octree/voxel remesh only when needed.
- Give Fable/Sol direct headless Blender operations plus standardized visual probes: beauty, matcap, wireframe, silhouette, UV checker, normal/AO, and ID-map bake.
- Validate manifoldness, loose geometry, degenerate faces, high/low bounds, cage intersections, UV overlap/gutter, triangle count, texel density, normals/tangents, material slots, pivot, GLB/VRM re-import.
- Require the critique loop to cite visible evidence and emit a diff report; numeric sensors are validators, not the main modeling interface.

### 2. Add N8AO as a measurable visual-quality tier

- In `apps/ai-companion-rtc/public/vrm-body.ts`, replace the direct final render with a preallocated composer/targets and one `N8AOPass`; allocate/update only at init/resize/model swap, never per L0 tick.
- Start half-resolution “Performance” or “Low,” conservative radius scaled to avatar height, low intensity, gamma correction disabled if a later output transform exists.
- Add lab toggles and GPU-frame timing. Acceptance: no MToon outline/alpha-hair regression, stable face/hair AO during motion, and no L0 allocation/latency regression.
- CC0 permits direct dependency or vendoring, but prefer npm `n8ao` first so upgrades/provenance remain obvious.

### 3. Add a bounded Ghost Room atmosphere layer—not the full AGPL sky

- In `apps/ai-companion-rtc/public/scene.ts`, create an original sky/atmosphere profile: slow sky-dome gradient/sun disk outside openings, height fog, and at most one low-step volumetric light/fog volume.
- Precompute noise/lookup texture, reuse materials/uniform objects, and update only sun/time uniforms. Offer quality tiers (`off`, `room`, later `world`).
- Composite before N8AO/AA and tune against MToon so rim/face lighting remains authored. This captures the “expensive anime room” gain without importing a high-load world cloud engine.

## Legal/vendor call

- **Early `eidoverse`: no license, no code—do not vendor.**
- **`eidoverse-video`: AGPL-3.0—do not vendor into the companion stack tonight.** If product ever chooses AGPL distribution, revisit as an explicit legal/architecture decision.
- **ICAA: MIT and public**, exact future path if WebGPU adoption is approved: `vendor/skyeshark/icaa-antialiasing/src/ICAANode.js`, preserving license/notice and pinning a reviewed commit. Do not vendor tonight.
- **N8AO: CC0-1.0**, use npm `n8ao`; no source vendoring is required.

## Primary links

- [Skye X profile via public mirror](https://nitter.tiekoetter.com/SkyeSharkie)
- [Pipeline thread](https://nitter.tiekoetter.com/SkyeSharkie/status/2076921777306100149)
- [Early eidoverse staging repo](https://github.com/SkyeShark/eidoverse)
- [Implemented eidoverse-video repo](https://github.com/SkyeShark/eidoverse-video)
- [N8AO repo](https://github.com/N8python/n8ao) · [npm](https://www.npmjs.com/package/n8ao)
- [ICAA repo](https://github.com/SkyeShark/icaa-antialiasing) · [live benchmark](https://skyeshark.github.io/icaa-antialiasing/)
