import type { AgentMessage } from "@oh-my-pi/pi-agent-core"
import { Effect, Stream } from "effect"
import * as path from "node:path"
import {
  DEFAULT_REDACTION_POLICY,
  ReplayTraceIntegrityError,
  decodeReplayCheckpoint,
  decodeReplayTraceEvent,
  loadCassette,
  makeReplayProvider,
  requestIdentity,
  sealCassette,
  sealReplayTrace,
  sha256Hex,
  stableJson,
  writeSealedCassette,
  type DifferentialReplayAdapter,
  type JsonValue,
  type ProviderService,
  type ReplayCheckpoint,
  type ReplayTraceEnvelope,
  type ReplayTraceEvent,
  type TimedProviderEvent,
} from "../../../../../../packages/provider-testkit/src/index"
import {
  appendChildLifecycleRecord,
  appendChildRestartRecord,
  isTerminalChildLifecycleState,
  latestChildLifecycleRecord,
  latestChildRestartRecord,
  type ChildFailureClass,
  type ChildLifecycleState,
  type ChildRestartRecord,
  type ChildResumeDisposition,
} from "../../src/task/child-lifecycle"
import { SessionManager } from "../../src/session/session-manager"

const CHILD_STATES: Record<string, true> = {
  running: true,
  "waiting-provider": true,
  idle: true,
  parked: true,
  completed: true,
  failed: true,
  interrupted: true,
}
const FAILURE_CLASSES: Record<string, true> = {
  wall_timeout: true,
  subprocess_abort: true,
  transient_host_resource: true,
  lost_transcript: true,
  fatal: true,
}
const RESUME_DISPOSITIONS: Record<string, true> = { resumable: true, unrecoverable: true }
const RESTART_STATES: Record<string, true> = { running: true, parked: true }

interface ReplayMessageObservation {
  readonly role: "user" | "assistant" | "toolResult"
  readonly text: string
}

interface LifecycleObservation {
  readonly entityId: string
  readonly state: string
  readonly failureClass?: string
  readonly resumeDisposition?: string
}

interface RestartObservation {
  readonly entityId: string
  readonly state: string
  readonly status: string
  readonly attemptId?: string
}

export interface OmpReplayObservation {
  readonly messages: readonly ReplayMessageObservation[]
  readonly lifecycle: LifecycleObservation | null
  readonly restart: RestartObservation | null
  readonly terminal: boolean
  readonly reopens: number
}

export interface LoadedOmpReplayFixture {
  readonly trace: ReplayTraceEnvelope
  readonly sourceBytes: string
}

export type OmpReplayMutant = "none" | "wrong-restart-order"

type ProviderReplayEvent = Extract<ReplayTraceEvent, { readonly type: "provider" }>
type CodingStopReason = "stop" | "length" | "toolUse" | "error"
type ReplayableMessage = Extract<AgentMessage, { readonly role: "user" | "assistant" | "toolResult" }>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const optionalString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

const replayMessageTimestamp = (at: string | undefined, eventIndex: number): number => {
  if (at === undefined) return eventIndex
  const timestamp = Date.parse(at)
  if (!Number.isFinite(timestamp)) {
    throw new ReplayTraceIntegrityError("invalidTrace", `event ${eventIndex} timestamp is not finite`)
  }
  return timestamp
}

