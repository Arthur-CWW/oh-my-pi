# Design: Expressive motion system

**Status:** design proposal subordinate to the frozen companion motion contract  
**Scope:** browser L0 authoring, composition, interruption, affect coupling, and sequencing for semantic avatar motion  
**Boundary:** the wire protocol remains frozen; future clip and sequence structures are browser-private until a later implementation slice proves a protocol extension necessary.

## Frozen boundary and current truth

The existing wire-level motion contract is the boundary. `MotionPrimitive` is quoted exactly from `apps/ai-companion-rtc/src/server-protocol.ts:203-227`:

```ts
export type AffectSource = "self" | "user" | "world";
export type MotionPhase = "onset" | "hold" | "release";
export type MotionChannel = "face" | "eyes" | "head" | "torso" | "hands" | "voice" | "shader";
export type MotionProducer = "rules" | "social-policy" | "speaker" | "deep";
export type TimingAnchor =
  | "now"
  | "user-vad-start"
  | `user-partial:${string}`
  | `assistant-audio:${string}@${number}`
  | `absolute:${number}`;

export type MotionPrimitive = {
  name: string;
  phase?: MotionPhase;
  intensity: number;
  ttlMs: number;
  priority: number;
  channelMask: readonly MotionChannel[];
  source: AffectSource;
  producer: MotionProducer;
  confidence: number;
  timingAnchor: TimingAnchor;
};
```

The frozen expressive-stack contract says:

- **AffectVector** is a position in valence×arousal×dominance space, each component in [-1, 1].
- **EmotionMix** is named palette weights, e.g. `[{name:"ache",weight:0.6},{name:"fond",weight:0.5}]`.
- Palette names come from `personas/core.json` `emotionPalette` — NEVER hardcoded lists.
- Anchors are palette-name VAD coordinates from `personas/core.json` under `"emotionAnchors"`.
- Lanes are `sync` (L2 deliberate, timed to speech) > `react` (L1 reflex, amplitude-capped, fast decay) > `async` (idle life).
- Source (efference copy) is `self | user | world`; L1 NEVER reacts to `self`.
- A channel manifest declares what a model can express; projection fills what exists. Never assume anatomy. Alicia standard set = degraded case; hinzka ARKit-52 = high-fidelity case; ears/tails/shaders later. (Invariants and definitions: `apps/ai-companion-rtc/docs/expressive-stack.md:1-16`.)

The load-bearing handoff invariants are also frozen (`streams/companion/HANDOFF-BEHAVIOR.md:16-31`): upper layers emit typed semantic intents and **only L0 writes avatar channels**; affect is low-dimensional VAD but authored, logged, and inspected as named anchors/mixes from `personas/core.json`; movement is discrete parameterized `SocialAct` / `MotionPrimitive` commands rather than a giant continuous body vector; Mac/browser owns realtime audio capture/playback and the 60Hz body; Ubuntu GPU is an optional inference appliance reached over WebRTC/data events; deep deliberation is asynchronous and replaceable, not coupled to ChatGPT Pro, OMP, or the development harness. The current rig requirement remains live Alicia ↔ PerfectSync hot-swap and A/B presets through per-model projection profiles; policy is not rebuilt or re-prompted when the rig changes.

The behavior-stack invariants (`apps/ai-companion-rtc/docs/expressive-stack.md:275-283`) are:

1. Single writer: only L0 touches bones/expressions.
2. Pulses, not states: every intent carries intensity + TTL; stale commands decay to persona baseline.
3. sync > react on the same channel in the same window; L0 vitals never suppressed.
4. Turn token flips L1: while L2 speaks, no user-reactive intents, no backchannel.
5. One clock per layer: L0 never awaits; L1 drops rather than queues; reactor.push never blocks.
6. She never reacts to her own voice (`source:"self"` filtered in every L1 rule).

The handoff adds the full-duplex timing truth (`streams/companion/HANDOFF-BEHAVIOR.md:63-104`): simultaneous user-input and assistant-output streams; source tags preserve efference copy; sync facial/gaze/gesture anchors to the audio frame that actually reached playback; barge-in may fade assistant playback, cancel pending work, snap the body to listening, and emit interruption-safe state; capture and render clocks remain separate; the renderer never waits on network or model output; late intents may be dropped, damped, or re-anchored while L0 aliveness continues. Movement commands are task-space social commands, not actuator commands: higher layers say “nod once, softly, during this word”; L0 decides neck bones, eye compensation, blendshape accents, easing, and decay for the loaded rig. This is current-state classification plus interruptible authored primitives, not learned action-chunk prediction, flow matching, or a sequence policy.

