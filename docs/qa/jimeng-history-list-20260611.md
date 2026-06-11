# Jimeng History List QA - 2026-06-11

## Claim

`jimeng-browser-proxy history-list` provides a typed, no-spend `/mweb/v1/get_history` client/CLI surface. Empty `records_list` responses are accepted as valid provider reads, while a missing `records_list` fails as contract drift.

## Proof Commands

```bash
bun test packages/jimeng-client/test/history-list.test.ts packages/jimeng-client/test/static-inventory.test.ts packages/jimeng-client/test/discovery-worklist.test.ts packages/jimeng-client/test/endpoint-registry.test.ts
bun run --cwd packages/jimeng-client test
bun run --cwd packages/jimeng-client typecheck
bun packages/jimeng-client/src/browser-proxy-cli.ts history-list --session data/jimeng-lab/cli-history-list-smoke/raw/session-fake.json --limit 10 --filter-types 1,10 --dryRun --outDir data/jimeng-lab/cli-history-list-smoke
bun packages/jimeng-client/src/browser-proxy-cli.ts triage-coverage --decisions keep --outDir data/jimeng-lab/triage-coverage-current
```

## Results

- Focused affected tests: 16 passed, 0 failed.
- Full Jimeng client tests: 249 passed, 0 failed.
- Typecheck: passed.
- CLI dry-run smoke: `history-list dry run saved`.
- Triage coverage refresh: 9 keep families, 62 unique endpoints, 0 missing registry rows.
- A1 Assets/history/queue/video info is now `implemented=6`, `not implemented=0`.

## Artifacts

- Dry-run plan: `data/jimeng-lab/cli-history-list-smoke/raw/history-list-20260611104325-dry-run-plan.json`
- Dry-run normalized summary: `data/jimeng-lab/cli-history-list-smoke/normalized/history-list-20260611104325-summary.json`
- Fake offline session used for dry-run smoke: `data/jimeng-lab/cli-history-list-smoke/raw/session-fake.json`
- Coverage summary: `data/jimeng-lab/triage-coverage-current/normalized/triage-coverage-20260611104348-summary.md`

## Caveats

- No live provider call was made in this chunk.
- Prior approved probes showed `/mweb/v1/get_history` can return `ret=0` with empty `records_list`; that is now represented honestly as a valid but possibly sparse read API.
- `assets`, `history-records`, and `history-queue` remain better for known-populated generation/history lookup until a non-empty `get_history` UI capture proves broader pagination scope.
