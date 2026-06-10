import { z } from "zod"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

export const JimengJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JimengJsonValueSchema),
  z.record(z.string(), JimengJsonValueSchema),
]))

export const JimengJsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JimengJsonValueSchema)

export const JimengApiEnvelopeSchema = z.object({
  ret: z.union([z.string(), z.number()]).optional(),
  errmsg: z.string().optional(),
  data: JimengJsonValueSchema.optional().nullable(),
}).passthrough()

export type JimengApiEnvelope = z.infer<typeof JimengApiEnvelopeSchema>

export function parseJsonText(text: string, operation: string): JsonValue {
  try {
    return JimengJsonValueSchema.parse(JSON.parse(text))
  } catch (error) {
    const parsedError = error instanceof Error ? error : new Error(String(error))
    throw schemaError(operation, parsedError, "JIMENG_JSON_PARSE_FAILED", "Jimeng response was not valid JSON.")
  }
}

export function parseJimengApiEnvelope(body: JsonValue, operation: string): JimengApiEnvelope {
  try {
    return JimengApiEnvelopeSchema.parse(body)
  } catch (error) {
    const parsedError = error instanceof Error ? error : new Error(String(error))
    throw schemaError(operation, parsedError, "JIMENG_RESPONSE_ENVELOPE_CHANGED", "Jimeng response envelope did not match the required contract.")
  }
}

export function parseJimengDataMap(body: JsonValue, operation: string): JsonObject {
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)) {
    return envelope.data
  }
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_DATA_MAP_CHANGED",
    message: `${operation} response data was not an object map.`,
    retryable: false,
    details: { operation, data_kind: Array.isArray(envelope.data) ? "array" : typeof envelope.data },
  })
}

export function parseJimengContract<T>(schema: z.ZodType<T>, value: JsonValue, operation: string): T {
  try {
    return schema.parse(value)
  } catch (error) {
    const parsedError = error instanceof Error ? error : new Error(String(error))
    throw schemaError(operation, parsedError, "JIMENG_RESPONSE_CONTRACT_CHANGED", "Jimeng response contract did not match required fields.")
  }
}

function schemaError(operation: string, error: Error | z.ZodError, code: string, message: string) {
  return jimengError({
    category: "upstream",
    code,
    message: `${operation}: ${message}`,
    retryable: false,
    details: {
      operation,
      issues: error instanceof z.ZodError ? error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })) : [{ path: "", code: "json_parse", message: error.message }],
    },
  })
}
