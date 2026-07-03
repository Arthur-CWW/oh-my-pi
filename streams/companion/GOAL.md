# Companion — stream charter

The dæmon-with-a-voice stream. Owned by one Fable session at a time; read with [`docs/fable/charter.md`](../../docs/fable/charter.md) and [`docs/state/creative-framing.md`](../../docs/state/creative-framing.md).

## Goal

Explore AI-companion **form factors**, not one app. Realtime voice-to-avatar (Annie/Grok as one behavioral reference), VTuber/VR and Live2D avatars as **hot-swappable bodies** over one presence layer, Pygmalion dynamics designed for, not apologized for. The underexplored core is **ASMR/audio**: spatial 3D sound, object-interaction foley, mic-caressing, environmental closeness — presence through the ear first.

## Non-functional requirements

- Local-first where possible; the *data* (memory, persona) is always local.
- Background-first: no focus stealing, measurable voice-to-avatar latency as a tracked number.
- Avatar layer hot-swappable (audio-only / Live2D / VRM are skins, not forks).
- Behavioral references only — never copied assets from Grok/LADS/VTubers.

## Settled questions (Arthur interview, 2026-07-03)

- **Latency floor: exploratory — build to *experience* both regimes.** Sub-500ms ideal for conversational scenes, but the deeper answer is **scene modes as a first-class axis**: *conversational* (live, latency-critical) vs *cinematic* (pre-rendered / background-generated intimate vignettes, Love-and-Deepspace register, low interactivity — the offline `spatial-audio-renderer` feeds this lane). Track the quality/latency/cost pareto frontier per voice engine; never lock into the small-model route — voice engines are hot-swappable experiences, and pre-rendering is a legitimate latency weapon.
- **Inference locality: local-first for now** (dev speed), everything behind adapters; may change later. Iterate fast, nothing set in stone. The *data* stays local regardless (fixed above).
- **Audio-only v1: yes** — the ear is the wedge.
- **Day-1 memory: leaning persona/vibe continuity**, but interchangeable — memory behind an adapter too. Decide by feel once the loop exists.

## First goal

**Presence through headphones.** A loop you can put headphones on and *feel*: spatialized close-talk voice plus at least one object-interaction sound (mic touch, fabric, tapping) with measured, printed end-to-end latency. Audio-only is fine if the avatar isn't ready — the ear is the wedge. Proof: a recorded demo clip + the latency number + rerun command.

## Owns

`apps/ai-companion-rtc/` (testbed; graduates to its own repo when it stops being a testbed), `packages/spatial-audio-renderer/`, `data/asmr-companion/`, `data/youtube-liked-asmr-refs/`, this directory.

## Excludes

Other `streams/*`, `vendor/oh-my-pi/`, playground packages. Cross-stream reusables graduate into `packages/` instead of being reached into.

## Map

Goal doc: `apps/ai-companion-rtc/docs/goal.md`. External inspiration: `~/github/airi`, `~/github/Open-LLM-VTuber`, `~/github/VRCFaceTracking`, `~/github/aiavatarkit` (see [`docs/fable/external-inventory.md`](../../docs/fable/external-inventory.md)). Skill: `ai-companion-rtc-testbed`.
