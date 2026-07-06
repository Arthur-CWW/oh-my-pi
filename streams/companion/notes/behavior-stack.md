# The behavior stack — concurrency design for a body with a mind

Thinking session with Arthur, 2026-07-06. Question: multiple models at different speeds all want to drive one body/voice — how do we layer them without stumbling over ourselves? Is the multi-agent lens right?

## The analogous solved problems (this HAS been solved, four times)

1. **Robotics — subsumption / hierarchical control** (Brooks '86 → modern humanoids, e.g. Figure's Helix). Balance/brace reflexes at kHz, gait at 100Hz, planner at 1Hz, VLM policy at <1Hz. Higher layers *steer* lower ones by setting targets/gains; they never bypass them to drive actuators. Lower layers keep working when higher ones stall — the robot never falls over because the LLM is thinking.
2. **Game character animation** — the closest match to our actual code. Layered blend trees: locomotion < additive gestures < facial < IK, per-bone masks, priorities, ducking. The cardinal rule: **behavior systems emit intents; only the animation system touches the skeleton.**
3. **Human motor control** — cortex does not drive muscles. Spinal reflexes (ms) are uninterruptible; brainstem pattern generators own breath/blink/saccades autonomously; cortex *modulates* those generators (sets gains, targets). System 1/System 2 is the cognitive shadow of this, but the deeper principle is **authority gradients across timescales**: fast layers own execution, slow layers own direction.
4. **VTubing/character AI stacks** (Inworld, NVIDIA ACE): LLM (slow) → emotion/gesture tags → animation graph (fast, autonomous idle). Exactly our `<|emotion:|>` markers.

## Where the multi-agent lens fits — and where it misleads

- **Fits at the top.** L2 (the conversationalist) and L3 (the director) genuinely are agents: they have roles, context, goals; you could swap models per persona or give the director veto power. Orchestrator/sub-agent intuitions apply.
- **Misleads at the bottom.** Multi-agent systems coordinate by *negotiation* — messages, turns, consensus. A body cannot negotiate at 60fps. The bottom needs **deterministic arbitration**: fixed priorities, per-bone masks, decay. If two "agents" argue over the neck bone, the character dies on screen.
- **Synthesis: agents propose, the body disposes.** Agents at the top, control layers at the bottom, and the boundary between them is a single typed **intent bus**. That's the whole trick.

## The stack

| Layer | What | Rate | Runs on | Owns |
|---|---|---|---|---|
| **L0 Body** | blender, breath/blink/saccades/sway, mouth-from-RMS, decay-to-baseline | 60Hz | browser, no model | the skeleton — *sole writer* |
| **L1 Reactor** | watches the live stream (VAD, partials, energy, silence) WHILE Arthur talks; emits reactive pulses: gaze, lean-in, nods, emotion flickers, backchannel cues | 2–5Hz | rules v0 → flash-lite later | immediacy |
| **L2 Speaker** | the conversation; text + inline `<\|emotion\|>/<\|gesture\|>` markers, streamed, sentence→TTS pipelined | per turn | gemini-cca (persona) | meaning |
| **L3 Director** | persona arc, scene mode, memory; sets L1 gains + L2 prompt/mood | episodic | any/slow | direction |

Status: **L0 built** (vrm-body.ts layer blender: base<idle<emotion<speaking<gesture, ducking, decay). **L2 built** (markers + streaming parser + sync body events). **L1/L3 not yet** — L1 v0 should be ~20 lines of RULES (non-pessimization: same intent bus, model swaps in later).

## The don't-stumble rules

1. **Single writer.** Nothing above L0 touches bones/expressions. Intents only.
2. **Pulses, not states.** Every intent carries intensity + TTL/decay. Stale commands self-heal to persona baseline; conflicting writers can't wedge the body.
3. **Priorities + masks + ducking.** sync (deliberate) beats react (reflex) on the same channel in the same window — cortex suppresses reflex — EXCEPT L0 vitals (breath, blink) which nothing can suppress.
4. **Turn token flips L1's role.** While L2 speaks, L1 stops reacting-to-user and starts accompanying-the-speech (emphasis, bobs). On barge-in, L1 snaps the body back to listening instantly while L2 aborts (interrupt path exists).
5. **One clock per layer, no cross-blocking.** L0 never awaits; L1 drops frames rather than queueing; L2 latency only affects words, never aliveness.

