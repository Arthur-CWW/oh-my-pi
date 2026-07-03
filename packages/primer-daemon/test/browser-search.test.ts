import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { searchBrowser } from "../src/substrate/browser"

const TAB_ENTRY_OLD_MS = 1_700_000_000_000
const EVENT_NEW_MS = 1_700_003_600_000

function withBrowserDb(run: (dbPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "primer-browser-search-"))
  try {
    const dbPath = join(root, "browser_context.sqlite")
    const db = new Database(dbPath)
    try {
      db.exec(`
CREATE TABLE tab_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tab_id INTEGER NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
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
    snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    observed_at INTEGER,
    browser TEXT,
    profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
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
      ).run(1, 1, 0, "https://notes.example/paper", "Vector Memory Index", TAB_ENTRY_OLD_MS)
      db.query(
        "INSERT INTO tab_entries (id, tab_id, entry_index, url, title, last_accessed) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(2, 2, 0, "https://notes.example/other", "Vector Memory Index", TAB_ENTRY_OLD_MS + 1)
      db.query(
        "INSERT INTO tab_entries (id, tab_id, entry_index, url, title, last_accessed) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(3, 3, 0, "https://papers.example/boring", "Garden Notes", TAB_ENTRY_OLD_MS + 2)
      db.query(
        "INSERT INTO tab_entries (id, tab_id, entry_index, url, title, last_accessed) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(4, 4, 0, "https://dedupe.example/spaced", "Spaced Repetition older", TAB_ENTRY_OLD_MS)
      db.query(
        "INSERT INTO events (id, event_type, observed_at, browser, url, title) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(10, "tab_updated", EVENT_NEW_MS, "firefox", "https://dedupe.example/spaced", "Spaced Repetition newer")
      db.query(
        "INSERT INTO events (id, event_type, observed_at, browser, url, title) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(11, "tab_activated", EVENT_NEW_MS + 1, "firefox", "https://events.example/cybernetics", "Cybernetics Lab")
      db.query(
        "INSERT INTO events (id, event_type, observed_at, browser, url, title) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(12, "tab_created", EVENT_NEW_MS + 2, "firefox", "https://events.example/ignored", "Cybernetics Created")
      db.query(
        "INSERT INTO events (id, event_type, observed_at, browser, url, title) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(13, "tab_updated", EVENT_NEW_MS + 3, "firefox", "https://events.example/single", "Only One Term")
    } finally {
      db.close()
    }

    run(dbPath)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("searchBrowser", () => {
  test("requires every term across title and url", () => {
    withBrowserDb((dbPath) => {
      const result = searchBrowser(dbPath, ["vector", "paper"], { limit: 10 })

      expect(result.skipped).toBeUndefined()
      expect(result.hits.map((hit) => hit.ref)).toEqual(["browser:tab_entries:1"])
      expect(result.hits[0]?.title).toBe("Vector Memory Index")
      expect(searchBrowser(dbPath, ["vector", "absent"], { limit: 10 }).hits).toHaveLength(0)
    })
  })

  test("merges events with tab entries and filters event types", () => {
    withBrowserDb((dbPath) => {
      const result = searchBrowser(dbPath, ["cybernetics"], { limit: 10 })

      expect(result.hits.map((hit) => hit.ref)).toEqual(["browser:events:11"])
      expect(result.hits[0]?.kind).toBe("event")
    })
  })

  test("dedupes by url with newest timestamp and converts epoch milliseconds", () => {
    withBrowserDb((dbPath) => {
      const result = searchBrowser(dbPath, ["spaced"], { limit: 10 })

      expect(result.hits).toHaveLength(1)
      expect(result.hits[0]?.ref).toBe("browser:events:10")
      expect(result.hits[0]?.url).toBe("https://dedupe.example/spaced")
      expect(result.hits[0]?.timestamp).toBe(new Date(EVENT_NEW_MS).toISOString())
    })
  })
})
