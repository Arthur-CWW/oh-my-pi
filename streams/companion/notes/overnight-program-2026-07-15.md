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
### Wave 2 — DONE (checkpoint nested `3970e39`; floor 479)
- DepthPrior3D: `public/depth-prior.ts` sign-only bend/fore-aft hints from body3d, gated (12m/s velocity, symmetry, availability, 150ms alignment); fail-open to 2D; toggle default-ON; 10/10 stable clips no-regression; 479/0.
- Filter constants FINAL: 0.45Hz / beta **1** / hip 1.5 — RetargetDejank's post-guard basis superseded FilterParamTuning's pre-guard beta 10 (orchestrator ruling; provenance in file + tuning-note addendum). Guarded jerk 105.9→77.5 (−26.8%).
- OvernightSoak: watcher LIVE in tmux `soak-watch` (5-min cycles: both replays, lab-state, RSS, UDP lanes, errors.log diff → local/soak/soak-2026-07-15.jsonl); reporter `scripts/soak-report.ts`; first 2 cycles healthy, RSS flat, soak even caught QA's synthetic error line (wiring proven end-to-end).
- Wave1BrowserQA: replay-v3 E2E gap closed (GPU body+fingers, source indicator, smoothing toggle all pass); calibration string live in browser arbiter (0.840048); PARTIAL: /api/debug/lab-state showed a stale no-eligible-offer reason during replay (browser-side live — likely snapshot cadence, triage in wave 3); resize-persistence/Space-pause partial due browser-tool limits (verified earlier waves).

### Wave 3 — DONE (checkpoint nested `d593c76`, outer `53d9ffc73`; floor 489)
- LibraryBadges: `data/clip-quality/quality.json` (281 rows; formula in scripts/derive-clip-quality.ts header; gpu rates saturate by design), `/api/lab/clip-quality` route, tier dot + hands glyph + tooltip in virtualized library (agent hit request cap post-completion; work validated green).
- QueueMonitor: desktop gpu-queue surfaced read-only in the /lab pipeline monitor (60s ssh poller, unreachable degradation, SSE `gpu-queue` event); QA screenshots local/queue-monitor-qa/.
- LicensedKinds: `wilor-3d` + `gvhmr-mesh` queue kinds fail-closed with exact missing-file paths (proven via real jobs, exit 3); drop location `desktop:~/projects/model-bench/licensed/` + `queue/preflight-licensed.sh` one-command checklist; FLAME confirmed NOT required by GVHMR demo config. Mac CLI submits both kinds.
- LedgerRetirement: TASKS.md ID-collision annotations (2 unverified, 1 retired), notes INDEX.md covering all 42 notes, HANDOFF replay-default correction.
- StaleReasonFix: heartbeat now re-samples live `__captureArbiterState` per cycle (root cause: cached accessor copy); seam test; endpoint reflects lane ownership within one heartbeat.
- Bonus (RetargetDejank final act): compare-drive body had been BYPASSING PoseGuard — now unified through the production ProviderReplayPipeline in both paths; duplicate filter code deleted.

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
