// M1 acceptance proof driver (spec v1 M1): drives the real OMP publisher with a
// synthetic session, producing a REAL outbox JSONL under test/.tmp/m1-proof/.
// Follow with:
//   bun src/cli.ts ingest --from test/.tmp/m1-proof/outbox/session-m1-proof.jsonl --db test/.tmp/m1-proof/ledger.sqlite --json
//   bun src/cli.ts status --json --db test/.tmp/m1-proof/ledger.sqlite
//   bun src/cli.ts model-calls --json --db test/.tmp/m1-proof/ledger.sqlite
// Or just: bun run proof
import { rmSync } from "node:fs"
import { join } from "node:path"

import type { ExtensionContextLike, PiLike } from "../src/omp-events"
import createOmpPublisher from "../src/omp-publisher"
import { outboxPathFor } from "../src/outbox"

const proofDir = join(import.meta.dir, "..", "test", ".tmp", "m1-proof")
const outboxDir = join(proofDir, "outbox")
process.env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] = outboxDir
rmSync(proofDir, { recursive: true, force: true })

const sessionId = "session-m1-proof"
const ctx = {
  cwd: "/repo/example",
  sessionManager: {
    getSessionId: () => sessionId,
    getSessionFile: () => join(proofDir, "sessions", `${sessionId}.jsonl`),
  },
} satisfies ExtensionContextLike

interface HandlerMap {
  [event: string]: Array<(event: never, ctx: ExtensionContextLike) => unknown>
}
const handlers: HandlerMap = {}
const pi = {
  on(event: string, handler: (event: never, ctx: ExtensionContextLike) => unknown): void {
    handlers[event] = [...(handlers[event] ?? []), handler]
  },
}
createOmpPublisher(pi as PiLike)
const emit = <E,>(event: string, payload: E): void => {
  for (const handler of handlers[event] ?? []) handler(payload as never, ctx)
}

emit("session_start", { type: "session_start", timestamp: 1_000, title: "M1 proof session" })
emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1_100, contextTokens: 2048 })
emit("before_provider_request", {
  type: "before_provider_request",
  provider: "anthropic",
  model: "claude-fable-5",
  api: "messages",
  payload: { messages: [{ role: "user", content: "prove M1" }], max_tokens: 512 },
})
emit("message_end", {
  type: "message_end",
  message: {
    role: "assistant",
    provider: "anthropic",
    model: "claude-fable-5",
    api: "messages",
    usage: { input: 1200, output: 340, cacheRead: 900, cacheWrite: 0, cost: 0.0231, totalTokens: 1540 },
    stopReason: "end_turn",
    duration: 1_850,
    ttft: 420,
    timestamp: 3_000,
  },
})
emit("turn_end", { type: "turn_end", turnIndex: 1, timestamp: 3_100, duration: 2_000, toolResults: [] })
emit("turn_start", { type: "turn_start", turnIndex: 2, timestamp: 4_000, contextTokens: 3600 })
emit("before_provider_request", {
  type: "before_provider_request",
  provider: "openai",
  model: "gpt-5.5",
  api: "responses",
  payload: { input: "second variant call", reasoning: { effort: "high" } },
})
emit("message_end", {
  type: "message_end",
  message: {
    role: "assistant",
    provider: "openai",
    model: "gpt-5.5",
    api: "responses",
    usage: { input: 2100, output: 12, cacheRead: 0, cacheWrite: 0, cost: 0.0044, totalTokens: 2112 },
    stopReason: "error",
    errorMessage: "provider 500",
    errorStatus: 500,
    duration: 900,
    ttft: 0,
    timestamp: 5_000,
  },
})
emit("turn_end", { type: "turn_end", turnIndex: 2, timestamp: 5_100, duration: 1_100, toolResults: [] })
emit("session_shutdown", { type: "session_shutdown", timestamp: 6_000, reason: "proof complete" })

console.log(JSON.stringify({ outbox: outboxPathFor(sessionId, outboxDir), ledger: join(proofDir, "ledger.sqlite") }))
