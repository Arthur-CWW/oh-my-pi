# HANDOFF — Companion active continuation

Boot: `docs/fable/charter.md` → `streams/companion/GOAL.md` → `streams/companion/notes/behavior-stack.md` → `streams/companion/notes/perfect-sync-models.md` → `apps/ai-companion-rtc/docs/expressive-stack.md` → this file. Then act. You are the companion-stream Fable orchestrator; dashboard-mediated review; autonomous chaining; question entries only for taste forks.

## Continuation checkpoint — 2026-07-15

- **Preservation:** nested `apps/ai-companion-rtc` work was checkpointed at commit `ecd688b`; later continuation edits remain on top.
- **FaceReconstruction accepted:** 208 clips → 190 schema-v2 tracks, 18 honest no-complete-face failures, 3,343 valid frames. The aggregate uses all 190 inlier clips and 488 neutral frames. Three bounded strengths (`0.35/0.6/0.85`) reimport at 52/52; `0.6` is the deterministic runtime copy. Catalog entry, acceptance note, and Xanadu taste question are live. Evidence: `streams/companion/notes/face-identity-variants.md`.
- **Desktop acceptance closed:** HEVC→H.264 ingest works with validated cache and software fallback; the earlier 208-clip transfer batch finished 166/208 with an explicit failure taxonomy (36 no-face, 2 no-pose, 4 timeout). MediaPipe face, face-alignment, and RTMPose body each have three synchronized playable results under `data/model-bench/`; RTMPose remains a COCO-17 image-plane baseline, not VRM/SMPL motion. Evidence: `streams/companion/notes/model-bench-acceptance.md`.
- **Licensed blocker unchanged:** Arthur must provide `SMPL_NEUTRAL.pkl`, `SMPLX_NEUTRAL.npz`, and the FLAME model. No substitutes were fabricated.
- **FaceKit acceptance closed:** native ABI/schema guards, v42 metadata, 52 coefficients, browser preview, Box/Points/Axes geometry, a 65-second/1,230-sample calibration sweep, and stale L0 release were exercised. **Mirror X now defaults on** because Apple camera-space geometry must be flipped only for the mirrored browser preview; never mirror canonical coefficients/head pose on the wire. Runbook: `apps/ai-companion-rtc/docs/face-mirror.md`.
- **Apple capture boundary is now settled:** iPhone FaceOracle uses public ARKit and macOS body/hands use public Apple Vision. The local macOS FaceKit sidecar wraps an Apple-shipped, version-sensitive runtime; it is not a public SDK and must not be described as officially supported. Arthur's decision for this session is a clean stop after source, protocol, and basic integration. The main Companion/Fable orchestrator owns deeper product integration, calibration, motion taste, and the RTX WiLoR/RTMPose A/B.
- **Motion Lab control gates landed (commit `ce96472`):** the pose lane now runs a time-based `PoseGuard` (finite/confidence/side/segment checks, exact per-axis swing/twist clamps, 12 rad/s velocity cap, hold→decay recovery; saved extraction goes through the same guard); captured face replay drives the rig with unconditional release on pause/end/stale/reference-swap/model-swap and passive resume; one Space coordinator pauses reference/timeline/mirror/pose/face/hand transports with content-identity snapshots and transport-freeze preservation; and `/api/debug/lab-state` is a hardened loopback snapshot endpoint (strict whitelist schema, streamed byte cap, newest-wins ordering) so agents read Lab state with `curl`, not Playwright.
- **/lab React cutover landed (same commit):** React 19 + Tailwind v4 `@theme` tokens + local shadcn-style primitives under `public/lab/`; `lab.ts`/`lab.css`/`lab-system.css` are deleted; the 281-clip library virtualizes via `@tanstack/virtual-core` with stable media nodes; the full Face Mirror behavior (socket/drive/replay/preview/overlay/record/export/RAF) is ported, Mirror X defaults on. Every workflow, ID, global (`__labState` etc.), storage key, and `lab:*` event survives. Gates: `tsc` clean, `bun run build:lab`/`build:vrm` ok, 366 tests / 0 fail, live browser QA on `/lab` (panes, Space, selection, synthetic mirror replay, record/export, telemetry).

### Apple face/body/hand platform handoff

The TypeScript-facing topology is now:

```text
iPhone FaceOracle (public ARKit) ── UDP 49983 ──> src/face-capture.ts
macOS FaceKit sidecar ───────────── UDP 49983 ──> src/face-capture.ts
                                                     │
                                      52 normalized coefficients
                                      + head pose in degrees

AppleMotionOracle (public Vision) ─── UDP 49982 ──> src/motion-oracle.ts
                                                     │
                                  subscribed WS /ws?motionOracle=1
                                                     │
                                           public/motion-oracle-transfer.ts
                                                     │
                              independent body / hand capture writers into L0
```

Face and motion are separate transports and separate capture lanes. Do not add face fields to `companion.motion-oracle/1`, do not make body or hands conditional on face availability, and do not let any oracle write the avatar outside L0. **FaceKit Mirror X remains on by default for browser preview geometry only.** Canonical face coefficients and head pose are never mirrored. Motion is canonicalized to normalized upper-left coordinates at the UDP receiver; anatomical left/right is never swapped for a mirrored preview.

