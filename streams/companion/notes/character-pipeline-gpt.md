# Character Forge pipeline, GPT deep pass (2026-07-06)

## Thesis

For an expressive anime VRM in our runtime, the hard part is not “make a pretty 3D mesh”; it is **stable deformation topology + humanoid semantics + authored expressions**. Today, the best v1 is **AI-designed 2D concept + parametric/VRoid-family VRM base + texture/style automation + donor blendshape transfer**, with generative 3D used as reference/props, not as the main avatar mesh. Re-evaluate full generative 3D when models output rig-ready humanoid topology and named facial shapes, not just GLB assets.

## Failure-mode map: text → image → 3D → rig → VRM

Legend: **FATAL** = breaks unattended path to expressive VRM; **FIXABLE** = acceptable with automated checks, retries, or bounded manual/agent cleanup.

### 0. Character spec / prompt

- **Failure:** visual overdesign: too many motifs, asymmetric tiny accessories, impossible hair/costume intersections. **FIXABLE** by a style bible: silhouette, palette, 3 garment pieces, 1 prop, allowed emotion channels.
- **Failure:** designing expression channels late. **FATAL-ish** for VRM: if the face lacks eyelids, mouth volume, brows, or separable eye highlights, ARKit/VRM expression work becomes fake. VRM 1.0 explicitly separates humanoid, lookAt, expressions, and spring bones; design needs those channels up front [VRM 1.0 spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/README.md), [expressions](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md).

### 1. Text → character-sheet images

