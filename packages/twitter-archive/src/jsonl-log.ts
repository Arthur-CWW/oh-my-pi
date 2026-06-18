import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { Effect, Schema } from "effect"

export type JsonlLogLevel = "debug" | "info" | "warn" | "error"
export type JsonlLogScalar = string | number | boolean | null
export type JsonlLogValue = JsonlLogScalar | readonly JsonlLogValue[] | { readonly [key: string]: JsonlLogValue }
export type JsonlLogDetails = { readonly [key: string]: JsonlLogValue }

export interface TwitterArchiveLogEventInput {
  readonly component: string
  readonly level: JsonlLogLevel
  readonly event: string
  readonly runId?: string
  readonly jobId?: string
  readonly details?: JsonlLogDetails
}

export interface TwitterArchiveLogEvent extends TwitterArchiveLogEventInput {
  readonly timestamp: string
  readonly details: JsonlLogDetails
}

export class JsonlLogWriteError extends Schema.TaggedErrorClass<JsonlLogWriteError>()("JsonlLogWriteError", {
  logPath: Schema.String,
  message: Schema.String,
}) {}

export function makeTwitterArchiveLogEvent(input: TwitterArchiveLogEventInput, now: Date = new Date()): TwitterArchiveLogEvent {
  return {
    timestamp: now.toISOString(),
    component: input.component,
    level: input.level,
    event: input.event,
    runId: input.runId,
    jobId: input.jobId,
    details: input.details ?? {},
  }
}

export async function appendTwitterArchiveJsonlLog(
  logPath: string,
  input: TwitterArchiveLogEventInput,
): Promise<TwitterArchiveLogEvent> {
  const event = makeTwitterArchiveLogEvent(input)
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8")
  return event
}

export const appendTwitterArchiveJsonlLogEffect = Effect.fn("appendTwitterArchiveJsonlLogEffect")(function*(
  logPath: string,
  input: TwitterArchiveLogEventInput,
) {
  return yield* Effect.tryPromise({
    try: () => appendTwitterArchiveJsonlLog(logPath, input),
    catch: (error) => new JsonlLogWriteError({ logPath, message: error instanceof Error ? error.message : String(error) }),
  })
})

