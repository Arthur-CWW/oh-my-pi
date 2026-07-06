# Rotejin Effect: PuruPuru PNGTuber

Source post: https://x.com/rotejin/status/2073673225968730509  
Tweet text: `アバターの表情差分の機能テスト中👀` — testing avatar expression-variant behavior.  
Author context: rotejin’s profile says they post mainly about AI characters and are developing the AI VTuber 妹尾トマリ. Their recent media posts are a cluster around `PuruPuru PNGTuber`, a local browser app for rich PNGTuber avatars.

## Retrieval status

- Target dir: `data/inspiration/rotejin/`
- Info JSON written: `data/inspiration/rotejin/tweet-2073673225968730509.info.json`
- Direct public media URL observed via Nitter: `https://video.twimg.com/amplify_video/2073673079709200384/vid/avc1/1706x1320/x1P-5xrOfs9rJ76S.mp4`
- Video secured 2026-07-06 by orchestrator via workstation yt-dlp: `tweet-2073673225968730509.mp4` (2,636,537 bytes, 9.1s, 1706x1320). The earlier 14-byte artifact-reference write was removed.

## Visual read

Confidence: medium. I could not extract original-video frames locally because the binary could not be persisted; this description is grounded in the target post text, rotejin’s adjacent media posts, and the public `PuruPuruPNGTuber` repo/demo/usage docs. It should be treated as a source-code-and-demo analysis, not a frame-certified shot breakdown.

The effect is a chibi PNGTuber avatar with a very soft, tactile “ぷるぷる” wobble:

- Rendering style: flat 2D anime/chibi PNG layers, not a 3D VRM render. The face, front hair, back hair, and optional body/accessory layers are aligned transparent images.
- Shading/outline: baked into the PNG art. There is no evidence of runtime MToon, toon ramps, rim lighting, VRM outline passes, or 3D post bloom as the core trick.
- Motion character: the head/expression layer changes quickly while hair and body lag behind with springy overshoot. The cute part is the delayed elastic settling, especially at hair tips and body mass.
- Physics: custom spring/jiggle behavior over 2D image deformation. Hair strands behave like root-to-tip chains: roots remain attached to the face/head while tips trail, overshoot, and settle in S-curves. Body movement appears like a low-amplitude pulse/squash-stretch tied to face angle and/or speaking state.
- Expression system: six PNG expression states are expected by the repo docs: eyes open/closed crossed with mouth closed/half/open. The target tweet explicitly says it is testing avatar expression variations.
- Tracking/input: repo docs describe mic-driven lip sync, blinking, mouse following, and camera face tracking through vendored MediaPipe assets with a conservative CPU/15fps default.

## Technique hypothesis, ranked

1. **Custom 2D mesh-warp + spring physics on layered PNGs — highest likelihood / effectively confirmed by source docs.**  
   Rotejin’s repo describes PuruPuru PNGTuber as a local browser app where normal PNGTuber expression PNGs are augmented with front-hair and back-hair layers. It supports hair sway, face direction, mouth flaps, blinking, camera face tracking, OBS transparent output, `.purupuru` packages, and an advanced warp editor. The likely implementation class is triangular or control-line mesh warping over PNG layers, with per-strand spring oscillators and root-to-tip propagation.

2. **Live2D-style 2D rigging — lower likelihood as an analogy, not the implementation.**  
   The look overlaps Live2D: 2D art layers, expression swaps, face-angle illusion, hair physics. But the public repo is plain JavaScript/local web app around PNG assets, not a Cubism model/runtime.

3. **VRM spring bones / MToon / three-vrm — unlikely for the inspiration itself.**  
   VRM spring bones would explain secondary hair motion on a 3D avatar, and MToon would explain cel shading, but this effect is fundamentally PNG-layer deformation. Recreating it directly in the VRM body would miss the 2D tactile charm unless we intentionally add a 2D overlay layer.