#### What is complete

- Native source and operator scripts: `scripts/apple-motion-oracle/AppleMotionOracle.swift`, `Info.plist`, and `build.sh`; package commands are `oracle:motion:build`, `oracle:motion:metadata`, and `oracle:motion:run`. The signed app bundle is `/tmp/ai-companion-motion-oracle/AppleMotionOracle.app`.
- Camera-free metadata reports the OS, Vision body request revision 2, standalone hand request revision 1, supported revisions, the 19 body and 21 hand joint names, lower-left source coordinates, unmirrored preview metadata, no bone rotations, and `body-associated-plus-standalone-fallback`. Compute-device-by-stage metadata is currently an honest empty object because the public Swift surface used here does not expose it in a stable form.
- Capture is 640×480 at approximately 30 fps. A single busy gate drops frames while Vision is working rather than queueing latency. Associated hands from the body request win for their anatomical side; a separate two-hand Vision request fills only missing sides and can emit hand-only packets when no body is usable. Unknown chirality is omitted, and same-side standalone candidates resolve by confidence.
- `src/motion-oracle.ts` owns the strict UDP boundary. It binds only `127.0.0.1:49982`, converts Vision lower-left Y to canonical upper-left Y once, preserves anatomical chirality, and forwards only normalized accepted events. Set `AI_COMPANION_MOTION_ORACLE=0` to disable it or `AI_COMPANION_MOTION_ORACLE_PORT` to change the port for an isolated test.
- Motion WebSocket delivery is opt-in. Only an exact `/ws?motionOracle=1` subscription receives `debug_motion_oracle`; ordinary app, assistant, face, and inexact-query sockets receive no body/hand landmarks. The trusted same-origin `POST /debug/motion-oracle/replay` sends ten synthetic packets at roughly 33 ms spacing.
- `public/motion-oracle-transfer.ts` is the browser adapter. It strictly parses the normalized event, chooses a full-body candidate and each hand independently, shows the observation overlay, and writes only through `setBodyCapture` / `setHandCapture`. Receive is shadow-only. `Drive body` and `Drive hands` are separate opt-ins, both off by default and cleared independently on disable, disconnect, stale input, pause, reference/model changes, and disposal.
- The React Motion Lab panel is `BodyHandsOraclePanel` in `public/lab/controls.tsx`, styled in `public/lab/lab.css` and mounted by `public/lab/behavior.ts`. It shows source, packet rate/age, body/left/right confidence, MediaPipe comparison availability, and a body/hand landmark canvas. React owns the controls; the imperative adapter does not create fallback DOM.
- The existing MediaPipe baseline remains available for shadow comparison. `public/hand-transfer.ts` now fail-closes malformed, sparse, non-finite, out-of-range, degenerate, or implausibly scaled Hand-21 geometry; rejects contradictory/unknown handedness; chooses the strongest candidate per anatomical side; and resets temporal state on mirror, video, seek, disable, inference failure, and stale input. `HandGuard` is time-based rather than frame-count based.

#### Protocol and safety limits

- Wire identity is exact: `schema: "companion.motion-oracle/1"`, `source: "apple-vision-body2d-r2"`, `intent: "body+hands"`. No unknown or duplicate JSON keys are admitted.
- The body vocabulary is 19 named 2D joints. The full-body core is 14 joints: root, neck, both shoulders, elbows, wrists, hips, knees, and ankles. A partial nonempty body is accepted only when it carries a valid associated hand. A hand requires a wrist and may be sparse on the wire; the current 2D retargeter needs valid Hand-21 geometry to produce finger rotations.
- Joint coordinates and confidence are finite values in `0..1`; observation confidence is also `0..1`. Source IDs and packet-local body IDs are nonempty and at most 128 characters. Sequence is a nonnegative JavaScript-safe integer and must increase per source. Capture time is a canonical decimal UInt64 string. EXIF orientation is integer `1..8`.
- UDP datagrams are capped at 64 KiB and the receiver tracks at most 1,024 source IDs. The browser parser caps a serialized WS event at 256 KiB. UDP is loopback-only, but this is still a local debug transport, not an authentication boundary.
- Apple Vision output here is **2D RGB only**: no measured depth, no world-space skeleton, no 3D body orientation, no camera calibration, and no emitted bone rotations. The browser adapter supplies `z = 0` only to reuse the existing 2D retarget seams. Body motion therefore remains an image-plane baseline.
- Oracle body retarget thresholds are 0.45 for arms/torso/head and 0.60 for legs; the existing `PoseGuard` remains the safety owner, including its 12 rad/s velocity cap. Oracle reception is stale after 420 ms and releases any enabled lane.
- MediaPipe hand detection/presence/tracking thresholds are 0.40 and retarget acceptance is 0.45. `HandGuard` uses a 55 ms smoothing constant and 9 rad/s angular velocity cap, holds the last valid hand for 100 ms, decays it for 250 ms, and resets after 350 ms. Pose/hand association is limited to 100 ms. Finger curl/spread clamps are the per-finger values in `FINGERS`; do not replace them with an unbounded generic rotation.

#### Proof already obtained

