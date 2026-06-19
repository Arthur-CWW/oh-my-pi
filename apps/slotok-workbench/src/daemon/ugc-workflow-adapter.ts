import type { AppendWorkflowEventInput, CreateWorkflowRunInput, UgcWorkflowEventType } from "../ugc/local-state"
import type { JsonValue } from "../renderer/ugcStudioModel"

export type SlotokWorkflowEventType = UgcWorkflowEventType
export type SlotokWorkflowEventInput = AppendWorkflowEventInput
export type SlotokWorkflowRunInput = CreateWorkflowRunInput & {
  readonly source: "dynamic-workflow"
  readonly scriptId: string
  readonly args: JsonValue
}

export interface SlotokWorkflowRunRecord {
  readonly id: string
}

export interface SlotokWorkflowTelemetryStore {
  createWorkflowRun(input: SlotokWorkflowRunInput): SlotokWorkflowRunRecord
  appendWorkflowEvent(runId: string, input: SlotokWorkflowEventInput): void
}

export interface SlotokWorkflowAgentStartEvent {
  readonly label: string
  readonly phase?: string
  readonly prompt: string
}

export interface SlotokWorkflowAgentEndEvent<TResult> {
  readonly label: string
  readonly phase?: string
  readonly result: TResult
}

export interface SlotokWorkflowCallbacks {
  readonly onLog: (message: string) => void
  readonly onPhase: (title: string) => void
  readonly onAgentStart: (event: SlotokWorkflowAgentStartEvent) => void
  readonly onAgentEnd: <TResult>(event: SlotokWorkflowAgentEndEvent<TResult>) => void
}

export interface SlotokWorkflowRegistrationInput<TArgs = JsonInput, TMetadata = JsonInput> {
  readonly title: string
  readonly scriptId: string
  readonly scriptPath?: string
  readonly workflowName?: string
  readonly lane?: string
  readonly currentPhase?: string
  readonly args?: TArgs
  readonly metadata?: TMetadata
}

type JsonInput =
  | JsonValue
  | Date
  | bigint
  | symbol
  | undefined
  | JsonInputFunction
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput }

type JsonInputFunction = (...args: readonly never[]) => JsonInput

const REDACTED_VALUE = "[redacted]"
const CIRCULAR_VALUE = "[circular]"
const UNREADABLE_VALUE = "[unreadable]"

export function registerSlotokWorkflowRun<TArgs, TMetadata>(
  store: Pick<SlotokWorkflowTelemetryStore, "createWorkflowRun">,
  input: SlotokWorkflowRegistrationInput<TArgs, TMetadata>,
): SlotokWorkflowRunRecord {
  return store.createWorkflowRun({
    title: input.title,
    source: "dynamic-workflow",
    scriptId: input.scriptId,
    args: toSlotokJsonValue({
      workflowName: input.workflowName ?? input.title,
      scriptId: input.scriptId,
      scriptPath: input.scriptPath ?? null,
      args: input.args ?? null,
      metadata: input.metadata ?? null,
    }),
    ...(input.lane ? { lane: input.lane } : {}),
    ...(input.currentPhase ? { currentPhase: input.currentPhase } : {}),
  })
}

export function createSlotokWorkflowCallbacks(
  store: Pick<SlotokWorkflowTelemetryStore, "appendWorkflowEvent">,
  runId: string,
): SlotokWorkflowCallbacks {
  return {
    onLog(message) {
      store.appendWorkflowEvent(runId, {
        type: "message",
        message,
        payload: toSlotokJsonValue({ message }),
      })
    },
    onPhase(title) {
      store.appendWorkflowEvent(runId, {
        type: "phase",
        phase: title,
        message: title,
        payload: toSlotokJsonValue({ phase: title }),
      })
    },
    onAgentStart(event) {
      store.appendWorkflowEvent(runId, {
        type: "started",
        phase: event.phase,
        agentLabel: event.label,
        message: `agent ${event.label} started`,
        payload: toSlotokJsonValue({
          kind: "agent-start",
          prompt: event.prompt,
        }),
      })
    },
    onAgentEnd(event) {
      store.appendWorkflowEvent(runId, {
        type: "message",
        phase: event.phase,
        agentLabel: event.label,
        message: `agent ${event.label} finished`,
        payload: toSlotokJsonValue({
          kind: "agent-end",
          resultJson: event.result,
        }),
      })
    },
  }
}

export function toSlotokJsonValue<TValue>(value: TValue): JsonValue {
  return toJsonValueInner(value, new WeakSet<object>(), null)
}

function toJsonValueInner<TValue>(value: TValue, seen: WeakSet<object>, key: string | null): JsonValue {
  if (key && isSensitiveJsonKey(key)) return REDACTED_VALUE

  if (value === null || value === undefined) return null

  if (typeof value === "string" || typeof value === "boolean") return value

  if (typeof value === "number") return Number.isFinite(value) ? value : null

  if (typeof value === "bigint") return `${value.toString()}n`

  if (typeof value === "symbol") return value.description ? `Symbol(${value.description})` : "Symbol()"

  if (typeof value === "function") return "[function]"

  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString() : null

  const objectValue = value as object
  if (seen.has(objectValue)) return CIRCULAR_VALUE
  seen.add(objectValue)

  if (Array.isArray(value)) {
    const result = value.map((item) => toJsonValueInner(item, seen, null))
    seen.delete(objectValue)
    return result
  }

  const record = objectValue as { readonly [key: string]: JsonInput }
  const result: Record<string, JsonValue> = {}
  for (const entryKey of Object.keys(record)) {
    try {
      result[entryKey] = toJsonValueInner(record[entryKey], seen, entryKey)
    } catch {
      result[entryKey] = UNREADABLE_VALUE
    }
  }
  seen.delete(objectValue)
  return result
}

function isSensitiveJsonKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  return normalized === "env"
    || normalized.endsWith("apikey")
    || normalized.endsWith("authorization")
    || normalized.endsWith("credential")
    || normalized.endsWith("credentials")
    || normalized.endsWith("password")
    || normalized.endsWith("secret")
    || normalized.endsWith("token")
}
