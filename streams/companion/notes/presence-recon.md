# Presence-layer recon — airi / Open-LLM-VTuber / aiavatarkit (2026-07-03)

Read-only scout findings (full report: session artifact `agent://PresenceRecon`). Shapes only, never code.

## Headline

**None of the three repos has spatial/binaural/proximity primitives.** Audio is ordinary playback or base64 voice payloads everywhere. The ASMR/spatial-presence lane is empirically unoccupied — our `spatialAudio` signal is an explicit addition, not inherited behavior.

## How each draws the session/body boundary

| Repo | Boundary style | Strength | Weakness |
|---|---|---|---|
| airi | In-process Vue hooks (`onTokenLiteral`/`onTokenSpecial` in `stage-ui/src/stores/chat.ts:20-58`); Stage.vue consumes hooks, maps emotion tokens → Live2D motions / VRM expressions, mouth from AnalyserNode energy | Cleanest hook/queue split; scalar mouth-open is enough for Live2D fallback | Contract implicit in stores — no standalone body DTO |
| Open-LLM-VTuber | WS payload `{audio: b64 wav, volumes: number[] @20ms, slice_length, display_text, actions}` (`utils/stream_audio.py:24-75`); `Actions(expressions,pictures,sounds)` | Best portable lip-sync fallback (20ms RMS envelopes); modular ASR/TTS/VAD/agent factories | Emotion extraction coupled to `Live2dModel` dictionaries |
| aiavatarkit | Explicit DTOs: `AIAvatarResponse` + `AvatarControlRequest(animation_name, face_name, durations)` (`adapter/models.py:1-35`); per-stage latency recorder | Cleanest transport boundary; explicit latency schema (STT, stop-response, first LLM/voice/TTS chunk, total) | Face/animation tags too coarse for intimacy — no visemes/energy frames |

## Minimal hot-swappable body contract (synthesis)

1. `speech.start/part/end` — `{utteranceId, chunkId, text?, isFirstChunk, final?}`
2. `audio.chunk` — `{utteranceId, format, sampleRate, channels, bytes|b64, durationMs?}`
3. `audio.energyFrame` — `{utteranceId, frameMs: 20, values: number[]}` (portable lip-sync fallback)
4. `mouth.scalar` — `{t, value: 0..1}` (Live2D-sufficient)
5. `emotion` — `{name, intensity?, durationMs?, source}`
6. `gesture/action` — `{kind: animation|gesture|sound|picture, name, durationMs?}`
7. `gaze/focus` — `{target: screenPoint|worldPoint|user|camera}`
8. `interruption` — `{utteranceId?, heardText?, reason: user_speech|stop|barge_in}`
9. **`spatialAudio` (ours alone)** — `{position:[x,y,z], distance, directivity?, wetDry?, foleyCue?}`

## Latency/turn-taking tricks worth copying as patterns

1. **Split text early but safely**: airi's grapheme-aware TTS chunker with punctuation/word thresholds + explicit flush token (`stage-ui/src/utils/tts.ts:1-118`); Open-LLM-VTuber's `faster_first_response` sentence divider.
2. **Parallel TTS, ordered playback**: synthesis tasks run concurrently, a sequence queue preserves audible order (`conversations/tts_manager.py:12-145`).
3. **Transaction-id cancellation**: new turn supersedes old transaction; LLM/TTS loops break on id change; stop-response latency recorded (`sts/pipeline.py:155-349`).

## Pitfalls to avoid

- Body controls implicit in UI stores/hooks only (airi).
- Presence coupled to Live2D model dictionaries (Open-LLM-VTuber).
- Coarse face/animation tags — kills intimacy (aiavatarkit).
- Barge-in postponed as TODOs (airi's VAD path never wired interruption).
- Audio treated as ordinary playback — audio-first presence is the differentiator.
