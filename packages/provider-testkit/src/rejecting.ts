import { Context, Effect, Layer, Stream } from "effect"
import { requestIdentity } from "./canonical"
import { UnexpectedNetworkAccessError, type ProviderError } from "./errors"
import { Provider, resolveStreamOptions, type ProviderService } from "./provider"

export interface ProviderAuditService {
  readonly append: (record: UnexpectedNetworkAccessError) => void
  readonly entries: () => readonly UnexpectedNetworkAccessError[]
}

export class ProviderAudit extends Context.Service<ProviderAudit, ProviderAuditService>()(
  "@agents/provider-testkit/ProviderAudit",
) {}

export const makeProviderAudit = (): ProviderAuditService => {
  const records: UnexpectedNetworkAccessError[] = []
  return {
    append: record => {
      records.push(record)
    },
    entries: () => records,
  }
}

export interface RejectingProviderHandle {
  readonly provider: ProviderService
  readonly audit: ProviderAuditService
}

/**
 * Fails every call with a safe audit record. Install it wherever provider
 * access must remain inert — historical transcript playback, projection tests,
 * migration replays — so an accidental new provider turn is loud, not silent.
 */
export const makeRejectingProvider = (label: string, audit = makeProviderAudit()): RejectingProviderHandle => ({
  audit,
  provider: {
    stream: (request, options) =>
      Stream.unwrap(
        Effect.suspend(() => {
          const resolved = resolveStreamOptions(options)
          const identity = requestIdentity(request)
          const record = new UnexpectedNetworkAccessError({
            guard: "RejectingProvider",
            label: `${label}:${resolved.label}`,
            routeDigest: identity.componentDigests.route,
            contractDigest: identity.componentDigests.contract,
            requestDigest: identity.requestDigest,
          })
          audit.append(record)
          return Effect.fail<ProviderError>(record)
        }),
      ),
  },
})

export const layerRejecting = (label: string, audit?: ProviderAuditService): Layer.Layer<Provider> =>
  Layer.sync(Provider, () => makeRejectingProvider(label, audit ?? makeProviderAudit()).provider)

export interface NetworkGuardHandle {
  readonly audit: ProviderAuditService
  /** Restores the previous global fetch. Always call this in a test teardown. */
  readonly restore: () => void
}

type FetchLike = typeof globalThis.fetch

/**
 * Replaces `globalThis.fetch` with a rejecting stub so that a product path
 * reaching the network — through an SDK, a stray telemetry client, or a
 * forgotten adapter — fails loudly with the same typed error instead of
 * silently attempting egress.
 */
export const guardNetwork = (label: string, audit = makeProviderAudit()): NetworkGuardHandle => {
  const previous: FetchLike = globalThis.fetch
  const rejecting = (input: Parameters<FetchLike>[0]): ReturnType<FetchLike> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    let origin: string
    try {
      const parsed = new URL(raw)
      origin = `${parsed.protocol}//${parsed.host}`
    } catch {
      origin = "opaque"
    }
    const record = new UnexpectedNetworkAccessError({ guard: "networkGuard", label, origin })
    audit.append(record)
    return Promise.reject(record)
  }
  rejecting.preconnect = () => {}
  globalThis.fetch = rejecting
  return {
    audit,
    restore: () => {
      globalThis.fetch = previous
    },
  }
}