### Current L0 body passes

`public/vrm-body.ts:827-856,1196-1401` currently executes the body passes in this order:

1. base/breath (`applyBaseLayer`),
2. idle-life (`applyIdleLifeLayer`),
3. emotion/affect pose (`applyEmotionPoseLayer`),
4. speaking (`applySpeakingLayer`),
5. gesture (`applyGestureLayer`),
6. one bone commit (`commitBoneLayers`), followed by expressions.

This is five additive body passes, **not five strict override layers**. Rotations, positions, and scales currently sum into accumulators before one bone commit. `idleDuckForBone` at `public/vrm-body.ts:1412-1425` only ducks idle on gesture-owned bones. `syncEmotionHoldsChannel` at `public/vrm-body.ts:1774-1790` gates react affect while sync affect holds a channel. No admission-time semantic channel arbiter currently replaces this additive behavior.

The current runtime shortcomings are explicit:

- `enqueueGesture` at `public/vrm-body.ts:1142-1147` and the completion path at `public/vrm-body.ts:1331-1344` use a FIFO queue rather than interruption.
- `applyGestureLayer` uses a single `pulse(progress)` at `public/vrm-body.ts:1347-1359`, not authored onset/hold/release tracks.
- `EMOTION_POSES` at `public/vrm-body.ts:304 onward` are hardcoded rig-space rotations.
- Semantic masks, priority, and phase are accepted by the protocol but are not fully enforced by L0.
- The tick currently uses `gestureQueue.shift()` and `gestureTargets.clear()`; these are migration targets, not desired final behavior.

The browser's existing speech association is authoritative. `public/app.ts:442-520` parses `assistant-audio:${utteranceId}@${anchorMs}`, remembers actual playback offsets, binds semantic intents to the playback epoch, dispatches once the actual played offset reaches the anchor, drops intents at `SEMANTIC_LATE_DROP_MS`, and damps those at or beyond `SEMANTIC_LATE_DAMP_MS`. The protocol parser requires matching utterance identity and `atMs` for audio timing (`server-protocol.ts:1044-1131`), especially the `assistant-audio:` validation at `server-protocol.ts:1100-1115`.

## Motion authoring model

Future authored assets are browser-private, precompiled semantic clips. They do not add wire-level actuator vocabulary.

```ts
type SemanticMotionClip = {
  name: string;
  defaultKind: "emotion" | "gesture" | "idle";
  defaultMask: readonly MotionChannel[];
  minIntensity: number;
  maxIntensity: number;
  phases: {
    onsetMs: number;
    holdMs: number;
    releaseMs: number;
    onsetEase: EasingId;
    holdEase: EasingId;
    releaseEase: EasingId;
  };
  tracks: ReadonlyArray<SemanticTrack>;
  rigOverrides?: Readonly<Record<string, unknown>>;
};
```

`tracks` use semantic task-space targets only:

- `gaze.azimuth`, `gaze.elevation`, `gaze.focus`
- `head.pitch`, `head.yaw`, `head.roll`
- `torso.lean`, `torso.lift`, `torso.twist`
- `shoulders.lift`, `shoulders.close`
- `hands.openness`, `hands.emphasis`
- `face.smile`, `face.browRaise`, `face.browKnit`, `face.eyeWide`, `face.squint`, `face.blush`
- `breath.depth`, `breath.rate`

Values are normalized -1..1 or 0..1 and keyframe times are normalized 0..1. The keyframe shape is:

```ts
type SemanticKeyframe = {
  at: number;
  value: number;
  ease?: EasingId;
};
```

`EasingId` is a closed set:

```ts
type EasingId =
  | "linear"
  | "smoothstep"
  | "ease-out-cubic"
  | "ease-in-out-cubic"
  | "back-out-soft"
  | "spring-critically-damped";
```

