import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Schema } from "effect"

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const JsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend((): Schema.Codec<JsonValue> =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record(Schema.String, JsonValueSchema),
  ]),
)

export const KnownOutboxKindSchema = Schema.Union([
  Schema.Literal("session"),
  Schema.Literal("branch"),
  Schema.Literal("turn"),
  Schema.Literal("event"),
  Schema.Literal("modelCall"),
  Schema.Literal("providerCall"),
  Schema.Literal("artifact"),
])
export type KnownOutboxKind = Schema.Schema.Type<typeof KnownOutboxKindSchema>

export const OutboxEnvelopeSchema = Schema.Struct({
  v: Schema.Number,
  kind: Schema.String,
  sessionId: Schema.String,
  seq: Schema.Number,
  ts: Schema.Number,
  payload: JsonValueSchema,
})
export type OutboxEnvelope = Schema.Schema.Type<typeof OutboxEnvelopeSchema>

export function appendOutboxLine(filePath: string, envelope: OutboxEnvelope): void {
  mkdirSync(dirname(filePath), { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(envelope)}\n`, "utf8")
}

export function outboxPathFor(sessionId: string, dir: string = defaultOutboxDir()): string {
  return join(dir, `${encodeURIComponent(sessionId)}.jsonl`)
}

export function defaultOutboxDir(env: Record<string, string | undefined> = process.env): string {
  return env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] ?? join(homedir(), ".agent-control-plane", "outbox")
}
