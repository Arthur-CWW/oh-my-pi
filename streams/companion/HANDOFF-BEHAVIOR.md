# HANDOFF — the Expressive Stack wave (fresh Fable session)

Boot: `docs/fable/charter.md` → `streams/companion/GOAL.md` → `streams/companion/notes/behavior-stack.md` (BOTH sessions in that note) → this file. Then act. You are the companion-stream Fable orchestrator; dashboard-mediated review; autonomous chaining; question entries for taste forks.

## Mission

Make her *react while Arthur talks* and *feel emotions congruently in face + voice*. Three builds, one adoption decision:

1. **EmotionVector system** — the low-dim emotion control space, congruent face+voice.
2. **L1 reactor** — rules + tiny-model hybrid watching the live stream, emitting reactive intents.
3. **Backchannel audio** — "mm", soft laugh, while Arthur speaks. ON by default, conservative.
4. **Effect v4 adoption** — all NEW server modules Effect-native; turn-pipeline migration second.

## Settled decisions (Arthur, 2026-07-06 — do not relitigate)

- Face fidelity: **build on Alicia now** — AND the perfect-sync hunt already LANDED: two verified 52/52 ARKit-blendshape VRM donors local at `data/avatar-models/hinzka-vroid-v110-female-perfectsync/` (canonical HANA_Tool donor, exact Perfect Sync clip names) and `data/avatar-models/blender-vrm-perfect-sync-female-donor/` (CC BY 4.0, cleanest license). Details/licenses: `notes/perfect-sync-models.md`. Wire one as the high-fidelity face for EmotionVector projection; the projection still degrades gracefully to Alicia's standard set.

- Backchannel: **on by default**, conservative (≤1 per ~15s, strong cues only, low gain, Rig kill-switch).
- Face fidelity: **build on Alicia now**; `PerfectSyncHunt` researcher is fetching an ARKit-52 "perfect sync" VRM in parallel → check `streams/companion/notes/perfect-sync-models.md` + `data/avatar-models/` before designing the projection; design projects onto *whatever the loaded model has*.
- L1 = **rules + flash-lite hybrid**: rules for reflex-speed (VAD start → gaze+lean; silence >2.5s → glance-away; energy spike → flicker), model for judgment (mood reading, backchannel timing). Same intent bus, both.
- Face : voice : body investment ≈ **5 : 4 : 1**. Body pose presets are done and sufficient (cherry on top).
- **Effect v4** for new server code (repo AGENTS.md rule): Stream for token/audio pipelines, fibers + structured interruption for turn supersede/barge-in, Hub/Queue for the intent bus, Semaphore(1) per single-threaded sidecar, TaggedErrorClass, Schema at every boundary (sidecar JSON, personas, config). Browser vrm-body 60Hz loop stays vanilla zero-alloc. No big-bang rewrite of working code.
- Doctrine: non-pessimization (quality first, optimizable seams); Bret Victor artifacts; every stage hot-swappable + visible in Rig.

## Design (from notes/behavior-stack.md — read it, it has the full reasoning)

- **EmotionVector**: 9 palette names = anchors in valence×arousal×dominance; mixing in VAD space (`ache .6 + fond .5` = bittersweet); per-model projection → blendshape weights (FACS/ARKit-52 is the target basis, Alicia's standard VRM set the degraded case); SAME vector → voice params (Kokoro rate, pause length, gain, WebAudio pitch/EQ/breath layer — coarse now, clone-lane prosody later). New wire: extend `body` events or add `affect` event carrying the vector; L0 projects.
- **Intent bus upgrades**: `lane:'react'` (schema already carries lane), `source: self|user|world` on every event (efference copy — she never reacts to her own voice), `ttlMs` decay, per-layer **precision/gain knobs** in Rig (L3-style modulation).
- **L1 reactor**: server-side, subscribes to the same taps SessionLog uses (vad state, partials, energy, silence). Rules emit instantly; flash-lite (via existing `createLlmEngineFromEnv` gemini lane w/ flash-lite model, or gemini-cca) gets a 2-5s cadence digest and may emit: emotion pulse, backchannel cue, salient observation injected into L2's rolling history as a system note ("he sounds tired"). L1 role flips while L2 speaks (accompany, don't react).
- **Backchannel**: pre-render a palette per persona voice at session start (Kokoro one-shots: "mm", "mhm", soft laugh, breath — write the list with taste, whisper register) → cached wavs → instant playback through the presence layer at low gain, ducked under Arthur's speech; triggered only by L1 cues.
- **Expressive-channel abstraction (Arthur, 2026-07-06 — design for it NOW, models come later):** future bodies include fursona/furry models, non-humans, weird hybrids, hyperhuman forms. The EmotionVector must therefore project onto a per-model **channel manifest**, never assumed anatomy: channels are typed outputs — `blendshape:<name>`, `bone:<name>` (ears flatten, tail wag, wings — first-class emotion outputs for a fursona), later `shader:<param>` (aura/glow/geometry for hyperhuman). Body layer already null-guards missing humanoid bones; the projection layer gets the same discipline: a model declares what it can express, the vector fills what exists. Pose presets become per-archetype packs (humanoid pack now; quadruped/hybrid packs later).