There are no arbitrary JavaScript callbacks, expressions, bone names, blendshape names, shader uniforms, unbounded spring parameters, or custom code in rig-neutral assets.

Canonical rig-neutral clips belong in a future `public/motion-clips.ts` (or a data file compiled into it). Projection calibration and optional clip overrides remain in `public/rig-profiles.ts` by profile ID. Rig-local overrides may change only semantic-to-rig gains, safety clamps, missing-channel fallback, and exceptional silhouette calibration. They must not duplicate whole libraries per avatar, and non-programmer/LLM authors do not author rig-local data. Rig-local calibration is owned by a `RigProjectionProfile`.

### Safety and compilation

The authoring safety pipeline is:

1. Validate JSON/TS against a schema.
2. Require known clip, easing, and channel names.
3. Require sorted, finite, normalized keyframes.
4. Enforce maximum duration, phase count, and keyframe count.
5. Clamp channel values and reject duplicate tracks.
6. Compile once on load into fixed arrays and channel bitmasks.
7. Preview against neutral-capability, Alicia, and Perfect Sync profiles.
8. Export a manifest/report listing degraded channels.
9. Permit LLM authors to emit only schema-constrained semantic JSON; a human previews before catalog promotion.

`ResolvedRigProfile` and `resolveRigProfile` at `rig-profiles.ts:418-576` are the projection boundary: missing bones/blendshapes drop or remap without throwing. Intensity is applied after interpolation; confidence scales or suppresses amplitude at admission; lane caps apply next; rig gains and safety ranges from `ResolvedRigProfile` apply last.

## Runtime composition, interruption, and 60Hz discipline

### Admission-time arbitration

Arbitrate per semantic channel bit, not per whole act. A `MotionPrimitive` may mask multiple channels; one act may win torso while another wins face. The ordering is:

1. unsuppressible L0 vitals;
2. sync/speaker;
3. react/rules interruption;
4. social-policy (`react` producer social-policy or lower intra-lane priority);
5. async idle.

Within an equal lane and channel, compare priority, then anchor time, then stable sequence ID. Lane order remains sync speech > react > social-policy > idle regardless of numeric priority. React remains ≤0.6 amplitude and ≤2000ms and cannot displace sync on the same channel. Social-policy cannot outrank a rules reflex merely by setting a numeric priority.

### Override and additive composition

Each track declares a composition mode:

- `override` is for gaze target, held pose/orientation, and intentional face shape;
- `additive` is for short gesture offsets, speech beats, breath accents, and micro-expression accents.

Clamp summed additive contribution before rig projection. An override establishes the channel baseline. Admitted additive accents may ride on top only if policy allows and safety headroom remains. Face ownership is regional enough for speech mouth to coexist with brow/eye/smile accents; a coarse whole-face override would break lip sync.

### Interruptions and crossfades

When a new winning override arrives mid-tween, sample the current composed semantic value once, make it the new clip's onset origin, and crossfade toward the incoming trajectory. Never snap to the new clip's authored zero. A higher-priority arrival interrupts immediately. Equal/lower priority is either co-admitted on disjoint channels, rejected, or held only while its anchor/TTL remains useful; it is never placed in an unbounded FIFO. On release or cancel, tween from the current composed value to the next winner or baseline.

On hot-swap, semantic active and scheduled acts survive, rig-local interpolation caches are discarded, and the current semantic sample is reprojected through the new profile. Missing channels degrade without throwing.

### TTL, lateness, and cancellation

TTL starts at resolved anchor admission, not receipt. Expired-before-start intents drop. TTL truncates hold first and preserves a bounded release tail only within TTL. Hard cancellation uses a short channel-specific release:

- face: 80–140ms
- eyes/head: 100–180ms
- torso/hands: 160–260ms

Late speech anchors drop or re-anchor only under an explicit lateness threshold; audio is never delayed for motion. Expired or late `assistant-audio` anchors never queue behind current gestures. Preserve exact `utteranceId`/`atMs` equality required by protocol validation. Barge-in cancels scheduled self/speaker acts by utterance/correlation while admitting the user listening reflex; source identity prevents self-reaction.

### 60Hz allocation discipline

