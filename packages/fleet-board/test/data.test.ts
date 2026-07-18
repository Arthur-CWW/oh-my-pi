import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  parseOverviewJson,
  parseRegisterMarkdown,
  pathsAt,
  readRegisterSnapshot,
  readStateDoc,
} from "../src/data"
import { createRequestHandler } from "../src/server"

async function fixtureRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fleet-board-test-"))
}

describe("fleet overview data", () => {
  test("decodes rows and marks versions differing from the modal version", async () => {
    const root = await fixtureRoot()
    const overviewPath = join(root, "overview.json")
    await writeFile(
      overviewPath,
      JSON.stringify([
        {
          session_id: "peer-1",
          name: "One",
          state: "working",
          workstream: "harness",
          objective: "first",
          summary: "doing first",
          spawn_name: "worker",
          todo_head: "code",
          last_seen: "2026-07-18T00:00:00.000Z",
          cwd: root,
          pid: 101,
          session_journal: join(root, "peer-1.jsonl"),
          version: "16.0.1",
        },
        { session_id: "peer-2", state: "idle", version: "16.0.1" },
        { session_id: "peer-3", state: "working", version: "16.0.0" },
      ]),
    )
    const rows = parseOverviewJson(await readFile(overviewPath, "utf8"))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ sessionId: "peer-1", pid: 101, version: "16.0.1", versionSkew: false })
    expect(rows.map(row => row.versionSkew)).toEqual([false, false, true])
  })
})

describe("request register data", () => {
  test("parses markdown cards with long intents and formatted em-dash statuses", async () => {
    const longIntent = "A".repeat(240)
    const markdown = [
      "| ID | Exact intent | Status | Owner phase | Notes |",
      "|---|---|---|---|---|",
      `| HR-200 | ${longIntent} | **IMPLEMENTED — v1 live** | P1/P2 | note |`,
      "| HR-201 | Route provenance | DECIDED | P2 | note |",
    ].join("\n")
    const cards = parseRegisterMarkdown(markdown)
    expect(cards).toEqual([
      { id: "HR-200", intent: `${"A".repeat(199)}…`, status: "IMPLEMENTED", phase: "P1/P2" },
      { id: "HR-201", intent: "Route provenance", status: "DECIDED", phase: "P2" },
    ])

    const root = await fixtureRoot()
    const registerPath = join(root, "register.md")
    await writeFile(registerPath, markdown)
    const snapshot = await readRegisterSnapshot(registerPath)
    expect(snapshot.cards).toHaveLength(2)
  })
})

describe("state docs and client errors", () => {
  test("returns found state docs, cleanly misses absent docs, and appends browser errors", async () => {
    const root = await fixtureRoot()
    const paths = pathsAt(root)
    await mkdir(paths.stateDocsDir, { recursive: true })
    await mkdir(join(root, "docs", "fable"), { recursive: true })
    await writeFile(join(paths.stateDocsDir, "peer-1.md"), "# Peer one\n\nStatus: working\n")
    await writeFile(paths.registerPath, "| ID | Intent | Status | Phase |\n|---|---|---|---|\n")
    const handler = createRequestHandler({ paths, runOverview: async () => "[]" })

    const found = await handler(new Request("http://fleet-board.test/api/statedoc/peer-1"))
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ markdown: "# Peer one\n\nStatus: working\n" })
    const missing = await handler(new Request("http://fleet-board.test/api/statedoc/missing"))
    expect(missing.status).toBe(404)

    const clientError = await handler(
      new Request("http://fleet-board.test/client-error", {
        body: JSON.stringify({ message: "browser exploded" }),
        method: "POST",
      }),
    )
    expect(clientError.status).toBe(204)
    expect(await readFile(paths.errorLogPath, "utf8")).toContain("browser exploded")
  })
})
