# Jimeng Request Plan Compare QA - 2026-06-11

## Claim

`jimeng-browser-proxy request-plan-compare` can verify simple dry-run request plans against passive frontend network captures without opening a browser, reading credentials, mutating account state, or spending generation quota.

Covered request families:

- `/mweb/v1/dreamina_subject/generate_voice`
- `/mweb/v1/voice/submit_task`
- `/mweb/v1/voice/query_task`
- `/mweb/v1/voice/update`
- `/mweb/v1/voice/delete`

## Proof Commands

```bash
bun test packages/jimeng-client/test/request-plan-compare.test.ts
bun run --cwd packages/jimeng-client test
bun run --cwd packages/jimeng-client typecheck
bun packages/jimeng-client/src/browser-proxy-cli.ts subject-generate-voice --imageUri tos-cn-i-private-avatar-asset/avatar-smoke.png --dryRun --outDir data/jimeng-lab/cli-request-plan-compare-smoke
bun packages/jimeng-client/src/browser-proxy-cli.ts request-plan-compare --plan data/jimeng-lab/cli-request-plan-compare-smoke/raw/subject-generate-voice-20260611101932-8kktax-dry-run-plan.json --rawNetwork data/jimeng-lab/cli-request-plan-compare-smoke/raw/raw-network.jsonl --outDir data/jimeng-lab/cli-request-plan-compare-smoke
bun packages/jimeng-client/src/browser-proxy-cli.ts triage-coverage --decisions keep --outDir data/jimeng-lab/triage-coverage-current
```

## Results

- Focused tests: 4 passed, 0 failed.
- Full Jimeng client tests: 243 passed, 0 failed.
- Typecheck: passed.
- CLI smoke: `request-plan-compare saved endpoint=/mweb/v1/dreamina_subject/generate_voice match=true candidates=1`.
- Triage coverage refresh: 9 keep families, 62 unique endpoints, 0 missing registry rows.

## Artifacts

- Dry-run plan: `data/jimeng-lab/cli-request-plan-compare-smoke/raw/subject-generate-voice-20260611101932-8kktax-dry-run-plan.json`
- Synthetic passive raw-network fixture: `data/jimeng-lab/cli-request-plan-compare-smoke/raw/raw-network.jsonl`
- Compare raw result: `data/jimeng-lab/cli-request-plan-compare-smoke/raw/request-plan-compare-20260611102040.json`
- Compare normalized summary: `data/jimeng-lab/cli-request-plan-compare-smoke/normalized/request-plan-compare-20260611102040-summary.json`
- Coverage summary: `data/jimeng-lab/triage-coverage-current/normalized/triage-coverage-20260611102055-summary.md`

## Caveats

- No live provider generation or account mutation was run.
- The smoke raw-network fixture is synthetic but uses the same passive CDP JSONL contract emitted by `jimeng-network-recorder`.
- Real UI parity still requires a future background capture of the subject voice or voice clone flow; this command is the offline gate for that capture.
