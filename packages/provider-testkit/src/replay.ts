import { Effect, Layer, Stream } from "effect"
import { diffComponentDigests, requestIdentity } from "./canonical"
import {
  digestVariantKey,
  exactKey,
  loadCassette,
  routeVariantKey,
  type Cassette,
  type CassetteInteraction,
} from "./cassette"
import {
  CassetteAmbiguousMatchError,
  CassetteMissError,
  ProviderStreamError,
  PromptDigestMismatchError,
  type CassetteIntegrityError,
  type ProviderError,
} from "./errors"
import type { TimedProviderEvent } from "./protocol"
import {
  Provider,
  emitTimedFrames,
  resolveStreamOptions,
  type ProviderService,
  type StreamTiming,
  type TerminalOutcome,
} from "./provider"

export interface ReplayOptions {
  /** Default `"instant"`: no clock is consulted, so replay costs no wall time. */
  readonly timing?: StreamTiming
}

interface ReplayPlan {
  readonly frames: readonly TimedProviderEvent[]
  readonly terminal: TerminalOutcome
}

const planFor = (interaction: CassetteInteraction): ReplayPlan => {
  const frames = interaction.frames
  const last = frames[frames.length - 1] as TimedProviderEvent
  switch (last.event.type) {
    case "response.error":
      return {
        frames: frames.slice(0, -1),
        terminal: {
          kind: "error",
          error: new ProviderStreamError({
            code: last.event.error.code,
            retryable: last.event.error.retryable,
            message: last.event.error.message,
            ...(last.event.error.statusHint === undefined ? {} : { statusHint: last.event.error.statusHint }),
            ...(last.event.error.retryAfterMs === undefined ? {} : { retryAfterMs: last.event.error.retryAfterMs }),
          }),
        },
      }
    case "response.interrupted":
      return { frames: frames.slice(0, -1), terminal: { kind: "interrupt" } }
    default:
      return { frames, terminal: { kind: "complete" } }
  }
}

/**
 * Exact-match replay. Every failure path below returns a typed error *before*
 * emitting any event: there is no wildcard match, no nearest-neighbour, no
 * "first recording wins", and no fall-through to a live provider.
 */
export const makeReplayProvider = (cassette: Cassette, options?: ReplayOptions): ProviderService => {
  const timing = options?.timing ?? "instant"
  return {
    stream: (request, streamOptions) =>
      Stream.unwrap(
        Effect.suspend(() => {
          const resolved = resolveStreamOptions(streamOptions)
          const identity = requestIdentity(request)

          const candidates =
            resolved.attempt === undefined
              ? cassette.byDigestVariant.get(digestVariantKey(identity.requestDigest, resolved.variant)) ?? []
              : (() => {
                  const exact = cassette.byExactKey.get(
                    exactKey(identity.requestDigest, resolved.variant, resolved.attempt),
                  )
                  return exact === undefined ? [] : [exact]
                })()

          if (candidates.length === 1) {
            const plan = planFor(candidates[0] as CassetteInteraction)
            return Effect.succeed(emitTimedFrames(plan.frames, timing, plan.terminal))
          }

          if (candidates.length > 1) {
            return Effect.fail<ProviderError>(
              new CassetteAmbiguousMatchError({
                cassetteId: cassette.cassetteId,
                requestDigest: identity.requestDigest,
                variant: resolved.variant,
                candidateInteractionIds: candidates.map(candidate => candidate.interactionId),
              }),
            )
          }

          // Diagnostics only. This branch can produce an error, never an event.
          const sameRoute =
            cassette.byRouteVariant.get(routeVariantKey(identity.componentDigests.route, resolved.variant)) ?? []
          if (sameRoute.length === 1) {
            const stale = sameRoute[0] as CassetteInteraction
            return Effect.fail<ProviderError>(
              new PromptDigestMismatchError({
                cassetteId: cassette.cassetteId,
                interactionId: stale.interactionId,
                variant: resolved.variant,
                expectedRequestDigest: stale.requestDigest,
                actualRequestDigest: identity.requestDigest,
                mismatches: diffComponentDigests(stale.componentDigests, identity.componentDigests),
              }),
            )
          }

          return Effect.fail<ProviderError>(
            new CassetteMissError({
              cassetteId: cassette.cassetteId,
              requestDigest: identity.requestDigest,
              variant: resolved.variant,
              ...(resolved.attempt === undefined ? {} : { attempt: resolved.attempt }),
              componentDigests: identity.componentDigests,
              indexedInteractions: cassette.interactions.length,
            }),
          )
        }),
      ),
  }
}

export const layerReplay = (cassette: Cassette, options?: ReplayOptions): Layer.Layer<Provider> =>
  Layer.succeed(Provider, makeReplayProvider(cassette, options))

export const layerReplayFromDirectory = (
  directory: string,
  options?: ReplayOptions,
): Layer.Layer<Provider, CassetteIntegrityError> =>
  Layer.effect(
    Provider,
    Effect.map(loadCassette(directory), cassette => makeReplayProvider(cassette, options)),
  )
