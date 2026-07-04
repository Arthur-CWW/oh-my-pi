import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"

import { LedgerStore, openLedger } from "../src/ledger"
import { withModelCall, withProviderCall, type ModelCallTelemetryMeta, type ProviderCallTelemetryMeta } from "../src/telemetry"

const tmpDir = join(import.meta.dir, ".tmp", "telemetry")
const providerDbPath = join(tmpDir, "telemetry-provider.sqlite")
const providerFailureDbPath = join(tmpDir, "telemetry-provider-failure.sqlite")

interface ModelResponse {
  readonly text: string
}

class ModelFixtureError {
  readonly _tag = "ModelFixtureError"
  constructor(readonly message: string) {}
}

interface ProviderResponse {
  readonly status: number
}

class ProviderFixtureError {
  readonly _tag = "ProviderFixtureError"
  constructor(readonly message: string) {}
}

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("withModelCall records success facts and artifact links", async () => {
  const program = Effect.gen(function* () {
    yield* TestClock.setTime(1_000)
    const store = yield* LedgerStore
    const result = yield* withModelCall(successModelMeta)(Effect.gen(function* () {
      yield* TestClock.adjust(37)
      return { text: "hello" }
    }))

    expect(result).toEqual({ text: "hello" })
    const rows = yield* store.listModelCalls({ session: "session-success" })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("model-success-1")
    expect(rows[0]?.ts).toBe(1_000)
    expect(rows[0]?.latencyMs).toBe(37)
    expect(rows[0]?.outcome).toBe("ok")
    expect(rows[0]?.errorClass).toBeNull()
    expect(rows[0]?.tokensIn).toBe(12)
    expect(rows[0]?.tokensOut).toBe(5)
    expect(rows[0]?.cacheRead).toBe(2)
    expect(rows[0]?.cacheWrite).toBe(1)
    expect(rows[0]?.cost).toBe(0.004)

    const rawRequestArtifactId = rows[0]?.rawRequestArtifact
    const rawResponseArtifactId = rows[0]?.rawResponseArtifact
    expect(rawRequestArtifactId?.startsWith("artifact_")).toBe(true)
    expect(rawResponseArtifactId?.startsWith("artifact_")).toBe(true)
    expect(rawRequestArtifactId).not.toBe(rawResponseArtifactId)
    const rawRequest = yield* store.getArtifact(rawRequestArtifactId ?? "missing")
    const rawResponse = yield* store.getArtifact(rawResponseArtifactId ?? "missing")
    expect(rawRequest.content).toBe(successModelMeta.rawRequest)
    expect(rawResponse.content).toBe("{\"text\":\"hello\"}")
  })

  await Effect.runPromise(program.pipe(Effect.provide([openLedger(":memory:"), TestClock.layer()])))
})

test("withModelCall records failure facts and re-fails", async () => {
  const fixtureError = new ModelFixtureError("blocked by policy")
  const meta: ModelCallTelemetryMeta<ModelResponse, ModelFixtureError> = {
    ...failureModelMetaBase,
    extract: (input) => input._tag === "success"
      ? {
        rawResponse: JSON.stringify(input.result),
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
      }
      : {
        rawResponse: "{\"error\":\"blocked by policy\"}",
        tokensIn: 9,
        tokensOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.001,
        errorClass: "ModelFixtureError",
      },
    classifyFailure: () => "contentFilter",
  }

  const program = Effect.gen(function* () {
    yield* TestClock.setTime(2_000)
    const store = yield* LedgerStore
    const failure = yield* Effect.matchEffect(
      withModelCall(meta)(Effect.gen(function* () {
        yield* TestClock.adjust(12)
        return yield* Effect.fail(fixtureError)
      })),
      {
        onFailure: (error) => Effect.succeed(error),
        onSuccess: () => Effect.sync(() => {
          throw new Error("expected wrapped model call to fail")
        }),
      },
    )

    expect(failure).toBe(fixtureError)
    const rows = yield* store.listModelCalls({ session: "session-failure" })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.outcome).toBe("contentFilter")
    expect(rows[0]?.errorClass).toBe("ModelFixtureError")
    expect(rows[0]?.latencyMs).toBe(12)
    expect(rows[0]?.tokensIn).toBe(9)
    const rawResponse = yield* store.getArtifact(rows[0]?.rawResponseArtifact ?? "missing")
    expect(rawResponse.content).toBe("{\"error\":\"blocked by policy\"}")
  })

  await Effect.runPromise(program.pipe(Effect.provide([openLedger(":memory:"), TestClock.layer()])))
})

