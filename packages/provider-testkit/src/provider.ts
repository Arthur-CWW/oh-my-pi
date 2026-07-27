import { Context, Effect, Stream } from "effect"
import type { ProviderError } from "./errors"
import type { ProviderRequest, TimedProviderEvent } from "./protocol"

export const DEFAULT_VARIANT = "default"

export interface ProviderStreamOptions {
  /** Explicit named scenario variant. Never inferred from call order. */
  readonly variant?: string
  /** Explicit retry attempt, 1-based. Omit only when a variant has a single recording. */
  readonly attempt?: number
  /** Free-form caller label used in audit records. */
  readonly label?: string
}

export interface ResolvedStreamOptions {
  readonly variant: string
  readonly attempt: number | undefined
  readonly label: string
}

export const resolveStreamOptions = (options?: ProviderStreamOptions): ResolvedStreamOptions => ({
  variant: options?.variant ?? DEFAULT_VARIANT,
  attempt: options?.attempt,
  label: options?.label ?? "unlabeled",
})

/**
 * The one production-shaped boundary. Every layer in this package implements
 * exactly this and nothing else, which is what makes them interchangeable.
 */
export interface ProviderService {
  readonly stream: (
    request: ProviderRequest,
    options?: ProviderStreamOptions,
  ) => Stream.Stream<TimedProviderEvent, ProviderError>
}

export class Provider extends Context.Service<Provider, ProviderService>()("@agents/provider-testkit/Provider") {}

/**
 * The provider a decorator wraps. Distinct from `Provider` so that a recording
 * layer can consume one provider and publish another without self-reference.
 */
export class UpstreamProvider extends Context.Service<UpstreamProvider, ProviderService>()(
  "@agents/provider-testkit/UpstreamProvider",
) {}

export type StreamTiming = "instant" | "recorded"

export type TerminalOutcome =
  | { readonly kind: "complete" }
  | { readonly kind: "error"; readonly error: ProviderError }
  /** Self-interrupts after the last frame; models a transport that vanished. */
  | { readonly kind: "interrupt" }
  /** Never terminates; the consumer must cancel. Used for cancellation proofs. */
  | { readonly kind: "hang" }

interface DelayedFrame {
  readonly delayMs: number
  readonly frame: TimedProviderEvent
}

/**
 * Shared emitter for every deterministic layer. Under `"instant"` no clock is
 * consulted at all; under `"recorded"` the inter-frame deltas are replayed via
 * `Effect.sleep`, which a `TestClock` turns into virtual time.
 */
export const emitTimedFrames = (
  frames: readonly TimedProviderEvent[],
  timing: StreamTiming,
  terminal: TerminalOutcome,
): Stream.Stream<TimedProviderEvent, ProviderError> => {
  const body =
    timing === "instant"
      ? Stream.fromArray(frames)
      : Stream.mapEffect(
          Stream.fromArray(
            frames.map((frame, index): DelayedFrame => ({
              delayMs: index === 0 ? frame.elapsedMs : frame.elapsedMs - (frames[index - 1] as TimedProviderEvent).elapsedMs,
              frame,
            })),
          ),
          delayed =>
            delayed.delayMs > 0 ? Effect.as(Effect.sleep(delayed.delayMs), delayed.frame) : Effect.succeed(delayed.frame),
        )

  switch (terminal.kind) {
    case "complete":
      return body
    case "error":
      return Stream.concat(body, Stream.fail(terminal.error))
    case "interrupt":
      return Stream.concat(body, Stream.unwrap(Effect.interrupt))
    case "hang":
      return Stream.concat(body, Stream.unwrap(Effect.never))
  }
}
