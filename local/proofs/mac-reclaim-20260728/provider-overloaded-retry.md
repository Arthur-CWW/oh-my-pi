# Provider overload retry receipt

## Root cause

The canonical Anthropic in-stream SSE error is normalized by `packages/ai/src/providers/anthropic.ts` to `Anthropic stream error (overloaded_error): Overloaded`. Both the Anthropic provider retry loop and `AgentSession.#isRetryableError` already classified that exact text as transient and scheduled exponential backoff with jitter.

The false terminal result came later in `packages/coding-agent/src/modes/utils/request-failure-presentation.ts`: `classifyRequestFailure` intentionally classifies an overload as `provider-error`, but `shouldAwaitRetryDisposition` only waited for retry events for network, timeout, stream-abort, and rate-limit causes. It therefore took the immediate branch in `RequestFailurePresenter.handleMessage` and rendered `gave up after 1` before `AgentSession` emitted `auto_retry_start`. The successful retry could not update that card because no pending failure was retained.

A second directly related defect in `AgentSession.#handleRetryableError` made the existing absurd-retry-after cap test fail: the fail-fast event omitted the adopted wait, even though the cap correctly skipped the sleep.

## Fix design

- Use the shared `@oh-my-pi/pi-utils` transient-error classifier in `shouldAwaitRetryDisposition` after the structured request-failure causes. Empty, replay-safe overload/5xx errors now stay pending until `auto_retry_start`/`auto_retry_end`; errors after observable text, thinking, or tool calls remain terminal to avoid unsafe replay.
- Keep the existing retry settings and mechanics unchanged: `retry.enabled`, `retry.maxRetries` (default 10 retries), `retry.baseDelayMs`, exponential backoff with 25% jitter, parsed retry-after adoption, and `retry.maxDelayMs` fail-fast behavior.
- Include both the adopted wait and configured cap in the fail-fast event message.
- Add exact-message coverage proving two canonical overload failures recover on the third provider attempt under default retry count, with jittered exponential delays of 7ms then 14ms under deterministic randomness. Add presentation coverage reproducing the exact live message.

## NixOS test evidence

Host: `nixbox`. Every run used a fresh shared clone, copied the prescribed `vendor/oh-my-pi/node_modules`, ran `bun run generate`, and isolated `HOME`, `TMPDIR`, `OMP_CONFIG_ROOT`, and `OMP_SESSION_CONTROL_DB` under a fresh temporary root.

Failing-first run at test commit `932d110cf`:

- Exact presentation regression failed: expected retry disposition to be awaited, received `false`.
- Exact AgentSession test already proved the retry engine made three provider attempts and recovered, isolating the live defect to presentation rather than retry classification.
- The pre-existing cap assertion also exposed the incomplete fail-fast detail.

Green behavior after source commit `ebdeb0ee0`:

- `test/modes/utils/request-failure-presentation.test.ts`: exact overload regression passes.
- `test/agent-session-retry-cap.test.ts`: all 10 tests pass, including the new default-three-attempt overload recovery and the existing absurd retry-after fail-fast.
- `test/agent-session-empty-stop-guard.test.ts`: all 8 tests pass.
- Combined required run: 43 pass, 2 fail; the two failures are unchanged `agent-session-retry-fallback.test.ts` baseline failures (`falls back on structured classifier refusals and pins the fallback`; `does not auto-retry generic Request was aborted. errors`). The same fresh-clone command on `nb/main` produced those same two failures plus the cap-detail failure fixed by this branch: 40 pass, 3 fail. Failure-name diff versus main therefore has zero additions and one removal.

The required coding-agent typecheck is blocked by the existing `packages/provider-testkit`/differential-replay dependency baseline. Branch and `nb/main` emit the same diagnostic set; no touched source or test file appears in it.