const replayEventFromSource = (record: Record<string, unknown>): ReplayTraceEvent => {
  if (record.type === "message" && isRecord(record.message)) {
    const message = record.message
    if (message.role === "user") {
      return decodeReplayTraceEvent({
        type: "user",
        content: message.content,
        ...(typeof record.timestamp === "string" ? { at: record.timestamp } : {}),
      })
    }
    if (message.role === "toolResult") {
      return decodeReplayTraceEvent({
        type: "tool",
        callId: message.toolCallId,
        name: message.toolName,
        result: message.content,
        ...(typeof message.isError === "boolean" ? { isError: message.isError } : {}),
        ...(typeof record.timestamp === "string" ? { at: record.timestamp } : {}),
      })
    }
  }

  if (record.type === "provider_replay" && isRecord(record.response)) {
    return decodeReplayTraceEvent({
      type: "provider",
      request: record.request,
      ...(record.variant === undefined ? {} : { variant: record.variant }),
      ...(record.attempt === undefined ? {} : { attempt: record.attempt }),
      expectedText: record.response.text,
      expectedStopReason: record.response.stopReason,
      expectedUsage: record.response.usage,
    })
  }

  if (record.type === "custom" && typeof record.customType === "string" && isRecord(record.data)) {
    const data = record.data
    if (record.customType === "child_lifecycle") {
      if (data.state === "completed" || data.state === "failed" || data.state === "interrupted") {
        return decodeReplayTraceEvent({
          type: "terminal",
          entityId: data.agentId,
          outcome: data.state,
          at: data.updatedAt,
          ...(typeof data.failureClass === "string" ? { failureClass: data.failureClass } : {}),
          ...(typeof data.resumeDisposition === "string" ? { resumeDisposition: data.resumeDisposition } : {}),
        })
      }
      return decodeReplayTraceEvent({
        type: "lifecycle",
        entityId: data.agentId,
        state: data.state,
        at: data.updatedAt,
        ...(typeof data.modelId === "string" ? { modelId: data.modelId } : {}),
        ...(typeof data.thinkingLevel === "string" || data.thinkingLevel === null
          ? { thinkingLevel: data.thinkingLevel }
          : {}),
        ...(typeof data.failureClass === "string" ? { failureClass: data.failureClass } : {}),
        ...(typeof data.resumeDisposition === "string" ? { resumeDisposition: data.resumeDisposition } : {}),
      })
    }
    if (record.customType === "child_restart") {
      return decodeReplayTraceEvent({
        type: "restart",
        entityId: data.agentId,
        predecessorEpoch: data.predecessorOwnerEpoch,
        state: data.state,
        queueCheckpoint: data.queueCheckpoint,
        attemptId: data.attemptId,
        at: data.updatedAt,
      })
    }
    return decodeReplayTraceEvent({ type: "unknown", originalType: `custom:${record.customType}`, payload: data })
  }

  return decodeReplayTraceEvent({
    type: "unknown",
    originalType: typeof record.type === "string" ? record.type : "invalid-source-record",
    payload: record,
  })
}

export const loadOmpReplayFixture = async (fixturePath: string): Promise<LoadedOmpReplayFixture> => {
  const sourceBytes = await Bun.file(fixturePath).text()
  const events: ReplayTraceEvent[] = []
  const checkpoints: ReplayCheckpoint[] = []

  for (const [lineIndex, line] of sourceBytes.trimEnd().split("\n").entries()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`fixture line ${lineIndex + 1} is not JSON`)
    }
    if (!isRecord(parsed)) throw new Error(`fixture line ${lineIndex + 1} is not an object`)
    if (parsed.type === "checkpoint") {
      checkpoints.push(
        decodeReplayCheckpoint({
          id: parsed.id,
          afterEvent: events.length - 1,
          ...(parsed.reopen === true ? { reopen: true } : {}),
          ...(Array.isArray(parsed.invariants) ? { invariants: parsed.invariants } : {}),
        }),
      )
      continue
    }
    events.push(replayEventFromSource(parsed))
  }

  return {
    sourceBytes,
    trace: sealReplayTrace({
      traceId: "omp-sanitized-child-session",
      sourceDigest: sha256Hex(sourceBytes),
      seed: 271828,
      events,
      checkpoints,
    }),
  }
}

const providerFrames = (event: ProviderReplayEvent, interactionIndex: number): readonly TimedProviderEvent[] => [
  { seq: 0, elapsedMs: 0, event: { type: "response.started", responseId: `fixture-${interactionIndex}` } },
  { seq: 1, elapsedMs: 1, event: { type: "text.delta", text: event.expectedText } },
  {
    seq: 2,
    elapsedMs: 2,
    event: {
      type: "response.completed",
      stopReason: event.expectedStopReason,
      usage: event.expectedUsage,
    },
  },
]

