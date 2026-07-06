import { existsSync, readFileSync } from "node:fs"

import { appendOutboxLine, outboxPathFor, type JsonValue, type KnownOutboxKind } from "./outbox"
import type {
  AssistantMessage,
  BeforeProviderRequestPayload,
  ExtensionContextLike,
  MessageEndPayload,
  MessageStartPayload,
  OmpTimestamp,
  PiLike,
  SessionBranchPayload,
  SessionShutdownPayload,
  SessionStartPayload,
  SessionSwitchPayload,
  TurnPayload,
} from "./omp-events"

interface SessionState {
  readonly sessionId: string
  readonly sessionFile: string
  readonly outboxPath: string
  nextSeq: number
  latestProviderRequest?: CapturedProviderRequest
  readonly turnStarts: Map<number, TurnStartSnapshot>
  readonly pendingAttributions: Map<string, PendingAttribution>
}

interface CapturedProviderRequest {
  readonly branchId?: string
  readonly provider?: string
  readonly model?: string
  readonly api?: string
  readonly payload: JsonValue
  readonly rawRequestSupport: "captured" | "unsupported"
}

interface TurnStartSnapshot {
  readonly startedAt: number
  readonly contextTokens: number
  readonly toolCalls: number
  readonly toolCallSummary?: JsonValue
  readonly editBytes: number
  readonly yieldKind?: string
}

interface PendingAttribution {
  readonly modelCallId: string
  readonly messageTimestamp: number
  readonly attribution: string
  readonly probes: number
}

const ATTRIBUTION_ENTRY_TAIL = 20
const MAX_PENDING_ATTRIBUTIONS = 20

type JsonRecord = { [key: string]: JsonValue }
type LooseJsonRecord = { [key: string]: JsonValue | undefined }

type PayloadBuilder = (seq: number) => JsonValue

export default function createOmpPublisher(pi: PiLike): void {
  const publisher = new OmpOutboxPublisher()

  pi.on("session_start", publisher.guard((event, ctx) => publisher.onSessionStart(event, ctx)))
  pi.on("turn_start", publisher.guard((event, ctx) => publisher.onTurn("start", event, ctx)))
  pi.on("before_provider_request", publisher.guard((event, ctx) => publisher.onBeforeProviderRequest(event, ctx)))
  pi.on("message_end", publisher.guard((event, ctx) => publisher.onMessageEnd(event, ctx)))
  pi.on("message_start", publisher.guard((event, ctx) => publisher.onMessageStart(event, ctx)))
  pi.on("turn_end", publisher.guard((event, ctx) => publisher.onTurn("end", event, ctx)))
  pi.on("session_switch", publisher.guard((event, ctx) => publisher.onSessionSwitch(event, ctx)))
  pi.on("session_branch", publisher.guard((event, ctx) => publisher.onSessionBranch(event, ctx)))
  pi.on("session_shutdown", publisher.guard((event, ctx) => publisher.onSessionShutdown(event, ctx)))
}

class OmpOutboxPublisher {
  private readonly sessions = new Map<string, SessionState>()
  private currentSessionId: string | undefined

  guard<E>(handler: (event: E, ctx: ExtensionContextLike) => void): (event: E, ctx: ExtensionContextLike) => void {
    return (event, ctx) => {
      try {
        handler(event, ctx)
      } catch (cause) {
        try {
          this.appendPublisherError(ctx, cause as Error | object | string | number | boolean | symbol | bigint | null | undefined)
        } catch {
          // Never throw into the OMP harness. If the error outbox append also fails,
          // the publisher has no safer local durability sink.
        }
      }
    }
  }

  onSessionStart(event: SessionStartPayload, ctx: ExtensionContextLike): void {
    const state = this.stateForContext(ctx)
    const ts = timestampMillis(event.timestamp)
    const workspace = event.workspace ?? ctx.cwd ?? ""
    const meta = compactJson({ sessionFile: state.sessionFile, parentSession: event.parentSession })

    this.append(state, "session", ts, () => ({
      id: state.sessionId,
      machine: event.machine ?? "unknown",
      harness: "omp",
      workspace,
      title: event.title ?? "",
      status: "running",
      createdAt: ts,
      updatedAt: ts,
      meta: JSON.stringify(meta),
    }))

    this.appendEvent(state, ts, undefined, "session_start", {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      workspace,
      parentSession: event.parentSession ?? null,
    })
  }

