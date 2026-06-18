import { Effect, Schema } from "effect"
import type { JsonValue } from "./types"

export const CodexAnalyzeOperationSchema = Schema.Union([
  Schema.Literal("image-understand"),
  Schema.Literal("video-understand"),
])
export type CodexAnalyzeOperation = typeof CodexAnalyzeOperationSchema.Type

export const CodexAnalyzeInputSchema = Schema.Struct({
  operation: CodexAnalyzeOperationSchema,
  mediaUrl: Schema.String,
  prompt: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  maxOutputTokens: Schema.optionalKey(Schema.Number),
  workspaceId: Schema.optionalKey(Schema.String),
  targetIds: Schema.optionalKey(Schema.Array(Schema.String)),
  referenceFrameUrls: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type CodexAnalyzeInput = typeof CodexAnalyzeInputSchema.Type

export const CodexPayloadTextContentSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
})
export type CodexPayloadTextContent = typeof CodexPayloadTextContentSchema.Type

export const CodexPayloadImageContentSchema = Schema.Struct({
  type: Schema.Literal("image_url"),
  image_url: Schema.Struct({
    url: Schema.String,
  }),
})
export type CodexPayloadImageContent = typeof CodexPayloadImageContentSchema.Type

export const CodexPayloadMessageSchema = Schema.Struct({
  role: Schema.Union([Schema.Literal("system"), Schema.Literal("user")]),
  content: Schema.Union([
    Schema.String,
    Schema.Array(Schema.Union([CodexPayloadTextContentSchema, CodexPayloadImageContentSchema])),
  ]),
})
export type CodexPayloadMessage = typeof CodexPayloadMessageSchema.Type

export const CodexPreparedPayloadSchema = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(CodexPayloadMessageSchema),
  max_tokens: Schema.Number,
  metadata: Schema.Struct({
    provider: Schema.Literal("codex"),
    operation: CodexAnalyzeOperationSchema,
    mediaUrl: Schema.String,
    workspaceId: Schema.optionalKey(Schema.String),
    targetIds: Schema.optionalKey(Schema.Array(Schema.String)),
    referenceFrameUrls: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
})
export type CodexPreparedPayload = typeof CodexPreparedPayloadSchema.Type

export const CodexPreparedResultSchema = Schema.Struct({
  provider: Schema.Literal("codex"),
  endpoint: Schema.Literal("POST /v1/chat/completions"),
  operation: CodexAnalyzeOperationSchema,
  model: Schema.String,
  estimatedCostUsd: Schema.Number,
  payload: CodexPreparedPayloadSchema,
})
export type CodexPreparedResult = typeof CodexPreparedResultSchema.Type

export const CodexAnalyzeResultSchema = Schema.Struct({
  mode: Schema.Literal("live"),
  prepared: CodexPreparedResultSchema,
  response: Schema.Record(Schema.String, Schema.Any),
})
export type CodexAnalyzeResult = Omit<typeof CodexAnalyzeResultSchema.Type, "response"> & {
  readonly response: JsonValue
}

export type CodexFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface CodexLiveOptions {
  readonly apiKey?: string
  readonly maxSpendUsd: number
  readonly endpoint?: string
  readonly fetch?: CodexFetch
}

const DEFAULT_CODEX_MODEL = "gpt-4.1-mini"
const DEFAULT_MAX_OUTPUT_TOKENS = 900
const CODEX_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
const IMAGE_UNDERSTAND_ESTIMATE_USD = 0.01
const VIDEO_UNDERSTAND_ESTIMATE_USD = 0.03

export function decodeCodexAnalyzeInput(value: object): CodexAnalyzeInput {
  return Schema.decodeUnknownSync(CodexAnalyzeInputSchema)(value)
}