## System map (all working, commit `f61c731` nested / `2edc38ca` outer)

- App: `apps/ai-companion-rtc` (NESTED git repo). `bun run stack` = self-healing launcher (portless proxy → sidecars → server; `AI_COMPANION_LLM=gemini-cca` for the real brain). Surfaces: `companion.localhost:1355` (talk + VRM stage + Rig), `/scene.html` Ghost Room, `xanadu.localhost:1355` (dashboard; post via `cd apps/xanadu && bun run post`).
- Server: `src/server.ts` (WS, config apply-live, session-log taps), `src/server-assistant.ts` (turn pipeline, tag parser — cross-chunk incl. lone-`<`), `src/llm.ts` + `src/llm-cca.ts` (echo/gemini/kimi/gemini-cca; CCA = `omp token google-antigravity`, wire id `gemini-3.5-flash-low`, sandbox-first endpoints), `src/tts.ts` (kokoro per-request voice/speed), `src/stt.ts`, `src/personas.ts` (14 egregores), `src/session-log.ts` (JSONL per session).
- Sidecars (Python/MLX, single-threaded on purpose): `scripts/tts-sidecar.py` (Kokoro, 8799, mlx-audio==0.4.3 pin), `scripts/stt-sidecar.py` (whisper-turbo default + parakeet, 8798, hot /config).
- Browser: `public/vrm-body.ts` (bundled via `bun run build:vrm`; L0: 5-layer blender, gaze/saccades, speaking behavior, 9 emotion poses, idle life; contract: `createVrmBody(canvas,url)` → handle w/ `handleBody/setSpeechEnergy/setMood/setSpeaking/loadModel/dispose`), `public/app.ts` (Rig, talk toggle, pause), `public/presence.ts` (HRTF + analyser + suspend/resume).
- Latency truth: `[latency]` stdout per turn; `bun run measure`; echo lane eos→firstAudio ~100ms; CCA TTFT ~2s.

## Operational lessons (cost us hours — respect them)

- **gpt-implementer lane gets wrap-up-killed** mid-slice (~5min); kimi-implementer with a FROZEN contract + small file-scoped packets ships. Orchestrator runs ALL installs/builds/tests/servers/commits — worker sandboxes can't bind ports, use Metal, write .git, or bun install.
- **kimi-implementer is DEAD and fails SILENT** (2026-07-07): the subscription lapsed and the agent resolves to the SESSION model (fable-high!) without warning. After ANY spawn, verify the actual lane: `grep -h '"model"' ~/.omp/agent/sessions/<session>/<Worker>.jsonl | head -1`. Working lanes this wave: gpt-implementer (`openai-codex/gpt-5.5:high`) shipped 5/6 slices clean (one wrap-up-kill on the reactor — but its 410-line remnant was 95% complete and compiled after a 2-line v4 `Effect.forkChild` fix); designer/opus for UI; `task` + explicit `model: anthropic/claude-opus-4-8` for browser QA. Cancelled workers leave their edits on disk (shared tree) — resume-packets beat restarts.
- **Effect v4 beta.92 API drift**: `Effect.fork` doesn't exist — use `Effect.forkChild`/`forkScoped`; check `node_modules/effect/dist/Effect.d.ts` before assuming v3 names.
- **Dead agents ghost-message** stand-down claims after crashes; keep a kill-list, tell workers to ignore it.
- Transpiled files are served `no-store` now (stale-cache bug class); portless proxy dies sometimes — stack script self-heals it (`bunx portless proxy start --no-tls --port 1355`).
- `git pull --rebase --autostash` can leave the autostash UNPOPPED — check `git stash list` after every pull.
- personas/core.json grows — never hardcode counts/palettes.

## Acceptance for the wave

Arthur talks → she visibly reacts *during* his speech (gaze, lean, ≤conservative backchannel); mixed emotions render congruently in face AND voice (demo: `ache+fond` vs `playful` A/B); efference: she never reacts to her own voice; every gain Rig-tunable live; session JSONL captures affect events; dashboard proof entry with a captured demo clip + rerun commands; nested repo green (tsc + tests) and committed; TASKS.md row updated.
