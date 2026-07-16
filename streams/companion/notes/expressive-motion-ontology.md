# Vocabulary: expressive motion ontology

A working language for pointing at realtime expressive behavior. This document names the system; [Design: Expressive motion system](./expressive-motion-design.md) specifies how to build it. Terms are grouped by orthogonal axes so a critique can name who acted, what won, what moved, when, how strongly, on which rig, from which state, and how it felt.

## 1. Producers — who moves her

See design spec: [Frozen boundary and current truth](./expressive-motion-design.md#frozen-boundary-and-current-truth) and [Runtime composition, interruption, and 60Hz discipline](./expressive-motion-design.md#runtime-composition-interruption-and-60hz-discipline).

| Term | Definition | Repo anchor | Arthur would say… |
|---|---|---|---|
| **L0 projector** | Deterministic 60Hz sole writer that turns semantic intent into rig channels; it is an authority tier, not a `MotionProducer`. | `public/vrm-body.ts` `VrmBodyHandle`; `docs/expressive-stack.md` “Browser — public/vrm-body.ts (L0 stays sole writer)” | “L0 keeps the blink alive, but its head projection feels stiff.” |
| **rules reflex** | L1 event-driven, model-free producer for the latency-critical listening and interruption path, targeting a visible response under 300ms. | `src/server-protocol.ts` `MotionProducer` value `rules`; `src/reactor.ts` `ReactorInput` / `ReactorIntent` | “The rules-reflex gaze lands late after user VAD.” |
| **social policy** | L1.5 optional 2–5Hz producer that reads a short digest and suggests bounded affect, observation, or backchannel policy without outranking reflexes. | `src/server-protocol.ts` `MotionProducer` value `social-policy`; `src/reactor.ts` `ReactorDigest` / `DigestVerdict` | “The social-policy pulse is apt, but it arrives after the moment has passed.” |
| **speaker sync** | L2 streaming conversational producer that emits deliberate affect or gesture tags tied to its utterance and actual playback. | `src/server-protocol.ts` `MotionProducer` value `speaker`; `personas/core.json` `tagGrammar` | “The speaker-sync smile should peak on ‘stay,’ not at sentence start.” |
| **deep** | Out-of-band asynchronous provenance for deliberated suggestions; its result is epoch-fenced and must never directly drive L0. | `src/server-protocol.ts` `MotionProducer` value `deep`; `src/deep-delegate.ts` `DeepDelegateStateV1` | “This deep suggestion is stale; suppress it rather than animating it.” |

## 2. Lanes and arbitration — whose motion wins

See design spec: [Admission-time arbitration](./expressive-motion-design.md#admission-time-arbitration), [Override and additive composition](./expressive-motion-design.md#override-and-additive-composition), and [Interruptions and crossfades](./expressive-motion-design.md#interruptions-and-crossfades).

| Term | Definition | Repo anchor | Arthur would say… |
|---|---|---|---|
| **sync lane** | Speech-timed deliberate motion; highest semantic lane on an owned channel. | `src/server-protocol.ts` `BodyEvent.lane`; `public/vrm-body.ts` `syncAffects` | “The sync-lane brow accent should hold through the stressed syllable.” |
| **react lane** | Fast user/world reaction lane, amplitude- and TTL-capped, which yields to sync on channel conflict. | `src/server-protocol.ts` `BodyEvent.lane`; `public/vrm-body.ts` `REACT_MAX_INTENSITY` / `REACT_MAX_TTL_MS` | “The react-lane nod overshoots on onset at high arousal.” |
| **async lane** | Low-frequency idle/persona life that fills unowned channels and yields to deliberate or reactive acts. | `src/server-protocol.ts` `BodyEvent.lane`; `src/server-assistant.ts` `ASYNC_IDLE_NAMES` | “The async sway is too busy while she listens.” |
| **channel ownership** | Per-channel admission result: one act may win head while another simultaneously wins face. | `src/server-protocol.ts` `MotionPrimitive.channelMask`; `public/vrm-body.ts` `syncEmotionHoldsChannel` | “Let sync own face, but keep the react turn in head and torso.” |
| **priority** | Deterministic tie-breaker within a lane/channel; it cannot overturn lane order. | `src/server-protocol.ts` `MotionPrimitive.priority` | “Raise the listening reflex within react priority, not above sync.” |
| **override** | Composition mode that establishes the intentional baseline for an owned semantic channel. | Design spec `Override and additive composition`; current boundary `MotionPrimitive.channelMask` | “The held gaze should override idle drift, not add to it.” |
| **additive accent** | Short offset layered over an admitted baseline when policy and safety headroom permit. | `public/vrm-body.ts` `addBoneRotation` / `addExpressionTarget` | “Keep the speech beat additive so it does not erase the warm baseline.” |
| **vitals** | Unsuppressible L0 aliveness: blink, breath, and saccades continue even under freeze or channel ownership. | `public/vrm-body.ts` `blinkWeight`, `applyBaseLayer`, `startSaccade` | “The awe freeze killed the vitals; breath and saccades must never yield.” |

## 3. Channels — what moves

See design spec: [Motion authoring model](./expressive-motion-design.md#motion-authoring-model) and [Safety and compilation](./expressive-motion-design.md#safety-and-compilation).

The seven **semantic channels** are task-space ownership domains in `src/server-protocol.ts` `MotionChannel`; they are not rig actuators.

| Term | Definition | Repo anchor | Arthur would say… |
|---|---|---|---|
| **face** | Brows, cheeks, mouth-adjacent emotion, and other facial expression intent. | `src/server-protocol.ts` `MotionChannel` value `face`; `public/vrm-body.ts` `applyAffectExpressionChannel` | “The face channel reads fond, but the brow is too symmetrical.” |
| **eyes** | Gaze, eye openness, and eye-led attention intent. | `src/server-protocol.ts` `MotionChannel` value `eyes`; `public/vrm-body.ts` `applyGaze` | “Eyes should lead this glance before head follows.” |
| **head** | Head pitch, yaw, roll, and head-led gesture intent. | `src/server-protocol.ts` `MotionChannel` value `head`; `public/vrm-body.ts` `addBoneRotation` | “The head channel snaps back before release finishes.” |
| **torso** | Chest, spine, hips, lean, lift, twist, and breathing-related body intent. | `src/server-protocol.ts` `MotionChannel` value `torso`; `public/vrm-body.ts` `applyBaseLayer` / `applyEmotionPoseLayer` | “Give the react pulse less torso and more eyes.” |
| **hands** | Hand and arm emphasis, openness, and settling intent. | `src/server-protocol.ts` `MotionChannel` value `hands`; `public/rig-profiles.ts` `MotionGainConfig.hands` | “The hands channel is dead on Alicia, so degrade the emphasis cleanly.” |
| **voice** | Semantic ownership of vocal expression and output gain, distinct from visual projection. | `src/server-protocol.ts` `MotionChannel` value `voice`; `src/affect.ts` `VoiceAffect` | “The voice channel is hushed while face still reads high arousal.” |
| **shader** | Material-level expressive intent such as blush or emissive accents. | `src/server-protocol.ts` `MotionChannel` value `shader`; `public/rig-profiles.ts` `RigManifest.shaderParams` | “The shader blush bleeds into a neutral hold.” |
| **blendshape target** | Rig-local expression weight selected beneath a semantic channel; only L0 writes it. | `public/rig-profiles.ts` `RigManifest.blendshapes`; `public/vrm-body.ts` `expressionManager.setValue` | “The smile blendshape saturates before the semantic face intensity does.” |
| **bone target** | Rig-local transform selected beneath a semantic channel; only L0 writes it. | `public/rig-profiles.ts` `RigManifest.bones`; `public/vrm-body.ts` `commitBoneLayers` | “The head intent projects too much into the neck bone.” |
| **shader parameter target** | Rig-local material parameter selected beneath semantic shader intent; only L0 may write it. | `public/rig-profiles.ts` `RigManifest.shaderParams` / `RigSafetyRanges.shaderParams` | “Clamp that shader parameter; the blush should stay perceptual, not luminous.” |

## 4. Time — when it moves

See design spec: [Interruptions and crossfades](./expressive-motion-design.md#interruptions-and-crossfades) and [TTL, lateness, and cancellation](./expressive-motion-design.md#ttl-lateness-and-cancellation).

| Term | Definition | Repo anchor | Arthur would say… |
|---|---|---|---|
| **timing anchor** | Clock reference resolving when an intent becomes eligible: now, user VAD, user partial, played assistant audio, or absolute monotonic time. | `src/server-protocol.ts` `TimingAnchor`; `public/app.ts` `parseAssistantAudioAnchor` | “Anchor the soften-smile to actual assistant audio, not receipt time.” |
| **onset** | Entry phase from the currently composed value toward the intended act. | `src/server-protocol.ts` `MotionPhase` value `onset` | “The nod onset is too abrupt at low intensity.” |
| **hold** | Sustained phase in which the act maintains its readable intention. | `src/server-protocol.ts` `MotionPhase` value `hold` | “The gaze hold is long enough to feel like staring.” |
| **release** | Exit phase from the current act toward the next winner or baseline. | `src/server-protocol.ts` `MotionPhase` value `release` | “Soften the release; she is dropping the expression.” |
| **envelope** | Time-varying 0..1 weight shaping an act across attack and decay. | `public/vrm-body.ts` `affectEnvelope` / `VrmBodyDebugSnapshot.syncPulses[].envelope` | “The envelope peaks correctly but vanishes too sharply.” |
| **attack** | Rising portion of an envelope or smoothing response. | `public/vrm-body.ts` `EMOTION_ATTACK_SECONDS` / `MOUTH_ATTACK_SECONDS` | “Shorten the eye attack without making the head snap.” |
| **decay** | Falling influence toward baseline while an intent remains within its lifetime. | `public/vrm-body.ts` `EMOTION_DECAY_MS` / `affectEnvelope` | “The react decay lingers after the user has moved on.” |
| **TTL** | Hard validity horizon measured from resolved-anchor admission; expired motion must not queue. | `src/server-protocol.ts` `MotionPrimitive.ttlMs` | “The partial-based glance missed its TTL; drop it.” |
| **cadence** | Frequency at which a producer samples or emits decisions, distinct from 60Hz projection. | `src/reactor.ts` `ReactorOptions.digestIntervalMs`; `src/server.ts` `sttPartialCadenceMs` | “The social-policy cadence is too slow for this back-and-forth.” |
| **tween** | Continuous interpolation from one semantic sample to another. | `public/vrm-body.ts` `THREE.MathUtils.lerp` calls; design spec `Interruptions and crossfades` | “The head tween is smooth, but it starts from the authored zero.” |
| **interruption** | Replacement or cancellation that samples current composition and retargets without FIFO delay or a snap. | `src/server-protocol.ts` `InterruptEvent`; `public/vrm-body.ts` `handleBody` | “Interrupt the old nod from its current pose; do not queue the new one.” |

## 5. Magnitude — how much

See design spec: [Safety and compilation](./expressive-motion-design.md#safety-and-compilation) and [Emotion and motion coupling](./expressive-motion-design.md#emotion-and-motion-coupling).

| Term | Definition | Repo anchor | Arthur would say… |
|---|---|---|---|
| **intensity** | Authored 0..1 semantic strength before confidence, lane, mood, and rig scaling. | `src/server-protocol.ts` `MotionPrimitive.intensity` | “Keep the intention, but bring intensity down to a whisper.” |
| **confidence** | Producer certainty used to attenuate or reject amplitude at admission, not a second intensity. | `src/server-protocol.ts` `MotionPrimitive.confidence` | “Low-confidence awe should tint the pose, not take ownership.” |
| **amplitude cap** | Hard lane or channel ceiling that bounds effective motion regardless of requested intensity. | `public/vrm-body.ts` `REACT_MAX_INTENSITY`; design spec `Admission-time arbitration` | “The reflex is expressive enough; keep it under the react amplitude cap.” |
| **gain** | Calibrated multiplier applied by behavior, face, motion, or rig projection controls. | `public/rig-profiles.ts` `FaceGainConfig` / `MotionGainConfig`; `src/reactor.ts` `setGain` | “Lower head gain on Alicia without weakening the semantic nod.” |
| **safety range** | Rig-local min/max clamp protecting blendshapes, bones, and shader parameters. | `public/rig-profiles.ts` `SafetyRange` / `RigSafetyRanges` | “The shoulder lift is legal semantically but outside this rig’s safety range.” |

## 6. Identity and projection — on whom

See design spec: [Safety and compilation](./expressive-motion-design.md#safety-and-compilation) and [Interruptions and crossfades](./expressive-motion-design.md#interruptions-and-crossfades).

| Term | Definition | Repo anchor | Arthur would say… |
|---|---|---|---|
| **rig profile** | Named calibration mapping semantic intent into one avatar family’s capabilities, gains, toggles, and clamps. | `public/rig-profiles.ts` `RigProjectionProfile` / `RigProfileId` | “This rig profile makes the same fond pulse too broad.” |
| **channel manifest** | Runtime inventory of available blendshapes, bones, look-at, audio-mouth, shaders, and safety data. | `public/vrm-body.ts` `ChannelManifest`; `public/rig-profiles.ts` `RigManifest` | “The manifest says eyes are absent, so head-only gaze is expected.” |
| **degradation** | Deterministic drop, remap, or fallback when a rig lacks a requested projection target, without throwing or inventing anatomy. | `public/rig-profiles.ts` `ResolvedRigProfile.fallbackReasons` / `collectFallbackReasons` | “The smile degradation is graceful, but gaze degradation looks dead.” |
| **hot-swap** | Live replacement of avatar/profile while semantic active and scheduled acts retain their meaning. | `public/vrm-body.ts` `loadModel` / `setProfileOverride`; `public/avatar-catalog.ts` `RuntimeAvatarCatalogEntry` | “Hot-swap during the hold; the affect should survive the model change.” |
| **reprojection** | Re-resolving retained semantic state through the active rig profile after load or override. | `public/vrm-body.ts` `reprojectSemanticState` / `reprojectAffectChannel` | “Reprojection preserved the mix but doubled the smile amplitude.” |

## 7. State — what she feels

See design spec: [Emotion and motion coupling](./expressive-motion-design.md#emotion-and-motion-coupling).

| Term | Definition | Repo anchor | Arthur would say… |
|---|---|---|---|
| **AffectVector / VAD** | Continuous affect position with valence, arousal, and dominance components, each in [-1,1]. | `src/affect.ts` `AffectVector` | “Keep valence warm, lower arousal, and leave dominance neutral.” |
| **valence** | Pleasant↔unpleasant axis that subtly colors softness, openness, and smile/frown floor. | `src/affect.ts` `AffectVector.valence`; `personas/core.json` `emotionAnchors.*.valence` | “The pose reads negative valence even though the line is fond.” |
| **arousal** | Low-energy↔activated axis that colors onset speed, breath/saccade rate, and bounded amplitude. | `src/affect.ts` `AffectVector.arousal`; `personas/core.json` `emotionAnchors.*.arousal` | “High arousal is making every onset too sharp.” |
| **dominance** | Yielding↔expansive axis that colors lift, space, uprightness, and direct gaze. | `src/affect.ts` `AffectVector.dominance`; `personas/core.json` `emotionAnchors.*.dominance` | “Reduce dominance; the direct gaze feels confrontational.” |
| **EmotionMix** | Inspectable weighted combination of named persona emotions, preserved alongside its VAD projection. | `src/affect.ts` `EmotionMix`; `parseEmotionMix` | “Make this mostly hush with a trace of fond, not a new hardcoded state.” |
| **emotion anchor** | Persona-owned named VAD coordinate used to turn an `EmotionMix` into an `AffectVector`. | `personas/core.json` `emotionAnchors`; `src/affect.ts` `mixToVector` | “The awe anchor has the right arousal but too little yielding.” |
| **mood baseline** | Slowly varying persona home state: a low-frequency floor, never a gesture or channel owner. | `personas/core.json` `personas[].moodBaseline`; `public/vrm-body.ts` `setMood` / `moodTargets` | “The hush mood baseline should color the release, not hold the face.” |
| **pulse** | Temporary intensity+TTL affect or motion contribution that rises and decays back to baseline. | `src/reactor.ts` `DigestVerdict.pulse`; `public/vrm-body.ts` `AffectChannel` | “The fond pulse is right; its decay is the part that feels synthetic.” |

## 8. Quality language — how it feels

These are review terms, anchored to the runtime mechanism most likely to produce the smell.

| Term | Definition and failure smell | Repo anchor | Arthur would say… |
|---|---|---|---|
| **latency-feel** | Perceived immediacy and causal timing; smell: a correct reaction feels late, anticipatory, or detached from its cue. | `public/app.ts` assistant-audio anchor dispatch; `src/turn-latency.ts` `CompletedTurnLatency` | “Latency-feel is off: eyes acknowledge me after the spoken reply starts.” |
| **congruence** | Agreement of voice, face, gaze, and pose on one readable intention; smell: channels imply conflicting affect or emphasis. | `src/affect.ts` `vectorToVoice`; `public/vrm-body.ts` `setAffect` | “Congruence breaks here: the voice hushes while face and torso brighten.” |
| **legibility** | Ease of reading the intended social act without explanation; smell: motion is too weak, noisy, or ambiguous to name. | `src/server-protocol.ts` `MotionPrimitive.name` / `channelMask` | “The glance-away lacks legibility; it reads as eye jitter.” |
| **aliveness** | Continuous subtle self-motion independent of commanded acts; smell: mannequin stillness, identical cycles, or vitals suppressed by a pose. | `public/vrm-body.ts` `applyIdleLifeLayer`, `blinkWeight`, `startSaccade` | “Aliveness disappears during the long hold; keep micro-saccades and breath.” |
| **uncanny** | Motion that is technically active but violates biological or social expectation; smell: synchronized periodicity, impossible coupling, stare, or rubbery motion. | `public/vrm-body.ts` `applyIdleLifeLayer` / `applyGaze` | “The perfectly periodic sway is uncanny, not alive.” |
| **overshoot** | Motion travels beyond the intended semantic target before settling; smell: bounce reads comic, mechanical, or too forceful. | `public/vrm-body.ts` `pulse` / gesture rotations | “The react-lane nod overshoots on onset at high arousal.” |
| **snap** | Visible discontinuity in value or velocity; smell: a channel pops at admission, interruption, release, or swap. | `public/vrm-body.ts` `enqueueGesture` / `reprojectSemanticState`; design spec `Interruptions and crossfades` | “There’s a head snap when the listening reflex interrupts sync.” |
| **dead-channel** | Requested semantic channel produces no visible/audible response; smell: missing capability is neither projected nor clearly degraded. | `public/rig-profiles.ts` `missingBlendshapes` / `missingBones` / `missingShaderParams` | “Hands are a dead-channel on this profile; make the degradation explicit.” |
| **mask bleed** | An act visibly affects channels or face regions outside its declared ownership; smell: a brow act moves mouth, or torso idle perturbs a held head. | `src/server-protocol.ts` `MotionPrimitive.channelMask`; `public/vrm-body.ts` `idleDuckForBone` | “The smile has mask bleed into speech mouth.” |
| **decay cliff** | Influence falls abruptly near expiry instead of reading as a release; smell: expression looks switched off at TTL. | `public/vrm-body.ts` `affectEnvelope` / `EMOTION_DECAY_MS` | “The fond pulse hits a decay cliff at the end of its TTL.” |
| **anchor slip** | Motion’s perceptual peak drifts from the cue or played audio moment it was meant to mark; smell: emphasis consistently lands before or after the word/event. | `src/server-protocol.ts` `TimingAnchor`; `public/app.ts` `parseAssistantAudioAnchor` | “The brow beat has anchor slip—it peaks one word after ‘secret.’” |

## How to file taste feedback

Use one observation per line:

> **[quality]** In **[producer/tier + lane]**, **[intent/state]** on **[channel]** **[time behavior]** at **[magnitude/context]** on **[rig profile]**. Expected **[desired feel or arbitration]**.

Example:

> **Overshoot:** In the **L1 rules react lane**, the **nod** on **head** overshoots during **onset** at **high arousal / 0.6 intensity** on **alicia-standard**. Expected one restrained acknowledgment with a softer attack, while sync face and L0 vitals keep ownership.
