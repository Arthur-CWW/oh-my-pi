# HANDOFF — Companion model / rig generation

## Boot chain

Boot: `docs/fable/charter.md` → `streams/companion/GOAL.md` → `streams/companion/notes/model-gen-direction.md` → `streams/companion/notes/reference-avatar-pipeline.md` → this file. Then act.

This is the generation-only direction thread. Xanadu question `0357400a-c046-4da1-a432-cc1be7edb3cd` is pending Arthur's four forks; **first action: Arthur answers the forks, then this thread executes that direction.**

## Ground truth now

- **Production is accepted:** KAMATTE completed S0 source validation → S1 52-channel transfer → S2 identity bake → S3 runtime/coverage, with 4 passed / 0 pending and verdict `accepted`. Gates are tri-state (`passed | failed | pending`); acceptance requires every stage complete and every gate passed. See `streams/companion/notes/reference-avatar-pipeline.md`.
- **Resume is hash-validated, not a content-addressed store:** completed stages skip only while every recorded input and output SHA-256 still matches; mismatch or failure reruns that stage, and predecessors are mandatory. Generated-stage fingerprints/content-hashed receipts are the proposed extension in `streams/companion/notes/model-gen-direction.md`.
- **Proof:** machine-readable `data/avatar-models/<assetId>/pipeline/output/proof-card.json`, durable stage logs, provenance, and rights. KAMATTE rerun:

```bash
bun scripts/avatar-pipeline/run-production.ts --asset-id kamatte-ps-sico \
  --base data/avatar-models/kizuna-ai-kamatte-vrm1/Kizuna_AI_KAMATTE_v2.vrm \
  --donor data/avatar-models/hinzka-vroid-v110-female-perfectsync/VRoid_V110_Female_v1.1.3.vrm \
  --proportions data/avatar-models/kamatte-ps-sico/proportions.json \
  --license-notes data/avatar-models/kizuna-ai-kamatte-vrm1/LICENSE-NOTES.md \
  --blender /opt/homebrew/bin/blender
```

- **Donors:** `data/avatar-models/hinzka-vroid-v110-female-perfectsync/` and `data/avatar-models/blender-vrm-perfect-sync-female-donor/` are locally verified 52/52. The first has an informal source-data grant and prohibits redistribution; the second is CC BY 4.0. Evidence: `streams/companion/notes/perfect-sync-models.md` (**evidence-of-record** in `notes/INDEX.md`).
- **Challenger is documentation, not implementation:** concept → generated high-poly reference → authored/template low-poly → UV/cage bake → rig → VRM → expressions must fail closed at every absent stage. Generated high-poly is never accepted topology. Contract: `streams/companion/notes/reference-avatar-pipeline.md`; gate design: `streams/companion/notes/model-gen-direction.md`.
- **GPU is ready:** durable single-runner queue at desktop `~/projects/model-bench/queue/`; current kinds are `gpu-pose-batch`, `wilor-3d`, `gvhmr-mesh`, and `generic`. RTX 3090 capacity reference: the 281-clip RTMPose run measured 41.8 inference fps (≈42 fps), 36.5 aggregate fps; see `streams/companion/notes/gpu-pose-batch.md`. Queue contract and preflight: `streams/companion/notes/gpu-queue.md`.
- **Licensed blockers — no substitutes:**
  - MANO: `/home/arthur/projects/model-bench/licensed/MANO_RIGHT.pkl`
  - SMPL: `/home/arthur/projects/GVHMR/inputs/checkpoints/body_models/smpl/SMPL_NEUTRAL.pkl`
  - SMPL-X: `/home/arthur/projects/GVHMR/inputs/checkpoints/body_models/smplx/SMPLX_NEUTRAL.npz`
  - FLAME is still part of Arthur's registration session for the separate identity lane; GVHMR's demo config does not consume it.

```bash
ssh -x -o BatchMode=yes desktop "bash -lc '~/projects/model-bench/queue/preflight-licensed.sh'"
```

## Arthur's four forks

1. **Lane priority:** template-fit production extension first vs custom auto-rig first. **Recommendation:** template-fit first; keep TokenRig/SkinTokens behind canonical mapping as challenger, with UniRig only as baseline.
2. **“SkyeSharkie” referent:** Eidoverse/direct-Blender mesh authoring vs earlier hand-modeled `claudes-body`. **Recommendation:** treat Eidoverse/direct-Blender as the intended referent, but do not implement until Arthur confirms; disk evidence cannot prove intent.
3. **Style target:** Sico-derived narrow/flat or boyish, sharp-eyed, hair-silhouette-led original register vs another explicit register. **Recommendation:** start with that register, using Ellen/Hu Tao/March only as private casting references; copy no face, costume, logo, prop, or biometric likeness. Pointers: `notes/character-casting.md`, `notes/character-forge.md` (both **live** in `notes/INDEX.md`).
4. **Experiment budget:** provider spend plus count/time limit for RTX 3090 runs. **Recommendation:** Arthur sets an explicit bounded budget before downloads or runs; use CharacterGen first only after a 3090 viability smoke, with TripoSR as the permissive official 6 GB baseline. No implicit spend and no `generic` queue kind for accepted artifacts.