At 60Hz, the final loop performs no `Map.clear`, queue shifts, string lookups, object creation, or waits. Compile clip names to integer IDs, masks to bits, easing to enum IDs, and tracks to struct-of-arrays typed buffers. Maintain fixed-capacity active slots and a free list. Resolve rig node/expression indices on load. Use monotonic numeric timestamps. Preallocate arbitration winners, interpolation scratch, bone accumulators, and expression targets. Event admission may allocate outside tick; the renderer never awaits. Fixed-capacity overflow drops the lowest lane/priority/confidence and oldest stale suggestion deterministically; it never allocates/grows or blocks.

The current `gestureQueue.shift()` and `gestureTargets.clear()` calls are migration targets, not desired final behavior.

## Emotion and motion coupling

Keep `AffectVector` continuous and `EmotionMix` authored and inspectable. Filter the async/persona baseline slowly (roughly 1–3s), react pulses quickly, and sync per audio anchor. Do not replace named reactions with a giant body vector.

Map the continuous axes as bounded, subtle influences:

- valence → chest openness, smile/frown floor, and movement softness;
- arousal → idle frequency, breath rate, saccade rate, onset speed, and gesture amplitude;
- dominance → vertical lift, spatial expansion, direct gaze, and head/torso uprightness.

Mood never becomes a gesture. Use bounded ranges so baseline remains a low-frequency floor.

```text
effectiveAmplitude = primitiveIntensity × confidenceGain × laneCap × moodGain(channel) × rigGain
```

Keep `moodGain` bounded (suggest 0.65–1.25). React remains hard-capped at 0.6 and ≤2s as frozen. Mood colors every clip without reversing semantic meaning or changing channel ownership:

- positive valence softens releases and smile accents;
- high arousal sharpens onset and raises bounce;
- low dominance reduces expansion and direct gaze.

Emotion baseline and discrete expression clips compose separately. Baseline is a low-frequency async floor; reactions are pulses. A sync expression override wins on owned face regions while unaffected regions retain baseline. Speech mouth remains independently authoritative so smiles and brows coexist without corrupting lip sync.

The persona source remains `apps/ai-companion-rtc/personas/core.json:1-18`: `emotionPalette` and `emotionAnchors` are the named authoring vocabulary, while the current `gesturePalette` is `['lean-in', 'retreat', 'tilt', 'breath', 'settle', 'spark']`. Handoff canonical names include `nod`, `glance-away`, `thinking-breath`, `head-tilt`, `emphasis-stroke`, `gaze-camera`, and `soften-smile`. Prefer canonical names over aliases: migrate `tilt`→`head-tilt` and `breath`→`thinking-breath` as a clean cutover when implementation begins.

## Sequencing engine and API sketches

Sequences are private browser orchestration. All emitted leaves remain `MotionPrimitive`-compatible.

```ts
type MotionAct = MotionPrimitive & {
  kind: "emotion" | "gesture" | "idle";
};

type MotionSequence = {
  id: string;
  steps: ReadonlyArray<{
    clip: string;
    phase?: MotionPhase;
    intensityScale?: number;
    start: { afterPreviousMs?: number; anchor?: TimingAnchor };
    overlapMs?: number;
    condition?: "if-channel-available";
  }>;
};
```

The existing handle remains the public boundary:

```ts
handleBody(event: VrmBodyEvent): void;
```

Internal API sketches are:

```ts
admitMotion(event: MotionAct, resolvedAnchorMs: number): void;
compileClipCatalog(profile: ResolvedRigProfile): void;
sampleMotion(nowMs: number, outputBuffers: MotionOutputBuffers): void;
cancelMotion(predicate: MotionCancelPredicate, nowMs: number): void;
```

Optionally, a later browser-only orchestration surface may expose:

```ts
playSequence(sequenceId: string, context: MotionSequenceContext): void;
```

`public/app.ts` continues resolving `assistant-audio:${utteranceId}@${atMs}` against actual playback before calling `handleBody`. Actual-played offsets, not TTS schedule, are authoritative. Exact `utteranceId`/`atMs` identity remains required at `server-protocol.ts:1073-1131` and in the browser parser.

### Example sequence

`glance-away → soften-smile → settle`:

- `glance-away` owns eyes/head with onset 140ms, hold 280ms, release 180ms.
- `soften-smile` begins 180ms into the hold and owns face; its mouth region yields to speech.
- `settle` overlaps the final 120ms and owns torso/shoulders.

