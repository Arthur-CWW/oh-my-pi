import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { exportFromFile, exportSessionToHtml } from "../src/export/html";
import { SessionManager } from "../src/session/session-manager";

function sessionJsonl(id: string): string {
	return (
		JSON.stringify({
			type: "session",
			version: 3,
			id,
			timestamp: "2026-06-12T00:00:00.000Z",
			cwd: "/tmp",
		}) + "\n"
	);
}

describe("export default path", () => {
	let tempDir: string;
	let sessionFile: string;
	let originalCwd: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-export-test-"));
		process.chdir(tempDir);
		sessionFile = path.join(tempDir, "test-session.jsonl");
		await Bun.write(sessionFile, sessionJsonl("test-session"));
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	describe("exportFromFile", () => {
		test("defaults to .omp/omp-session-<basename>.html when no outputPath", async () => {
			const result = await exportFromFile(sessionFile);
			expect(result).toBe(path.join(".omp", "omp-session-test-session.html"));
			expect((await fs.stat(result)).isFile()).toBe(true);
		});

		test("preserves explicit outputPath", async () => {
			const out = path.join(tempDir, "explicit.html");
			expect(await exportFromFile(sessionFile, { outputPath: out })).toBe(out);
			expect((await fs.stat(out)).isFile()).toBe(true);
		});

		test("accepts string shorthand for outputPath", async () => {
			const out = path.join(tempDir, "shorthand.html");
			expect(await exportFromFile(sessionFile, out)).toBe(out);
			expect((await fs.stat(out)).isFile()).toBe(true);
		});
	});

	describe("exportSessionToHtml", () => {
		test("defaults to .omp/omp-session-<basename>.html when no outputPath", async () => {
			const sm = await SessionManager.open(sessionFile, tempDir);
			const result = await exportSessionToHtml(sm);
			expect(result).toBe(path.join(".omp", "omp-session-test-session.html"));
			expect((await fs.stat(result)).isFile()).toBe(true);
		});

		test("preserves explicit outputPath", async () => {
			const sm = await SessionManager.open(sessionFile, tempDir);
			const out = path.join(tempDir, "explicit-sm.html");
			expect(await exportSessionToHtml(sm, undefined, { outputPath: out })).toBe(out);
			expect((await fs.stat(out)).isFile()).toBe(true);
		});

		test("throws for in-memory sessions", async () => {
			const sm = SessionManager.inMemory(tempDir);
			await expect(exportSessionToHtml(sm)).rejects.toThrow(
				"Cannot export in-memory session to HTML",
			);
		});
	});
});
