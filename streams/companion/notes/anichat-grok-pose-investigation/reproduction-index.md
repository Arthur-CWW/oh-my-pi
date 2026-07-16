# Reproduction index — AniChat / Grok pose investigation

> **Purpose:** One new investigator can reproduce all lawful work from this index. Every measured claim links to an exact receipt. No unrun result is presented as evidence.

---

## Quick start

```bash
cd packages/anichat-motion-lab

# Build the native Core ML harness
bun run harness:build

# Run the local development debugger UI
bunx portless anichat-motion-lab bun run serve

# Run ledger migrations
bun run migrate

# Ingest metadata from installed apps
bun run ingest

# Ingest completed receipts into the ledger
bun run receipt:ingest

# Query ledger
bun run query
```

---

## 1. Investigation stages and deliverables

| Stage | Deliverable | Status | Evidence |
|---|---|---|---|
| 1. Static architecture | Generation-separated artifact table, model I/O signatures, scoped absences, blockers | Complete | `static-findings.md` §1–8 |
| 2. Diagrams | Cross-gen comparison, Addressables loading, model I/O graph, state/authority, adoption boundary | Complete | `diagrams.md` §1–7 |
| 3. Seed-17 shape smokes | 10/10 models loaded and predicted (cold start) | Complete | `runtime-findings.md` §1; receipts `ef3e6103`, `e49258b9`, `1fab3d88`, `b29397c4`, `d321fd9e`, `2c746969`, `6b2ae5d8`, `4ce55f68`, `fcf622ac`, `9dfac4ab` |
| 4. Seed-23 benchmarks | 10/10 models benchmarked (warmup=1, samples=5); min/p50/p90/p95/p99/max/mean tables | Complete | `runtime-findings.md` §2; receipts `27edd060`, `b62b5301`, `32374c27`, `5634a36a`, `21c031ae`, `4a544842`, `e96c8c88`, `2b0b3ddb`, `0e3d5e62`, `1eb746a1` |
| 5. Deterministic matching | face_embedding seed-101 — two runs produce bit-identical min/max/mean | Complete | `runtime-findings.md` §3; receipts `b937eeca`, `29531f08` |
| 6. Process cancellation | body_denoiser seed-29 and seed-31 — timed kill, `process-terminated:506.722ms` | Complete | `runtime-findings.md` §4; receipts `7b39a71e`, `ba6f584f` |
| 7. IL2CPP v31 parsing | Both metadata files parsed: current 11455/50574/75567, older 11354/50178/74692 | Complete | `runtime-findings.md` §9; ledger `types_symbols` table |
| 8. Addressables decoding | Single catalog decode: current 47 entries / 83 keys / 41 internal IDs; older 207 entries / 369 keys / 179 internal IDs | Complete | `static-findings.md` §1; decoder tests |
| 9. Cold/warm caveat + no ANE evidence | Documented; no utilization data captured | Documented | `runtime-findings.md` §5–6 |
| 10. Companion adoption | Typed lanes, single L0 writer, source identity, played anchors, bounded lowest residual, deadline drop/decay, model-neutral manifests, graceful failures | Documented | `static-findings.md` §7; `diagrams.md` §7 |
| 11. Audio shape compatibility (T=10) | audio_enc with T=10 produces `[1,10,256]`, shape-compatible with denoiser `audio_1`; caller wiring/transforms Unknown | Complete | `research-report.md` §2; receipt `e37ed085` |
| 12. Research report | Architecture synthesis, state taxonomy, comparative analysis (π₀/RTC/MEM), design motivations, probe roadmap | Complete | `research-report.md` §1–10 |
| 13. Research diagrams | Explanatory Mermaid diagrams: signature DAG, possible caller recurrence, hypothesized solver/rollover, temporal alignment, bounded π₀/RTC/MEM comparisons, Companion authority | Complete | `research-diagrams.md` §1–8 |
| 14. Behavioral probes | 18-tag causal ablation suite (54 probes, 3 seeds); history/timestep/audio/body-latent/class/gaze sensitivity; history-input effect measured while caller rollover remains Inferred | Complete | `probe-findings.md` §1–6; suite `7f7a8b88-89fc-4647-a5dd-f65dac47fcb2` |

---

## 2. Ledger schema and query commands

Database: `packages/anichat-motion-lab/data/ledger.sqlite`

### Key tables

The ledger is append-only across observation times, so row counts grow after each ingestion. Query current counts rather than treating accumulated rows as unique artifacts:

```sql
SELECT 'runs' AS table_name, COUNT(*) AS rows FROM runs
UNION ALL SELECT 'benchmarks', COUNT(*) FROM benchmarks
UNION ALL SELECT 'artifacts', COUNT(*) FROM artifacts
UNION ALL SELECT 'types_symbols', COUNT(*) FROM types_symbols
UNION ALL SELECT 'addressable_entries', COUNT(*) FROM addressable_entries
UNION ALL SELECT 'models', COUNT(*) FROM models;
```