New user VAD priority 3 interrupts gaze/head/torso but allows face release when disjoint. Barge-in cancels speaker-owned future steps by correlation/utterance and retargets current semantic values without a snap.

A sequence expands into fixed-capacity scheduled leaves at admission, preserving a common correlation ID and independent masks, anchors, and TTLs. Sequence state does not go on the wire unless cross-process authorship becomes necessary.

## Initial reaction catalog

This is the closed 20-name catalog. Each row includes a legal `kind`, non-empty semantic channel mask, bounded intensity range, legal timing anchors, semantic description, and status. Existing persona/contract vocabulary is marked separately from additions. Canonical names replace aliases rather than leaving compatibility aliases.

| Name | Status | Kind | Channel mask | Intensity | Timing anchors | Semantics |
|---|---|---|---|---|---|---|
| `gaze-camera` | existing frozen | `idle` | `eyes`, `head` | 0.25–0.65 | `user-vad-start`; `now` | direct attention with slow head follow |
| `glance-away` | existing frozen | `idle` | `eyes`, `head` | 0.25–0.60 | `now`; `user-partial:id` | eyes lead brief lateral drift, head follows slightly |
| `lean-in` | existing palette | `gesture` | `head`, `torso` | 0.30–0.70 | `user-vad-start`; `assistant-audio:id@ms` | attention/secret emphasis |
| `settle` | existing palette | `gesture` | `torso`, `hands` | 0.20–0.60 | `now`; `absolute:ms` | shoulder release and return to listening baseline |
| `spark` | existing palette | `gesture` | `face`, `head`, `torso` | 0.25–0.55 | `user-partial:id`; `assistant-audio:id@ms` | brief brow/eye/chest energy accent |
| `retreat` | existing palette | `gesture` | `eyes`, `head`, `torso` | 0.25–0.65 | `now`; `assistant-audio:id@ms` | small protected pull-back, not rejection |
| `head-tilt` | handoff canonical; clean-cutover replacement for palette `tilt` | `gesture` | `eyes`, `head` | 0.20–0.60 | `now`; `user-partial:id` | curiosity with eye compensation |
| `thinking-breath` | handoff canonical; clean-cutover replacement for palette `breath` | `gesture` | `eyes`, `head`, `torso` | 0.20–0.55 | `now`; `absolute:ms` | down/up gaze plus chest inhale and held pause |
| `nod` | handoff canonical, needs catalog implementation | `gesture` | `head` | 0.20–0.60 | `user-partial:id`; `assistant-audio:id@ms` | single acknowledgment; non-semantic when user-sourced |
| `emphasis-stroke` | handoff canonical, needs catalog implementation | `gesture` | `head`, `torso`, `hands` | 0.25–0.75 | `assistant-audio:id@ms` | speech beat with optional one-hand accent |
| `soften-smile` | handoff canonical, needs catalog implementation | `emotion` | `face`, `eyes` | 0.15–0.55 | `now`; `assistant-audio:id@ms` | mouth corners/cheeks/brow soften, mouth region yields to speech |
| `surprise-lean-back` | new closed vocabulary | `gesture` | `face`, `eyes`, `head`, `torso` | 0.35–0.80 | `user-partial:id`; `now` | eyes lead, torso retreats, quick onset/soft recovery |
| `delighted-bounce` | new closed vocabulary | `gesture` | `face`, `head`, `torso`, `hands` | 0.35–0.75 | `user-partial:id`; `assistant-audio:id@ms` | one or two damped vertical pulses, never infinite bob |
| `thinking-gaze-up` | new closed vocabulary | `idle` | `eyes`, `head` | 0.20–0.55 | `now`; `absolute:ms` | eyes lead upward and lateral, modest head follow |
| `embarrassed-look-away` | new closed vocabulary | `emotion` | `face`, `eyes`, `head`, `torso` | 0.25–0.65 | `now`; `assistant-audio:id@ms` | averted gaze, slight tuck, asymmetric shy smile |
| `skeptical-squint` | new closed vocabulary | `emotion` | `face`, `eyes`, `head` | 0.20–0.55 | `user-partial:id`; `now` | asymmetric brow/squint plus very small tilt |
| `relieved-exhale` | new closed vocabulary | `gesture` | `face`, `eyes`, `head`, `torso` | 0.25–0.65 | `now`; `assistant-audio:id@ms` | shoulder/chest release, lid soften, downward then camera gaze |
| `sympathetic-wince` | new closed vocabulary | `emotion` | `face`, `eyes`, `head`, `torso` | 0.15–0.45 | `user-partial:id`; `now` | brief brow knit/eye narrow and tiny protective curl |
| `playful-shrug` | new closed vocabulary | `gesture` | `face`, `head`, `torso`, `hands` | 0.25–0.65 | `assistant-audio:id@ms`; `now` | asymmetric shoulder lift, palms only if available |
| `awe-freeze` | new closed vocabulary | `emotion` | `face`, `eyes`, `head`, `torso` | 0.30–0.70 | `user-partial:id`; `now` | brief eye/brow opening and reduced idle, breath remains |

