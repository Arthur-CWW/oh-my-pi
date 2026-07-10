import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { beforeAll, expect, test } from "bun:test"
import { Effect, Schema } from "effect"

import { RoutingStore, openRoutingStore } from "../src/routing"
import { seedRoutingStore } from "../src/routing-seed"

const packageDir = join(import.meta.dir, "..")
const tmpDir = join(import.meta.dir, ".tmp")
const runId = Date.now()

const CliObservationSchema = Schema.Struct({
  id: Schema.String,
  lane: Schema.String,
  workType: Schema.String,
  verdict: Schema.String,
  note: Schema.String,
  confidence: Schema.NullOr(Schema.Number),
})
const CliObservationArraySchema = Schema.fromJsonString(Schema.Array(CliObservationSchema))
beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})
test("routing observations are idempotent, filtered, and newest first", async () => {
  const dbPath = join(tmpDir, `routing-observations-${runId}.sqlite`)
  const program = Effect.gen(function* () {
    const store = yield* RoutingStore

    expect((yield* store.recordObservation({
      id: "obs-1",
      ts: 1_000,
      machine: "m1",
      lane: "lane-a",
      workType: "retrieval",
      verdict: "strength",
      note: "Good retrieval on compact prompts.",
      confidence: 0.7,
    })).inserted).toBe(true)
    expect((yield* store.recordObservation({
      id: "obs-1",
      ts: 1_000,
      machine: "m1",
      lane: "lane-a",
      workType: "retrieval",
      verdict: "strength",
      note: "Duplicate is ignored by caller supplied id.",
      confidence: 0.1,
    })).inserted).toBe(false)
    yield* store.recordObservation({
      id: "obs-2",
      ts: 1_200,
      machine: "m1",
      lane: "lane-a",
      workType: "retrieval",
      verdict: "weakness",
      note: "Needs teardown supervision.",
    })
    yield* store.recordObservation({
      id: "obs-3",
      ts: 1_100,
      machine: "m2",
      lane: "lane-b",
      workType: "ui-design",
      verdict: "strength",
      note: "Strong design synthesis.",
    })

    expect((yield* store.listObservations({ limit: 10 })).map((row) => row.id)).toEqual(["obs-2", "obs-3", "obs-1"])
    expect((yield* store.listObservations({ lane: "lane-a" })).map((row) => row.id)).toEqual(["obs-2", "obs-1"])
    expect((yield* store.listObservations({ workType: "retrieval", verdict: "strength" })).map((row) => row.id)).toEqual(["obs-1"])
    expect((yield* store.listObservations({ sinceTs: 1_100 })).map((row) => row.id)).toEqual(["obs-2", "obs-3"])
  })

  await Effect.runPromise(program.pipe(Effect.provide(openRoutingStore(dbPath))))
})

test("lane state upserts and reads one or all lanes", async () => {
  const dbPath = join(tmpDir, `routing-lanes-${runId}.sqlite`)
  const program = Effect.gen(function* () {
    const store = yield* RoutingStore

    expect((yield* store.setLaneState({
      lane: "lane-a",
      updatedTs: 1_000,
      updatedBy: "test",
      status: "available",
      costTier: "subscription",
      defaultFor: "retrieval",
      notes: "initial",
    })).written).toBe(true)
    yield* store.setLaneState({
      lane: "lane-a",
      updatedTs: 2_000,
      updatedBy: "test-2",
      status: "degraded",
      exhaustedUntilTs: 3_000,
      costTier: "scarce",
      defaultFor: "retrieval,qa",
      notes: "updated",
    })
    yield* store.setLaneState({ lane: "lane-b", updatedTs: 1_500, updatedBy: "test", status: "retired" })

    const lane = yield* store.getLaneState("lane-a")
    expect(Array.isArray(lane)).toBe(false)
    expect(lane).toMatchObject({ lane: "lane-a", updatedTs: 2_000, status: "degraded", exhaustedUntilTs: 3_000, notes: "updated" })

    const all = yield* store.getLaneState()
    expect(Array.isArray(all)).toBe(true)
    expect(all).toMatchObject([{ lane: "lane-a" }, { lane: "lane-b" }])
  })

  await Effect.runPromise(program.pipe(Effect.provide(openRoutingStore(dbPath))))
})