## First milestone

One original A-pose generated reference → pinned VRoid-template fit → existing Perfect Sync donor/rig transfer → identity bake when applicable → all generated-asset gates → proof card; no catalog entry unless accepted.

Required new non-empty gates: `generator-license-approved`, `generation-receipt-complete`, `topology-template-preserved`, `geometry-sane`, `uv-valid`, `texture-bake-valid`, `rig-weight-valid`, `blendshape-transfer-coverage`, `generated-motion-deformation`, `identity-bake-valid`, `review-sheet-complete`. Exact evidence and thresholds: `streams/companion/notes/model-gen-direction.md`.

Bounded estimate: **5–8 engineer-days** for one manually art-directed proof using existing Blender/transfer infrastructure; **8–15 engineer-days** to make the provider-neutral authored-low-poly/UV/bake loop reliably resumable. These are planning estimates, not measurements.

## Ownership boundary

- **MODELGEN owns:** generation experiments on the desktop GPU through the queue; template-fit and challenger-lane implementation; `scripts/avatar-pipeline/` extensions for generated assets (add gates/stages, never weaken existing ones); new `data/avatar-models/<assetId>/` directories; model-gen notes; and `gvhmr-mesh` / `wilor-3d` execution once Arthur's licensed files land.
- **BEHAVIOR keeps:** `apps/ai-companion-rtc` runtime—Lab, capture, arbiter, replay, oracles—plus live-stack operations, the Sico track corpus, and motion evidence.
- **Shared and frozen for both:** `apps/ai-companion-rtc/docs/expressive-stack.md` and L0 as sole avatar writer; KAMATTE production-pipeline semantics (extend, do not fork); both verified 52/52 Perfect Sync donors; GPU-queue conventions (`fish` host → `bash -lc`, no `tee`, one job at a time—the queue serializes cross-thread GPU use); tri-state/fail-closed validation, proof cards, and Xanadu evidence; no licensed-asset substitutes; Mac is realtime-only.
- Coordinate over the OMP IRC bus by session name before touching shared ground. MODELGEN delivers the generated asset plus proof card; loading it into `/lab`, wiring it, and eyeballing it are BEHAVIOR-thread acceptance steps.

## Continuation order

1. Get Arthur's four answers on Xanadu question `0357400a-c046-4da1-a432-cc1be7edb3cd`; freeze lane, referent, style, and budget in the direction note.
2. Extend `scripts/avatar-pipeline/` with lane-aware manifest/proof-card semantics, non-empty gate registry, fingerprints, stages, and the exact generated gates. Extend production; never fork or weaken it.
3. Register explicit fail-closed generation queue kinds only for pinned installs/checkpoints/license receipts; smoke the selected generator on the 3090.
4. Produce one reference, fit the pinned template, transfer the rig, run every gate, and emit the proof card. Pending is not success.
5. Deliver the asset and proof card to BEHAVIOR for `/lab` runtime acceptance; catalog only after both acceptance layers pass.

## Operational lessons that transfer

- **Validate, then checkpoint:** run focused gates first; for Companion runtime changes the canonical sequence is `cd apps/ai-companion-rtc && bun run validate`, then orchestrator-only `bun run validate --checkpoint "msg"`. Red never checkpoints. Keep outer commits to owned paths; never `git add -A`.
- **Provider aborts:** revive the same agent over IRC with a disk-state summary; after two dead revivals, respawn with a state-grounded packet. Trust disk state, not a silent parked report.
- **Desktop traps:** remote login shell is fish; always wrap commands in `bash -lc`. Never pipe GPU work through `tee` (T-state trap); queue logs via direct stdout/stderr redirection. Submit through the queue, which already serializes jobs:

```bash
bun scripts/gpu-queue.ts submit --kind wilor-3d --frames-dir /home/arthur/projects/model-bench/data/frames/<frames-id> --output-dir /home/arthur/projects/model-bench/results/wilor/<frames-id>
bun scripts/gpu-queue.ts submit --kind gvhmr-mesh --video /home/arthur/projects/model-bench/data/<clip>.mp4 --output-dir /home/arthur/projects/GVHMR/outputs/demo/<clip>
```

- **Xanadu:** unresolved taste/direction forks are `kind: question` with `needsInput`; completed measured evidence is `kind: proof`. Keep summaries short; use `cd apps/xanadu && bun run post -- ...` and `--summary-file` for longer text. Never post a proof before gates and proof-card evidence exist.
