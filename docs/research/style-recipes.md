# Presentation-layer style recipes

## Scope and evidence

These recipes describe **presentation machinery**, not subject matter. They are reusable ways to create referential density, beat grammar, aura, and performed register around any semantic payload. The semantic layer may inform the treatment, but none of the recipes requires a topic, ideology, joke, or narrator. The target is a local, mutable set of layers: assets, typography, layout, motion, edit rhythm, audio coupling, and post-processing can be swapped independently and recombined.

Evidence consumed at the start of this synthesis:

- all **56 unique video entries** then present in `docs/research/pleometric-reference-catalog.md` (30 in the original table and 26 incremental additions);
- all **39** Whisper records in `data/inspiration/pleometric/transcripts.json` (the spoken record is sparse by design: the vibe brief identifies 13 empty transcripts and several stingers);
- `data/inspiration/pleometric/manifest.json` as then present: 133 media records, 89 videos;
- the two-layer steer and oral-performance evidence in `power-posting-sources/{ontology.md,vibe-brief.md}`;
- the effect, timing, and pipeline evidence in `abelian-soup-methods/methods.md`;
- the `scene.v1` plan and current renderer schema/runtime.

Catalog IDs below retain the media suffix (`-1`). “Exact now” means expressible in the current `scene.v1` schema/runtime, not merely imaginable in Three.js. “Gap” names a missing renderer surface precisely.

## Evidence-derived lanes

The corpus supports four broad lanes, but they are **families of presentation choices**, not semantic categories:

1. **Machine liturgy / CRT** — supported by cyber-occult diagrams and CRT static (`2070631349778579630-1`), HR-video VHS/scanlines (`2049999955834568734-1`), LED-grid corporate retro-futurism (`2040599459151720517-1`), and monochrome ASCII display (`2023448161323221147-1`). Its invariant is institutional or terminal-like display performing authority.
2. **Chrome / aura-maxxing** — supported by glossy cosmic icon procession (`2055420576714408309-1`), chrome WordArt supplement advertising (`2043792556018794641-1`), glossy clay turntables (`2041660739610419385-1`), and the golden rotating “UNEMPLOYED!” halo (`2044829644910641471-1`). Its invariant is devotional surface treatment: shine, orbit, slow procession, oversized emblem.
3. **Referential-collage brainrot** — supported by Gigachad + Club Penguin + Subway Surfers split-screen (`2041310438583877970-1`), Paul Graham-as-Sonic over gameplay (`2040286299597234365-1`), Peter Griffin product theater (`2064045757515063502-1`), and Japanese-variety/security collage (`2067252216130376109-1`). Its invariant is fast traversal through an intentionally mismatched reference network.
4. **Typographic incantation** — supported by fragmented kinetic words (`2022433309612216701-1`), equations over a clone field (`2057289057483346095-1`), tiled imperative speech (`2068025479026593909-1`), and kinetic takeoff captions (`2050364782411202781-1`). Its invariant is language acting as image and percussion.

The ten recipes below split those lanes into operationally distinct grammars. They are deliberately composable: for example, **Chrome Halo Procession** can carry **Typographic Incantation**, while **Institutional Signal Hijack** can be cut with **Reference-Pile Retention Stack**.

## Recipe 1 — Terminal Reliquary

**Intent.** Make the frame feel like a machine delivering a revelation: austere, occult, technical, and already in progress.

**Visual grammar.** Warm near-black or true black ground; bone, terminal green, or warning-red marks; monochrome diagrams, grids, ASCII, formula fragments, eye/skull/icon plates. Use one deep plane plus a restrained `grid` or `line` clone field. Typography is monospaced or narrow grotesk, aligned like telemetry rather than a poster. Motion is a slow camera push or tunnel zoom with tiny clone phase waves; edit on downbeats, with brief static or displacement accents rather than constant chaos. CRT/VHS grime is the carrier layer; occasional bloom turns selected glyphs into relics.

