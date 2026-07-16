# Runtime findings — AniChat / Grok pose investigation

> **Scope:** Stages 3–5. Runtime execution, benchmarks, deterministic matching, cancellation, IL2CPP v31 parsing. All runs against older AniChat predecessor `jit_*.mlmodelc` packages loaded in-place (no weights copied). No model chaining; no semantic or behavioral claim.
> **Evidence labels:** **Observed** = measured/logged by harness receipt; **Inferred** = implied but unproven; **Unknown** = not recoverable.
> **Sources:** `packages/anichat-motion-lab/data/runs/*.json` receipts; `packages/anichat-motion-lab/data/ledger.sqlite` runs/benchmarks tables.

---

## 1. Seed-17 shape smokes (ten models, cold start)

All ten `jit_*.mlmodelc` packages loaded and ran a single-sample prediction (`warmup=0, samples=1, seed=17, computeUnits=all`) on macOS 26.5.1, arm64 (Apple M4 Max). Every run completed without error. Latencies below are cold-start (first-ever load); they include Core ML compilation and are **not** representative of warm steady-state.

| Model | Latency (ms) | Memory (MB) | Output summary | Receipt |
|---|---|---|---|---|
| `audio_enc` | 6.588 | 0.9 | `linear_0: Float32 [1,1,256] min=-0.716 max=0.730 mean=-0.000` | `4ce55f68...json` |
| `face_embedding` | 27.917 | 4.2 | `linear_0: Float32 [1,2,128] min=-0.186 max=0.224 mean=-0.003` | `b29397c4...json` |
| `face_denoiser` | 3665.708 | 1483.2 | `var_647: [1,128] mean=0.176; var_648: [1,128] mean=0.193` | `9dfac4ab...json` |
| `face_dec` | 1725.877 | 781.2 | `linear_27: Float32 [1,8,52] min=-0.341 max=0.275 mean=-0.015` | `d321fd9e...json` |
| `body_embedding` | 5.005 | 3.0 | `linear_0: Float32 [1,2,256] min=-0.562 max=0.539 mean=0.003` | `2c746969...json` |
| `body_denoiser` | 719.006 | 367.8 | `var_1189: [1,256] mean=0.017; var_1190: [1,256] mean=0.093` | `fcf622ac...json` |
| `body_dec` | 906.167 | 453.0 | `linear_55: Float32 [1,8,211] min=-1.750 max=3.336 mean=0.044` | `ef3e6103...json` |
| `wrist_embedding` | 4.300 | 2.9 | `linear_0: Float32 [1,2,256] min=-0.653 max=0.610 mean=-0.003` | `1fab3d88...json` |
| `wrist_denoiser` | 926.186 | 413.2 | `var_1206: [1,2,256] mean=-0.070; var_1207: [1,2,256] mean=-0.081` | `e49258b9...json` |
| `wrist_dec` | 86.307 | 20.8 | `linear_55: Float32 [1,8,225] min=-1.481 max=2.685 mean=-0.011` | `6b2ae5d8...json` |

**Cold/warm caveat:** seed-17 runs used `warmup=0`. The multi-second latencies for denoisers and decoders are dominated by first-load Core ML model compilation. Warm latencies (seed-23 benchmarks below) are 100-1000x faster. **No run provides ANE vs CPU vs GPU utilization evidence** — `computeUnits=all` lets Core ML choose, and the harness records wall-clock time only (**Unknown**: which compute unit was selected).

All receipts at `packages/anichat-motion-lab/data/runs/`.

---

## 2. Seed-23 benchmarks (ten models, warm, 5 samples each)

Settings: `seed=23, warmup=1, samples=5, computeUnits=all, appGeneration=older_anichat`. Hardware: macOS 26.5.1 arm64.

