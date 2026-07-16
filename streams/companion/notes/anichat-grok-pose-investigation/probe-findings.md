# Behavioral probe findings — older AniChat motion models

> **Suite:** `7f7a8b88-89fc-4647-a5dd-f65dac47fcb2`
> **Runtime:** CoreMLHarness 3.0, macOS 26.5.1, arm64
> **Seeds:** 61, 67, 73 (deterministic per-model random inputs)
> **Total:** 18 experiment tags, 54 probes (3 seeds × 18), 0 failures
> **Date:** 2026-07-15
> **Generation scope:** `older_anichat` only. No `current_grok` model was probed; equivalence is **Unknown**.

---

## 1. Methodology

Each probe executes a single Core ML model twice with **identical synthetic random inputs** except for one feature, which is set to either its baseline value (random or a fixed constant) or an ablated/swapped variant. The delta between the two outputs is measured per output tensor, per seed. All inputs are **off-manifold** (uniform random or constant scalars/vectors); no real preprocessed audio, face tracking, or history state is used.

### 1.1 Intervention types

| Type | Baseline | Variant | Meaning |
|---|---|---|---|
| `zero` | Random (seeded) | All zeros | Does zeroing this input change the output? |
| `constant 0→1` | Scalar 0 | Scalar 1 | How sensitive is this scalar input to a 0→1 intervention? |
| `vector [-1,0,0]→[1,0,0]` | Direction A | Direction B | Does a 180° directional flip register? |

### 1.2 Metrics

- **normalizedRms (nRms):** `rms(output_variant − output_baseline) / rms(output_baseline)`. Values near 0 mean the ablation barely changes the output; values near or above 1.0 mean the ablation produces a change comparable to or exceeding the output's own magnitude.
- **cosine:** Mean cosine similarity between baseline and variant output vectors. Values near 1.0 mean nearly identical direction; values near 0 mean orthogonal; negative values mean anticorrelated.
- All values reported as mean across 3 seeds. Ranges (min–max across seeds) are given where spread is notable.

### 1.3 Output structure

Denoiser models produce two output tensors (e.g. `var_647` + `var_648` for face). Decoder models produce one (e.g. `linear_27` for face, `linear_55` for body/wrist). The **output-averaged** columns below average nRms and cosine across all outputs of a model. Per-output detail is in §3.

### 1.4 Scope limitation

These probes measure **black-box input sensitivity**: whether the network's learned weights respond to a given input under synthetic conditions. They do **not** measure:

- Whether that input matters under real preprocessed data
- Training objectives, loss functions, or channel semantics
- Scheduler step counts, noise schedules, or diffusion sampling
- Motion quality, perceptual fidelity, or behavioral correctness
- On-manifold importance ordering (which may differ from off-manifold sensitivity)

---

## 2. Complete results table

All 18 experiment tags. nRms and cosine are output-averaged means across 3 seeds.

| # | Tag | Model | Ablated input | nRms | Cosine | Sensitivity |
|---|---|---|---|---|---|---|
| 1 | history-zero-face-decoder | face_dec | history_embed_1 → 0 | **1.319** | 0.238 | Extreme |
| 2 | history-zero-body-decoder | body_dec | history_embed_1 → 0 | **1.135** | −0.131 | Extreme |
| 3 | history-zero-wrist-decoder | wrist_dec | history_embed_1 → 0 | **1.057** | 0.028 | Extreme |
| 4 | timestep-0to1-wrist-denoiser | wrist_denoiser | times_1: 0 → 1 | **1.236** | 0.586 | Strong |
| 5 | timestep-0to1-face-denoiser | face_denoiser | times_1: 0 → 1 | **0.977** | 0.656 | Strong |
| 6 | timestep-0to1-body-denoiser | body_denoiser | times_1: 0 → 1 | **0.973** | 0.553 | Strong |
| 7 | history-zero-body-denoiser | body_denoiser | history_features_1 → 0 | **0.717** | 0.792 | Load-bearing |
| 8 | history-zero-face-denoiser | face_denoiser | history_features_1 → 0 | **0.585** | 0.799 | Load-bearing |
| 9 | history-zero-wrist-denoiser | wrist_denoiser | history_features_1 → 0 | **0.408** | 0.911 | Load-bearing |
| 10 | body-latent-zero-wrist-denoiser | wrist_denoiser | body_motion_latent_1 → 0 | **0.166** | 0.965 | Moderate |
| 11 | audio-zero-body-denoiser | body_denoiser | audio_1 → 0 | **0.133** | 0.984 | Modest |
| 12 | audio-zero-wrist-denoiser | wrist_denoiser | audio_1 → 0 | **0.067** | 0.996 | Modest |
| 13 | audio-zero-face-denoiser | face_denoiser | audio_1 → 0 | **0.059** | 0.996 | Modest |
| 14 | gaze-neg1to1-body-denoiser | body_denoiser | gaze_dir_1: flip x | **0.016** | 0.9999 | Small |
| 15 | body-latent-zero-face-denoiser | face_denoiser | body_motion_latent_1 → 0 | **0.014** | 0.9998 | Small |
| 16 | class-0to1-wrist-denoiser | wrist_denoiser | class_labels_1: 0 → 1 | **0.011** | 0.9999 | Small |
| 17 | class-0to1-body-denoiser | body_denoiser | class_labels_1: 0 → 1 | **0.009** | 0.9999 | Small |
| 18 | class-0to1-face-denoiser | face_denoiser | class_labels_1: 0 → 1 | **0.007** | 1.0000 | Small |

