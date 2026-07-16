# Research diagrams — AniChat architecture and comparative analysis

> **Purpose:** Explanatory diagrams for older AniChat's motion-model signatures, a possible recurrent orchestration, and comparison to π₀/RTC/MEM. Every edge is tagged O (Observed), I (Inferred), or U (Unknown). Model evidence is `older_anichat` only; `current_grok` equivalence is Unknown. For exact I/O inventories see `diagrams.md`.
>
> **Citations:**
> - [π₀](https://arxiv.org/html/2410.24164v1) (Black et al., 2024)
> - [RTC](https://www.pi.website/research/real_time_chunking) (Black, Galliker, Levine, 2025)
> - [MEM](https://www.pi.website/research/memory) (Torne et al., 2026)

---

## 1. End-to-end tensor DAG

How the 10 model signatures are shape-compatible. This is not an observed runtime call graph; caller wiring remains Inferred or Unknown.

```mermaid
flowchart TD
    subgraph Inputs ["External inputs"]
        RawAudio["Raw audio stream<br/>(U: sample rate, format)"]
        PriorPose["History-named model input<br/>(U: source, content, frame rate)"]
        Style["Older character/style configuration<br/>(O: characters.json; U: integer mapping)"]
        Gaze["Gaze-named model input<br/>(U: runtime source)"]
    end

    subgraph AudioPipeline ["Audio feature extraction"]
        PreProc["Preprocessing<br/>(U: mel? hop? norm?)"]
        AudioEnc["jit_audio_enc<br/>T=10: F32 [1,10,80,40] → [1,10,256]<br/>(O: metadata + receipt e37ed085)<br/>general T-scaling (I)"]
        RawAudio -->|"U: preprocessing"| PreProc
        PreProc -->|"U: framing"| AudioEnc
    end

    subgraph HistoryMgmt ["Explicit history-named inputs (U: caller orchestration)"]
        FaceHist["Face history-named slots<br/>[1,2,128]<br/>(O: shape, U: content/rollover)"]
        BodyHist["Body history-named slots<br/>[1,2,256]<br/>(O: shape, U: content/rollover)"]
        WristHist["Wrist history-named slots<br/>[1,4,256]<br/>(O: shape, U: content/rollover)"]
    end

    subgraph FacePipe ["Face pipeline"]
        FEmb["jit_face_embedding<br/>[1,2,52] → [1,2,128]<br/>(O)"]
        FDeno["jit_face_denoiser<br/>6 inputs → 2×[1,128]<br/>(O)"]
        FDec["jit_face_dec<br/>[1,128]+[1,2,128] → [1,8,52]<br/>(O)"]
        PriorPose -->|"I: shape-compatible with input_1"| FEmb
        FEmb -->|"I: possible history_features_1 source"| FDeno
        FaceHist -->|"O: history_features_1 slot"| FDeno
        AudioEnc -->|"I: shape-compatible [1,10,256]"| FDeno
        Style -->|"I: possible class_labels_1 source"| FDeno
        FDeno -->|"I: possible z_1 source"| FDec
        FaceHist -->|"O: history_embed_1 slot"| FDec
        FDec -->|"O: [1,8,52]"| FaceOut["52-D anonymous output × 8 slots"]
    end

    subgraph BodyPipe ["Body pipeline"]
        BEmb["jit_body_embedding<br/>[1,2,211] → [1,2,256]<br/>(O)"]
        BDeno["jit_body_denoiser<br/>6 inputs → 2×[1,256]<br/>(O)"]
        BDec["jit_body_dec<br/>[1,256]+[1,2,256] → [1,8,211]<br/>(O)"]
        PriorPose -->|"I: shape-compatible with input_1"| BEmb
        BEmb -->|"I: possible history_features_1 source"| BDeno
        BodyHist -->|"O: history_features_1 slot"| BDeno
        AudioEnc -->|"I: shape-compatible [1,10,256]"| BDeno
        Style -->|"I: possible class_labels_1 source"| BDeno
        Gaze -->|"O: gaze_dir_1 input slot; U: source"| BDeno
        BDeno -->|"I: possible z_1 source"| BDec
        BodyHist -->|"O: history_embed_1 slot"| BDec
        BDec -->|"O: [1,8,211]"| BodyOut["211-D anonymous output × 8 slots"]
    end

    subgraph WristPipe ["Wrist pipeline"]
        WEmb["jit_wrist_embedding<br/>[1,2,225] → [1,2,256]<br/>(O)"]
        WDeno["jit_wrist_denoiser<br/>6 inputs → 2×[1,2,256]<br/>(O)"]
        WDec["jit_wrist_dec<br/>[1,256]+[1,2,256] → [1,8,225]<br/>(O)"]
        PriorPose -->|"I: shape-compatible with input_1"| WEmb
        WEmb -->|"I: possible history_features_1 source"| WDeno
        WristHist -->|"O: history_features_1 slot"| WDeno
        AudioEnc -->|"I: shape-compatible [1,10,256]"| WDeno
        Style -->|"I: possible class_labels_1 source"| WDeno
        WDeno -->|"I: possible z_1 source"| WDec
        WristHist -->|"O: history_embed_1 slot"| WDec
        WDec -->|"O: [1,8,225]"| WristOut["225-D anonymous output × 8 slots"]
    end

    subgraph CrossBody ["Cross-body conditioning"]
        BDeno -->|"I: body_motion_latent_1 [1,256]"| FDeno
        BDeno -->|"I: body_motion_latent_1 [1,256]"| WDeno
    end

    subgraph Output ["Final composition (U)"]
        FaceOut -->|"U: retarget/blend"| Rig["Unity rig<br/>(U: bone mapping)"]
        BodyOut -->|"U: retarget/blend"| Rig
        WristOut -->|"U: retarget/blend"| Rig
    end
```

---

## 2. Possible caller-managed recurrence

This is a hypothesis diagram, not an observed call graph. Individual signatures are **Observed**; every handoff and feedback edge below is **Inferred**, while values, timing, initialization, and rollover are **Unknown**.

```mermaid
flowchart LR
    subgraph CallN ["Hypothetical call N"]
        EmbN["Embedding model<br/>explicit input → embedding-shaped output<br/>(O: signature)"]
        DenoN["Denoiser model<br/>history_features_1 + other slots<br/>(O: signature)"]
        DecN["Decoder model<br/>z_1 + history_embed_1<br/>→ 8 output slots<br/>(O: signature)"]
        EmbN -->|"I: possible history source"| DenoN
        DenoN -->|"I: possible z_1 source"| DecN
    end

    subgraph Buffer ["Possible caller-held values (U)"]
        Ring["Fixed-slot values<br/>(U: content, timing, rollover)"]
    end

    subgraph CallN1 ["Hypothetical later call"]
        DenoN1["Denoiser history_features_1<br/>(O: input slot)"]
        DecN1["Decoder history_embed_1<br/>(O: input slot)"]
    end

    EmbN -->|"I: possible retained value"| Ring
    DecN -->|"I: possible feedback source"| Ring
    Ring -->|"I: possible later input"| DenoN1
    Ring -->|"I: possible later input"| DecN1

    style Buffer fill:#fff3cd,stroke:#856404
```

**Evidence boundary:** Empty `stateSchema` proves no hidden Core ML-managed state. Matching history-named slots plus measured sensitivity make caller-managed temporal feedback plausible (**Inferred**), not established. Rollover implementation, initialization, content, timing, and recovery behavior are **Unknown**:
- Initial values supplied to history-named inputs: **Unknown**
- Behavior after interruption or discontinuity: **Unknown**
- Values supplied during character/style changes: **Unknown**

---

## 3. Hypothesized within-call solver vs possible between-call rollover

These are two distinct unknown orchestration concerns. Older configuration declares five face/body inference steps, but neither process below was observed as a runtime loop.

```mermaid
flowchart TD
    subgraph WithinCall ["Possible solver loop (I/U; five steps declared in config)"]
        direction LR
        Init["Initial latent<br/>(U: distribution/source)"]
        Step1["Possible denoiser call<br/>times_1 value U"]
        StepDots["..."]
        Step5["Possible fifth call<br/>(U: actual execution)"]
        Result["Candidate latent<br/>(I: possible decoder input)"]

        Init -->|"U: solver math"| Step1
        Step1 -->|"U: timestep sequence"| StepDots
        StepDots -->|"U: repeated calls"| Step5
        Step5 -->|"I: possible result"| Result
    end

    subgraph BetweenCalls ["Possible history rollover (I/U)"]
        direction LR
        ChunkA["Call t<br/>8 output slots<br/>(O: decoder shape)"]
        HistUpdate["Caller updates history-named inputs<br/>(U: values/rule)"]
        ChunkB["Call t+1<br/>8 output slots<br/>(O: decoder shape)"]

        ChunkA -->|"U: feedback"| HistUpdate
        HistUpdate -->|"U: later explicit inputs"| ChunkB
    end

    subgraph Conditioning ["Observed input slots; per-step behavior Unknown"]
        Audio["audio_1 [1,10,256]<br/>(O: slot shape)"]
        History["history_features_1<br/>(O: slot shape)"]
        Class["class_labels_1<br/>(O: slot type/shape)"]
    end

    Conditioning -->|"U: held constant or recomputed"| WithinCall

    style WithinCall fill:#e8f4e8,stroke:#2d6a2d
    style BetweenCalls fill:#fff3cd,stroke:#856404
```

**Important distinction:** timestep sensitivity and history-input sensitivity are measured, but they do not recover a solver or rollover loop. Initialization, step sequence, repeated-call count, conditioning reuse, feedback, slot timing, and continuity behavior remain **Unknown**.

---

## 4. Temporal alignment: 2 / 10 / 8 — what we know and don't know

```mermaid
flowchart LR
    subgraph Timeline ["Temporal dimensions (U: frame rate, wall-clock mapping)"]
        Audio10["Audio: 10 frames<br/>audio_1 [1,10,256]<br/>(O: denoiser input)"]
        Output8["Output: 8 frames<br/>decoder output [1,8,D]<br/>(O: decoder output)"]
        History2["History: 2 frames<br/>embedding input [1,2,D]<br/>(O: embedding input)"]
    end

    subgraph Hypothesis ["Plausible temporal alignment (I)"]
        direction TB
        H1["Audio window may span<br/>wider than output window<br/>for lookahead context (I)"]
        H2["2-frame history overlaps<br/>with end of previous chunk<br/>for continuity (I)"]
        H3["8-frame output at unknown FPS<br/>= unknown wall-clock duration (U)"]
    end

    Audio10 ---|"I: 10 slots > 8 slots suggests<br/>different context/output extents"| Output8
    Output8 ---|"I: 2 history slots might<br/>relate adjacent calls"| History2
    Audio10 ---|"U: 10 audio slots =<br/>? ms of real audio"| H1
    Output8 ---|"U: 8 output slots =<br/>? ms at ? fps"| H3
    History2 ---|"I: possible continuity role"| H2

    style Hypothesis fill:#f0f0f0,stroke:#999
```

---

## 5. AniChat vs π₀ — structural comparison

Where the architectures align and where they diverge.

```mermaid
flowchart TD
    subgraph Pi0 ["π₀ (Black et al., 2024)"]
        VLM["PaliGemma VLM backbone<br/>3B params<br/>(O: paper §IV)"]
        ActionExpert["Action expert<br/>300M params, separate weights<br/>(O: paper §IV)"]
        FlowMatch["Flow matching<br/>10 Euler steps, τ ∈ [0,1]<br/>(O: paper §IV)"]
        ActionChunk["Action chunk output<br/>H=50 actions (1 sec @ 50Hz)<br/>(O: paper §IV)"]

        VLM -->|"O: image+language tokens"| ActionExpert
        ActionExpert -->|"O: flow matching loss"| FlowMatch
        FlowMatch -->|"O: continuous actions"| ActionChunk
    end

    subgraph AniChat ["Older AniChat model family"]
        AudioEnc2["Audio encoder<br/>~3.5 MB<br/>(O: package metadata)"]
        Denoiser2["Region-sized denoisers<br/>~55 MB total, 3 models<br/>(O: package metadata)"]
        Decoder2["Region-sized decoders<br/>~28 MB total, 3 models<br/>(O: package metadata)"]
        PoseChunk["Anonymous regional outputs<br/>8 slots × 52/211/225 dims<br/>(O: decoder shapes; U: rig mapping)"]

        AudioEnc2 -->|"I: shape-compatible audio input"| Denoiser2
        Denoiser2 -->|"I: possible latent handoff"| Decoder2
        Decoder2 -->|"O: anonymous tensors"| PoseChunk
    end

    subgraph Shared ["Bounded structural similarities"]
        S1["Timestep-conditioned<br/>denoiser-like computation<br/>(O: slot + probe effect)"]
        S2["Fixed-size multi-slot output<br/>(O: shapes; U: temporal purpose)"]
        S3["Explicit conditioning slots<br/>(O: signatures; U: runtime sources)"]
    end

    subgraph Different ["Established or bounded differences"]
        D1["π₀: VLM backbone<br/>Older AniChat signatures: no vision/language input<br/>(O)"]
        D2["π₀: cross-embodiment<br/>Older AniChat embodiment/rig mapping Unknown"]
        D3["π₀: 3.3B params<br/>Older AniChat: ~90 MB package size (O)<br/>parameter count Unknown"]
        D4["π₀: task-space actions<br/>Older AniChat output semantics Unknown"]
    end

    Pi0 ---|"I: bounded structural comparison"| Shared
    AniChat ---|"I: bounded structural comparison"| Shared
    Pi0 ---|"O/U: documented vs unknown differences"| Different
    AniChat ---|"O/U: documented vs unknown differences"| Different

    style Shared fill:#e8f4e8,stroke:#2d6a2d
    style Different fill:#fde8e8,stroke:#8b2d2d
```

---

## 6. RTC overlap-inpainting — concept and AniChat parallel

```mermaid
flowchart TD
    subgraph RTC ["RTC: Real-Time Chunking (Black et al., 2025)"]
        PrevChunk["Previous chunk<br/>actions a₁..a₅₀<br/>executing in real time"]
        InferDelay["Inference delay<br/>~100-300ms<br/>(O: RTC paper)"]
        NewChunkRaw["New chunk (raw)<br/>a'₁..a'₅₀<br/>may disagree with prev"]

        PrevChunk -->|"O: robot moves during inference"| InferDelay
        InferDelay -->|"O: new observation"| NewChunkRaw

        subgraph Inpaint ["Inpainting solution"]
            Frozen["Frozen prefix<br/>a'₁..a'ₖ = prev a<br/>already executed"]
            Partial["Partial attention<br/>a'ₖ₊₁..a'ₘ<br/>blend old + new"]
            Fresh["Fresh suffix<br/>a'ₘ₊₁..a'₅₀<br/>fully from new model call"]

            Frozen -->|"O: exact match"| Partial
            Partial -->|"O: smooth blend"| Fresh
        end

        NewChunkRaw -->|"O: constrained via inpainting"| Inpaint
    end

    subgraph AniChatOverlap ["AniChat: possible overlap (I)"]
        Prev8["Previous call: 8 output slots<br/>(O: decoder shape)"]
        Hist2["2 history-named slots<br/>(O: input shape; U: content)"]
        Next8["Later call: 8 output slots<br/>(O: decoder shape)"]

        Prev8 -->|"I: output-derived history?"| Hist2
        Hist2 -->|"I: possible later explicit input"| Next8
    end

    subgraph Comparison ["Comparison"]
        C1["RTC: overlap solved by<br/>flow-matching inpainting<br/>at inference time (O)"]
        C2["AniChat: overlap mechanism<br/>entirely Unknown —<br/>could be hard cut, blend,<br/>or overlap-add (U)"]
    end

    RTC ---|"I: conceptual comparison only"| AniChatOverlap

    style Inpaint fill:#e8f4e8,stroke:#2d6a2d
    style AniChatOverlap fill:#fff3cd,stroke:#856404
```

---

## 7. Companion semantic authority + bounded residual

How AniChat-like audio-conditioned motion fits into Companion's existing architecture.

```mermaid
flowchart TD
    subgraph SemanticLayer ["Companion semantic authority (O: HANDOFF-BEHAVIOR.md)"]
        Intent["Semantic intent<br/>MotionPrimitive / AffectEvent<br/>(O: server-protocol.ts)"]
        SyncLane["Sync lane<br/>audio-anchored playback<br/>(O: highest priority)"]
        ReactLane["React lane<br/>user-triggered reflexes<br/>(O: ≤0.6, ≤2s)"]
        AsyncLane["Async lane<br/>ambient / idle behavior<br/>(O: lowest priority)"]

        Intent -->|"O: priority ordering"| SyncLane
        Intent -->|"O: priority ordering"| ReactLane
        Intent -->|"O: priority ordering"| AsyncLane
    end

    subgraph ResidualWorker ["Bounded audio-reactive residual (I: future adoption)"]
        AudioInput["Audio features<br/>candidate [1,10,256] shape<br/>(O: older shape match; U: future source)"]
        MotionGen["Audio-conditioned denoiser<br/>(I: AniChat-like or retrained)"]
        DeltaPose["Delta motion output<br/>(I: additive residual,<br/>not full pose replacement)"]

        AudioInput -->|"I: conditioning"| MotionGen
        MotionGen -->|"I: bounded output"| DeltaPose
    end

    subgraph L0 ["L0 renderer — sole writer (O)"]
        Blend["Blend: semantic + residual<br/>(I: semantic has authority)"]
        Rig["Rig projection<br/>bones, expressions, shaders<br/>(O: rig-profiles.ts)"]

        Blend -->|"O: single writer"| Rig
    end

    SyncLane -->|"O: highest authority"| Blend
    ReactLane -->|"O: overrides residual"| Blend
    DeltaPose -->|"I: lowest authority<br/>deadline miss = drop"| Blend

    subgraph Constraints ["Adoption constraints (O: static-findings.md §7)"]
        C1["Source identity preserved<br/>source: self|user|world (O)"]
        C2["Cancellation clears targeted acts<br/>by utterance/epoch (O)"]
        C3["L1 drops rather than queues<br/>when overloaded (O)"]
    end

    style ResidualWorker fill:#fff3cd,stroke:#856404
    style SemanticLayer fill:#e8f4e8,stroke:#2d6a2d
```

---

## 8. Multi-scale memory comparison: MEM vs AniChat history

```mermaid
flowchart TD
    subgraph MEM ["MEM: Multi-Scale Embodied Memory (Torne et al., 2026)"]
        ShortMEM["Short-term memory<br/>Video encoder over recent frames<br/>raw visual observations<br/>(O: MEM paper)"]
        LongMEM["Long-term memory<br/>Language summaries<br/>actively curated by model<br/>(O: MEM paper)"]
        Reasoning["Reasoning mechanism<br/>decides what to remember<br/>and what subtask to do next<br/>(O: MEM paper)"]
        VLA_MEM["VLA backbone<br/>all memory streams +<br/>current observation + task<br/>(O: MEM paper)"]

        ShortMEM -->|"O: visual context"| VLA_MEM
        LongMEM -->|"O: narrative context"| VLA_MEM
        Reasoning -->|"O: memory management"| LongMEM
        VLA_MEM -->|"O: subtask selection"| Reasoning
    end

    subgraph AniChatMem ["Older AniChat: Fixed-slot history-named tensors"]
        ShortAni["2-4 explicit latent slots<br/>history_features_1, history_embed_1<br/>(O: names/shapes; U: content)"]
        LongAni["Long-term: none observed<br/>class_labels may select<br/>persistent style (I)"]
        OrchestratorAni["Possible caller management<br/>rollover logic Unknown<br/>(I/U)"]

        ShortAni -->|"I: possible caller-supplied values"| OrchestratorAni
        LongAni -.->|"I: style only"| OrchestratorAni
    end

    subgraph Scale ["Timescale comparison"]
        MEMScale["MEM: up to 15 minutes<br/>in-context adaptation<br/>mistake correction<br/>(O: MEM paper)"]
        AniScale["Older AniChat: 2-4 latent slots<br/>wall-clock span and semantics Unknown<br/>(O: shape; U: timing/content)"]
    end

    MEM ---|"I: context-mechanism comparison;<br/>older AniChat semantics Unknown"| AniChatMem
    MEMScale ---|"O/U: fixed slots vs documented minutes;<br/>AniChat wall-clock span Unknown"| AniScale

    style MEM fill:#e8f4e8,stroke:#2d6a2d
    style AniChatMem fill:#fff3cd,stroke:#856404
    style Scale fill:#f0f0f0,stroke:#999
```

---

**Probe scope:** The diagrams cite only two synthetic runtime effects: the T=10 audio-encoder shape receipt and measured sensitivity of history/timestep inputs. They do not infer output semantics, caller wiring, solver math, or rollover from those probes. See `probe-findings.md`; other runtime evidence remains in `runtime-findings.md`.
