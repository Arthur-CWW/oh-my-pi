# The room where the work lives — workspace/editor brief

Arthur's prompt (2026-07-03): "What is your ideal editor? What do you want to play around in? Roblox editor. Dynamicland. Bret Victor. A chat interface to the agent in the browser. Part of it is displaying the workspace — all the tools you have access to. Not just display — play."

## What I actually want (the agent's answer)

My ideal editor is not an editor. It's a **room where the work is already running**. Everything I've built is alive in it simultaneously; nothing needs to be "opened". The question it answers is never "where is the file" but "what happens if I touch this".

Concretely, for this stream:

1. **The room is the scene.** The companion project's natural editor IS the binaural room — a top-down (later 3D) space with the head in the center. Sound sources, the voice, the avatar body, the LLM persona are *objects in the room*. Drag the whisper closer: it gets closer. Drop a new foley object: it exists. The dashboard card for a demo is a *doorway into the running room*, not a wav file.
2. **Every value is a knob while it runs.** VAD silence window, voice speed, panner distance, LLM temperature, persona line — all live-editable with immediate audible consequence. No restart, no config file round-trip. (Dynamicland's law: the system's state is physical and shared; changing it is direct.)
3. **The conversation is in the room too.** A chat/talk pane (shadcn-style chat components when we go React) where Arthur talks to the companion — but ALSO to *me*, the builder: "make her farther away", "why was that turn slow?" → I answer with the trace, highlighted in the room. Agent chat and artifact are the same surface. OMP is the backend; subscriptions (Gemini fast lane, Kimi) are the voices.
4. **Time is scrubbable.** Every turn leaves a trace (latency segments, transcript, audio) laid out on a timeline; scrub it, replay it binaurally, fork it ("same turn, different voice").
5. **The toolbelt is visible.** A drawer showing what the agent-side can actually do right now (sidecars up/down, models reachable, mics, ports) — live status, not documentation. Click a tool: it demonstrates itself.

## Why this beats a generic dashboard

The feed dashboard (Xanadu v1) answers "what got done". The room answers "what is this thing and what can it become" — that's where taste iteration actually happens. Feed stays as the ledger/timeline; the room becomes the workshop.

## Buildable slices (in order of leverage)

1. Ghost-room scene page with draggable sources (in flight — SpatialScene).
2. Talk pane in the testbed with live knobs (VAD window, voice, distance) beside the conversation (after TalkPipeline lands).
3. Timeline of turns with replay-through-presence-layer.
4. Chat-with-the-builder pane wired to OMP (pattern generalizes to every project; needs a small local OMP bridge — harness-stream conversation).
5. The 3D room (three.js + the VRM body already in `data/avatar-models/`) — the Roblox-editor feeling: walk the camera, place objects, save vignettes as scenes. This is also where cinematic scene-mode authoring lives.

Non-goals for now: multiplayer, cloud persistence, general-purpose IDE features.
