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

## Operating mode (Arthur, 2026-07-03)

- **Dashboard-mediated review.** Arthur reviews what the stream *produces*, not commits. Every finished slice posts an entry to the Xanadu dashboard feed (`apps/xanadu/`, `http://xanadu.localhost:1355`, run: `cd apps/xanadu && bun run dev`); artifacts must be interactable end-to-end (playable clips, runnable actions). Self-contained package — nothing in root `package.json`.
- **Autonomous chaining.** Finish a task, post it, start the next — no per-task approval. Escalate to Arthur only for taste, UX preference, or architectural forks he'd genuinely weigh differently; post those as `kind: question` feed entries.
- **Progress is visible live**: in-flight work may post `progress` entries; the page updates over SSE.
- **Non-pessimization (Arthur, 2026-07-06, cf. Casey Muratori).** Quality first — small models miss the little things; get it *sufficiently good*, then hill-climb latency. Never optimize prematurely, and never write code that BLOCKS optimizing: every stage stays a hot-swappable seam with per-segment latency printed, so benchmarks/evals can sweep engine×model combos later. Planned: a bench harness (latency segments + register-quality samples per combo) feeding dashboard tables. Low latency remains the goal; optimizability is the method.
- **PuruPuru body (backlog, Arthur inspo 2026-07-06):** rotejin's open-source PuruPuruPNGTuber decoded (`notes/rotejin-effect.md`, video in `data/inspiration/rotejin/`) — layered-PNG avatar, spring-chain hair, expression swaps. Becomes the THIRD hot-swap body type (audio-only / VRM / PNGTuber) over the same body events; M-effort Canvas2D recipe in the note.

## First goal

**Presence through headphones.** A loop you can put headphones on and *feel*: spatialized close-talk voice plus at least one object-interaction sound (mic touch, fabric, tapping) with measured, printed end-to-end latency. Audio-only is fine if the avatar isn't ready — the ear is the wedge. Proof: a recorded demo clip + the latency number + rerun command.

**Proven 2026-07-03** (testbed commit `e2ed6dc`): proof clip + numbers + rerun in `data/asmr-companion/presence-loop-demo/20260703/`. Synthetic tone voice — spatially real, emotionally not yet.

## Second goal

**Felt presence.** Real voice in the loop + Xanadu dashboard as the standing review surface. **Partially proven 2026-07-03** (testbed `4f35155`): Kokoro `af_nicole` live, median commit→firstAudio 102ms. **Arthur's verdict: voice rejected** — "not a pleasing VTuber ASMR voice". Keep as placeholder; the real path is the voice-clone lane fed by VTuber/ASMR references (`notes/voice-hunt.md`, `data/voice-refs/`). Entertainment register, not assistant: latency and vibe beat intelligence.

## Third goal

**Talk to it.** Full realtime loop Arthur can speak to: mic → VAD/STT (parakeet-mlx + Silero) → fast cheap LLM (Gemini Flash / Kimi lane; NEVER the Codex subscription) → Kokoro → presence layer, with barge-in and per-segment latency printed. Plus "the ghost room": a mesmerizing interactive binaural scene (orbits, behind-you passes, distance swells — reference vocabulary from `data/youtube-liked-asmr-refs`, e.g. 3D Sound Test, Vox Akuma binaural). Proof: a live conversation + a scene you can drag sources around in, both reachable from the dashboard.

**Ghost Room validated by Arthur live 2026-07-03** ("fucking sick"). Consequence: the scene engine graduates toward **composable scenes** — authorable vignettes (LaDS-register intimate cinematics) mixing trajectories, foley, voice lines, and personas; converge `public/scene.ts` + `packages/spatial-audio-renderer` + persona/body events into one scene grammar. This is the cinematic lane of the scene-mode axis.

## Owns

`apps/ai-companion-rtc/` (testbed; nested standalone git repo), `apps/xanadu/` (shared artifact dashboard), `packages/spatial-audio-renderer/`, `data/asmr-companion/`, `data/youtube-liked-asmr-refs/`, `data/avatar-models/`, `data/xanadu/`, this directory.

## Excludes

Other `streams/*`, `vendor/oh-my-pi/`, playground packages. Cross-stream reusables graduate into `packages/` instead of being reached into.

## Map

Goal doc: `apps/ai-companion-rtc/docs/goal.md`. External inspiration: `~/github/airi`, `~/github/Open-LLM-VTuber`, `~/github/VRCFaceTracking`, `~/github/aiavatarkit` (see [`docs/fable/external-inventory.md`](../../docs/fable/external-inventory.md)). Skill: `ai-companion-rtc-testbed`. Notes: [`notes/presence-recon.md`](notes/presence-recon.md), [`notes/tts-stt-survey.md`](notes/tts-stt-survey.md), [`notes/avatar-landscape.md`](notes/avatar-landscape.md).

## Avatar bodies backlog (Arthur, 2026-07-03 — noted, not urgent)

- VRM (3D) and Live2D (2D) bodies "doing stuff" over the presence layer is the next form-factor step; body contract already distilled in `notes/presence-recon.md`.
- A **new open-source white-glove Live2D renderer** reimplementation exists (identify: `notes/avatar-landscape.md`); a new VRM library likewise. Using the clean-room renderer is fine.
- Grok/Ani is installed locally; an implementation doc ("AniChat" / OpenVRM) exists somewhere — **not** in `~/github/grok-tools` (scouted 2026-07-03: that repo is X/Twitter MCP tooling only). Ask Arthur for the pointer when avatar work starts. Behavioral reference only, never extracted assets.
- Prototype body: a free, well-licensed cute anime girl (Miku under piapro terms, or Alicia Solid / Kizuna AI / VRoid samples) — acquisition in `data/avatar-models/`.
