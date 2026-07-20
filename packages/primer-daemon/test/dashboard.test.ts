import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

interface AskStreamMeta {
  question: string
  terms: string[]
  hits: EvidenceHit[]
  skipped: string[]
  model: string
  synthesisEnabled: boolean
}

interface AskStreamDone {
  elapsedMs: number
}

interface ParsedSseEvent {
  event: string
  data: unknown
}

interface CardResponse {
  id: number
  status: string
}

interface CardListResponse extends CardResponse {
  enrolled: boolean
}

interface EnrollResponse {
  itemId: number
  state: string
  due: string
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

type ReviewFeedKind = "proof" | "demo" | "note" | "decision" | "question" | "progress"
type ReviewFeedArtifactMedia = "audio" | "video" | "image" | "markdown" | "text" | "json" | "embed"

interface ReviewFeedArtifactResponse {
  label: string
  path?: string
  url?: string
  media: ReviewFeedArtifactMedia
}

interface ReviewFeedActionResponse {
  label: string
  cwd?: string
  command: string
  argv?: string[]
}

interface ReviewFeedLinkResponse {
  label: string
  href: string
}

interface ReviewFeedEntryResponse {
  schema: "xanadu-feed.v1"
  id: string
  ts: string
  stream: string
  kind: ReviewFeedKind
  title: string
  summary: string
  artifacts: ReviewFeedArtifactResponse[]
  actions: ReviewFeedActionResponse[]
  links: ReviewFeedLinkResponse[]
  needsInput: boolean
  tags: string[]
  parentId?: string
}

interface ReviewFeedResponse {
  entries: ReviewFeedEntryResponse[]
  pendingCount: number
}

interface AppErrorRecord {
  timestamp: string
  source: "backend" | "browser"
  message: string
  stack?: string
  context?: string
}

function makeDashboardPaths(name: string, env: Record<string, string | undefined> = {}): DaemonPaths {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  const browserDb = join(TEST_TMP_ROOT, `${name}.browser.sqlite`)
  const twitterDb = join(TEST_TMP_ROOT, `${name}.twitter.sqlite`)
  const readerDb = join(TEST_TMP_ROOT, `${name}.reader.sqlite`)
  const ledgerDb = join(TEST_TMP_ROOT, `${name}.ledger.sqlite`)
  const reviewFeed = join(TEST_TMP_ROOT, `${name}.feed.jsonl`)
  const errorLog = join(TEST_TMP_ROOT, `${name}.errors.log`)

  for (const path of [browserDb, twitterDb, readerDb, ledgerDb, reviewFeed, errorLog]) {
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
    PRIMER_REVIEW_FEED: reviewFeed,
    PRIMER_ERROR_LOG: errorLog,
    PRIMER_READER_SITE: env.PRIMER_READER_SITE,
  })
}