For navigation only, this report labels nRms ≥1.0 “extreme,” 0.9–1.0 “strong,” 0.4–0.72 “load-bearing,” 0.1–0.2 “moderate,” 0.05–0.14 “modest,” and <0.02 “small.” These are descriptive bands for this suite, not established scientific thresholds.

---

## 3. Per-output detail and structural observations

### 3.1 Denoiser second-output conditioning pattern

Denoisers have two outputs each (face: `var_647`/`var_648`; body: `var_1189`/`var_1190`; wrist: `var_1206`/`var_1207`). Under the sampled audio, body-latent, and class ablations, the **second output** (`var_648`, `var_1190`, `var_1207`) is exactly invariant: nRms = 0.000, cosine = 1.000 across all seeds. Both outputs respond to history and timestep ablations. Gaze is an exception: for `body_denoiser`, both `var_1189` and `var_1190` changed slightly (mean nRms 0.0140 and 0.0173 respectively).

Within this synthetic suite:
- Audio, body-latent, and class changed one observed output tensor while leaving the second unchanged
- History and timestep changed **both** observed output tensors
- For audio/body-latent/class—not gaze—the changed output tensor's sensitivity was roughly 2× the output-averaged value in §2

### 3.2 Per-output nRms for history ablation (denoiser)

| Model | Output 1 nRms | Output 2 nRms | Output 1 cos | Output 2 cos |
|---|---|---|---|---|
| body_denoiser | 0.600 [0.437–0.863] | 0.833 [0.747–0.969] | 0.853 | 0.730 |
| face_denoiser | 0.497 [0.347–0.615] | 0.673 [0.418–0.830] | 0.864 | 0.734 |
| wrist_denoiser | 0.372 [0.299–0.476] | 0.445 [0.346–0.602] | 0.926 | 0.896 |

Both outputs change substantially; output 2 is more sensitive to history than output 1 across all three models.

### 3.3 Per-output nRms for decoder history ablation

| Model | Output | nRms | nRms range | Cosine |
|---|---|---|---|---|
| face_dec | linear_27 | **1.319** | 1.092–1.681 | 0.238 |
| body_dec | linear_55 | **1.135** | 1.079–1.193 | −0.131 |
| wrist_dec | linear_55 | **1.057** | 1.041–1.072 | 0.028 |

Face decoder has the widest seed range (0.59 spread); body and wrist are tighter. Body decoder cosine is **negative**, meaning zeroing history flips the output direction on average.

### 3.4 Audio sensitivity: body > face ≈ wrist

On the affected output only (first output of each denoiser):

| Model | nRms (output 1) | Cosine (output 1) |
|---|---|---|
| body_denoiser | 0.266 [0.242–0.296] | 0.968 |
| wrist_denoiser | 0.133 [0.119–0.161] | 0.991 |
| face_denoiser | 0.118 [0.081–0.145] | 0.993 |

Under these synthetic inputs, body denoiser output 1 was about twice as sensitive to zeroing audio as face/wrist output 1. This does not establish which region is more speech-driven on-manifold.

### 3.5 Body-latent cross-coupling

`body_motion_latent_1` is an input on face and wrist denoisers (not body). The wrist denoiser shows moderate sensitivity (first-output nRms 0.331, range 0.078–0.470), while face denoiser sensitivity is small (first-output nRms 0.027). The wide wrist range shows that the measured input-dependent response varies substantially across sampled random points; it does not identify an internal pathway or production regime.

---

## 4. Interpretation

### 4.1 What these probes prove

1. **History inputs are the dominant measured conditioning signal.** Decoder history ablation produces nRms > 1.0 and near-zero or negative cosine. Denoiser history ablation produces nRms 0.41–0.72. Under these synthetic inputs, history is the most impactful decoder feature and one of the top denoiser features tested.

2. **The explicit history-input interface is behaviorally material.** Both `history_embed_1` and `history_features_1` materially affect outputs. This proves the older models use those inputs; it does not prove which runtime tensors populate them, whether they are rolled over, or who manages them.

