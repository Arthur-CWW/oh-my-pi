import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { buildSynthesisPrompt, isForbiddenModel, resolveAskSynthesisConfig } from "../src/ask-synthesis"
import { startDashboard } from "../src/dashboard"
import { addCard, openLedger } from "../src/ledger"
import { resolveDaemonPaths, type DaemonPaths } from "../src/paths"
import type { EvidenceHit } from "../src/schema"

const TEST_TMP_ROOT = new URL(".tmp/", import.meta.url).pathname
let nextDashboardId = 0

interface DashboardFixture {
  paths: DaemonPaths
  baseUrl: string
}

interface AskAnswer {
  text: string
  model: string
  elapsedMs: number
}

interface AskResponse {
  question: string
  terms: string[]
  hits: EvidenceHit[]
  skipped: string[]
  answer: AskAnswer | null
  answerError: string | null
}

interface CardResponse {
  id: number
  status: string
}

interface ProgressResponse {
  id: number
  kind: string
  title: string
  body: string | null
  refs: string[]
  createdAt: string
}

interface AskConfigResponse {
  model: string
  synthesisEnabled: boolean
}

interface ProofSummaryResponse {
  name: string
  title: string
  mtime: string
}

interface ErrorResponse {
  error: string
}

function makeDashboardPaths(name: string): DaemonPaths {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  const browserDb = join(TEST_TMP_ROOT, `${name}.browser.sqlite`)
  const twitterDb = join(TEST_TMP_ROOT, `${name}.twitter.sqlite`)
  const readerDb = join(TEST_TMP_ROOT, `${name}.reader.sqlite`)
  const ledgerDb = join(TEST_TMP_ROOT, `${name}.ledger.sqlite`)

  for (const path of [browserDb, twitterDb, readerDb, ledgerDb]) {
    rmSync(path, { force: true })
  }

  createBrowserDb(browserDb)
  createTwitterDb(twitterDb)
  createReaderDb(readerDb)

  return resolveDaemonPaths({
    PRIMER_BROWSER_DB: browserDb,
    PRIMER_TWITTER_DB: twitterDb,
    PRIMER_READER_DB: readerDb,
    PRIMER_LEDGER_DB: ledgerDb,
  })
}

async function withDashboard(
  run: (fixture: DashboardFixture) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const paths = makeDashboardPaths(`dashboard-${nextDashboardId}`)
  nextDashboardId += 1
  const server = startDashboard({ port: 0, paths, env: { PRIMER_ASK_SYNTHESIS: "0", ...env } })
  try {
    await run({ paths, baseUrl: `http://localhost:${server.port}` })
  } finally {
    await server.stop(true)
  }
}

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, init)
  const body = (await response.json()) as T
  return { response, body }
}