- Native build and camera-free metadata completed successfully after the final sidecar changes. The metadata selected Vision body revision 2 and hand revision 1 and reported the frozen joint sets and association mode.
- Synthetic end-to-end forwarding produced an accepted `debug_motion_oracle` shadow event with source `apple-vision-body2d-r2`, one body, and a left hand. The replay route emits ten decoder-valid frames; subscription tests prove exact-query delivery and non-delivery to default/inexact sockets.
- Live camera proof now reaches accepted UDP: a bounded 20-second debug run emitted 135 body observations after startup, with packets roughly 2.9–3.8 KiB. Detection dropped honestly when the subject left frame. The standalone hand fallback builds and its packet/parser/retarget paths pass behavior tests, but a close-hand live packet was not observed because no hand was deliberately presented during the bounded run. Treat close-hand source → accepted UDP → subscribed WS → retarget as the first continuation gate.
- Final affected proof: `tsc` clean; 56 tests / 0 fail across `test/motion-oracle.test.ts`, `test/motion-oracle-transfer.test.ts`, `test/hand-transfer.test.ts`, and `test/server-routes.test.ts`; `build:lab`, `build:vrm`, native motion-oracle build, and metadata all pass. Independent re-review confirmed all original five P1 and two P2 findings closed, with no new P0/P1.
- Real-browser QA was not completed. The attempted reviewer could serve `/lab` and read the debug endpoint, but had no usable browser/CDP session; no panel, responsive, canvas, console, or accessibility result should be inferred from that attempt. Full-body and close-hand calibrated clips were also not recorded.

#### Exact run commands

Keep the Companion server running for the whole review. It must remain live at **`http://companion.localhost:1355`**; do not stop it between replay, browser, and evidence capture.

```bash
cd apps/ai-companion-rtc
AI_COMPANION_LLM=omp bun run stack
```

In a second terminal:

```bash
cd apps/ai-companion-rtc
bun run oracle:motion:build
bun run oracle:motion:metadata
bun run oracle:motion:run -- --host 127.0.0.1 --port 49982 --debug
```

With `/lab` open and `Receive Apple Vision` enabled, synthetic replay and the agent-readable state are:

```bash
curl -fsS -X POST \
  -H 'Origin: http://companion.localhost:1355' \
  http://companion.localhost:1355/debug/motion-oracle/replay
curl -fsS http://companion.localhost:1355/api/debug/lab-state
```

The panel socket is exactly `ws://companion.localhost:1355/ws?motionOracle=1`. Do not use `/ws`, `motionOracle=true`, or a shared assistant socket for motion data.

#### Continuation outcome — 2026-07-15 (main orchestrator session)

Items 1/3/4/5-provisioning are CLOSED; do not redo them. Nested commits: `b376e57` (arbiter, motion-debug stage, 3D adapter, capture recording, replay geometry) on top of `7fea892`; outer commit `bb5d63c09` (avatar-pipeline runtime gates → KAMATTE verdict `accepted`).