Stable identities: two `apps` rows (`current_grok`, `older_anichat`) and three applied schema migrations. For latest-snapshot metadata counts, filter by the maximum `observed_at`; do not use accumulated rows as catalog or model cardinality.

### Reproduction queries

```sql
-- All completed runs with latency
SELECT run_id, command, seed, warmup, latencies_json, memory_bytes, outcome
FROM runs WHERE outcome = 'completed' ORDER BY id;

-- Benchmark statistics for seed-23 runs
SELECT r.command, b.metric, b.value, b.unit
FROM runs r JOIN benchmarks b ON b.run_id = r.id
WHERE r.seed = 23 ORDER BY r.command, b.metric;

-- IL2CPP type counts per parse run
SELECT app_id, symbol_kind, COUNT(*) as cnt
FROM types_symbols
WHERE observed_at = (SELECT MAX(observed_at) FROM types_symbols)
GROUP BY app_id, symbol_kind ORDER BY app_id, symbol_kind;

-- Addressables entry counts per app
SELECT app_id, COUNT(*) as entries, COUNT(DISTINCT internal_id) as distinct_ids
FROM addressable_entries GROUP BY app_id;

-- Open blockers
SELECT blocker_key, summary, missing_evidence, status FROM blockers WHERE status = 'open';

-- Cancellation receipts
SELECT run_id, command, seed, cancellation, outcome FROM runs WHERE outcome = 'cancelled';

-- Model metadata hashes (deduplicated)
SELECT DISTINCT app_id, canonical_label, kind, substr(sha256,1,16) as hash_prefix, bytes
FROM artifacts WHERE kind IN ('coreml_metadata', 'il2cpp_metadata', 'catalog', 'settings')
ORDER BY app_id, kind, canonical_label;
```

---

## 3. Receipt manifest

All receipts are JSON files under `packages/anichat-motion-lab/data/runs/`.

| Receipt (run_id prefix) | Command | Model | Seed | Outcome |
|---|---|---|---|---|
| `4ce55f68` | predict | audio_enc | 17 | completed |
| `b29397c4` | predict | face_embedding | 17 | completed |
| `9dfac4ab` | predict | face_denoiser | 17 | completed |
| `d321fd9e` | predict | face_dec | 17 | completed |
| `2c746969` | predict | body_embedding | 17 | completed |
| `fcf622ac` | predict | body_denoiser | 17 | completed |
| `ef3e6103` | predict | body_dec | 17 | completed |
| `1fab3d88` | predict | wrist_embedding | 17 | completed |
| `e49258b9` | predict | wrist_denoiser | 17 | completed |
| `6b2ae5d8` | predict | wrist_dec | 17 | completed |
| `b62b5301` | benchmark | audio_enc | 23 | completed |
| `32374c27` | benchmark | face_embedding | 23 | completed |
| `21c031ae` | benchmark | face_denoiser | 23 | completed |
| `1eb746a1` | benchmark | face_dec | 23 | completed |
| `27edd060` | benchmark | body_embedding | 23 | completed |
| `0e3d5e62` | benchmark | body_denoiser | 23 | completed |
| `5634a36a` | benchmark | body_dec | 23 | completed |
| `2b0b3ddb` | benchmark | wrist_embedding | 23 | completed |
| `4a544842` | benchmark | wrist_denoiser | 23 | completed |
| `e96c8c88` | benchmark | wrist_dec | 23 | completed |
| `b937eeca` | predict | face_embedding | 101 | completed |
| `29531f08` | predict | face_embedding | 101 | completed |
| `7b39a71e` | benchmark | body_denoiser | 29 | cancelled |
| `ba6f584f` | benchmark | body_denoiser | 31 | cancelled |
| `e37ed085` | predict | audio_enc | 53 | completed |

---

## 4. Diagrams

See `diagrams.md` for:

1. Cross-generation artifact comparison (Mermaid)
2. Current Grok Addressables loading flow
3. Older AniChat Addressables and config
4. State and authority (predecessor hypotheses vs Companion observed)
5. Exact model I/O graph (all 10 models, O/I/U tagged edges)
6. Protocol, timing, and cancellation
7. Companion adoption boundary

See `research-diagrams.md` for:

1. Model-signature tensor DAG (T=10 audio shape compatibility; caller wiring Unknown)
2. Possible caller-managed recurrence
3. Hypothesized within-call solver vs possible between-call rollover
4. Temporal alignment: 2/10/8
5. AniChat vs π₀ structural comparison
6. RTC overlap-inpainting concept and AniChat parallel
7. Companion semantic authority + bounded residual
8. Multi-scale memory comparison: MEM vs AniChat history

---

## 5. Historical errors and semantic blockers

`data/errors.log` preserves early ingest failures from before the IL2CPP and binary-plist readers stabilized. Later ingestion completed with 26 observed artifacts, 0 missing artifacts, 10 models, and 0 ingestion blockers. Those historical blocker rows are marked `resolved`; they are not current failures.

The remaining open blocker is semantic: the older AniChat models load and execute, but runtime preprocessing, scheduler math, diffusion step count, CFG behavior, audio sample rate, history rollover, frame rate, output mappings, and current-Grok equivalence remain **Unknown**. See `static-findings.md` §5.