test("withProviderCall records request artifact and provider row", async () => {
  const program = Effect.gen(function* () {
    yield* TestClock.setTime(3_000)
    const result = yield* withProviderCall(providerMeta)(Effect.gen(function* () {
      yield* TestClock.adjust(8)
      return { status: 200 }
    }))
    expect(result.status).toBe(200)
  })

  await Effect.runPromise(program.pipe(Effect.provide([openLedger(providerDbPath), TestClock.layer()])))

  const sqlite = new Database(providerDbPath)
  try {
    const row = sqlite.query<{
      id: string
      ts: number
      sessionId: string
      provider: string
      operation: string
      inputHash: string
      rawRequestArtifact: string | null
      latencyMs: number
      outcome: string
      errorClass: string | null
      cost: number | null
      usage: string | null
    }, []>("SELECT * FROM provider_calls WHERE id = 'provider-success-1'").get()
    expect(row).not.toBeNull()
    expect(row?.ts).toBe(3_000)
    expect(row?.sessionId).toBe("session-provider")
    expect(row?.provider).toBe("kagi")
    expect(row?.operation).toBe("search")
    expect(row?.inputHash).toBe("provider-input-hash")
    expect(row?.latencyMs).toBe(8)
    expect(row?.outcome).toBe("ok")
    expect(row?.errorClass).toBeNull()
    expect(row?.cost).toBe(0.002)
    expect(row?.usage).toBe("{\"queries\":1}")
    expect(row?.rawRequestArtifact?.startsWith("artifact_")).toBe(true)

    const artifact = sqlite.query<{ contentInline: string | null }, [string]>(
      "SELECT contentInline FROM artifacts WHERE id = ?",
    ).get(row?.rawRequestArtifact ?? "missing")
    expect(artifact?.contentInline).toBe(providerMeta.rawRequest)
  } finally {
    sqlite.close()
  }
})

test("withProviderCall records failure outcome and re-fails", async () => {
  const fixtureError = new ProviderFixtureError("provider aborted")
  const program = Effect.gen(function* () {
    yield* TestClock.setTime(4_000)
    const failure = yield* Effect.matchEffect(
      withProviderCall(providerFailureMeta)(Effect.gen(function* () {
        yield* TestClock.adjust(5)
        return yield* Effect.fail(fixtureError)
      })),
      {
        onFailure: (error) => Effect.succeed(error),
        onSuccess: () => Effect.sync(() => {
          throw new Error("expected wrapped provider call to fail")
        }),
      },
    )
    expect(failure).toBe(fixtureError)
  })

  await Effect.runPromise(program.pipe(Effect.provide([openLedger(providerFailureDbPath), TestClock.layer()])))

  const sqlite = new Database(providerFailureDbPath)
  try {
    const row = sqlite.query<{
      rawRequestArtifact: string | null
      latencyMs: number
      outcome: string
      errorClass: string | null
      cost: number | null
      usage: string | null
    }, []>("SELECT rawRequestArtifact, latencyMs, outcome, errorClass, cost, usage FROM provider_calls WHERE id = 'provider-failure-1'").get()
    expect(row).not.toBeNull()
    expect(row?.rawRequestArtifact).toBeNull()
    expect(row?.latencyMs).toBe(5)
    expect(row?.outcome).toBe("abort")
    expect(row?.errorClass).toBe("ProviderFixtureError")
    expect(row?.cost).toBeNull()
    expect(row?.usage).toBe("{\"attempts\":1}")
  } finally {
    sqlite.close()
  }
})

const successModelMeta: ModelCallTelemetryMeta<ModelResponse, ModelFixtureError> = {
  id: "model-success-1",
  machine: "m1",
  session: "session-success",
  branchId: "branch-root",
  agent: "TelemetryLib",
  model: "gpt-fixture",
  provider: "openai",
  effort: "medium",
  promptHash: "prompt-hash",
  systemPromptHash: "system-hash",
  skillProfile: "skills-fixture",
  contextManifest: "context-manifest",
  packetId: "packet-p3",
  rawRequest: "{\"messages\":[\"hi\"]}",
  extract: (input) => input._tag === "success"
    ? {
      rawResponse: JSON.stringify(input.result),
      tokensIn: 12,
      tokensOut: 5,
      cacheRead: 2,
      cacheWrite: 1,
      cost: 0.004,
    }
    : {
      rawResponse: "{\"error\":\"unexpected\"}",
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      errorClass: "unexpected",
    },
}

const failureModelMetaBase = {
  id: "model-failure-1",
  machine: "m1",
  session: "session-failure",
  branchId: "branch-root",
  agent: "TelemetryLib",
  model: "gpt-fixture",
  provider: "openai",
  effort: "medium",
  promptHash: "prompt-hash",
  systemPromptHash: "system-hash",
  skillProfile: "skills-fixture",
  contextManifest: "context-manifest",
  packetId: "packet-p3",
  rawRequest: "{\"messages\":[\"bad\"]}",
} satisfies Omit<ModelCallTelemetryMeta<ModelResponse, ModelFixtureError>, "extract" | "classifyFailure">

const providerMeta: ProviderCallTelemetryMeta<ProviderResponse, never> = {
  id: "provider-success-1",
  sessionId: "session-provider",
  branchId: "branch-root",
  packetId: "packet-p3",
  provider: "kagi",
  operation: "search",
  inputHash: "provider-input-hash",
  rawRequest: "{\"q\":\"effect telemetry\"}",
  extract: () => ({
    cost: 0.002,
    usage: "{\"queries\":1}",
  }),
}

const providerFailureMeta: ProviderCallTelemetryMeta<ProviderResponse, ProviderFixtureError> = {
  id: "provider-failure-1",
  sessionId: "session-provider-failure",
  provider: "filesystem",
  operation: "write",
  inputHash: "provider-failure-input-hash",
  classifyFailure: () => "abort",
  extract: (input) => input._tag === "success"
    ? {
      cost: 0,
      usage: "{\"attempts\":1}",
    }
    : {
      errorClass: "ProviderFixtureError",
      usage: "{\"attempts\":1}",
    },
}
