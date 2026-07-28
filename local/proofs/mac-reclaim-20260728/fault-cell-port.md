# Fault-cell package port receipt

## Source and inventory

- Destination branch: `changeset/fault-cell-package`, based directly on nb `main` `6e507adec3abde5131ab60fb83a71a74c9602110`.
- Source: only `packages/fault-cell` from the newest commit `6fef8ce653569dd6dd3cf6959f9e20b831e2a9a4` on `review/fault-cell-harness`; its parent has no fault-cell tree. The stale stacked branch base was not merged.
- Imported 24 source files (4,621 lines), then added two focused tests:

```text
packages/fault-cell/README.md
packages/fault-cell/guest/agent.py
packages/fault-cell/nix/cell.nix
packages/fault-cell/package.json
packages/fault-cell/runtime-deps.json
packages/fault-cell/scenarios/sqlite-atomicity.ts
packages/fault-cell/scenarios/sqlite-atomicity/workload.py
packages/fault-cell/scripts/provision-runtime.sh
packages/fault-cell/src/cell.ts
packages/fault-cell/src/channel.ts
packages/fault-cell/src/cli.ts
packages/fault-cell/src/errors.ts
packages/fault-cell/src/ids.ts
packages/fault-cell/src/index.ts
packages/fault-cell/src/manifest.ts
packages/fault-cell/src/observation.ts
packages/fault-cell/src/protocol.ts
packages/fault-cell/src/provenance.ts
packages/fault-cell/src/qmp.ts
packages/fault-cell/src/registry.ts
packages/fault-cell/src/runner.ts
packages/fault-cell/src/scenario.ts
packages/fault-cell/test/outcome.test.ts
packages/fault-cell/test/protocol.test.ts (added during port)
packages/fault-cell/test/sqlite-workload.test.ts (added during port)
packages/fault-cell/tsconfig.json
```

No root `package.json`, root script, `services.yml`, or global runtime wiring changed.

## Invariant fixes

- Replaced every explicit TypeScript `any`/`unknown` occurrence in the package. Wire reply and QMP payloads now use the recursive, Schema-owned `JsonValue`; decoder failures use `Schema.SchemaError`; the manifest outcome API accepts only an object or `null`.
- Removed unsafe `as unknown as JsonValue` probe casts. Probe values are decoded through `JsonValueSchema` before hashing or manifest persistence.
- Confirmed there is no raw `JSON.parse` in the TypeScript package. Guest/QMP wire text and manifest inputs cross Effect Schema codecs.
- Replaced Node `parseArgs` with Effect v4 `Command`, `Argument`, and `Flag`; integer flags are typed and validated by the CLI.
- Moved cell mount initialization into `Effect.fn` composition and removed the internal `Effect.runPromise`; the only promise runner remains the executable CLI boundary.
- Made package typechecking resolve its own declared TypeScript dependency through the normal script PATH (`tsc --noEmit`) instead of a cwd-relative `node_modules` path.
- Expanded the README with the fault-cell/scenario contract and package-local check/list/run commands.
- Added real (unmocked) tests for guest/QMP codecs, manifest rejection, and the SQLite workload's intact/torn-ledger behavior.
- Focused invariant scan passed with no findings:
  `bun run scripts/ast-grep.boundary.ts scan --config sgconfig.yml --filter='^(no-unsafe-any-unknown-ts|no-raw-json-parse-ts)$' --report-style=medium packages/fault-cell`.

## Nixbox package gate

Workspace: `/srv/data/agents/workspaces/fault-cell-port-20260728` at provisional package commit `ad1dcb98b`. Dependencies were copied from the named shared workspace recipe. The supplied root `bun run generate` step was not applicable because current main has no `generate` script; the self-contained package gate does not require generated sources.

Command (with isolated HOME/TMPDIR/OMP state):

```text
cd packages/fault-cell && bun run check
```

Observed:

```text
$ bun run typecheck && bun run test
$ tsc --noEmit
$ bun test test/
11 pass
0 fail
28 expect() calls
Ran 11 tests across 3 files. [560.00ms]
```

## Nested-KVM decision and full scenario

Probe on nixbox:

```text
/dev/kvm: crw-rw-rw- 1 root kvm 10, 232
ls exit: 0
grep -Ec 'vmx|svm' /proc/cpuinfo: 128
kvm module: present
```

Decision: nixbox can run fault cells; it does not need to defer this workload to h11/bare metal. The first noninteractive `systemd-run --user --scope` attempt exposed a stale `XDG_RUNTIME_DIR=/home/arthur/.xdg`; explicitly selecting `/run/user/1000` connected to the existing user bus. The actual run stayed bounded by an outer 29-minute timeout and a user scope with `MemoryMax=16G`, `CPUQuota=800%`.

Observed full run:

```text
systemd unit: run-p61646-i61647.scope
run id: 01kymcd2kr1rppnp
cell VM store path: /nix/store/sdz2n82lb7gy7k231b2i9gxka47a88zc-nixos-vm
QMP: kvm enabled, present=true
outcome: PASSED
invariants: 8 SATISFIED, 0 violated/missing
```

The scenario exercised the named-barrier SIGKILL, restart recovery, quota-backed ext4 ENOSPC, `SQLITE_FULL` exit 28, post-fault integrity check, and in-guest verifier. It reported 53 complete committed batches, no orphan rows, and `integrity_check = ok`.

Artifacts:

```text
/srv/data/agents/fault-cell-runs/port-20260728/sqlite-atomicity/manifest.json
/srv/data/agents/fault-cell-runs/port-20260728/sqlite-atomicity/console.log
```

## Recommended next step

Land `changeset/fault-cell-package` onto nb main. Keep nixbox as the default execution host while retaining the manifest's QMP `query-kvm` result as the per-run authority. After landing, run the same scenario once with `--negative-control`; the required failed outcome is the end-to-end assertion-path proof and can become the baseline operational receipt.
