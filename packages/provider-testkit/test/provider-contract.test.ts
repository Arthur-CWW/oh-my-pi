import { describe, it } from "bun:test"
import { Effect, Layer } from "effect"
import { fileURLToPath } from "node:url"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { loadCassette } from "../src/cassette"
import { CredentialGate, ProviderTransport, envCredentialGate, layerLive, type LiveArmModule } from "../src/live"
import { Provider } from "../src/provider"
import { layerReplay } from "../src/replay"
import { layerScripted } from "../src/scripted"
import { runProviderContract, type ContractArm } from "./support/contract-suite"
import { exampleRequest, expectedRedactedEvents, exampleSteps } from "./support/fixtures"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const exampleCassetteDirectory = join(packageRoot, "fixtures", "cassettes", "example")

const cassette = await Effect.runPromise(loadCassette(exampleCassetteDirectory))

const unknownRoute = exampleRequest({ route: { providerApi: "anthropic.messages.v1", model: "model-that-was-never-recorded" } })

const replayArm: ContractArm = {
  name: "ReplayProvider",
  layer: layerReplay(cassette),
  successRequest: exampleRequest(),
  unservableRequest: unknownRoute,
  unservableTags: ["CassetteMissError"],
}

const scriptedArm: ContractArm = {
  name: "ScriptedProvider",
  layer: layerScripted({
    scriptId: "contract",
    interactions: [
      {
        name: "recorded-equivalent",
        when: request => request.route.model === "claude-example-4",
        // The scripted arm reproduces the same neutral outcome the cassette
        // holds, so a single suite proves the two are interchangeable.
        steps: exampleSteps.map((step, index) => ({
          afterMs: step.afterMs ?? 0,
          event: expectedRedactedEvents[index] ?? step.event,
        })),
        terminal: { kind: "complete" },
      },
    ],
  }),
  successRequest: exampleRequest(),
  unservableRequest: unknownRoute,
  unservableTags: ["ScriptedNoMatchError"],
}

/**
 * Opt-in and credential-gated. Default runs spend nothing: without both
 * environment variables this arm is never constructed and never imported.
 */
const liveTransportPath = process.env.PROVIDER_TESTKIT_LIVE === "1" ? process.env.PROVIDER_TESTKIT_LIVE_TRANSPORT : undefined

const liveArm: ContractArm | undefined =
  liveTransportPath === undefined
    ? undefined
    : await (async () => {
        // Exception to the static-import rule: the module specifier is supplied
        // by the operator at run time because this package owns no provider SDK.
        const loaded = (await import(isAbsolute(liveTransportPath) ? liveTransportPath : resolve(liveTransportPath))) as {
          readonly liveArm: LiveArmModule
        }
        const descriptor = loaded.liveArm
        return {
          name: "LiveProvider",
          layer: Layer.provide(
            layerLive,
            Layer.mergeAll(
              Layer.succeed(ProviderTransport, descriptor.transport),
              Layer.succeed(CredentialGate, envCredentialGate(descriptor.credentialEnvVar)),
            ),
          ) as Layer.Layer<Provider>,
          successRequest: descriptor.successRequest,
          unservableRequest: descriptor.unservableRequest,
          unservableTags: ["ProviderStreamError", "ProviderCredentialsMissingError"],
        } satisfies ContractArm
      })()

describe("provider contract", () => {
  runProviderContract(replayArm)
  runProviderContract(scriptedArm)

  if (liveArm === undefined) {
    it.skip("LiveProvider: opt-in only (set PROVIDER_TESTKIT_LIVE=1 and PROVIDER_TESTKIT_LIVE_TRANSPORT)", () => {})
  } else {
    runProviderContract(liveArm)
  }
})
