> Rescued 2026-07-13 from /Users/arthur/agents/local/omp-clean-fork-plan.md

# Clean OMP Fork Recovery Plan

## Decision

Stop using `~/agents/vendor/oh-my-pi` as the implementation base. Freeze it as recovery evidence: preserve every desired feature, proof artifact, test candidate, and known regression in `local/omp-fork-recovery-ledger.md`.

Create a standalone fork from `can1357/oh-my-pi` outside the `~/agents` Git repository. Recover approved behaviors one at a time from evidence; never copy the dirty subtree wholesale. No harness implementation resumes until the plan, ledger, and test gates are reviewed.

## Why the current process failed

1. The shared dirty checkout was also on the live `omp` execution path. A syntax error immediately blocked unrelated sessions.
2. The OMP subtree has no independent Git boundary. At freeze time, `vendor/oh-my-pi` had 203 dirty paths; `packages/coding-agent` had 139.
3. Multiple sessions and agents edited overlapping files without isolated branches or coherent checkpoints.
4. Large changes were attempted before a stable upstream baseline, dependency order, and acceptance tests were fixed.
5. Tests were added after implementation and sometimes asserted mocked plumbing rather than process behavior.
6. Model routing was not disciplined. For the rest of today, Terra is the only implementation route; Sonnet is scout-only; Sol remains the main orchestrator.

## Repository layout

- Standalone repo: `/Users/arthur/oh-my-pi`
- `origin`: Arthur's GitHub fork
- `upstream`: `git@github.com:can1357/oh-my-pi.git`
- `main`: clean mirror of upstream; never direct development
- One branch and one worktree per change, for example:
  - `fix/model-routing-authority`
  - `fix/durable-input-queue`
  - `fix/restart-handoff`
- `~/agents/vendor/oh-my-pi`: frozen reference only, never copied wholesale into the new fork

## Runtime isolation

- `omp`: last committed, green, promoted binary only
- `omp-dev`: binary built from one isolated feature worktree
- Development uses an isolated profile, session directory, and artifact directory.
- The stable command must never execute TypeScript directly from a dirty worktree.
- Promotion is atomic: preserve the previous binary, install the new committed build, run smoke proof, and roll back automatically on failure.

## Recovery phases

### 0. Freeze and preserve evidence

- Stop all harness implementation agents.
- Do not reset the shared monorepo.
- Save the current OMP subtree diff and untracked-file manifest as a read-only recovery artifact.
- Record that the rejected Sonnet routing hunks were removed, but later partial Terra routing edits remain unverified.

### 1. Bootstrap the clean fork

- Create Arthur's GitHub fork from `can1357/oh-my-pi`.
- Clone it to `/Users/arthur/oh-my-pi`.
- Add `upstream` and verify branch/remotes.
- Build and test untouched upstream before changing code.
- Build `omp-dev` and prove it cannot affect stable `omp` or existing sessions.

### 2. Recover intent, not code

Review the long-running harness session, request register, runtime contract, friction ledger, Git history, and frozen diff. Create a matrix with one row per proposed change:

- request/bug ID
- user-visible problem
- upstream behavior
- old implementation location
- invariant/authority affected
- proof that previously worked
- known regressions
- required test level
- decision: keep concept / redesign / discard

No old implementation is copied until its row is approved.

### 3. Plan dependency order

Before code, settle authorities and prerequisites. Do not start blocked work.

- Model routing: one precedence resolver and provenance model
- Durable input: one queue authority, chosen explicitly
- Restart: one ownership handoff protocol
- Effect SessionRunner: blocked until dependency versions and queue authority are resolved

Each slice gets a written contract: inputs, state owner, invariants, failure behavior, tests, proof, rollback.

### 4. Implement one slice at a time

For each approved row:

1. Create a branch/worktree from clean `upstream/main`.
2. Reproduce the bug with a failing behavior test before porting code.
3. Assign one Terra implementation owner and one-writer file scope.
4. Make the smallest source change that satisfies the contract.
5. Run only focused tests during iteration.
6. Run the slice gate and process proof.
7. Commit a coherent checkpoint before starting another slice.
8. Review the diff against upstream; reject unrelated changes.

No concurrent implementation slices. Read-only discovery may run in parallel.

## Verification ladder

Every slice must pass the levels it affects:

1. Static parse/typecheck for changed packages
2. Unit tests for pure state/resolution logic
3. Integration tests using real Settings, session journals, registries, and queue stores; no mocks
4. Process tests for crash/restart, lease handoff, or durability
5. `omp-dev` installed-binary smoke using an isolated profile
6. User-visible proof showing the actual behavior and provenance
7. Full package gate before merge

A test that only checks a fabricated result object is not proof.

## Promotion gate

A feature branch can reach stable `omp` only when:

- working tree is clean
- checkpoint commit is named
- upstream delta is reviewed
- required tests and process proof pass
- `omp-dev` smoke passes
- stable backup exists
- promotion and rollback commands are recorded

## Immediate next deliverable

Review `local/omp-fork-recovery-ledger.md`, then bootstrap the standalone fork and first implement only the runtime-isolation/parse-firewall slice. Every later feature port starts with a reproducing test and an approved ledger row.