test("lane brief composes state with recent observations per lane", async () => {
  const dbPath = join(tmpDir, `routing-brief-${runId}.sqlite`)
  const program = Effect.gen(function* () {
    const store = yield* RoutingStore
    yield* store.setLaneState({ lane: "lane-a", updatedTs: 1_000, updatedBy: "test", status: "available" })
    yield* store.recordObservation({ id: "brief-1", ts: 1_000, machine: "m1", lane: "lane-a", workType: "retrieval", verdict: "strength", note: "First." })
    yield* store.recordObservation({ id: "brief-2", ts: 1_100, machine: "m1", lane: "lane-a", workType: "retrieval", verdict: "weakness", note: "Second." })
    yield* store.recordObservation({ id: "brief-3", ts: 1_200, machine: "m1", lane: "lane-b", workType: "qa", verdict: "strength", note: "Observation-only lane." })

    const brief = yield* store.laneBrief({ observationsPerLane: 1 })
    expect(brief.entries.map((entry) => entry.lane)).toEqual(["lane-a", "lane-b"])
    expect(brief.entries[0]?.state?.status).toBe("available")
    expect(brief.entries[0]?.observations.map((row) => row.id)).toEqual(["brief-2"])
    expect(brief.entries[1]?.state).toBeNull()
    expect(brief.entries[1]?.observations.map((row) => row.id)).toEqual(["brief-3"])
  })

  await Effect.runPromise(program.pipe(Effect.provide(openRoutingStore(dbPath))))
})

test("routing CLI observe then log --json round trips", () => {
  const dbPath = join(tmpDir, `routing-cli-${runId}.sqlite`)
  const observe = Bun.spawnSync([
    "bun",
    "src/cli.ts",
    "routing",
    "observe",
    "--db",
    dbPath,
    "--id",
    "cli-obs-1",
    "--ts",
    "1700",
    "--machine",
    "cli-machine",
    "--lane",
    "lane-cli",
    "--work-type",
    "computer-use-qa",
    "--verdict",
    "strength",
    "--note",
    "CLI observation.",
    "--confidence",
    "0.8",
    "--json",
  ], { cwd: packageDir, stdout: "pipe", stderr: "pipe" })
  expect(observe.exitCode).toBe(0)

  const log = Bun.spawnSync([
    "bun",
    "src/cli.ts",
    "routing",
    "log",
    "--db",
    dbPath,
    "--lane",
    "lane-cli",
    "--limit",
    "5",
    "--json",
  ], { cwd: packageDir, stdout: "pipe", stderr: "pipe" })
  expect(log.exitCode).toBe(0)

  const stdout = new TextDecoder().decode(log.stdout).trim()
  const rows = Schema.decodeUnknownSync(CliObservationArraySchema)(stdout)
  expect(rows).toEqual([{ id: "cli-obs-1", lane: "lane-cli", workType: "computer-use-qa", verdict: "strength", note: "CLI observation.", confidence: 0.8 }])
})

test("routing seed is idempotent", async () => {
  const dbPath = join(tmpDir, `routing-seed-${runId}.sqlite`)
  await Effect.runPromise(seedRoutingStore().pipe(Effect.provide(openRoutingStore(dbPath))))
  const sqlite = new Database(dbPath)
  const firstCount = sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM routing_observations").get()?.count ?? 0
  sqlite.close()

  await Effect.runPromise(seedRoutingStore().pipe(Effect.provide(openRoutingStore(dbPath))))
  const reopened = new Database(dbPath)
  try {
    const secondCount = reopened.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM routing_observations").get()?.count ?? 0
    expect(secondCount).toBe(firstCount)
    expect(secondCount).toBe(10)
  } finally {
    reopened.close()
  }
})
