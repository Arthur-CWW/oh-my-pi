# Companion iteration infrastructure retrospective

## Scope and evidence policy

This is an operational retrospective for the companion implementation loop. It does not replace the frozen expressive contract in [`apps/ai-companion-rtc/docs/expressive-stack.md`](../../../apps/ai-companion-rtc/docs/expressive-stack.md) or the canonical continuation in [`streams/companion/HANDOFF-BEHAVIOR.md`](../HANDOFF-BEHAVIOR.md).

Claims below are split by evidence strength:

- **Repo-retained** means the claim is supported by the cited repository path and line range.
- **Thread-observed / unretained** means the incident was reported in the engineering thread, but no reliable retained error/session artifact was found in the scoped repository search. It is not presented as a replayable fact.
- **Inference** is labeled when a root cause is reasoned from evidence rather than directly recorded.

Incident records, if later retained, should be added by exact path and line range. This note never invents a proof path, token state, doctor output, or live-smoke result. The diagnostic doctor is read-only except for the unavoidable short WebSocket session-log entry; this note does not claim that doctor has been run.

## Required failure modes

### 1. UI cutover or voice VAD/partial regression

**Evidence**

- The frozen reactor boundary accepts `vad_start`, `partial`, `final`, `energy`, and assistant status, and explicitly suppresses user-reactive rules while the assistant is speaking or thinking: [`apps/ai-companion-rtc/docs/expressive-stack.md:134-181`](../../../apps/ai-companion-rtc/docs/expressive-stack.md#L134-L181).
- Server wiring pushes VAD, partial/final, status, and throttled RMS energy into the reactor and logs/broadcasts its intents: [`apps/ai-companion-rtc/docs/expressive-stack.md:265-268`](../../../apps/ai-companion-rtc/docs/expressive-stack.md#L265-L268).
- The full-duplex regression evidence records ordered fade/cancel interruption behavior, self-audio metadata, and clean replacement behavior: [`apps/ai-companion-rtc/docs/qa-full-duplex-behavior.md:21-30`](../../../apps/ai-companion-rtc/docs/qa-full-duplex-behavior.md#L21-L30).
- The voice contract requires Parakeet partials but treats Whisper as finals-only, and requires duplex barge-in and audio integrity: [`apps/ai-companion-rtc/docs/qa-voice-e2e.md:33-37`](../../../apps/ai-companion-rtc/docs/qa-voice-e2e.md#L33-L37).

**Root cause**

**Inference:** a voice-path or UI change can preserve a visual smoke while breaking event ordering, VAD segmentation, partial semantics, or playback cancellation at the browser/server boundary.

**Cost**

A regression can make listening feel late or silent, misclassify self-audio, lose interruption state, or ship a cutover that only works in a static/visual check.

**Guardrail**

For every voice-path or UI-wiring change, `bun run e2e:voice` is mandatory; a visual-only smoke is insufficient. Require the uninterrupted green report bundle and retain the exact failing event evidence before cutover, as specified by the voice cutover ritual at [`apps/ai-companion-rtc/docs/qa-voice-e2e.md:39-41`](../../../apps/ai-companion-rtc/docs/qa-voice-e2e.md#L39-L41).

### 2. Provider, quota, or subscription failures

**Evidence**

- The app is a nested repository; the current real brain is `gemini-cca`, while echo/tone are local fallback lanes: [`streams/companion/HANDOFF-BEHAVIOR.md:125-132`](../HANDOFF-BEHAVIOR.md#L125-L132).
- The live digest proof exercised the subscription-backed `gemini-cca` lane while keeping the latency-critical rules path local; it explicitly records that no API-credit provider was used: [`apps/ai-companion-rtc/docs/qa-live-reactor-digest.md:7-41`](../../../apps/ai-companion-rtc/docs/qa-live-reactor-digest.md#L7-L41).
- Retained provider notes record that Gemini failed fast on depleted prepaid credits with 429, and that Kimi was unavailable because `moonshot` was disabled in OMP and no raw API key was available: [`apps/ai-companion-rtc/docs/talk.md:49-50,78-82`](../../../apps/ai-companion-rtc/docs/talk.md#L49-L50).

**Root cause**

**Inference:** runtime engine health and OMP subscription/provider reachability are separate boundaries. A local echo/tone path can remain healthy while the active brain or a configured provider is unusable.

**Cost**

The operator can mistake a reachable UI or local audio path for a usable conversational brain, spend time debugging downstream symptoms, or discover quota/key failure only after a live turn.

**Guardrail**

Doctor must report the active Companion brain and OMP lane separately, inspect per-provider OMP reachability/token freshness when exposed, and make an active-provider failure critical while keeping inactive-provider/token warnings noncritical. The product UI currently does not surface this provider-health boundary; the operational status must therefore be visible in doctor output and the handoff proof. No additional retained 429/credits/Kimi ledger row was found beyond the cited `talk.md` record.

### 3. Subagent timeout or half-migration

**Evidence**

- The canonical operational lesson records wrap-up kills, silent lane substitution after subscription lapse, surviving cancelled edits, and the requirement to verify the actual lane after spawning: [`streams/companion/HANDOFF-BEHAVIOR.md:134-139`](../HANDOFF-BEHAVIOR.md#L134-L139).
- The historical worker dump recorded a wrap-up-killed worker leaving a nearly complete artifact, cancelled workers whose edits survived, and the preference for small resume packets: `local/companion-wave6-session-dump-20260707.md:47-57` (dump not retained in the repository; superseded by [`streams/companion/HANDOFF-BEHAVIOR.md`](../HANDOFF-BEHAVIOR.md)).

**Root cause**

Operational execution was trusted without checking the actual model lane or the surviving working-tree state; a timeout was treated as total loss or a worker's completion claim was treated as authoritative.

**Cost**

Restarts duplicate work, hide partial edits, and can introduce incompatible API assumptions. Silent lane substitution also invalidates confidence in the worker's reasoning and output.

**Guardrail**

Freeze the contract, issue a small file-scoped packet naming completed and missing symbols, inspect the surviving diff before resuming, and verify the actual lane from session metadata immediately after spawn and before trusting output. The orchestrator—not the worker sandbox—runs installs, builds, tests, servers, and commits.

### 4. Proof and documentation drift

**Evidence**

- The historical session dump was explicitly marked superseded and directed readers to the canonical handoff: `local/companion-wave6-session-dump-20260707.md:1-8` (dump not retained in the repository).
- The current handoff binds evidence limits: no measured sub-300 ms face latency, no live Ubuntu/provider-disconnect run, no live deep provider, and no live semantic-filler artifact; it also says the behavior ledger is bounded proof, not a replacement for the contract: [`streams/companion/HANDOFF-BEHAVIOR.md:7-11,144-159`](../HANDOFF-BEHAVIOR.md#L7-L11).
- The full-duplex report separates executed evidence from source/unit coverage and refuses to claim absent live runs or timing measurements: [`apps/ai-companion-rtc/docs/qa-full-duplex-behavior.md:1-30`](../../../apps/ai-companion-rtc/docs/qa-full-duplex-behavior.md#L1-L30).

**Root cause**

Historical context, structural proof, executed proof, and current status were allowed to coexist without a strong supersession marker or claim boundary.

**Cost**

A maintainer can repeat stale setup, report an unmeasured guarantee, or treat unit/source coverage as live integration evidence. This causes wrong prioritization and erodes reviewer trust.

**Guardrail**

Every proof post must identify scope, timestamp/context, exact command or observation, and limitations. Current behavior/status claims must link to the current proof ledger, while historical artifacts carry explicit invalidation/supersession markers. Never upgrade thread memory or structural evidence into a live claim.

### 5. Avatar neutrality versus dead startup

**Evidence**

- The handoff requires model-neutral hot-swapping, per-model projection profiles, and graceful degradation; it also states that Alicia is the immediate default and that the runtime must not block on finding another model: [`streams/companion/HANDOFF-BEHAVIOR.md:27-37,95-104`](../HANDOFF-BEHAVIOR.md#L27-L37).
- The current topology keeps the browser renderer and Rig as runtime authorities and describes the active avatar/catalog surfaces: [`streams/companion/HANDOFF-BEHAVIOR.md:125-131`](../HANDOFF-BEHAVIOR.md#L125-L131).
- **Thread-observed / unretained:** a reported “no default avatar” startup incident was not matched to a reliable retained startup error/session artifact in the scoped repository search. No exact artifact path is asserted here.

**Root cause**

**Inference:** “no privileged model winner” was conflated with “no deterministic usable startup selection.” A neutral catalog can therefore satisfy policy while leaving the initial scene without a live avatar.

**Cost**

The companion opens as a dead or blank scene, making the product appear unavailable and preventing meaningful live-smoke or proof capture even when services are healthy.

**Guardrail**

Require a deterministic available startup model without declaring a product winner; validate the catalog and projection profile before startup, and require live smoke to show a visibly alive avatar. If the startup regression is later retained, replace the thread-observed label with its exact repository path and line range.

### 6. Audible output invisibility

**Evidence**

- Typed response evidence proves server audio frames and `audio_done` but says browser playback internals were unavailable; it explicitly does not prove browser audio consumption: [`local/companion-response-diagnosis/typed/evidence.json:63-66`](../../../local/companion-response-diagnosis/typed/evidence.json#L63-L66).
- Runtime evidence proves nonzero PCM, analyser activity, a valid AudioContext graph, playback lifecycle completion, and zero final active sources, while warning that the hidden tab cannot prove host-device sound pressure or foreground policy: [`local/companion-tts-diagnosis/runtime-summary.json:6-47`](../../../local/companion-tts-diagnosis/runtime-summary.json#L6-L47).
- Server audio evidence records playback ACK ordering and cancellation as turn supersession, and states that audible completion is client-reported via `playback_ack` rather than a server `audio_done` protocol event: [`local/companion-tts-diagnosis/server-audio-evidence.json:33-37`](../../../local/companion-tts-diagnosis/server-audio-evidence.json#L33-L37).

**Root cause**

Server PCM emission and AudioContext destination reachability are weaker boundaries than perceived sound at the selected host output device. Hidden-tab automation additionally cannot establish foreground autoplay, mute, or device routing behavior.

**Cost**

A green server/audio graph can coexist with a user hearing nothing. Teams can incorrectly blame Kokoro or ship a silent experience while all backend traces look healthy.

**Guardrail**

Require client playback ACKs through the terminal state and an actual foreground/headphone live smoke. Treat server PCM, analyser activity, and AudioContext destination reachability as necessary evidence, not proof of audible host output.

## Iteration ritual

> `doctor → targeted change → bun test + bun run typecheck + bun run build:vrm (or the package’s build command) → bun run e2e:voice when voice path or UI wiring changed → live smoke → Xanadu proof post`

This retrospective task does not run those gates. Future implementation sessions follow the ritual, with the voice E2E conditional exactly as written.

## HANDOFF operational hook

After reading the boot chain in [`streams/companion/HANDOFF-BEHAVIOR.md:1-3`](../HANDOFF-BEHAVIOR.md#L1-L3), run doctor before acting. Before updating **Current status** or **Behavior-wave completion** claims, attach the live-smoke/proof receipt and its limitations; those operational sections are [`streams/companion/HANDOFF-BEHAVIOR.md:134-159`](../HANDOFF-BEHAVIOR.md#L134-L159). The canonical handoff remains unchanged by this note.

## Captured doctor proof

No captured doctor proof block or `local/companion-doctor-proof.txt` link is included: doctor output was not observed during this note-only task, and inventing a path or output would violate the evidence policy.

## Heavy-work routing policy

The Mac is the realtime authority only: voice capture/playback, the interactive renderer, and development servers stay local because they are latency-sensitive. Extraction, media conversion, GPU inference, and catalogue-scale batches run on the Ubuntu RTX desktop. Every long-running desktop operation must live in a named tmux session with a durable manifest, status file, and combined log; GPU runs additionally follow `gpu-workload-dispatch`. Provisioning is user-space only unless Arthur separately authorizes sudo.

This boundary is operational, not aspirational. A four-worker Mac-local headless-Chromium face/pose extraction batch caused tremendous power drain and was killed. Local extraction therefore defaults to one worker. More local workers require the explicit `allowHeavyLocal` opt-in (`AI_COMPANION_ALLOW_HEAVY_LOCAL=1`) together with `AI_COMPANION_JOB_WORKERS`; setting a worker count alone does not bypass the guard. Battery state or a convenient local checkout is never a reason to move a batch back to the Mac.
