# Worker D: Lip-Sync Contract Promotion

Use this worker only after the parent has run the approved `lip-sync-human` browser-backed proof and saved a proof bundle under:

```txt
data/jimeng-lab/packet-lip-sync-human-20260630/packet-artifacts/image-lipsync/
```

Do not launch this worker while the packet is still blocked on upload/submit approval.

## Assignment

Promote the observed lip-sync/digital-human proof into a typed, replay-tested contract slice. Keep the patch narrow and evidence-driven: implement only the request/response paths proven by the saved proof bundle and existing pre-process/replay fixtures.

## Read First

- `docs/plans/jimeng-dreamina-cli-goal.md`
- `docs/plans/jimeng-fast-contract-extraction.md`
- `docs/provider/jimeng-api-triage.md`
- `docs/qa/jimeng-lip-sync-digitalhuman-passive-capture-20260630.md`
- `docs/plans/jimeng-workers/README.md`
- `packages/jimeng-client/src/lip-sync.ts`
- `packages/jimeng-client/src/video-preprocess.ts`
- `packages/jimeng-client/src/browser-session.ts`
- `packages/jimeng-client/test/lip-sync.test.ts`
- `packages/jimeng-client/test/lip-sync-compare.test.ts`
- `packages/jimeng-client/test/video-preprocess.test.ts`

## Owned Files

Edit only these files unless the parent explicitly expands scope:

- `packages/jimeng-client/src/lip-sync.ts`
- `packages/jimeng-client/src/video-preprocess.ts`
- `packages/jimeng-client/test/lip-sync.test.ts`
- `packages/jimeng-client/test/lip-sync-compare.test.ts`
- `packages/jimeng-client/test/video-preprocess.test.ts`

Only edit `packages/jimeng-client/src/browser-session.ts` if the saved proof shows a small, necessary browser-submit parsing fix. If that happens, call it out clearly in the final handoff.

## Do Not Edit

- `packages/jimeng-client/src/endpoint-registry.ts`
- `packages/jimeng-client/src/browser-proxy-cli.ts`
- `packages/jimeng-client/test-vitest/**`
- `docs/**`
- `TASKS.md`
- `package.json` or lockfiles
- raw/ignored `data/**` proof files

## Requirements

- Infer the relied-on request/response paths from the approved proof output and existing replay fixtures.
- Add or tighten Effect Schema boundaries for only the paths the client relies on.
- Keep schemas permissive for additive provider fields.
- Redact signed URLs, provider media URLs, cookies, credentials, upload tokens, request ids, timestamps, and raw provider response bodies from any committed fixture or summary.
- If the proof produces a stable `/mweb/v1/aigc_draft/generate` lip-sync request, add a small replay/compare fixture or focused test that proves the typed contract can recognize it.
- If the proof produces pre-process task ids, add or update focused tests for `submitJimengVideoPreprocess` / `fetchJimengVideoPreprocessResults` only around the observed shape.
- Do not add live provider calls to tests.
- Do not implement async daemon/job scheduling.
- Do not broaden generation/persona/template code.

## Commands

Do not run tests, typecheck, lint, formatters, git commands, provider CLIs, browser automation, or shell probes. Parent owns validation.

If you need a generated contract summary and it does not already exist in the proof bundle, ask the parent to run:

```bash
cd /Users/arthur/agents
bun packages/jimeng-client/src/browser-proxy-cli.ts contract-infer \
  --input data/jimeng-lab/packet-lip-sync-human-20260630/packet-artifacts/image-lipsync \
  --endpoint /mweb/v1/aigc_draft/generate \
  --outDir data/jimeng-lab/packet-lip-sync-human-20260630/contract-infer
```

## Parent Validation

After integrating the patch, the parent should run:

```bash
cd /Users/arthur/agents/packages/jimeng-client
mise exec -- bun test ./test/lip-sync.test.ts ./test/lip-sync-compare.test.ts ./test/video-preprocess.test.ts
mise exec -- bun run typecheck
mise exec -- bun run test:vitest
cd /Users/arthur/agents
git diff --check
```

If the patch touches broader contracts, parent may run the full Jimeng suite:

```bash
cd /Users/arthur/agents/packages/jimeng-client
mise exec -- bun test ./test
```

## Final Handoff

Return:

- files changed;
- commands run: `none`;
- observed proof paths used;
- request/response paths promoted;
- remaining parent-owned registry/docs/snapshot updates;
- parent validation commands;
- any exact blocker that prevented promotion.
