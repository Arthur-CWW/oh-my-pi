# nixbox bounded execution policy

> **Provenance — 2026-07-28.** Serialized from `review/nixbox-execution-profile` (`.omp/nixbox-config.yml`), authored by Arthur's harness lane on 2026-07-27. This is policy documentation, **not active OMP configuration**. The source config was intentionally not landed because its machine measurements became stale.

Status: durable operating policy
Owner: harness stream, with machine facts owned by infrastructure

## Authority boundary

Current nixbox capacity, virtualization, filesystem, and layout facts are owned by the nixbox wiki: `dotfiles/docs/agent-library/machines/nixbox.md`. Repo-side machine roles and source/workspace conventions are owned by [`agents-topology.md`](agents-topology.md). Link to those authorities; never copy CPU, memory, path, or generation measurements into configuration or this document.

## Policy

nixbox execution is capability-derived and explicitly bounded:

1. Probe the current host capabilities at run/admission time; do not assume a remembered machine size.
2. Reserve explicit headroom for the guest's services, builds, storage behavior, and virtualization overhead.
3. Apply a finite program memory ceiling below the derived safe capacity. A test lane cannot consume all apparently available memory.
4. Reserve capacity per attempt before spawn, using the same accounting contract as the worker watchdog.
5. Interpret `maxConcurrency: 0` only as **resource-bounded by probed CPU and memory**, never as unlimited fan-out.
6. Run load, concurrency, long-transcript, fault, VM, and broad test workloads on nixbox, not on the Mac control/review plane.
7. Place each workload in an owned, bounded scope with isolated state roots and a durable receipt.
8. Pressure blocks new work. It does not authorize killing active or foreign coordinators.
9. The Mac checkout is not an execution workspace. Never narrow or rewrite its root sparse-checkout state to make room for a lane; create the lane on nixbox instead.

## Raising the ceiling

A larger execution ceiling is permitted only after, in order:

1. infrastructure deliberately changes the guest capacity contract;
2. the wiki authority and a fresh capability receipt record that contract;
3. a bounded smoke demonstrates adequate headroom and no swap thrash;
4. the policy owner reviews and activates a new finite ceiling in current configuration.

Changing a number because the host was resized is not sufficient. The receipt and bounded smoke are part of the contract.

## Configuration consequence

Any future active profile should express this policy through current OMP admission schema and measured capability inputs. It must not revive the historical branch blob or copy its old `memoryBudgetBytes`, concurrency assumptions, skill directories, or auth settings. Authentication policy is out of scope for this document.
