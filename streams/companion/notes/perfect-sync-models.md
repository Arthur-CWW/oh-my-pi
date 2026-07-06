# Perfect-sync VRM model scout (ARKit-52 face rigs)

Date: 2026-07-06

Goal: find a well-licensed, cute/anime-style VRM with a richer face than Alicia Solid's standard VRM expressions, ideally ARKit-52 / "Perfect Sync" compatible, and download inspectable candidates into gitignored `data/avatar-models/`.

## Ground truth

- In VTuber/VRM tooling, "Perfect Sync" means driving VRM expressions from the full iOS ARKit face-tracking set. VMagicMirror describes it as mapping all blendshapes obtained by iOS ARKit FaceTracking to VRM BlendShapeClips, and lists the 52 clip names it expects: `BrowInnerUp`, `BrowDownLeft`, ..., `TongueOut`. Source: <https://malaybaku.github.io/VMagicMirror/en/tips/perfect_sync/>.
- HANA_Tool is the historically common VRoid path: its BOOTH page says it can copy Perfect Sync settings between same-type VRoid avatars and includes VRoid Perfect Sync data created by hinzka. Source: <https://booth.pm/ja/items/2604269>.
- VRoid sample/base-model rights matter. Pixiv's VRoidPreset_A-Z terms say the `.vroid` and VRM files can be used by anyone for for-profit or non-profit activities, with no credit required; examples include editing textures/parameters, uploading to VRoid Hub, redistributing edited characters, and selling edited characters. Prohibited: CC0 relabeling, using the data in character-creation services, and paid redistribution of the sample VRM/data as-is. Source: <https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z>.

## Shortlist

| Candidate | Style | Blendshape / perfect-sync evidence | VRM version | License / exact permissions observed | Size | Source |
| --- | --- | --- | --- | --- | --- | --- |
| **hinzka `VRoid_V110_Female_v1.1.3.vrm`** | Neutral official-VRoid anime female base; not a polished "character", but canonical donor face | README says 52 BlendShapes + auxiliary shapes and Perfect Sync support; local parse confirms 70 VRM BlendShapeGroups, 52/52 ARKit clip names, 124 unique raw morph target names | VRM 0.0 (`UniVRM-0.79.0`) | No formal LICENSE file. README grants "feel free to use it as source data to copy to other VRoid models." Embedded VRM meta: everyone, commercial allow, redistribution prohibited, violent/sexual allow. Base is VRoid sample-derived, subject to pixiv sample terms above | 23,297,820 B | <https://github.com/hinzka/52blendshapes-for-VRoid-face> |
| **`blender-vrm-perfect-sync` `female_model_perf_sync.vrm`** | Neutral VRoid anime female donor; clean donor for transfer, not a final branded face | Samples README says donor models carry all 52 ARKit shapes bound as VRM BlendShapeClips; local parse confirms 66 VRM BlendShapeGroups, 52/52 ARKit clips after stripping exporter prefix `BlendShape.`, 123 unique raw morph target names | VRM 0.0 (`saturday06_blender_vrm_exporter_experimental_2.34.1`) | Samples README: sample VRMs are CC BY 4.0, allowed users everyone, modification allowed, redistribution allowed, commercial use allowed, sexual/violent use disallowed, attribution required: `blender-vrm-perfect-sync sample donor` + `VRoid Studio / pixiv`. Embedded meta matches CC_BY/everyone/commercial allow/violent disallow/sexual disallow | 20,850,472 B | <https://github.com/elainyilanchen/blender-vrm-perfect-sync/tree/main/samples> |
| **AvatarSample_A パーフェクトシンク対応** | Cute-ish official VRoid sample girl, better as a recognizably anime face | VRoid Hub description: VRoid sample model made Perfect Sync compatible; VMagicMirror recommends this model to try Perfect Sync | VRM 0.x likely; not downloaded/inspected because VRoid Hub download requires pixiv sign-in | VRoid Hub flags observed in browser: avatar use YES, violent NO, sexual NO, corporate commercial YES, personal commercial YES, alterations YES, redistribution NO, credit unnecessary | Not published on public page | <https://hub.vroid.com/en/characters/2287322741607496883/models/1995551907338074831> |
| **PerfectSyncSample Female (hinzka on VRoid Hub)** | Same neutral female donor concept as hinzka GitHub | VRoid Hub description says stable-version VRoid Studio Perfect Sync sample; page links GitHub repo for VRM download | VRM 0.0 via GitHub file | VRoid Hub flags observed in browser: avatar use YES, violent NO, sexual NO, corporate commercial YES, personal commercial YES, alterations YES, redistribution NO, credit unnecessary. GitHub README has permissive-but-informal source-data grant | GitHub VRM: 23,297,820 B | <https://hub.vroid.com/en/characters/2509120546947008623/models/7388127166599376104> |
| **Heliana / ヘリアナ** | Cute sunflower-themed anime girl; strongest "cute girl" fit found | BOOTH page says 19 base expressions + 52 Perfect Sync morphs; includes VRM plus modification source data (`fbx`, `mb`, textures) | VRM; not downloaded/inspected because BOOTH free download redirects to sign-in from an unauthenticated request | Public BOOTH terms: basic use free, modification OK including clothes/textures/shapes, character-setting edits OK, credit optional, personal-use premise; commercial use requires contacting creator; redistribution/sale, self-claiming authorship, public-order-violating use prohibited | 34.5 MB zip | <https://booth.pm/ja/items/5581360> |
| **Niumu free Perfect Sync models (`しのっち`, `ぽす太`, `みやまる`)** | Cute/chibi low-poly original VRM characters; not all are anime-girl-coded | BOOTH titles mark Perfect Sync compatible; pages say free VRM models | VRM; not downloaded/inspected because BOOTH free download redirects to sign-in from an unauthenticated request | Public BOOTH terms: violence/sexual OK within public-order limits; corporate commercial NG; personal commercial NG; modification OK; redistribution NG except sharing URL/gift route; credit unnecessary | 5.01-6.88 MB zips | <https://booth.pm/ja/items/6862459>, <https://booth.pm/ja/items/7424576>, <https://booth.pm/ja/items/6867490> |

