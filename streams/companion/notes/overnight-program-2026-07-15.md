# Overnight program — 2026-07-15 (living doc)

Orchestrator anchor: survives compactions. Update at every wave boundary (scribe-delegated). Boot context for any resumer: `streams/companion/HANDOFF-BEHAVIOR.md` → this doc.

## Operating rules (Arthur-set tonight)
- Zero input from Arthur; taste forks → Xanadu question entries.
- Delegate maximally; orchestrator context stays lean; this doc is the state of record.
- Every wave: validation pipeline → git checkpoint → update this doc → Xanadu card if user-visible.
- Live server companion.localhost:1355 stays up (tmux `companion-stack`); brief supervised restarts only when shipping; sidecar in tmux `motion-oracle`.
- Routing: bounded → Luna xhigh; design/architecture/synthesis → Sol medium. Never Terra, never Fable spawns. Provider aborts are common tonight: on abort, revive in place via irc with disk-state summary; after 2 dead revivals respawn fresh with a state-grounded packet. Revived agents often park silently — verify DISK STATE, not reports.

## Validation pipeline (every checkpoint)
1. From `apps/ai-companion-rtc`, run `bun run validate`; this invokes `scripts/validate.ts` and runs the gates sequentially: `bunx tsc --noEmit`, `bun run build:lab`, `bun run build:vrm`, then `bun test`.
2. The full-suite test gate must report 0 failures and at least the floor in `apps/ai-companion-rtc/scripts/validate-floor.json` (`minPass`, currently 466); the floor only ratchets upward.
3. Every run writes `apps/ai-companion-rtc/local/validation/<timestamp>.json` plus complete per-gate logs under `apps/ai-companion-rtc/local/validation/logs/`.
4. `bun run validate --fast` runs only typecheck and tests for mid-wave sanity; `--fast` cannot be combined with `--checkpoint`.
5. `bun run validate --checkpoint "msg"` runs every gate, then commits the nested repo on green and prints the short SHA; red runs never commit.
6. Browser QA for user-visible changes (subagent, private instance, ports 4911+; NEVER restart 1355 from a worker).
7. Nested commit `apps/ai-companion-rtc` (orchestrator only); outer repo: commit ONLY owned paths (scripts/avatar-pipeline, streams/companion/notes, scripts/gpu-queue.ts) — outer tree has other sessions' dirty files incl. a foreign package.json `pi`-block edit: never `git add -A` at root.

## Checkpoint log
- `ecd688b`→`ce96472`→`7fea892`→`b376e57` (arbiter/debug-stage/3D/recording) →`a03fbe4` (compare player) →`68f82b8` (gpu converter) →`a843fc9` (solo-swap+resizable) →`d0bca14` (center split + dejank). Outer: `bb5d63c09` (avatar gates), `7e6b99b78`/`0804b7db2` (handoff), `43385ea27`/`2fadbf6ef`/`c9e51cfb1` (evidence card), `543a1b91c` (gpu note), gpu-queue note commit.

## Wave status
### Wave 1 — DONE (checkpoint nested `4901a8b`, outer `666361c4c`; suite floor now 473)
| Slice | Outcome |
|---|---|
| Body3dStability | 281 clips analyzed; bone CVs ~1e-7 (Apple emits a fixed parametric skeleton — trivially stable), 0 depth flips, BUT 13.1% of frame transitions have >12m/s joint velocity (ankles/knees teleport). **Verdict: depth prior for 2D, NOT direct rotation driver.** `data/apple-vision-tracks/body3d-stability.json`, note body3d-stability.md |
| ReplayV3Cutover | Default replay = provider tracks (gpu>vision>v2 fallback) through interp+One-Euro→PoseGuard→arbiter, hands via Hand-21→HandGuard; source telemetry + smoothing toggle propagate. Xanadu question f2114ebc (retire v2?). 473/0. GAP: browser E2E evidence deferred to wave-2 QA |
| CalibrationWeights | weights.json (v1-p95-availability): apple arms .805/torso .854/head .908/legs .679; mediapipe .843/.899/.958/.660; hands neutral 1.0 (no hand stats — seam documented). Arbiter multiplies effective confidence + publishes in reason strings |
| QATriageSweep | aria-labels, stale fallback text, browser window.onerror→errors.log wiring (proven), doc path cleanup. Note qa-triage-2026-07-15.md |
| FilterParamTuning | Strict-feasible winner 0.45Hz/beta10/hipDamping1.5: median jerk −57.5% (prior −52.1%, +5.44pp), peak loss 9.1%, lag 0ms; constants updated w/ provenance. Note motion-filter-tuning.md |
| ValidatePipeline | `bun scripts/validate.ts` 4 gates + ratchet floor (473) + `--checkpoint` commit mode; summaries in local/validation/ |
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
