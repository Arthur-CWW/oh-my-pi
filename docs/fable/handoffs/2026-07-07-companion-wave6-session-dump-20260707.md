> Rescued 2026-07-13 from /Users/arthur/agents/local/companion-wave6-session-dump-20260707.md

# Companion session context dump — 2026-07-07 (wave 6, Expressive Stack)

> **HISTORICAL / SUPERSEDED SESSION DUMP — do not use as active status.**
>
> This preserves the 2026-07-07 Wave 6 resume context exactly as captured. The canonical active continuation, including the later uncommitted full-duplex behavior wave, bounded proof, evidence gaps, and next work, is [`streams/companion/HANDOFF-BEHAVIOR.md`](../streams/companion/HANDOFF-BEHAVIOR.md). The frozen Wave 6 implementation contract remains [`apps/ai-companion-rtc/docs/expressive-stack.md`](../apps/ai-companion-rtc/docs/expressive-stack.md).

Session: Fable orchestrator, COMPANION stream, forked from wave-5 session. Arthur said "I will come back to you" — this file is the resume state. NOT the handoff (HANDOFF-BEHAVIOR.md stays canonical for a FRESH session; this is richer session-local state).

## Mission state: WAVE 6 COMPLETE ✅

All acceptance criteria from `streams/companion/HANDOFF-BEHAVIOR.md` §Acceptance met and proven. Boot chain I followed: HANDOFF-BEHAVIOR.md → charter.md → GOAL.md → notes/behavior-stack.md (+ notes/perfect-sync-models.md).

### Commits
- nested `apps/ai-companion-rtc`: `1b7c5a1` (wave base: frozen contract, affect skeleton, effect dep, hinzka donor copy) → `c95fa65` (the Expressive Stack, full feature) → `2c997bf` (rotateVRM0 ungate fix). Branch main, clean tree at dump time.
- outer `~/agents`: `1fed5e95` (TASKS.md wave-6 row + handoff ops lessons). Outer tree still carries OTHER sessions' dirty files — I committed only my two.
- Wave-5 leftover one-line `setSpeaking` fix in public/app.ts was absorbed into `1b7c5a1`.