**Audio coupling.** Let narration or a drone establish authority. Pulse bloom or displacement on downbeats; place new diagram plates on phrase boundaries. In wordless use, hold through the beat and change on the next strong onset rather than crossfading continuously.

**Exemplars.** `2070631349778579630-1`, `2049999955834568734-1`, `2040599459151720517-1`, `2023448161323221147-1`.

**`scene.v1` implementability.**

- **Exact now:** `plane`/`sprite`/`text`; `grid`, `line`, and `spiral` clones; `position.z`, scale, opacity, and camera keyframe/osc tracks; explicit beats; `vhs`, `glitch`, `displacement`, `feedback`, and `bloom`, including one numeric beat-reactive pass parameter.
- **Approximation:** author diagrams/ASCII animation as staged image or `videoFrames` plates; use several text objects for telemetry blocks.
- **Gaps:** no vector-path/diagram primitive or animated line drawing; no per-glyph text layout; no onset/downbeat analysis or accelerate-then-hold envelope; no post-pass masks/regions, so CRT damage affects the whole frame.

## Recipe 2 — Chrome Halo Procession

**Intent.** Manufacture aura: the subject reads as icon, mascot, product, or minor deity before it reads as information.

**Visual grammar.** Black/cosmic field; chrome, gold, pearl, purple, and hot specular highlights. One large center emblem with an `orbit` halo or a slow lateral procession. Typography is sparse, oversized, metallic/WordArt-like, and allowed to become architecture. Favor slow-motion loops, parallax, turntables, and a single ceremonial scale pulse over frenetic cutting. Clone/instancing should produce symmetry and rank, not clutter.

**Audio coupling.** Long tones or a slowed refrain carry the procession. Breathe halo scale/opacity at one or two beats; reserve the strongest bloom/glint or title reveal for the refrain. Silence before a beat can make the icon arrival feel heavier than another effect.

**Exemplars.** `2055420576714408309-1`, `2044829644910641471-1`, `2043792556018794641-1`, `2041660739610419385-1`.

**`scene.v1` implementability.**

- **Exact now:** center sprite plus `orbit` clones; phase-per-clone oscillation; slow camera `position.z`; opacity/scale beat pulses; cosmic image plate; bloom, feedback, and chromatic aberration.
- **Approximation:** bake chrome, specular lighting, clay, or WordArt into image/video assets; use a plane rather than a sprite when authored `rotation.z` must remain visible.
- **Gaps:** no 3D mesh/material/light/rig or environment reflection surface; no extruded/beveled 3D text; `Sprite` billboarding makes authored/animated `rotation.z` ineffective; no depth-aware glow/occlusion controls.

## Recipe 3 — Reference-Pile Retention Stack

**Intent.** Create “infinite referential mirrors”: attention moves through a network of familiar but incompatible signs faster than any single sign can settle.

**Visual grammar.** Deliberately collision-prone palette sampled from the source assets; gameplay, character cutouts, logos, reaction plates, HUDs, and captions share one frame. Use split-screen, picture-in-picture, corner inserts, sticker scatter, and abrupt scale hierarchy. Captions should be immediately readable while the surrounding frame remains overloaded. Motion alternates a stable retention plate with hard asset swaps, pop-ins, cutout dancing, and occasional feedback-tunnel depth. Edit densely on accents but leave one stable anchor.

**Audio coupling.** Map kick/snare or stressed syllables to insert swaps and scale pops; let a recognizable found-audio phrase command the largest reference change. For narration, change references at clause boundaries so collision adds meaning without masking the sentence.

**Exemplars.** `2041310438583877970-1`, `2040286299597234365-1`, `2064045757515063502-1`, `2067252216130376109-1`.

**`scene.v1` implementability.**