3. **Timestep is structurally load-bearing for denoisers.** nRms 0.97–1.24 and cosine 0.55–0.66 demonstrate a strong timestep-conditioned transformation. This is consistent with iterative denoising, but does not identify DDPM, DDIM, flow matching, or a schedule.

4. **Audio changes one denoiser output tensor in the sampled intervention.** The effect is modest but nonzero under random inputs. Body measured larger than face/wrist in this suite.

5. **Class labels and gaze produce small effects under this probe.** nRms < 0.02 for class 0→1 and gaze −X→+X. This does not establish that these are valid on-manifold labels/directions or that the inputs are unimportant in production.

6. **Body-latent sensitivity is asymmetric under these inputs.** Zeroing `body_motion_latent_1` changed wrist output more than face output. This establishes black-box sensitivity at the sampled points, not semantic coupling strength during real motion.

### 4.2 What these probes do not prove

- **Real importance ordering.** On-manifold data (real audio features, real history state, valid class labels) could produce a different sensitivity ranking. History might be even more dominant, or audio might be more important, when inputs are in the trained distribution.
- **Channel semantics.** We do not know what `var_647` vs `var_648` represent, what units the outputs are in, or how the runtime scheduler maps them to animation parameters.
- **Training objectives.** Whether the model was trained with MSE, flow-matching, DDPM, or something else is unknown. The probe measures sensitivity, not loss landscape.
- **Diffusion schedule.** The number of denoising steps, noise schedule (linear/cosine/custom), and whether CFG is used remain unknown. `times_1` sensitivity confirms timestep conditioning exists but not the schedule shape.
- **Motion quality.** A large nRms does not mean the ablated output is bad motion or that the baseline output is good motion. We tested with random noise, not real inputs.

### 4.3 The recurrence question, answered precisely

Zeroing decoder history changed output by 1.06–1.32× baseline RMS; zeroing denoiser history changed it by 0.41–0.72×. Therefore the explicit history interfaces are not vestigial.

What is established: each Core ML call has no hidden managed state, but its output depends strongly on caller-supplied history tensors. What remains inferred: the app feeds prior generated state back across calls. The actual initialization, rollover source, reset policy, and chunk-boundary algorithm are still unobserved.

---

## 5. Recommended next experiments

### 5.1 On-manifold history rollover

Run the denoiser → decoder pipeline with real history state produced by the previous step's output, not random noise. Compare: (a) fresh-start (zeroed history) vs (b) 1-step warm history vs (c) N-step rollover. This would reveal whether the extreme decoder sensitivity persists with realistic history, and whether the system exhibits convergence, divergence, or stable recurrence over multiple steps.

### 5.2 Real preprocessing and scheduler discovery

To move from off-manifold probes to on-manifold evidence, reverse-engineer or discover the preprocessing pipeline: audio encoder input format (sample rate, windowing, normalization), diffusion scheduler (number of steps, noise schedule), and the output-to-history rollover mapping. Without this, we cannot run the model as the app does.

### 5.3 Valid class mapping

Determine the valid `class_labels_1` set and semantics from permitted local configuration, public documentation, or safely observed behavior. The 0→1 probe showed small sensitivity, but we do not know whether either value maps to a production style or character.

### 5.4 Chained multi-step rollover

Execute a denoiser → decoder → (history feedback) → denoiser chain for multiple steps. Measure whether:
- Output variance stabilizes (steady state) or diverges (unstable recurrence)
- History information decays, accumulates, or reaches a fixed point
- The system requires a specific number of warmup steps before producing stable outputs

### 5.5 Target-device latency under rollover

The existing benchmarks (§4 of runtime-findings.md) measure single-model cold/warm latency. Chained rollover introduces data dependencies between steps. Measure end-to-end frame generation latency for the full face+body+wrist pipeline under realistic step counts on target Apple Silicon.

---

## 6. Selected probe artifact IDs

Representative artifacts for independent verification (first seed of each):

| Tag | Artifact ID |
|---|---|
| history-zero-face-decoder | `42e2f4f7-d6f3-4153-ba39-e724ee72a266` |
| history-zero-body-decoder | `77859573-149f-4420-b536-6a2e9a42217a` |
| history-zero-wrist-decoder | `b333e5e7-08e2-4b74-835e-53ad5d0b7622` |
| history-zero-body-denoiser | `2fee3598-b1c1-491a-b3ae-5aacd7582e2d` |
| timestep-0to1-wrist-denoiser | `96b31989-294a-4ba9-b83e-d169eebd4c42` |
| audio-zero-body-denoiser | `65200d9c-4c7b-471b-ab8e-869ada55a144` |
| body-latent-zero-wrist-denoiser | `d63d4dab-af35-4fb5-aadc-a1fe5918f76a` |

Full suite: `packages/anichat-motion-lab/data/probe-suites/7f7a8b88-89fc-4647-a5dd-f65dac47fcb2.json`
