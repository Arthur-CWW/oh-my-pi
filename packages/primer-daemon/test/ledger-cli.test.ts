import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { listCards, openLedger } from "../src/ledger"

const roots: string[] = []
const cliPath = new URL("../src/cli.ts", import.meta.url).pathname

function makeLedgerPath(): string {
  const root = mkdtempSync(join(tmpdir(), "primer-ledger-cli-"))
  roots.push(root)
  return join(root, "ledger.sqlite")
}

function runCard(ledgerDb: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, cliPath, "card", ...args], {
    env: { ...process.env, PRIMER_LEDGER_DB: ledgerDb },
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("primer card status", () => {
  test("moves a card through every valid status and persists each transition", () => {
    const ledgerDb = makeLedgerPath()
    const added = runCard(
      ledgerDb,
      "add",
      "--front",
      "What is the source?",
      "--back",
      "A provenance-linked hit.",
      "--source-ref",
      "reader:u-07-machinic",
      "--url",
      "https://example.test/chapter",
    )
    expect(added).toEqual({ exitCode: 0, stdout: "card 1\n", stderr: "" })

    for (const status of ["approved", "rejected", "candidate"] as const) {
      expect(runCard(ledgerDb, "status", "1", status)).toEqual({
        exitCode: 0,
        stdout: `card 1 ${status}\n`,
        stderr: "",
      })
      const db = openLedger(ledgerDb)
      try {
        expect(listCards(db, 1)[0]?.status).toBe(status)
      } finally {
        db.close()
      }
    }
  })

  test("migrates a legacy card table without losing row data", () => {
    const ledgerDb = makeLedgerPath()
    const legacy = new Database(ledgerDb)
    legacy.exec(`
CREATE TABLE card_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  source_ref TEXT,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO card_candidates (front, back, source_ref, url, created_at)
VALUES (
  'Legacy question',
  'Legacy answer',
  'reader:legacy-source',
  'https://example.test/legacy',
  '2024-01-02 03:04:05'
);
`)
    legacy.close()

    for (let opening = 0; opening < 2; opening += 1) {
      const db = openLedger(ledgerDb)
      try {
        expect(listCards(db)).toEqual([
          {
            id: 1,
            front: "Legacy question",
            back: "Legacy answer",
            sourceRef: "reader:legacy-source",
            url: "https://example.test/legacy",
            status: "candidate",
            createdAt: "2024-01-02 03:04:05",
          },
        ])
      } finally {
        db.close()
      }
    }

    expect(runCard(ledgerDb, "status", "1", "approved")).toEqual({
      exitCode: 0,
      stdout: "card 1 approved\n",
      stderr: "",
    })

    const migrated = openLedger(ledgerDb)
    try {
      expect(listCards(migrated)[0]).toEqual({
        id: 1,
        front: "Legacy question",
        back: "Legacy answer",
        sourceRef: "reader:legacy-source",
        url: "https://example.test/legacy",
        status: "approved",
        createdAt: "2024-01-02 03:04:05",
      })
    } finally {
      migrated.close()
    }
  })

  test("rejects invalid ids, statuses, and missing arguments at the CLI boundary", () => {
    const ledgerDb = makeLedgerPath()
    const usage = "Usage: primer card status <id> candidate|approved|rejected\n"

    for (const args of [
      ["status"],
      ["status", "1"],
      ["status", "0", "approved"],
      ["status", "-1", "approved"],
      ["status", "+1", "approved"],
      ["status", "01", "approved"],
      ["status", "1.5", "approved"],
      ["status", "1e2", "approved"],
      ["status", "0x2", "approved"],
      ["status", " 1", "approved"],
      ["status", "1 ", "approved"],
      ["status", "abc", "approved"],
      ["status", "1", "pending"],
      ["status", "1", ""],
      ["status", "1", "approved", "extra"],
      ["status", "1", "approved", "--json"],
    ]) {
      expect(runCard(ledgerDb, ...args)).toEqual({ exitCode: 2, stdout: "", stderr: usage })
    }
  })

  test("reports a valid but unknown card id without creating a card", () => {
    const ledgerDb = makeLedgerPath()
    expect(runCard(ledgerDb, "status", "42", "approved")).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "card 42 not found\n",
    })
    const db = openLedger(ledgerDb)
    try {
      expect(listCards(db)).toEqual([])
    } finally {
      db.close()
    }
  })
})
