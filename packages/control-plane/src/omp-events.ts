import type { JsonValue } from "./outbox"

export interface PiLike {
  on(event: "session_start", handler: ExtensionHandler<SessionStartPayload>): void
  on(event: "turn_start", handler: ExtensionHandler<TurnPayload>): void
  on(event: "turn_end", handler: ExtensionHandler<TurnPayload>): void
  on(event: "message_end", handler: ExtensionHandler<MessageEndPayload>): void
  on(event: "session_switch", handler: ExtensionHandler<SessionSwitchPayload>): void
  on(event: "session_branch", handler: ExtensionHandler<SessionBranchPayload>): void
  on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownPayload>): void
  on(event: "before_provider_request", handler: ExtensionHandler<BeforeProviderRequestPayload>): void
  on(event: string, handler: ExtensionHandler<never>): void
}

export type ExtensionHandler<E> = (event: E, ctx: ExtensionContextLike) => unknown

export interface SessionManagerLike {
  getSessionId(): string
  getSessionFile(): string
}

export interface ExtensionContextLike {
  readonly cwd?: string
  readonly sessionManager: SessionManagerLike
}

export type OmpTimestamp = number | string | Date

export interface SessionStartPayload {
  readonly type?: "session_start"
  readonly timestamp?: OmpTimestamp
  readonly workspace?: string
  readonly title?: string
  readonly parentSession?: string
  readonly machine?: string
}

export interface TurnPayload {
  readonly type?: "turn_start" | "turn_end"
  readonly sessionId?: string
  readonly branchId?: string
  readonly turnId?: string
  readonly turnIndex?: number
  readonly seq?: number
  readonly timestamp?: OmpTimestamp
  readonly startedAt?: OmpTimestamp
  readonly endedAt?: OmpTimestamp
  readonly contextTokens?: number
  readonly toolCalls?: number
  readonly toolResults?: readonly JsonValue[]
  readonly toolCallSummary?: JsonValue
  readonly editBytes?: number
  readonly duration?: number
  readonly turnDurationMs?: number
  readonly yieldKind?: string
  readonly message?: AssistantMessage
}

export interface AssistantUsage {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly cost?: number
  readonly totalTokens?: number
  readonly reasoningTokens?: number
  readonly premiumRequests?: number
}

export interface AssistantMessage {
  readonly role?: string
  readonly api?: string
  readonly provider?: string
  readonly upstreamProvider?: string
  readonly model?: string
  readonly usage?: AssistantUsage
  readonly stopReason?: string
  readonly stopDetails?: JsonValue
  readonly errorMessage?: string
  readonly errorStatus?: string
  readonly disabledFeatures?: readonly string[]
  readonly providerPayload?: JsonValue
  readonly timestamp?: OmpTimestamp
  readonly duration?: number
  readonly ttft?: number
}

export interface MessageEndPayload {
  readonly type?: "message_end"
  readonly sessionId?: string
  readonly branchId?: string
  readonly timestamp?: OmpTimestamp
  readonly message: AssistantMessage
}

export interface BeforeProviderRequestPayload {
  readonly type?: "before_provider_request"
  readonly sessionId?: string
  readonly branchId?: string
  readonly timestamp?: OmpTimestamp
  readonly provider?: string
  readonly model?: string
  readonly api?: string
  readonly payload?: JsonValue
}

export interface SessionSwitchPayload {
  readonly type?: "session_switch"
  readonly reason?: "new" | "resume" | "fork" | string
  readonly sessionId?: string
  readonly sessionFile?: string
  readonly previousSessionId?: string
  readonly previousSessionFile?: string
  readonly parentSession?: string
  readonly branchId?: string
  readonly timestamp?: OmpTimestamp
  readonly sessionManager?: SessionManagerLike
}

export interface SessionBranchPayload {
  readonly type?: "session_branch"
  readonly sessionId?: string
  readonly sessionFile?: string
  readonly sourceSessionId?: string
  readonly sourceSessionFile?: string
  readonly previousSessionFile?: string
  readonly parentSession?: string
  readonly branchId?: string
  readonly parentBranchId?: string
  readonly leafId?: string
  readonly atTurn?: number
  readonly timestamp?: OmpTimestamp
  readonly sessionManager?: SessionManagerLike
}

export interface SessionShutdownPayload {
  readonly type?: "session_shutdown"
  readonly sessionId?: string
  readonly sessionFile?: string
  readonly timestamp?: OmpTimestamp
  readonly reason?: string
  readonly sessionManager?: SessionManagerLike
}