  onTurn(phase: "start" | "end", event: TurnPayload, ctx: ExtensionContextLike): void {
    const state = this.stateForContext(ctx)
    const branchId = event.branchId ?? "root"
    const turnOrdinal = event.seq ?? event.turnIndex ?? 0
    const toolCallSummary = event.toolCallSummary ?? (event.toolResults === undefined ? undefined : { toolResults: event.toolResults })

    if (phase === "start") {
      const startedAt = timestampMillis(event.startedAt ?? event.timestamp)
      state.turnStarts.set(turnOrdinal, {
        startedAt,
        contextTokens: event.contextTokens ?? event.message?.usage?.totalTokens ?? 0,
        toolCalls: event.toolCalls ?? event.toolResults?.length ?? 0,
        toolCallSummary,
        editBytes: event.editBytes ?? 0,
        yieldKind: event.yieldKind,
      })
      this.appendEvent(state, startedAt, event.branchId, "turn_start", {
        turnIndex: turnOrdinal,
        branchId,
        contextTokens: event.contextTokens ?? event.message?.usage?.totalTokens ?? 0,
        toolCalls: event.toolCalls ?? event.toolResults?.length ?? 0,
      })
      return
    }

    const start = state.turnStarts.get(turnOrdinal)
    const endedAt = timestampMillis(event.endedAt ?? event.timestamp ?? event.message?.timestamp)
    const duration = event.turnDurationMs ?? event.duration ?? event.message?.duration ?? 0
    const summary = toolCallSummary ?? start?.toolCallSummary
    const startedAt = event.startedAt === undefined ? start?.startedAt ?? endedAt : timestampMillis(event.startedAt)
    state.turnStarts.delete(turnOrdinal)

    this.append(state, "turn", endedAt, () => compactJson({
      id: `${state.sessionId}:turn:${turnOrdinal}`,
      sessionId: state.sessionId,
      branchId,
      seq: turnOrdinal,
      startedAt,
      endedAt,
      contextTokens: event.contextTokens ?? start?.contextTokens ?? event.message?.usage?.totalTokens ?? 0,
      toolCalls: event.toolCalls ?? event.toolResults?.length ?? start?.toolCalls ?? 0,
      toolCallSummary: summary === undefined ? undefined : JSON.stringify(summary),
      editBytes: event.editBytes ?? start?.editBytes ?? 0,
      turnDurationMs: duration,
      yieldKind: event.yieldKind ?? start?.yieldKind ?? event.message?.stopReason ?? "unknown",
    }))
    this.resolveAttributionBackfill(state, ctx, endedAt)
  }

  onMessageStart(event: MessageStartPayload, ctx: ExtensionContextLike): void {
    const state = this.stateForContext(ctx)
    this.resolveAttributionBackfill(state, ctx, timestampMillis(event.timestamp))
  }

  onBeforeProviderRequest(event: BeforeProviderRequestPayload, ctx: ExtensionContextLike): void {
    const state = this.stateForContext(ctx)
    state.latestProviderRequest = {
      branchId: event.branchId,
      provider: event.provider,
      model: event.model,
      api: event.api,
      payload: event.payload ?? null,
      rawRequestSupport: event.payload === undefined ? "unsupported" : "captured",
    }
  }

  onMessageEnd(event: MessageEndPayload, ctx: ExtensionContextLike): void {
    if (event.message.role !== undefined && event.message.role !== "assistant") {
      return
    }

    const state = this.stateForContext(ctx)
    const message = event.message
    const usage = message.usage
    const captured = state.latestProviderRequest
    const branchId = event.branchId ?? captured?.branchId ?? "root"
    const ts = timestampMillis(message.timestamp ?? event.timestamp)
    const provider = message.provider ?? captured?.provider ?? message.upstreamProvider ?? "unknown"
    const model = message.model ?? captured?.model ?? "unknown"
    const attribution = attributionString(provider, model, message.thinkingLevel)
    const modelCallId = `${state.sessionId}:modelCall:${state.nextSeq}`
    const rawRequestSupport = captured?.rawRequestSupport ?? "unsupported"
    const rawRequest = captured?.payload ?? null
    state.latestProviderRequest = undefined

    this.append(state, "modelCall", ts, () => compactJson({
      id: modelCallId,
      ts,
      machine: "unknown",
      session: state.sessionId,
      sessionId: state.sessionId,
      branchId,
      agent: "omp",
      api: message.api ?? captured?.api ?? "unknown",
      model,
      provider,
      upstreamProvider: message.upstreamProvider,
      attribution,
      effort: "unknown",
      promptHash: "unknown",
      systemPromptHash: "unknown",
      skillProfile: "unknown",
      contextManifest: "unknown",
      packetId: "",
      tokensIn: usage?.input ?? 0,
      tokensOut: usage?.output ?? 0,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      premiumRequests: usage?.premiumRequests ?? 0,
      cost: usage?.cost ?? 0,
      latencyMs: message.duration ?? 0,
      ttftMs: message.ttft ?? 0,
      outcome: outcomeFor(message),
      errorClass: errorClassFor(message),
      errorMessage: message.errorMessage,
      stopReason: message.stopReason,
      stopDetails: message.stopDetails,
      retryOf: undefined,
      fallbackFrom: undefined,
      rawRequestArtifact: "",
      rawResponseArtifact: "",
      rawRequestSupport,
      rawRequest,
    }))
    this.cacheAttribution(state, ts, {
      modelCallId,
      messageTimestamp: ts,
      attribution,
      probes: 0,
    })
  }

