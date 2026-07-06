# Character pipeline — 2026 survey for Character Forge

Date: 2026-07-06

Scope: text → image → 3D anime-style character → auto-rig → VRM with expressions and spring bones, under Arthur’s current constraints: no installs/signups/spend during research, prefer local/open first, target machine Apple M4 Max 128 GB.

Legend used below:
- Apple Silicon: Native = documented local path on Apple Silicon; Experimental = vendor/doc says possible but caveated; No = CUDA/Linux/Web only; Service = browser/API service.
- Output license: Own = paid/private ownership or equivalent; CC BY = attribution required; Unknown = I did not find an accessible first-party license statement.

## Executive take

1. **Best image stage today:** OpenAI `gpt-image-2` and Gemini `gemini-3.1-flash-image` / `gemini-3-pro-image` are the strongest sheet generators. Gemini is better-documented for **multi-reference character consistency**; OpenAI is better if we stay inside Arthur’s existing OpenAI/Codex stack.
2. **Best local Apple-Silicon image alternative:** **Draw Things** plus an anime SDXL checkpoint such as **Animagine XL 4.0**, with LoRA + ControlNet / pose editing.
3. **Best open image→3D models for local experimentation:** **Stable Fast 3D** and **SPAR3D**. Both have explicit experimental MPS paths. **TRELLIS** does not.
4. **Best current open high-end image→3D paper/model:** **Hunyuan3D 2.1**, but its public docs are still CUDA-first even though the repo claims macOS support.
5. **Best service image→3D for rigging-friendly output:** **Meshy** is the clearest fit because it explicitly documents **A-Pose / T-Pose / Custom pose control**, multi-view, and output licensing.
6. **Least surprising humanoid auto-rig path:** **Mixamo**. It is still a web workflow, not an API.
7. **Hard truth about expressions:** arbitrary generated meshes are the weak point. **ARKit-52 / Perfect Sync is easy only when topology matches a VRoid-style donor**. Otherwise, you are sculpting or baking shape keys manually.
8. **Pragmatic v1 recommendation:** for a first agent-driven system that must reliably end in expressive VRM, use **sheet-first → VRoid Studio lane** for production, and keep the **full gen-3D lane** as an experimental second track.

---

## 1) Image stage: character sheets

### Stage 1 table

| Option | What is current | Character-sheet strengths | Consistency tools / tricks | Apple Silicon | Notes | Sources |
| --- | --- | --- | --- | --- | --- | --- |
| **OpenAI GPT Image** | Official current image model is **`gpt-image-2`**. OpenAI documents both the **Image API** and the **Responses API** image-generation tool path. | Strong prompt following, editing, multi-turn refinement. Good fit for “front / side / back / expression sheet” iteration loops. | OpenAI explicitly documents **multi-turn image generation/editing** and `n` multi-image generation. Practical trick: generate a clean front reference first, then iteratively edit toward side/back sheets instead of asking for everything at once. | Service | Best fit if we want to stay inside Arthur’s existing OpenAI toolchain. Note: API use may require organization verification. OpenAI’s terms state that, as between you and OpenAI, you own the output. | <https://developers.openai.com/api/docs/guides/image-generation>, <https://developers.openai.com/api/docs/guides/images-vision>, <https://openai.com/policies/terms-of-use/> |
| **Gemini 3.1 Flash Image** | Official model name: **`gemini-3.1-flash-image`**. | Very strong fit for **consistent character sheets**. Google’s own codelab explicitly teaches building a character sheet / consistent imagery workflow. | Official docs say Gemini 3 image models support **up to 14 reference images**, including **up to 4 character-consistency images** on Flash Image. | Service | Best-documented option for “same character across multiple views”. Google’s Gemini API terms say Google won’t claim ownership over generated content. | <https://ai.google.dev/gemini-api/docs/image-generation>, <https://codelabs.developers.google.com/gemini-consistent-imagery-notebook>, <https://ai.google.dev/gemini-api/terms> |
| **Gemini 3 Pro Image** | Official model name: **`gemini-3-pro-image`**. | Better for harder art-direction / control tasks than Flash Image. | Official docs say Pro supports **up to 5 character-consistency images** and up to 3 style refs. | Service | Better if we want fewer but higher-control generations. | <https://ai.google.dev/gemini-api/docs/image-generation>, <https://ai.google.dev/gemini-api/terms> |
| **Draw Things + SDXL / anime checkpoints** | Native Apple app for local diffusion. App Store text explicitly calls out **offline creation**, **LoRA training**, **full ControlNet support**, **pose editing**, and importing community models / LoRAs. | Best low-cost local route for repeated sheet iteration and fine control. | Use an anime SDXL base plus model-sheet / turnaround LoRA and ControlNet / pose editing. | Native | Strongest “no cloud, on Mac” image lane. | <https://apps.apple.com/us/app/draw-things-offline-ai-art/id6444050820>, <https://drawthings.ai/downloads/> |
| **Diffusers on MPS** | Hugging Face documents Stable Diffusion pipelines on Apple Silicon via PyTorch `mps`. | More scriptable than Draw Things, but less turnkey. | Official MPS guidance recommends attention slicing, especially below 64 GB RAM; Apple Silicon support is real but memory-sensitive. | Native | Good for code-first automation later; Draw Things is the easier local operator UI. | <https://huggingface.co/docs/diffusers/en/optimization/mps> |
| **Animagine XL 4.0** | Anime-focused SDXL checkpoint on Hugging Face. | Strong anime baseline for local generation. | Model card documents its tag-based prompting style and SDXL usage. | Native via Draw Things / Diffusers | Good default local anime checkpoint. | <https://huggingface.co/cagliostrolab/animagine-xl-4.0> |
| **Turnaround / character-sheet LoRA ecosystem** | Example: **“Turnaround - model sheet - character sheet - XL”** LoRA for SDXL. | Specifically tuned for turnaround / model-sheet layouts. | Example trigger words include “multiple views of the same character”, “model sheet”, “character sheet”. | Native via Draw Things / Diffusers | This is the clearest evidence that the community has dedicated character-sheet LoRAs. | <https://tensor.art/models/688689566573503059> |