- **Exact now:** many image/video-frame planes and sprites; deterministic `scatter` clones; opacity keyframes for hard cuts; scale/position beat tracks; glitch, feedback, chromatic aberration; explicit beat times; audio mux.
- **Approximation:** precompose split screens and keyed cutouts as transparent assets; use separate planes for each fixed panel.
- **Gaps:** no layout/mask/crop/rounded-panel primitives for native split-screen/PIP/pillarbox; no chroma/luma keying or face mapping; no per-object asset/source switching track; every `videoFrames` clone samples the same source frame, so clone stagger does not stagger playback.

## Recipe 4 — Typographic Incantation

**Intent.** Turn a phrase into a spell or command: words arrive as beats, repeat as architecture, and remain legible under pressure.

**Visual grammar.** High-contrast two- or three-color palette; one phrase per visual breath. Alternate monumental centered type, fragmented corner words, equation/notation overlays, and tiled refrains. Use `line`/`grid` clone fields for repetition. Hard-cut text at sentence pivots; apply elastic entrances sparingly, scale-pop at rest, and opacity swaps for call-and-response. Edit rhythm follows syntax: clause, verdict, refrain.

**Audio coupling.** Time each phrase reveal to the spoken onset, not merely the global BPM. Repeated words may pulse every beat; a final word can hold while post effects decay. Song lyrics use phrase-level changes, not karaoke-by-default.

**Exemplars.** `2022433309612216701-1`, `2057289057483346095-1`, `2068025479026593909-1`, `2067715247679402255-1`.

**`scene.v1` implementability.**

- **Exact now:** text objects with font/color; keyframed position, scale, opacity, and rotation tracks; `grid`/`line` clones; explicit beat lists; beat-reactive scale and post parameters.
- **Approximation:** split a sentence into many text objects; bake formulas, mixed fonts, and complex layout into transparent images.
- **Gaps:** no text measurement/wrapping/alignment box; no per-word/per-glyph spans, kerning, stroke, shadow, or variable-font animation; no subtitle/cue schema tied to transcript timestamps; no 3D text extrusion/rotation.

## Recipe 5 — Mascot Clone Chorus

**Intent.** Convert one reusable character plate into communal energy: fandom, chorus, ritual repetition, or comic overpopulation.

**Visual grammar.** One strong mascot cutout against an animated or contrasting plate. Clone as ordered grid, marching line, orbital chorus, or purposeful scatter; retain one hero clone at a different scale/depth. Palette follows the mascot, with one contrasting signal color. Motion uses clone-index phase waves, synchronized hops, turntable-like loops, and a restrained camera push. Cut between chorus formations on section boundaries rather than randomizing every frame.

**Audio coupling.** Use beat pulses for group motion and a refrain for formation changes. `phasePerClone` creates a wave after each trigger; short voice loops can be mirrored by the same repeated gesture.

**Exemplars.** `2044763919009386830-1`, `2057289057483346095-1`, `2042976416514334860-1`, `2067714664348229948-1`.

**`scene.v1` implementability.**

- **Exact now:** `grid`, `line`, `orbit`, `spiral`, and seeded `scatter`; clone stagger for track time; phase-per-clone osc; position/scale/opacity tracks; camera push; sprite/image/video-frame assets.
- **Approximation:** stage a pre-rendered character dance or turntable as `videoFrames`; use multiple objects to represent hero and chorus formations.
- **Gaps:** no skeleton/rig/morph-target animation or face/lip tracking; no clone-level overrides or formation morphing; sprite `rotation.z` is ignored visually; cloned `videoFrames` playback is not staggered by clone time.

## Recipe 6 — Institutional Signal Hijack

**Intent.** Produce register-performance: a familiar media institution remains visually composed while alien material occupies it. The authority comes from the form never winking.

**Visual grammar.** Reconstruct the surface language of HR training, finance television, product demo, news/variety HUD, or onboarding: restrained brand palette, lower thirds, charts, disclaimers, presenter window, logo bug, and deliberate hierarchy. Motion is competent and templated—ticker movement, chart reveals, clean jump cuts—while one displaced character or plate creates the rupture. Typography stays bureaucratically legible. Edit at segment and sentence boundaries, not as generalized glitch.