1. **Browser QA done and defects fixed.** Findings report `local/motion-oracle-qa/report.md`. Real defects fixed: `/api/debug/lab-state` null (poster's `motionOracle` block was missing from the strict whitelist — seam-guard test added), synthetic replay geometry upgraded to full 19-joint body + both Hand-21 hands (drive-motion now provable without a camera), panel shows protocol source + packet age. Live-verified non-null snapshot after stack restart.
2. **Capture arbitration landed, independently reviewed, fix-first findings closed.** `public/capture-arbiter.ts` is the SOLE caller of `setBodyCapture`/`setHandCapture` (writer audit enforced). Lanes body/leftHand/rightHand; live-drive tier over replay tier; 0.1/250ms hysteresis with deadline-scheduled promotion; unconditional idempotent release incl. a model-swap latch released via `notifyModelSwapSettled()` after `loadModel` settles. Telemetry: `window.__captureArbiterState` + `captureArbiter` block in lab-state.
3. **3D Vision adapter live.** New frozen wire contract `companion.motion-oracle-3d/1` / `apple-vision-body3d-r1` / `body3d` (17 joints, meters, model-space, bodyHeight, cameraOriginMatrix; per-joint confidence honestly absent). Mutual 2D/3D decode rejection. Shadow-only in the browser. Replay: `POST /debug/motion-oracle/replay-3d`. Executable `AppleMotionOracle3D`, commands `oracle:motion3d:metadata|run`.
4. **Motion Debug stage** (Arthur's mesh/debug-tools ask): `public/lab/motion-debug/` — 2D observation stage (Vision vs MediaPipe superimposed), orbitable 3D capsule skeleton (grid/axes/frustum), rig/guard/arbiter strip (`__motionGuardDiagnostics` published by both guards), freeze-frame + single-step ring buffer, snapshot export to `data/ai-companion-rtc/motion-debug/`. Evidence: `local/motion-debug-qa/`.
5. **Capture-comparison recording infra**: same-origin-gated start/stop routes append accepted Vision events + MediaPipe shadow samples as JSONL under `data/ai-companion-rtc/recordings/motion/<sessionId>/` with clock bases + `session.json`; comparison script `scripts/compare-motion-capture.ts`; runbook `docs/motion-capture-comparison.md`.
6. **WiLoR provisioned on desktop** (tmux `wilor-setup`, env `.venvs/wilor`, log + README rerun note under `~/projects/model-bench` on desktop). Detector-only GPU smoke passed. **Full 3D runner fail-closes on licensed MANO_RIGHT.pkl — Arthur's MPI/MANO registration step now covers SMPL + SMPLX + FLAME + MANO.**
7. **Sico offline batch**: `AppleMotionOracleBatch` (AVAssetReader, per-frame 2D body+hands with live association policy + 3D) over the 281-clip sico corpus → `data/apple-vision-tracks/` + MediaPipe same-clip comparison vs the 73 `data/body-tracks` v2 tracks. Runner `scripts/apple-motion-oracle/run-sico-batch.ts`, log `local/apple-vision-sico/batch.log`, note `streams/companion/notes/vision-sico-batch.md` (in flight at session close if still running).

**Still open:** live calibrated full-body + close-hand clips (needs Arthur on camera ~2 min; infra ready — runbook `docs/motion-capture-comparison.md`), the consolidated evidence card (waits on clips + sico batch), WiLoR full run (MANO), Vision-vs-MediaPipe calibration weights feeding the arbiter's per-provider `calibration` multiplier.

#### Original continuation order (superseded by the outcome above)

#### Continuation order — do not redo the completed source/protocol work

1. **Browser QA.** Use a real browser at `http://companion.localhost:1355/lab`: initial shadow state, accessibility, synthetic replay and stale release, body-only and hands-only drive, overlay/telemetry, responsive 1440×900 and 1024×768, console/error log, and confirmation that Face Mirror X remains on and untouched.
2. **Full-body and close-hand calibrated clips.** Record honest clips that include the full retarget core (including nose and ears required by the existing PoseGuard), both hands close enough for distal fingers, occlusion, motion blur, entering/leaving frame, and mirrored preview. Save source conditions and compare Vision against the MediaPipe shadow on the same frames.
3. **3D Vision body adapter.** Add a separate typed source/adapter for a real 3D-capable Apple body API if the target hardware/runtime supports it. Do not relabel this 2D Vision stream as 3D and do not mutate `companion.motion-oracle/1` in place.
4. **Independent provider arbitration.** The basic Vision adapter already chooses body and each hand independently within one packet. Extend this to explicit cross-provider arbitration with per-lane freshness, confidence, calibration, and release. L0 remains the only writer. Face is not an eligibility signal.
5. **WiLoR RTX shadow benchmark.** Run WiLoR on the RTX desktop as a shadow challenger against the same close-hand clips, alongside the existing RTMPose/MediaPipe baselines. Keep it out of the Mac realtime loop until measured.
6. **Evidence card.** Publish one card with exact source versions, clips, calibration, packet/retarget rates, confidence/coverage, failure taxonomy, screenshots, rerun commands, and a bounded recommendation. Product integration and motion taste follow from that evidence, not from the synthetic packet.

**Ownership boundary:** this session is complete at source/protocol/basic integration. The main Companion/Fable orchestrator now owns product wiring, calibration, taste, independent arbitration, and the WiLoR/RTMPose A/B. Do not reopen the Apple source or frozen wire contract unless the continuation work finds a concrete defect.

## Session close 2026-07-14 — embodiment/studio mega-session (session `019f4aa3`)

Everything below is in the NESTED working tree (81 changed files, uncommitted — consider a commit first). Final gates all green: 236 tests / 0 fail, `tsc` clean, `build:vrm` ok, `bun run doctor` exit 0. Live: `companion.localhost:1355` (`/`, `/scene`, `/review`, **`/lab`**), stack `AI_COMPANION_LLM=omp bun run stack`.

### Landed and verified (pointers, not prose)
- **Voice loop**: VAD + live partials + Whisper↔Parakeet hot-swap + duplex barge-in; ritual gate `bun run e2e:voice` (8/8 twice) — `apps/ai-companion-rtc/docs/qa-voice-e2e.md`. `bun run doctor` = one-command stack health.
- **OMP brain lanes**: `src/llm-omp.ts`, GET `/models`, Rig Brain/Driver selects; small/default=luna, medium=sol, slow=terra, 60+ subscription models live-swappable.
- **Motion Lab studio `/lab`**: three-pane shell, design system `public/lab-system.css` + vendored Lucide sprite (laws in `notes/lab-design-system.md`), multi-track editor timeline (scrub/zoom/mute-gates), sico library (281 clips, synced video), pipeline monitor (SSE job queue).
- **Transfer stack**: pose (`public/pose-transfer.ts`, direction-vector retarget), hands (`hand-transfer.ts`, 30 finger bones), face (`face-transfer.ts` + `face-mapping.ts`: crop-follow for camera moves, response curves, neutral calibration, per-class filtering — measured composite 61→66.5, jerk −31%), skeleton overlay on the reference video, capture lanes in `vrm-body.ts`, v2 body-tracks (world+image+hands). Per-clip captured replay is the DEFAULT motion source (verified distinct motion: ranges 0.475/0.569, inter-clip 0.795); Gemini timelines demoted/muted.
- **Face rig pipeline**: headless Blender Perfect Sync transplant `scripts/blender/face-rig-transfer.py` — KAMATTE 0/52 → **52/52** (`kamatte-ps.vrm`, coverage matrix loop in `local/companion-face-rig/`).
- **Docs/recon**: expressive-motion design + ontology + iteration-infra + sota-pose-transfer (GVHMR pinned) + character-casting (Ellen #1) + eidoverse-recon (REBUILD verdict; mesh loop reconstruction; adopt-now N8AO) + anichat-pipeline-recon + gpu-batch-plan — all under `streams/companion/notes/`.

### Running unattended / resume first next session
1. **FaceReconstruction (INTERRUPTED mid-run)**: corpus→identity scripts landed at `scripts/face-identity/` (extract/aggregate/bake-variants) but the three likeness variants, `kamatte-ps-sico` catalog entry, note, and taste question were NOT produced. Resume-packet this first; lane B (FLAME/MICA on desktop) staged separately.
2. **Desktop tmux** (`ssh desktop`): `companion-extract` (pose-priority batch w/ HEVC→H.264 transcode; throughput shaky — last honest state 0.26 clips/min with 'no usable faces' failures to taxonomize), `gvhmr-setup` (fully provisioned, blocked ONLY on MPI files), `model-bench` (mise+uv+HF-cache monorepo live; mediapipe-face + face-alignment × 3 clips synced to `data/model-bench/`; body entry/note/Xanadu card unconfirmed — finish acceptance).
3. **ARTHUR MANUAL STEP (one MPI registration session)**: download `SMPL_NEUTRAL.pkl`, `SMPLX_NEUTRAL.npz` (+ FLAME model for the identity lane) → desktop `~/projects/GVHMR/inputs/checkpoints/body_models/{smpl,smplx}/`. Unlocks SOTA video→rig dance capture and corpus face identity.
4. **React + Tailwind v4 + shadcn lab migration**: decided (React over Solid), deliberately queued behind the batch (headless extraction drives /lab pages); lab-system tokens map into the Tailwind theme.
5. Gemini video-timeline lane quota-dead (429); local tracks don't need it.

### Session process rules (Arthur-set, keep)
- Sol (`openai-codex/gpt-5.6-sol:medium`) default for all subagent work; luna implementation-trivia only, NEVER specs/design. No GPT-5.5/Fable spawns.
- Mac = realtime only; every batch/provision on desktop in named tmux with durable logs (policy enforced in `src/job-queue.ts`).
- Xanadu posts: short summaries; `--summary-file` flag now exists in `apps/xanadu/src/post.ts` for anything longer.
- Recordings save server-side (`data/ai-companion-rtc/recordings/`), never browser downloads — proof infra for agents, not a user feature.

## Current status

- **Committed/frozen Wave 6 baseline:** nested testbed commits `c95fa65` + `2c997bf`, with outer commit `1fed5e95`. Its implementation contract is frozen in `apps/ai-companion-rtc/docs/expressive-stack.md`; do not restate or extend its API contract here.
- **Current uncommitted behavior wave:** the newer full-duplex behavior implementation is present in the nested working tree. Acceptance 140–147 are implementation-complete with bounded executed/structural proof in [`apps/ai-companion-rtc/docs/qa-full-duplex-behavior.md`](../../apps/ai-companion-rtc/docs/qa-full-duplex-behavior.md), not a replacement for the frozen Wave 6 contract.
- **Evidence limitations:** user-cue-to-face latency below 300 ms is not measured; there is no live Ubuntu/provider-disconnect run; no live deep provider was called; and no live semantic-filler conversation artifact exists.
- **Foundation proof completed 2026-07-11:** the package-owned no-spend echo/tone benchmark produced 10 validated samples at `local/companion-latency-benchmark/latest/`; contract and rerun: `apps/ai-companion-rtc/docs/qa-benchmark-harness.md`. The optional live digest path also ran through `gemini-cca`; evidence: `apps/ai-companion-rtc/docs/qa-live-reactor-digest.md`.
- **Foundation sequence completed 2026-07-11:** the Effect-owned turn pipeline now preserves the synchronous facade and independent STT/playback lanes; provider readers clean up on interruption. Before/after proof: `apps/ai-companion-rtc/docs/qa-effect-turn-pipeline.md`. The next work is a product/taste fork: F5 whisper voice, PuruPuru body, or Live2D body.
- **Mac=realtime-only policy — 2026-07-14:** browser MediaPipe catalogue extraction defaults to one local worker and must refuse heavier local concurrency unless `AI_COMPANION_ALLOW_HEAVY_LOCAL=1`; batch/provisioning runs belong on the RTX desktop in named tmux sessions with durable logs.

## Mission

Make the companion full-duplex and embodied: she listens while she speaks, reacts while Arthur talks, and expresses congruent voice, face, gaze, pose, and gesture without coupling policy code to one model, rig, or workstation.
## Load-bearing invariants


1. Upper layers emit typed semantic intents; **only L0 writes avatar channels**.
2. Affect is stored as low-dimensional VAD, but authored, logged, and inspected as named anchors/mixes from `personas/core.json`, never hardcoded lists.
3. Movement is discrete parameterized `SocialAct` / `MotionPrimitive` commands, not a giant continuous body vector.
4. Mac/browser owns realtime audio capture/playback and the 60Hz body. Ubuntu GPU is an optional inference appliance reached over WebRTC/data events.
5. Deep deliberation is an asynchronous replaceable provider. It is not coupled to ChatGPT Pro, OMP, or the development harness.

## Settled decisions

- **Face fidelity:** Alicia remains the immediate default. The Perfect Sync hunt already landed: two local verified 52/52 ARKit/Perfect Sync donor rigs exist at `data/avatar-models/hinzka-vroid-v110-female-perfectsync/` (canonical HANA_Tool donor, exact Perfect Sync clip names) and `data/avatar-models/blender-vrm-perfect-sync-female-donor/` (CC BY 4.0, cleanest license). Details/licenses: `streams/companion/notes/perfect-sync-models.md`. Do **not** block this wave on finding another model.
- **Rig requirement:** Rig must support live Alicia ↔ PerfectSync hot-swap and A/B presets through per-model projection profiles. The policy must not be rebuilt or re-prompted when the rig changes.
- **Backchannel:** on by default, conservative, honest, low gain, with Rig kill-switch and cooldown.
- **L1:** rules first for reflex/floor behavior. A small social-policy model may be added at 2–5Hz, but rules must carry the latency-critical path.
- **Effect v4 for new server code:** Stream for token/audio pipelines, fibers + structured interruption for turn supersede/barge-in, Hub/Queue for intent buses, Semaphore(1) per single-threaded sidecar, TaggedErrorClass, Schema at every boundary. Browser L0 remains a vanilla zero-alloc 60Hz loop.
- **Doctrine:** non-pessimization, hot-swappable stages, visible Rig controls, and no second convention beside the frozen expressive-stack contract.

## GPT-Live lesson

Disclosed GPT-Live facts to borrow: full-duplex continuous interaction and delegation are the pattern. It keeps listening while producing output and can hand work to slower capability lanes.

Unknown internals must not be asserted. Do not claim OpenAI's private model topology, audio representation, buffer policy, or animation control scheme.

Our design inference: adapt the audio-only lesson into a multimodal interaction controller. The controller consumes simultaneous user-input and assistant-output streams, maintains source/clock metadata, and emits typed intents:

- `VoiceIntent`: speak, fade, cancel, filler, breath/noise layer, prosody target.
- `AffectIntent`: anchor mix + intensity + TTL.
- `GazeIntent`: look-at-camera, look-at-user, glance-away, saccade/search, down-think.
- `PoseIntent`: lean-in, settle, breathe, orient, idle energy.
- `SocialAct` / `MotionPrimitive`: nod, head-tilt, emphasis stroke, thinking-breath, smile/soften, etc.

## Model/topology contract

Four realtime timing tiers, plus one out-of-band delegate:

| Tier | Rate / latency | Authority | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| **L0 deterministic renderer** | 60Hz, never awaits | browser/Mac; sole writer to blendshapes, bones, shaders, audio output gains | intent bus, actual audio analyser, rig manifest, local clocks | continuous trajectories, mouth energy, gaze, vitals, decay |
| **L1 reflex/floor** | event-driven to <300ms visible response | rules first; no model dependency | VAD, RMS/energy, partial STT, assistant status, source tags | conservative listening acts, barge-in body snap, honest backchannel cues |
| **L1.5 social policy** | optional 2–5Hz | small local/cheap replaceable model target, not an architectural identity | short rolling digest | affect pulse, observation for L2, backchannel permission/veto |
| **L2 conversational speaker** | streaming per utterance/turn | normal replaceable conversation model/provider | final/partial user meaning, persona, scene, L1 observations | text/audio stream, sync affect/gesture tags, cancellation hooks |

Out-of-band **deep-work delegate**: asynchronous frontier/deep provider for research, planning, or long reasoning. It returns versioned results tagged with request epoch/correlation. If the conversation moved on, results are summarized, suppressed, or revalidated; they never block L0/L1 and never directly animate the body.

Parameter counts are replaceable implementation targets, not architectural identities. "Small local model", "normal speaker", and "frontier delegate" describe latency/authority lanes. Do not bake a vendor, open-source model name, or parameter count into the product contract. ChatGPT Pro and OMP development access are useful operator tools, not stable product-runtime APIs.

## Full-duplex mechanics

- Maintain simultaneous `user-input` and `assistant-output` streams. There is **no silence-equals-turn invariant**.
- Use browser/WebRTC acoustic echo cancellation for the product loop. Tag every event with `source: "self" | "user" | "world"` and preserve efference copy so L1 never treats assistant audio as user input.
- Track actual-played output offsets, not just scheduled TTS offsets. Sync facial/gaze/gesture anchors to the audio frame that actually reached playback.
- Barge-in path: user VAD/energy/partial can fade assistant playback, cancel pending TTS/LLM work, snap body to listening, and emit interruption-safe session state. Fade/cancel must be structured, not a mute-only hack.
- Keep separate capture and render clocks. Resync with monotonic timestamps and drift-aware offsets; do not assume microphone chunks, model chunks, and WebAudio frames share a clock.
- Recommended LAN media shape: 48kHz mono Opus, 20ms packets over WebRTC. Resample only at model boundaries. Keep noise suppression configurable; avoid AGC settings that flatten prosody or destroy whisper/breath cues.
- The renderer never waits on network or model output. Late intents can be dropped, damped, or re-anchored; L0 aliveness continues.

## Control ontology

Existing `AffectVector` = valence × arousal × dominance. Existing `EmotionMix` = named anchor weights (`warm`, `hush`, `playful`, `longing`, `still`, `sly`, `awe`, `ache`, `fond` in the current persona pack). Authors and Rig should see anchors/mixes; VAD is the internal math and interpolation space.

Movement commands are task-space social commands, not actuator commands. Robotics analogy: **task-space commands + hierarchical/subsumption control**, not direct joint torque/blendshape control. Higher layers say "nod once, softly, during this word"; L0 decides neck bones, eye compensation, blendshape accents, easing, and decay for the loaded rig.

MVP scope guard: this is current-state classification plus interruptible authored primitives, **not** learned action-chunk prediction, flow matching, or a sequence policy. Physical Intelligence π0-style short-horizon action generation is a later benchmark only after the rules/primitives path is proven.

`SocialAct` / `MotionPrimitive` fields:

- `name`: closed vocabulary such as `nod`, `glance-away`, `thinking-breath`, `head-tilt`, `settle`, `emphasis-stroke`, `lean-in`, `gaze-camera`, `soften-smile`.
- `phase`: `onset | hold | release` when an act is multi-phase; one-shot acts may omit and let L0 synthesize phases.
- `intensity`: 0..1 semantic strength, lane-capped before projection.
- `ttlMs`: hard expiry; stale motion self-decays.
- `priority`: deterministic arbitration within a lane; sync speech beats react on the same channel, but L0 vitals are unsuppressible.
- `channelMask`: semantic channel set, e.g. `face`, `eyes`, `head`, `torso`, `hands`, `voice`, `shader`.
- `source`: `self | user | world` for efference/source identity, matching the frozen protocol; use a separate `producer`/lane field for `rules`, `social-policy`, `speaker`, or `deep` provenance.
- `confidence`: 0..1; low confidence reduces amplitude or requires a rule confirmation.
- `timingAnchor`: `now`, `user-vad-start`, `user-partial:<id>`, `assistant-audio:<utteranceId>@<playedMs>`, or `absolute:<monotonicMs>`.

L0 projects these commands to continuous blendshape/bone/shader trajectories using the active rig profile. No layer above L0 emits ARKit weights, bone rotations, shader uniforms, or WebAudio gain curves directly.

## Channel manifests, rig adapters, and hot-swap

Every model has a `ChannelManifest`: available blendshapes, bones, look-at support, audio mouth basis, optional ARKit-52/Perfect Sync coverage, shader params, and per-channel safety ranges. Alicia, hinzka Perfect Sync, and blender-vrm Perfect Sync each require independent projection profiles.

Rig adapters:

- Map `AffectMix`/VAD to the model's available face channels. ARKit-52/Perfect Sync gets high-fidelity brow/eye/cheek/mouth projection; Alicia uses the standard VRM expression set; missing channels degrade by dropping or remapping, never by throwing.
- Map `SocialAct` / `MotionPrimitive` to rig-local trajectories and masks. A nod on Alicia and a nod on a Perfect Sync donor are the same semantic act with different bone/blendshape curves.
- Expose live per-profile gains/toggles in Rig: affect intensity, react gain, backchannel enable/gain, face-profile A/B, motion-profile A/B, noise suppression/AGC mode, and channel debug overlays.
- Hot-swap model/profile at runtime without rebuilding the policy. Pending semantic intents survive as semantics and are re-projected through the new profile; rig-specific continuous curves are discarded on swap.

## Honest buffer behavior

While Arthur is speaking, allowed "I am with you" behavior is nonverbal first: gaze, lean-in, small nods, posture settle, thinking-breath, brow/awe flicker, and attention shifts. Cognitive gestures may reflect actual pending/listening state: down-glance while composing, breath before response, settle on cancellation.

Rare vocal fillers (`mm`, `mhm`, soft laugh, breath, short "oh") are allowed only when they honestly reflect listening or pending state. Never use semantic agreement fillers ("yes", "right", "exactly") before comprehension or before L2 has accepted that meaning. If STT is partial/uncertain, prefer nonverbal acknowledgment or a neutral breath.

Arbitration:

- Governor owns cooldown and gain. Default cadence remains conservative; strong cues may shorten cooldown but still respect interruption policy.
- User barge-in suppresses assistant vocal fillers immediately and fades/cancels assistant speech as configured.
- Channel arbitration is deterministic: sync speech gestures > interrupt/listening reflex > social-policy suggestions > idle life, except blink/breath/saccades that L0 owns.
- Backchannel and assistant speech share voice output authority. They must not overlap unless explicitly ducked and allowed by the governor.

## Optional Ubuntu deployment seam

Mac/browser remains the realtime authority: microphone capture, WebRTC AEC, playback, Rig, and 60Hz renderer live there. Ubuntu GPU is optional, not a blocker.

If used, Ubuntu hosts replaceable inference services only: STT, TTS, small social-policy model, normal speaker, or deep-work delegate. Cross the LAN with typed versioned events and audio streams over WebRTC/data channels. Include schema version, source, correlation id, monotonic timestamp, and cancellation/epoch on every remote message. Renderer/L0 never waits on Ubuntu; L1 rules must still work if Ubuntu disappears.

## System map (current repo-grounded state)

- App: `apps/ai-companion-rtc` (NESTED git repo). `bun run stack` = self-healing launcher (portless proxy → sidecars → server; `AI_COMPANION_LLM=gemini-cca` for the current real brain). Surfaces: `companion.localhost:1355` (talk + VRM stage + Rig), `/scene.html` Ghost Room, `xanadu.localhost:1355` (dashboard; post via `cd apps/xanadu && bun run post`).
- Frozen expressive contract: `docs/expressive-stack.md`; implemented areas include `src/affect.ts`, `src/reactor.ts`, `src/backchannel.ts`, protocol/session-log hooks, Rig behavior controls, and browser `ChannelManifest`/`setAffect`.
- Server: `src/server.ts` (WS, config apply-live, session-log taps), `src/server-assistant.ts` (turn pipeline, tag parser — cross-chunk incl. lone-`<`), `src/llm.ts` + `src/llm-cca.ts` (echo/gemini/kimi/gemini-cca; CCA = `omp token google-antigravity`, wire id `gemini-3.5-flash-low`, sandbox-first endpoints), `src/tts.ts` (kokoro per-request voice/speed), `src/stt.ts`, `src/personas.ts` (egregores + emotion anchors), `src/session-log.ts` (JSONL per session).
- Sidecars (Python/MLX, single-threaded on purpose): `scripts/tts-sidecar.py` (Kokoro, 8799, mlx-audio==0.4.3 pin), `scripts/stt-sidecar.py` (whisper-turbo default + parakeet, 8798, hot `/config`).
- Browser: `public/vrm-body.ts` (bundled via `bun run build:vrm`; L0: 5-layer blender, gaze/saccades, speaking behavior, emotion poses, affect projection, idle life; contract: `createVrmBody(canvas,url)` → handle w/ `handleBody/setSpeechEnergy/setMood/setAffect/setSpeaking/getManifest/loadModel/dispose`), `public/app.ts` (Rig, talk toggle, pause), `public/presence.ts` (HRTF + analyser + suspend/resume + backchannel/voice-affect).
- Latency truth: `[latency]` stdout per turn; `bun run measure`; echo lane eos→firstAudio ~100ms; CCA TTFT ~2s. These are observed development facts, not product-runtime guarantees.

## Operational lessons (cost us hours — respect them)

- **gpt-implementer lane gets wrap-up-killed** mid-slice (~5min); kimi-implementer with a FROZEN contract + small file-scoped packets shipped earlier slices. Orchestrator runs installs/builds/tests/servers/commits — worker sandboxes can't bind ports, use Metal, write `.git`, or install.
- **kimi-implementer is dead and failed silently** on 2026-07-07: subscription lapsed and the agent resolved to the session model without warning. After any spawn, verify the actual lane from its session metadata before trusting output. Cancelled workers leave edits on disk; resume-packets beat restarts.
- **Effect v4 beta.92 API drift:** `Effect.fork` doesn't exist — use `Effect.forkChild`/`forkScoped`; check `node_modules/effect/dist/Effect.d.ts` before assuming v3 names.
- Dead agents ghost-message stand-down claims after crashes; keep a kill-list, tell workers to ignore it.
- Transpiled files are served `no-store` now (stale-cache bug class); portless proxy dies sometimes — stack script self-heals it.
- `git pull --rebase --autostash` can leave the autostash unpopped — check stash state after every pull.
- `personas/core.json` grows — never hardcode counts, palettes, or anchor lists.

## Behavior-wave completion and continuation

The current uncommitted behavior wave structurally implements acceptance 140–147:

- **140:** full-duplex barge-in leaves clean state.
- **141:** self-audio carries efference/source identity and actual-played offsets.
- **142:** Rig hot-swaps Alicia and Perfect Sync profiles with inspectable projection.
- **143:** face projection uses richer ARKit/Perfect Sync channels and degrades gracefully.
- **144:** motion is discrete, bounded, priority-arbitrated, and playback-anchorable.
- **145:** listening behavior is nonverbal-first, conservative, and interruptible.
- **146:** deep results are epoch/correlation fenced and cannot animate directly.
- **147:** Mac/browser retains realtime authority while Ubuntu remains optional.

The evidence ledger is [`qa-full-duplex-behavior.md`](../../apps/ai-companion-rtc/docs/qa-full-duplex-behavior.md). Its limits are binding: it does not measure the <300 ms face condition, exercise a live Ubuntu/provider disconnect or a live deep provider, or prove semantic-filler content in a live conversation.

Foundation order: benchmark harness **done** → live digest proof **done** → Effect turn-pipeline migration **done**. Next: choose the F5 whisper-voice, PuruPuru, or Live2D product branch through the dashboard taste question.
