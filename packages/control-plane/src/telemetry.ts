import { Clock, Effect, type Cause } from "effect"

import type { ArtifactError, StorageError } from "./errors"
import { LedgerStore } from "./ledger"

export type TelemetryOutcome = "ok" | "error" | "refusal" | "contentFilter" | "abort"
export type FailureTelemetryOutcome = Exclude<TelemetryOutcome, "ok">

export type ModelCallExtractorInput<A, E> =
  | { readonly _tag: "success"; readonly result: A }
  | { readonly _tag: "failure"; readonly cause: Cause.Cause<E> }

export interface ModelCallFacts {
  readonly rawResponse: string
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly cost: number
  readonly outcome?: FailureTelemetryOutcome
  readonly errorClass?: string
}

export interface ModelCallTelemetryMeta<A, E> {
  readonly id?: string
  readonly seq?: number
  readonly ts?: number
  readonly machine: string
  readonly session: string
  readonly branchId: string
  readonly agent: string
  readonly model: string
  readonly provider: string
  readonly effort: string
  readonly promptHash: string
  readonly systemPromptHash: string
  readonly skillProfile: string
  readonly contextManifest: string
  readonly packetId: string
  readonly retryOf?: string
  readonly fallbackFrom?: string
  readonly rawRequest: string
  readonly artifactRetention?: string
  readonly classifyFailure?: (cause: Cause.Cause<E>) => FailureTelemetryOutcome
  readonly extract: (input: ModelCallExtractorInput<A, E>) => ModelCallFacts
}

export type ProviderCallExtractorInput<A, E> =
  | { readonly _tag: "success"; readonly result: A }
  | { readonly _tag: "failure"; readonly cause: Cause.Cause<E> }

export interface ProviderCallFacts {
  readonly outcome?: FailureTelemetryOutcome
  readonly errorClass?: string
  readonly cost?: number
  readonly usage?: string
}

export interface ProviderCallTelemetryMeta<A, E> {
  readonly id?: string
  readonly seq?: number
  readonly ts?: number
  readonly sessionId: string
  readonly branchId?: string
  readonly packetId?: string
  readonly provider: string
  readonly operation: string
  readonly inputHash: string
  readonly rawRequest?: string
  readonly artifactRetention?: string
  readonly classifyFailure?: (cause: Cause.Cause<E>) => FailureTelemetryOutcome
  readonly extract: (input: ProviderCallExtractorInput<A, E>) => ProviderCallFacts
}

export function withModelCall<A, E>(meta: ModelCallTelemetryMeta<A, E>) {
  return <R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | StorageError | ArtifactError, R | LedgerStore> =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis
      return yield* Effect.matchCauseEffect(effect, {
        onSuccess: (result) =>
          Effect.gen(function* () {
            const end = yield* Clock.currentTimeMillis
            const facts = meta.extract({ _tag: "success", result })
            yield* recordModelCall(meta, facts, start, end, "ok")
            return result
          }),
        onFailure: (cause) =>
          Effect.gen(function* () {
            const end = yield* Clock.currentTimeMillis
            const facts = meta.extract({ _tag: "failure", cause })
            const outcome = facts.outcome ?? meta.classifyFailure?.(cause) ?? "error"
            yield* recordModelCall(meta, facts, start, end, outcome)
            return yield* Effect.failCause(cause)
          }),
      })
    })
}

export function withProviderCall<A, E>(meta: ProviderCallTelemetryMeta<A, E>) {
  return <R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | StorageError | ArtifactError, R | LedgerStore> =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis
      return yield* Effect.matchCauseEffect(effect, {
        onSuccess: (result) =>
          Effect.gen(function* () {
            const end = yield* Clock.currentTimeMillis
            const facts = meta.extract({ _tag: "success", result })
            yield* recordProviderCall(meta, facts, start, end, "ok")
            return result
          }),
        onFailure: (cause) =>
          Effect.gen(function* () {
            const end = yield* Clock.currentTimeMillis
            const facts = meta.extract({ _tag: "failure", cause })
            const outcome = facts.outcome ?? meta.classifyFailure?.(cause) ?? "error"
            yield* recordProviderCall(meta, facts, start, end, outcome)
            return yield* Effect.failCause(cause)
          }),
      })
    })
}

const recordModelCall = Effect.fn("Telemetry.recordModelCall")(function*<A, E>(
  meta: ModelCallTelemetryMeta<A, E>,
  facts: ModelCallFacts,
  start: number,
  end: number,
  outcome: TelemetryOutcome,
) {
  const store = yield* LedgerStore
  const id = meta.id ?? `${meta.session}:${meta.seq ?? meta.packetId}:modelCall`
  const retention = meta.artifactRetention ?? "keep"
  const rawRequest = yield* store.putArtifact({ content: meta.rawRequest }, {
    ts: start,
    sessionId: meta.session,
    kind: "rawRequest",
    retention,
    meta: JSON.stringify({ callId: id, role: "modelCall.rawRequest" }),
  })
  const rawResponse = yield* store.putArtifact({ content: facts.rawResponse }, {
    ts: end,
    sessionId: meta.session,
    kind: "rawResponse",
    retention,
    meta: JSON.stringify({ callId: id, role: "modelCall.rawResponse" }),
  })
  yield* store.recordModelCall({
    id,
    ts: meta.ts ?? start,
    machine: meta.machine,
    session: meta.session,
    branchId: meta.branchId,
    agent: meta.agent,
    model: meta.model,
    provider: meta.provider,
    effort: meta.effort,
    promptHash: meta.promptHash,
    systemPromptHash: meta.systemPromptHash,
    skillProfile: meta.skillProfile,
    contextManifest: meta.contextManifest,
    packetId: meta.packetId,
    tokensIn: facts.tokensIn,
    tokensOut: facts.tokensOut,
    cacheRead: facts.cacheRead,
    cacheWrite: facts.cacheWrite,
    cost: facts.cost,
    latencyMs: Math.max(0, end - start),
    outcome,
    errorClass: facts.errorClass,
    retryOf: meta.retryOf,
    fallbackFrom: meta.fallbackFrom,
    rawRequestArtifact: rawRequest.id,
    rawResponseArtifact: rawResponse.id,
  })
})

const recordProviderCall = Effect.fn("Telemetry.recordProviderCall")(function*<A, E>(
  meta: ProviderCallTelemetryMeta<A, E>,
  facts: ProviderCallFacts,
  start: number,
  end: number,
  outcome: TelemetryOutcome,
) {
  const store = yield* LedgerStore
  const id = meta.id ?? `${meta.sessionId}:${meta.seq ?? meta.inputHash}:providerCall`
  const rawRequestArtifact = meta.rawRequest === undefined
    ? undefined
    : (yield* store.putArtifact({ content: meta.rawRequest }, {
      ts: start,
      sessionId: meta.sessionId,
      kind: "rawRequest",
      retention: meta.artifactRetention ?? "keep",
      meta: JSON.stringify({ callId: id, role: "providerCall.rawRequest" }),
    })).id
  yield* store.recordProviderCall({
    id,
    ts: meta.ts ?? start,
    sessionId: meta.sessionId,
    branchId: meta.branchId,
    packetId: meta.packetId,
    provider: meta.provider,
    operation: meta.operation,
    inputHash: meta.inputHash,
    rawRequestArtifact,
    latencyMs: Math.max(0, end - start),
    outcome,
    errorClass: facts.errorClass,
    cost: facts.cost,
    usage: facts.usage,
  })
})

