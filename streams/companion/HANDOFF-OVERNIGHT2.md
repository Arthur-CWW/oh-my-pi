# HANDOFF — Companion overnight program #2 (2026-07-16)

You are the fresh overnight orchestrator for the companion stream, taking over from session `019f614b-96dd-7000-8e6c-48f2841687ab` (parked, IRC-reachable). Arthur is asleep: NOTHING blocks on him; taste forks → Xanadu question entries. Boot: `docs/fable/charter.md` → `streams/companion/GOAL.md` → `streams/companion/notes/overnight-program-2026-07-15.md` (last night's program — your operating template and ground truth) → this file. Create your own goal (`goal` tool, workstream companion) with the objective below, and your own program doc `streams/companion/notes/overnight-program-2026-07-16.md`.

## Objective (six deliverables, unsupervised)

1. **Hands comparison + real hand calibration.** The arbiter's hand lanes run neutral 1.0 because `data/apple-vision-tracks/comparison-summary.json` has no hand-joint stats. Both track sets carry Hand-21: `data/gpu-pose-tracks/<clipId>.json` (`hands.left/right`, 281 clips, full-frame) and `data/apple-vision-tracks/<clipId>.jsonl` (`body2d.hands`, every-2nd-frame). Extend the comparison to hand joints (explicit name mapping, per-side), then extend `scripts/apple-motion-oracle/derive-calibration.ts` + `public/motion-calibration.ts` (formula version bump, provenance) and wire per-side hand weights through the arbiter's existing calibration seam. The documented TODO seam is in motion-calibration.ts.
2. **Full-corpus GPU-vs-Vision agreement.** Current comparison is MediaPipe-vs-Vision on 73 clips. Produce GPU-vs-Vision over all 281 (body + hands), aggregate + per-joint table → `data/apple-vision-tracks/gpu-comparison-summary.json`; refresh `scripts/derive-clip-quality.ts` agreementScore inputs and regenerate `data/clip-quality/quality.json` (badges auto-serve).
3. **Offline 3D-retarget evaluation.** Stability verdict (notes/body3d-stability.md): depth prior only, 13.1% frame transitions carry >12 m/s teleports. Quantify how far a bone-length-normalized, velocity-gated 3D-driven retarget is from usable: offline harness over the 10 most-stable clips (list in `data/apple-vision-tracks/body3d-stability.json`) computing jerk/peak-velocity/hip-jitter of a prototype 3D rotation stream vs the shipped 2D+depth-prior pipeline (reuse the tuning harness metric code). METRICS AND NOTE ONLY — nothing ships to the rig; `streams/companion/notes/retarget-3d-evaluation.md` with a bounded recommendation.
4. **Reviewer-flagged coverage gaps.** From ArbiterReview/reviewer transcripts + wave notes: production-path tests (no `advanceCaptureArbiterForTest` shortcuts) for arbiter edges (hysteresis under jitter at boundary, unregister-during-pending-promotion, model-swap latch races) and lab-state seams. qa-style slice; suite floor is 489/0 — raise it.
5. **Notes hygiene.** `streams/companion/notes/` has ~14 untracked evidence notes from prior sessions (character-casting, eidoverse-recon, face-rig-pipeline, sota-pose-transfer, etc. — INDEX.md catalogs all 42). Commit them as evidence-of-record (one commit, no content edits beyond obvious dead-link fixes), refresh INDEX statuses if you touch any.
6. **Morning wrap.** Update your program doc per wave; final: soak numbers (`bun scripts/soak-report.ts`; watcher lives in tmux `soak-watch`), one Xanadu proof card with the play-list, handoff-back note to Arthur's morning.

## Operating rules (inherited, binding — full lore in last night's program doc)

- Gate everything with `cd apps/ai-companion-rtc && bun scripts/validate.ts` (`--fast` mid-wave; `--checkpoint "msg"` commits nested on green; floor ratchets, currently 489). Outer repo: commit ONLY paths you own (scripts/apple-motion-oracle, streams/companion/notes, data derivations are gitignored); NEVER `git add -A` at root (foreign dirty files incl. package.json).
- Routing: bounded slices → `openai-codex/gpt-5.6-luna:xhigh`; design/synthesis → `openai-codex/gpt-5.6-sol:medium`. NEVER Terra, never Fable spawns. Provider aborts are frequent: revive via irc with disk-state summary; after 2 dead revivals respawn fresh; VERIFY DISK STATE, not reports. Workers never run project-wide formatters; you gate.
- One wave in flight at a time (≤5 agents); waves in order; no new substreams (Arthur's conservatism rule).
- LIVE surfaces stay up: companion server (port 4897, route `https://companion.localhost` — portless moved to 443 today, old :1355 is dead), sidecar (tmux `motion-oracle`, UDP 49982), soak (tmux `soak-watch`), desktop gpu-queue (tmux `gpu-queue` on `ssh desktop`; fish shell → always `bash -lc`; never tee pipelines). Workers use private instances (ports 4915+, `AI_COMPANION_MOTION_ORACLE_PORT` distinct, `AI_COMPANION_LLM=echo`) and kill what they start. Restart the live stack ONLY at ship points: kill port-4897 listener + `tmux new-session -d -s companion-stack -c ~/agents/apps/ai-companion-rtc 'AI_COMPANION_LLM=omp bun run stack 2>&1 | tee -a ~/agents/local/companion-stack.log; sleep 5'`.
- Origin gates accept `https://companion.localhost` (canonical) + legacy `http://companion.localhost:1355` string. Debug routes need that Origin header.
- Xanadu posts: `cd apps/xanadu && bun run post -- --stream companion --kind proof|question ...`.

## Do NOT touch (other owners / Arthur-gated)

- Model/rig generation: direction-gated on Xanadu question `0357400a` (HANDOFF-MODELGEN.md thread is Arthur's).
- v2 replay retirement: gated on question `f2114ebc` (prep exists; don't flip).
- OMP harness redeploy: HELD by agreement with the dotfiles-shellfix orchestrator (`dotfiles-pfvsd3` on IRC) until its shell-env matrix is green. Don't rebuild/rollout omp.
- WiLoR 3D / GVHMR mesh: fail-closed on Arthur's licensed files (preflight: `ssh desktop "bash -lc '~/projects/model-bench/queue/preflight-licensed.sh'"`).
- Live camera calibration: needs Arthur physically.

## Coordination

- Origin session `019f614b…` is parked; message it over IRC only if you need history it uniquely holds (`history://` won't cross sessions; ask it directly).
- Other externals on the bus: dotfiles orchestrators (shell redesign), other streams' sessions. The portless/services-supervisor change notice already went out.
- Your review surface duty: anything Arthur-visible lands as a Xanadu card with playable evidence, not prose.
