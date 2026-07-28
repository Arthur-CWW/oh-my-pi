import { Context, Effect, Layer, Stream } from "effect"
import { requestIdentity } from "./canonical"
import type { DraftInteraction } from "./cassette"
import type { ProviderError } from "./errors"
import type { ProviderErrorRecord, ProviderRequest, TimedProviderEvent } from "./protocol"
import {
  Provider,
  UpstreamProvider,
  resolveStreamOptions,
  type ProviderService,
  type ResolvedStreamOptions,
} from "./provider"

/**
 * Raw capture target. Recording never writes a bundle: it hands drafts to a
 * sink, and `sealCassette` is the separate reviewed curation step.
 */
export interface RecordingSinkService {
  readonly record: (draft: DraftInteraction) => Effect.Effect<void>
  readonly drafts: Effect.Effect<readonly DraftInteraction[]>
}

export class RecordingSink extends Context.Service<RecordingSink, RecordingSinkService>()(
  "@agents/provider-testkit/RecordingSink",
) {}

export const makeMemorySink = (): RecordingSinkService => {
  const captured: DraftInteraction[] = []
  return {
    record: draft =>
      Effect.sync(() => {
        captured.push(draft)
      }),
    drafts: Effect.sync(() => captured),
  }
}

export const layerMemorySink: Layer.Layer<RecordingSink> = Layer.sync(RecordingSink, makeMemorySink)

export interface RecordingOptions {
  /**
   * Names the draft. Must be derived from the request and explicit options, not
   * from a call counter, so concurrent captures stay addressable.
   */
  readonly interactionId: (request: ProviderRequest, options: ResolvedStreamOptions) => string
}

const cassetteProviderErrorCode = (providerCode: string): string => {
  switch (providerCode) {
    case "authentication_error":
      return "authentication_error"
    case "content_filter":
      return "content_filter"
    case "invalid_request":
      return "invalid_request"
    case "overloaded":
      return "overloaded"
    case "permission_denied":
      return "permission_denied"
    case "rate_limit":
      return "rate_limit"
    case "stream_disconnected":
      return "stream_disconnected"
    case "timeout":
      return "timeout"
    default:
      return "provider_error"
  }
}
const MAX_RETRY_AFTER_MS = 86_400_000

const boundedStatus = (statusHint: number | undefined): number | undefined =>
  statusHint !== undefined && Number.isInteger(statusHint) && statusHint >= 100 && statusHint <= 599
    ? statusHint
    : undefined

const boundedRetryAfter = (retryAfterMs: number | undefined): number | undefined =>
  retryAfterMs !== undefined &&
  Number.isInteger(retryAfterMs) &&
  retryAfterMs >= 0 &&
  retryAfterMs <= MAX_RETRY_AFTER_MS
    ? retryAfterMs
    : undefined

const safeProviderDetail = (statusHint: number | undefined): string =>
  statusHint === undefined ? "ProviderStreamError" : `ProviderStreamError (HTTP ${statusHint})`

const errorRecordOf = (error: ProviderError): ProviderErrorRecord => {
  if (error._tag !== "ProviderStreamError") {
    return { code: error._tag, retryable: false, message: error._tag }
  }
  const statusHint = boundedStatus(error.statusHint)
  const retryAfterMs = boundedRetryAfter(error.retryAfterMs)
  return {
    code: cassetteProviderErrorCode(error.code),
    retryable: error.retryable,
    message: safeProviderDetail(statusHint),
    ...(statusHint === undefined ? {} : { statusHint }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }
}

export const makeRecordingProvider = (
  upstream: ProviderService,
  sink: RecordingSinkService,
  options: RecordingOptions,
): ProviderService => ({
  stream: (request, streamOptions) =>
    Stream.unwrap(
      Effect.sync(() => {
        const resolved = resolveStreamOptions(streamOptions)
        const identity = requestIdentity(request)
        const frames: TimedProviderEvent[] = []
        let failure: ProviderError | undefined

        const finalize = Effect.suspend(() => {
          const last = frames[frames.length - 1]
          const nextSeq = frames.length
          const elapsedMs = last?.elapsedMs ?? 0
          if (failure !== undefined) {
            frames.push({ seq: nextSeq, elapsedMs, event: { type: "response.error", error: errorRecordOf(failure) } })
          } else if (last === undefined || last.event.type !== "response.completed") {
            // No typed failure and no completion: the consumer fiber was cancelled.
            frames.push({ seq: nextSeq, elapsedMs, event: { type: "response.interrupted" } })
          }
          return sink.record({
            interactionId: options.interactionId(request, resolved),
            requestDigest: identity.requestDigest,
            componentDigests: identity.componentDigests,
            variant: resolved.variant,
            attempt: resolved.attempt ?? 1,
            frames,
          })
        })

        return upstream.stream(request, streamOptions).pipe(
          Stream.tap(frame =>
            Effect.sync(() => {
              frames.push(frame)
            }),
          ),
          Stream.catch((error: ProviderError) => {
            failure = error
            return Stream.fail(error)
          }),
          Stream.ensuring(finalize),
        )
      }),
    ),
})

export const layerRecording = (
  options: RecordingOptions,
): Layer.Layer<Provider, never, UpstreamProvider | RecordingSink> =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const upstream = yield* UpstreamProvider
      const sink = yield* RecordingSink
      return makeRecordingProvider(upstream, sink, options)
    }),
  )
