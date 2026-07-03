# Companion — stream charter

The dæmon-with-a-voice stream. Owned by one Fable session at a time; read with [`docs/fable/charter.md`](../../docs/fable/charter.md) and [`docs/state/creative-framing.md`](../../docs/state/creative-framing.md).

## Goal

Explore AI-companion **form factors**, not one app. Realtime voice-to-avatar (Annie/Grok as one behavioral reference), VTuber/VR and Live2D avatars as **hot-swappable bodies** over one presence layer, Pygmalion dynamics designed for, not apologized for. The underexplored core is **ASMR/audio**: spatial 3D sound, object-interaction foley, mic-caressing, environmental closeness — presence through the ear first.

## Non-functional requirements

- Local-first where possible; the *data* (memory, persona) is always local.
- Background-first: no focus stealing, measurable voice-to-avatar latency as a tracked number.
- Avatar layer hot-swappable (audio-only / Live2D / VRM are skins, not forks).
- Behavioral references only — never copied assets from Grok/LADS/VTubers.

## Open questions (answer before committing architecture)

- Latency floor: what round-trip actually breaks intimacy? (sub-500ms vs ~1.5s + good turn-taking)
- Hard-local inference/TTS, or cloud voice behind a local presence layer?
- Is audio-only ASMR-presence an acceptable v1 milestone (no face)?
- Day-1 memory: episodic recall vs persona/vibe continuity?

## Owns

`apps/ai-companion-rtc/` (testbed; graduates to its own repo when it stops being a testbed), `packages/spatial-audio-renderer/`, `data/asmr-companion/`, `data/youtube-liked-asmr-refs/`, this directory.

## Excludes

Other `streams/*`, `oh-my-pi/`, playground packages. Cross-stream reusables graduate into `packages/` instead of being reached into.

## Map

Goal doc: `apps/ai-companion-rtc/docs/goal.md`. External inspiration: `~/github/airi`, `~/github/Open-LLM-VTuber`, `~/github/VRCFaceTracking`, `~/github/aiavatarkit` (see [`docs/fable/external-inventory.md`](../../docs/fable/external-inventory.md)). Skill: `ai-companion-rtc-testbed`.
