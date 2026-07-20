import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import friction from "../src/commands/friction";
import type { FrictionRow } from "../src/session/friction-ledger";
import { appendFriction } from "../src/session/friction-ledger";

async function runFriction(argv: readonly string[]): Promise<void> {
	await Effect.runPromise(
		Command.runWith(friction, { version: "test" })([...argv]).pipe(Effect.provide(NodeServices.layer)),
	);
}

async function runFrictionWithOutput(argv: readonly string[]): Promise<string> {
	const originalWrite = process.stdout.write.bind(process.stdout);
	let output = "";
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
		return true;
	}) as typeof process.stdout.write;
	try {
		await runFriction(argv);
		return output;
	} finally {
		process.stdout.write = originalWrite;
	}
}

async function withLedger<T>(run: (ledgerPath: string) => Promise<T>): Promise<T> {
	using tempDir = TempDir.createSync("@omp-friction-cli-");
	const previousHome = process.env.HOME;
	const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.HOME = tempDir.path();
	process.env.OMP_SESSION_CONTROL_DB = `${tempDir.path()}/control.sqlite`;
	try {
		return await run(`${tempDir.path()}/.omp/agent/friction.jsonl`);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	}
}

async function appendFixture(ledgerPath: string, rows: readonly FrictionRow[]): Promise<void> {
	for (const row of rows) await appendFriction(row, ledgerPath);
}

describe("omp friction list", () => {
	it("orders newest first and applies class, model, session, and since filters", async () => {
		await withLedger(async ledgerPath => {
			await appendFixture(ledgerPath, [
				{
					ts: "2026-07-15T10:00:00.000Z",
					sessionId: "session-a",
					agentId: "agent-a",
					model: "model-x",
					class: "capability-gap",
					note: "old capability",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-a",
				},
				{
					ts: "2026-07-15T12:00:00.000Z",
					sessionId: "session-b",
					agentId: "agent-b",
					model: "model-x",
					class: "environment",
					note: "environment issue",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-b",
				},
				{
					ts: "2026-07-15T13:00:00.000Z",
					sessionId: "session-c",
					agentId: "agent-c",
					model: "model-y",
					class: "capability-gap",
					note: "new capability",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-c",
				},
			]);

			const ordered = JSON.parse(await runFrictionWithOutput(["list", "--path", ledgerPath, "--json"])) as {
				ts: string;
			}[];
			expect(ordered.map(row => row.ts)).toEqual([
				"2026-07-15T13:00:00.000Z",
				"2026-07-15T12:00:00.000Z",
				"2026-07-15T10:00:00.000Z",
			]);

			const byClass = JSON.parse(
				await runFrictionWithOutput(["list", "--path", ledgerPath, "--class", "capability-gap", "--json"]),
			) as { class: string }[];
			expect(byClass).toHaveLength(2);
			expect(byClass.every(row => row.class === "capability-gap")).toBe(true);

			const byModel = JSON.parse(
				await runFrictionWithOutput(["list", "--path", ledgerPath, "--model", "model-x", "--json"]),
			) as { model: string }[];
			expect(byModel).toHaveLength(2);
			expect(byModel.every(row => row.model === "model-x")).toBe(true);

			const bySession = JSON.parse(
				await runFrictionWithOutput(["list", "--path", ledgerPath, "--session", "session-b", "--json"]),
			) as { sessionId: string }[];
			expect(bySession).toHaveLength(1);
			expect(bySession[0]?.sessionId).toBe("session-b");

			const since = JSON.parse(
				await runFrictionWithOutput([
					"list",
					"--path",
					ledgerPath,
					"--since",
					"2026-07-15T11:00:00.000Z",
					"--json",
				]),
			) as { ts: string }[];
			expect(since.map(row => row.ts)).toEqual(["2026-07-15T13:00:00.000Z", "2026-07-15T12:00:00.000Z"]);
		});
	});
});

describe("omp friction stats", () => {
	it("aggregates class-model groups across sessions and emits decodable JSON", async () => {
		await withLedger(async ledgerPath => {
			await appendFixture(ledgerPath, [
				{
					ts: "2026-07-15T10:00:00.000Z",
					sessionId: "session-a",
					agentId: "agent-a",
					model: "model-x",
					class: "capability-gap",
					note: "a",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-a",
				},
				{
					ts: "2026-07-15T11:00:00.000Z",
					sessionId: "session-b",
					agentId: "agent-b",
					model: "model-x",
					class: "capability-gap",
					note: "b",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-b",
				},
				{
					ts: "2026-07-15T12:00:00.000Z",
					sessionId: "session-c",
					agentId: "agent-c",
					model: "model-x",
					class: "capability-gap",
					note: "c",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-c",
				},
				{
					ts: "2026-07-15T13:00:00.000Z",
					sessionId: "session-a",
					agentId: "agent-a",
					model: "model-y",
					class: "environment",
					note: "d",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-d",
				},
				{
					ts: "2026-07-15T14:00:00.000Z",
					sessionId: "session-b",
					agentId: "agent-b",
					model: "model-y",
					class: "environment",
					note: "e",
					binaryVersion: "1.0.0",
					binaryDigest: "digest-e",
				},
			]);

			const output = await runFrictionWithOutput(["stats", "--path", ledgerPath, "--json"]);
			const stats = JSON.parse(output) as {
				groups: { class: string; model: string; count: number }[];
				sessions: { sessionId: string; count: number }[];
			};
			expect(stats.groups).toEqual([
				{ class: "capability-gap", model: "model-x", count: 3 },
				{ class: "environment", model: "model-y", count: 2 },
			]);
			expect(stats.sessions).toEqual([
				{ sessionId: "session-a", count: 2 },
				{ sessionId: "session-b", count: 2 },
				{ sessionId: "session-c", count: 1 },
			]);

			const human = await runFrictionWithOutput(["stats", "--path", ledgerPath]);
			const lines = human.trimEnd().split("\n");
			expect(lines[1]).toBe("capability-gap\tmodel-x\t3");
			expect(lines[2]).toBe("environment\tmodel-y\t2");
		});
	});
});

describe("omp friction argument validation", () => {
	it("rejects an unknown flag", async () => {
		await expect(runFriction(["list", "--unknown-flag"])).rejects.toThrow();
	});
});
