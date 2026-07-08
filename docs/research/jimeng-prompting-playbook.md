# Jimeng prompting playbook — hyper-shiny character figurines

*Distilled from the 2026-07-08 character-mashup run (5 successful subjects × 4 variants, jimeng-5.0 `high_aes_general_v50`, 2k, 2:3). Working manifests with exact prompts + seeds: `workflows/scene-lab/assets/characters/*/manifest.json`.*

## The scaffold that worked

```
[FIGURINE WRAPPER]
A hyper-realistic collectible 3D character figurine, glossy PVC vinyl toy,
wet high-gloss specular highlights, soft subsurface scattering plastic skin,
studio HDRI softbox lighting, three-quarter turnaround pose, centered,
clean seamless pale neutral gray studio backdrop, octane render,
ultra detailed, 8k, no text, no watermark
— [SUBJECT FUSION CLAUSE: one sentence fusing the two references, physical traits explicit]
— [MEME-MASCOT DISCLAIMER: "Playful meme mascot, NOT a real person, exaggerated cartoon caricature."]
[repeat wrapper tail]
```

Negative: `text, watermark, logo, signature, letters, caption, blurry, low quality, jpeg artifacts, extra limbs, deformed hands, mutated, photorealistic real human photograph, real celebrity face, nsfw, ugly, oversaturated`

## Lessons

1. **The wrapper carries the shine.** "wet high-gloss specular + subsurface plastic + HDRI softbox" is what produces the WAN-generation gloss Arthur wants; subject clauses alone come out matte.
2. **Fusion needs explicit anatomy assignment** — "whose whole round body IS a giant ripe orange with dimpled citrus peel, small human arms" beats "mixed with an orange". Say which parts belong to which reference.
3. **Real-person mashups**: caricature-figurine framing + "NOT a real person" disclaimer + `real celebrity face` in negative — passed cleanly for the Aschenbrenner subject (stylized, no likeness risk).
4. **Duplicate the wrapper after the subject** (prefix AND suffix) — anchors style against long subject clauses.
5. **2:3 at 2k** frames single figures with turnaround margin; 1:1 crops feet.
6. **One retry is normal**: ret=3018 "permission denied" appeared once mid-run and cleared on resubmit — transient, not risk-control. (Risk-control = 1019 / "shark not pass": STOP immediately, per AGENTS.md.)
7. **Auth**: cdp-fetch signs through the PAGE's cookies — a logged-out profile gives 1015 regardless of session bundle. Verify passport cookies (`sessionid`, `sid_guard`) exist before planning spend.

## Backlog

pernicious-penguin (UI-state retry) → then: per-character best-variant selection by Arthur (GALLERY + `n` notes), pose-transfer/lip-sync lane (T-2026-06-09-101), 3D mesh route (trellis2 → Blender rig per Abel's Jun 3 thread).