## Downloads and verification

`data/` is gitignored. I downloaded the two best no-auth, inspectable candidates from GitHub and wrote per-model `LICENSE-NOTES.md` files with source URL, timestamp, content type, size, SHA-256, license notes, and parse results.

| Local slug | File | Download source | License note | Verified rig count |
| --- | --- | --- | --- | --- |
| `data/avatar-models/hinzka-vroid-v110-female-perfectsync/` | `VRoid_V110_Female_v1.1.3.vrm` | <https://raw.githubusercontent.com/hinzka/52blendshapes-for-VRoid-face/main/VRoid_V110_Female_v1.1.3.vrm> | `data/avatar-models/hinzka-vroid-v110-female-perfectsync/LICENSE-NOTES.md` | 52/52 ARKit VRM BlendShapeGroups, 70 groups total, 124 unique raw morph target names |
| `data/avatar-models/blender-vrm-perfect-sync-female-donor/` | `female_model_perf_sync.vrm` | <https://raw.githubusercontent.com/elainyilanchen/blender-vrm-perfect-sync/main/samples/female_model_perf_sync.vrm> | `data/avatar-models/blender-vrm-perfect-sync-female-donor/LICENSE-NOTES.md` | 52/52 ARKit VRM BlendShapeGroups after stripping `BlendShape.` prefix, 66 groups total, 123 unique raw morph target names |

Inspection method: parsed each `.vrm` as a GLB container, read the JSON chunk, counted `extensions.VRM.blendShapeMaster.blendShapeGroups`, normalized the `blender-vrm-perfect-sync` exporter's `BlendShape.` prefix, and mapped clip binds back to `meshes[*].primitives[*].extras.targetNames`.

Sample verified clip-to-target bindings:

- Hinzka: `BrowInnerUp -> browInnerUp`, `BrowDownLeft -> browDownLeft`, `EyeBlinkLeft -> Fcl_EYE_Close_L`, `JawOpen -> jawOpen`, `MouthFunnel -> mouthFunnel`, `MouthSmileLeft -> mouthSmileLeft`, `TongueOut -> tongueOut`.
- Blender donor: `BlendShape.BrowInnerUp -> browInnerUp`, `BlendShape.BrowDownLeft -> browDownLeft`, `BlendShape.EyeBlinkLeft -> Fcl_EYE_Close_L`, `BlendShape.JawOpen -> jawOpen`, `BlendShape.MouthFunnel -> mouthFunnel`, `BlendShape.MouthSmileLeft -> mouthSmileLeft`, `BlendShape.TongueOut -> tongueOut`.

## License read

- **Cleanest legal download:** `blender-vrm-perfect-sync` female donor. It has explicit CC BY 4.0 terms in the sample README and embedded `CC_BY` metadata. CC BY 4.0 allows sharing and adaptation, including commercially, with attribution and change notices: <https://creativecommons.org/licenses/by/4.0/>.
- **Best canonical Perfect Sync naming:** hinzka female. It has exact ARKit clip names without exporter prefix and is the community reference cited by VMagicMirror and HANA_Tool, but the license is informal: README permission plus VRM metadata, not a formal SPDX license.
- **Best cute-anime-girl lead:** Heliana. It publicly permits local personal use and modification and claims 52 Perfect Sync morphs, but the BOOTH file download is sign-in-gated, so I did not download it under the no-auth constraint. If Arthur is willing to sign in manually or contact the creator for explicit permission, it is the closest visual fit.

## Recommendation

Use **`hinzka-vroid-v110-female-perfectsync` as the immediate primary high-fidelity face**: it is no-auth, locally verified at 52/52 ARKit clips with exact Perfect Sync names, and is the canonical donor referenced by VMagicMirror/HANA_Tool; keep the CC BY `blender-vrm-perfect-sync` donor as the cleaner-license fallback/transfer source.

For the final cute face, either transfer this rig onto Alicia/custom VRoid with `blender-vrm-perfect-sync`, or manually retrieve/contact for Heliana once auth or explicit permission is acceptable.
