# Jimeng Fast Contract Extraction

Use this loop when continuing Jimeng/Dreamina API reversal. The goal is to implement useful UGC API surface faster by using real captured/provider samples as the seed for schemas, tests, and CLI scaffolds.

## Default Loop

1. Pick the next API family by UGC workflow value: generation, persona/voice, lip-sync, reference controls, template mining, then supporting reads.
2. Run a small bounded live or passive-capture matrix for that family when approved. For generation/mutation, keep concurrency at `1`, record credit balance before/after, and stop on risk-control, auth drift, or unexpected account mutation.
3. Save the raw request/response JSON, normalized summaries, exact commands, credit/spend note, and any media artifacts under ignored `data/**`.
4. Feed the saved JSON/cassettes into a contract-inference step instead of manually writing every field by hand.
5. Generate draft Effect Schema contracts, wrapper functions, CLI flags, endpoint-registry rows, fixtures, and Vitest snapshot tests from the observed contract.
6. Hand-tighten only the relied-on paths and user-facing option semantics. Keep schemas permissive for additive provider fields.
7. Prove backend/API refactors with replayed cassettes, fixtures, typecheck, and Vitest snapshots. Prove media APIs with actual playable/listenable artifacts from the matrix.
8. Update `TASKS.md`, `docs/provider/jimeng-api-triage.md`, and the endpoint registry with implemented, blocked, skipped, or next-probe status.

## Tool To Build

Add a reusable contract-inference command before adding more one-off dry-run planners:

```bash
jimeng-browser-proxy contract-infer \
  --input data/jimeng-lab/<proof-run> \
  --endpoint /mweb/v1/aigc_draft/generate \
  --outDir data/jimeng-lab/<proof-run>/contract-infer
```

Expected outputs:

- `contract-summary.json` and `contract-summary.md`
- permissive Effect Schema draft or schema IR for the response/request paths we rely on
- normalized fixture and Vitest snapshot draft
- endpoint-registry patch draft with status, evidence, risks, and next probe
- CLI flag suggestions for independent property classes, not every cosmetic enum value

This tool should redact cookies, auth headers, signed URLs, upload credentials, request ids, timestamps, and other unstable or sensitive values before producing snapshots.

Current status: `jimeng-browser-proxy contract-infer` exists. It scans saved proof/cassette directories, groups JSON by endpoint, redacts/normalizes embedded JSON strings such as `draft_content` and `metrics_extra`, reports stable/frequent contract paths, summarizes artifacts, emits Effect Schema IR, writes registry patch drafts, and is covered by Bun tests plus Vitest snapshots.

## Budget And Safety

- When Arthur approves account spend for exploration, default to at most half of the current remaining credits unless he gives a different cap.
- Keep generation and mutation concurrency at `1`.
- Polling, downloads, local processing, passive capture, and schema inference can run in the background.
- Stop immediately on `ret=1019`, shark/risk-control failures, `429`, auth drift, unexpected paid modal, or unexpected account mutation.
- Never commit raw session bundles, cookies, signed media URLs, generated media, or raw provider credentials.

## Dry-Run Planner Role

Dry-run planners are no longer the primary implementation loop. Use them only when:

- live spend/capture is not approved or not available,
- the planner directly unblocks a high-value family,
- a compare gate is needed before a risky live submit, or
- the request builder is already understood and the planner is a cheap generated artifact.

Do not spend sessions hand-writing low-value planners while an approved bounded matrix plus contract inference would produce schemas, tests, and examples faster.

## Latest Seed Matrix

The 2026-06-12 live matrix is the current seed for this faster loop:

- manifest: `data/jimeng-lab/proof-20260612-live-generation-matrix/manifest.md`
- spent 24 credits, from 3990 to 3966
- generated 1 TTS MP3 and 4 video artifacts
- verified MP4 outputs as H.264, 704x1248, 60 fps, 3.016667 seconds

Future work should use this style of proof bundle as input to contract inference and scaffold generation.

The first scaffold run is saved locally under:

```txt
data/jimeng-lab/proof-20260612-live-generation-matrix/contract-infer/normalized/contract/
```

It was generated with:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts contract-infer \
  --input data/jimeng-lab/proof-20260612-live-generation-matrix \
  --endpoint /mweb/v1/aigc_draft/generate \
  --outDir data/jimeng-lab/proof-20260612-live-generation-matrix/contract-infer
```
