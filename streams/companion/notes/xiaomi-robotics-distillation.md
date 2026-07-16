# Xiaomi robotics paper distillation

**Scope:** source distillation and fit analysis only. This note proposes no architecture or implementation change.

## Referent identification

**Most probable referent: _Xiaomi-Robotics-0: An Open-Sourced Vision-Language-Action Model with Real-Time Execution_, arXiv:2602.12684v2 (25 March 2026). Identification confidence: 0.90 (high, not certain).** The request's four clues—training data, action representation, inference latency, and control/deployment—are all central sections of this paper. MiMo-Embodied is a plausible name-memory match, but its reported contribution is embodied reasoning across driving and robotics rather than a real-time action policy.

| Rank | Recent Xiaomi candidate | What it is | Identity assessment |
| --- | --- | --- | --- |
| 1 | **Xiaomi-Robotics-0**, arXiv:2602.12684v2, 2026-03-25 ([paper](https://arxiv.org/abs/2602.12684), [HTML](https://arxiv.org/html/2602.12684), [official code](https://github.com/XiaomiRobotics/Xiaomi-Robotics-0)) | A 4.7B vision-language-action model that maps current images, an instruction, and proprioception to action chunks; its report explicitly covers asynchronous post-training and deployment ([§2](https://arxiv.org/html/2602.12684#S2)). | **Most probable.** It uniquely matches every requested distillation axis, especially learned action chunks and inference-time stitching. |
| 2 | **MiMo-Embodied**, arXiv:2511.16518, 2025-11-20 ([paper](https://arxiv.org/abs/2511.16518), [official repository](https://github.com/XiaomiMiMo/MiMo-Embodied)) | A cross-embodied foundation model evaluated on task planning, affordance prediction, spatial understanding, autonomous-driving perception/status prediction/planning, trained with multi-stage learning and CoT/RL ([abstract](https://arxiv.org/abs/2511.16518)). | Plausible because Arthur may remember the “MiMo-Embodied” name, but **less likely**: its paper abstract does not claim robot action generation, action chunks, or a real-time controller. |
| 3 | **Xiaomi-Robotics-U0**, arXiv:2607.11643, 2026-07-13 ([paper](https://arxiv.org/abs/2607.11643), [project](https://robotics.xiaomi.com/xiaomi-robotics-u0.html)) | A 38B world-foundation model for multi-view embodied image/video generation and data synthesis; the authors report that its generated data improves downstream π0.5 OOD task success ([abstract](https://arxiv.org/abs/2607.11643)). | Newest candidate, but **unlikely** for this prompt: it is a synthetic-data/world-model paper, not the action-policy/control-stack paper described by the clues. |

The rest of this note therefore distills Xiaomi-Robotics-0. Candidate ranking is identification, not a claim that Arthur named it explicitly.

## What Xiaomi-Robotics-0 actually learned

### Data regime

| Stage / corpus | Reported regime | What the supervision teaches | Source |
| --- | --- | --- | --- |
| Cross-embodiment robot pre-training | About **200M robot timesteps** from open datasets including DROID and MolmoAct plus Xiaomi's in-house trajectories | Observation + instruction + proprioception → short-horizon robot action generation across embodiments | [Paper §2.1](https://arxiv.org/html/2602.12684#S2.SS1) |
| In-house task data | Teleoperation: **338 h** Lego Disassembly and **400 h** Towel Folding | Task- and embodiment-specific bimanual manipulation; these are the two reported real-robot domains, not evidence for social/avatar motion | [Paper §2.1](https://arxiv.org/html/2602.12684#S2.SS1), [§3.2](https://arxiv.org/html/2602.12684#S3.SS2) |
| Vision-language co-training | More than **80M** samples spanning general and robot-centric visual grounding, VQA, captioning, and embodied reasoning/planning; VL:robot sampling ratio **1:6** in the first pre-training step | Preserve the base VLM's visual-semantic ability while adapting perception to egocentric/wrist-camera robot images | [Paper §2.1](https://arxiv.org/html/2602.12684#S2.SS1), [§2.2.1](https://arxiv.org/html/2602.12684#S2.SS2.SSS1) |
| Embodiment post-training | The whole model is adapted using trajectory data from the target robot; the released example describes a 20-hour earphone-packing dataset | Fit one physical embodiment/task distribution, including asynchronous prefix conditioning where enabled | [Paper §2.2.2](https://arxiv.org/html/2602.12684#S2.SS2.SSS2), [released post-training guide](https://github.com/XiaomiRobotics/Xiaomi-Robotics-0/blob/main/xr0/README.md) |

### Model and action representation

| Question | What the paper/release says | Boundary on the claim | Source |
| --- | --- | --- | --- |
| Inputs | Current observation images and language instruction enter Qwen3-VL-4B-Instruct; robot proprioception conditions the action model. | This is a physical robot state/action loop, not a dialogue-state or affect representation. | [Paper §2.2](https://arxiv.org/html/2602.12684#S2.SS2) |
| Output | A Diffusion Transformer generates a **T-step action chunk** using flow matching; the total model is 4.7B parameters. Inference uses five flow-integration steps. | The learned object is a continuous short-horizon actuator trajectory, not a named motion/social act. | [Paper §2.2](https://arxiv.org/html/2602.12684#S2.SS2), [§2.3](https://arxiv.org/html/2602.12684#S2.SS3) |
| Released real-robot schema | The released post-training path uses **30 × 32** chunks. Each timestep packs relative left/right end-effector position and axis-angle rotation, gripper, and six arm-joint deltas, with reserved dimensions. Targets are computed relative to current proprioception. | This 32-D schema is the released bimanual embodiment format; it should not be projected onto every pre-training robot or simulation embodiment. | [Official data-format specification](https://github.com/XiaomiRobotics/Xiaomi-Robotics-0/blob/main/xr0/docs/data_format.md) |
| Horizon and clock | Real-robot experiments use **T=30**, one second at **30 Hz**. LIBERO/CALVIN use T=10 and SimplerEnv T=4, so chunk length is evaluation-dependent. | “30-step” is not a universal architectural constant. | [Paper §2.3](https://arxiv.org/html/2602.12684#S2.SS3), [§3.1](https://arxiv.org/html/2602.12684#S3.SS1), [§3.2.2](https://arxiv.org/html/2602.12684#S3.SS2.SSS2) |
| Pre-training | Step 1 teaches the VLM to predict and score multiple candidate action chunks with a winner-takes-all update; step 2 freezes the VLM and trains a 16-layer DiT from scratch with flow matching. | Choice scoring and diffusion generation are two training stages, not two runtime control tiers. | [Paper §2.2.1](https://arxiv.org/html/2602.12684#S2.SS2.SSS1) |
| Asynchronous post-training | Clean actions already committed by the preceding inference are prefixed to noisy future-action tokens. A Λ-shaped attention mask lets near-future tokens use that prefix for continuity while preventing later tokens from copying it, forcing renewed visual/language conditioning; loss is reweighted toward larger online prediction errors. | They learned **prefix-conditioned chunk continuation**. The clocking and splice point remain deployment logic. | [Paper §2.2.2](https://arxiv.org/html/2602.12684#S2.SS2.SSS2) |

### Latency and control stack—not “latency tiers”

Xiaomi-Robotics-0 does **not** describe an L0/L1/L1.5/L2-style hierarchy. It describes one learned action policy plus two execution modes. Calling those modes “tiers” would overstate the paper.

| Layer or timescale actually reported | Mechanism | Learned vs engineered | Source |
| --- | --- | --- | --- |
| Sensor/model clock | Camera and proprioceptive streams are timestamp-resampled onto a unified **30 Hz** timeline. The 4.7B model takes **80 ms** per inference on an RTX 4090. | Resampling and scheduling are engineered deployment; chunk prediction is learned. | [Paper §2.3](https://arxiv.org/html/2602.12684#S2.SS3) |
| Synchronous execution | Execute the first Te actions, request the next chunk, and leave the robot idle until inference finishes. | Engineered controller schedule around the learned policy. | [Paper §2.3, “Synchronous Execution”](https://arxiv.org/html/2602.12684#S2.SS3) |
| Asynchronous execution | Continue consuming the old chunk while inferring the next. Prefix at least the inference-window actions, then start the new chunk at the latency-aligned timestep so an action is always available. | Prefix response is learned in post-training; overlap, timestamp alignment, discard/splice, and action availability are engineered deployment logic. | [Paper §2.3, “Asynchronous Execution”](https://arxiv.org/html/2602.12684#S2.SS3), [released deployment guide](https://github.com/XiaomiRobotics/Xiaomi-Robotics-0/blob/main/xr0/README.md#deployment) |
| Observed trade-off | On Lego, asynchronous variants were slightly less precise/reactive than synchronous variants but higher-throughput; the full asynchronous method had the best throughput among compared methods. | This is evidence that hiding latency can trade away reactivity; it is not evidence that asynchronous control is universally better. | [Paper §3.2.3](https://arxiv.org/html/2602.12684#S3.SS2.SSS3) |
| Unreported lower controller | The report says a robot controller consumes/schedules action chunks, but does not specify its servo, impedance, collision, or safety controller. | **Unknown; do not invent a Xiaomi low-level control tier.** | [Paper §2.3](https://arxiv.org/html/2602.12684#S2.SS3), [released deployment guide](https://github.com/XiaomiRobotics/Xiaomi-Robotics-0/blob/main/xr0/README.md#deployment) |

## Honest mapping to our shipped contract

Our contract is different by design: only L0 writes avatar channels, the browser owns a zero-allocation 60 Hz loop, and upper layers emit discrete semantic `SocialAct` / `MotionPrimitive` intents ([HANDOFF-BEHAVIOR.md:194-197](../HANDOFF-BEHAVIOR.md#L194-L197), [205-206](../HANDOFF-BEHAVIOR.md#L205-L206)). Our four realtime tiers and their authority boundaries are already fixed ([HANDOFF-BEHAVIOR.md:223-236](../HANDOFF-BEHAVIOR.md#L223-L236)). Movement is task-space social intent, while L0 performs rig-local projection ([HANDOFF-BEHAVIOR.md:248-268](../HANDOFF-BEHAVIOR.md#L248-L268)). The MVP explicitly remains current-state classification plus interruptible authored primitives—not learned action chunks or flow matching ([HANDOFF-BEHAVIOR.md:254](../HANDOFF-BEHAVIOR.md#L254)).

| Disposition | Xiaomi result | Mapping to us | Why |
| --- | --- | --- | --- |
| **Applies to us now** | Never let slow inference create a hole in realtime output; retain a continuously available trajectory while later work runs ([paper §2.3](https://arxiv.org/html/2602.12684#S2.SS3)). | Reinforces, but does not alter, **L0 60 Hz never-awaits** and the rule that late intents may be dropped/damped/re-anchored ([HANDOFF-BEHAVIOR.md:229](../HANDOFF-BEHAVIOR.md#L229), [246](../HANDOFF-BEHAVIOR.md#L246)). | Same realtime invariant; different controller and output ontology. |
| **Applies to us now** | Temporal continuity can make a policy copy its previous action prefix and become less reactive; Xiaomi explicitly trains against that shortcut ([paper §2.2.2](https://arxiv.org/html/2602.12684#S2.SS2.SSS2)). | A useful review question for authored primitives: does continuity/easing suppress a newer, higher-priority interrupt? Existing TTL, priority, phase, and source fields already encode the bounded answer ([HANDOFF-BEHAVIOR.md:256-266](../HANDOFF-BEHAVIOR.md#L256-L266)). | It sharpens validation of our present contract; it does not justify importing their model. |
| **Does not apply** | End-to-end prediction of 30 Hz, 32-D bimanual end-effector/joint/gripper deltas ([official schema](https://github.com/XiaomiRobotics/Xiaomi-Robotics-0/blob/main/xr0/docs/data_format.md)). | L1/L1.5/L2 must not emit avatar bones/blendshapes, much less physical joint deltas; they emit semantic social acts and L0 alone projects them ([HANDOFF-BEHAVIOR.md:252-268](../HANDOFF-BEHAVIOR.md#L252-L268)). | Physical actuator imitation and character expression have different data, safety, embodiment, and authoring requirements. |
| **Does not apply** | One VLA directly binds vision/language/proprioception to an action policy ([paper §2](https://arxiv.org/html/2602.12684#S2)). | Our L1 rules, optional L1.5 policy, L2 speaker, and L0 renderer have intentionally separated authority ([HANDOFF-BEHAVIOR.md:223-236](../HANDOFF-BEHAVIOR.md#L223-L236)). | Xiaomi's execution modes are not substitutes for our latency/authority tiers. |
| **Does not apply** | Cross-embodiment pre-training uses 200M physical robot timesteps and 80M+ VL samples ([paper §2.1](https://arxiv.org/html/2602.12684#S2.SS1)). | We have no equivalent paired corpus of character state, social context, intent, rig projection, and judged expressive outcome. | Their reported generalization cannot be presumed for avatar motion. |
| **Later benchmark only** | Learned action chunks can represent multimodal short-horizon futures and run asynchronously ([paper §2.2](https://arxiv.org/html/2602.12684#S2.SS2), [§2.3](https://arxiv.org/html/2602.12684#S2.SS3)). | If the existing MVP guard is later lifted, compare a learned **candidate** short-horizon motion generator against current classification + interruptible authored primitives; L0 sole-writer and semantic-command boundaries remain evaluation invariants ([HANDOFF-BEHAVIOR.md:194-197](../HANDOFF-BEHAVIOR.md#L194-L197), [254](../HANDOFF-BEHAVIOR.md#L254)). | Benchmark continuity, interrupt latency, semantic fidelity, rig-transfer degradation, and failure recovery—not visual smoothness alone. |
| **Later benchmark only** | Xiaomi reports throughput gains alongside a precision/reactivity cost in one real-robot task ([paper §3.2.3](https://arxiv.org/html/2602.12684#S3.SS2.SSS3)). | Any future learned-motion comparison should publish both smoothness/throughput-style measures and interruption/reactivity failures. | Prevents “smooth” from hiding stale or socially wrong motion. |

## Bottom line

| Question | Answer |
| --- | --- |
| What did they learn? | A cross-embodiment, vision/language/proprioception-conditioned diffusion policy that generates short continuous robot-action chunks, then an embodiment-specific prefix-conditioned continuation behavior for asynchronous rollout ([paper §2](https://arxiv.org/html/2602.12684#S2)). |
| What did they engineer? | Timestamp synchronization, inference overlap, chunk alignment/splicing, and the robot-controller schedule ([paper §2.3](https://arxiv.org/html/2602.12684#S2.SS3)). |
| What transfers now? | The invariant that realtime output never waits, and the warning that continuity can defeat reactivity. Both fit our existing L0/interrupt contract; neither calls for a new component. |
| What does not transfer now? | Their 30 Hz physical action space, end-to-end VLA authority, imitation-data scale, and learned chunks. Our MVP guard explicitly excludes these ([HANDOFF-BEHAVIOR.md:254](../HANDOFF-BEHAVIOR.md#L254)). |

## Bounded next-step menu

Choose **zero or one**; all are review/research activities, not builds:

1. **Archive only (recommended now):** retain this as evidence that the shipped never-awaits/interruptible-primitives contract is directionally consistent; make no change.
2. **Paper comparison:** distill one independent real-time action-chunk method (RTC or π0.5) using the same learned-vs-engineered and reactivity-vs-continuity rubric; produce one note, no implementation.
3. **Later-benchmark brief:** only after the authored-primitives path is proven and Arthur explicitly reopens the MVP guard, write an offline evaluation protocol for learned candidate chunks covering interrupt latency, semantic fidelity, continuity, rig transfer, and stale-action rate; do not wire a model into runtime.
