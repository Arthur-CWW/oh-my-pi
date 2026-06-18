# Jimeng Generate Audit Typed Client

Purpose: promote the high-value G1 `/mweb/v1/execute_generate_audit` material pre-audit surface from dry-run-only planning to a typed client helper with replayable transport coverage.

## Scope

- Added `executeJimengGenerateAudit` for the existing `generate-audit-plan` request contract.
- Validates and rejects nonzero Jimeng `ret` envelopes.
- Summarizes permissive provider material-audit rows while tolerating additive fields and omitted optional fields.
- Uses the shared Jimeng fetch transport, so tests can record and replay cassettes without live provider calls.

## Proof

```bash
cd /Users/arthur/agents/web-access/packages/jimeng-client
mise exec -- bun test ./test/generate-audit.test.ts
```

Result: 7 passing tests, including typed request shape, response summary, cassette record/replay, and upstream error rejection.

## Remaining Gate

Live replay is still not claimed. The next useful proof is passive capture of a frontend generation submit containing `/mweb/v1/execute_generate_audit`, comparison against `generate-audit-plan`, then one approved record/replay run through `executeJimengGenerateAudit` with the captured provider response.
