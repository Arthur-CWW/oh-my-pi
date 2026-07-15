# Reference Avatar Pipeline — Production Lane

Status: **blessed**. First resumable, gate-verified production pipeline for VRoid-topology-compatible Perfect Sync avatar generation.

## Production lane

The production lane exploits the proven fact that VRoid-family topology allows lossless 52/52 ARKit transfer from a known Perfect Sync donor. KAMATTE demonstrated 0/52 to 52/52 via this path. The lane is fully automatable with existing tooling.

### Stages

| Stage | What | Tool |
|-------|------|------|
| S0 source-validation | GLB magic + VRM extension presence, license notes exist, proportions + reconstruction-report schemaVersion 2 status ok, matching reconstructionId | inline Bun validation |
| S1 face-rig-transfer | 52-channel ARKit transfer from donor to target | `scripts/blender/face-rig-transfer.ts` (calls Blender 5 headless via `packages/blender-cli`) |
| S2 identity-bake | Corpus-derived facial proportions at three strengths, select best 52/52 variant | `scripts/face-identity/bake-variants.ts` (calls Blender 5 headless) |
| S3 coverage-gates | Consume structural receipts; derive expression gates; load the staged VRM with `three` + `@pixiv/three-vrm` for humanoid and deterministic stress-pose gates | `scripts/avatar-pipeline/vrm-probe.ts` |

### Resume semantics

Each stage reads `manifest.json` on entry. If status is `completed` and **all recorded input AND output SHA-256 hashes still match**, skip. If `failed` or hashes mismatch, re-run from that stage. Stages are strictly ordered; no stage runs until all predecessors show `completed`. S3 records the staged output VRM itself as an input, so a changed model invalidates the runtime gates.

### Verdict rules

Gates are tri-state (`passed` / `failed` / `pending`):

- `accepted`: every stage completed and every gate `passed`.
- `rejected`: a stage failed OR any gate observed a real `failed` result.
- `pending`: no failure observed, but a stage is incomplete or a gate has no direct current evidence.

The automated humanoid and motion-stress probes always produce terminal evidence: `passed` when the staged VRM has all 15 required VRM 1.0 humanoid nodes with finite rest transforms and all bounded stress poses remain finite and bilaterally active; `failed` for a violated invariant or probe error. Missing staged VRM fails S3 rather than leaving either gate pending. Observed proof (2026-07-15): the KAMATTE rerun resumed S0–S2, evaluated S3 as 4 passed / 0 pending, and finished `accepted`; humanoid observed `resolved=15/15; missing=none`, motion observed `poses=arms-raised,arms-crossed,spine-twist,head-yaw-left,head-yaw-right,hip-knee-flexion; maxDisplacement=0.601100; violations=none`.

### Rerun command

```sh
bun scripts/avatar-pipeline/run-production.ts \
  --asset-id kamatte-ps-sico \
  --base data/avatar-models/kizuna-ai-kamatte-vrm1/Kizuna_AI_KAMATTE_v2.vrm \
  --donor data/avatar-models/hinzka-vroid-v110-female-perfectsync/VRoid_V110_Female_v1.1.3.vrm \
  --proportions data/avatar-models/kamatte-ps-sico/proportions.json \
  --license-notes data/avatar-models/kizuna-ai-kamatte-vrm1/LICENSE-NOTES.md \
  --blender /opt/homebrew/bin/blender
```

Pipeline work root: `data/avatar-models/<assetId>/pipeline/`

### Manifest schema

`avatar-pipeline-manifest-v1` — strict decode at every JSON boundary. Per-stage status, timestamps, input/output SHA-256 + bytes, gate results with threshold/observed/detail, error on failure, blender manifest path. Atomic writes via write-to-tmp + rename.

### Proof card

Machine-readable review artifact at `pipeline/output/proof-card.json`. Sections: appearance, face-rig (channel counts, transfer metrics path, gates), skinning, motion-stress, catalog-review (gate summary, verdict), provenance, license summary. License carries KAMATTE private/non-commercial/no-redistribution, redistribution_allowed: false.

### Per-stage durable logs

Written to `pipeline/logs/<stage-name>.log` and `pipeline/logs/<stage>-subprocess.log`. Nonzero subprocess exit persists the failed manifest before propagating.

## Challenger lane — explicitly not implemented

The challenger lane (multiview concept sheet to high-poly mesh to agent-authored low-poly to UV/cage bake to auto-rig to VRM conversion to expression transfer) fails closed and is **explicitly not implemented** where tooling is absent:

- **C0 concept-sheet**: requires image generation provider spend and human art direction. No provider wired.
- **C1 high-poly generation**: Hunyuan3D-2MV / TRELLIS are CUDA-first (Ubuntu GPU). Local Mac high-poly generation is not proven.
- **C2 agent-authored low-poly**: hardest unsolved step. No published prompt/context for teaching a coding model to author mesh in Blender Python. The Eidoverse tweets demonstrate feasibility but no working prototype exists.
- **C3 UV/cage bake**: standard Blender ops but no `blender-cli` integration written.
- **C4 auto-rig**: Mixamo has no public API (web GUI only). UniRig is research-grade.
- **C5 VRM conversion**: VRM Add-on scripting exists but bone mapping for non-VRoid skeletons needs manual work.
- **C6 face-topology graft**: head grafting between arbitrary and VRoid topology is non-trivial. Not implemented.

Each missing stage is a fail-closed gate. No generated high-poly mesh enters the catalog without passing every gate the production lane requires. Generated high-poly is reference-only, never accepted topology.

## License and provenance

All pipeline outputs carry provenance tracing back to source assets:
- **KAMATTE base**: Kizuna AI Inc., private/non-commercial/no-redistribution.
- **Hinzka donor**: VN3 License (naming-convention-only use for transfer; geometry not incorporated when target has native morphs).
- **Identity corpus**: 190 accepted clips, 488 selected frames, reconstructionId-linked.

Pipeline outputs are local working files. Do not commit, redistribute, publish, or bundle.
