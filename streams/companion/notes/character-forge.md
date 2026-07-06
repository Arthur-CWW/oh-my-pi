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
