> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-04T06-00-08-576Z_019f2bb6-8080-7000-8a22-156408ea1a65/local/OmpIrcCliHang-report.md

# OmpIrcCliHang report

## Root cause

`omp irc` dispatches through `src/commands/irc.ts` to synchronous `runIrcCommand()` in `src/cli/irc-cli.ts`. The CLI path was opening `IrcExternalBus.global()`, whose `bun:sqlite` Database is configured in WAL mode in `src/irc/bus-external.ts` and was never closed by the one-shot command. That leaves the CLI process alive after it has already printed/handled the command.

## Changes (file:line)

- `vendor/oh-my-pi/packages/coding-agent/src/cli/irc-cli.ts:25`: added a `createBus` injection seam so tests can exercise the CLI-owned bus lifecycle without touching the user's default `~/.omp/agent/irc-bus.sqlite`.
- `vendor/oh-my-pi/packages/coding-agent/src/cli/irc-cli.ts:39`: `runIrcCommand()` now opens an owned `IrcExternalBus` only when no bus is injected, and closes that owned bus in `finally`. Injected buses remain caller-owned, so in-session/global polling behavior is unchanged.
- `vendor/oh-my-pi/packages/coding-agent/test/tools/irc-external.test.ts:164`: added coverage for the no-injected-bus CLI path, asserting the command succeeds and a new bus can open the same DB afterward.
- `vendor/oh-my-pi/packages/coding-agent/CHANGELOG.md:8`: added an Unreleased/Fixed changelog entry for the one-shot `omp irc` hang fix.

## Verification

- Parent reported validation passed before the final test-seam addition: 9/9 `irc-external` tests, `omp irc list </dev/null` exited 0 in <1s, and `omp irc inbox nonexistent-peer --peek </dev/null` exited cleanly.
- I ran `bun --cwd=packages/coding-agent test test/tools/irc-external.test.ts` via direct Bun binary. Result: 9 pass, 1 fail. The newly added owned-bus test passed. The failure was the pre-existing `migrates a database created without peer state columns` case, caused by this sandbox falling back to in-memory SQLite after `os.tmpdir()` temp-directory creation fails with EPERM; the legacy DB is gone after the setup connection closes. This is an environment limitation, not a failure of the CLI bus lifecycle change.
- Confirmed the temporary repro directory `vendor/oh-my-pi/.tmp-irc-home` is gone via `find` after cleanup.

Recommended parent validation commands:

```bash
cd vendor/oh-my-pi
bun --cwd=packages/coding-agent test test/tools/irc-external.test.ts
timeout 10 omp irc list </dev/null; echo $?
timeout 10 omp irc inbox nonexistent-peer --peek </dev/null; echo $?
```

## Open risks

- No code-level risks known.
- Sandbox cleanup item: `vendor/oh-my-pi/.tmp-test-parent/` remains from a temp-directory probe; Node cleanup fails with EPERM. Reviewer can remove it with `rm -rf vendor/oh-my-pi/.tmp-test-parent` outside this sandbox.
