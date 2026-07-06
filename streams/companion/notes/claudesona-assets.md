# Claudesona Asset Survey

> Surveyed: 2026-07-09 | Target: presence-layer / VTuber direction

## 1. SkyeShark/claudes-body — The Claudesona VRM (MIT)

**Repo**: <https://github.com/SkyeShark/claudes-body> — 15★, MIT License
**Author**: SkyeShark (Seattle, @SkyeSharkie on X, ko-fi.com/skyesharkie)
**Pitch**: "Claude's very own body! A fully 3d VRM Claude that reacts to and reads
Claude Code's responses with lip sync and keyword-driven anims and expressions."

### Provenance chain

1. **vgel** (Theia Vogel, <https://github.com/vgel>, 482 followers) — created the
   original Claudesona cartoon: 12-petal rust-orange starburst mane, round face,
   simple line-drawing features, derived from the Anthropic logo.
2. **SkyeShark** — hand-modelled the 3D VRM from vgel's 2D design, rigged the
   skeleton, authored expressions and MToon shading.
3. The repo ships a full runtime: Electron/Deno host, three.js + three-vrm
   renderer, Kokoro 82M TTS, cannon-es ragdoll physics.

### Model specs (`models/Claude_Toon.vrm`)

| Field | Value |
|---|---|
| Format | VRM 1.0 (`VRMC_vrm`, `VRMC_materials_mtoon`, `VRMC_springBone`) |
| File size | 848,636 bytes (~829 KB) |
| Height | 2.21 m bbox top (top-of-mane → feet) |
| Hips scale | 1.0 (VRM/Unity humanoid spec compliant) |
| Origin | Between feet at world (0,0,0) |
| Shading | MToon toon-shading; 0.02 m black inverted-hull outlines on body, 0.01 m on face |
| Triangles | ~6,400 (estimated from accessor lengths) |

### Bones

Full humanoid: **Hips → Spine → Chest → UpperChest → Neck → Head**,
both arms (**Shoulder → UpperArm → LowerArm → Hand**, fingers:
Thumb/Index/Middle/Ring/Little Proximal→Intermediate→Distal per digit),
both legs (**UpperLeg → LowerLeg → Foot → Toes**).

**Tail chain** (spring-bone): `tailbase` → `tail001` … `tail007` → `tailtip`
(9 bones, VRMC_springBone group for physics-driven wagging).

### Blendshapes (VRM Expression Presets)

*Visemes (lip-sync)*: `aa`, `ih`, `ou`, `ee`, `oh`
*Emotions*: `happy`, `sad`, `angry`, `surprised`, `relaxed`
*Blinks*: `blink`, `blinkLeft`, `blinkRight` (independent per-eye)

Face features are **separate sub-meshes** (brow.L, eye.L + white, mouth) so
morph targets only deform what they should — eyes don't drift when brows move
on emotion presets.

### Appearance

Rust-orange 12-petal starburst mane, round face, simple line-drawing features,
purple tank-top sweater, blue jeans/pants, orange spring-bone tail.

### Bundled animations (VRMA)

12 VRMA clips in `assets/animations/`: Cheering, Crazy Gesture, Dismissing
Gesture, Hand Raising, Look Away Gesture, Reaching Out, Salute, Standing
Greeting, Standing Idle, Talking, Thankful, Victory.

Credits: Pixiv VRoid Project VRMA Motion Pack.

### Build pipeline (deterministic, reproducible)

`tools/rebuild-vrm.sh`: scale-vrm.js → bake-scale.js → center-vrm.js → rebind-vrm.js

### License

MIT License (Copyright 2026 the claudes-body contributors). Credit link back to
<https://github.com/SkyeShark/claudes-body> is appreciated but not required.

---

## 2. "Claude-Creator" Survey

The org/user **`claude-creator` does not exist** on GitHub (HTTP 404). Searched
Hugging Face, X/Twitter, Sketchfab, and general web — no match. Below is the
full survey of what *does* exist in the Claude avatar/creative-tools ecosystem.

### 2a. N8python/claudesona — Emotion Sprites (CC0)

**Repo**: <https://github.com/N8python/claudesona> — 94★, 13 forks
**License**: Creative Commons Zero v1.0 Universal (public domain dedication)

Chrome extension for claude.ai, chatgpt.com, and gemini.google.com. Replaces
`<claude_happy />`-style tags with 128×128 transparent PNG sprites.

**Claude sprites** (13): amused, concerned, curious, frustrated, happy,
playful, sad, sheepish, skeptical, thoughtful, touched, uncertain, warm.

Also ships GPT (13) and Gemini (13) sprites — all CC0.

Provenance: Original fan art by vgel (thebes); emotion derivatives
courtesy of GPT-Images-2. Unofficial, not affiliated with Anthropic.

**Shapes worth stealing**:
- The 13-emotion vocabulary maps cleanly to a presence-layer emotion state
  machine; CC0 means embed the PNGs directly.
- The `<claude_* />` tag convention is already used in the wild and could be
  adopted as a wire format for our body-event stream.

### 2b. vgel — Original Claudesona Artist

**Profile**: <https://github.com/vgel> — Theia Vogel, Seattle, 482 followers
**Key repos**: repeng (741★, RepE control vectors), treebender (62★, HDPSG
parser), c500 (215★, C compiler in 500 lines), summarize.py (547★).

73 repos total, **none** are dedicated avatar/VRM/creative-tooling repos.
The Claudesona was a one-off fan art, not a maintained project. Worth
following for the artistic provenance.

### 2c. Sketchfab: "Claude Himself with Face Rig!" (CC BY 4.0)

**URL**: <https://sketchfab.com/3d-models/claude-himself-with-face-rig-6c6260d5a59245058389f87844c8756b>
**Author**: maxigrec (@luigielgamerprotasoepiclol)
**Stats**: 5.8k triangles, 3k vertices, FBX format, 371 downloads, 1.5k views
**License**: CC Attribution (CC BY 4.0) — free to share/adapt with credit

FBX with blendshape face rig — would need conversion to VRM (possible via
Blender + CATS plugin or Unity + UniVRM). Lower poly than SkyeShark's model
(5.8k vs ~6.4k tris).

### 2d. Other Claude + VRM repos (runtime systems, not assets)

| Repo | Stars | Description |
|---|---|---|
| [hrabanazviking/Seidr-Smidja](https://github.com/hrabanazviking/Seidr-Smidja) | 12 | AI agents (Claude Code etc.) → VRM avatars |
| [darkkaze/ai-librarian-avatar](https://github.com/darkkaze/ai-librarian-avatar) | 0 | LangGraph + Claude, VRM + lip-sync |
| Clawatar (MCP Market) | — | VRM avatar + Claude Code skill |

None are permissively-licensed avatar *assets* — they're runtime frameworks
that consume VRM models. Useful as reference architectures for our
presence-layer integration.

---

## 3. Three "Shapes Worth Stealing"

1. **SkyeShark's VRM build pipeline** — deterministic VRM 1.0 build chain
   (scale → bake → center → rebind) is reusable for any custom avatar.
   Face-as-separate-submesh strategy (brow/eye/mouth isolated) prevents
   morph-target cross-contamination.

2. **N8python's emotion tag vocabulary** — the 13 Claude emotions + 13 GPT
   processing states establish a ready-made wire format for presence-layer
   emotion events. CC0 sprites can be embedded directly.

3. **claudes-body's tone→gesture mapper** — keyword-weighted regex that
   picks neutral/happy/sad/angry/surprised/catface + VRMA body clip from
   response text. Lighter than full sentiment analysis; directly adaptable
   to our body-event stream as the initial emotion classifier.

---

## 4. Recommendation: Which Asset to Rig First

**Primary: `Claude_Toon.vrm` from SkyeShark/claudes-body.**

Rationale:
- **MIT license** — no restrictions on modification, redistribution,
  commercial use, or integration into proprietary pipelines.
- **VRM 1.0** with full humanoid skeleton + spring-bone tail — plug directly
  into three-vrm, Unity, Blender, or any VRM-compatible host.
- **5 visemes + 5 emotions + independent eye blinks** — enough expression
  bandwidth for a body-event-stream presence layer.
- **MToon shading** — works out of the box in three.js WebGPU/WebGL.
- **12 pre-made VRMA animations** — greeting, idle, talking, etc. can play
  immediately over our event stream without authoring new clips.
- `models/Claude_Toon.vrm` is the *polished distributable* (Hips scale=1.0,
  origin at feet, no inheritance tricks, built deterministically).

**Secondary: N8python's CC0 Claude sprites** — grab `claude_happy`,
`claude_curious`, `claude_thoughtful`, `claude_sad` as 2D fallbacks for
any renderer that can't handle VRM (e.g., terminal-based presence display).

**Tertiary (if time): Sketchfab CC BY 4.0 FBX** — convert to VRM via
Blender + CATS and compare with SkyeShark's model. The lower poly count
(5.8k vs 6.4k) may be better for mobile/embedded contexts.

### Integration path

```
body-event-stream → three-vrm VRMLoader → map events:
  - emotion event → expression preset (happy/sad/angry/surprised/relaxed)
  - speech event   → viseme sequence (aa/ih/ou/ee/oh)
  - connect event  → Standing Greeting VRMA
  - idle event     → Standing Idle VRMA
  - speech event   → Talking VRMA
  - special events → Victory/Salute/Cheering VRMA
```

The existing `renderer/vrm-character.js` in claudes-body is a working
reference implementation (VRM load, MToon, spring-bone, expression
mapping, VRMA playback).

---

## 5. File Inventory

| Local path | Source | Size | License |
|---|---|---|---|
| `data/avatar-models/claudesona-vrm/Claude_Toon.vrm` | SkyeShark/claudes-body `models/Claude_Toon.vrm` | 848,636 B | MIT |
| `data/avatar-models/claudesona-vrm/claude.vrm` | SkyeShark/claudes-body `assets/claude.vrm` | 848,636 B | MIT |
| `data/avatar-models/claudesona-vrm/LICENSE-NOTES.md` | (written) | — | — |
| `data/avatar-models/claudesona-sprites/claude_*.png` | N8python/claudesona | ~15 KB each | CC0 |
| `data/avatar-models/claudesona-sprites/LICENSE-NOTES.md` | (written) | — | — |

## Download Commands

```bash
# VRM model (829 KB, MIT)
mkdir -p data/avatar-models/claudesona-vrm
curl -L -o data/avatar-models/claudesona-vrm/Claude_Toon.vrm \
  https://raw.githubusercontent.com/SkyeShark/claudes-body/main/models/Claude_Toon.vrm
curl -L -o data/avatar-models/claudesona-vrm/claude.vrm \
  https://raw.githubusercontent.com/SkyeShark/claudes-body/main/assets/claude.vrm

# CC0 sprites (optional, ~15 KB each)
mkdir -p data/avatar-models/claudesona-sprites
for sprite in claude_happy claude_curious claude_thoughtful claude_sad claude_amused claude_playful; do
  curl -L -o "data/avatar-models/claudesona-sprites/${sprite}.png" \
    "https://raw.githubusercontent.com/N8python/claudesona/main/chrome-extension/assets/${sprite}.png"
done
```