## Differentiator and quality bar

Embodiment is an additional low-latency communication channel: acknowledgment before words, visible attention while listening, emotional congruence across face/gaze/posture/voice, and continuity during model/network latency. The edge is not “more animation”; it is trustworthy, source-aware, interruptible social timing that audio-only systems cannot show.

Minimum alive bar:

- first visible acknowledgment under 300ms measured from user cue;
- motion anchored to actual-played audio;
- no pose snap on interruption;
- eyes/head/torso lead-lag rather than moving as one block;
- breathing/blinking never freeze;
- reaction variety avoids obvious loops;
- baseline mood is visible but subtle;
- silence retains life;
- missing rig channels degrade gracefully;
- every motion can be interrupted;
- no self-reaction;
- no semantic agreement before comprehension.

Uncanny failure modes are simultaneous maximal channels, perpetual eye contact, symmetric hands, random gestures unrelated to anchors, lip-sync corruption, queued stale gestures, identical timing/easing, mood flipping rather than blending, and avatar-specific tuning leaking into policy.

## Phased implementation plan

### Slice 1 — catalog/compiler + preview

Independently ship authored semantic clips and validation without changing behavior.

**Acceptance:** 20 clips compile; invalid/unsafe examples reject; neutral/Alicia/PerfectSync capability report; dashboard markdown/profile proof.

**Luna-safe:** schema fixtures, catalog transcription, validation tests.  
**Judgment:** normalized semantic targets, easing, amplitude/timing.

### Slice 2 — interruptible channel arbiter

Replace FIFO while reusing current body passes.

**Acceptance:** mid-tween takeover has no discontinuity beyond an agreed angular/value threshold; lane/mask/priority matrix proven; TTL/late anchors drop; vitals survive; zero per-frame allocations measured; dashboard trace/video.

**Luna-safe:** tables, deterministic fixtures, debug serialization.  
**Judgment:** crossfade semantics and channel composition.

### Slice 3 — continuous affect coupling and regional face composition

**Acceptance:** the same reaction visibly differs under `hush`, `playful`, `ache`, `sly` while retaining identity; speech mouth remains valid; Alicia/PerfectSync A/B both degrade safely; dashboard side-by-side clips.

**Luna-safe:** numeric boundary tests and A/B capture scripting.  
**Judgment:** gain curves and uncanny thresholds.

### Slice 4 — sequence scheduler + speech/barge-in synchronization

**Acceptance:** `glance-away → soften-smile → settle` chains from actual-played anchors; barge-in cancels future speaker steps and retargets current values without snap; stale/correlated events cannot animate; dashboard synchronized recording plus protocol trace.

**Luna-safe:** sequence fixtures, correlation plumbing, trace formatting.  
**Judgment:** overlap choreography and lateness policy.

### Slice 5 — catalog taste pass and author workflow

**Acceptance:** a non-programmer can author one safe reaction from a template, preview across all profiles, and promote it; measured reaction diversity/timing review; Arthur selects art direction and speech-override policy via Xanadu.

**Luna-safe:** docs/templates/catalog lint.  
**Judgment:** curation, art direction, final amplitudes.

## Assumptions and non-negotiable edge cases

