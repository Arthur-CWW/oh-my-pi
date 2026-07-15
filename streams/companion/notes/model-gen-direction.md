# Model / Rig Generation Direction Brief

> **Date:** 2026-07-15  
> **Status:** `direction-gated / proposed`  
> **Scope:** **Recon/design only.** This note contains no implementation, model downloads, Blender runs, generated meshes, queue registrations, or acceptance claims. Generated outputs remain reference-only until every declared gate passes.

## Epistemic ground truth

`streams/companion/notes/INDEX.md:3-34` is the status authority: `live` means current guidance or an active plan; `evidence-of-record` means a completed measured/acceptance record; `historical` means retained context, not current status. The following classifications were checked before using the notes:

- **Live:** `reference-avatar-pipeline.md`, `character-forge.md`, `avatar-landscape.md`, `character-casting.md`, `eidoverse-recon.md`, and `sota-pose-transfer.md` (`INDEX.md:7,10-15,32-34`).
- **Evidence-of-record:** `perfect-sync-models.md` and `face-rig-pipeline.md` (`INDEX.md:19,29`).
- **Historical:** `anichat-pipeline-recon.md` and `claudesona-assets.md` (`INDEX.md:6,14`).
- The wave request itself is direction-gated and preparation-only: `overnight-program-2026-07-15.md:57-59`.

### Production contract

The current production contract is the live `reference-avatar-pipeline.md:3-31` lane:

1. Use VRoid-family topology because it permits the known lossless Perfect Sync transfer; KAMATTE demonstrated 0/52 to 52/52 through this path (`reference-avatar-pipeline.md:5-7`).
2. Run the four ordered tri-state stages: S0 source validation, S1 face-rig transfer, S2 identity bake, and S3 coverage/runtime gates (`reference-avatar-pipeline.md:9-16`).
3. Resume only when every recorded input and output SHA-256 hash still matches; changed or failed stages rerun, and predecessors must be complete (`reference-avatar-pipeline.md:18-20`). This is recorded-file hash validation at mutable paths, not a full content-addressed store.
4. Verdicts are `accepted`, `rejected`, or `pending`: every stage and gate must pass for acceptance; a real failure rejects; incomplete or unevidenced work remains pending (`reference-avatar-pipeline.md:22-30`).
5. The production artifact carries a machine-readable proof card and provenance/rights notes (`reference-avatar-pipeline.md:46-56`).

The two locally verified evidence-of-record donors are 52/52, but their license quality differs: the Hinzka VRoid donor has an informal source-data grant and redistribution prohibition; the `blender-vrm-perfect-sync` donor has explicit CC BY 4.0 terms (`perfect-sync-models.md:15-20,40-50`). This note treats the donor as a licensed input, never as interchangeable arbitrary geometry.

### Challenger contract (not working today)

The live reference note explicitly marks the challenger as **not implemented** (`reference-avatar-pipeline.md:58-70`):

`concept sheet → generated high-poly reference → authored/template low-poly → UV/cage bake → rig → VRM → expressions`.

The missing stages include concept-provider spend, CUDA-first high-poly generation, the unsolved agent-authored low-poly Blender loop, UV/cage integration, research-grade auto-rigging, manual/non-VRoid bone mapping, and arbitrary face-topology grafting (`reference-avatar-pipeline.md:60-70`). Generated high-poly is reference/blockout material, never accepted topology. Any implementation must fail closed rather than silently treating a generated mesh as production-ready.

## Current Skye / Eidoverse verdict

The live Eidoverse recon says: rebuild provider-neutral orchestration; do not fork the empty/unlicensed early repo or import the AGPL `eidoverse-video` (`eidoverse-recon.md:5-9,124-130`). The early `SkyeShark/eidoverse` repository has only a staging README and no license; `eidoverse-video` is a real Deno + WebGPU/TSL video engine under AGPL-3.0, not a drop-in for the browser companion's Three.js + `@pixiv/three-vrm` + MToon stack (`eidoverse-recon.md:7,124-130`).

The demonstrated direct-modeling evidence is strongest for hard-surface props, not character topology or production rigging. Its useful shape is:

`turnaround images → generated high-poly → agent-authored low-poly in headless Blender → UV/projection → caged bake → visual/ID-map critique loop` (`eidoverse-recon.md:8-10,18-33`).