4. **Pure transform/easing only — partial but insufficient.**  
   Simple AnimeJS-style position/rotation easing could make the avatar bounce, but it would not produce strand-like S-curves, tip lag, or local hair deformation. Use transforms for global bob/squash, not as the whole effect.

## Recreate recipe for our stack

Recommended target: **Ghost Room page as a 2D companion overlay layer**, not the three-vrm body first.

### Architecture

1. Add a `PuruPuruLayer` rendered in front of or beside the Ghost Room scene.
   - Canvas2D first for speed of implementation; WebGL mesh path later if Canvas drawImage clipping gets too slow.
   - Inputs: face angle vector, mouth openness, blink state, voice energy, and optional idle oscillator.

2. Asset format:
   - Required PNG layers: back hair, face/expression atlas or six expression PNGs, front hair.
   - Optional PNG items: body, ribbon, hairpin, props.
   - Store alignment metadata: canvas size, face center, neck pivot, mouth point, eye points, hair control lines root-to-tip.

3. Physics:
   - For each hair bundle/control line, maintain a small chain of points.
   - Root follows head angle immediately; each downstream point follows the previous point through a critically damped spring with tuned stiffness/damping.
   - Add velocity injection from face-angle delta and audio energy; clamp displacement and preserve approximate segment lengths to avoid rubber-sheet collapse.
   - Add low-amplitude vertical squash-stretch to body/face on speech peaks and direction changes.

4. Deformation:
   - MVP: piecewise affine triangular mesh warp for front/back hair over a coarse grid generated around control lines.
   - Simpler first pass: subdivide hair layer into strips along control lines, draw each strip with local translate/rotate/skew. This may be enough for the cute wobble.
   - Later: WebGL textured mesh with vertices driven by spring points; this matches the source class more closely and composes well with Ghost Room.

5. Expression and presence mapping:
   - Mic RMS / WebAudio presence layer → mouth closed/half/open crossfade.
   - Blink timer or camera blink estimate → eyes open/closed expression selection.
   - Companion attention/turn-taking state → face angle and body pulse intensity.
   - Keep motion small and delayed; the appeal is softness, not large animation.

### Effort

- **S**: Fake it with global head bob, hair layer rotation/translation lag, mouth PNG swaps. Good enough for a sketch; visibly less rich.
- **M**: Canvas2D strip/mesh warp, spring chains, mic mouth crossfade, blink timer, Ghost Room overlay integration. This is the recommended implementation slice.
- **L**: Full WebGL triangular mesh editor/importer, per-character `.purupuru`-like package support, MediaPipe face tracking, OBS/export parity.

### What not to do

- Do not implement this as VRM spring bones first. VRM bones are useful for the 3D avatar, but the inspiration’s charm comes from 2D PNG deformation and expression-layer swapping.
- Do not spend time on toon shaders/MToon/bloom for this specific effect. Those are orthogonal polish, not the mechanism.

## Extra example links

- Tutorial / movement adjustment: https://x.com/rotejin/status/2073544615555424734
- Normal PNGTuber vs PuruPuru PNGTuber side-by-side: https://x.com/rotejin/status/2073255301097353464
- PuruPuru PNGTuber repo announcement: https://x.com/rotejin/status/2072298727881224566
- Nearby target-family post: https://x.com/rotejin/status/2073368071818076411

## Sources inspected

- Target post via Nitter: `https://nitter.tiekoetter.com/rotejin/status/2073673225968730509`
- Rotejin media page via Nitter: `https://nitter.tiekoetter.com/rotejin/media`
- GitHub repo: `https://github.com/rotejin/PuruPuruPNGTuber`
- GitHub usage docs: `https://raw.githubusercontent.com/rotejin/PuruPuruPNGTuber/main/docs/usage.md`
- Repo demo image referenced by README: `https://github.com/rotejin/PuruPuruPNGTuber/blob/main/docs/images/purupuru.gif`