### Safety constraints

- Models load in place; no weights, bundles, or proprietary assets are copied or exported.
- Package hashes stream every regular file in each allowlisted `.mlmodelc` in place. Core ML inference necessarily reads the installed package weights.
- Receipts contain only package hashes, timings, memory, signatures, and anonymous tensor summaries—not weights or full tensors.
- No model chaining or semantic channel mapping is implemented.
- IL2CPP string indexing is bounded and redacts sensitive patterns; method behavior and call graphs remain **Unknown**.
- No FaceKit code was modified or run.

---

## 6. FaceKit

Compact sibling pointer only. A separate macOS FaceKit sidecar exists at `apps/ai-companion-rtc/scripts/apple-face-oracle-macos/FaceKitProbe.m`. It provides 51 blendshapes via UDP to the Motion Lab as provider `facekit-macos`. See `static-findings.md` §6 and `apps/ai-companion-rtc/docs/face-mirror.md`. No FaceKit code was modified in this investigation.

---

## 7. Companion adoption notes

From `static-findings.md` §7 and `diagrams.md` §7, the adoption boundary preserves:

1. **Typed lanes:** `sync > react > async` priority ordering
2. **One L0 writer:** Only the browser L0 renderer writes bones, expressions, shaders, and output gains
3. **Source identity:** `source: self | user | world`; L1 filters `self`; assistant output must never become user input
4. **Played anchors:** Sync lane anchors to actual-played audio offsets (`assistant-audio:id@ms`)
5. **Bounded lowest residual:** Any audio-conditioned residual worker must be the lowest-authority lane below semantic arbitration
6. **Deadline drop/decay:** Deadline miss = drop or decay, never queue
7. **Model-neutral manifests:** Style/class presets are parameters to existing lanes, not a parallel emotion authority
8. **Graceful failures:** Cancellation clears targeted acts by utterance/epoch; L1 drops rather than queues when overloaded

---

## 8. Debugger UI

```bash
# Start the local investigation debugger
bun run dev:up
```

The local-only UI exposes verified signatures and evidence-labeled model edges, actual single-model inspect/predict/benchmark controls, cancellation, anonymous output summaries, package hashes, latency distributions, memory, receipt browsing, a curated 54-probe suite explorer with category filtering and per-seed drilldown, and a separately labeled **Inferred scheduling preview — not AniChat runtime evidence**. It does not expose installed paths, proprietary assets, semantic channel names, or authenticated services.

Browser QA captures:

- `packages/anichat-motion-lab/data/qa/01-initial-ui.png`
- `packages/anichat-motion-lab/data/qa/03-scheduling-inferred.png`
- `packages/anichat-motion-lab/data/qa/04-cancelled-body-denoiser.png`
- `packages/anichat-motion-lab/data/qa/05-current-grok-rejected.png`
- `packages/anichat-motion-lab/data/qa/06-face-evidence.png`
- `packages/anichat-motion-lab/data/qa/research-probe-suite.png`

---

## 9. Package scripts (preserved)

```json
{
  "migrate": "bun run src/cli.ts migrate",
  "ingest": "bun run src/cli.ts ingest",
  "receipt:ingest": "bun run src/cli.ts receipt-ingest",
  "query": "bun run src/cli.ts query",
  "export": "bun run src/cli.ts export",
  "harness:build": "mkdir -p native && swiftc -O -framework CoreML -framework Foundation -framework CryptoKit -o native/CoreMLHarness native/CoreMLHarness.swift",
  "harness:inspect": "bun run src/harness.ts inspect",
  "harness:predict": "bun run src/harness.ts predict",
  "harness:benchmark": "bun run src/harness.ts benchmark",
  "serve": "bun run src/server.ts",
  "dev:up": "nohup ./scripts/dev-up.sh >/dev/null 2>&1 &",
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

---

## 10. Document index

| Document | Scope |
|---|---|
| `static-findings.md` | Stages 1–2: static architecture, model I/O, scoped absences, blockers, adoption notes |
| `diagrams.md` | Mermaid architecture diagrams (O/I/U tagged) |
| `runtime-findings.md` | Stages 3–5: benchmarks, shape smokes, deterministic matching, cancellation, IL2CPP, corrections |
| `reproduction-index.md` | This file: reproduction commands, receipt manifest, ledger queries, adoption summary |
| `research-report.md` | Architecture synthesis, T=10 audio shape compatibility, state taxonomy, bounded comparative analysis (π₀/RTC/MEM), inferred design motivations, false equivalences, completed probes and remaining roadmap, Companion improvements |
| `research-diagrams.md` | Evidence-tagged diagrams: model-signature DAG, possible caller-managed recurrence, hypothesized solver/rollover, temporal alignment, bounded AniChat/π₀/RTC/MEM comparisons, Companion authority + residual proposal |
| `probe-findings.md` | Stage 14: behavioral probe methodology, 18-row sensitivity table, per-output analysis, history-input sensitivity and recurrence boundary, recommended next experiments, selected artifact IDs |
