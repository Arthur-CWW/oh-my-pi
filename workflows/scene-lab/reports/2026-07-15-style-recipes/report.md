---
title: Presentation-layer style recipes
date: 2026-07-15
agent: StyleRecipesV2
status: complete
---

# Artifacts

- `docs/research/style-recipes.md` — ten named, evidence-backed presentation recipes with audio coupling and exact `scene.v1` capability/gap mappings.
- `docs/plans/scene-lab.md` — appended `Style vocabulary v1` index.
- This report.

# Coverage consumed

The synthesis read the catalog once at the start and did not edit it. The snapshot contained **56 unique per-video entries**: 30 in the original catalog table and 26 in “Full Corpus Additions.” It also consumed all **39** Whisper records in `transcripts.json`, `manifest.json` at **133 media records / 89 videos**, the ontology two-layer steer, the oral-evidence vibe brief, Abelian Soup methods, the Scene Lab plan, and current renderer schema/runtime implementation. Of the catalog entries, 20 had a same-ID Whisper record and 47 had a same-file manifest video record; visual catalog evidence remains the primary basis for recipes.

The supported high-level lanes are machine-liturgy/CRT, chrome/aura-maxxing, referential-collage brainrot, and typographic incantation. They are presentation families, not semantic taxonomies.

# Recipe one-liners

1. **Terminal Reliquary** — a CRT/terminal display performs revelation through grids, diagrams, telemetry type, and restrained signal damage.
2. **Chrome Halo Procession** — slow symmetry, shine, orbiting clones, and monumental type manufacture icon-level aura.
3. **Reference-Pile Retention Stack** — a stable anchor holds while mismatched references collide through split screens, stickers, gameplay, and hard accent cuts.
4. **Typographic Incantation** — phrases become image and percussion through breath-sized reveals, repetition fields, and syntax-driven cuts.
5. **Mascot Clone Chorus** — one reusable character plate becomes a crowd, ritual, or refrain through formation and clone-phase motion.
6. **Institutional Signal Hijack** — HR/news/finance/product surfaces remain formally competent while displaced material occupies them.
7. **Found-Clip Evidence Wall** — ordinary footage gains documentary or deadpan force through reframing, restrained captions, reprise, and evidence-grid layout.
8. **Retro-Web Urgency Shrine** — banner-ad coercion becomes cursed nostalgic grammar: WordArt, fake buttons, sticker scatter, flashes, and GIF jitter.
9. **Feedback Corridor Pilgrimage** — camera push, phased depth clones, and accumulated trails turn reference plates into a hypnotic journey.
10. **Hard-Button Loop** — one readable setup and one precisely timed detonation create a short, replayable loop.

# Top renderer gaps by recipe impact

“Blocked” means the recipe cannot reach its documented evidence-level grammar natively; staging/pre-baking may still approximate it.

| Rank | Precisely named gap | Recipes blocked | Count |
|---|---|---|---:|
| 1 | **Audio-derived timing and richer envelopes:** no onset/downbeat/energy analysis, cue import, dense-cluster timing, or accelerate-to-hit-then-hold track mode | Terminal Reliquary; Reference-Pile Retention Stack; Typographic Incantation; Mascot Clone Chorus; Found-Clip Evidence Wall; Feedback Corridor Pilgrimage; Hard-Button Loop | 7 |
| 2 | **Rich typography and layout:** no text measurement/wrap/alignment box, per-word/glyph spans, stroke/shadow/gradient, caption cues, or extruded 3D text | Terminal Reliquary; Chrome Halo Procession; Reference-Pile Retention Stack; Typographic Incantation; Institutional Signal Hijack; Retro-Web Urgency Shrine | 6 |
| 3 | **Native compositing/masking:** no crop/fit/anchor, split-screen/PIP/pillarbox primitives, chroma/luma key, face mapping, or regional post masks | Terminal Reliquary; Reference-Pile Retention Stack; Institutional Signal Hijack; Found-Clip Evidence Wall; Feedback Corridor Pilgrimage | 5 |
| 4 | **Clip sequencing and audio mixing:** no source in/out, playback-rate/reverse/freeze/one-shot controls, per-object asset switching, or multi-track audio/event mix; cloned `videoFrames` do not stagger playback | Reference-Pile Retention Stack; Mascot Clone Chorus; Found-Clip Evidence Wall; Hard-Button Loop | 4 |
| 5 | **Actual 3D character/material surface:** no mesh import/rig/morph/lighting/environment reflection, extruded text, particle VFX; sprite billboarding makes authored `rotation.z` ineffective | Chrome Halo Procession; Mascot Clone Chorus; Retro-Web Urgency Shrine; Hard-Button Loop | 4 |

Two cross-cutting gaps narrowly miss the top five: no reusable style-preset/opinionated scene-template layer, and halftone has no mix/opacity uniform. The latter directly limits Retro-Web Urgency Shrine and any partial print treatment.

# Exact rerun / verification commands

From the repository root:

```sh
python3 - <<'PY'
import re
from pathlib import Path
recipes = Path('docs/research/style-recipes.md').read_text()
plan = Path('docs/plans/scene-lab.md').read_text()
heads = re.findall(r'^## Recipe \d+ — ', recipes, re.M)
blocks = re.split(r'^## Recipe \d+ — ', recipes, flags=re.M)[1:]
assert len(heads) == 10, len(heads)
assert all(len(set(re.findall(r'`(\d+-\d+)`', b))) >= 2 for b in blocks)
assert all('**`scene.v1` implementability.**' in b for b in blocks)
assert plan.count('## Style vocabulary v1') == 1
print('PASS: 10 recipes; >=2 unique exemplars and implementability per recipe; vocabulary appended once (coverage consumed: 56 catalog entries)')
PY
```