- The user's requested design entry is a design-labeled card, not a new unsupported `FeedKind`: use Xanadu `--kind note` and a `Design:` title rather than changing the Xanadu schema.
- The frozen wire contract remains unchanged. New clip/keyframe/sequence types are browser-private authoring/runtime structures until a later implementation slice proves a protocol extension necessary.
- Reaction names form a closed catalog validated where authored/loaded even though `MotionPrimitive.name` is currently only a non-empty string at `server-protocol.ts:512-549`. Contract additions mean adding names to the persona `gesturePalette`/L0 semantic catalog, not changing `MotionPrimitive` fields.
- Priority convention follows observed emitters: speaker sync uses priority 2, listening interruption uses 3, rules react uses 1, defaults use 0. Higher wins within a lane/channel; lane order remains sync speech > react > social-policy > idle regardless of numeric priority.
- Non-programmer/LLM authoring targets rig-neutral semantic clips. Rig-local overrides remain optional projection calibration owned by a `RigProjectionProfile`, never authored by LLMs.
- A `MotionPrimitive` can mask multiple channels; arbitration splits ownership per channel rather than rejecting or accepting whole acts.
- A higher-priority pose arriving halfway through onset/hold/release begins from the currently composed pose, including mood baseline and additive accents, not the prior clip's authored origin.
- Expired or late `assistant-audio` anchors never queue behind current gestures. Preserve exact `utteranceId`/`atMs` equality required by protocol validation.
- Barge-in cancels scheduled self/speaker acts by utterance/correlation while admitting user listening reflex; source identity prevents self-reaction.
- Hot-swap keeps semantic active/scheduled acts but discards rig-local interpolation caches and reprojects from the current semantic sample; missing channels degrade without throwing.
- Face ownership is regional enough for speech mouth to coexist with brow/eye/smile accents; a coarse whole-face override would break lip sync.
- React remains ≤0.6 and ≤2000ms and cannot displace sync on the same channel. Social-policy cannot outrank rules reflex merely by setting a numeric priority.
- Blink, breath, and saccades remain alive during `awe-freeze`; freeze reduces discretionary idle rather than creating literal stillness.
- Fixed-capacity active slots use deterministic overflow: drop lowest lane/priority/confidence and oldest stale suggestion; never allocate/grow or block.
- LLM-authored clips carry no raw bone/expression/shader identifiers, custom code, unbounded spring parameters, negative durations, unsorted keyframes, or undeclared channels.

## Verification contract

- **Document review:** every proposed API is labeled browser-private/future; no frozen protocol field is renamed or extended; every real symbol/path is cited.
- **Catalog audit:** exactly 20 canonical names; each has kind, non-empty `MotionChannel` mask, bounded intensity range, legal `TimingAnchor` patterns, semantic description, and existing/new status.
- **Contract audit:** against `server-protocol.ts`, no illegal channel, source, producer, phase, or anchor forms; sync audio examples include matching `utteranceId` and `atMs`.
- **Runtime design audit:** against `vrm-body.ts`, all five existing passes, current additive behavior, idle ducking, react suppression, FIFO limitation, and single commit are represented accurately.
- **Rig audit:** against `rig-profiles.ts`, neutral/Alicia/PerfectSync/blender-donor remain peers; safety ranges, gains, toggles, manifest degradation, and hot-swap are preserved; no winner is chosen.
- **Posting verification:** use `cd apps/xanadu && bun run post -- ...`; observe four JSON outputs and record UUIDs. No gate/build/test commands are needed because this assignment is documentation/posting only.

## Source map

- `apps/ai-companion-rtc/docs/expressive-stack.md:1-183,217-283`
- `streams/companion/HANDOFF-BEHAVIOR.md:16-31,63-116,144-159`
- `apps/ai-companion-rtc/src/server-protocol.ts:203-227,295-319,490-549,1044-1131`
- `apps/ai-companion-rtc/public/vrm-body.ts:268-380,582-684,827-856,1135-1425,1700-1810`
- `apps/ai-companion-rtc/public/rig-profiles.ts:1-136,264-576`
- `apps/ai-companion-rtc/public/app.ts:442-520`
- `apps/ai-companion-rtc/personas/core.json:1-18`
- `apps/xanadu/src/post.ts:13-38,97-183`
- `apps/xanadu/package.json:6-11`