| Model | min (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | max (ms) | mean (ms) | Memory | Package hash | Receipt |
|---|---|---|---|---|---|---|---|---|---|---|
| `face_embedding` | 0.0650 | 0.0720 | 0.1430 | 0.1599 | 0.1735 | 0.1769 | 0.0948 | 3.9 MB | `c21e8f2cccee3f6c...` | `data/runs/32374c27...json` |
| `body_embedding` | 0.0789 | 0.1260 | 0.2046 | 0.2238 | 0.2391 | 0.2429 | 0.1348 | 3.6 MB | `cd8d69fc3827c8b8...` | `data/runs/27edd060...json` |
| `wrist_embedding` | 0.0651 | 0.0750 | 0.1356 | 0.1518 | 0.1647 | 0.1680 | 0.0922 | 3.7 MB | `1e5abe80e20a01ad...` | `data/runs/2b0b3ddb...json` |
| `audio_enc` | 0.4151 | 0.4660 | 0.6876 | 0.7598 | 0.8175 | 0.8320 | 0.5270 | 5.9 MB | `d1acad47840431e0...` | `data/runs/b62b5301...json` |
| `face_dec` | 2.2141 | 2.5690 | 2.8677 | 2.9258 | 2.9724 | 2.9840 | 2.5842 | 42.2 MB | `e4c07d100dd34e48...` | `data/runs/1eb746a1...json` |
| `face_denoiser` | 2.8659 | 2.9970 | 3.2156 | 3.2468 | 3.2718 | 3.2780 | 3.0286 | 46.6 MB | `ecc507eb8770b7c6...` | `data/runs/21c031ae...json` |
| `body_dec` | 3.4480 | 3.8761 | 4.1564 | 4.2142 | 4.2604 | 4.2720 | 3.8296 | 31.4 MB | `0ad9a135eea6bc51...` | `data/runs/5634a36a...json` |
| `wrist_dec` | 3.5770 | 3.6800 | 4.0024 | 4.0432 | 4.0758 | 4.0840 | 3.7672 | 30.7 MB | `84eddab4ba36b969...` | `data/runs/e96c8c88...json` |
| `wrist_denoiser` | 4.4820 | 4.5290 | 4.7180 | 4.7350 | 4.7486 | 4.7520 | 4.5874 | 34.9 MB | `1b7d943c9b6cb530...` | `data/runs/4a544842...json` |
| `body_denoiser` | 4.5100 | 4.8261 | 5.9858 | 6.3084 | 6.5665 | 6.6310 | 5.1336 | 37.9 MB | `b284dc31d0402e68...` | `data/runs/0e3d5e62...json` |

Computed from raw `latenciesMs` arrays (5 samples each). Benchmark rows also stored in `ledger.sqlite` `benchmarks` table, keyed by `run_id`.

---

## 3. Deterministic face_embedding seed-101 matching

Two back-to-back runs of `face_embedding` with `seed=101, warmup=0, samples=1` produced identical output summaries (**Observed**):

- Run `b937eeca`: `linear_0: Float32 [1,2,128] min=-0.265957 max=0.189628 mean=-0.002654` — latency 3.551 ms, memory 3.2 MB
- Run `29531f08`: `linear_0: Float32 [1,2,128] min=-0.265957 max=0.189628 mean=-0.002654` — latency 3.541 ms, memory 3.2 MB

Both share package hash `c21e8f2cccee3f6c8f316383ec5b3d47bf9ab97b23fead8c5faa975e40bfc851`. The min/max/mean triplet is bit-identical across runs, confirming the harness produces deterministic synthetic inputs for a given seed and the model yields reproducible output (**Observed**).

Receipts: `data/runs/b937eeca-1e72-4b83-9675-2871cc95670b.json`, `data/runs/29531f08-3e14-494e-97ad-365f6e851b9d.json`.

---

## 4. Timed process cancellation

Two cancellation events recorded:

| Run ID | Model | Seed | Cancellation | Outcome | Receipt |
|---|---|---|---|---|---|
| `7b39a71e` | `body_denoiser` | 29 | `process-terminated` (no duration) | cancelled | `data/runs/7b39a71e...json` |
| `ba6f584f` | `body_denoiser` | 31 | `process-terminated:506.722ms` | cancelled | `data/runs/ba6f584f...json` |

The `ba6f584f` receipt records the harness process being killed after 506.722 ms, before the native harness returned valid JSON. Error: `"Native harness exited without valid JSON"`. Both runs had `samples=100, warmup=1` settings that would not have completed within the cancellation window.

**Cancellation semantics:** The TypeScript layer sends `{"command":"cancel"}` on stdin. If the native process does not acknowledge before the timeout, it is killed and the receipt records `process-terminated[:elapsed]` (**Observed**). No latency or memory data is captured for cancelled runs.

---

## 5. Cold/warm caveat

- **Cold (seed-17, warmup=0):** First-load latencies range from 4.3 ms (wrist_embedding) to 3,665 ms (face_denoiser). The source of this overhead is **Unknown**; Core ML loading/compilation and memory mapping are plausible contributors (**Inferred**). These are not warm-state numbers.
- **Warm (seed-23, warmup=1):** After one warmup sample, measured samples were sub-millisecond for embeddings and 2–7 ms for decoders/denoisers (**Observed**).
- **Comparison:** face_denoiser cold=3665 ms vs warm mean=3.03 ms, about 1200×. This report does not attribute that ratio to a particular Core ML subsystem or compute unit.

---

## 6. No ANE/CPU utilization evidence

All runs used `computeUnits=all`, which lets Core ML decide the compute unit at runtime. The harness records **wall-clock latency only**. No ANE, GPU, or CPU utilization metrics were captured. No `IOSurface`, `powermetrics`, `Instruments`, or `os_signpost` data was collected. Therefore:

- Which compute unit was selected: **Unknown**
- Whether ANE was used: **Unknown**
- CPU vs GPU vs ANE split: **Unknown**

---

## 7. No chain or semantic claim

- Every receipt is a **single-model, single-prediction** run. No model was chained to another. No embedding output was fed to a denoiser. No denoiser output was fed to a decoder.
- The 52-D, 211-D, and 225-D output vectors remain anonymous indexed values. No semantic channel labeling (ARKit, bone names, blendshape names) is asserted.
- No audio preprocessing was applied. The `audio_enc` input was synthetic seeded random data, not mel spectrograms or real audio features.
- The `class_labels` Int32 input was set to a seeded random integer, not a meaningful style/character class.
- Therefore **no behavioral, semantic, or quality claim** is made about these outputs. They demonstrate only that: (a) the model loads, (b) it produces shaped output, (c) latency is measurable.

---

## 8. Correction: body_denoiser does NOT have body_motion_latent

The `jit_body_denoiser.mlmodelc` has 6 inputs (**Observed** from benchmark receipt `0e3d5e62` and predict receipt `fcf622ac`):

1. `noised_latent_1` F32 `[1, 256]`
2. `history_features_1` F32 `[1, 2, 256]`
3. `times_1` F32 `[1]`
4. `class_labels_1` Int32 `[1]`
5. `audio_1` F32 `[1, 10, 256]`
6. `gaze_dir_1` F32 `[1, 3]`

It does **not** have a `body_motion_latent_1` input. The face_denoiser and wrist_denoiser **do** have `body_motion_latent_1 F32 [1, 256]` as a conditioning input (cross-body latent). The body_denoiser takes `gaze_dir_1` instead — it conditions on gaze direction but not on its own body motion latent (that would be circular). This corrects the prior static-findings table entry for `jit_body_denoiser`.

---

## 9. IL2CPP v31 metadata parsing

The parser (`src/il2cpp.ts`) reads both `global-metadata.dat` files in-place. Both are IL2CPP version 31 with magic `0xFAB11BAF` (**Observed**).

| Generation | Types | Fields | Methods | Metadata size |
|---|---|---|---|---|
| Current Grok (`ai.x.GrokApp`) | 11,455 | 50,574 | 75,567 | 9,552,884 bytes |
| Older AniChat (`inc.animation.ios`) | 11,354 | 50,178 | 74,692 | 9,455,020 bytes |

Counts are per single parse run. The append-only ledger can contain repeated observation snapshots; filter by the latest `observed_at` for one-snapshot counts. The parser extracts sanitized type names, method names, field names, namespaces, and stable indices. Sensitive strings matching configured patterns are redacted to `[REDACTED]`.

**Name observation vs behavior:** Type and method names are **Observed** in the string table. Their runtime behavior, call graph, and state machine transitions are **Unknown**. No decompilation, disassembly, or runtime tracing was performed. Names alone do not prove a call graph or state machine.

Metadata artifacts in ledger:
- Current Grok: `sha256=54d00dc56d790ea8...`, 9,552,884 bytes
- Older AniChat: `sha256=4a396d1ce9c810b7...`, 9,455,020 bytes

---

## 10. Older AniChat catalog hash

The older AniChat Addressables catalog artifact is `sha256=ded07958fc90...`, 59,549 bytes (**Observed** from `artifacts`). One catalog decode produced 207 entries, 369 keys, and 179 internal IDs. Its `m_BuildResultHash` is `265680c2b2d53a2c5e13dd0a821bbabb`.

The current Grok catalog is `sha256=ae59e3a226b0...`, 18,751 bytes. One decode produced 47 entries, 83 keys, and 41 internal IDs.

---

## Source index

All receipt paths are relative to `packages/anichat-motion-lab/`.

- Ledger: `data/ledger.sqlite`; query current counts because metadata observations are append-only.
- Receipts: `data/runs/*.json`; schema `RunReceiptV1Schema` in `src/schema.ts`.
- Native harness source/build target: `native/CoreMLHarness.swift` / `native/CoreMLHarness`.
- Error log: `data/errors.log`; early ingest failures are historical and resolved by later successful ingestion.
