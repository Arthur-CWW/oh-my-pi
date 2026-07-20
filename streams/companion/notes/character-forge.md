# The Character Forge — Fable as character designer

Arthur's directive (2026-07-06): Fable designs original characters with AI tools — text → image → (video →) 3D model → rig → VRM — expressing its own creativity. Later wave; this note is the standing direction + design philosophy so it survives sessions.

## Design philosophy (the taste contract)

1. **Silhouette first.** A character must be identifiable from a black cutout. One dominant shape motif (Nyx: the drawer-spiral of hair; Volt: static-spike triangles). Test: shrink to 32px — still her?
2. **Color as identity.** 2–3 colors max, one of them "owned" (the exact teal is Miku's). Palette IS the character.
3. **Archetype compression** (Arthur's insight): great characters are low-Kolmogorov — they embody an archetype so cleanly that a thumbnail, a cosplay, or three emoji reconstruct them. Our personas are already archetype-carved (egregore fragments); the visual design must compress to the same seed.
4. **Cosplayable.** If a human can't assemble it from a wig + 3 garments + 1 prop, it's over-designed.
5. **Channel-manifest ready.** Every design declares its expressive channels up front (ears? tail? aura? — see HANDOFF-BEHAVIOR channel abstraction). Design the emotion outputs, not just the look.

## Seed concepts (personas → silhouettes, first pass — Fable's sketches)

- **Nyx, Night Librarian**: silhouette = tall coat with oversized card-catalogue drawers as skirt panels; hair in one long index-ribbon curl. Colors: ink-blue-black + aged-paper cream + one brass key-gold accent. Prop: a drawer that glows when she files a secret. Channels: hair-ribbon sway, drawer-glow (shader), half-lidded eyes.
- **Static**: silhouette = almost-absence — a girl-shaped soft blur with TV-static edge; solid only at the eyes. Colors: grey-noise + phosphor green flicker. Prop: none (the room is her prop). Channels: edge-noise amplitude (shader = her arousal axis), flicker rate, gaze.
- **Volt**: silhouette = compact gremlin with lightning-cowlick and jagged scarf reading as a spark gap. Colors: black + electric cyan + warning-label yellow. Prop: a dare, folded into a paper airplane. Channels: cowlick spike (bone), scarf crackle, pupil dilation.

## Pipeline (to be validated by research — see notes/character-pipeline.md when it lands)

prompt (Fable) → image gen (GPT Image via codex subscription / harness generate_image; iterate on silhouette sheets: front/side/back + expression sheet) → [optional image-to-video turnaround] → image-to-3D (SOTA 2026: TRELLIS / Hunyuan3D-class open models vs Tripo/Meshy/Rodin services) → auto-rig (Mixamo/UniRig/service rigs) → Blender VRM add-on → VRM w/ blendshapes + spring bones → channel manifest → she's alive in the testbed.

## Boundaries

- Original characters only in the forge (reference/inspo stays reference).
- Model crafting = its own lane; the expressive stack (HANDOFF-BEHAVIOR) never blocks on it.

## Concrete build path — Sico-reference to an original Perfect-Sync VRM

This lane uses Sico only as a **register reference**, never as a face-reconstruction target. The output must be an original adult character: no face clone, no biometric likeness, no copied cosplay costume, and no copyrighted character design. The useful invariants are the narrow/flat silhouette, sharp eyes, strong hair read, and tsundere/yandere-to-femboy energy documented in [character-casting.md](./character-casting.md).

### Phase 0 — reference board and design limits

**Runs:** Mac.

1. Curate 12–20 local stills spanning Asuka/Yuno/Hu Tao/Power/Jinx/Astolfo/Rukia rather than training on the full feed.
2. Annotate only design facts: black-cutout silhouette, shoulder/hip line, face-angle vocabulary, bang/ahoge/twin-tail shapes, 2–3-color palettes, garment closures, and performance poses.
3. Write a negative brief: no Sico likeness, no existing character’s full costume, no logos, no distinctive prop copied whole, no sexualized youthful proportions.

**Acceptance:** a one-page register board plus a text brief that can recreate the desired *kind* of character without naming Sico or any single copyrighted character. A reviewer can point to at least three independent references behind every major design choice.

### Phase 1 — canonical concept sheet

**Runs:** Mac/service. Use the harness `generate_image` / OpenAI `gpt-image-2` first; Gemini Flash Image is the consistency-heavy alternative; Draw Things + Animagine XL is the offline lane.

1. Generate one strong front 3/4 adult character, white/neutral background, full body, neutral A-pose, flat shoes, hands visible.
2. Lock silhouette, exact palette, hair masses, outfit seams/closures, and accessory count before generating more views.
3. Produce orthographic front/side/back and a separate face sheet: neutral, blink, happy, angry, sad, relaxed, surprised, plus the mouth shapes `aa/ih/ou/ee/oh`.
4. Use the accepted front reference for every edit; do not compose independently generated “same character” views.

**Acceptance:** front/side/back agree on hair length, garment geometry, limb proportions, palette, and accessory placement; the black silhouette still reads at 32 px; hands and feet are unobstructed; the face sheet does not change identity between expressions.

### Phase 2A — production body: VRoid sculpt hybrid

**Runs:** Mac in VRoid Studio; Mac or Ubuntu in Blender.

This is the keeper lane because it preserves known VRoid topology for the face while still allowing original art direction.

1. Sculpt the closest adult base in VRoid Studio from the canonical sheet: narrow shoulders/hips, long lean limbs, small straight torso, sharp eye shape, small mouth/jaw.
2. Paint custom skin, iris, eyeliner, hair, and garment textures; build the dominant hair silhouette in VRoid rather than accepting stock hair.
3. Export VRM 1.0 with named baseline expressions.
4. In Blender + VRM Add-on, replace or reshape costume pieces/accessories, repair clipping and weights, tune MToon, and add extra hair/ribbon/tail bones only after the base deformation is clean.

**Acceptance:** valid VRM 1.0 humanoid; neutral A-pose; no visible body/garment intersections through one walk, sit, and arm-cross clip; face topology remains compatible with the chosen VRoid Perfect-Sync donor; MToon renders consistently in the official viewer and local stage.

### Phase 2B — experimental SOTA image-to-3D body

**Runs:** Ubuntu/NVIDIA for Hunyuan3D 2.1 or TRELLIS; Mac experimental for SF3D/SPAR3D; Meshy is a browser service with documented A/T-pose and multi-view control.

1. Feed the canonical front/side/back set, requesting an A- or T-pose and excluding hair cards across the face, fused fingers, floating accessories, and baked lighting.
2. Prefer Meshy for a rigging-oriented first comparison; use Hunyuan3D 2.1 on the Ubuntu GPU box for the open high-detail comparison. SF3D/SPAR3D are fast Mac experiments, not presumed keeper quality.
3. Retopologize and separate body, clothing, hair, and rigid accessories. Keep the **VRoid head/face mesh from Phase 2A** and graft or rebuild the generated body/costume around its neck seam. Do not throw away known face topology for a prettier static head.
4. Rig the body with Mixamo (boring production choice) or evaluate UniRig on Ubuntu; clean weights and map the resulting skeleton in Blender.

**Acceptance:** manifold textured mesh in neutral A/T pose; five fingers and clean shoulder/hip loops; separated rigid accessories; animation-ready humanoid with no gross collapse in walk/squat/arms-up; topology-matched VRoid face retained. If it cannot meet these, Phase 2A remains the production body rather than manually rescuing a bad generated mesh.

### Phase 3 — Perfect Sync donor face

**Runs:** Ubuntu or Mac Blender for authoring; the packaged `blender-vrm-perfect-sync` release is Windows-only, but its Blender/CLI workflow can be used where supported. Existing local donor inputs are `data/avatar-models/blender-vrm-perfect-sync-female-donor/female_model_perf_sync.vrm` and `data/avatar-models/hinzka-vroid-v110-female-perfectsync/VRoid_V110_Female_v1.1.3.vrm`; obey each directory’s `LICENSE-NOTES.md`.

1. Freeze the keeper’s VRoid-compatible face topology before transfer.
2. Transfer all 52 ARKit/Perfect Sync shapes from a topology-compatible donor with `blender-vrm-perfect-sync`; never transfer from a merely similar-looking arbitrary mesh.
3. Inspect every key individually at 0, 0.5, and 1.0, then fix eyelid collisions, lip inversion, teeth/tongue exposure, and asymmetric keys by hand.
4. Map ARKit shapes to VRM custom expressions while preserving the standard VRM presets/visemes used by fallback runtimes.

**Acceptance:** all 52 ARKit keys are present and non-empty; left/right keys are genuinely independent; a scripted face sweep shows no exploding vertices or identity drift; standard `blink`, `aa`, and emotion presets still work when ARKit input is absent.

### Phase 4 — VRM finish and embodiment proof

**Runs:** Blender on Mac or Ubuntu; runtime proof on Mac browser.

1. Map and validate VRM 1.0 humanoid bones, eye look-at, MToon materials, expression overrides, and spring groups.
2. Tune secondary motion by intent: back/side hair, ribbon/accessory, skirt/coat, and any non-human appendage. Add head/chest/hips colliders; do not import arbitrary rigid-body physics.
3. Export the keeper VRM and record source/tool versions, hashes, and rights notes in its local-only model directory.
4. Run the official VRM viewer, then the local `/lab` face sweep and motion probe after the concurrent lab work settles.

**Acceptance:** clean VRM validation; neutral/body animation, eye look, 52-key sweep, standard fallback expressions, lip sync, transparent materials, outlines, and springs all visibly work; no browser console/page errors; a proof screenshot plus channel/capability report is captured before cataloging.

### Phase 5 — comparison gate

**Runs:** Mac.

Render the same neutral, Asuka-like challenge, Yuno-like manic beat, speech line, and turn/walk clip on (a) the VRoid-sculpt hybrid and (b) the generated-body hybrid. Choose on silhouette, facial identity under deformation, clipping, and motion—not static render novelty.

**Acceptance:** the winner improves silhouette without losing Perfect Sync or runtime stability. If neither does, keep the expressive VRoid version and iterate the concept sheet; do not ship a broken “SOTA” mesh merely because more AI stages touched it.