async function withDashboard(
  run: (fixture: DashboardFixture) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const paths = makeDashboardPaths(`dashboard-${nextDashboardId}`, env)
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

function parseSseEvents(text: string): ParsedSseEvent[] {
  return text
    .split("\n\n")
    .filter((block) => block.length > 0)
    .map((block) => {
      let event = ""
      const data: string[] = []
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice("event: ".length)
        if (line.startsWith("data: ")) data.push(line.slice("data: ".length))
      }
      if (event.length === 0 || data.length === 0) throw new Error(`invalid SSE block: ${block}`)
      return { event, data: JSON.parse(data.join("\n")) as unknown }
    })
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

  test("serves the reader site only on meltdown and reader hosts", async () => {
    const readerSite = join(TEST_TMP_ROOT, "fixture-reader-site")
    const secret = join(TEST_TMP_ROOT, "secret")
    rmSync(readerSite, { force: true, recursive: true })
    rmSync(secret, { force: true })
    mkdirSync(join(readerSite, "assets"), { recursive: true })
    writeFileSync(join(readerSite, "index.html"), "<!doctype html><html><body><h1>Meltdown Reader</h1></body></html>")
    writeFileSync(join(readerSite, "assets", "x.js"), "globalThis.readerAsset = true;\n")
    writeFileSync(secret, "outside reader root\n")

    try {
      await withDashboard(async ({ baseUrl }) => {
        const host = { host: "meltdown.localhost" }
        const index = await fetch(`${baseUrl}/`, { headers: host })
        const asset = await fetch(`${baseUrl}/assets/x.js`, { headers: host })
        const readerAsset = await fetch(`${baseUrl}/assets/x.js`, { headers: { host: "reader.localhost" } })
        const traversal = await fetch(`${baseUrl}/%2e%2e%2fsecret`, { headers: host })
        const readerStatus = await requestJson<ErrorResponse>(baseUrl, "/api/status", { headers: host })
        const dashboardStatus = await fetch(`${baseUrl}/api/status`)

        expect(index.status).toBe(200)
        expect(await index.text()).toContain("Meltdown Reader")
        expect(asset.status).toBe(200)
        expect(await asset.text()).toContain("readerAsset")
        expect(readerAsset.status).toBe(200)
        expect(await readerAsset.text()).toContain("readerAsset")
        expect(traversal.status).toBeGreaterThanOrEqual(400)
        expect(readerStatus.response.status).toBe(404)
        expect(readerStatus.body).toEqual({ error: "unknown route" })
        expect(dashboardStatus.status).toBe(200)
      }, { PRIMER_READER_SITE: readerSite })
    } finally {
      rmSync(readerSite, { force: true, recursive: true })
      rmSync(secret, { force: true })
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

  test("streams meta and done while synthesis is disabled", async () => {
    await withDashboard(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/ask/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Find cybernetics", limit: 5 }),
      })
      const raw = await response.text()
      const events = parseSseEvents(raw)

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type") ?? "").toContain("text/event-stream")
      expect(events.map((event) => event.event)).toEqual(["meta", "done"])

      const meta = events[0]?.data as AskStreamMeta
      expect(Object.keys(meta)).toEqual(["question", "terms", "hits", "skipped", "model", "synthesisEnabled"])
      expect(meta.question).toBe("Find cybernetics")
      expect(meta.terms).toEqual(["find", "cybernetics"])
      expect(meta.hits.map((hit) => hit.ref)).toContain("browser:tab_entries:1")
      expect(meta.skipped).toEqual([])
      expect(meta.model).toBe("google-antigravity/gemini-3.5-flash")
      expect(meta.synthesisEnabled).toBe(false)

      expect(events[1]?.data as AskStreamDone).toEqual({ elapsedMs: 0 })
      expect(Object.keys(events[1]?.data as AskStreamDone)).toEqual(["elapsedMs"])
      expect(raw).toBe(`event: meta\ndata: ${JSON.stringify(meta)}\n\nevent: done\ndata: {"elapsedMs":0}\n\n`)
    }, { PRIMER_ASK_SYNTHESIS: "0" })
  })

  test("returns JSON 400 for malformed ask stream bodies", async () => {
    await withDashboard(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/ask/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
      const body = (await response.json()) as ErrorResponse

      expect(response.status).toBe(400)
      expect(response.headers.get("content-type") ?? "").toContain("application/json")
      expect(response.headers.get("content-type") ?? "").not.toContain("text/event-stream")
      expect(body).toEqual({ error: "malformed JSON body" })
    })
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

  test("filters cards by enrollment and enrolls approved candidates", async () => {
    await withDashboard(async ({ baseUrl, paths }) => {
      const db = openLedger(paths.ledgerDb)
      let candidateId = 0
      let approvedId = 0
      try {
        candidateId = addCard(db, { front: "候选", back: "candidate" }).id
        approvedId = addCard(db, { front: "批准", back: "approved" }).id
      } finally {
        db.close()
      }

      const approved = await requestJson<CardResponse>(baseUrl, "/api/cards/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: approvedId, status: "approved" }),
      })
      const all = await requestJson<CardListResponse[]>(baseUrl, "/api/cards?status=all&limit=10")
      const enrolled = await requestJson<EnrollResponse>(baseUrl, "/api/review/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: approvedId }),
      })
      const enrolledList = await requestJson<CardListResponse[]>(baseUrl, "/api/cards?status=enrolled&limit=10")
      const candidateEnroll = await requestJson<ErrorResponse>(baseUrl, "/api/review/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: candidateId }),
      })

      expect(approved.response.status).toBe(200)
      expect(all.response.status).toBe(200)
      expect(all.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: candidateId, status: "candidate", enrolled: false }),
        expect.objectContaining({ id: approvedId, status: "approved", enrolled: false }),
      ]))
      expect(enrolled.response.status).toBe(200)
      expect(enrolled.body.itemId).toBe(approvedId)
      expect(enrolledList.body).toEqual([expect.objectContaining({ id: approvedId, enrolled: true })])
      expect(candidateEnroll.response.status).toBe(409)
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
  test("appends canonical review answers and rejects invalid or duplicate answers", async () => {
    await withDashboard(async ({ baseUrl, paths }) => {
      const timestamp = "2026-07-19T00:00:00.000Z"
      const seedEntries = [
        {
          schema: "xanadu-feed.v1",
          id: "primer-question",
          ts: timestamp,
          stream: "primer",
          kind: "question",
          title: "Which title?",
          summary: "Choose the final title.",
          tags: ["review"],
        },
        {
          schema: "xanadu-feed.v1",
          id: "primer-input",
          ts: timestamp,
          stream: "primer",
          kind: "note",
          title: "Which source?",
          summary: "Choose the primary source.",
          needsInput: true,
        },
        {
          schema: "xanadu-feed.v1",
          id: "other-question",
          ts: timestamp,
          stream: "companion",
          kind: "question",
          title: "Unrelated question",
          summary: "This belongs to another stream.",
        },
      ]
      writeFileSync(paths.reviewFeed, seedEntries.map((entry) => JSON.stringify(entry)).join("\n"), "utf8")

      const created = await requestJson<ReviewFeedEntryResponse>(baseUrl, "/api/review-feed/primer-question/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "  Use the concise title.  " }),
      })

      expect(created.response.status).toBe(200)
      expect(created.body).toMatchObject({
        schema: "xanadu-feed.v1",
        stream: "primer",
        kind: "note",
        title: "Re: Which title?",
        summary: "Use the concise title.",
        artifacts: [],
        actions: [],
        links: [],
        needsInput: false,
        tags: ["review"],
        parentId: "primer-question",
      })
      expect(created.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
      expect(Number.isNaN(Date.parse(created.body.ts))).toBe(false)

      const contentsAfterAnswer = readFileSync(paths.reviewFeed, "utf8")
      const persistedEntries = contentsAfterAnswer
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown)
      expect(persistedEntries.slice(0, -1)).toEqual(seedEntries)
      expect(persistedEntries.at(-1)).toEqual(created.body)
      expect(contentsAfterAnswer.endsWith("\n")).toBe(true)

      const listed = await requestJson<ReviewFeedResponse>(baseUrl, "/api/review-feed")
      expect(listed.response.status).toBe(200)
      expect(listed.body.entries.map((entry) => entry.id)).toEqual(["primer-question", "primer-input", created.body.id])
      expect(listed.body.pendingCount).toBe(1)
      expect(listed.body.entries[0]).toEqual({
        schema: "xanadu-feed.v1",
        id: "primer-question",
        ts: timestamp,
        stream: "primer",
        kind: "question",
        title: "Which title?",
        summary: "Choose the final title.",
        artifacts: [],
        actions: [],
        links: [],
        needsInput: false,
        tags: ["review"],
      })

      const duplicate = await requestJson<ErrorResponse>(baseUrl, "/api/review-feed/primer-question/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "A second answer" }),
      })
      const blank = await requestJson<ErrorResponse>(baseUrl, "/api/review-feed/primer-input/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: " \n\t " }),
      })
      const missing = await requestJson<ErrorResponse>(baseUrl, "/api/review-feed/missing-question/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "Nothing to answer" }),
      })
      const wrongStream = await requestJson<ErrorResponse>(baseUrl, "/api/review-feed/other-question/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "Do not append this" }),
      })

      expect(duplicate.response.status).toBe(409)
      expect(duplicate.body).toEqual({ error: "review feed target has already been answered" })
      expect(blank.response.status).toBe(400)
      expect(blank.body).toEqual({ error: "summary must not be blank" })
      expect(missing.response.status).toBe(404)
      expect(missing.body).toEqual({ error: "review feed target not found" })
      expect(wrongStream.response.status).toBe(400)
      expect(wrongStream.body).toEqual({ error: "review feed target is not in the primer stream" })
      expect(readFileSync(paths.reviewFeed, "utf8")).toBe(contentsAfterAnswer)
    })
  })

  test("logs backend and bounded browser errors as valid JSONL without changing responses", async () => {
    await withDashboard(async ({ baseUrl, paths }) => {
      writeFileSync(
        paths.reviewFeed,
        `${JSON.stringify({
          schema: "xanadu-feed.v1",
          id: "valid",
          stream: "primer",
          ts: "2026-07-19T00:00:00.000Z",
          kind: "note",
          title: "Valid",
          summary: "Valid",
        })}\n{malformed}\n`,
        "utf8",
      )

      const backendFailure = await requestJson<ErrorResponse>(baseUrl, "/api/review-feed")
      expect(backendFailure.response.status).toBe(500)
      expect(backendFailure.response.headers.get("content-type") ?? "").toContain("application/json")
      expect(backendFailure.body.error).toContain("invalid review feed line 2")

      const browserFailure = await fetch(`${baseUrl}/api/errors/browser`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: `bad\u0000${"m".repeat(2_100)}`,
          stack: "s".repeat(16_100),
          context: "c".repeat(4_100),
        }),
      })
      const invalidBrowserFailure = await fetch(`${baseUrl}/api/errors/browser`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json}",
      })

      expect(browserFailure.status).toBe(204)
      expect(await browserFailure.text()).toBe("")
      expect(invalidBrowserFailure.status).toBe(204)
      expect(await invalidBrowserFailure.text()).toBe("")

      const logContents = readFileSync(paths.errorLog, "utf8")
      const records = logContents
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as AppErrorRecord)
      expect(records).toHaveLength(2)
      expect(logContents.endsWith("\n")).toBe(true)

      const backendRecord = records[0]
      expect(backendRecord).toMatchObject({
        source: "backend",
        context: "GET /api/review-feed",
      })
      expect(backendRecord?.message).toContain("invalid review feed line 2")
      expect(Number.isNaN(Date.parse(backendRecord?.timestamp ?? ""))).toBe(false)

      const browserRecord = records[1]
      expect(browserRecord?.source).toBe("browser")
      expect(browserRecord?.message).toHaveLength(2_000)
      expect(browserRecord?.stack).toHaveLength(16_000)
      expect(browserRecord?.context).toHaveLength(4_000)
      expect(browserRecord?.message).toContain("bad�")
      expect(browserRecord?.message).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u)
      expect(Number.isNaN(Date.parse(browserRecord?.timestamp ?? ""))).toBe(false)
    })
  })

})
