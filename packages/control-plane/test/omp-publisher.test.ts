import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Schema } from "effect"

import type { ExtensionContextLike, PiLike } from "../src/omp-events"
import createOmpPublisher from "../src/omp-publisher"
import { OutboxEnvelopeSchema, outboxPathFor, type JsonValue } from "../src/outbox"

const tmpDir = join(import.meta.dir, ".tmp", "omp-publisher")

class FakePi {
  private readonly handlers: Record<string, Array<(event: never, ctx: ExtensionContextLike) => unknown>> = {}

  on(event: string, handler: (event: never, ctx: ExtensionContextLike) => unknown): void {
    this.handlers[event] = [...(this.handlers[event] ?? []), handler]
  }

  emit<E>(event: string, payload: E, ctx: ExtensionContextLike): void {
    for (const handler of this.handlers[event] ?? []) {
      handler(payload as never, ctx)
    }
  }
}

test("OMP publisher writes schema-valid monotonic outbox envelopes with captured model request", () => {
  rmSync(tmpDir, { recursive: true, force: true })

  const sessionId = "session-1"
  const sessionDir = join(tmpDir, "sessions")
  const outboxDir = join(tmpDir, "outbox")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir
  const sessionFile = join(sessionDir, "2026-07-04_session-1.jsonl")
  const ctx = {
    cwd: "/repo/example",
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => sessionFile,
    },
  } satisfies ExtensionContextLike

  const pi = new FakePi()
  createOmpPublisher(pi as PiLike)

  pi.emit("session_start", { type: "session_start", timestamp: 1_000, title: "Fixture" }, ctx)
  pi.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1_100, contextTokens: 128 }, ctx)
  pi.emit("before_provider_request", {
    type: "before_provider_request",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    api: "messages",
    payload: { messages: ["hi"], temperature: 0.2 },
  }, ctx)
  pi.emit("message_end", {
    type: "message_end",
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      api: "messages",
      usage: { input: 10, output: 20, cacheRead: 3, cacheWrite: 4, cost: 0.012, totalTokens: 30 },
      stopReason: "end_turn",
      duration: 250,
      ttft: 50,
      timestamp: 1_350,
    },
  }, ctx)
  pi.emit("turn_end", { type: "turn_end", turnIndex: 1, timestamp: 1_400, duration: 300, toolResults: [] }, ctx)
  pi.emit("session_shutdown", { type: "session_shutdown", timestamp: 1_500, reason: "fixture" }, ctx)

  const outboxPath = outboxPathFor(sessionId, outboxDir)
  const lines = readFileSync(outboxPath, "utf8").trimEnd().split("\n")
  const envelopes = lines.map((line) => Schema.decodeUnknownSync(OutboxEnvelopeSchema)(JSON.parse(line) as unknown))

  expect(envelopes.map((envelope) => envelope.kind)).toEqual(["session", "event", "event", "modelCall", "turn", "event"])
  expect(envelopes.map((envelope) => envelope.seq)).toEqual([0, 1, 2, 3, 4, 5])
  expect(envelopes.every((envelope) => envelope.v === 1 && envelope.sessionId === sessionId)).toBe(true)

  const turnEnvelope = envelopes.find((envelope) => envelope.kind === "turn")
  expect(turnEnvelope).toBeDefined()
  const turnPayload = jsonRecord(turnEnvelope?.payload ?? null)
  expect(turnPayload.id).toBe("session-1:turn:1")
  expect(turnPayload.branchId).toBe("root")
  expect(turnPayload.seq).toBe(1)
  expect(turnPayload.startedAt).toBe(1_100)
  expect(turnPayload.endedAt).toBe(1_400)
  expect(turnPayload.contextTokens).toBe(128)
  expect(turnPayload.toolCalls).toBe(0)
  expect(turnPayload.turnDurationMs).toBe(300)
  expect(turnPayload.yieldKind).toBe("unknown")
  expect(turnPayload).toMatchObject({
    branchId: "root",
    seq: 1,
    startedAt: 1_100,
    contextTokens: 128,
    toolCalls: 0,
    editBytes: 0,
    turnDurationMs: 300,
    yieldKind: "unknown",
  })

  const turnStartEnvelope = envelopes[2]
  expect(turnStartEnvelope?.kind).toBe("event")
  const turnStartPayload = jsonRecord(turnStartEnvelope?.payload ?? null)
  expect(turnStartPayload.payload).toEqual({ turnIndex: 1, branchId: "root", contextTokens: 128, toolCalls: 0 })

  const modelEnvelope = envelopes.find((envelope) => envelope.kind === "modelCall")
  expect(modelEnvelope).toBeDefined()
  const modelPayload = jsonRecord(modelEnvelope?.payload ?? null)
  expect(modelPayload.provider).toBe("anthropic")
  expect(modelPayload.model).toBe("claude-3-5-sonnet")
  expect(modelPayload.api).toBe("messages")
  expect(modelPayload.tokensIn).toBe(10)
  expect(modelPayload.tokensOut).toBe(20)
  expect(modelPayload.cacheRead).toBe(3)
  expect(modelPayload.cacheWrite).toBe(4)
  expect(modelPayload.cost).toBe(0.012)
  expect(modelPayload.latencyMs).toBe(250)
  expect(modelPayload.outcome).toBe("ok")
  expect(modelPayload.rawRequestSupport).toBe("captured")
  expect(modelPayload.rawRequest).toEqual({ messages: ["hi"], temperature: 0.2 })
  expect(modelPayload).toMatchObject({
    machine: "unknown",
    branchId: "root",
    agent: "omp",
    model: "claude-3-5-sonnet",
    provider: "anthropic",
    effort: "unknown",
    promptHash: "unknown",
    systemPromptHash: "unknown",
    skillProfile: "unknown",
    contextManifest: "unknown",
    packetId: "",
    tokensIn: 10,
    tokensOut: 20,
    cacheRead: 3,
    cacheWrite: 4,
    cost: 0.012,
    latencyMs: 250,
    outcome: "ok",
    rawRequestArtifact: "",
    rawResponseArtifact: "",
  })
})

function jsonRecord(value: JsonValue): Record<string, JsonValue> {
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  expect(typeof value).toBe("object")
  return value as Record<string, JsonValue>
}
