# Fleet rollout operator runbook

This is the local-only procedure for promoting and rolling an immutable OMP build across live session runners. Run it from the `~/agents` checkout. Do not treat a successful promotion (`BLESSED`) as a successful fleet rollout.

## 1. Promote and retain N−1

```sh
bun scripts/omp-promote.ts
```

Expected release receipt:

```text
BLESSED <version> <digest>
digest <64-character-sha256>
version <version>
receipt vendor/oh-my-pi/local/readiness-receipt-<digest>.json <receipt-sha256>
```

If the final line says `ROLLOUT incomplete`, blessing succeeded but live rollout did not. Continue only after inspecting the fleet; never relabel this as rollout success.

## 2. Inspect the real local fleet

```sh
omp fleet status --all
omp fleet errors --since 2h
```

`status` is tabular and includes `SESSION`, `NAME`, `WORKSTREAM`, `FRESHNESS`, `STATE`, `OWNER_EPOCH`, `BUILD`, `VERSION`, `COMPATIBILITY`, `CHANNEL`, `PIN`, and `ROLLOUT`. Stale, legacy-incompatible, busy, or pinned-elsewhere sessions must be explained before a live run. `errors` retains source journal URIs; it is not a copied error database.

To limit every later selector to durable metadata, use `--workstream <id>` or the selector `workstream:<id>` where a positional selector is accepted.

## 3. Journal and review the dry run

```sh
omp fleet rollout --blessed --dry-run
```

For one workstream:

```sh
omp fleet rollout --blessed --workstream <id> --dry-run
```

Expected plan shape:

```text
ROLLOUT_ID	<uuid>
MODE	dry-run
TARGET	requested-channel	<digest>
PREVIOUS	<n-1-digest>
WAVES
WAVE	<wave-id>	canary	<session-id>:<expected-owner-epoch>
WAVE	<wave-id>	rolling	<session-id>:<expected-owner-epoch>,...
EXCLUDED
EXCLUDED	<session-id>	<skip-or-defer-state>	<reason>
```

The plan is journaled even in dry-run mode. Compatibility, pin, stale-peer, already-current, and busy/deferred decisions must be visible. No control command is sent.

## 4. Run the explicit canary and waves

Choose exactly one compatible target from the reviewed plan:

```sh
omp fleet rollout --blessed --canary <session-id-or-name> --wave-size 1
```

For an exact retained release instead of the blessed channel:

```sh
omp fleet rollout --digest <64-character-sha256> --canary <session-id-or-name> --wave-size 1
```

`--canary` is explicit opt-in; merely having a candidate release never selects or mutates a live session. The controller processes the canary first, observes its replacement heartbeat/status/ErrorInbox health, then processes rolling waves serially. A terminal successful result is:

```text
EXECUTION	Succeeded	<healthy-session-ids>
```

Anything else is not rollout success. A failed checkpoint, restart receipt, recovery, re-adoption, status, or correlated health gate freezes later targets.

## 5. Verify health and evidence

```sh
omp fleet status --all
omp fleet errors --since 30m --rollout <rollout-id>
```

Confirm each selected session reports the intended digest, a changed owner epoch, compatible control/journal/view ranges, a healthy terminal rollout phase, and no attributable errors. Keep the printed rollout ID: controller and target receipts correlate by rollout ID, wave ID, target/session ID, command ID, expected owner epoch, target digest, checkpoint, and source journal URI.

## 6. Pause or resume a target

```sh
omp fleet pause <session-id|name|workstream:id>
omp fleet resume <session-id|name|workstream:id>
```

Each target prints an epoch-fenced terminal receipt:

```text
RECEIPT	commandId=<uuid>	sessionId=<id>	targetOwnerEpoch=<epoch>	state=applied	requestedAt=<iso>	acknowledgedAt=<iso>	completedAt=<iso>	result=<json>	error=-
```

Resume preserves manual/pre-rollout pause provenance; rollout-only pauses are released only through the checkpoint/recovery decision.

## 7. Pin or unpin a session

```sh
omp fleet pin <selector> <64-character-sha256>
omp fleet pin <selector> blessed
omp fleet pin <selector> canary
omp fleet unpin <selector>
```

The controller only requests and observes. The target runner independently verifies immutable artifact bytes, readiness evidence, registry channel, compatibility, and owner epoch before appending its own `fleet_pin` journal record. `canary` is valid only as the literal explicit operator choice. `unpin` appends an unpin record and restores the blessed channel for future operations. Verify `CHANNEL` and `PIN` with `omp fleet status --all`.

## 8. Roll back safely

Roll back a journaled rollout in reverse target order to retained N−1:

```sh
omp fleet rollback <rollout-id> --to previous
```

Or select an explicit retained digest:

```sh
omp fleet rollback <rollout-id> --to <64-character-sha256>
```

Expected terminal receipts:

```text
ROLLBACK	sessionId=<id>	targetId=<id>	targetDigest=<digest>	state=RolledBack	reason=-
```

Rollback repeats cordon, quiesce, safe checkpoint, exact-digest restart, recovery, and health. It never kills a live provider call and never rewinds a transcript. `RollbackIncomplete` or `Failed` means the fleet remains frozen; inspect `fleet status` and `fleet errors` rather than retrying blindly.