const createSealedReplayProvider = async (
  trace: ReplayTraceEnvelope,
  cassetteDirectory: string,
): Promise<ProviderService> => {
  const providerEvents = trace.events.filter((event): event is ProviderReplayEvent => event.type === "provider")
  const interactions = providerEvents.map((event, index) => {
    const identity = requestIdentity(event.request)
    return {
      interactionId: `provider-${index}`,
      requestDigest: identity.requestDigest,
      componentDigests: identity.componentDigests,
      variant: event.variant ?? "default",
      attempt: event.attempt ?? 1,
      frames: providerFrames(event, index),
    }
  })
  const sealed = await Effect.runPromise(
    sealCassette({
      cassetteId: "omp-differential-replay",
      interactions,
      policy: DEFAULT_REDACTION_POLICY,
      createdAt: "2026-07-27T00:00:00.000Z",
    }),
  )
  await Effect.runPromise(writeSealedCassette(cassetteDirectory, sealed))
  const cassette = await Effect.runPromise(loadCassette(cassetteDirectory))
  return makeReplayProvider(cassette)
}

const resultText = (value: JsonValue): string => (typeof value === "string" ? value : stableJson(value))

const messageText = (message: ReplayableMessage): string => {
  if (typeof message.content === "string") return message.content
  const text: string[] = []
  for (const part of message.content) {
    if (part.type === "text") text.push(part.text)
  }
  return text.join("")
}

const codingStopReason = (reason: ProviderReplayEvent["expectedStopReason"]): CodingStopReason => {
  switch (reason) {
    case "stop":
    case "length":
    case "toolUse":
      return reason
    case "contentFilter":
      return "error"
  }
}

const childState = (state: string): ChildLifecycleState => {
  if (!(state in CHILD_STATES)) throw new Error(`unsupported child lifecycle state ${state}`)
  return state as ChildLifecycleState
}

const failureClass = (value: string | undefined): ChildFailureClass | undefined => {
  if (value === undefined) return undefined
  if (!(value in FAILURE_CLASSES)) throw new Error(`unsupported child failure class ${value}`)
  return value as ChildFailureClass
}

const resumeDisposition = (value: string | undefined): ChildResumeDisposition | undefined => {
  if (value === undefined) return undefined
  if (!(value in RESUME_DISPOSITIONS)) throw new Error(`unsupported child resume disposition ${value}`)
  return value as ChildResumeDisposition
}

export class OmpReplayCandidateAdapter implements DifferentialReplayAdapter<OmpReplayObservation> {
  #manager: SessionManager
  #reopens = 0

  constructor(
    manager: SessionManager,
    readonly provider: ProviderService,
    readonly parentSessionFile: string,
    readonly mutant: OmpReplayMutant,
  ) {
    this.#manager = manager
  }

