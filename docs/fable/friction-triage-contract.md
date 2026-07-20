# Friction and Tool-Issue Triage Contract

> **Class:** State + target contract.
> **Owner:** harness stream.
> **Generator:** Arthur's 2026-07-20 question about whether reports are ever revisited/fixed (provenance A).
> **Backlog:** HR-240.

## Current state

### `report_tool_issue`

Local store: `~/.omp/agent/autoqa.db`, table `grievances`.

Current row: integer id, model string, binary version, tool, free-text report, pushed flag. With consent it may batch-push to `qa.omp.sh`; `omp grievances` can list, push, or delete rows.

Gap: no timestamp, session/agent/tool-call provenance, status, owner, duplicate cluster, linked fix, fixed build, regression proof, resolved time, or recurrence tracking. Deleting currently means only deletion—not resolution.

### `report_friction`

Local store: `~/.omp/agent/friction.jsonl`.

Current row includes timestamp, session ID, agent ID, model string, class, note, binary version, and binary digest. `omp friction list|stats` exposes symptoms and aggregates.

Gap: append-only evidence has no separate disposition/closure stream. HR-207 intentionally stopped at crude symptom collection.

## Decision

Keep both evidence producers. Do not force them into one physical database and do not mutate/delete evidence to mean resolved. Build one derived control-plane triage queue plus an append-only disposition stream.

Local provenance should include where privacy-safe:

- timestamp and stable report ID;
- source (`tool_issue` or `friction`), class, tool/operation;
- provider + model + effort/route receipt;
- session + agent + tool-call reference;
- binary version + digest;
- platform + architecture + host capability class;
- normalized fingerprint, first/last seen, recurrence count;
- artifact/reproduction pointers, never copied private payloads.

Disposition events record:

- status: open, triaged, duplicate, fixing, fixed, declined, stale, reopened;
- cluster/canonical report;
- owner and priority;
- linked HR/issue/PR/jj change/Git commit;
- fixed version/digest;
- regression/proof reference;
- disposition reason and timestamp.

A report is fixed only with proof. Seeing the fingerprint on a build at or after `fixedDigest` reopens it. Shared uploads remain consent-gated and strip private session/agent/host identifiers; the richer local projection stays user-owned.

## Batch loop

1. Ingest new grievances/frictions idempotently.
2. Normalize provider/model/tool/class and compute a privacy-safe fingerprint.
3. Cluster exact/near duplicates by tool, symptom, version/digest, and platform.
4. Rank recurrence, recency, affected models/builds, and user-visible severity.
5. Propose backlog links, stale candidates, or duplicates; never auto-close.
6. After a landed fix, attach regression evidence and fixed digest.
7. Re-scan later reports; reopen on recurrence.

The control-plane view should answer: what repeats, which models/builds are affected, what is open, what changed, what proved the fix, and what became stale.

## First implementation slice

Migrate `autoqa.db` with timestamp and local provenance columns; add a disposition/event table or adjacent ledger; derive one `omp grievances triage --json` projection over both stores; preserve existing consent/push behavior. Use the projection to batch the reports from this 2026-07-20 thread before adding automation.
