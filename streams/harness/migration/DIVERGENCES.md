# DIVERGENCES ledger (append-only)

Every place where post-migration behavior intentionally differs from pre-migration behavior. Each row cites its contract clause. Behavior NOT listed here MUST match `main` exactly (parity). A sprawling ledger means the contract is under-specified — stop and fix the contract.

| # | Hotspot | Old behavior | New behavior | Contract clause | Status |
|---|---|---|---|---|---|
| D1 | H1 | Completion report delivered on subprocess exit (parked child holds it until wall-clock) | Delivery at `yieldWritten` (monitor message; journal recovery as durability backstop) | h1-child-lifecycle I5 | Partial (HR-163 recovery shipped); full at H1 port |
| D2 | H1 | Wall-clock timeout converts an already-yielded child into `SpawnWorkerError` | `timeoutFired` unreachable from `yielded`/`parked` | h1-child-lifecycle I3 | Pending H1 port |
| D3 | H1 | `job` may report `running` indefinitely for a journal-terminal child | Silence abolished: receipt reflects journal state within the I5 bound | h1-child-lifecycle I1/I9 | Pending H1 port |
| D4 | H1/H2 | Subprocess child IRC fell through to the external bus (cross-session loopback) | Typed coordinator-IPC refusal (HR-163); full parent-bridged transport at H2 | h1 companion; H2 contract TBD | Refusal shipped (`468ef51ae3c1`) |