### Practical sheet recipe

For the image stage, the most reliable pattern is:

1. Generate **one strong front 3/4 reference**.
2. Lock the design language: silhouette, hair mass, outfit closure points, palette, shoes.
3. Generate a **clean turnaround sheet** on white/gray background.
4. Generate a separate **expression sheet**.
5. Keep one “canonical” sheet and use it as the only reference downstream.

Best documented consistency-heavy service route: **Gemini Flash Image**.
Best existing-stack route: **OpenAI `gpt-image-2`**.
Best local route: **Draw Things + Animagine XL 4.0 + turnaround LoRA**.

---

## 2) Image → 3D stage

### Open / local model table

| Model | Status | Apple Silicon | Hardware / VRAM note | Pose canonicalization / A-T pose | What the official docs clearly support | Anime / toon read | Sources |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **TRELLIS-image-large** | Open | No | README says **Linux only** and **NVIDIA GPU with at least 16 GB**. | No documented A/T-pose output control. | High-quality image/text-to-3D; multi-image conditioning; outputs meshes / radiance fields / 3D Gaussians. | Project page says it currently excels at **artistic-style 3D assets**. Repo includes stylized and anime-like multi-image examples, but not a rigging-oriented canonical-pose workflow. | <https://github.com/microsoft/TRELLIS>, <https://microsoft.github.io/TRELLIS/> |
| **Hunyuan3D 2.1** | Open | Experimental / unclear | README says **10 GB VRAM** for shape, **21 GB** for texture, **29 GB** total. Repo also says it supports **macOS, Windows, Linux**, but the published install path is CUDA-first. | No documented A/T-pose control in official README. | Single-image to textured mesh with PBR material; strongest official benchmark claims among the open models in this set. | Strong open high-end candidate, but official Mac instructions are still thin and the repo license is custom / non-SPDX, so review before commercial use. | <https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1>, <https://arxiv.org/html/2506.15442v1> |
| **Stable Fast 3D (SF3D)** | Open | Experimental | README documents experimental **MPS** support; recommends CPU if under **32 GB unified memory**; says default single-image path needs about **6 GB VRAM**. | No documented A/T-pose canonicalization. | Fast single-image mesh reconstruction with UV unwrap + materials; GLB export. | Official examples include stylized characters / creatures, but the project is not avatar-specialized. Good for local experiments, weaker bet for keeper anime faces. | <https://github.com/Stability-AI/stable-fast-3d> |
| **SPAR3D** | Open | Experimental | README documents experimental **MPS** support on **macOS 15.2+**; default about **10.5 GB VRAM**, low-VRAM mode about **7 GB**. | No documented A/T-pose canonicalization. | SF3D-derived model with point-cloud conditioning for better backside reconstruction. | Better than SF3D for backside cleanup, still not an avatar-specialized canonical-pose generator. | <https://github.com/Stability-AI/stable-point-aware-3d> |
| **CSM Cube** | Closed / service | Service | Not a local model. | Not verified from accessible first-party docs. | Meta’s writeup says CSM turns text/images into production-ready 3D assets and uses segmentation so component parts are ready for rigging/animation. | Potentially strong production tool, but I could not access first-party pricing / license / pose docs directly in this session. | <https://ai.meta.com/blog/segment-anything-common-sense-machines-3d-assets/>, <https://github.com/api-evangelist/csm> |

