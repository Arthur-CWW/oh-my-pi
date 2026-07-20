# HR-225 TUI MVU proof bundle

Observed on 2026-07-19. This directory is self-contained reviewer evidence for the Effect v4 MVU cutover; it does not depend on the originating agent transcript.

## Contents

- [`test-results.txt`](test-results.txt) — exact observed gate results and the invalid full-suite attempt.
- [`audit-before-after.md`](audit-before-after.md) — the 31-surface baseline, eight executed slices, and zero-row active residual result.
- [`pty-smoke.py`](pty-smoke.py) — rerunnable real-PTY driver against `vendor/oh-my-pi/packages/coding-agent/dist/omp`.
- [`pty-smoke-transcript.txt`](pty-smoke-transcript.txt) — captured passing screen transcript from that driver.
- [`focused-suite.sh`](focused-suite.sh) — exact rerun command for the observed 38-file coding-agent suite.
- [`../../../docs/fable/tui-view-audit.md`](../../../docs/fable/tui-view-audit.md) — retained baseline provenance and current execution anchors.

## Blessed candidate

`16.0.1+fork.2e8701b95e6f` is selected for future invocations at digest `fef0775cabac8954e1ba85cf6649d5bce75a9078ab4a0fd946cf53be43707d64`. The candidate passed readiness and was blessed with rollout disabled; no live session was restarted. Arthur was notified through cmux.

## Rerun

From the repository root:

```sh
./local/proofs/tui-mvu-bigbang/focused-suite.sh
bun --cwd=vendor/oh-my-pi/packages/coding-agent run check:types
bun --cwd=vendor/oh-my-pi/packages/tui run check:types
bun --cwd=vendor/oh-my-pi/packages/tui test test/stdin-buffer.test.ts test/input-router.test.ts
bun --cwd=vendor/oh-my-pi/packages/coding-agent run build
python3 local/proofs/tui-mvu-bigbang/pty-smoke.py
bun vendor/oh-my-pi/packages/coding-agent/test/process/disposable-tui-pty-proof.ts
```

The Python smoke creates isolated HOME, config, and session directories; drives the built `dist/omp` through a real PTY; asserts composer draft restoration, Ctrl-R history, Settings, Agent Hub/help, and Resume selector flows; then rewrites `pty-smoke-transcript.txt` only after a clean exit. Build first so `dist/omp` exists.

The focused command is preserved in `focused-suite.sh`. `bun --cwd=vendor/oh-my-pi/packages/coding-agent test` reruns the package suite, but the recorded full-suite attempt is not a green gate: Bun terminated a worker with SIGTRAP. See `test-results.txt`.
