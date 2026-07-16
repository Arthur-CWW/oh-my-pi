# Face rig upgrade pipeline

## What actually failed

KAMATTE was not missing facial geometry. Its `face_geo` mesh already contained all 52 ARKit morphs under names such as `facial_bs.jawOpen`; its VRM 1.0 expression manifest exposed none of them. The browser profile resolver normalizes expression names, then requires the exact 52 names listed by `public/rig-profiles.ts`. The original therefore classified as `none` even though useful target-native deltas were present.

The upgrade pipeline first looks for vendor-prefixed target-native ARKit keys and creates lossless canonical aliases. Only missing channels use the topology-mismatch fallback: normalized nearest-surface binding to the Perfect Sync donor with barycentric delta transfer. This avoids damaging a better target-native rig while retaining a repeatable donor-to-target path for Ellen and other models.

## Reproducible Blender 5 headless recipe

Verified locally with Blender 5.0.1 at `/opt/homebrew/bin/blender`.

```sh
blender --version
blender --command extension repo-list
blender --command extension install-file -r user_default -e \
  data/avatar-models/zzz-ellen-official-pmx/conversion-inputs/VRM_Addon_for_Blender-Extension-4_4_0.zip
bun scripts/blender/face-rig-transfer.ts
```

The Bun runner reuses `packages/blender-cli` for version/add-on preflight, deterministic seed/environment, timeout handling, progress/checkpoint protocol, and a run manifest. It requires the installed module `bl_ext.user_default.vrm`, invokes `scripts/blender/face-rig-transfer.py`, writes `data/avatar-models/kamatte-perfectsync/kamatte-ps.vrm`, and copies it to `apps/ai-companion-rtc/public/models/kamatte-ps.vrm`.

Useful tuning flags are `--max-distance` (normalized donor-surface rejection distance) and `--gain` (fallback delta scale). KAMATTE does not use these fallback parameters because all 52 target-native sources resolve. Every channel still records `method`, source key, maximum vertex delta, RMS affected delta, affected-vertex count, and achieved amplitude in `transfer-metrics.json`.

The script imports donor and target separately, selects the donor mesh by ARKit coverage, selects the target face mesh by shape-key inventory, registers 52 VRM 1.0 custom expressions through the VRM add-on's ARKit operator, removes donor scene objects, and exports only the target hierarchy. A channel with no moved vertices remains honestly dead; the script does not fabricate motion.

## Iterate → measure

Build/restart the app before browser measurement so `public/dist/vrm-body.js` is current, then run:

```sh
bun add --no-save @playwright/test@1.61.1
bunx playwright install chromium
bunx playwright test scripts/blender/face-rig-probe.spec.ts --reporter=line --workers=1
```

The probe is independent of the lab UI. It creates two `VrmBodyHandle`s directly from the browser runtime bundle, sends each of the canonical 52 capture-lane channels at 1.0, reads the runtime expression catalog target, and saves the matrices and replay screenshot under `local/companion-face-rig/`.

Observed 2026-07-14:

| Iteration | Model | Resolver coverage | Channels at amplitude ≥ 0.3 |
|---|---|---:|---:|
| reference | canonical Hinzka donor | complete | 52/52 |
| 1 | original KAMATTE | none | 0/52 |
| 2 | KAMATTE Perfect Sync | complete | 52/52 |

Evidence:

- `coverage-donor-reference.json`
- `coverage-iteration-1-baseline.json`
- `coverage-iteration-2-converted.json`
- `coverage-summary.txt`
- `kamatte-face-replay-side-by-side.png`

The replay uses the same `mouthSmileLeft`, `mouthSmileRight`, `jawOpen`, and `browInnerUp` capture frame on both models. The original remains nearly closed; the converted model visibly opens and smiles without visible mesh corruption. For a future fallback transfer, change one binding parameter at a time, preserve each matrix as a numbered iteration, inspect dead/low-amplitude channels and geometric metrics together, and accept only an improvement in both runtime coverage and visible deformation.

## When Unity + HANA_Tool is better

Use Unity manually when the target has no reusable ARKit keys and Blender's normalized proximity transfer produces lip seams, eyelid penetration, asymmetric brows, or tongue artifacts. HANA_Tool's authored Perfect Sync workflow is preferable when its supported VRoid mesh correspondence exists.

1. Create a Unity project compatible with the target VRM/UniVRM version.
2. Import UniVRM, HANA_Tool, the canonical Hinzka donor, and the target under their recorded licenses.
3. Duplicate the target asset; never modify the only source copy.
4. In HANA_Tool, select the target face mesh and run the Perfect Sync/ARKit clip generation workflow, using the donor/profile only as the naming reference.
5. Inspect all 52 sliders at 1.0, especially paired eyelids, mouth close versus jaw open, funnel/pucker, cheek puff, and tongue out. Correct clipping or bad masks before export.
6. Register the exact lower-camel Perfect Sync names as VRM custom expressions at weight 1.0 and export VRM 1.0.
7. Put the local-only export in a new data directory, copy it to `public/models`, then run the same Playwright matrix and replay comparison. Do not accept Unity inspector coverage as runtime proof.

Unity automation is intentionally not part of this wave.

## Ellen after PMX → VRM

The staged inputs are `mmd_tools-v4.5.13-bl4.2.zip` and VRM Add-on 4.4.0. Convert Ellen's PMX to a clean VRM 1.0 first: import with mmd_tools, resolve texture paths, apply/verify transforms, map the humanoid skeleton, preserve facial morphs, set VRM metadata/license fields, and export a neutral VRM. Validate that neutral conversion independently before rig transfer.

Then pass Ellen's VRM as `--target` to the Bun runner and use an Ellen-specific output directory/name. Existing recognizable ARKit keys will alias; the rest will use donor proximity binding. Expect the first fallback iteration to need `--max-distance`/`--gain` tuning, and use the per-channel affected-vertex and delta metrics to distinguish dead binding from a small but valid expression. If eyelids/lips remain structurally wrong after two measured parameter iterations, switch to the Unity + HANA_Tool recipe rather than hiding the defects with higher gain.

## Queue registration seam

`face-rig-transfer` was deliberately deferred because BatchPipeline owned the queue files. The exact seam is:

- `apps/ai-companion-rtc/src/job-queue.ts`: add the kind to `BuiltinJobKind`, then add a handler in exported `createBuiltinJobRegistry(options: BuiltinJobRegistryOptions): JobKindRegistry`.
- The handler receives `JobRunContext` `{ job, request, workerIndex, updateProgress, signal }`; spawn the Bun runner through injected `options.runProcess` and propagate abort.
- `apps/ai-companion-rtc/src/server.ts`: whitelist `face-rig-transfer` in POST `/api/jobs` validation.

Do not bypass this registry with a one-off server process. Queue inputs should be donor, target, output directory, max distance, and gain; artifacts should expose the Blender manifest, VRM, transfer metrics, and browser coverage matrix.

## Licensing

The derived KAMATTE rig is local private, non-commercial use only and must not be redistributed. See `data/avatar-models/kamatte-perfectsync/LICENSE-NOTES.md`. The public-directory copy is only a local runtime working file; `public` does not imply permission to publish it.