  async apply(event: ReplayTraceEvent, eventIndex: number): Promise<void> {
    switch (event.type) {
      case "user":
        this.#manager.appendMessage({
          role: "user",
          content: event.content,
          timestamp: replayMessageTimestamp(event.at, eventIndex),
        })
        return
      case "provider": {
        const frames = Array.from(
          await Effect.runPromise(
            Stream.runCollect(this.provider.stream(event.request, { variant: event.variant, attempt: event.attempt })),
          ),
        )
        let text = ""
        let stopReason: CodingStopReason = "error"
        let usage = { inputTokens: 0, outputTokens: 0 }
        for (const frame of frames) {
          if (frame.event.type === "text.delta") text += frame.event.text
          if (frame.event.type === "response.completed") {
            stopReason = codingStopReason(frame.event.stopReason)
            usage = frame.event.usage
          }
        }
        this.#manager.appendMessage({
          role: "assistant",
          content: [{ type: "text", text }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: event.request.route.model,
          usage: {
            input: usage.inputTokens,
            output: usage.outputTokens,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: usage.inputTokens + usage.outputTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason,
          timestamp: eventIndex,
        })
        return
      }
      case "tool":
        this.#manager.appendMessage({
          role: "toolResult",
          toolCallId: event.callId,
          toolName: event.name,
          content: [{ type: "text", text: resultText(event.result) }],
          isError: event.isError ?? false,
          timestamp: replayMessageTimestamp(event.at, eventIndex),
        })
        return
      case "lifecycle": {
        const sessionFile = this.#manager.getSessionFile()
        if (sessionFile === undefined) throw new Error("persistent replay session has no journal path")
        appendChildLifecycleRecord(this.#manager, {
          version: 1,
          agentId: event.entityId,
          childSessionFile: sessionFile,
          parentSessionFile: this.parentSessionFile,
          state: childState(event.state),
          updatedAt: event.at,
          ...(event.modelId === undefined ? {} : { modelId: event.modelId }),
          ...(event.thinkingLevel === undefined ? {} : { thinkingLevel: event.thinkingLevel }),
          ...(failureClass(event.failureClass) === undefined ? {} : { failureClass: failureClass(event.failureClass) }),
          ...(resumeDisposition(event.resumeDisposition) === undefined
            ? {}
            : { resumeDisposition: resumeDisposition(event.resumeDisposition) }),
        })
        return
      }
      case "restart": {
        if (!(event.state in RESTART_STATES)) throw new Error(`unsupported restart state ${event.state}`)
        const records: ChildRestartRecord[] = [
          {
            version: 1,
            agentId: event.entityId,
            predecessorOwnerEpoch: event.predecessorEpoch,
            state: event.state as "running" | "parked",
            queueCheckpoint: event.queueCheckpoint,
            status: "pending",
            updatedAt: event.at,
          },
          {
            version: 1,
            agentId: event.entityId,
            predecessorOwnerEpoch: event.predecessorEpoch,
            state: event.state as "running" | "parked",
            queueCheckpoint: event.queueCheckpoint,
            status: "resuming",
            attemptId: event.attemptId,
            updatedAt: event.at,
          },
          {
            version: 1,
            agentId: event.entityId,
            predecessorOwnerEpoch: event.predecessorEpoch,
            state: event.state as "running" | "parked",
            queueCheckpoint: event.queueCheckpoint,
            status: "resumed",
            attemptId: event.attemptId,
            updatedAt: event.at,
          },
        ]
        const ordered = this.mutant === "wrong-restart-order" ? records.toReversed() : records
        for (const record of ordered) appendChildRestartRecord(this.#manager, record)
        return
      }
      case "terminal": {
        const current = latestChildLifecycleRecord(this.#manager.getEntries())
        if (current && isTerminalChildLifecycleState(current.state)) return
        const sessionFile = this.#manager.getSessionFile()
        if (sessionFile === undefined) throw new Error("persistent replay session has no journal path")
        appendChildLifecycleRecord(this.#manager, {
          version: 1,
          agentId: event.entityId,
          childSessionFile: sessionFile,
          parentSessionFile: this.parentSessionFile,
          state: event.outcome,
          updatedAt: event.at,
          ...(failureClass(event.failureClass) === undefined ? {} : { failureClass: failureClass(event.failureClass) }),
          ...(resumeDisposition(event.resumeDisposition) === undefined
            ? {}
            : { resumeDisposition: resumeDisposition(event.resumeDisposition) }),
        })
        return
      }
      case "unknown":
        throw new Error("the runner must resolve unknown events before the OMP adapter")
    }
  }

  async reopen(): Promise<void> {
    const sessionFile = this.#manager.getSessionFile()
    if (sessionFile === undefined) throw new Error("persistent replay session has no journal path")
    await this.#manager.ensureOnDisk()
    await this.#manager.flush()
    await this.#manager.close()
    this.#manager = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true })
    this.#reopens += 1
  }

  observe(): OmpReplayObservation {
    const entries = this.#manager.getEntries()
    const messages: ReplayMessageObservation[] = []
    for (const entry of entries) {
      if (entry.type !== "message") continue
      const message = entry.message
      if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue
      messages.push({ role: message.role, text: messageText(message) })
    }

    const lifecycleRecord = latestChildLifecycleRecord(entries)
    if (lifecycleRecord === null) throw new Error("real lifecycle projection rejected the replay journal")
    const lifecycle =
      lifecycleRecord === undefined
        ? null
        : {
            entityId: lifecycleRecord.agentId,
            state: lifecycleRecord.state,
            ...(lifecycleRecord.failureClass === undefined ? {} : { failureClass: lifecycleRecord.failureClass }),
            ...(lifecycleRecord.resumeDisposition === undefined
              ? {}
              : { resumeDisposition: lifecycleRecord.resumeDisposition }),
          }

    const restartRecord = latestChildRestartRecord(entries)
    if (restartRecord === null) throw new Error("real restart projection rejected the replay journal")
    const restart =
      restartRecord === undefined
        ? null
        : {
            entityId: restartRecord.agentId,
            state: restartRecord.state,
            status: restartRecord.status,
            ...(restartRecord.attemptId === undefined ? {} : { attemptId: restartRecord.attemptId }),
          }

    return {
      messages,
      lifecycle,
      restart,
      terminal: lifecycle === null ? false : isTerminalChildLifecycleState(lifecycle.state as ChildLifecycleState),
      reopens: this.#reopens,
    }
  }

  async close(): Promise<void> {
    await this.#manager.close()
  }
}

