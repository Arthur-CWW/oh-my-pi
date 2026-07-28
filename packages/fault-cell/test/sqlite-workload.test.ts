import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const runDir = mkdtempSync(join(tmpdir(), "fault-cell-sqlite-"))
const databasePath = join(runDir, "ledger.sqlite")
const statusPath = join(runDir, "status.sqlite")
const workloadPath = join(import.meta.dir, "..", "scenarios", "sqlite-atomicity", "workload.py")
const text = new TextDecoder()

function runPython(args: readonly string[]) {
	return Bun.spawnSync({
		cmd: ["python3", ...args],
		env: { ...process.env, FAULTCELL_INCARNATION: "1" },
	})
}

afterAll(() => rmSync(runDir, { recursive: true, force: true }))

describe("SQLite atomicity workload", () => {
	test("accepts complete transactions and detects a torn batch", () => {
		const writer = runPython([
			workloadPath,
			"write",
			"--db",
			databasePath,
			"--status",
			statusPath,
			"--batches",
			"3",
			"--rows",
			"4",
			"--commit-delay-ms",
			"0",
		])
		expect(text.decode(writer.stderr)).toBe("")
		expect(writer.exitCode).toBe(0)

		const intact = runPython([
			workloadPath,
			"verify",
			"--db",
			databasePath,
			"--status",
			statusPath,
		])
		expect(text.decode(intact.stderr)).toBe("")
		expect(intact.exitCode).toBe(0)

		const corrupt = runPython([
			"-c",
			"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('DELETE FROM ledger WHERE id=(SELECT min(id) FROM ledger)'); db.commit()",
			databasePath,
		])
		expect(text.decode(corrupt.stderr)).toBe("")
		expect(corrupt.exitCode).toBe(0)

		const torn = runPython([
			workloadPath,
			"verify",
			"--db",
			databasePath,
			"--status",
			statusPath,
		])
		expect(torn.exitCode).toBe(1)
	})
})