## Wire shape (mostly exists)

- Upstream events: `vad.state`, `stt.partial`, `user.energy@5Hz`, `silence.ms` — all already flow server-side.
- Intent: existing `body` event; `lane` gains `'react'` alongside `'sync'|'async'`. `{lane, kind, name, intensity, ttlMs?, utteranceId?, atMs?}`.
- L1 v0 rules (server-side, subscribe to the same taps SessionLog uses): VAD start → gaze-to-camera + micro lean-in; energy spike → brow/awe flicker; silence >2.5s while listening → glance-away + settle; user laughter/exclamation partial → playful flicker; every rule = one intent pulse.

## What we're optimizing (named, per Arthur's ask)

1. **Aliveness** — zero dead frames; guaranteed by L0 alone. *Decoupled from model latency by construction.*
2. **Reaction latency** — user event → visible acknowledgment < 300ms. Only L1 (or L0 heuristics) can hit this; L2 never can.
3. **Speech latency** — eos → first audio (measured; ~100ms local + LLM TTFT).
4. **Coherence** — body matches words exactly when words land (sync markers timed to TTS).
5. **Swap-ability** — every layer hot-swappable independently (doctrine).

Tension to watch: L1 reactivity vs L2 coherence — if L1 emotes too strongly during Arthur's turn, L2's opening emotion can contradict it. Mitigation: L1 amplitude cap + fast decay; L2's first marker takes the channel.

## Open forks (Arthur's taste)

- **Backchannel audio** from L1 ("mm", soft laugh) — huge presence win, but risks talking over him. Ship gated behind a Rig toggle?
- **Where L1 runs** — server-side rules now; later a flash-lite stream or a tiny local model (latency vs cost vs privacy — all fine local-first).
- **L3 timing** — defer until scenes/memory arrive; premature directors are how systems get baroque.

## Brain models — what theory to steal from (session 2, 2026-07-06)

Arthur asked: best model of how the brain does this? Answer: **hierarchical predictive processing** (Rao & Ballard → Clark) with **active inference** (Friston) as the strong form; plus three unglamorous classics that are more load-bearing than FEP itself.

- **Predictions down, errors up, timescales separate the levels.** Nobody commands; higher levels set expectations lower levels reconcile. Active inference's motor move: cortex sends *proprioceptive predictions* ("arm is already there"), reflex arcs fulfill them. → Our L2/L3 set setpoints; L0/L1 fulfill; decay-to-baseline = homeostasis.
- **Precision weighting = attention = gain knobs.** → One reactivity gain per layer, L3-turnable, Rig-exposed (scene mode damps L1; banter cranks it).
- **Efference copy** (Wolpert): never startle at yourself. → Bus events gain `source: self|user|world`; L1 ignores self-generated audio/motion. *Most practical single steal.*
- **Global Workspace** (Baars/Dehaene): parallel processors, one serial broadcast. → Many L1 detectors, one L2 stream, the intent bus as mini-workspace.
- **Society of Mind** (Minsky): Arthur's multi-agent intuition, 40y early; stalls exactly where arbitration is unspecified — arbitration is the whole game (hence L0 blender).
- **FEP honesty**: a principle, not a mechanism; contested as unfalsifiable. Architecture generator, not gospel.
- **Where to ignore brains**: we build a *performance*, not a mind — animation's 12 principles (anticipation, follow-through, secondary action) are the quality bar; eyes grade the output, not theory.
- **Convergence argument**: our constraints (expensive slow deliberation + cheap fast loops + hard latency floors) are evolution's constraints; the brain-shaped answer re-derives itself in robotics/games because it's convergent, not copied.

Readings: Clark *Surfing Uncertainty*; Wolpert internal models; Friston 2010 review (optional pain).

Next-wave cheap wins from theory: `source` tag on bus events (efference copy), per-layer precision/gain knobs, L1 rules v0 with salient-observation injection into L2 context.
