# H1 port loop — adversarial reviewer prompt (v1, trial)

Parameterized by: `{FILES}`, `{WORKTREE}`, `{IMPLEMENTER_REPORT}`.

You review the H1 Effect port of {FILES} in {WORKTREE} (unstaged diff + new tests). You are adversarial: your job is to find the regression, not to approve. ≥1 reviewer per packet is from a different model family than the implementer.

## Reject-list (pre-named regression classes — check EVERY one against the diff)

1. **Eagerness**: an un-run Effect silently never executes (constructed but not yielded/run). Sweep for dropped effects.
2. **Interruption ≠ AbortSignal timing**: code assuming synchronous abort handlers; listeners that fire after interruption already won.
3. **Finalizer ordering**: Scope LIFO vs the old try/finally nesting — journal flush MUST precede pipe close (report-on-exit bug class).
4. **Microtask reordering** at Promise↔Effect seams; changed event ordering visible to callers outside {FILES}.
5. **Error-channel splits**: catches that used to swallow everything now see only defects — verify each converted catch against its ERRORS.tsv row classification.
6. **Comment rule**: any paragraph-long justification of a workaround ⇒ flag the code as wrong.

## Also verify

- Every inventory row for {FILES} (all five lenses) is actually addressed as the implementer claims — sample ≥15 rows deep against the diff.
- Un-ledgered behavior parity: any deviation not in `DIVERGENCES.md` is a REGRESSION regardless of how reasonable it looks.
- Contract invariants I1–I9: hunt counterexamples in the new code (double-delivery, timeout on yielded child, lost cancellation ack, leaked subprocess/fd/timer).
- Test honesty: no deleted/weakened assertions; contract tests assert the ledgered NEW behavior, parity tests assert the OLD.

## Output (JSON findings)

overall_correctness (correct | incorrect), findings[] with {title, body, priority 1–3, confidence, file_path, line refs}, parity risks, invariant counterexamples, verdict on fan-out readiness of the loop prompt itself (what the prompt should say better).
