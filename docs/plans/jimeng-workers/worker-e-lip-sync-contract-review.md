# Worker E: Lip-Sync Contract Review

Use this reviewer only after Worker D returns a patch for lip-sync/digital-human contract promotion. This is a review worker, not an implementation worker.

## Assignment

Review the Worker D patch and handoff for correctness, scope control, contract safety, and proof fidelity.

## Read First

- `docs/plans/jimeng-workers/README.md`
- `docs/plans/jimeng-workers/worker-d-lip-sync-contract-promotion.md`
- Worker D final output: `agent://<WorkerDId>`
- Worker D transcript: `history://<WorkerDId>`
- Changed files from Worker D only.

## Review Scope

Check:

- no edits outside Worker D ownership unless explicitly justified;
- no live provider calls in tests;
- no raw provider responses, signed URLs, credentials, cookies, upload tokens, request ids, or private media committed;
- Effect Schema boundaries enforce relied-on paths while tolerating additive provider fields;
- tests actually cover the observed proof contract and are not brittle snapshots of irrelevant provider noise;
- no async daemon/job scheduler work;
- no unrelated generation/persona/template refactor;
- final handoff states remaining parent-owned registry/docs/snapshot updates.

## Do Not Edit

Do not edit files. Return findings only.

## Commands

Do not run tests, typecheck, lint, formatters, git commands, provider CLIs, browser automation, or shell probes. Parent owns validation.

## Final Handoff

Return one of:

- `accepted` with residual risks and parent validation commands; or
- `changes requested` with concrete file/line findings and why they matter.

Also report:

- commands run: `none`;
- files inspected;
- whether Worker D followed the proof boundary;
- whether the patch is safe for parent integration.