  onSessionSwitch(event: SessionSwitchPayload, ctx: ExtensionContextLike): void {
    const state = this.stateForContext(ctx)
    const ts = timestampMillis(event.timestamp)
    const reason = event.reason ?? "unknown"

    if (reason === "fork" || reason === "resume") {
      this.appendBranch(state, ts, event.branchId, reason, {
        reason,
        previousSessionId: event.previousSessionId ?? null,
        previousSessionFile: event.previousSessionFile ?? null,
        parentSession: event.parentSession ?? null,
      })
    }

    this.appendEvent(state, ts, event.branchId, "session_switch", {
      reason,
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      previousSessionId: event.previousSessionId ?? null,
      previousSessionFile: event.previousSessionFile ?? null,
      parentSession: event.parentSession ?? null,
    })
  }

  onSessionBranch(event: SessionBranchPayload, ctx: ExtensionContextLike): void {
    const state = this.stateForContext(ctx)
    const ts = timestampMillis(event.timestamp)
    const branchId = event.branchId

    this.appendBranch(state, ts, branchId, "branch", {
      sourceSessionId: event.sourceSessionId ?? null,
      sourceSessionFile: event.sourceSessionFile ?? event.previousSessionFile ?? null,
      parentSession: event.parentSession ?? null,
      leafId: event.leafId ?? null,
    })

    this.appendEvent(state, ts, branchId, "session_branch", {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      sourceSessionId: event.sourceSessionId ?? null,
      sourceSessionFile: event.sourceSessionFile ?? event.previousSessionFile ?? null,
      parentSession: event.parentSession ?? null,
      leafId: event.leafId ?? null,
    })
  }

  onSessionShutdown(event: SessionShutdownPayload, ctx: ExtensionContextLike): void {
    const state = this.stateForContext(ctx)
    const ts = timestampMillis(event.timestamp)
    this.resolveAttributionBackfill(state, ctx, ts)
    this.appendEvent(state, ts, undefined, "session_shutdown", {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      reason: event.reason ?? null,
    })
  }

  private stateForContext(ctx: ExtensionContextLike): SessionState {
    const sessionId = ctx.sessionManager.getSessionId()
    const sessionFile = ctx.sessionManager.getSessionFile()
    this.currentSessionId = sessionId

    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) {
      return existing
    }

