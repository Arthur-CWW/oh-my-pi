import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"

import { LEDGER_SCHEMA_VERSION, migrateLedger, setDurabilityPragmas } from "../src/migrate"
import { queryUsageByAgent, queryUsageByLaneHour, queryUsageBySession } from "../src/stats"

const tmpDir = join(import.meta.dir, ".tmp", "stats")
const dbPath = join(tmpDir, "stats-fixture.sqlite")

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })

  const sqlite = new Database(dbPath)
  try {
    setDurabilityPragmas(sqlite)
    migrateLedger(sqlite)

    const insert = sqlite.prepare(`
      INSERT INTO model_calls (
        id, ts, machine, session, branchId, agent, model, provider, effort,
        promptHash, systemPromptHash, skillProfile, contextManifest, packetId,
        tokensIn, tokensOut, cacheRead, cacheWrite, cost, latencyMs, outcome,
        rawRequestArtifact, rawResponseArtifact
      ) VALUES (
        ?, ?, 'm1', ?, 'branch-1', ?, ?, ?, 'medium',
        'ph', 'sph', 'sk', 'ctx', 'pkt',
        ?, ?, ?, 0, ?, ?, 'ok',
        'rr', 'rr'
      )
    `)

    //                 id               ts        session  agent    model          provider    tokensIn tokensOut cacheRead cost  latencyMs
    insert.run("mc-1", 60_000,   "s1", "Main", "claude-opus-4", "anthropic", 600, 300, 400, 0.10, 500)
    insert.run("mc-2", 120_000,  "s1", "Main", "claude-opus-4", "anthropic", 400, 200, 300, 0.08, 400)
    insert.run("mc-3", 180_000,  "s1", "Sub1", "gpt-4o",        "openai",    300, 150, 0,   0.05, 300)
    insert.run("mc-4", 3_660_000,"s2", "Main", "claude-opus-4", "anthropic", 500, 250, 200, 0.12, 600)
  } finally {
    sqlite.close()
  }
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test("migration version is 4", () => {
  expect(LEDGER_SCHEMA_VERSION).toBe(4)
  const sqlite = new Database(dbPath)
  try {
    const version = sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? -1
    expect(version).toBe(4)
  } finally {
    sqlite.close()
  }
})

test("views exist in sqlite_master", () => {
  const sqlite = new Database(dbPath)
  try {
    const views = sqlite.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name",
    ).all().map((row) => row.name)
    expect(views).toEqual(["usage_by_agent", "usage_by_lane_hour", "usage_by_session"])
  } finally {
    sqlite.close()
  }
})

test("usage_by_lane_hour aggregates correctly", async () => {
  const rows = await Effect.runPromise(queryUsageByLaneHour(dbPath))

  // hourBucket=0 has mc-1, mc-2 (anthropic/claude-opus-4) and mc-3 (openai/gpt-4o)
  // hourBucket=3600000 has mc-4 (anthropic/claude-opus-4)
  expect(rows.length).toBe(3)

  const anthHour1 = rows.find((r) => r.lane === "anthropic/claude-opus-4" && r.hourBucket === 3_600_000)!
  expect(anthHour1).toBeDefined()
  expect(anthHour1.calls).toBe(1)
  expect(anthHour1.tokensIn).toBe(500)
  expect(anthHour1.tokensOut).toBe(250)
  expect(anthHour1.cacheRead).toBe(200)
  expect(anthHour1.cost).toBeCloseTo(0.12, 5)
  expect(anthHour1.avgLatencyMs).toBe(600)
  // tokensPerMinute = (500 + 250) / 60.0 = 12.5
  expect(anthHour1.tokensPerMinute).toBeCloseTo(12.5, 5)

  const anthHour0 = rows.find((r) => r.lane === "anthropic/claude-opus-4" && r.hourBucket === 0)!
  expect(anthHour0).toBeDefined()
  expect(anthHour0.calls).toBe(2)
  expect(anthHour0.tokensIn).toBe(1000)
  expect(anthHour0.tokensOut).toBe(500)
  expect(anthHour0.cacheRead).toBe(700)
  expect(anthHour0.cost).toBeCloseTo(0.18, 5)
  expect(anthHour0.avgLatencyMs).toBe(450)
  // tokensPerMinute = (1000 + 500) / 60.0 = 25
  expect(anthHour0.tokensPerMinute).toBeCloseTo(25, 5)

  const oaiHour0 = rows.find((r) => r.lane === "openai/gpt-4o" && r.hourBucket === 0)!
  expect(oaiHour0).toBeDefined()
  expect(oaiHour0.calls).toBe(1)
  expect(oaiHour0.tokensIn).toBe(300)
  expect(oaiHour0.tokensOut).toBe(150)
  // tokensPerMinute = (300 + 150) / 60.0 = 7.5
  expect(oaiHour0.tokensPerMinute).toBeCloseTo(7.5, 5)
})

