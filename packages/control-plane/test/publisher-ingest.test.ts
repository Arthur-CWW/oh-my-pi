import { rmSync } from "node:fs"
import { join } from "node:path"

import { afterAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { ingestOutbox } from "../src/ingest"
import { LedgerStore, openLedger } from "../src/ledger"
import type { ExtensionContextLike, PiLike } from "../src/omp-events"
import createOmpPublisher from "../src/omp-publisher"
import { outboxPathFor } from "../src/outbox"

const tmpDir = join(import.meta.dir, ".tmp", "publisher-ingest")

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

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

test("real OMP publisher output ingests without seam degradation", async () => {
  rmSync(tmpDir, { recursive: true, force: true })

  const previousOutboxDir = process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
  const sessionId = "publisher-ingest-session"
  const outboxDir = join(tmpDir, "outbox")
  const dbPath = join(tmpDir, "ledger.sqlite")
  process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir

  const ctx = {
    cwd: "/repo/example",
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => join(tmpDir, "sessions", "publisher-ingest-session.jsonl"),
    },
  } satisfies ExtensionContextLike

  try {
    const pi = new FakePi()
    createOmpPublisher(pi as PiLike)

    pi.emit("session_start", { type: "session_start", timestamp: 1_000, title: "Publisher ingest" }, ctx)
    pi.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1_100, contextTokens: 128 }, ctx)
    pi.emit("before_provider_request", {
      type: "before_provider_request",
      branchId: "root",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      api: "messages",
      payload: { messages: ["hi"], temperature: 0.2 },
    }, ctx)
    pi.emit("message_end", {
      type: "message_end",
      branchId: "root",
      message: {
        role: "assistant",
        provider: "anthropic",
        upstreamProvider: "anthropic-direct",
        model: "claude-3-5-sonnet",
        api: "messages",
        usage: { input: 10, output: 20, cacheRead: 3, cacheWrite: 4, cost: 0.012, totalTokens: 30, reasoningTokens: 2, premiumRequests: 1 },
        stopReason: "end_turn",
        stopDetails: { reason: "complete" },
        duration: 250,
        ttft: 50,
        timestamp: 1_350,
      },
    }, ctx)
    pi.emit("turn_end", { type: "turn_end", turnIndex: 1, timestamp: 1_400, duration: 300, toolResults: [] }, ctx)

    pi.emit("turn_start", { type: "turn_start", turnIndex: 2, timestamp: 1_500, contextTokens: 256 }, ctx)
    pi.emit("before_provider_request", {
      type: "before_provider_request",
      branchId: "root",
      provider: "openai",
      model: "gpt-error",
      api: "responses",
      payload: { input: "fail" },
    }, ctx)
    pi.emit("message_end", {
      type: "message_end",
      branchId: "root",
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt-error",
        api: "responses",
        usage: { input: 5, output: 0, cost: 0, totalTokens: 5 },
        errorStatus: "provider_error",
        errorMessage: "upstream failed",
        stopReason: "error",
        duration: 80,
        ttft: 0,
        timestamp: 1_650,
      },
    }, ctx)
    pi.emit("turn_end", { type: "turn_end", turnIndex: 2, timestamp: 1_700, duration: 200, yieldKind: "error" }, ctx)

    await Effect.runPromise(Effect.gen(function* () {
      const result = yield* ingestOutbox(outboxPathFor(sessionId, outboxDir))
      expect(result.malformed).toBe(0)

      const store = yield* LedgerStore
      const summary = yield* store.statusSummary()
      expect(summary.counts.sessions).toBe(1)
      expect(summary.counts.turns).toBe(2)
      expect(summary.counts.modelCalls).toBe(2)
      expect(summary.counts.artifacts).toBe(2)

      const okRows = yield* store.listModelCalls({ outcome: "ok" })
      expect(okRows).toHaveLength(1)
      expect(okRows[0]?.rawRequestArtifact).not.toBe("")
      const rawRequest = yield* store.getArtifact(okRows[0]?.rawRequestArtifact ?? "")
      expect(rawRequest.kind).toBe("rawRequest")
      expect(rawRequest.content).toBe(JSON.stringify({ messages: ["hi"], temperature: 0.2 }))


      const errorRows = yield* store.listModelCalls({ outcome: "error" })
      expect(errorRows).toHaveLength(1)
      expect(errorRows[0]?.model).toBe("gpt-error")
      expect(errorRows[0]?.errorClass).toBe("ProviderError:provider_error")
      expect((yield* store.listEvents({ kind: "ingestError" }))).toHaveLength(0)
      const second = yield* ingestOutbox(outboxPathFor(sessionId, outboxDir))
      expect(second.inserted).toBe(0)
      expect(second.malformed).toBe(0)
    }).pipe(Effect.provide(openLedger(dbPath))))
  } finally {
    if (previousOutboxDir === undefined) {
      delete process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"]
    } else {
      process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = previousOutboxDir
    }
  }
})