    const outboxPath = outboxPathFor(sessionId)
    const state: SessionState = {
      sessionId,
      sessionFile,
      outboxPath,
      nextSeq: countExistingOutboxLines(outboxPath),
      turnStarts: new Map(),
      pendingAttributions: new Map(),
    }
    this.sessions.set(sessionId, state)
    return state
  }

  private append(state: SessionState, kind: KnownOutboxKind, ts: number, buildPayload: PayloadBuilder): void {
    const seq = state.nextSeq
    appendOutboxLine(state.outboxPath, {
      v: 1,
      kind,
      sessionId: state.sessionId,
      seq,
      ts,
      payload: buildPayload(seq),
    })
    state.nextSeq = seq + 1
  }

  private appendBranch(state: SessionState, ts: number, branchId: string | undefined, kind: string, meta: JsonRecord): void {
    this.append(state, "branch", ts, (seq) => compactJson({
      id: branchId ?? `${state.sessionId}:branch:${seq}`,
      sessionId: state.sessionId,
      parentBranchId: typeof meta.parentBranchId === "string" ? meta.parentBranchId : undefined,
      kind,
      atTurn: typeof meta.atTurn === "number" ? meta.atTurn : undefined,
      createdAt: ts,
      meta: JSON.stringify(meta),
    }))
  }

  private appendEvent(state: SessionState, ts: number, branchId: string | undefined, kind: string, payload: JsonValue): void {
    this.append(state, "event", ts, (seq) => compactJson({
      id: `${state.sessionId}:${seq}`,
      ts,
      sessionId: state.sessionId,
      seq,
      branchId,
      kind,
      payloadVersion: 1,
      payload,
    }))
  }

  private cacheAttribution(state: SessionState, ts: number, pending: PendingAttribution): void {
    state.pendingAttributions.set(pending.modelCallId, pending)
    while (state.pendingAttributions.size > MAX_PENDING_ATTRIBUTIONS) {
      for (const [modelCallId] of state.pendingAttributions) {
        state.pendingAttributions.delete(modelCallId)
        this.appendEvent(state, ts, undefined, "attributionMiss", {
          modelCallId,
          reason: "cacheLimitExceeded",
        })
        break
      }
    }
  }

  private resolveAttributionBackfill(state: SessionState, ctx: ExtensionContextLike, ts: number): void {
    if (state.pendingAttributions.size === 0 || ctx.sessionManager.getEntries === undefined) {
      return
    }

    const entries = ctx.sessionManager.getEntries()
    const firstTailIndex = Math.max(0, entries.length - ATTRIBUTION_ENTRY_TAIL)

    for (const [modelCallId, pending] of state.pendingAttributions) {
      let entryId: string | undefined
      for (let index = entries.length - 1; index >= firstTailIndex; index -= 1) {
        const entry = entries[index]
        if (entry !== undefined && entry.message?.role === "assistant" && entry.message.timestamp === pending.messageTimestamp) {
          entryId = entry.id
          break
        }
      }

      if (entryId !== undefined) {
        state.pendingAttributions.delete(modelCallId)
        this.appendEvent(state, ts, undefined, "attribution", {
          modelCallId,
          entryId,
          attribution: pending.attribution,
        })
        continue
      }

      const probes = pending.probes + 1
      if (probes >= 2) {
        state.pendingAttributions.delete(modelCallId)
        this.appendEvent(state, ts, undefined, "attributionMiss", {
          modelCallId,
          reason: "entryNotFound",
        })
      } else {
        state.pendingAttributions.set(modelCallId, { ...pending, probes })
      }
    }
  }

  private appendPublisherError(ctx: ExtensionContextLike, cause: Error | object | string | number | boolean | symbol | bigint | null | undefined): void {
    const state = this.currentSessionId === undefined ? this.stateForContext(ctx) : this.sessions.get(this.currentSessionId) ?? this.stateForContext(ctx)
    this.appendEvent(state, 0, undefined, "publisherError", {
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

function attributionString(provider: string, model: string, thinkingLevel: string | undefined): string {
  return thinkingLevel === undefined || thinkingLevel === "" ? `${provider}/${model}` : `${provider}/${model}:${thinkingLevel}`
}

function timestampMillis(timestamp: OmpTimestamp | undefined): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime()
  }
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp
  }
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function outcomeFor(message: AssistantMessage): "ok" | "error" | "refusal" | "abort" {
  const status = `${message.stopReason ?? ""} ${message.errorStatus ?? ""}`.toLowerCase()
  if (status.includes("refusal")) {
    return "refusal"
  }
  if (status.includes("abort")) {
    return "abort"
  }
  if (status.includes("error") || message.errorMessage !== undefined) {
    return "error"
  }
  return "ok"
}

function errorClassFor(message: AssistantMessage): string | null {
  const outcome = outcomeFor(message)
  switch (outcome) {
    case "ok":
      return null
    case "refusal":
      return "ProviderRefusal"
    case "abort":
      return "HarnessError"
    case "error":
      return message.errorStatus !== undefined ? `ProviderError:${message.errorStatus}` : "ProviderError"
  }
}

function countExistingOutboxLines(path: string): number {
  if (!existsSync(path)) {
    return 0
  }

  const bytes = readFileSync(path)
  let lines = 0
  for (const byte of bytes) {
    if (byte === 10) {
      lines += 1
    }
  }
  return bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? lines + 1 : lines
}

function compactJson(record: LooseJsonRecord): JsonRecord {
  const compacted: JsonRecord = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      compacted[key] = value
    }
  }
  return compacted
}
