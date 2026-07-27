import type { ProviderEvent, ProviderRequest } from "../../src/protocol"
import type { ScriptedStep } from "../../src/scripted"

export const EXAMPLE_CASSETTE_ID = "provider-testkit-example"
export const EXAMPLE_INTERACTION_ID = "annotate-passage-success"

/**
 * A product-neutral request. The shape is deliberately mundane: what matters is
 * that every identity dimension (route, contract versions, prompt, conversation,
 * tools, generation) is populated so digest tests can move exactly one of them.
 */
export const exampleRequest = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  route: { providerApi: "anthropic.messages.v1", model: "claude-example-4" },
  contract: { promptVersion: "annotate/v3", toolContractVersion: "tools/v2", productContractVersion: "example/v1" },
  system: ["You annotate short passages.", "Cite every claim with a source id."],
  messages: [
    {
      role: "user",
      parts: [{ kind: "text", text: "Annotate: 山重水複疑無路，柳暗花明又一村。" }],
    },
  ],
  tools: [
    {
      name: "lookup_source",
      description: "Resolve a source id to its span in the seeded corpus.",
      strict: true,
      parameters: {
        type: "object",
        properties: { sourceId: { type: "string" }, span: { type: "string" } },
        required: ["sourceId"],
        additionalProperties: false,
      },
    },
  ],
  generation: { temperature: 0, maxOutputTokens: 512, stopSequences: ["</done>"], seed: 7 },
  volatile: {
    traceId: "trace-abcdef",
    requestId: "req-000123",
    wallClockIso: "2026-07-27T04:00:00.000Z",
    baggage: { session: "local-only" },
  },
  ...overrides,
})

/**
 * Adversarial tool-argument fragmentation: the JSON is split mid-token, mid-CJK
 * string and mid-surrogate-pair. Concatenation must still equal `argumentsJson`.
 */
const ARGUMENTS_JSON = '{"sourceId":"doc-1#s2","span":"柳暗花明🌸"}'
const FRAGMENT_A = '{"sourceId":"doc-'
const FRAGMENT_B = '1#s2","span":"柳暗花'
const FRAGMENT_C = "明\ud83c"
const FRAGMENT_D = '\udf38"}'

export const exampleEvents: readonly ProviderEvent[] = [
  { type: "response.started", responseId: "resp_example_0001" },
  { type: "reasoning.delta", text: "The passage is a Lu You couplet; resolve the source before annotating." },
  { type: "text.delta", text: "Looking up the seeded source" },
  { type: "text.delta", text: " before answering." },
  { type: "tool.call.started", callId: "call_001", name: "lookup_source" },
  { type: "tool.call.arguments.delta", callId: "call_001", fragment: FRAGMENT_A },
  { type: "tool.call.arguments.delta", callId: "call_001", fragment: FRAGMENT_B },
  { type: "tool.call.arguments.delta", callId: "call_001", fragment: FRAGMENT_C },
  { type: "tool.call.arguments.delta", callId: "call_001", fragment: FRAGMENT_D },
  { type: "tool.call.completed", callId: "call_001", name: "lookup_source", argumentsJson: ARGUMENTS_JSON },
  { type: "usage", usage: { inputTokens: 214, outputTokens: 48, reasoningTokens: 19 } },
  { type: "response.completed", stopReason: "toolUse", usage: { inputTokens: 214, outputTokens: 51, reasoningTokens: 19 } },
]

export const exampleSteps: readonly ScriptedStep[] = exampleEvents.map((event, index) => ({
  afterMs: index === 0 ? 0 : 15,
  event,
}))

/**
 * The same interaction as it comes off a real transport, before curation: an
 * operator's `Authorization` header and an absolute home path leaked into the
 * assistant's reasoning. The committed cassette must contain neither.
 */
export const LEAKED_BEARER = "Bearer sk-live-EXAMPLE0123456789abcdefghij"
export const LEAKED_HOME_PATH = "/home/operator/.config/example/creds.json"

export const leakySteps: readonly ScriptedStep[] = exampleSteps.map((step, index) =>
  index === 1
    ? {
        afterMs: step.afterMs ?? 0,
        event: {
          type: "reasoning.delta",
          text: `Retrying with ${LEAKED_BEARER} from ${LEAKED_HOME_PATH} before annotating.`,
        },
      }
    : step,
)

/**
 * What `default/v1` must leave behind. Authored by hand rather than derived
 * from the policy, so a policy regression cannot silently update its own oracle.
 */
export const REDACTED_REASONING_TEXT =
  "Retrying with Bearer sk-REDACTED from /REDACTED-HOME/.config/example/creds.json before annotating."

export const expectedRedactedEvents: readonly ProviderEvent[] = exampleEvents.map((event, index) =>
  index === 1 ? { type: "reasoning.delta", text: REDACTED_REASONING_TEXT } : event,
)
