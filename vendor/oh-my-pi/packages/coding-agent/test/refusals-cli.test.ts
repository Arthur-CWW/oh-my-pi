import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { digestRefusalPrompt, RefusalStore } from "@oh-my-pi/pi-coding-agent/session/refusal-corpus";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function runCli(root: string, db: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const processHandle = Bun.spawn([process.execPath, "src/cli.ts", "refusals", ...args], {
		cwd: path.resolve(import.meta.dir, ".."),
		env: {
			...Bun.env,
			HOME: path.join(root, "home"),
			OMP_CONFIG_ROOT: path.join(root, "config"),
			OMP_SESSION_CONTROL_DB: db,
			OMP_REFUSALS_DB: db,
			OMP_IRC_DB: path.join(root, "irc.sqlite"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	return { code, stdout, stderr };
}

describe("omp refusals", () => {
	it("lists, shows, stats, reviews, and retries from host SQLite", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-refusals-cli-"));
		tempRoots.push(root);
		const db = path.join(root, "control.sqlite");
		const store = new RefusalStore({ dbPath: db, legacyPath: null });
		const record = store.record({
			sessionId: "session-1",
			childId: "Child",
			turnId: "turn-1",
			attemptId: "attempt-1",
			provider: "anthropic",
			model: "claude-fable-5",
			reasonClass: "bio",
			promptDigest: digestRefusalPrompt("private"),
		});
		store.close();

		const stats = await runCli(root, db, "stats", "--json");
		expect(stats.code).toBe(0);
		expect(JSON.parse(stats.stdout)).toEqual(expect.objectContaining({ total: 1 }));
		const shown = await runCli(root, db, "show", record.id, "--json");
		expect(JSON.parse(shown.stdout)).toEqual(expect.objectContaining({ id: record.id, events: expect.any(Array) }));
		const reviewed = await runCli(root, db, "review", record.id, "--verdict", "false-positive", "--json");
		expect(JSON.parse(reviewed.stdout)).toEqual(expect.objectContaining({ verdict: "false-positive" }));
		const retried = await runCli(root, db, "retry", record.id, "--json");
		expect(JSON.parse(retried.stdout)).toEqual(expect.objectContaining({ recoveryState: "retry-requested" }));
		const listed = await runCli(root, db, "list", "--json");
		expect(JSON.parse(listed.stdout)).toHaveLength(1);
	});
});