**Audio coupling.** Delivery is flat and quiet. Use restrained stings for title cards, list ticks, or disclaimer changes; visual escalation can rise while vocal performance stays level. Found audio is valid if the frame clearly establishes a new institutional context.

**Exemplars.** `2049999955834568734-1`, `2056378137831682359-1`, `2067252216130376109-1`, `2064045757515063502-1`.

**`scene.v1` implementability.**

- **Exact now:** layered planes/sprites/text; fixed-position logo bugs; opacity/position keyframes; staged chart/screen assets; audio selection/gain/offset; mild VHS/glitch/bloom.
- **Approximation:** bake charts, lower thirds, tickers, and HUD packages into image/video assets; use one text object per field.
- **Gaps:** no reusable component/group parenting semantics (the schema accepts `group`, but the runtime group has no child relationship); no chart/data-binding or ticker primitive; no rich caption/lower-third layout; no scene/shot sequencing or reusable style-preset/template layer.

## Recipe 7 — Found-Clip Evidence Wall

**Intent.** Reframe ordinary footage as evidence: documentary credibility, deadpan reaction, or a sentence “already found in the world.”

**Visual grammar.** Black/off-white frame, vertical crop or dense grid, one dominant talking-head/reaction plate, optional duplicate angles, restrained caption bar, and small source-like marks. Use jump cuts, stable camera, mild lo-fi/VHS, and an evidence-wall grid only when comparison matters. Avoid decorative motion that competes with the found gesture or line.

**Audio coupling.** Preserve the source line and room tone. Cut on breaths, gesture peaks, or sentence endings. Duplicate/reprise a clip as a beat only when repetition changes its reading; captions should land with the spoken phrase.

**Exemplars.** `2067431750951690447-1`, `2067433262159409208-1`, `2055621213431468424-1`, `2069531636606357558-1`.

**`scene.v1` implementability.**

- **Exact now:** staged `videoFrames`; `grid` clones; fixed planes; mild `vhs`/bloom; opacity keyframes; audio mux with offset/gain; deterministic camera.
- **Approximation:** pre-crop/reframe source video and pre-mix its audio before staging; author captions as timed text-object keyframes.
- **Gaps:** no source in/out range, per-clip playback-rate, freeze-frame, reverse, or shot-cut schema; no automatic transcript alignment/caption cues; no native crop/fit/anchor/pillarbox blur; the renderer selects one scene audio asset rather than mixing found clip audio with narration/music.

## Recipe 8 — Retro-Web Urgency Shrine

**Intent.** Borrow the visual coercion of old banner ads and desktop ephemera—fake urgency, cheap abundance, cursed nostalgia—without inheriting their subject matter.

**Visual grammar.** Saturated yellow/cyan/magenta/red, hard black outlines, chrome WordArt, starbursts, fake buttons, tiled stickers, pixel/bitmap type, birthday-card or newspaper detours. Use scatter clones, flashing type, sprite-frame stepping, GIF-like jitter, and hard cuts. Layout should feel hand-composited and slightly wrong. Edit fast enough to feel pushy, but maintain a readable headline.

**Audio coupling.** Cheap stings, notification-like accents, or looped jingles can trigger flashes and button pops. Keep any narration dry against the over-selling visual surface.

**Exemplars.** `2052979237678653532-1`, `2043792556018794641-1`, `2071047326869664178-1`, `2071346891367792806-1`.

**`scene.v1` implementability.**

- **Exact now:** saturated backgrounds; sprite/text layering; seeded scatter; scale/opacity keyframes; beat glitch/chromatic aberration; halftone for newspaper/print takeover.
- **Approximation:** bake WordArt, outlines, buttons, starbursts, newspaper pages, and GIF frames into staged assets.
- **Gaps:** no sprite-sheet/frame-step animation; no CSS-like stroke/shadow/gradient or bitmap-type controls; halftone has no mix/opacity uniform, so it cannot be blended as a partial texture; sprite `rotation.z` is ineffective.