### Service comparison table

| Service | Free tier | Output license flag | Pose / rigging-relevant controls | Apple Silicon | Read on anime-style character use | Sources |
| --- | --- | --- | --- | --- | --- | --- |
| **Meshy** | Free plan: **100 credits/month**, **10 downloads/month**; Meshy 6 downloads locked on free. | Free: **CC BY 4.0** with attribution. Paid: private ownership / no attribution. | Official page explicitly documents **Pose control (A-Pose / T-Pose / Custom)** and **multi-view**. | Service | Best-documented service for rigging-oriented humanoid output. | <https://www.meshy.ai/features/image-to-3d>, <https://www.meshy.ai/pricing>, <https://help.meshy.ai/en/articles/10137554-what-is-the-ownership-of-the-generated-models>, <https://help.meshy.ai/en/articles/15696428-what-is-included-on-a-free-plan> |
| **Tripo 3D** | Free plan: **200 credits/month (up to 8 models)**, public models. | Free: **public CC BY 4.0**. Paid: private + commercial use. | Official site clearly advertises **AI rigging and animation**, but I did **not** find an official T/A-pose control statement in the accessible pages I read. | Service | Strong all-in-one workspace if convenience beats strict local/open preference. | <https://www.tripo3d.ai/>, <https://www.tripo3d.ai/pricing>, <https://www.tripo3d.ai/terms> |
| **Hyper3D / Rodin** | Free preview / free start; export depends on plan and result flow. | Free license is ambiguous from the public pages; **Creator** plan says **unlimited export and any use**. Separate copyright license also frames use as a license, not title transfer. | Strong controllability story (bbox / voxel / point-cloud control; refine / optimize / export), but no official A/T-pose statement found. | Service | Official site exposes **Anime**, **Cartoon**, **Cel-Shaded** style categories and strong export/refine tooling. | <https://hyper3d.ai/>, <https://hyper3d.ai/pricing>, <https://hyper3d.ai/legal/copyright-license>, <https://hyper3d.ai/legal/terms> |
| **CSM / Cube** | Mirror says free single-click pipeline exists; direct first-party pricing was not accessible here. | Unknown | Meta article suggests segmentation into riggable parts; no official pose-control docs retrieved. | Service | Interesting, but under-sourced compared with Meshy / Tripo / Hyper3D in this session. | <https://ai.meta.com/blog/segment-anything-common-sense-machines-3d-assets/>, <https://github.com/api-evangelist/csm> |

### Read on this stage

- **For strict local Apple-Silicon experimentation**, SF3D and SPAR3D are the cleanest documented starts.
- **For open high-end quality**, Hunyuan3D 2.1 is the most ambitious open model here, but Apple-Silicon operation is not yet as well-documented as its CUDA path.
- **For a real v1 character pipeline that must feed rigging**, Meshy is the current standout because it explicitly addresses **pose control**.
- **TRELLIS is not an Apple-Silicon local path today.**

---

## 3) Auto-rig stage

### Stage 3 table

| Option | What it gives you | Humanoid / VRM fit | Agent-driveable? | Notes | Sources |
| --- | --- | --- | --- | --- | --- |
| **Mixamo** | Upload custom character, place wrist/elbow/knee/groin markers, get an auto-rigged skeleton and downloadable result. | Very good for standard humanoids. Clean path to FBX → Blender → VRM mapping. | Partly: browser-driveable, but still a GUI workflow; no public API found. | Still the least surprising humanoid auto-rig for this pipeline. | <https://helpx.adobe.com/creative-cloud/help/mixamo-rigging-animation.html> |
| **Tripo built-in rigging** | Official site advertises “From Static Mesh To Motion” with clean skeletons, smooth skin weights, export-ready files. | Promising, but less transparent than Mixamo. | Service / web workflow | Good convenience path if you stay inside Tripo. | <https://www.tripo3d.ai/> |
| **UniRig** | Open research system for automatic **skeleton prediction** and **skinning weight prediction**. Supports input `.obj`, `.fbx`, `.glb`, `.vrm`; outputs `.fbx` / rigged assets. | Broadly useful, not human-only; repo includes `mixamo.yaml` and `vroid.yaml` skeleton configs. | Yes, in principle | Strong research option, but still a research-grade pipeline rather than the boring production default. | <https://github.com/VAST-AI-Research/UniRig>, <https://zjp-shadow.github.io/works/UniRig/> |
| **Mixamo Rig Blender add-on** | Builds a **control rig from a Mixamo FBX skeleton** and can bake animation between rig and skeleton. | Good after Mixamo, not a substitute for Mixamo. | Yes, local Blender add-on | Important distinction: this is not a general auto-rigger; it is a post-Mixamo control-rig helper. | <https://extensions.blender.org/add-ons/mixamo-rig/> |

