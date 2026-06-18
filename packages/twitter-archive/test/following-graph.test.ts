import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { captureNitterFollowingToSqlite, importFollowingExportToSqlite, initTwitterArchiveSqliteStore, parseFollowingExport, parseNitterFollowingPage } from "../src"
import { readFixture } from "./fixtures/read-fixture"

const observedAt = "2026-06-18T00:00:00.000Z"

describe("following graph capture", () => {
  test("parses a public Nitter following page without live network", async () => {
    const html = await readFixture("nitter-following.html")
    const page = parseNitterFollowingPage(html, "sourceUser", {
      sourceUrl: "https://nitter.example/sourceUser/following",
      observedAt,
    })

    expect(page.sourceAccount).toMatchObject({ username: "sourceUser", displayName: "Source User" })
    expect(page.targets.map((target) => target.username)).toEqual(["targetOne", "targetTwo"])
    expect(page.edges.map((edge) => [edge.sourceAccount.username, edge.targetAccount.username, edge.relation])).toEqual([
      ["sourceUser", "targetOne", "following"],
      ["sourceUser", "targetTwo", "following"],
    ])
    expect(page.nextPageUrl).toBe("https://nitter.example/sourceUser/following?cursor=abc123")
  })

  test("imports JSON and CSV following exports with explicit source account", async () => {
    const json = await readFixture("following-export.json")
    const csv = await readFixture("following-export.csv")

    expect(parseFollowingExport(json, { observedAt }).targets.map((target) => target.username)).toEqual(["targetOne", "targetTwo"])
    expect(parseFollowingExport(csv, { observedAt }).sourceAccount.username).toBe("sourceUser")
  })

  test("stores Nitter following edges, provenance, raw page, and graph summary", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-following-"))
    const store = initTwitterArchiveSqliteStore(join(tempDir, "archive.sqlite"))
    const html = await readFixture("nitter-following.html")

    try {
      const captured = await captureNitterFollowingToSqlite("sourceUser", {
        store,
        baseUrl: "https://nitter.example",
        maxPages: 1,
        observedAt,
        importBatchId: "following-batch-1",
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
          text: async () => html,
        }),
      })

      expect(captured.importResult.totalEdges).toBe(2)
      expect(store.getCachedPage({ source: "nitter-following", url: "https://nitter.example/sourceUser/following" })?.body).toBe(html)
      expect(
        store
          .listSocialGraphEdges()
          .map((edge) => ({ source: edge.sourceAccountKey, target: edge.targetAccountKey, batch: edge.importBatchId }))
          .sort((left, right) => left.target.localeCompare(right.target)),
      ).toEqual([
        { source: "x:sourceuser", target: "x:targetone", batch: "following-batch-1" },
        { source: "x:sourceuser", target: "x:targettwo", batch: "following-batch-1" },
      ])
      expect(store.getSocialGraphSummary(10)).toMatchObject({ nodes: 3, edges: 2, followingEdges: 2 })
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("imports following export edges into the shared store", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "twitter-archive-following-export-"))
    const store = initTwitterArchiveSqliteStore(join(tempDir, "archive.sqlite"))
    const csv = await readFixture("following-export.csv")

    try {
      const result = importFollowingExportToSqlite(csv, { store, importBatchId: "export-batch-1", observedAt })
      expect(result.totalEdges).toBe(2)
      expect(store.getSocialGraphSummary(10).topSources).toEqual([{ accountKey: "x:sourceuser", username: "sourceUser", displayName: "Source User", edgeCount: 2 }])
    } finally {
      store.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