### What shipped (file map)
- `docs/expressive-stack.md` (in nested repo) — THE FROZEN CONTRACT all slices coded against. Read this first on resume; it documents every type/event/invariant verbatim.
- `src/affect.ts` — AffectVector (VAD −1..1), EmotionMix, mixToVector (normalize only when Σw>1), vectorToVoice (rate/pause/gain/lowpass/breath, clamps in contract), parseEmotionMix ("ache*0.6+fond*0.5"; repeated names sum, cap 1; −0 breathiness bug fixed).
- `personas/core.json` — new top-level `emotionAnchors` (9 VAD anchors, one per palette name); `src/personas.ts` validates + exposes `PersonaPack.emotionAnchors: ReadonlyMap<string, AffectVector>`.
- `src/reactor.ts` — L1, Effect v4 (Queue.dropping(256), two forkChild fibers, runFork facade). Rules v0: vad_start→lean-in(0.5)+gaze-camera(0.6); energy spike (Δ≥0.25 over 2s mean, rms≥0.4, 1.5s refractory)→spark; silence>2.5s→glance-away+settle once; laughter partial→playful affect+soft-laugh cue (4s refr); final→mm p=0.4 (6s refr, injectable random). Efference: source!=="self" everywhere; accompany mode (speaking/thinking suppresses all user-reactive+backchannel). Digest loop: 3s cadence while engaged, DigestFn injected, verdict {pulse.mix, backchannel.name, observation≤140}; failure→warn once, rules-only. setGain 0..2; intensity ≤0.6 pre-gain, ≤0.85 post.
- `src/backchannel.ts` — Effect v4. BACKCHANNEL_PALETTE: mm/mhm/soft-laugh/breath/oh (whisper-register texts, speeds .85–.95). createBackchannelCache (Semaphore(1) prerender, memory keyed voice + disk .tmp/backchannel/<voice>/<name>.json, per-clip failure skip). createBackchannelGovernor (15s min interval, strength≥0.8 passes at 8s, gain=cfg×strength ≤0.5).
- `src/server-protocol.ts` — AffectEvent, BackchannelPaletteEvent, BackchannelCueEvent (server); AffectDemoEvent + ConfigEvent.behavior (client); BodyEvent lane 'react' + source + ttlMs; ConfigStateEvent.behavior REQUIRED.
- `src/session-log.ts` — rows: affect, react_body, backchannel.
- `src/server.ts` — per-connection Reactor+Governor in ConnectionCtx; taps (vadStart/transcript/status→reactor; audio_chunk RMS throttled 5Hz); intents→broadcast+log (+observation→injectSystemNote); module behaviorConfig {reactorGain 1, backchannel true, backchannelGain .35, affectIntensity .7} echoed in config_state, applied live to all reactors/governors; backchannel prerender on join + voice/persona change → backchannel_palette push; affect_demo handler (demo line "Stay a little longer — I was hoping you'd wander back.", direct TTS w/ speedScale, bypasses history); digest lane gated by AI_COMPANION_REACTOR_LLM (default = main engine kind; echo/off → rules-only).
- `src/server-assistant.ts` — BodyTagParser accepts mix grammar in emotion tags; emotion tag → legacy body event (highest-weight name) + sync AffectEvent (source self, mixToVector); turn VoiceAffect (persona moodBaseline anchor ×0.5 damping at turn start, first emotion tag replaces); synthesizeSentence passes {speedScale}; pauseScale>1 → zeroed pcm16 silence chunk (120ms×(pauseScale−1)) between sentences; injectSystemNote → pendingNotes (cap 3, dedupe, drop-oldest) drained as "[ambient note: …]" prefix on next USER history entry (NOT system turn — geminiContents DROPS mid-history system turns, that's why).
- `src/tts.ts` — TtsEngine.synthesize(text, options?: {speedScale}); Kokoro per-call speed×scale clamp 0.5..2, instance immutable (engine SHARED across sessions); Tone ignores.
- `src/client.ts` — parse/emit affect, backchannel_palette, backchannel_cue; configure({behavior}); sendAffectDemo(mix); config_state.behavior optional-tolerant.
- `public/vrm-body.ts` — ChannelManifest (blendshapes/bones/arkit detect via browinnerup+mouthsmileleft+jawopen); setAffect (ARKit VAD-composition path + degraded EMOTION_MAP weighted-blend path; sync owns emotion channel, react additive ≤0.6 ≤2000ms never displaces sync; vitals never suppressed); react handleBody with gaze-camera/glance-away in gaze system; window.__vrmAffect(mix, lane?) QA hook (hardcoded anchor copy, QA-only); **rotateVRM0 now UNCONDITIONAL** (metaVersion-aware; was name-gated to alicia → hinzka rendered back-to-camera; claude-toon is VRM1 = no-op; verified by GLB parse: alicia VRM0, claude VRM1, hinzka VRM0).
- `public/presence.ts` — voice chain lowpass+gain (neutral 12kHz), setVoiceAffect (~120ms ramps), breathiness noise bed (lowpass 1800Hz, ×0.02); backchannel bus (loadBackchannelPalette wholesale replace, cueBackchannel offset-panner one-shot, setBackchannelDuck ×0.45 ~80ms); backchannel sources survive turn resets.
- `public/app.ts` + index.html + styles.css — Behavior fieldset (reactor gain 0–2, backchannel kill-switch pill LIVE/MUTED + gain, affect intensity), A/B cue cards (data-affect-demo attrs), client event handlers → vrm.setAffect + presence voice affect (client-side vectorToVoice dup w/ contract clamps, scaled by intensity knob), palette/cue → presence, duck from mic RMS>0.05 (300ms decay), keyboard 'b' toggles backchannel, Hinzka option in BODY select.
- `public/models/hinzka-perfect-sync.vrm` — 23MB ARKit-52 donor, committed (consistent w/ alicia). Redistribution prohibited per VRM meta — private repo only.
- `public/body-viz.ts` — lane union widened (one-line).
- Tests: 126 pass, tsc clean. New: affect, reactor (11, deterministic w/ ≤50ms waits), backchannel, protocol extensions, body-tags mix, assistant notes/affect, tts speedScale (toBeCloseTo for float).

### Proof artifacts
- `data/asmr-companion/expressive-stack-demo/20260707/`: ab-affect-demo.webm (16.4s, Alicia face-forward, ache+fond then playful full turns), reaction-during-speech.webm (14.7s, lean-in/gaze during synthetic speech, glance-away/settle after, "mm" murmur at gain 0.2), ache-fond.png / playful.png (brow contrast legible), hinzka-playful-facing.png + hinzka-ache-fond-facing.png (post-fix, tender-vs-brighter read), hinzka-load.png (pre-fix back-of-head — the bug), notes.md (verdicts a–d PASS + evidence rows + rerun), console-errors.txt (only 2× favicon 404).
- Xanadu feed entry id `08f60deb-1927-4674-8796-0358e487c6e3` (kind proof, stream companion) with both webms + images + notes + actions.
- Session JSONLs with evidence: `data/asmr-companion/sessions/2026-07-07-e30b7ced…` (reaction clip session), `…34e8d201…` (A/B vectors), `…f2cb3650…` (long QA: 340 react_body, 15 backchannel).
- Useful leftover rigs: `apps/ai-companion-rtc/.tmp/expressive-qa-capture.mjs` (full Playwright capture: SwiftShader WebGL headless, MediaRecorder canvas+presence streams, sentinel round-trip technique), `.tmp/qa-speech-push.ts` + `.tmp/ws-smoke.ts` (WS clients pushing Kokoro-rendered "user speech" into room default), `.tmp/hinzka-recheck.mjs`.

## Process/environment state at dump
- My QA server on :4907 KILLED. Untouched: Arthur's server :4897 (runs PRE-wave code — needs restart to pick up wave 6), sidecars :8798 (whisper) / :8799 (kokoro) both healthy, shared.
- effect@^4.0.0-beta.71 (resolves beta.92) added to nested package.json; installed via ROOT bun (node_modules at ~/agents). 
- cmux/WKWebView browser tool tabs are HIDDEN → rAF paused → WebGL canvas black; Playwright chromium-1223 at ~/Library/Caches/ms-playwright/… with --use-angle=swiftshader works (this cost the QA agent real time; it's in the capture script header).

## Worker roster (idle/parked, revivable by IRC message)
AffectCore, WireProtocol, Reactor(dead-cancelled), BackchannelServer, VrmBodyProjection, PresenceVoiceAffect, ClientSdk (wave 1, "kimi"=actually fable — see below), RigBehaviorPanel (designer/opus), Reactor2 (gpt, wrap-up-killed at 60req, left 95%-complete reactor.ts), VrmBody2 (gpt, finished vrm-body), ReactorTest / AssistantAffect / ServerWiring (gpt, wave 2), ExpressiveQa (opus task, killed at 23m mid-notes-write; artifacts survived, I wrote notes.md/console-errors.txt from its transcript agent://ExpressiveQa).

## Operational facts learned this session (also in handoff ops section)
1. **kimi-implementer is DEAD** (subscription) and SILENTLY resolves to session model = fable-high. Arthur interjected twice: NO fable in subagents, especially not :high — use gpt or opus. Detection: `grep '"model"' ~/.omp/agent/sessions/<session>/<Worker>.jsonl | head -1`. I cancelled 6 mid-flight fable workers; their on-disk edits survived (shared tree) → resume-packets to gpt-5.5:high finished cheaply. AffectCore had already completed on fable before detection (work kept, it was good).
2. gpt-implementer (openai-codex/gpt-5.5:high): 5/6 slices clean; ONE wrap-up-kill (Reactor2) — remnant was compilable after 2-line fix. No shell in that agent: orchestrator runs all gates.
3. Effect v4 beta.92: `Effect.fork` GONE → `forkChild`/`forkScoped`/`forkIn`/`forkDetach`. Check dist/Effect.d.ts before v3 idioms.
4. task-agent QA on opus (`model: anthropic/claude-opus-4-8`) is capable (invented the sentinel round-trip proof, found the rotateVRM0 bug, pivoted cmux→Playwright) but got killed at ~23m — budget QA packets smaller or accept finishing manually.
5. Broadcast at dump time found NO live IRC peers.

## Open threads / expectations
- **Parent session will notify me over IRC with file paths when character-pipeline research lands** (feeds a LATER wave — do not block on it). Nothing received yet; inbox was empty all session.
- Digest lane not yet exercised live (QA ran echo LLM → rules-only). To feel it: `AI_COMPANION_REACTOR_LLM=gemini-cca` (or set AI_COMPANION_REACTOR_MODEL) on the stack. Unit-tested via fakes.
- Arthur's :4897 instance still runs pre-wave code; `bun run stack` restart needed for him to feel wave 6. Backchannel default ON at gain .35 — first thing he'll notice.
- Hinzka playful read "neutral/calm faint smile" at small render — ARKit playful recipe could push mouthsmile harder (taste pass candidate).
- Candidate next arcs (from GOAL/backlog, unprioritized): bench harness (latency×quality per lane), F5-TTS whisper-clone voice lane (VoiceAffect seam is ready for it), PuruPuru third body, composable scene grammar, Live2D, turn-pipeline Effect migration (deliberately deferred), backchannel palette taste pass w/ real whisper voice (af_nicole renders "heh heh." oddly sometimes — listen).
- quality-of-life: favicon 404 (add a link rel=icon or a 204 route) — trivial, not done.

## Key paths
Contract: `apps/ai-companion-rtc/docs/expressive-stack.md` · Behavior design: `streams/companion/notes/behavior-stack.md` · Handoff (has wave-6 ops lessons): `streams/companion/HANDOFF-BEHAVIOR.md` · TASKS row: T-2026-07-03-001 · Charter: `docs/fable/charter.md` · Dashboard: xanadu.localhost:1355, post via `cd apps/xanadu && bun run post`.