### Recommendation for this stage

If the mesh is humanoid enough, the safest path is still:

**mesh → Mixamo auto-rig → download FBX → Blender cleanup → VRM bone mapping**

UniRig is exciting, but Mixamo is still the simpler answer for a first build.

---

## 4) VRM conversion, expressions, spring bones, and the VRoid lane

### 4.1 Blender → VRM tools

| Tool | What it officially supports | Relevance here | Sources |
| --- | --- | --- | --- |
| **VRM Add-on for Blender** | Import/export/edit VRM, add **VRM Humanoid**, configure **MToon**, and automate with Python scripts. | This is the standard Blender-side VRM bridge. It is also scriptable, which matters for agent operation. | <https://extensions.blender.org/add-ons/vrm/>, <https://github.com/saturday06/VRM-Addon-for-Blender>, <https://raw.githubusercontent.com/saturday06/VRM-Addon-for-Blender/main/docs/en-us/scripting-api/index.md> |
| **Create VRM Model / Humanoid docs** | The add-on can create a VRM-suitable armature automatically. | Useful when rebuilding or repairing humanoid bone structure before export. | <https://raw.githubusercontent.com/saturday06/VRM-Addon-for-Blender/main/docs/en-us/create-humanoid-vrm-from-scratch/index.md> |
| **blender-vrm-perfect-sync** | Copies a donor model’s **52 ARKit / Perfect Sync** shapes onto other **VRoid-topology** VRM models; batchable; CLI underneath the GUI; Windows-only packaged release. | This is the best Blender-side analogue to HANA_Tool for topology-matched VRoid models. | <https://github.com/elainyilanchen/blender-vrm-perfect-sync>, `streams/companion/notes/perfect-sync-models.md` |
| **ARKit Blendshape Baker for Blender** | Guides the user through baking the **52 ARKit-compatible shape keys** with reference images. | Helpful for manual ARKit-52 creation when you do not have a transferable donor. It scaffolds the workflow; it does not magically invent good deformations for you. | <https://github.com/tsikerdekis/ARKit-Creator-Blender-Addon> |
| **Perfect Sync reference** | VMagicMirror documents that Perfect Sync means mapping all **52 iOS ARKit** shapes to VRM BlendShapeClips. | Best concise statement of the requirement. | <https://malaybaku.github.io/VMagicMirror/en/tips/perfect_sync/> |

### 4.2 What is easy vs hard on expressions

**Easy:**
- Standard VRM expressions on a **VRoid** avatar.
- ARKit-52 transfer between **same-topology VRoid-family models** using donor-transfer tools.

**Hard:**
- Getting convincing ARKit-52 on an arbitrary generated anime head mesh.

Observed reason: the official VRM and VRoid docs cover export and expression retention, but none of the tools I found provide a one-click “auto-generate perfect facial blendshapes from any mesh” path. The practical options are:

1. **transfer from a topology-matched donor**, or
2. **manually sculpt / bake the shape keys**.

### 4.3 VRoid Studio as the alternative lane

| Lane | Strengths | Weaknesses | Expression story | Sources |
| --- | --- | --- | --- | --- |
| **VRoid Studio** | Free; runs on **Windows, macOS, iPad**; purpose-built anime humanoid creator; exports **VRM0.0** or **VRM1.0**. | Parametric look; less unique than a successful gen-3D character; stays in humanoid-anime constraints. | VRoid’s **Expression Editor** saves named expressions into exported VRM, and VRM export retains those expressions. | <https://vroid.pixiv.help/hc/en-us/articles/15760756822297-I-want-to-learn-more-about-the-VRM-export-feature>, <https://vroid.pixiv.help/hc/en-us/articles/4408150140825-How-to-use-the-Expression-Editor>, <https://vroid.pixiv.help/hc/en-us> |
| **Full gen-3D lane** | More original silhouettes, costumes, props, and creature features. | Face rigging and expression work become the bottleneck; Apple-Silicon local 3D is still immature relative to image models. | Usually requires donor transfer or manual shape-key work. | See stages 2 and 4 above. |