## Recipe 9 — Feedback Corridor Pilgrimage

**Intent.** Create hypnotic forward motion: the viewer travels through repeated images while trails imply a system larger than the current frame.

**Visual grammar.** Dark base with iridescent, psychedelic, or warning-color highlights. Build nested/spiral clones, a tunnel plate, or split-screen corridors; keep the center readable while edges smear. Camera pushes forward; clone scale/position phase produces waves; feedback zoom/rotate accumulates a vortex. Use a few decisive reference plates rather than undifferentiated noise.

**Audio coupling.** Motion should accelerate toward a beat, strike, then hold until the next wave—the timing behavior documented in the Abelian Soup pipeline. Increase trail pressure across a phrase or section; use strong onsets for plate changes and negative/glitch accents.

**Exemplars.** `2040814218497126624-1`, `2070631349778579630-1`, `2067714664348229948-1`, `2041310438583877970-1`.

**`scene.v1` implementability.**

- **Exact now:** `spiral`/`orbit`/`grid` clones; camera and object z tracks; phase-per-clone osc; feedback `decay`/`zoom`/`rotate`; displacement, bloom, glitch, and chromatic aberration; manual beat list.
- **Approximation:** stage a psychedelic corridor as video frames and layer clones over it; manually keyframe a crude rise/strike/decay.
- **Gaps:** no onset-energy/downbeat analysis, dense-cluster timing, or accelerate-then-hold track envelope; no neural FILM/inter-frame morphing; no post-parameter keyframe/osc track (only static base plus one beat envelope); no negative/invert pass.

## Recipe 10 — Hard-Button Loop

**Intent.** Make a tiny clip feel inevitable and replayable: establish one readable motion, then detonate or withhold at exactly one point.

**Visual grammar.** Minimal palette and composition; one character, reaction, or emblem; a clean loop or held frame; one abrupt explosion, disintegration, exposure blast, or reaction button. Typography is absent or one short setup line. The edit grammar is setup → anticipation → hard event → immediate cut/reset, never a dissolve.

**Audio coupling.** A short refrain, silence, or stable loop creates expectation. Trigger the event on one accent; cut the tail tightly so autoplay reconnects to the setup. The event may be visual-only, but its frame must be deliberate.

**Exemplars.** `2045554597280813392-1`, `2050907411259490462-1`, `2042039887256232267-1`, `2041710475684069845-1`.

**`scene.v1` implementability.**

- **Exact now:** opacity/scale/position keyframes for hard reveal and reset; explicit beat timing; staged effect plates; glitch/bloom/displacement spikes; deterministic looping video frames.
- **Approximation:** bake explosions, disintegration, character action, and exposure effects into a video-frame asset; overlay and hard-cut it with opacity.
- **Gaps:** no event/shot/loop-boundary abstraction; no particle/explosion/disintegration system; no asset source-range or one-shot playback controls; no audio event/multi-track mixer for accent plus ambience.

## Composition rules

- Choose **one lane-level carrier** (CRT, chrome, collage, or type) and at most two supporting recipes. A recipe is a bundle, not a requirement to activate every pass.
- Keep a stable anchor under referential overload: one caption, one hero emblem, one found voice, or one loop.
- Couple at two scales: phrase/section changes choose assets and layouts; beats/onsets animate scale, opacity, camera, or post intensity.
- Treat register as performed surface—voice, lower thirds, pacing, disclaimers—not a mandated subject.
- Prefer staged transparent assets for references; Scene Lab owns deterministic timing after staging.
- Current post order is global and full-frame. When a recipe calls for a local treatment, pre-bake it or name the mask gap rather than implying the renderer can isolate it.
- Avoid “AI default” styling by accident. Palette is recipe-specific; cyan-on-dark, purple gradients, and glassmorphism are evidence-backed only where the chosen recipe calls for them.