export class OmpReplayReferenceAdapter implements DifferentialReplayAdapter<OmpReplayObservation> {
  readonly messages: ReplayMessageObservation[] = []
  lifecycle: LifecycleObservation | null = null
  restart: RestartObservation | null = null
  terminal = false
  reopens = 0

  apply(event: ReplayTraceEvent): void {
    switch (event.type) {
      case "user":
        this.messages.push({ role: "user", text: event.content })
        return
      case "provider":
        this.messages.push({ role: "assistant", text: event.expectedText })
        return
      case "tool":
        this.messages.push({ role: "toolResult", text: resultText(event.result) })
        return
      case "lifecycle":
        this.lifecycle = {
          entityId: event.entityId,
          state: event.state,
          ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }),
          ...(event.resumeDisposition === undefined ? {} : { resumeDisposition: event.resumeDisposition }),
        }
        return
      case "restart":
        this.restart = {
          entityId: event.entityId,
          state: event.state,
          status: "resumed",
          attemptId: event.attemptId,
        }
        return
      case "terminal":
        this.lifecycle = {
          entityId: event.entityId,
          state: event.outcome,
          ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }),
          ...(event.resumeDisposition === undefined ? {} : { resumeDisposition: event.resumeDisposition }),
        }
        this.terminal = true
        return
      case "unknown":
        throw new Error("the runner must resolve unknown events before the reference reducer")
    }
  }

  reopen(): void {
    this.reopens += 1
  }

  observe(): OmpReplayObservation {
    return {
      messages: [...this.messages],
      lifecycle: this.lifecycle,
      restart: this.restart,
      terminal: this.terminal,
      reopens: this.reopens,
    }
  }
}

export const createOmpReplayCandidate = async (
  trace: ReplayTraceEnvelope,
  root: string,
  mutant: OmpReplayMutant = "none",
): Promise<OmpReplayCandidateAdapter> => {
  const provider = await createSealedReplayProvider(trace, path.join(root, "cassette"))
  const manager = SessionManager.create(root, path.join(root, "sessions"))
  return new OmpReplayCandidateAdapter(manager, provider, path.join(root, "parent.jsonl"), mutant)
}

export const canonicalizeOmpObservation = (observation: OmpReplayObservation): JsonValue => ({
  messages: observation.messages.map(message => ({ role: message.role, text: message.text })),
  lifecycle:
    observation.lifecycle === null
      ? null
      : {
          entityId: observation.lifecycle.entityId,
          state: observation.lifecycle.state,
          failureClass: observation.lifecycle.failureClass ?? null,
          resumeDisposition: observation.lifecycle.resumeDisposition ?? null,
        },
  restart:
    observation.restart === null
      ? null
      : {
          entityId: observation.restart.entityId,
          state: observation.restart.state,
          status: observation.restart.status,
          attemptId: observation.restart.attemptId ?? null,
        },
  terminal: observation.terminal,
  reopens: observation.reopens,
})
