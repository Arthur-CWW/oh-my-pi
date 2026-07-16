# HR-164 H1 trial loop report (2026-07-17 overnight)

Branch: `hr164-h1-trial` (commit `510fae778`, worktree `local/hr164-trial`). **Not merged — the H1 port wave stays hard-gated on Arthur's approval of the H1 contract.** The trial validates the loop mechanics on 3 files before fan-out (plan v2 §4 step 3).

## Scope

`src/task/spawn-worker-client.ts` + `spawn-worker-entry.ts` + `spawn-worker-protocol.ts` — the subprocess pipe triple owning the I2/I5 canonical races. 68 inventory rows addressed across the five lenses; 385 lines of hand-rolled concurrency deleted, replaced by TaggedErrorClass(9)/Semaphore/Scope/Ref/Deferred/Queue/PubSub/Schedule/uninterruptibleMask. Divergences D1–D3 landed on the branch (delivery-at-yield I5; timeout-disarm-at-durable-yield + result-beats-teardown I2/I3; silence abolished I1/I9).

## Loop outcome

| Leg | Agent (lane) | Result |
|---|---|---|
| Implementer | Luna xhigh | Cancelled at 120-request cap mid-typecheck; draft ~75% (right primitives, but wrapped-not-replaced RSS/writer mechanisms, exit-gated delivery retained, D-rows unlanded) |
| Finisher | Sol high | Completed port to green in 23m: deleted wrapped mechanisms, un-exit-gated delivery, landed D1–D3, seam+migration green, typecheck zero |
| Reviewer A | Opus (non-codex family) | verdict incorrect — 2 P1 un-ledgered parity deviations (RssSamplingError propagation; JournalRecoveryError blocking pipe + fallback) + P2s |
| Reviewer B | Luna xhigh | verdict incorrect — 5 P1 counterexamples (stale prior-turn yield on revived sessions; timeout beats durable yield; recovery-failure hang; late result overwrites first terminal error; unversioned `yield-written` breaks mixed-version pairs) + P2 polling I/O |
| Fixer | Sol high | All 12+ findings fixed (0 rebutted), each pinned by a new seam test; final gate 24 pass/1 skip/1263 expects, typecheck zero |

## Verdict on fan-out readiness

The loop WORKS: adversarial review caught 7 P1 merge blockers that a green suite + clean typecheck missed — exactly the un-ledgered-deviation and invariant-counterexample classes the reviewer prompt names. Cost profile: 1 implementer run is NOT enough at current request caps for a 3-file packet of this density; plan fan-out packets at 1–2 files or raise the worker request budget for port packets.

## Rework leaderboard notes (per plan §success criteria)

- Luna xhigh (implementer): correct primitive selection, ran out of budget; wrap-instead-of-replace was its main quality gap (now a loop-prompt clarification).
- Sol high (finisher/fixer): both legs completed within budget with clean reports.
- Opus (reviewer): found the parity-contract class (Promise-boundary error-type changes) the codex reviewer ranked lower — keep the cross-family requirement.
- Luna xhigh (reviewer): strongest invariant-counterexample hunting (stale-yield, version skew) — keep.

## Loop-prompt improvements to apply before fan-out (v2 of loops/*.md)

1. Require the package `generate` step before first typecheck (missing generated files masquerade as unrelated errors).
2. Clarify replace-vs-domain-wrapper: Queue replaces drain *scheduling*; small metadata structures MAY survive to preserve domain behavior (weighted byte caps) exactly.
3. State cleanup-error precedence: a typed cleanup error after a delivered result never replaces the result.
4. Scope D3 explicitly to the client/journal seam; the upstream job-receipt projection is a separate packet.
5. Specify the yield-written wire fields + polling acceptability (current: 10ms incremental tail read).
6. Authorize a narrow process-reap observation hook for I7/I8 assertions without mocks.
7. NEW from review round: packets touching the wire vocabulary MUST bump/negotiate the protocol version and document the mixed-version matrix (now in spawn-worker-protocol.ts header as the exemplar).

## For Arthur

- Approve/edit the H1 contract (`CONTRACTS/h1-child-lifecycle.md`) → fan-out can start from these loop prompts + this trial as the exemplar.
- Read the H2 contract draft (`CONTRACTS/h2-mailbox-park-revive.md`, 9 open questions in-document).
- The trial branch is reviewable standalone: `git diff main...hr164-h1-trial`.
