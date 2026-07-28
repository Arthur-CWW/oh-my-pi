import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { prepareSpawnContext } from "@oh-my-pi/pi-coding-agent/task";

async function bumpMtime(filePath: string, previousMtimeMs: number): Promise<void> {
	const mtimeMs = Math.max(Date.now() + 2_000, previousMtimeMs + 2_000);
	await fs.utimes(filePath, mtimeMs / 1_000, mtimeMs / 1_000);
}

describe("task spawn guide", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-spawn-guide-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("prepends present guide content with a provenance header", async () => {
		const guidePath = path.join(tempDir, "spawn-guide.md");
		await fs.writeFile(guidePath, "Use the focused gate.\n", "utf8");

		const context = await prepareSpawnContext(tempDir, guidePath, "Shared goal");

		expect(context).toContain(`Spawn guide: ${guidePath} (`);
		expect(context).toContain("Use the focused gate.");
		expect(context).toContain("Shared goal");
		expect(context!.indexOf("Spawn guide:")).toBeLessThan(context!.indexOf("Shared goal"));
	});

	it("resolves the default guide from the enclosing jj workspace root", async () => {
		const repoRoot = path.join(tempDir, "workspace");
		const guidePath = path.join(repoRoot, "docs/fable/spawn-guide.md");
		const nestedCwd = path.join(repoRoot, "vendor", "oh-my-pi", "packages", "coding-agent");
		await fs.mkdir(path.join(repoRoot, ".jj", "repo"), { recursive: true });
		await fs.mkdir(nestedCwd, { recursive: true });
		await fs.mkdir(path.dirname(guidePath), { recursive: true });
		await fs.writeFile(guidePath, "Use the workspace-local guide.", "utf8");

		const context = await prepareSpawnContext(nestedCwd, undefined, "Shared goal");

		expect(context).toContain(`Spawn guide: ${guidePath} (`);
		expect(context).toContain("Use the workspace-local guide.");
	});

	it("treats an absent guide as a clean no-op", async () => {
		const context = await prepareSpawnContext(tempDir, path.join(tempDir, "missing.md"), "Shared goal");

		expect(context).toBe("Shared goal");
	});

	it("reloads edited content after the guide mtime changes", async () => {
		const guidePath = path.join(tempDir, "spawn-guide.md");
		await fs.writeFile(guidePath, "First doctrine", "utf8");

		const first = await prepareSpawnContext(tempDir, guidePath, "Shared goal");
		const firstStat = await fs.stat(guidePath);
		await fs.writeFile(guidePath, "Second doctrine", "utf8");
		await bumpMtime(guidePath, firstStat.mtimeMs);

		const second = await prepareSpawnContext(tempDir, guidePath, "Shared goal");

		expect(first).toContain("First doctrine");
		expect(second).toContain("Second doctrine");
		expect(second).not.toContain("First doctrine");
	});
});