### Read on VRoid vs gen-3D

- If you need a **working expressive VRM soon**, VRoid is still the boring winner.
- If you need a **more original silhouette or costume**, gen-3D is more exciting, but the face pipeline gets much harder.

---

## 5) Recommended v1 pipeline for our constraints

## Recommendation

### Production v1: **sheet-first VRoid lane**

This is the v1 I would actually build first if the goal is: **agent-driveable, anime style, expressive VRM, minimum surprises on Apple hardware**.

1. **Design sheet**
   - Generate a front / side / back / expression sheet with **OpenAI `gpt-image-2`** or **Gemini Flash Image**.
   - Keep one canonical reference sheet.
2. **Build avatar in VRoid Studio**
   - Recreate the character from the sheet.
   - Use the **Expression Editor** to tune house expressions.
   - Export **VRM1.0** unless a downstream app still needs 0.0.
3. **Blender pass**
   - Import into Blender if you need material cleanup, accessory edits, extra bones, or spring-bone tuning.
   - Use **VRM Add-on for Blender** for final humanoid mapping / export.
4. **Perfect Sync / ARKit-52**
   - If the model is VRoid-topology compatible, use **blender-vrm-perfect-sync** donor transfer.
   - Otherwise, add ARKit keys manually with **ARKit Blendshape Baker** or sculpt them by hand.
5. **Spring bones and extra channels**
   - Add hair / tail / ear secondary motion in the VRM Add-on / Blender pass.
   - [INFERENCE] Non-human channels such as tails and ears are much easier to manage here than in the fully generated-mesh lane, because the facial system is already stable and the extra channels can be layered on afterwards.

**Quality ceiling:** medium to high for anime avatars; lower originality than a fully generated mesh, but highest reliability.

**Effort per character:**
- **S** if close to stock VRoid
- **M** for a distinctive custom outfit / hair / accessories
- **L** only if you insist on full ARKit-52 polish and custom non-human appendages

### Experimental v1.5: **true gen-3D lane**

If the stream specifically wants “AI made the body mesh too,” this is the best near-term route:

1. **Sheet generation** with `gpt-image-2` or Gemini.
2. **Image→3D**
   - First try **Meshy** with **A-Pose / T-Pose / Custom pose** control and multi-view if you have side/back sheets.
   - For zero-spend local experiments, try **SF3D** or **SPAR3D** first, but expect weaker keeper quality on anime faces.
3. **Auto-rig** with **Mixamo**.
4. **Blender cleanup**
   - Fix topology problems, simplify if needed, repair fingers / skirt intersections / detached accessories.
5. **VRM conversion** with **VRM Add-on for Blender**.
6. **Expressions**
   - If topology is donor-compatible, transfer.
   - Otherwise, sculpt/bake shape keys manually.
7. **Spring bones / extras**
   - Hair, ears, tails, ribbons, etc. in Blender before final export.

**Quality ceiling:** potentially higher silhouette originality than VRoid, but lower face-rig reliability.

**Effort per character:**
- **M** for a lucky service output with minimal cleanup
- **L** for a serious, stream-ready expressive VRM

### Why I do **not** recommend the full gen-3D lane as the first production v1

Because the hardest unsolved part is not “make a mesh.” It is:

**make a mesh that survives humanoid rigging, looks anime-clean, and ends with usable expression blendshapes.**

Today, on Apple hardware and without a custom mesh/retopo/face pipeline, that remains the fragile step.

---

## Bottom line

- **Best image generator in our current stack:** `gpt-image-2`.
- **Best documented consistency generator:** `gemini-3.1-flash-image`.
- **Best local Apple image tool:** Draw Things.
- **Best local Apple open 3D experiments:** SF3D / SPAR3D.
- **Best documented service for rigging-oriented humanoid output:** Meshy.
- **Best safe humanoid auto-rig:** Mixamo.
- **Best Blender VRM bridge:** VRM Add-on for Blender.
- **Best realistic way to get ARKit-52 quickly:** donor transfer on VRoid-compatible topology.
- **Pragmatic production v1:** sheet-first **VRoid lane**.
- **Experimental second-wave lane:** sheet → Meshy/Mixamo/Blender/VRM.