test("usage_by_agent aggregates with tokensPerMinute over active span", async () => {
  const rows = await Effect.runPromise(queryUsageByAgent(dbPath))

  // Main + anthropic/claude-opus-4: calls 1,2,4 => ts range [60000, 3660000]
  const mainAnth = rows.find((r) => r.agent === "Main" && r.lane === "anthropic/claude-opus-4")!
  expect(mainAnth).toBeDefined()
  expect(mainAnth.calls).toBe(3)
  expect(mainAnth.tokensIn).toBe(1500)
  expect(mainAnth.tokensOut).toBe(750)
  expect(mainAnth.cacheRead).toBe(900)
  expect(mainAnth.cost).toBeCloseTo(0.30, 5)
  expect(mainAnth.firstTs).toBe(60_000)
  expect(mainAnth.lastTs).toBe(3_660_000)
  // span = 3660000 - 60000 = 3600000 ms = 60 minutes
  // tokensPerMinute = (1500 + 750) * 60000 / 3600000 = 2250 * 60000 / 3600000 = 37.5
  expect(mainAnth.tokensPerMinute).toBeCloseTo(37.5, 5)

  // Sub1 + openai/gpt-4o: single call => span=0 => tokensPerMinute=0
  const sub1Oai = rows.find((r) => r.agent === "Sub1" && r.lane === "openai/gpt-4o")!
  expect(sub1Oai).toBeDefined()
  expect(sub1Oai.calls).toBe(1)
  expect(sub1Oai.tokensPerMinute).toBe(0)
})

test("usage_by_session newest first with correct aggregates", async () => {
  const rows = await Effect.runPromise(queryUsageBySession(dbPath))

  // s2 has newest (ts=3660000), so comes first
  expect(rows[0]!.session).toBe("s2")
  expect(rows[0]!.lane).toBe("anthropic/claude-opus-4")
  expect(rows[0]!.calls).toBe(1)
  expect(rows[0]!.tokensPerMinute).toBe(0) // single call

  // s1 + anthropic/claude-opus-4: calls 1,2 => ts [60000, 120000]
  const s1Anth = rows.find((r) => r.session === "s1" && r.lane === "anthropic/claude-opus-4")!
  expect(s1Anth.calls).toBe(2)
  expect(s1Anth.tokensIn).toBe(1000)
  expect(s1Anth.tokensOut).toBe(500)
  expect(s1Anth.firstTs).toBe(60_000)
  expect(s1Anth.lastTs).toBe(120_000)
  // span = 60000 ms = 1 minute
  // tokensPerMinute = (1000 + 500) * 60000 / 60000 = 1500
  expect(s1Anth.tokensPerMinute).toBeCloseTo(1500, 5)

  // s1 + openai/gpt-4o: single call
  const s1Oai = rows.find((r) => r.session === "s1" && r.lane === "openai/gpt-4o")!
  expect(s1Oai.calls).toBe(1)
  expect(s1Oai.tokensPerMinute).toBe(0)
})

test("--since filter excludes earlier data", async () => {
  // sinceTs=3600000 should only include mc-4
  const laneRows = await Effect.runPromise(queryUsageByLaneHour(dbPath, { sinceTs: 3_600_000 }))
  expect(laneRows.length).toBe(1)
  expect(laneRows[0]!.lane).toBe("anthropic/claude-opus-4")
  expect(laneRows[0]!.calls).toBe(1)
  expect(laneRows[0]!.tokensIn).toBe(500)

  const agentRows = await Effect.runPromise(queryUsageByAgent(dbPath, { sinceTs: 3_600_000 }))
  expect(agentRows.length).toBe(1)
  expect(agentRows[0]!.agent).toBe("Main")
  expect(agentRows[0]!.calls).toBe(1)

  const sessionRows = await Effect.runPromise(queryUsageBySession(dbPath, { sinceTs: 3_600_000 }))
  expect(sessionRows.length).toBe(1)
  expect(sessionRows[0]!.session).toBe("s2")
})