The recon explicitly says generated output is high-poly/reference/blockout, and that generated low-poly topology remains unsuitable without the authored low-poly stage (`eidoverse-recon.md:22-25`). Fable's rigging was reported as promising but needing weight guidance, with wonky animation (`eidoverse-recon.md:31-33,114-115`); that is a reason for validation, not an acceptance claim.

## Character direction

The live character notes set a strict original-character boundary:

- Use the Sico corpus only as a design register; keep outputs original and do not clone a face, biometric likeness, cosplay costume, logo, or distinctive prop (`character-forge.md:23-40`).
- Preserve the VRoid head/face topology and choose on silhouette plus deformation rather than static novelty (`character-forge.md:53-75,99-105`).
- The register is narrow/flat or boyish, sharp-eyed, hair-silhouette-led, with tsundere/yandere, mischievous-menace, bratty, and sudden-manic energy (`character-casting.md:42-50`).
- Ellen, Hu Tao, and March are private casting references, not shippable generated identities. Ellen was the in-progress taste default, but live conversion/catalog acceptance was incomplete: no VRM or catalog entry was claimed (`character-casting.md:52-68,70-81`; `avatar-landscape.md:130-136`). The preference remains an Arthur fork, not a license to copy an official body.
- Select the winner on silhouette, facial identity under deformation, clipping, and motion, not static render novelty (`character-forge.md:99-105`).

### Historical AniChat lesson

**Historical evidence only — not current ground truth.** The historical `anichat-pipeline-recon.md` must not be used to claim that current Grok uses the old neural packages or that its channel semantics are known (`anichat-pipeline-recon.md:1-18,62-65,98-100`). Its clean-room lesson is:

- Bespoke scene-specific rigs favor per-character calibration and a canonical semantic skeleton plus per-character projection; a 211-D body output does not prove shared bone dimensions (`anichat-pipeline-recon.md:82-85`).
- The older face decoder emitted 52 scalars per frame, but no readable channel-name table proves Apple's canonical ARKit-52 names; treat that as a custom 52-DOF vector until verified (`anichat-pipeline-recon.md:62-65`).
- Hero finish comes from authored material regions, face/hair masks, matcaps/specular control, lighting/post, secondary cloth/hair motion, and dependable authored states (`anichat-pipeline-recon.md:60,104-113,125-127`). Do not claim current Grok uses those older neural components, that 52 outputs are ARKit names, or that 211 outputs are bone dimensions.

## SkyeShark recon

### Exact disk findings

The case-insensitive disk search was run over companion Markdown/log/JSONL/JSON/text files, `TASKS.md`, and the broader `streams/` tree:

- Companion hits are exactly `streams/companion/notes/INDEX.md:14-15`; historical `streams/companion/notes/claudesona-assets.md:5-18,73-74,143-146,161-162,205-220`; live `streams/companion/notes/eidoverse-recon.md:7-39,47-90`; and `streams/companion/notes/overnight-program-2026-07-15.md:57-59`.
- `TASKS.md` had **no match**.
- `streams/companion/docs/` does **not exist**.
- No companion session/log artifact or other companion text artifact containing the name was found beyond the four note locations above. This search did not text-inspect oversized binary media.
- The only broader-tree hit outside companion is unrelated: `streams/playground/HANDOFF.md:34` lists `SkyeSharkie (60)` as a Twitter-archive sync handle. It is not companion-pipeline evidence.

The disk-backed identity evidence comes first: `eidoverse-recon.md:13` records that X `@SkyeSharkie` links to GitHub `SkyeShark`. The historical asset note separately documents the earlier hand-modeled `SkyeShark/claudes-body` VRM and its deterministic VRM build chain (`claudesona-assets.md:5-18,73-74,143-146,161-162`).

**[INFERENCE]** Arthur most likely meant SkyeShark's July Eidoverse/direct-Blender mesh-authoring work because the wave brief names generation and the live recon reconstructs that pipeline. The secondary candidate is the earlier hand-modeled `claudes-body` VRM. Disk evidence does not prove which referent Arthur intended; Arthur must confirm this fork before implementation.

Respectful public source links already identified by the recon:

- [SkyeShark GitHub](https://github.com/SkyeShark)
- [early Eidoverse staging repository](https://github.com/SkyeShark/eidoverse)
- [Eidoverse Video reference engine](https://github.com/SkyeShark/eidoverse-video)
- [mesh pipeline announcement](https://x.com/SkyeSharkie/status/2076921777306100149)
- [Hunyuan/UV/projection evidence](https://x.com/SkyeSharkie/status/2075818872348057954)
- [rigging reply](https://x.com/SkyeSharkie/status/2075829494909403571)

No private/profile-derived claims are added.

## Generation-stack survey

The table separates code license, checkpoint/weight license, and availability. A generated mesh remains reference-only regardless of visual quality, topology count, or static render.

| Candidate | Exact input/output | Texture behavior | Official source | Code license | Weight/model license and availability | Verified hardware signal | 3090 disposition | Integration point | Gates |
|---|---|---|---|---|---|---|---|---|---|
| **TripoSR** | Single image → mesh | Vertex color by default; optional baked texture | [VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR) | MIT | README says MIT covers source and pretrained models | Official README: about 6 GB VRAM | **3090-safe baseline/reference generator** | Shape-generation receipt → template-fit reference | License receipt, GLB parse, geometry/UV/material gates |
| **Stable Fast 3D (SF3D)** | Single image → UV-unwrapped, delighted textured/PBR-ish GLB | Native UV unwrap, texture, and predicted material parameters | [Stability-AI/stable-fast-3d](https://github.com/Stability-AI/stable-fast-3d); [LICENSE.md](https://github.com/Stability-AI/stable-fast-3d/blob/main/LICENSE.md) | Stability AI Community License | Code/model are under the Stability Community License; gated Hugging Face weights; commercial use requires registration, and the free commercial grant terminates above US$1M annual revenue | Official README: about 6 GB VRAM | **Technically fit; license-screened optional challenger, not default** | Optional reference shape/texture generation | License, territory/use, redistribution, commercial-threshold, texture, geometry gates |
| **Hunyuan3D-2 / 2mv** | Image or multiview → shape; separate Hunyuan3D-Paint texture stage | Shape and texture are separate; Paint can texture generated or hand-crafted meshes | [Tencent-Hunyuan/Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2); [LICENSE](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE) | Tencent Hunyuan 3D 2.0 Community License (repository does not present it as MIT) | Same custom Tencent terms cover code, weights, and outputs; excludes EU, UK, and South Korea; forbids using outputs to improve another AI; distribution/scale conditions apply | Official README: 6 GB shape, 16 GB shape+texture | **Technically 3090-fit; policy-restricted reference backend, not default** | High-poly reference and optional texture experiment on the RTX queue | Territory/use, output-use, distribution, active-user/commercial policy, geometry, bake gates |
| **Unique3D** | Single front-facing/rest-pose image → four-view/normal reconstruction → high-resolution textured mesh | Textured mesh; repository documents weights in a Hugging Face Space | [AiuniAI/Unique3D](https://github.com/AiuniAI/Unique3D); [Wuvin/Unique3D Space](https://huggingface.co/spaces/Wuvin/Unique3D) | MIT repository; the Space declares MIT | Weights are publicly downloadable from the Space/checkpoint directory, but the separate weight grant/provenance is insufficiently explicit until tied to exact files; keep pending | No authoritative README VRAM contract; maintainer reports are not an official hardware guarantee | **Likely but unverified; schedule a 3090 smoke measurement** | Optional high-poly reference generator | Weight provenance, geometry/texture, scale/axis, and review-sheet gates |
| **CharacterGen** | Single character image → pose-canonicalized multiview → character mesh | Supplies character appearance; still needs authored low-poly UV/bake and MToon | [zjp-shadow/CharacterGen](https://github.com/zjp-shadow/CharacterGen); [model card](https://huggingface.co/zjpshadow/CharacterGen) | Apache-2.0 | Official model card declares Apache-2.0 weights; dataset/raw VRM redistribution is not part of this permission | Official sources provide no VRAM number | **No fit claim; schedule a 3090 smoke measurement** | First primary candidate for original A-pose character reference | License, checkpoint hash, output geometry, topology/template-fit, UV/bake, rig, VRM, deformation gates |
| **TRELLIS.2-4B** | Single image → complex-topology PBR GLB | Native Base Color/Roughness/Metallic/Opacity and PBR GLB export | [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2); [model card](https://huggingface.co/microsoft/TRELLIS.2-4B) | MIT | Official model card is MIT; checkpoint is public and ungated | README requires at least 24 GB and verifies only A100/H100 | **Boundary/high-risk, not 3090-fit**: 24 GB 3090 is exactly the memory boundary and no 3090 verification exists | Optional high-fidelity reference experiment only | Hardware preflight, geometry, topology/template-fit, texture, and review gates |

### Texture and stylization policy

The durable stage is provider-neutral UV/cage/ID-map baking. TripoSR can bake texture permissively; SF3D emits UV/material output but carries the Stability license; Hunyuan3D-Paint is 16 GB end-to-end but inherits Tencent restrictions; CharacterGen supplies appearance but still needs low-poly UV/bake and MToon authoring. Require a separate MToon/material-role pass; generated PBR must not be accepted as runtime-ready by itself.

## Custom-rig lanes

| Lane | Exact input/output | Source/license and 3090 fit | Decision | Required validation |
|---|---|---|---|---|
| **Template-fit production extension** | Accepted concept/high-poly reference + pinned VRoid template → Blender fit/rebuild preserving template semantics → canonical skeleton/face → VRM | Uses the production pattern and a permitted Hinzka or CC BY donor; no learned-rig dependency | **Recommended first lane** | Preserve template ID/hash, vertex order, face topology, UV contract where possible, canonical bones, donor-compatible face, then require 52/52 after export/reimport |
| **TokenRig / SkinTokens challenger** | Mesh → skeleton hierarchy + dense weights in one autoregressive pass | [VAST-AI-Research/SkinTokens](https://github.com/VAST-AI-Research/SkinTokens), [model card](https://huggingface.co/VAST-AI/SkinTokens); MIT code and MIT model card; official minimum 14 GB VRAM | **3090-fit draft lane**; prefer this current release | Canonical bone mapping, acyclic hierarchy, required names, finite/nonnegative weights summing ≈1, influence cap, no zero-weight vertices, joint containment, skinned-geometry deformation |
| **UniRig baseline** | Mesh → skeleton, then skinning; merge into rigged mesh | [VAST-AI-Research/UniRig](https://github.com/VAST-AI-Research/UniRig), [model card](https://huggingface.co/VAST-AI/UniRig); MIT code/model card; the official model card requires >8 GB VRAM and currently contains only skeleton prediction, while the current repository README describes skeleton and skinning prediction as available; release descriptions therefore disagree about which full paper checkpoints are available | **Technically 3090-fit for the published >8 GB component; retain as comparison baseline and prefer TokenRig for first challenger** | Same canonical mapping and deformation gates; checkpoint availability/provenance must be recorded before use |
| **RigNet comparison** | Simplified 1K–5K-vertex mesh → joints/hierarchy/weights | [zhan-xu/RigNet](https://github.com/zhan-xu/RigNet); GPL-3.0 code; old CUDA/PyTorch stack; checkpoint supplied through Google Drive with no explicit separate weight license | **Research-only comparison or omit** | GPL/weight provenance gate plus all rig/weight/deformation gates |
| **Parametric lane** | SMPL/SMPL-X/MANO/FLAME body/hand/face family → parametric body | Separate registered/licensed assets required; these are not interchangeable with mesh generation or rig output (`sota-pose-transfer.md:7-14,32-43`) | **Blocked** by this program; do not substitute parametric models into the generation design | No gate can legalize an absent registration or incompatible artifact contract |

A learned rig may return category-specific names, extra roots, disconnected or cyclic hierarchies, joints outside the mesh, zero-weight vertices, weight bleeding across clothes, missing twist/finger chains, or non-VRM semantics. TokenRig/UniRig output is therefore a draft until mapped into our canonical skeleton and demonstrated under skinned geometry.

## Recommended direction: two-lane extension, not replacement

### Lane A — `template-fit-production-extension`

Use a permissively licensed image-to-3D generator only for reference geometry. Blender fits/rebuilds a pinned VRoid-topology template, preserving donor-compatible face topology and canonical skeleton. Then reuse the existing donor transfer, conditional identity bake, VRM export, 52/52 Perfect Sync verification, humanoid probe, generated-geometry stress probe, and proof card. Acceptance is fail-closed.

### Lane B — `custom-rig-challenger`

Take an accepted low-poly mesh, run TokenRig/SkinTokens first (UniRig as a baseline), map deterministically to the canonical bones, export VRM, and run the same gates plus stricter rig/weight/deformation checks. Parametric SMPL/MANO/FLAME remains blocked.

### Inherited and new validation

All lanes inherit `license-notes-present`, parseable GLB/VRM, `humanoid-bones-complete`, runtime motion probe, Perfect Sync 52/52 where a face is expected, and identity bake when an accepted identity artifact exists. The existing `scripts/avatar-pipeline/vrm-probe.ts:151-278` checks finite/bounded bone transforms and bilateral movement; it does **not** inspect skinned vertices. Generated geometry needs a new deformation probe.

The current `run-production.ts` expression check uses `variants.every(...)` (`scripts/avatar-pipeline/run-production.ts:456-478`), which can pass vacuously for an empty array; generated lanes require named, non-empty gate registries. The current manifest decoder hardcodes `lane: production` and `STAGE_NAMES` to four stages (`scripts/avatar-pipeline/manifest.ts:52-74,196-224,289-325`), and the current proof card is schema v1 with string-parsed channel evidence (`scripts/avatar-pipeline/proof-card.ts:12-43,49-103`). These are existing behaviors, not acceptance for generated assets.

## Fail-closed generated-asset gate design

### Manifest v2 and stage semantics

Introduce a lane-aware manifest v2 rather than inserting new keys into the current v1 structure:

- Preserve `passed | failed | pending`. Missing evidence is `pending` and blocks acceptance; a measured invariant violation is `failed` and rejects; exceptions or missing required artifacts become terminal failed gates.
- Store a non-empty required-gate registry per lane. An empty gate array must never produce acceptance.
- Define lane-specific ordered stages with explicit predecessor enforcement and stage output hashes. A stage cannot run if any predecessor is not `completed`.
- Record the declared lane, gate registry version, threshold-set version, provenance, and final verdict. Downstream submission must check that verdict is `accepted`; `pending` is not successful merely because the process exited 0.
- Treat identity bake as conditional on a valid reconstruction artifact. If identity inputs are absent, the lane must declare `pending/not-applicable`; it must not fabricate or silently mark a pass.

### Resume fingerprint

Existing resume behavior compares recorded input/output hashes at mutable paths (`manifest.ts:231-269`, `reference-avatar-pipeline.md:18-20`); it is not content-addressed storage. For each generated stage, the resume fingerprint must include every direct input hash plus:

`generator repository commit; model/checkpoint hash; code/weight license receipt; generator config; seed; prompt/concept hashes; context/prompt version; Blender/add-on versions; topology-template ID/hash; donor hash; threshold-set version.`

Any changed fingerprint invalidates that stage and every descendant. Receipts are immutable by content hash even when working paths are mutable.

### Required gates

The first milestone requires these named gates, all non-empty and evidence-backed:

- `generator-license-approved`: code license, checkpoint/model license, input/concept rights, territory/use flags, redistribution, commercial thresholds, and output restrictions are recorded.
- `generation-receipt-complete`: repository commit, model/checkpoint hash, config, seed, prompt/concept hashes, queue job, logs, and source/output hashes are present.
- `topology-template-preserved`: template ID/hash, vertex/face order correspondence, face-topology invariants, and semantic edge-loop invariants are present. Vertex-count equality alone is insufficient.
- `geometry-sane`: finite coordinates; scale/axis; no degenerate or loose geometry; declared manifold policy; triangle/material budgets.
- `uv-valid`: UV exists and is finite; overlap/gutter thresholds and texel-density report pass.
- `texture-bake-valid`: required maps, dimensions/color spaces, cage/ID correspondence, and no missing material regions.
- `rig-weight-valid`: hierarchy acyclic; canonical mappings complete; weights finite, nonnegative, sum ≈1; influence cap; no zero-weight deform vertices; joints plausibly contained.
- `blendshape-transfer-coverage`: 52/52 non-empty and preserved after VRM reimport, plus standard fallback expressions.
- `generated-motion-deformation`: evaluate/render skinned vertices under arms-up, arm-cross, twist, head yaw, hip/knee flexion, walk, sit, and squat; reject nonfinite/exploding geometry, gross collapse, severe self-intersection, and garment/neck-seam failures.
- `identity-bake-valid`: required when identity inputs exist; otherwise the declared lane result is pending/not-applicable.
- `review-sheet-complete`: beauty, matcap, wireframe, silhouette, UV, normal, ID-bake, and stress-pose views exist and are hashed.

### Proof card v2

The proof card is atomically written and then hashed back into the manifest. Its fields are:

- schema, lane, asset, verdict, created/updated timestamps;
- concept/reference hashes;
- generator identity, repository commit, checkpoint hash, code/weight licenses, territory/use flags, config, seed, queue job, and log paths;
- high/low mesh hashes and topology metrics;
- template ID/hash/correspondence;
- UV/map dimensions, color spaces, overlap/gutter/texel metrics, bake receipt, and ID-map receipt;
- rig method/checkpoint, bone inventory/mapping, weight statistics, and joint-containment report;
- face donor/hash and 52/52 before/after reimport with per-channel evidence;
- identity-bake reconstruction ID when applicable;
- stress poses/clips and skinned-geometry failure metrics;
- review-sheet paths/hashes;
- every gate name, status, threshold, observed value, detail, and evidence hash;
- provenance and redistribution decision.

Unlike the current proof card's `parseInt(observed) || 52` fallback, v2 carries typed numeric evidence from receipts so an observed zero cannot turn into a false 52 (`proof-card.ts:81-84`).

## GPU-queue integration points

The current Mac-side queue exposes only `gpu-pose-batch`, `wilor-3d`, `gvhmr-mesh`, and `generic` (`scripts/gpu-queue.ts:8-15,34-58`); the durable RTX queue serializes one runner at a time and keeps JSON jobs/logs/receipts (`gpu-queue.md:1-23,75-86`). Future generated-asset kinds should be explicit and fail-closed:

- `avatar-shape-gen`: pinned installed image/multiview generator and exact argument schema;
- `avatar-texture-gen`: pinned texture/PBR generator and exact argument schema;
- `avatar-auto-rig`: pinned TokenRig/SkinTokens (and separately declared UniRig baseline) and exact argument schema.

Each kind maps only to a pinned installed project/checkpoint. Missing repo, checkpoint, license receipt, or VRAM preflight exits nonzero with an exact path/message. Each completed job emits an immutable receipt containing job ID, source/output hashes, peak VRAM, timings, commit/checkpoint identity, and log path. Do not use `generic` for an accepted production artifact: it has no licensed-kind contract.

Heavy ML generation and rig inference run serially on the RTX 3090. The Mac performs browser/runtime proof and the already-proven deterministic headless Blender transfer/validation seam. The queue remains durable, serialized, inspectable, and no-download by default; registration and license decisions precede any accepted run.

## First milestone and bounded estimate

**Milestone (exact):** `One original A-pose character reference through permissive generation → VRoid-template fit → existing Perfect Sync donor transfer → identity bake when applicable → full generated-asset gates → proof card; no catalog entry unless accepted.`

Use CharacterGen first if its 3090 smoke measurement proves viable; retain TripoSR as the known official 6 GB permissive baseline. This is a planning proposal, not an execution claim.

- **5–8 engineer-days**: one manually art-directed proof using existing Blender/transfer infrastructure.
- **8–15 engineer-days**: make the provider-neutral authored-low-poly/UV/bake loop reliably resumable.

These are bounded planning estimates, not measurements.

## Decision requested

Arthur must choose four forks before implementation:

1. **Lane priority:** template-fit production extension first, or custom auto-rig challenger first?
2. **SkyeSharkie referent:** does this mean the Eidoverse/direct-Blender mesh-authoring work, or the earlier hand-modeled `claudes-body` VRM work?
3. **Style target:** which target visual register should the original character pursue (for example the narrow/flat, sharp-eyed, hair-silhouette-led Sico register, or another explicitly chosen register)?
4. **Generation-experiment budget:** what provider spend and how many/time-bounded RTX 3090 runs are acceptable?

No generated asset, downloaded checkpoint, Blender run, queue registration, catalog entry, or acceptance claim is made by this brief.
