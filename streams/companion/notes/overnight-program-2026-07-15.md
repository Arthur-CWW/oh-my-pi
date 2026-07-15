# Overnight program — 2026-07-15 (living doc)

Orchestrator anchor: survives compactions. Update at every wave boundary (scribe-delegated). Boot context for any resumer: `streams/companion/HANDOFF-BEHAVIOR.md` → this doc.

## Operating rules (Arthur-set tonight)
- Zero input from Arthur; taste forks → Xanadu question entries.
- Delegate maximally; orchestrator context stays lean; this doc is the state of record.
- Every wave: validation pipeline → git checkpoint → update this doc → Xanadu card if user-visible.
- Live server companion.localhost:1355 stays up (tmux `companion-stack`); brief supervised restarts only when shipping; sidecar in tmux `motion-oracle`.
- Routing: bounded → Luna xhigh; design/architecture/synthesis → Sol medium. Never Terra, never Fable spawns. Provider aborts are common tonight: on abort, revive in place via irc with disk-state summary; after 2 dead revivals respawn fresh with a state-grounded packet. Revived agents often park silently — verify DISK STATE, not reports.

## Validation pipeline (every checkpoint)
1. `cd apps/ai-companion-rtc && bunx tsc --noEmit`
2. `bun run build:lab && bun run build:vrm`
3. `bun test` — full suite; baseline floor 466 pass / 0 fail (raise floor as waves land, never lower)
4. Browser QA for user-visible changes (subagent, private instance, ports 4911+; NEVER restart 1355 from a worker)
5. Nested commit `apps/ai-companion-rtc` (orchestrator only); outer repo: commit ONLY owned paths (scripts/avatar-pipeline, streams/companion/notes, scripts/gpu-queue.ts) — outer tree has other sessions' dirty files incl. a foreign package.json `pi`-block edit: never `git add -A` at root.
- Script: `apps/ai-companion-rtc/scripts/validate.ts` (being built) — gates + summary JSON to `local/validation/`, `--checkpoint "msg"` mode commits nested on green.

## Checkpoint log
- `ecd688b`→`ce96472`→`7fea892`→`b376e57` (arbiter/debug-stage/3D/recording) →`a03fbe4` (compare player) →`68f82b8` (gpu converter) →`a843fc9` (solo-swap+resizable) →`d0bca14` (center split + dejank). Outer: `bb5d63c09` (avatar gates), `7e6b99b78`/`0804b7db2` (handoff), `43385ea27`/`2fadbf6ef`/`c9e51cfb1` (evidence card), `543a1b91c` (gpu note), gpu-queue note commit.

## Wave status
### Wave 1 — RUNNING (spawned ~15:2x)
| Agent | Slice | State |
|---|---|---|
| Body3dStability | body3d bone-stability analysis → `data/apple-vision-tracks/body3d-stability.json` + note | running |
| ReplayV3Cutover | default replay lane → provider tracks (gpu>vision>v2), hands, dejank filter; Xanadu question re v2 retirement | running |
| CalibrationWeights | per-joint arbiter calibration from comparison-summary → `data/motion-calibration/weights.json` + `public/motion-calibration.ts` | running |
| QATriageSweep | P2/P3 sweep + browser-error→errors.log wiring → `notes/qa-triage-2026-07-15.md` | running |
| FilterParamTuning | One-Euro/damping grid on ~20 stratified clips → `notes/motion-filter-tuning.md`; owns track-motion-filter.ts | running |
File ownership tonight: pose-transfer.ts+provider-tracks.ts=ReplayV3Cutover; track-motion-filter.ts=FilterParamTuning; capture-arbiter calibration seam=CalibrationWeights; controls/panels/CSS/docs=QATriageSweep.

### Wave 2 — after wave 1 gates
- 3D retargeter prototype (Sol) — scope from Body3dStability verdict (drive rotations / depth prior / not-ready).
- Overnight soak: live-stack watcher (synthetic replay cycling via debug routes, lab-state sampling, errors.log diffing) in tmux, several hours; morning soak report.
- Full browser QA pass over wave-1 ships.

### Wave 3+ backlog (no-input, pre-approved shape)
- Library quality badges: per-clip scores (availability/jerk/agreement from manifests+comparison) as badges in the 281-clip library; data JSON + small UI.
- GPU-queue → /lab pipeline monitor: surface desktop queue status in the existing SSE pipeline pane (`src/job-queue.ts` seam); submit gpu-pose-batch from lab.
- Queue job kinds prep for licensed lanes: `gvhmr-mesh` + `wilor-3d` kinds that fail-closed with exact missing-file messages, so Arthur's MPI file-drop makes them instantly runnable.
- v2 track regeneration pipeline (prep only; flip gated on Arthur's Xanadu answer).
- TASKS.md + stream notes retirement pass (epistemics: flag dead rows; INDEX freshness).
- Test-coverage gaps from reviewer transcripts (arbiter production paths, lab-state seams) — qa agent.
- /lab bundle audit (2.73MB): measure, split obvious islands if cheap; no restyle.

### Wave 4 — model/rig GENERATION pipeline (DIRECTION-GATED, tail item, Arthur 2026-07-15 night)
Arthur's ask: infra for generating our own 3D models + CUSTOM rig generation + validation ("SkyeSharkie" referenced in earlier companion chats — recon where; connects to the reference-avatar-pipeline challenger lane: multiview→highpoly→agent-lowpoly, currently documented fail-closed, not implemented). Explicitly: general direction should be checked by Arthur when he wakes.
Tonight's scope is PREP ONLY, run after waves 1-3 and only with juice left: (a) recon SkyeSharkie references + prior chats/notes into a direction brief; (b) survey the generation-stack options against our constraints (VRoid-topology Perfect Sync transfer lane as production, generated-mesh challenger, licensing, GPU-queue fit); (c) draft the pipeline + validation-gate design as an extension of scripts/avatar-pipeline (tri-state gates, proof cards); (d) post a Xanadu QUESTION with the proposed direction + forks for his morning. NO heavy implementation before his direction check.

### Orchestration conservatism (Arthur, tonight)
Do not multiply unrelated substreams in parallel. One wave in flight at a time (current wave-1 concurrency is the ceiling); waves run in order; new substreams queue behind, not beside.

## Blocked on Arthur (documented, not tonight)
- 2-min deliberate calibration pass (runbook docs/motion-capture-comparison.md).
- MPI registration: SMPL+SMPLX+FLAME+MANO → unlocks GVHMR mesh-gen + WiLoR 3D via gpu-queue.
- Xanadu question pending: v2 replay retirement.

## Key seams (for resumers)
- Tracks: `data/gpu-pose-tracks/*.json` (281, full-frame, hands), `data/apple-vision-tracks/*.jsonl` (281, 2D+3D), `data/body-tracks/*.json` (73, legacy v2), comparison at `data/apple-vision-tracks/comparison-summary.json`.
- Arbiter sole capture writer `public/capture-arbiter.ts`; dejank `public/track-motion-filter.ts`; compare player `public/lab/provider-compare/`; debug stage `public/lab/motion-debug/`; resizable `public/lab/resizable.tsx`.
- Desktop: gpu-queue daemon tmux `gpu-queue` (`~/projects/model-bench/queue/`, Mac CLI `scripts/gpu-queue.ts`); fish shell — always `bash -lc`; no tee pipelines (T-state trap).
