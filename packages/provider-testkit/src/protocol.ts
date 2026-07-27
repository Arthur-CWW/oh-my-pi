import { Schema } from "effect"

/**
 * Independently versioned dimensions. A change to any of these must invalidate
 * existing sealed cassettes rather than being silently accepted.
 */
export const REQUEST_SCHEMA_VERSION = 1
export const EVENT_SCHEMA_VERSION = 1
export const CASSETTE_SCHEMA_VERSION = 1

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** JSON Schema bodies and tool arguments arrive from outside; they are typed as JSON, never `any`. */
export const JsonSchemaBody = Schema.Json

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const ProviderRoute = Schema.Struct({
  /** Wire dialect family, e.g. "anthropic.messages.v1". Not a hostname. */
  providerApi: Schema.String,
  model: Schema.String,
})
export type ProviderRoute = Schema.Schema.Type<typeof ProviderRoute>

/**
 * Prompt and tool contract versions are part of request identity: a product may
 * not change its prompt or tool contract and keep replaying an old outcome.
 */
export const ProviderContractVersions = Schema.Struct({
  promptVersion: Schema.String,
  toolContractVersion: Schema.String,
  productContractVersion: Schema.optionalKey(Schema.String),
})
export type ProviderContractVersions = Schema.Schema.Type<typeof ProviderContractVersions>

export const ContentPart = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("thinking"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("toolCall"),
    callId: Schema.String,
    name: Schema.String,
    argumentsJson: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("toolResult"),
    callId: Schema.String,
    resultJson: Schema.String,
    isError: Schema.optionalKey(Schema.Boolean),
  }),
])
export type ContentPart = Schema.Schema.Type<typeof ContentPart>

export const ProviderMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant", "tool"]),
  parts: Schema.Array(ContentPart),
})
export type ProviderMessage = Schema.Schema.Type<typeof ProviderMessage>

export const ToolContract = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  strict: Schema.optionalKey(Schema.Boolean),
  parameters: JsonSchemaBody,
})
export type ToolContract = Schema.Schema.Type<typeof ToolContract>

export const ResponseFormat = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text") }),
  Schema.Struct({ kind: Schema.Literal("jsonSchema"), name: Schema.String, schema: JsonSchemaBody }),
])
export type ResponseFormat = Schema.Schema.Type<typeof ResponseFormat>

/** Every output-affecting generation option. Nothing here may be dropped from the digest. */
export const GenerationOptions = Schema.Struct({
  temperature: Schema.optionalKey(Schema.Finite),
  topP: Schema.optionalKey(Schema.Finite),
  topK: Schema.optionalKey(Schema.Int),
  maxOutputTokens: Schema.optionalKey(Schema.Int),
  stopSequences: Schema.optionalKey(Schema.Array(Schema.String)),
  responseFormat: Schema.optionalKey(ResponseFormat),
  seed: Schema.optionalKey(Schema.Int),
})
export type GenerationOptions = Schema.Schema.Type<typeof GenerationOptions>

/**
 * Host-local observations and correlation baggage. Excluded from the request
 * digest by construction: the canonicalizer never reads this field.
 */
export const VolatileRequestFields = Schema.Struct({
  traceId: Schema.optionalKey(Schema.String),
  requestId: Schema.optionalKey(Schema.String),
  idempotencyKey: Schema.optionalKey(Schema.String),
  wallClockIso: Schema.optionalKey(Schema.String),
  baggage: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
export type VolatileRequestFields = Schema.Schema.Type<typeof VolatileRequestFields>

export const ProviderRequest = Schema.Struct({
  route: ProviderRoute,
  contract: ProviderContractVersions,
  /** Ordered system prompt parts. Order is semantic and is never sorted. */
  system: Schema.Array(Schema.String),
  messages: Schema.Array(ProviderMessage),
  /** Ordered tool contracts. Order is semantic and is never sorted. */
  tools: Schema.Array(ToolContract),
  generation: GenerationOptions,
  volatile: Schema.optionalKey(VolatileRequestFields),
})
export type ProviderRequest = Schema.Schema.Type<typeof ProviderRequest>

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const Usage = Schema.Struct({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  reasoningTokens: Schema.optionalKey(Schema.Int),
  cachedInputTokens: Schema.optionalKey(Schema.Int),
})
export type Usage = Schema.Schema.Type<typeof Usage>

export const StopReason = Schema.Literals(["stop", "length", "toolUse", "contentFilter"])
export type StopReason = Schema.Schema.Type<typeof StopReason>

/** Terminal error record as stored in a cassette. Sanitized: no bodies, no credentials. */
export const ProviderErrorRecord = Schema.Struct({
  code: Schema.String,
  retryable: Schema.Boolean,
  message: Schema.String,
  statusHint: Schema.optionalKey(Schema.Int),
  retryAfterMs: Schema.optionalKey(Schema.Int),
})
export type ProviderErrorRecord = Schema.Schema.Type<typeof ProviderErrorRecord>

export const ProviderEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("response.started"), responseId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("text.delta"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("reasoning.delta"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool.call.started"), callId: Schema.String, name: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool.call.arguments.delta"),
    callId: Schema.String,
    fragment: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tool.call.completed"),
    callId: Schema.String,
    name: Schema.String,
    argumentsJson: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("usage"), usage: Usage }),
  Schema.Struct({
    type: Schema.Literal("response.completed"),
    stopReason: StopReason,
    usage: Usage,
  }),
  Schema.Struct({ type: Schema.Literal("response.error"), error: ProviderErrorRecord }),
  Schema.Struct({ type: Schema.Literal("response.interrupted") }),
])
export type ProviderEvent = Schema.Schema.Type<typeof ProviderEvent>

export type TerminalEventType = "response.completed" | "response.error" | "response.interrupted"

export const TERMINAL_EVENT_TYPES: Record<string, true> = {
  "response.completed": true,
  "response.error": true,
  "response.interrupted": true,
}

/** `response.error` and `response.interrupted` are cassette records, never emitted to a consumer. */
export const OBSERVABLE_TERMINAL_EVENT_TYPES: Record<string, true> = { "response.completed": true }

export const TimedProviderEvent = Schema.Struct({
  /** Contiguous from 0 within one interaction. */
  seq: Schema.Int,
  /** Monotonic non-decreasing milliseconds since the first frame of this interaction. */
  elapsedMs: Schema.Int,
  event: ProviderEvent,
})
export type TimedProviderEvent = Schema.Schema.Type<typeof TimedProviderEvent>

export const decodeTimedProviderEvent = Schema.decodeUnknownSync(TimedProviderEvent)
export const decodeProviderRequest = Schema.decodeUnknownSync(ProviderRequest)