function createBrowserDb(path: string): void {
  const db = new Database(path)
  try {
    db.exec(`
CREATE TABLE tab_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tab_id INTEGER NOT NULL,
    entry_index INTEGER NOT NULL,
    url TEXT,
    title TEXT,
    doc_identifier TEXT,
    subframe INTEGER NOT NULL DEFAULT 0,
    last_accessed INTEGER,
    scroll_x INTEGER,
    scroll_y INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER,
    event_type TEXT NOT NULL,
    observed_at INTEGER,
    browser TEXT,
    profile_id INTEGER,
    window_source_id TEXT,
    tab_source_id TEXT,
    url TEXT,
    title TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
    db.query(
      "INSERT INTO tab_entries (id, tab_id, entry_index, url, title, last_accessed) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(1, 1, 0, "https://example.test/cybernetics", "Cybernetics Primer", 1_700_000_000_000)
  } finally {
    db.close()
  }
}

function createTwitterDb(path: string): void {
  const db = new Database(path)
  try {
    db.exec(`
CREATE TABLE tweets (
    id TEXT PRIMARY KEY,
    username TEXT,
    url TEXT,
    data_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
);
`)
  } finally {
    db.close()
  }
}

function createReaderDb(path: string): void {
  const db = new Database(path)
  try {
    db.exec(`
CREATE TABLE annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    note TEXT,
    tags TEXT,
    created_at TEXT
);
CREATE TABLE works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT
);
CREATE TABLE source_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER,
    text TEXT
);
CREATE TABLE concepts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    short_note TEXT,
    long_note TEXT
);
`)
  } finally {
    db.close()
  }
}

describe("ask synthesis helpers", () => {
  test("resolves model config and refuses forbidden lanes", () => {
    expect(resolveAskSynthesisConfig({})).toEqual({
      model: "google-antigravity/gemini-3.5-flash",
      enabled: true,
    })
    expect(resolveAskSynthesisConfig({ PRIMER_ASK_MODEL: "openrouter/custom-flash" })).toEqual({
      model: "openrouter/custom-flash",
      enabled: true,
    })
    expect(resolveAskSynthesisConfig({ PRIMER_ASK_SYNTHESIS: "0" })).toEqual({
      model: "google-antigravity/gemini-3.5-flash",
      enabled: false,
    })
    expect(resolveAskSynthesisConfig({ PRIMER_ASK_MODEL: "vendor/Fable-pro" })).toEqual({
      model: "vendor/Fable-pro",
      enabled: false,
    })
    expect(resolveAskSynthesisConfig({ PRIMER_ASK_MODEL: "vendor/mythos-pro" })).toEqual({
      model: "vendor/mythos-pro",
      enabled: false,
    })
    expect(isForbiddenModel("vendor/Fable-pro")).toBe(true)
    expect(isForbiddenModel("vendor/Mythos-pro")).toBe(true)
  })

  test("builds prompts with the question and evidence refs", () => {
    const prompt = buildSynthesisPrompt("What did the browser show?", [
      {
        source: "browser",
        kind: "event",
        ref: "browser:events:241",
        url: "https://example.test/event",
        title: "Browser Event",
        snippet: "Arthur looked at the primer stream.",
        timestamp: "2026-07-03T08:00:00.000Z",
        score: 12,
      },
    ])

    expect(prompt).toContain("What did the browser show?")
    expect(prompt).toContain("browser:events:241")
    expect(prompt).toContain("Arthur looked at the primer stream.")
  })
})

describe("dashboard", () => {
  test("returns 503 JSON when the web UI is not built", async () => {
    const missingDist = join(TEST_TMP_ROOT, "missing-web-dist")
    rmSync(missingDist, { force: true, recursive: true })

    await withDashboard(async ({ baseUrl }) => {
      const { response, body } = await requestJson<ErrorResponse>(baseUrl, "/")

      expect(response.status).toBe(503)
      expect(response.headers.get("content-type") ?? "").toContain("application/json")
      expect(body).toEqual({ error: "web ui not built — run bun run web:build" })
    }, { PRIMER_WEB_DIST: missingDist })
  })

  test("serves the built web index from PRIMER_WEB_DIST", async () => {
    const webDist = join(TEST_TMP_ROOT, "fixture-web-dist")
    rmSync(webDist, { force: true, recursive: true })
    mkdirSync(webDist, { recursive: true })
    writeFileSync(join(webDist, "index.html"), "<!doctype html><html><body><h1>Primer Daemon</h1></body></html>")

    try {
      await withDashboard(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/`)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type") ?? "").toContain("text/html")
        expect(html).toContain("Primer Daemon")
      }, { PRIMER_WEB_DIST: webDist })
    } finally {
      rmSync(webDist, { force: true, recursive: true })
    }
  })

  test("exposes ask synthesis config", async () => {
    await withDashboard(async ({ baseUrl }) => {
      const { response, body } = await requestJson<AskConfigResponse>(baseUrl, "/api/ask/config")

      expect(response.status).toBe(200)
      expect(body).toEqual({
        model: "openrouter/custom-flash",
        synthesisEnabled: true,
      })
    }, { PRIMER_ASK_MODEL: "openrouter/custom-flash", PRIMER_ASK_SYNTHESIS: undefined })
  })

  test("answers questions with retrieval hits while synthesis is disabled", async () => {
    await withDashboard(async ({ baseUrl }) => {
      const config = await requestJson<AskConfigResponse>(baseUrl, "/api/ask/config")
      const { response, body } = await requestJson<AskResponse>(baseUrl, "/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Find cybernetics", limit: 5 }),
      })

      expect(config.response.status).toBe(200)
      expect(config.body).toEqual({
        model: "google-antigravity/gemini-3.5-flash",
        synthesisEnabled: false,
      })
      expect(response.status).toBe(200)
      expect(body.question).toBe("Find cybernetics")
      expect(body.terms).toEqual(["find", "cybernetics"])
      expect(body.hits.map((hit) => hit.ref)).toContain("browser:tab_entries:1")
      expect(body.skipped).toEqual([])
      expect(body.answer).toBeNull()
      expect(body.answerError).toBe("synthesis disabled")
    }, { PRIMER_ASK_SYNTHESIS: "0" })
  })

  test("updates card status and 404s unknown card ids", async () => {
    await withDashboard(async ({ baseUrl, paths }) => {
      const db = openLedger(paths.ledgerDb)
      let cardId = 0
      try {
        cardId = addCard(db, {
          front: "Who owns dashboard write-back state?",
          back: "The ledger DB.",
          sourceRef: "browser:tab_entries:1",
          url: "https://example.test/cybernetics",
        }).id
      } finally {
        db.close()
      }

      const updated = await requestJson<CardResponse>(baseUrl, "/api/cards/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: cardId, status: "approved" }),
      })
      const missing = await requestJson<ErrorResponse>(baseUrl, "/api/cards/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: cardId + 1, status: "rejected" }),
      })

      expect(updated.response.status).toBe(200)
      expect(updated.body).toMatchObject({ id: cardId, status: "approved" })
      expect(missing.response.status).toBe(404)
      expect(typeof missing.body.error).toBe("string")
    })
  })

  test("round-trips progress entries", async () => {
    await withDashboard(async ({ baseUrl }) => {
      const created = await requestJson<ProgressResponse>(baseUrl, "/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "proof", title: "Dashboard proof", body: "Smoke passed", refs: ["qa:dashboard"] }),
      })
      const listed = await requestJson<ProgressResponse[]>(baseUrl, "/api/progress?limit=10")

      expect(created.response.status).toBe(200)
      expect(created.body).toMatchObject({ kind: "proof", title: "Dashboard proof", body: "Smoke passed", refs: ["qa:dashboard"] })
      expect(listed.response.status).toBe(200)
      expect(listed.body[0]).toMatchObject({ id: created.body.id, kind: "proof", title: "Dashboard proof" })
    })
  })

  test("lists only primer stream proofs and 404s other markdown files", async () => {
    const proofDir = join(TEST_TMP_ROOT, "proof-scope")
    rmSync(proofDir, { force: true, recursive: true })
    mkdirSync(proofDir, { recursive: true })
    writeFileSync(join(proofDir, "primer-x.md"), "# Primer X\n\nProof body.\n")
    writeFileSync(join(proofDir, "other-stream.md"), "# Other Stream\n\nShould not be served.\n")

    try {
      await withDashboard(async ({ baseUrl }) => {
        const listed = await requestJson<ProofSummaryResponse[]>(baseUrl, "/api/proofs")
        const forbidden = await requestJson<ErrorResponse>(baseUrl, "/api/proofs/other-stream.md")

        expect(listed.response.status).toBe(200)
        expect(listed.body.map((proof) => proof.name)).toEqual(["primer-x.md"])
        expect(listed.body[0]?.title).toBe("Primer X")
        expect(forbidden.response.status).toBe(404)
        expect(typeof forbidden.body.error).toBe("string")
      }, { PRIMER_PROOFS_DIR: proofDir })
    } finally {
      rmSync(proofDir, { force: true, recursive: true })
    }
  })

  test("404s unknown proof names", async () => {
    await withDashboard(async ({ baseUrl }) => {
      const { response, body } = await requestJson<ErrorResponse>(baseUrl, "/api/proofs/not-a-proof.md")

      expect(response.status).toBe(404)
      expect(typeof body.error).toBe("string")
    })
  })
})
