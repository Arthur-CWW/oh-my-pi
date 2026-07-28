import { Effect, Layer, Stream } from "effect"
import { requestIdentity } from "./canonical"
import { ScriptedNoMatchError, type ProviderError } from "./errors"
import type { ProviderEvent, ProviderRequest, TimedProviderEvent } from "./protocol"
import {
  Provider,
  emitTimedFrames,
  resolveStreamOptions,
  type ProviderService,
  type ResolvedStreamOptions,
  type StreamTiming,
  type TerminalOutcome,
} from "./provider"

export interface ScriptedStep {
  /** Virtual milliseconds to wait before this event under `"recorded"` timing. */
  readonly afterMs?: number
  readonly event: ProviderEvent
}

export type ScriptedTerminal =
  | { readonly kind: "complete" }
  | { readonly kind: "error"; readonly error: ProviderError }
  | { readonly kind: "interrupt" }
  /** Hold the stream open forever so a test can prove real cancellation. */
  | { readonly kind: "hang" }

export interface ScriptedInteraction {
  readonly name: string
  /**
   * Explicit request predicate. There is deliberately no call-count parameter:
   * a script may not encode "first call A, then call B".
   */
  readonly when: (request: ProviderRequest, options: ResolvedStreamOptions) => boolean
  readonly steps: readonly ScriptedStep[]
  readonly terminal: ScriptedTerminal
}

export interface ScriptedProviderOptions {
  readonly scriptId: string
  readonly interactions: readonly ScriptedInteraction[]
  readonly timing?: StreamTiming
}

/**
 * Deterministic fake. Elapsed time is derived from the authored `afterMs`
 * values, never from the wall clock, so frames are byte-identical run to run.
 */
export const scriptedFrames = (steps: readonly ScriptedStep[]): readonly TimedProviderEvent[] => {
  const frames: TimedProviderEvent[] = new Array(steps.length)
  let elapsedMs = 0
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as ScriptedStep
    elapsedMs += step.afterMs ?? 0
    frames[i] = { seq: i, elapsedMs, event: step.event }
  }
  return frames
}

export const makeScriptedProvider = (options: ScriptedProviderOptions): ProviderService => {
  const timing = options.timing ?? "instant"
  return {
    stream: (request, streamOptions) =>
      Stream.unwrap(
        Effect.suspend(() => {
          const resolved = resolveStreamOptions(streamOptions)
          const matched = options.interactions.filter(interaction => interaction.when(request, resolved))
          if (matched.length !== 1) {
            return Effect.fail<ProviderError>(
              new ScriptedNoMatchError({
                scriptId: options.scriptId,
                requestDigest: requestIdentity(request).requestDigest,
                variant: resolved.variant,
                matchCount: matched.length,
                candidateNames: matched.map(candidate => candidate.name),
              }),
            )
          }
          const interaction = matched[0] as ScriptedInteraction
          const terminal: TerminalOutcome = interaction.terminal
          return Effect.succeed(emitTimedFrames(scriptedFrames(interaction.steps), timing, terminal))
        }),
      ),
  }
}

export const layerScripted = (options: ScriptedProviderOptions): Layer.Layer<Provider> =>
  Layer.succeed(Provider, makeScriptedProvider(options))
