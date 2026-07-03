# Speech-to-speech testbed — coordination packet

**From:** Fable/Playground session, 2026-07-03 (Arthur interjection, verbatim intent captured)
**For:** Companion stream (owns `apps/ai-companion-rtc`, voice stack, Xanadu dashboard)
**Status:** queued — not started; playground session stayed on studio scope per Arthur

## What Arthur wants to test

The end-to-end speech-to-speech workflow, as an interactive testbed:

1. **Audio streams in** (mic), and the **transcription streams in live** alongside it.
2. **Response audio streams out**, with **its transcription streaming** too.
3. Everything **resumable and event-driven** — restart any workflow mid-stream; pick the architecture that makes replay/resume natural (event log; SQLite per house style).
4. **Model lanes via OMP-authenticated subscriptions**, not APIs — subscriptions are ~10x cheaper; run through the rate limit rather than paying API rates. Reuse the existing OMP auth plumbing.
5. Swappable models per stage (STT / LLM / TTS) to compare lanes.

## Design directive (applies to the UI)

Arthur, same session: "always think — how best should I display this information? What is the best way to interact with this information?" The testbed UI is not a chat log; it is an instrument for watching a live duplex conversation: parallel streaming lanes (in-audio, in-transcript, out-transcript, out-audio) with timing visible (latency per stage), resumable runs listed as artifacts. House rules apply: vim-native keys, dark dense editor chrome, SQLite provenance (human vs agent edits), live-not-dead software (Bret Victor) — see `docs/fable/charter.md` §Routing interaction-design defaults and `docs/state/scene-studio-design-language.md`.

## Existing substrate (don't rebuild)

- `apps/ai-companion-rtc` — clean-room RTC testbed (see `ai-companion-rtc-testbed` skill), latency proof harness.
- Kokoro TTS sidecar (companion TASKS row T-2026-07-03-001): warm TTFA 49–74ms, port 8799.
- `transcribe` skill (Groq Whisper) for batch; streaming STT lane TBD.
- Xanadu feed (`http://xanadu.localhost:1355`) is the companion review surface — testbed proof artifacts should land there.
