# @wirebabel/fault-cell

App-agnostic disposable NixOS fault cells. A typed runner provisions a throwaway VM from a
pinned nixpkgs, exposes scenario operations (barriers, signals, cgroup limits, ENOSPC, SQLite
lock pressure, network partition/delay, process `TZ`, artifact collection), and emits one run
manifest shape regardless of which application is under test.

This package imports no application code. The only application-specific inputs are a
declarative `CellSpec` (topology) and a guest payload directory (the workload files).

## Design rules that are structural, not conventional

- **A scenario cannot shell into a success check.** Invariants are pure functions over an
  `Observation` built exclusively from Schema-decoded telemetry. There is no "run a command and
  read stdout" verb anywhere in the scenario API.
- **Missing telemetry is a failure.** `InvariantOutcome` has a third case, `Missing`.
  `decideOutcome` fails the run on `Missing`, on zero evaluated invariants, and on any step
  failure.
- **A fault that cannot be measured is not applied.** Every injection is verified against a
  read-back (`memory.max`, `cpu.max`, free bytes, link state, netem delay) and raises
  `FaultNotAppliedError` when the measurement disagrees.
- **Acceleration is reported, not assumed.** `acceleration.kvmEnabled` comes from QMP
  `query-kvm` inside the live guest, so a silent TCG fallback shows up in the manifest.
- **The control channel is virtio-serial, not the network**, so network faults never cost
  observability.

## Layout

| Path | Role |
|---|---|
| `nix/cell.nix` | Builds `config.system.build.vm` from a pinned nixpkgs plus the cell spec |
| `guest/agent.py` | Stdlib-only in-guest agent speaking the JSON control protocol |
| `src/protocol.ts` | The only place wire text becomes values; request/reply/event schemas |
| `src/cell.ts` | VM lifecycle plus the typed scenario operations |
| `src/runner.ts` | Executes a plan, verifies faults, evaluates invariants, writes the manifest |
| `src/manifest.ts` | The one manifest shape every application emits |
| `scenarios/` | Worked examples; each is data plus pure predicates |

## Scenario contract

A registered `ScenarioDefinition` supplies four things:

1. a `CellSpec` describing VM resources, quota-bounded scratch mounts, and network links;
2. a deterministic `plan({ seed, runId })` containing declared processes, typed fault steps,
   probes, and artifacts;
3. pure invariants that inspect only the resulting `Observation`; and
4. optional negative controls that must fail when the harness exercised the intended faults.

The host sends only members of `GuestRequestSchema`. Every guest event, reply, QMP frame, probe,
and final manifest is decoded with Effect Schema before core code uses it. The manifest records
the exact scenario plan and hashed inputs, nixpkgs and VM store paths, git/host provenance,
QMP-reported acceleration, verified fault observations, telemetry, invariant outcomes, and any
typed failure.

## Running (execution host only)

The runner boots real VMs. Run it on the execution host, never on a laptop, and always inside a
bounded scope:

```bash
cd packages/fault-cell
bun run provision                        # pinned, hash-verified deps; no workspace install
bun run check                            # package typecheck plus non-VM tests
bun run cli -- list                      # inspect registered scenarios

systemd-run --user --collect --pipe --wait \
  -p MemoryMax=16G -p CPUQuota=800% \
  -p WorkingDirectory="$PWD" \
  bun run cli -- run sqlite-atomicity --run-dir /home/arthur/test-runs/fault-cell/<run>
```

Add `--negative-control` to append the scenario's deliberately-false invariants; the run must
then report `failed`. That is the self-test proving the assertion path can fail.

## Adding a scenario

```bash
# 1. payload the guest will execute (any language available in the cell)
mkdir -p packages/fault-cell/scenarios/<id>
$EDITOR packages/fault-cell/scenarios/<id>/workload.py

# 2. the scenario itself: topology, processes, steps, probes, invariants, negative controls
$EDITOR packages/fault-cell/scenarios/<id>.ts

# 3. one line in the registry
$EDITOR packages/fault-cell/src/registry.ts

# 4. run it
cd packages/fault-cell && bun run cli -- run <id>
```

A workload signals a barrier by sending `{"name": "...", "detail": {...}}` to the datagram
socket in `$FAULTCELL_BARRIER_SOCKET`, or by calling `faultcell-barrier <name>` which is on the
child's `PATH`.
