# Effect v4 Porting Guide

This guide maps the migration idioms used by the harness lifecycle work to the installed Effect v4 beta.92 APIs. Each row names the current-code shape, the Effect construct, the semantic trap, the migration recipe, and the probe that pins the claim.

## Pattern map

| Current-code idiom | Effect construct | Semantic trap | Migration recipe | Probe test |
|---|---|---|---|---|
| Promise eagerness and an unawaited promise | `Effect` value and explicit `Effect.runPromise` at the boundary | Effects are lazy; constructing or dropping one does not run its side effects. A dropped `yield*` branch is never evaluated. | Keep work as an `Effect`; compose it with `Effect.gen`/`yield*`; run only the returned effect at the boundary. Do not use a bare effect as if it were an eager promise. | `does not run a dropped lazy effect until the returned effect is executed` |
| `AbortSignal` cancellation | Fiber interruption with `Effect.uninterruptibleMask` for cleanup | Interruption is cooperative and can arrive more than once; cleanup must not be interrupted halfway through and must be idempotent. | Translate signal listeners into interruption-aware effects; guard the once-only finalizer with `Effect.uninterruptibleMask`; preserve interruption after cleanup. | `runs an interruption finalizer once under double interruption` |
| `try/finally` cleanup | `Effect.acquireRelease` and `Effect.scoped`/`Scope` | Resource finalizers are scope-owned and run in reverse acquisition order (LIFO), including interruption. | Acquire with `Effect.acquireRelease`, perform work inside `Effect.scoped`, and let scope closure/interruption own release order. | `releases two interrupted resources in LIFO order` |
| `EventEmitter` fan-out | `PubSub` | A queue is not broadcast: each message must be delivered to every subscriber, and each subscriber owns its subscription. | Create a `PubSub`, subscribe each consumer, publish once, and read one value from each subscription. | `delivers one published value to two PubSub subscribers` |
| Ambient singleton/service locator | `Context.Service` plus `Layer` | The service is absent until provided; changing the layer wiring changes behavior without changing the consumer. | Define the service contract with `Context.Service`; expose concrete `Layer`s; provide one at the effect boundary. | `uses two alternative layers for one service contract` |
| Hand-rolled retry and jitter | `Schedule.exponential` + jitter + cap, driven by `TestClock` | Delays are virtual only when the clock is provided; schedule policy controls retry timing and count separately. | Compose an exponential schedule with jitter and a cap; repeat/retry the effect; provide `TestClock.layer`; advance virtual time to each deadline. | `retries according to an exponential schedule under virtual time` |
| FIFO admission cap | bounded `Queue` and `Semaphore` | A bounded queue controls buffered items; a semaphore controls concurrent permits. They are not interchangeable. | Use `Queue.bounded(n)` for admission buffering and `Semaphore.make(n)`/`Semaphore.withPermits` for permit ownership; release permits in guaranteed scope. | `blocks a second Semaphore acquisition until the permit is released` |
| Correlation-id request/reply | `Deferred` plus `Effect.timeout` | Completion and timeout race; the loser must not corrupt the winner, and a timeout is an ordinary typed failure. | Allocate one `Deferred`, correlate the reply to it, await with `Effect.timeout`, and test both reply-before-timeout and timeout-before-reply. | `handles Deferred completion before and after timeout` |
| `Date.now` and `setTimeout` | `Clock` and `TestClock` | Wall-clock reads and timers become deterministic only through the Effect clock; advancing time does not run unrelated eager promises. | Read with `Clock.currentTimeMillis`; use Effect scheduling/timers; provide `TestClock.layer` and advance it explicitly in tests. | `reads current time through Clock under TestClock` |

## Builtin adoption (replace, never wrap)

The migration plan's builtin-adoption table is reproduced here as the cutover rule: use the Effect builtin directly rather than wrapping it in a local compatibility abstraction.

| Existing concern | Effect builtin to adopt | Rule |
|---|---|---|
| Cancellation and cleanup | Fiber interruption, `Effect.uninterruptibleMask`, `Effect.acquireRelease`, `Scope` | Replace; never wrap |
| Broadcast events | `PubSub` | Replace; never wrap |
| Dependency injection | `Context.Service`, `Layer` | Replace; never wrap |
| Retry/backoff | `Schedule.exponential` with jitter and cap | Replace; never wrap |
| Bounded admission | `Queue.bounded`, `Semaphore` | Replace; never wrap |
| One-shot reply | `Deferred`, `Effect.timeout` | Replace; never wrap |
| Time and timers | `Clock`, `TestClock` | Replace; never wrap |

## When NOT to Effect

Do not force Effect into the TUI render loop: keep synchronous rendering and terminal frame composition on their existing hot path. Do not introduce Effect allocations into hot paths where the work is already synchronous, bounded, and performance-sensitive. Use Effect at lifecycle, resource, cancellation, scheduling, and integration boundaries where its semantics are the contract.
