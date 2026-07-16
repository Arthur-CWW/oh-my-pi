# Research report — AniChat motion generation architecture and comparative analysis

> **Status:** Synthesis through stage 14, including comparative literature review and the completed behavioral probe suite.
> **Evidence labels:** **Observed** = direct measurement via harness receipt or metadata read; **Inferred** = strong structural implication not directly proven; **Unknown** = not recoverable from available evidence.
> **Generation scope:** Model signatures, receipts, and probe findings apply to `older_anichat`. No `current_grok` motion model was executed; equivalence is **Unknown**.
> **Primary citations:**
> - [π₀: A Vision-Language-Action Flow Model for General Robot Control](https://arxiv.org/html/2410.24164v1) (Black et al., 2024)
> - [Real-Time Chunking (RTC)](https://www.pi.website/research/real_time_chunking) (Black, Galliker, Levine, 2025)
> - [Multi-Scale Embodied Memory (MEM)](https://www.pi.website/research/memory) (Torne et al., 2026)

---

## 1. AniChat topology and exact dimensions

The older AniChat predecessor contains 10 Core ML packages (`jit_*.mlmodelc`) organized as three parallel body-part pipelines, each following an **embedding → denoiser → decoder** triplet, plus a shared audio encoder. All packages are MLProgram specification 8, Float32, exported via `torch==2.5.1` / `coremltools==8.1`, targeting macOS 14 / iOS 17 (**Observed**: `metadata.json` across all 10 packages).

### 1.1 Audio encoder

| Input | Output |
|---|---|
| `input` F32 `[1, 1, 80, 40]` (flexible axis 1: `[1, 4096]`) | `linear_0` F32, shape flexible |

The metadata reports output shape `[]` (**Observed**). A synthetic run with `audioFrames=10` (seed 53) produced output `[1,10,256]` with 2560 elements (**Observed**: receipt `e37ed085`), exactly matching the denoisers' `audio_1 [1,10,256]` input shape. General `[1,T,256]` scaling is **Inferred** from the flexible signature and this one point; T values other than 10 remain untested. The 80×40 input dimensions are consistent with a mel-like representation (**Inferred**). Sample rate, hop length, normalization, caller wiring, and any intermediate transform remain **Unknown**.

### 1.2 Per-body-part pipelines

| Pipeline | Embedding input | Latent dim | Denoiser history depth | Decoder history depth | Decoder output | Special inputs |
|---|---|---|---|---|---|---|
| **Face** | `[1,2,52]` | 128 | 2 slots | 2 slots | `[1,8,52]` | `body_motion_latent_1 [1,256]` |
| **Body** | `[1,2,211]` | 256 | 2 slots | 2 slots | `[1,8,211]` | `gaze_dir_1 [1,3]` |
| **Wrist** | `[1,2,225]` | 256 | 4 slots | 2 slots | `[1,8,225]` | `body_motion_latent_1 [1,256]` |

All denoisers share: `noised_latent_1`, `history_features_1`, `times_1 F32 [1]`, `class_labels_1 Int32 [1]`, `audio_1 F32 [1,10,256]`. Each denoiser produces two outputs of equal shape — plausibly a predicted noise/velocity and a secondary estimate (**Inferred**; the exact denoising objective is **Unknown**).

**Critical correction:** The body denoiser does **not** have `body_motion_latent_1` as input — it takes `gaze_dir_1 [1,3]` instead. Face and wrist denoisers accept an input named `body_motion_latent_1` (**Observed signatures and executable inputs**); sourcing it from a body-model output is **Inferred**, not observed caller wiring.

### 1.3 Temporal alignment numbers: 2, 10, 8

Three temporal constants appear in the signatures:

- **2** — decoder history depth for all three body parts; also denoiser history depth for face and body (wrist denoiser uses 4) (**Observed**)
- **10** — audio conditioning frames in `audio_1 [1,10,256]` (**Observed**)
- **8** — decoder output frames, e.g. `[1,8,52]` for face (**Observed**)

How these align to wall-clock time is **Unknown**. The `characters.json` config records `"5 denoise steps, cfg=1"` (**Observed**), but neither the frame rate, the audio frame duration, nor the relationship between audio's 10 frames and decoder's 8 output frames has been determined. The 10 audio frames may span a slightly wider temporal window than the 8 output frames to provide lookahead context (**Inferred**); this is a common pattern in audio-conditioned motion synthesis but is not proven here.

---

## 2. Audio shape compatibility — measured

The earlier investigation flagged the audio encoder's metadata-reported output shape `[]` versus the denoiser's expected `audio_1 [1,10,256]` as an unsolved mismatch. Receipt `e37ed085` (seed 53, `audioFrames=10`, completed 2026-07-15T00:29:57Z) produced:

```
linear_0: Float32 [1, 10, 256] elements=2560 min=-0.734032 max=0.829278 mean=0.001420
```

The audio encoder's flexible second axis resolves to T when given T input frames. At T=10, its `[1,10,256]` output is shape-compatible with the denoisers' `audio_1 [1,10,256]` inputs (**Observed**). A caller connection between them is **Inferred**, not observed; intervening transforms, preprocessing, sample rate, windowing, hop size, and alignment are **Unknown**.

---

## 3. State taxonomy: no hidden Core ML state; caller-managed recurrence is plausible

### 3.1 Core ML stateSchema is empty

Every `jit_*.mlmodelc` package has `"stateSchema": []` and `"modelParameters": {}` in its `metadata.json` (**Observed**). Core ML's stateful model API (introduced in iOS 18 / macOS 15) allows models to declare internal state buffers managed by the runtime. AniChat's models do **not** use this mechanism. There are no hidden Core ML-managed recurrent states.

### 3.2 History tensors: a possible caller-managed recurrence interface

Despite the empty stateSchema, every denoiser receives `history_features_1` and every decoder receives `history_embed_1` as explicit input tensors (**Observed** — names, shapes, and signature presence). Their intended temporal semantics and any recurrent caller loop are **Inferred**, not observed:

| Model | History tensor | Shape |
|---|---|---|
| face_denoiser | `history_features_1` | `[1, 2, 128]` |
| face_dec | `history_embed_1` | `[1, 2, 128]` |
| body_denoiser | `history_features_1` | `[1, 2, 256]` |
| body_dec | `history_embed_1` | `[1, 2, 256]` |
| wrist_denoiser | `history_features_1` | `[1, 4, 256]` |
| wrist_dec | `history_embed_1` | `[1, 2, 256]` |

The depth dimensions are 2 or 4 (**Observed**). Their interpretation as prior latent or motion slots is **Inferred** from names and shapes; they are not established as raw frames or as fixed wall-clock durations. Who supplies these tensors, how they are initialized, and whether they roll over between chunks are **Unknown** because the orchestration code has not been observed. The signature design suggests a caller may:

1. Maintain recent embedding values (**Inferred**)
2. Slice a history window before each denoiser/decoder call (**Inferred**)
3. Initialize history at session start (zeros? idle pose?) (**Unknown**)
4. Handle interruptions, character switches, and timeout recovery (**Unknown**)

Each model call is a stateless function of explicit inputs (**Observed**). Synthetic probes establish that changing the history-named inputs changes outputs (**Observed for `older_anichat`**). A feedback edge from output to a later history input, and thus actual recurrent orchestration, remain **Inferred**; rollover implementation is **Unknown**.

---

## 4. Denoising objective and scheduler — Unknown

The `characters.json` config records `5 denoise steps` and `cfg=1` (**Observed**). Beyond this:

- **Noise schedule:** Unknown. Could be linear, cosine, or flow-matching-style linear interpolation. The `times_1 F32 [1]` input to each denoiser is consistent with a diffusion timestep or flow-matching interpolation parameter τ, but the specific schedule, parameterization, and whether it represents discrete DDPM-style steps or continuous flow time is not determinable from metadata alone.
- **Denoising objective:** Each denoiser outputs two tensors of equal shape. This is consistent with: (a) noise prediction + variance estimate (DDPM-style), (b) velocity prediction + data prediction (progressive distillation), or (c) split latent channels. Which of these applies is **Unknown**.
- **CFG=1:** Under the common formula `unconditional + scale × (conditional − unconditional)`, scale 1 yields the conditional prediction without an extra guidance boost. Whether AniChat uses that formula—or classifier-free guidance at all—is **Unknown**; only the configuration value is observed.
- **class_labels_1 Int32 [1]:** Likely selects character/style. `characters.json` has 8 enabled characters with distinct `animationStyle` and `faceAnimationStyle` fields (**Observed**). Whether this maps directly to the integer label is **Inferred**.

---

## 5. Comparative analysis: AniChat vs π₀, RTC, and MEM

### 5.1 π₀ flow matching (Black et al., 2024)

π₀ uses conditional flow matching to generate robot action chunks from a VLM backbone. Key architectural features:

- **Flow matching loss:** trains a velocity field v_θ to match the denoising vector u(A_t^τ | A_t) = ε − A_t along a linear-Gaussian probability path q(A_t^τ | A_t) = N(τ·A_t, (1−τ)·I) ([arXiv:2410.24164v1](https://arxiv.org/html/2410.24164v1), §IV).
- **Action chunks:** H=50 actions per chunk (1 second at 50 Hz), generated by integrating the learned vector field from τ=0 (noise) to τ=1 (data) using 10 Euler steps.
- **Action expert:** A separate set of transformer weights for action tokens, analogous to a 2-element mixture of experts. The VLM backbone processes images and language; the action expert processes proprioceptive state and generates actions.
- **Pre-training/post-training recipe:** broad pre-training on 10,000+ hours of diverse robot data, then post-training on curated high-quality demonstrations for specific tasks.

**AniChat comparison:**

| Aspect | π₀ | AniChat (Inferred/Observed) |
|---|---|---|
| Generation method | Flow matching (continuous τ ∈ [0,1]) | Likely diffusion or flow matching; `times_1` consistent with either (**Unknown**) |
| Output modality | Robot joint actions | Anonymous tensors with face/body/wrist-sized dimensions; rig mapping **Unknown** |
| Chunk size | 50 steps (1 sec at 50 Hz) | 8 output slots per decoder call (**Observed**); timing **Unknown** |
| Denoising steps | 10 Euler steps at inference | Config declares 5 for face/body; runtime use **Unknown** |
| Cross-conditioning | Multi-image + language + proprioception | Audio/history/class/body-latent/gaze-named slots (**Observed**); runtime sources and mappings **Unknown** |
| Architecture scale | 3.3B params (PaliGemma + action expert) | ~90 MB total package size across 10 models (**Observed**) |
| Embodiment | Cross-embodiment (7 robot configs) | Older character package with three region-sized model groups (**Observed**); final embodiment/rig mapping **Unknown** |

**False equivalence warning:** π₀ is a VLM-based generalist policy for robot manipulation. Older AniChat is a character-animation predecessor. Both expose timestep-conditioned denoiser-like computation and chunk-shaped outputs, but AniChat's training objective, solver, semantic planning, and rig mapping are **Unknown**. Claiming it "is π₀ for avatars" would conflate a published task-space policy with an opaque regional motion-model family.

### 5.2 Base π₀ reactive conditioning

The published base π₀ policy conditions on one current observation `o_t = [images, language, proprioception]` and generates a full action chunk. The paper specifies no explicit recurrent state or observation-history input (**Observed** from §IV).

**AniChat parallel:** Older AniChat denoisers and decoders accept fixed-shape history-named tensor slots. Their names and shapes are **Observed**; content, source, and runtime rollover are **Unknown**. This makes a caller-managed temporal interface plausible (**Inferred**), unlike base π₀'s documented current-observation policy.

### 5.3 Real-Time Chunking (RTC) — overlap and inpainting

RTC solves the real-time action chunk switching problem: when a new chunk arrives, the first N actions are already stale (the robot has moved past them during inference). RTC treats this as an **inpainting** problem:

- **Frozen prefix:** The first K actions (where K = inference latency in timesteps) are "frozen" to the values from the previous chunk that are actually being executed.
- **Partial attention:** Middle actions that overlap with the previous chunk are partially constrained — encouraging consistency while allowing updates based on new observations.
- **Flow matching inpainting:** Leverages the fact that diffusion/flow models are naturally good at inpainting, adapting image inpainting algorithms to the action-chunk setting with zero training-time changes ([pi.website/research/real_time_chunking](https://www.pi.website/research/real_time_chunking)).

**AniChat parallel:** AniChat's decoder outputs 8 frames but takes 2-frame history input, suggesting a possible 2-frame overlap between consecutive chunks (**Inferred**). Whether AniChat implements anything like RTC's inpainting for smooth chunk transitions is **Unknown**. The `characters.json` config does not reveal overlap or blending strategy. If AniChat uses simple concatenation with a 2-frame history lookback, chunk boundaries could produce discontinuities. If it uses an overlap-blend (common in audio synthesis via overlap-add), the transitions would be smoother. The exact mechanism is **Unknown** and is one of the highest-value investigation targets for understanding motion quality.

### 5.4 Multi-Scale Embodied Memory (MEM) — short and long-term

MEM introduces a dual-timescale memory mechanism for VLAs:

- **Short-term memory:** An efficient video encoder processes recent frames as raw visual observations, maintaining a sliding window of recent context.
- **Long-term memory:** Natural language summaries of past events, actively curated by the model's reasoning mechanism. The model decides what to remember and how to express it.
- **Multimodal integration:** Both memory streams feed into the VLA backbone alongside current observations and task instructions ([pi.website/research/memory](https://www.pi.website/research/memory)).

MEM enables tasks lasting 15+ minutes with in-context adaptation — the robot can correct mistakes based on what it remembers attempting.

**AniChat parallel:** `history_features_1` and `history_embed_1` provide fixed-size latent-history slots. Their names and shapes are **Observed**; the precise content and rollover policy are **Unknown**. This is closer to a minimal externally managed recurrent context than MEM's rich multimodal memory:

| Aspect | MEM | AniChat history |
|---|---|---|
| Short-term | Video encoder over recent frames | 2 or 4 latent slots (**Observed shapes**) |
| Long-term | Language summaries, actively curated | None observed; class labels may select persistent style (**Inferred**) |
| Timescale | Up to 15 minutes | Wall-clock duration **Unknown** because frame rate and rollover are unknown |
| Adaptation | In-context correction of strategies | No evidence of adaptation (**Unknown**) |
| Memory management | Model decides what to remember | External caller likely manages rollover (**Inferred**); implementation **Unknown** |

**False equivalence warning:** Calling older AniChat's fixed history-named inputs "memory" in the MEM sense is misleading. MEM documents actively curated multimodal context over minutes; AniChat exposes small opaque fixed-slot tensors whose content, wall-clock span, and rollover are unknown. The mechanisms and evidenced capacities differ; their timescale relationship cannot be established.

---

## 6. Likely ML design motivations

### 6.1 Why three separate pipelines instead of one model?

Separating face (52-D), body (211-D), and wrist (225-D) into independent embedding/denoiser/decoder triplets has several plausible motivations (**Inferred**):

1. **Computational efficiency on mobile:** Three small models can be scheduled independently, potentially overlapping inference on different compute units. Total weight size is ~90 MB — feasible for on-device inference on iPhone/iPad.
2. **Independent update cadence:** Face animation (expressions, lip sync) may need higher temporal resolution or more frequent updates than body pose. Separate models allow different scheduling.
3. **Asymmetric conditioning:** Body conditions on gaze; face and wrist condition on body motion latent. This directed dependency graph (body → face, body → wrist) avoids bidirectional coupling while allowing cross-body coordination.
4. **Training data separation:** Face, body, and wrist motion data may come from different capture rigs, annotation pipelines, or have different data volumes.

### 6.2 Why explicit history tensors instead of Core ML state?

The models target iOS 17 and expose explicit history tensor inputs rather than Core ML-managed state (**Observed**). Plausible motivations include (**Inferred**):

1. Caller-controlled rollover, reset, and interpolation without model reload.
2. Compatibility with the models' iOS 17 deployment target.
3. Easier inspection and deterministic synthetic testing.
4. Explicit control over initialization after interruption or character changes.

### 6.3 Why 5 denoising steps?

Five steps is aggressively few for standard DDPM (which typically uses 20–1000 steps) but reasonable for:
- Flow matching with Euler integration (π₀ uses 10 steps for robot control)
- Progressive distillation (trains a student to match a teacher in fewer steps)
- Consistency models or DDIM-style fast sampling

Each warm denoiser invocation measured roughly 3–5 ms on this M4 Max (**Observed**). Five denoise steps would invoke a denoiser five times, so the denoising portion alone would multiply that cost. Older AniChat character configuration declares five inference steps for face/body (**Observed configuration**), but actual scheduler execution and step math are **Unknown**; wrist sampling count is also **Unknown**. No end-to-end chained latency or mobile-device total has been measured.

---

## 7. False equivalences to avoid

1. **"AniChat is a VLA"** — No. VLAs generate actions conditioned on vision and language. Older AniChat model signatures expose audio-, history-, class-, and gaze-named inputs and anonymous motion-sized outputs; synthetic probes show several inputs affect outputs. No vision or language-instruction input is present. The structural comparison to π₀ is an iterative denoiser plus chunk-shaped output; AniChat's training objective and solver remain **Unknown**.

2. **"The history tensors are like transformer KV cache"** — No. KV cache grows with sequence length and captures arbitrary long-range dependencies. Older AniChat exposes fixed-size 2- or 4-slot tensors named for history (**Observed signatures**); their content and rollover are **Unknown**. The computational characteristics and information capacity differ from a growing KV cache.

3. **"AniChat uses RTC-style overlap"** — Not proven. Older AniChat decoders output 8 slots and accept 2-slot history-named inputs, which *could* support overlap, but actual chunk scheduling, blending, and transition strategy are **Unknown**. RTC specifically solves switching chunks while a robot is in motion; applicability does not establish implementation.

4. **"5 steps ≈ 10 steps, close enough"** — The number of denoising steps interacts nonlinearly with the noise schedule, step size, and whether the model was trained with distillation. 5 DDPM steps and 10 flow-matching Euler steps can produce very different quality levels depending on training. The comparison is not meaningful without knowing AniChat's objective.

5. **"Empty stateSchema means no state"** — True only for hidden Core ML-managed state. The models accept explicit history-named inputs, and synthetic interventions show those inputs affect outputs. Actual caller rollover, recurrence, reset, and continuity behavior remain **Unknown**.

---

## 8. Highest-information safe probes

### 8.1 Completed targeted probes

The `older_anichat` suite `7f7a8b88-89fc-4647-a5dd-f65dac47fcb2` completed 54 synthetic A/B runs: history and audio zeroing, class 0→1, gaze −X→+X, body-latent zeroing, and timestep 0→1. Results and limits are in `probe-findings.md`. These establish local input sensitivity, not production semantics, valid-value behavior, scheduler execution, or current-Grok equivalence.

Audio encoder T=10 was also measured as `[1,10,256]`. Frame scaling outside T=10 remains untested.

### 8.2 Remaining extensions

1. Run `audio_enc` with T = 1, 2, 5, 20 to test whether `[1,T,256]` holds across its declared range.
2. Sweep `class_labels_1` across known valid labels. The mapping from configured characters/styles to integers must be established first; 0–7 is only a hypothesis.
3. Probe `gaze_dir_1` with canonical forward/right/up vectors and multiple magnitudes. Only a −X→+X comparison has been measured.
4. Build an encoder→decoder chain with explicit, documented synthetic history rollover. This would test a proposed recurrence mechanism; it would still not recover the original caller's implementation.
5. Build per-input/per-output response matrices. Channel names and rig semantics remain **Unknown** until independently mapped.

---

## 9. Implications for Companion

### 9.1 What AniChat's architecture validates

- **Audio-conditioned modules execute locally at interactive single-call latency** on this M4 Max (**Observed**). End-to-end generation latency is **Unknown** because scheduler ordering, repeated steps, wrist sampling, and device compute-unit selection are unresolved.
- **Separate body-part pipelines** permit independent scheduling in principle (**Inferred**); the actual runtime schedule is unknown.
- **Explicit history inputs** provide a testable interface for caller-managed recurrence (**Observed interface; rollover Inferred**).
- **The installed model family is compact enough for local Core ML execution** (**Observed**); product/mobile feasibility still needs target-device measurement.

### 9.2 What Companion should do differently

1. **Semantic authority first:** The observed older model signatures contain no language instruction or semantic-intent input. Companion's typed semantic lanes (`sync > react > async`) with source identity (`self|user|world`) should remain the planning authority. Any future audio-conditioned motion worker belongs **below** semantic arbitration as the lowest-authority lane.

2. **Bounded residual, not replacement:** If an AniChat-like audio-conditioned residual worker is added, it should produce delta motion that is blended into (not replacing) semantically-driven animation. The semantic layer decides *what* the character does; the residual layer adds audio-reactive micro-expressions and breathing. Deadline miss → drop the residual, never queue it.

3. **History management as an explicit service:** Rather than leave history-named tensors to an unobserved external caller, Companion should expose its own history management as a typed service with explicit reset, interpolation, and rollover semantics. This makes proposed recurrent state visible, testable, and recoverable.

4. **MEM-inspired long-term context:** For multi-turn conversation or scene-aware behavior, Companion should keep semantic/episodic memory at the deliberative layer and short-term motion history near L0. MEM's separation of raw recent context from language-summarized long-term state is useful; older AniChat's fixed history-named slots—whose content and timing are unknown—are not evidence of narrative memory.

5. **Chunk continuity as a first-class contract:** If Companion adds a continuous chunk generator, test overlap conditioning, committed-prefix preservation, and latency-aware blending. RTC's inpainting is a useful design reference, but direct reuse is **not established** for AniChat because its denoising objective, scheduler, and maskability are unknown.

### 9.3 Probe-informed priorities

The synthetic A/B suite (`probe-findings.md`) changes the implementation order:

1. **Build the history contract before choosing a generator.** Decoder history ablations changed output by 1.06–1.32 normalized RMS; denoiser history changed it by 0.41–0.72. Short-term motion state, reset, and rollover are first-class infrastructure.
2. **Treat the scheduler as model identity.** Timestep 0→1 produced roughly 0.97–1.24 normalized RMS. A model manifest without timestep construction and solver math is incomplete.
3. **Compute audio features once, but do not let audio become intent.** Audio ablation was nonzero but modest under synthetic inputs. Shared features can drive texture; typed semantic events still decide gestures, affect, and authority.
4. **Do not promote opaque class labels into emotion state.** Class 0→1 had a very small synthetic effect and the valid mapping is unknown. Companion should condition a future model with its named semantic mix/profile contract, not inherit predecessor integers.
5. **Keep regional experts optional.** Body-latent sensitivity was larger for wrist than face under sampled inputs, supporting asymmetric cross-region conditioning as a hypothesis—not a mandatory architecture.

### 9.4 Proposed typed seams

```ts
interface MotionHistorySnapshot {
  readonly generation: number
  readonly sourceId: string
  readonly committedAtMs: number
  readonly latentSlots: ReadonlyArray<Float32Array>
  readonly resetReason: "startup" | "interrupt" | "model-swap" | "deadline-gap" | null
}

interface GeneratedResidualChunk {
  readonly sourceId: string
  readonly utteranceId: string
  readonly playbackAnchorMs: number
  readonly validUntilMs: number
  readonly regionMask: ReadonlyArray<MotionChannel>
  readonly frames: ReadonlyArray<Float32Array>
  readonly historyGeneration: number
  readonly confidence: number
}

interface ResidualModelManifest {
  readonly inputFeatures: ReadonlyArray<string>
  readonly chunkFrames: number
  readonly historySlots: number
  readonly solver: { readonly kind: string; readonly timesteps: ReadonlyArray<number> }
  readonly outputProfile: string
  readonly maximumAuthority: number
}
```

The implementation should preserve Companion's existing `MotionPrimitive`, source identity, playback epoch, channel ownership, and one-L0-writer rules. `GeneratedResidualChunk` is admitted only after those rules; a stale or late chunk is dropped rather than queued.

---

## 10. Source index

| Source | Role |
|---|---|
| `static-findings.md` | Stages 1–2: metadata, I/O signatures, scoped absences |
| `runtime-findings.md` | Stages 3–5: benchmarks, shape smokes, corrections |
| `diagrams.md` | Architecture diagrams (O/I/U tagged) |
| `research-diagrams.md` | Explanatory diagrams with comparative analysis |
| `reproduction-index.md` | Reproduction commands, receipt manifest, ledger queries |
| Receipt `e37ed085` | Audio encoder T=10 synthetic shape-compatibility run; caller wiring and transforms Unknown |
| [arXiv:2410.24164v1](https://arxiv.org/html/2410.24164v1) | π₀ flow matching VLA architecture |
| [pi.website/research/real_time_chunking](https://www.pi.website/research/real_time_chunking) | RTC overlap-inpainting for action chunks |
| [pi.website/research/memory](https://www.pi.website/research/memory) | MEM multi-scale memory for long-horizon tasks |
