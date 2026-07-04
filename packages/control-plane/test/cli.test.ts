import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { LedgerStore, openLedger } from "../src/ledger"

const packageDir = join(import.meta.dir, "..")
const tmpDir = join(import.meta.dir, ".tmp")
const dbPath = join(tmpDir, "cli-fixture.sqlite")

interface StatusJson {
  readonly sessionsByStatus: readonly { readonly status: string; readonly count: number }[]
  readonly counts: {
    readonly sessions: number
    readonly branches: number
    readonly turns: number
    readonly events: number
    readonly modelCalls: number
    readonly providerCalls: number
    readonly artifacts: number
    readonly packets: number
    readonly commits: number
  }
  readonly lastActivity: number | null
}

interface ModelCallJson {
  readonly model: string
  readonly provider: string
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly cost: number
  readonly latencyMs: number
  readonly outcome: string
  readonly contextManifest: string
  readonly rawRequestArtifact: string
  readonly rawResponseArtifact: string
}

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("cli emits ledger JSON parity for status and model calls", async () => {
  await writeFixture(dbPath)
  const statusResult = Bun.spawnSync(["bun", "src/cli.ts", "status", "--json", "--db", dbPath], {
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const statusStdout = new TextDecoder().decode(statusResult.stdout).trim()
  expect(statusResult.exitCode).toBe(0)

  const status = JSON.parse(statusStdout) as StatusJson
  expect(status.sessionsByStatus).toEqual([{ status: "running", count: 1 }])
  expect(status.counts.sessions).toBe(1)
  expect(status.counts.modelCalls).toBe(1)
  expect(status.lastActivity).toBe(1_900)

  const modelCallsResult = Bun.spawnSync([
    "bun",
    "src/cli.ts",
    "model-calls",
    "--json",
    "--db",
    dbPath,
    "--session",
    "session-cli",
    "--model",
    "gpt-cli",
    "--provider",
    "openai",
    "--outcome",
    "ok",
    "--since",
    "1000",
    "--limit",
    "50",
  ], {
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const modelCallsStdout = new TextDecoder().decode(modelCallsResult.stdout).trim()
  expect(modelCallsResult.exitCode).toBe(0)

  const modelCalls = JSON.parse(modelCallsStdout) as readonly ModelCallJson[]
  expect(modelCalls).toHaveLength(1)
  expect(modelCalls[0]).toMatchObject({
    model: "gpt-cli",
    provider: "openai",
    tokensIn: 123,
    tokensOut: 456,
    cacheRead: 7,
    cacheWrite: 8,
    cost: 0.023,
    latencyMs: 345,
    outcome: "ok",
  })
  expect(modelCalls[0]?.contextManifest).toBe(modelCalls[0]?.rawRequestArtifact)
  expect(modelCalls[0]?.rawRequestArtifact).toMatch(/^artifact_/)
  expect(modelCalls[0]?.rawResponseArtifact).toMatch(/^artifact_/)
})

async function writeFixture(path: string): Promise<void> {
  const program = Effect.gen(function* () {
    const store = yield* LedgerStore

    yield* store.upsertSession({
      id: "session-cli",
      machine: "m1",
      harness: "cli-fixture",
      workspace: "/repo",
      title: "cli fixture",
      status: "running",
      createdAt: 1_000,
      updatedAt: 1_900,
      meta: "{\"fixture\":true}",
    })

    yield* store.recordBranch({
      id: "branch-cli",
      sessionId: "session-cli",
      kind: "root",
      createdAt: 1_010,
      meta: "{}",
    })

    const rawRequest = yield* store.putArtifact({ content: "{\"messages\":[\"hi\"]}" }, {
      ts: 1_600,
      sessionId: "session-cli",
      kind: "rawRequest",
      retention: "keep",
      meta: "{}",
    })
    const rawResponse = yield* store.putArtifact({ content: "{\"text\":\"hello\"}" }, {
      ts: 1_700,
      sessionId: "session-cli",
      kind: "rawResponse",
      retention: "keep",
      meta: "{}",
    })

    yield* store.recordModelCall({
      id: "model-call-cli",
      ts: 1_800,
      machine: "m1",
      session: "session-cli",
      branchId: "branch-cli",
      agent: "QueryCli",
      model: "gpt-cli",
      provider: "openai",
      effort: "medium",
      promptHash: "prompt-hash",
      systemPromptHash: "system-hash",
      skillProfile: "skills-fixture",
      contextManifest: rawRequest.id,
      packetId: "packet-cli",
      tokensIn: 123,
      tokensOut: 456,
      cacheRead: 7,
      cacheWrite: 8,
      cost: 0.023,
      latencyMs: 345,
      outcome: "ok",
      rawRequestArtifact: rawRequest.id,
      rawResponseArtifact: rawResponse.id,
    })
  })

  await Effect.runPromise(program.pipe(Effect.provide(openLedger(path))))
}