export function prepareCodexAnalyze(value: CodexAnalyzeInput): CodexPreparedResult {
  const input = Schema.decodeUnknownSync(CodexAnalyzeInputSchema)(value)
  const model = input.model?.trim() || DEFAULT_CODEX_MODEL
  const maxOutputTokens = normalizePositiveInteger(input.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS)
  const prompt = input.prompt?.trim() || defaultAnalysisPrompt(input.operation)
  const referenceFrameUrls = normalizeReferenceFrameUrls(input.referenceFrameUrls)
  if (input.operation === "video-understand" && referenceFrameUrls.length === 0) {
    throw new Error("Codex video analysis requires prepared referenceFrameUrls")
  }
  if (input.operation === "video-understand" && referenceFrameUrls.includes(input.mediaUrl)) {
    throw new Error("Codex video analysis referenceFrameUrls must contain extracted frames, not the raw mediaUrl")
  }
  const payload: CodexPreparedPayload = {
    model,
    messages: [
      {
        role: "system",
        content: "You analyze UGC media for local creative review. Return concise JSON-friendly observations; do not invent inaccessible details.",
      },
      {
        role: "user",
        content: buildUserContent({ ...input, referenceFrameUrls }, prompt),
      },
    ],
    max_tokens: maxOutputTokens,
    metadata: {
      provider: "codex",
      operation: input.operation,
      mediaUrl: input.mediaUrl,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.targetIds && input.targetIds.length > 0 ? { targetIds: input.targetIds } : {}),
      ...(referenceFrameUrls.length > 0 ? { referenceFrameUrls } : {}),
    },
  }
  return {
    provider: "codex",
    endpoint: "POST /v1/chat/completions",
    operation: input.operation,
    model,
    estimatedCostUsd: input.operation === "video-understand" ? VIDEO_UNDERSTAND_ESTIMATE_USD : IMAGE_UNDERSTAND_ESTIMATE_USD,
    payload,
  }
}

export function executeCodexAnalyze(input: CodexAnalyzeInput, options: CodexLiveOptions): Effect.Effect<CodexAnalyzeResult, Error> {
  return Effect.gen(function*() {
    const prepared = prepareCodexAnalyze(input)
    if (!Number.isFinite(options.maxSpendUsd) || options.maxSpendUsd < 0) {
      return yield* Effect.fail(new Error("Codex live request requires a non-negative maxSpendUsd"))
    }
    if (prepared.estimatedCostUsd > options.maxSpendUsd) {
      return yield* Effect.fail(new Error(`Codex live request blocked: estimated $${prepared.estimatedCostUsd.toFixed(2)} exceeds max $${options.maxSpendUsd.toFixed(2)}`))
    }

    const apiKey = yield* Effect.try({
      try: () => resolveCodexApiKey(options),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    })
    const httpFetch = options.fetch ?? fetch
    const endpoint = options.endpoint ?? CODEX_CHAT_COMPLETIONS_URL
    const response = yield* Effect.tryPromise({
      try: async () => {
        const raw = await httpFetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(prepared.payload),
        })
        const text = await raw.text()
        if (!raw.ok) throw new Error(`Codex HTTP ${raw.status}: ${text.slice(0, 500)}`)
        return JSON.parse(text) as JsonValue
      },
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    })

    return { mode: "live", prepared, response }
  })
}

export async function runCodexAnalyze(input: CodexAnalyzeInput, options: CodexLiveOptions): Promise<CodexAnalyzeResult> {
  return await Effect.runPromise(executeCodexAnalyze(input, options))
}

export function resolveCodexApiKey(options: Pick<CodexLiveOptions, "apiKey"> = {}): string {
  const candidate = options.apiKey ?? process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY
  if (!candidate) throw new Error("Missing CODEX_API_KEY or OPENAI_API_KEY for Codex live analysis.")
  return candidate
}

function buildUserContent(input: CodexAnalyzeInput, prompt: string): readonly (CodexPayloadTextContent | CodexPayloadImageContent)[] {
  if (input.operation === "image-understand") {
    return [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: input.mediaUrl } },
    ]
  }

  return [
    { type: "text", text: `${prompt}\n\nVideo URL: ${input.mediaUrl}` },
    ...(input.referenceFrameUrls ?? []).map((url) => ({ type: "image_url", image_url: { url } }) as const),
  ]
}

function defaultAnalysisPrompt(operation: CodexAnalyzeOperation): string {
  if (operation === "image-understand") {
    return "Analyze the image for UGC creative review: subject, composition, product visibility, creator presence, text overlays, and compliance risks."
  }
  return "Analyze the video for UGC creative review: hook, scene flow, visible product moments, creator delivery, captions, retention risks, and reusable mechanics."
}

function normalizeReferenceFrameUrls(value: readonly string[] | undefined): readonly string[] {
  if (!value) return []
  return value.map((item) => item.trim()).filter((item) => item.length > 0)
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.trunc(value)
}
