---
title: Sonic photoreal portrait lip-sync evaluation
date: 2026-07-16
agent: SonicPhotoreal
status: done
---

# Sonic photoreal portrait evaluation

This report evaluates the performance of the Sonic lip-sync model on a photoreal portrait (Barack Obama) using the 10-second `what-lab` narration and seed 72589, and compares it directly to the stylized figurine run (Claude) under identical parameters.

## Source Portrait

- Asset: Barack Obama official portrait (2012), 2,687 × 3,356 px
- Source page: https://commons.wikimedia.org/wiki/File:President_Barack_Obama.jpg
- Bounding box: `[651, 18, 1990, 1357]` cropped and resized to 512 × 512 px.

## Temporal Evidence Summary

### 1. Lip-Audio Synchronization
- **Video 1 (Obama photoreal):** The correlation between the audio amplitude envelope and frame-to-frame mouth pixel change is **0.413**, showing that mouth movement is dynamically driven by the voice. The teeth pixel count (intensity >170) is high in the original portrait (346 pixels) but falls to near-zero in many speech frames, showing the model actively attempts to shape and close the mouth.
- **Video 2 (Claude stylized):** The correlation is **0.346**, but the mouth is entirely static (retaining the printed-line toy graphic). The measured correlation is a false positive caused by whole-head translation and spiky hair warping, not lip-sync.

### 2. Phoneme-Scale Mouth Articulation
- **Video 1 (Obama):** The model struggles to override the strong smiling prior of the source portrait. Specifically, at bilabial plosives which require complete lip closure (like the "b" in "bullshit" at 2.0s/frame 50 and the first "p" in "people" at 8.0s/frame 200), the teeth pixel counts remain high (**185** and **96** pixels respectively), resulting in incomplete mouth closure and anatomically incorrect speech representation.
- **Video 2 (Claude):** No phoneme-scale articulation is present.

### 3. Temporal Identity Preservation & Drift
- **Video 1 (Obama):** Severe identity and pose drift occur over the 10-second duration. The L1 difference vs. the cropped reference portrait is **5.997** at 2s and **5.813** at 5s, but spikes to **13.071** at 8s. Even after optimal alignment (shifting 2 px vertically and -2 px horizontally), the aligned difference at 8s remains high at **14.056** (compared to 6.090 at 2s and 5.744 at 5s), confirming structural facial warping.
- **Video 2 (Claude):** The figurine suffers from gradual drift; the L1 difference of the 8s still against the 2s still is **7.132** (aligned **8.072**), showing visible pose and hair geometry warping.

### 4. Facial and Video Artifacts
- **Video 1 (Obama):** The video contains **13 jump transitions** (L1 frame-to-frame difference >4.5) at frames 2, 3, 22, 23, 62, 63, 109, 132, 133, 212, 213, 246, 247. It also contains **14 frozen frame transitions** (L1 frame-to-frame difference <0.5) where the video stops moving, notably at 2.08s–2.20s and 4.80s–5.00s. These discontinuities coincide with sharp brightness jumps in the eye regions (up to **11.56** mean L1 difference in the left eye), producing visible eye jitter and head warp.
- **Video 2 (Claude):** The video is static and lacks jump transitions, but has **66 frozen frame transitions** (<0.5), which underscores its lack of dynamic mouth and head motion.

### 5. Regional Pixel Variance (Obama)
Comparing stills at 2s, 5s, and 8s against the cropped original portrait:

| Region | crop box (Y, X) | 2s Still Diff | 5s Still Diff | 8s Still Diff |
| :--- | :--- | :--- | :--- | :--- |
| Forehead | (50..120, 200..320) | 9.937 | 9.283 | **19.507** |
| Left Eye | (180..230, 180..240) | 16.090 | 10.765 | **47.575** |
| Right Eye | (180..230, 270..330) | 12.367 | 8.508 | **39.976** |
| Nose | (240..300, 230..290) | 6.672 | 4.616 | **26.092** |
| Mouth | (330..410, 200..320) | 7.557 | 6.348 | **25.722** |
| Chin/Jaw | (410..470, 200..320) | 7.142 | 6.232 | **21.864** |

All regions, including non-moving areas like the forehead and nose, more than double their deviation at 8 seconds, indicating that the face degrades structurally over time rather than simply translating.

## Production Lane Recommendation

**DEAD / PARK** for photoreal talking heads.

### Limitations and Issues:
1. **Temporal Discontinuities:** The chunk-based frame generation creates severe jump cuts and frozen frames every few seconds, making the video visually jarring and unprofessional.
2. **Identity & Facial Warping:** The model fails to preserve facial geometry and identity over a 10-second period. By 8 seconds, the eyes and forehead warp and distort significantly.
3. **Incomplete Articulation:** The model fails to resolve bilabial plosives ("b", "p"), leaving the mouth open and teeth visible when they should be closed, which breaks the illusion of speech.
4. **No Stylized Figurine Support:** As confirmed by the Claude run, the model lacks a stylized face/mouth prior, resulting in no mouth articulation whatsoever on non-human assets.

