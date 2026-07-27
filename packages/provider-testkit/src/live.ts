import { Context, Effect, Layer, Stream } from "effect"
import { digestOf } from "./canonical"
import { ProviderCredentialsMissingError, type ProviderStreamError } from "./errors"
import type { ProviderEvent, ProviderRequest, ProviderRoute, TimedProviderEvent } from "./protocol"
import {
  Provider,
  UpstreamProvider,
  resolveStreamOptions,
  type ProviderService,
  type ResolvedStreamOptions,
} from "./provider"

/**
 * The product's real wire adapter. This package never implements one: it owns
 * no SDK, no credentials and no sockets. Products supply their production
 * transport here, and `LiveProvider` only normalizes timing and sequencing.
 */
export interface ProviderTransportService {
  readonly connect: (
    request: ProviderRequest,
    options: ResolvedStreamOptions,
  ) => Stream.Stream<ProviderEvent, ProviderStreamError>
}

export class ProviderTransport extends Context.Service<ProviderTransport, ProviderTransportService>()(
  "@agents/provider-testkit/ProviderTransport",
) {}

/**
 * Credentials are gated, not carried. `LiveProvider` is the only layer allowed
 * to require them, and it refuses to open a stream when they are absent instead
 * of degrading to an empty or default response.
 */
export interface CredentialGateService {
  readonly assertAvailable: (route: ProviderRoute) => Effect.Effect<void, ProviderCredentialsMissingError>
}

export class CredentialGate extends Context.Service<CredentialGate, CredentialGateService>()(
  "@agents/provider-testkit/CredentialGate",
) {}

/** Presence-only check: the value is never read, logged, or digested. */
export const envCredentialGate = (variableName: string): CredentialGateService => ({
  assertAvailable: route =>
    Effect.suspend(() => {
      const value = process.env[variableName]
      if (value !== undefined && value.length > 0) return Effect.void
      return Effect.fail(
        new ProviderCredentialsMissingError({
          routeDigest: digestOf("route", { providerApi: route.providerApi, model: route.model }),
          detail: `environment variable ${variableName} is unset or empty`,
        }),
      )
    }),
})

export const layerCredentialGateFromEnv = (variableName: string): Layer.Layer<CredentialGate> =>
  Layer.succeed(CredentialGate, envCredentialGate(variableName))

export const makeLiveProvider = (
  transport: ProviderTransportService,
  gate: CredentialGateService,
): ProviderService => ({
  stream: (request, options) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const resolved = resolveStreamOptions(options)
        yield* gate.assertAvailable(request.route)
        const startedAt = Date.now()
        let seq = 0
        return Stream.map(
          transport.connect(request, resolved),
          (event): TimedProviderEvent => ({ seq: seq++, elapsedMs: Date.now() - startedAt, event }),
        )
      }),
    ),
})

export const layerLive: Layer.Layer<Provider, never, ProviderTransport | CredentialGate> = Layer.effect(
  Provider,
  Effect.gen(function* () {
    const transport = yield* ProviderTransport
    const gate = yield* CredentialGate
    return makeLiveProvider(transport, gate)
  }),
)

/** Same adapter published as the decoration target for `RecordingProvider`. */
export const layerLiveUpstream: Layer.Layer<UpstreamProvider, never, ProviderTransport | CredentialGate> = Layer.effect(
  UpstreamProvider,
  Effect.gen(function* () {
    const transport = yield* ProviderTransport
    const gate = yield* CredentialGate
    return makeLiveProvider(transport, gate)
  }),
)

/**
 * Contract shape a product exports so the credential-gated live arm of the
 * shared contract suite can exercise its real adapter. The testkit itself never
 * ships one: it owns no SDK and no credentials.
 */
export interface LiveArmModule {
  readonly transport: ProviderTransportService
  readonly credentialEnvVar: string
  readonly successRequest: ProviderRequest
  /** Something the real provider refuses cheaply, e.g. an unknown model id. */
  readonly unservableRequest: ProviderRequest
}
