# AniChat / Grok pose investigation

> **This file is a pointer.** The full investigation is in the subdirectory.

## Documents

| Document | Path |
|---|---|
| **Reproduction index** | [`anichat-grok-pose-investigation/reproduction-index.md`](anichat-grok-pose-investigation/reproduction-index.md) |
| Static findings (stages 1–2) | [`anichat-grok-pose-investigation/static-findings.md`](anichat-grok-pose-investigation/static-findings.md) |
| Runtime findings (stages 3–5) | [`anichat-grok-pose-investigation/runtime-findings.md`](anichat-grok-pose-investigation/runtime-findings.md) |
| Diagrams | [`anichat-grok-pose-investigation/diagrams.md`](anichat-grok-pose-investigation/diagrams.md) |

## Quick reproduction

```bash
cd packages/anichat-motion-lab
bun run harness:build
bun run ingest
bun run harness:predict --model-key face_embedding --generation older_anichat --seed 17
bun run harness:benchmark --model-key face_embedding --generation older_anichat --seed 23 --warmup 1 --samples 5
bun run dev:up
```

Receipts: `packages/anichat-motion-lab/data/runs/*.json`
Ledger: `packages/anichat-motion-lab/data/ledger.sqlite`