- **Failure:** multi-view inconsistency: side/back invent different hair, straps, sleeve lengths, tail origin. **FATAL** if used as reconstruction truth; **FIXABLE** if used only as concept art and fed through a parametric base.
- Evidence: CharacterGen’s paper exists because single-image character reconstruction is challenged by pose ambiguity, self-occlusion, and inconsistent unseen parts; it uses canonical A-pose multi-view diffusion specifically to solve that [CharacterGen](https://arxiv.org/html/2402.17214v2).
- **Failure:** beautiful pose art, not orthographic manufacturing views. **FIXABLE**: enforce front/side/back/3-4/back orthographic A-pose plus separate expression sheet; reject dynamic poses until after base model exists.
- **Failure:** image style bakes lighting/painted highlights that do not survive real-time toon shading. **FIXABLE** by asking GPT Image for flat cel-shaded UV-like colors and separately authoring MToon shade/rim/outline in VRM.
- OpenAI supports text generation and multi-turn image editing, which is useful for iterative sheet repair, but it does not make the sheet geometrically valid by itself [OpenAI image guide](https://platform.openai.com/docs/guides/image-generation).

### 2. Character-sheet images → 3D mesh

- **Failure:** single/multi-view image-to-3D gives a good turntable but bad deformation mesh: fused hair/clothes, uneven density, non-loop facial topology, no eyelid/mouth interior. **FATAL** for expressive VRM unless we retopo and sculpt blendshapes.
- Evidence: TRELLIS outputs assets as radiance fields, 3D Gaussians, and meshes; its own README recommends text → image → image-to-3D because text-conditioned 3D is less creative/detailed, and notes multi-image conditioning is tuning-free and may not work best for all inputs [TRELLIS](https://github.com/microsoft/TRELLIS). That is asset generation, not rig-ready avatar generation.
- Evidence: Hunyuan3D 2.1 is strong at textured 3D assets/PBR and reports 10 GB shape, 21 GB texture, 29 GB combined VRAM, with image-to-shape and texture models [Hunyuan3D-2.1](https://github.com/tencent-hunyuan/hunyuan3d-2.1). Again: mesh + material asset, not humanoid skeleton + ARKit shapes.
- **Failure:** toon look becomes PBR look. **FIXABLE** only by reauthoring materials. VRM MToon is a toon-shading material extension with shade/rim/outline controls; Hunyuan’s “production-ready PBR” is pointed in the opposite material direction [MToon spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_materials_mtoon-1.0/README.md), [Hunyuan3D-2.1](https://github.com/tencent-hunyuan/hunyuan3d-2.1).
- **Failure:** generated mesh lacks canonical humanoid rest pose. **FATAL-ish** for auto-rig reliability; **FIXABLE** only if the generator canonicalizes A/T-pose. CharacterGen targets A-pose anime characters and reports avoiding Janus/mesh cohesion issues better than general methods, but it is research-grade and still stops at mesh “suitable for downstream rigging,” not a finished VRM with facial rig [CharacterGen](https://arxiv.org/html/2402.17214v2).
- **Failure:** Apple local mismatch. **FIXABLE for experimentation, not v1 dependency.** TRELLIS is tested on Linux with NVIDIA GPUs and CUDA dependencies [TRELLIS install](https://github.com/microsoft/TRELLIS). Hunyuan says macOS support but its published setup is CUDA-oriented and the real combined memory note is VRAM, not unified-memory proof [Hunyuan3D-2.1](https://github.com/tencent-hunyuan/hunyuan3d-2.1).

### 3. Mesh → body rig / skin weights

- **Failure:** auto-rig finds a skeleton, but shoulders/elbows/hands deform badly on chibi/anime proportions, thick sleeves, skirt panels, tails, detached accessories. **FIXABLE** for body motion with joint/weight refinement; **FATAL** if we require unattended high-quality deformation from arbitrary generated meshes.
- Evidence: AccuRIG markets automatic humanoid rigging but also exposes manual joint placement, skin-weight refinement, hard-surface attachment, bone masking, pose offsets, and creature/stylized adjustments — the tool class itself admits the hard cases need correction [Reallusion AccuRIG](https://www.reallusion.com/character-creator/auto-rig.html).
- **Failure:** cloth/hair bones and spring bones omitted. **FIXABLE** if model comes from VRoid/VRM templates; expensive if inferred from random mesh. VRM spring bones are explicit chains/colliders for hair/costume shaking, not magic from geometry [VRMC_springBone](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md).

### 4. Body-rigged mesh → facial expressions / blendshapes

- **Failure:** no facial morph targets. **FATAL** for our “expressive VRM” requirement. A pretty static head with jaw bone only is not enough.
- Evidence: VRM 1.0 expressions bind morph targets/material/texture transforms into named presets such as happy, angry, sad, surprised, aa/ih/ou/ee/oh, blink, and look directions [VRM expressions](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md).
- Evidence: ARKit face tracking exposes many coefficients; Apple explicitly distinguishes simple cartoon use from professional rigs using larger/all coefficient sets [Apple ARKit blendshape locations](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation). Perfect Sync practice expects 52 iOS/ARKit-corresponding blendshapes mapped to VRM BlendShapeClips [VMagicMirror Perfect Sync](https://malaybaku.github.io/VMagicMirror/en/tips/perfect_sync/).
- **Failure:** generated head topology differs per character, so donor blendshapes cannot transfer cleanly. **FATAL** for automation. Blendshape transfer is practical when topology/vertex correspondence is stable; generative meshes destroy that premise.
- **Failure:** expression stacking breaks mesh: smile + jaw + blink causes intersections. **FIXABLE** only with authored overrides. VRM has overrideMouth/overrideBlink/overrideLookAt because simultaneous procedural expressions can over-open mouths or push eyes through eyelids [VRM expressions](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md).

### 5. Rig + expressions → VRM 0.x/1.0 runtime asset

- **Failure:** exported GLB lacks VRM humanoid mapping, expressions, MToon, spring bones. **FATAL** for drop-in three-vrm behavior; GLB is not enough.
- **Fix path:** use Blender + VRM Add-on for import/export/editing, humanoid, MToon, and Python automation [VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender). Use VRoid Studio where it directly exports VRM 1.0 [VRoid export FAQ](https://vroid.pixiv.help/hc/en-us/articles/38726063278233-How-do-I-export-a-model-as-VRM).
- **Failure:** renderer mismatch. **FIXABLE** by validating in our three-vrm runtime: humanoid bones present, VRM 0.x/1.0 loads, expression clips exist, spring bones simulate, MToon/unlit fallback acceptable.

## Opinionated v1 recommendation

### Choose: parametric VRoid-family base + AI concept/texture + donor blendshape transfer

Concrete v1 pipeline:

1. **Design bible:** agent writes silhouette/palette/archetype/channel manifest before images.
2. **Image stage:** GPT Image generates/edit-locks: front/side/back A-pose sheet, face close-up, expression sheet, texture motifs. Use images as art direction, not geometry truth.
3. **Base mesh:** start from a VRoid/VRM template family with known humanoid bones, MToon materials, hair/spring-bone conventions, and stable face topology. Keep a small library: slim, chibi, tall, masc/fem/androgynous.
4. **Customize safely:** agent edits textures/material colors/eye highlights/emissives/accessory meshes in Blender; VRoid Studio can be used for parametric hair/body/clothes exports when needed. Its dress-up system supports auto-fitting, mesh delete/restore, blendshape adjustment, animation preview, and VRM export [VRoid dress-up](https://vroid.pixiv.help/hc/en-us/articles/38722733769241-Getting-Started-with-the-Dress-up-Feature-for-those-who-want-to-dress-up-their-characters), [VRoid export](https://vroid.pixiv.help/hc/en-us/articles/38726063278233-How-do-I-export-a-model-as-VRM).
5. **Expressions:** transfer from our verified 52-blendshape donor VRMs (`perfect-sync-models.md`) only onto compatible topology. Then map VRM presets plus custom clips; preserve ARKit/Perfect Sync names for richer tracking where available [VMagicMirror Perfect Sync](https://malaybaku.github.io/VMagicMirror/en/tips/perfect_sync/).
6. **VRM finish:** export via VRM Add-on/VRoid; enforce MToon, humanoid mapping, spring chains/colliders, expression overrides, and runtime smoke in three-vrm.
7. **Use generative 3D only for:** props, background objects, costume reference maquettes, rough hair silhouette studies, maybe non-deforming accessories parented as rigid meshes.

Why this wins v1:

- It preserves the only thing we cannot cheaply regenerate: **deformation semantics**. A stable VRoid-family mesh makes donor blendshape transfer and VRM expression mapping plausible; arbitrary TRELLIS/Hunyuan meshes do not.
- It is agent-driveable enough: Blender + VRM Add-on has Python automation; VRM files are inspectable glTF; texture/material edits are scriptable. VRoid Studio itself is GUI-first, so treat it as a template/export tool, not the core automation substrate.
- It matches the runtime target. VRM wants humanoid bones, expression clips, MToon/spring bones; VRoid emits VRM and already lives in that ecosystem.
- It gives visible character originality through design, textures, palette, hair silhouette, accessories, custom expressions, and channel manifest, without betting the face on unsolved generated topology.

### Honest contrarian: full generative 3D first

Path: GPT Image sheet → TRELLIS/Hunyuan3D/CharacterGen-class mesh → cleanup/retopo → AccuRIG/Mixamo-class body rig → Blender VRM → manually/automatically create facial blendshapes → spring bones.

Verdict today: **not v1 for main avatars**. It is exciting for asset ideation, but the fatal gap is **facial rig topology**, not mesh prettiness. Even if body auto-rig succeeds, generated heads need eyelids, lip loops, mouth cavity/tongue, brow deformation, expression overrides, and 52-shape donor compatibility. If we must manually retopo/sculpt that, we have left “agent-driveable local-first.”

When I would choose it now:

- one-off non-expressive statues/NPCs;
- rigid props or mascot accessories;
- a human artist will retopo and sculpt expressions;
- a character-specific generated mesh is used only as a reference while fitting a parametric VRM base.

## Quality ceiling for v1

What it **will** look like:

- A coherent anime VTuber-style VRM: clean cel/toon shading, readable silhouette, stable blinking/lipsync/lookAt, springy hair/clothes, reliable three-vrm loading.
- More like “excellent customized VRoid/VRM avatar with original art direction” than “hand-sculpted commercial hero model.”
- Strong close-up performance if donor blendshapes transfer well; richer than stock VRoid if Perfect Sync-style shapes are preserved.

What it **will not** look like:

- It will not exactly match every GPT Image detail; parametric constraints will simplify clothing seams, hair volumes, accessories, and asymmetry.
- It will not have AAA facial deformation unless a human/model-specific sculpt pass exists.
- It will not preserve painterly 2D lighting automatically; MToon needs authored shade/rim/outline choices.
- It will not support extreme nonhuman anatomy without leaving the donor-topology/blendshape-transfer comfort zone.

Quality bar I would accept for v1: if a viewer says “custom VRoid” after inspecting wireframe, but “original, expressive, alive character” in motion, that is a success. In a companion runtime, expression reliability beats sculpt novelty.

Persona implication from `character-forge.md`: Nyx and Volt fit v1 if their extreme skirt/cowlick/scarf details become custom accessories/runtime channels; Static is the weak fit because her “almost-absence/static edge” is a shader/postprocess identity, not VRoid geometry. Ship her v1 as a humanoid glitch avatar only if the runtime effect carries the concept.

## 6-month watch list

Re-evaluate full generative 3D when at least two of these become true in reproducible local or cheap API workflows:

1. **Rig-ready topology output:** generator exports a humanoid rest-pose mesh with consistent face loops, mouth interior, eyelids, separated eyes/teeth/tongue, and deformation-friendly body topology.
2. **Named expression output:** generator emits VRM presets and/or 52 ARKit-compatible morph targets, not just a neutral mesh.
3. **Topology-stable identity edits:** repeated generations preserve vertex correspondence so donor blendshapes can transfer across variants.
4. **Anime-character-specific model maturity:** CharacterGen-like systems become maintained tools with weights, not just papers/demos, and show VRM/three-vrm round trips.
5. **Apple-local practicality:** Hunyuan/TRELLIS-class models have first-class MPS/MLX or Core ML paths on M-series, not CUDA-first community hacks.
6. **Toon/VRM material export:** generated assets can target MToon/unlit/outline conventions instead of only PBR texture beauty.
7. **Auto-rig proof on stylized proportions:** public tools demonstrate robust hands/shoulders/skirts/hair chains on chibi/anime bodies with exported VRM humanoid mapping.
8. **Open parametric avatar API:** if VRoid-like editing becomes scriptable/headless, parametric v1 gets even stronger; if generative models add VRM semantics first, switch lanes.

Bottom line: **v1 should ship the expressive parametric lane; keep generative 3D in the loop as a design oracle and accessory forge.** The six-month bet is not “meshes get prettier”; it is “generated meshes become semantically animatable.”
