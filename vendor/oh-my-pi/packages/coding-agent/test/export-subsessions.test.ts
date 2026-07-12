import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildViewerTree, collectSubSessions, type SubSession } from "../src/export/html";
import type { SessionEntry } from "../src/session/session-entries";

/**
 * Contract: a session at `<dir>/<name>.jsonl` embeds subagent transcripts from
 * `<dir>/<name>/<AgentId>.jsonl` (recursively) under slash-joined keys, with
 * parent links and last-entry leaf ids. Corrupt/empty/backup files are skipped.
 */

function sessionJsonl(id: string, entryIds: string[]): string {
	const lines = [
		JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-06-12T00:00:00.000Z", cwd: "/tmp" }),
	];
	let parent: string | null = null;
	for (const entryId of entryIds) {
		lines.push(
			JSON.stringify({
				type: "model_change",
				id: entryId,
				parentId: parent,
				timestamp: "2026-06-12T00:00:01.000Z",
				model: "test/model",
			}),
		);
		parent = entryId;
	}
	return `${lines.join("\n")}\n`;
}

describe("collectSubSessions", () => {
	let root: string;
	let mainFile: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-subsessions-"));
		mainFile = path.join(root, "main.jsonl");
		await Bun.write(mainFile, sessionJsonl("main", ["m1"]));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	test("collects nested subagent sessions with parent links and leaf ids", async () => {
		await Bun.write(path.join(root, "main/Alpha.jsonl"), sessionJsonl("alpha", ["a1", "a2"]));
		await Bun.write(path.join(root, "main/Alpha/Child.jsonl"), sessionJsonl("child", ["c1"]));
		await Bun.write(path.join(root, "main/Beta.jsonl"), sessionJsonl("beta", ["b1"]));

		const subs = await collectSubSessions(mainFile);

		expect(Object.keys(subs).sort()).toEqual(["Alpha", "Alpha/Child", "Beta"]);
		expect(subs.Alpha).toMatchObject({ agentId: "Alpha", parent: null, leafId: "a2" });
		expect(subs.Alpha.entries.map(e => e.id)).toEqual(["a1", "a2"]);
		expect(subs.Alpha.header?.id).toBe("alpha");
		expect(subs["Alpha/Child"]).toMatchObject({ agentId: "Child", parent: "Alpha", leafId: "c1" });
		expect(subs.Beta).toMatchObject({ agentId: "Beta", parent: null, leafId: "b1" });
	});

	test("extracts branched main entries and nested sub-session tree nodes", () => {
		const entries: SessionEntry[] = [
			{
				type: "model_change",
				id: "root",
				parentId: null,
				timestamp: "2026-06-12T00:00:01.000Z",
				model: "test/root",
			},
			{
				type: "model_change",
				id: "a",
				parentId: "root",
				timestamp: "2026-06-12T00:00:02.000Z",
				model: "test/a",
			},
			{
				type: "model_change",
				id: "b",
				parentId: "root",
				timestamp: "2026-06-12T00:00:03.000Z",
				model: "test/b",
			},
		];
		const subSessions: Record<string, SubSession> = {
			Alpha: {
				agentId: "Alpha",
				parent: null,
				header: null,
				entries: [
					{
						type: "model_change",
						id: "alpha-root",
						parentId: null,
						timestamp: "2026-06-12T00:00:04.000Z",
						model: "test/alpha",
					},
				],
				leafId: "alpha-root",
			},
			"Alpha/Child": {
				agentId: "Child",
				parent: "Alpha",
				header: null,
				entries: [
					{
						type: "model_change",
						id: "child-root",
						parentId: null,
						timestamp: "2026-06-12T00:00:05.000Z",
						model: "test/child",
					},
				],
				leafId: "child-root",
			},
		};

		const nodes = buildViewerTree(entries, subSessions);
		const byKey = new Map(nodes.map(node => [node.key, node]));

		expect([...byKey.keys()].sort()).toEqual(
			["entry:root", "entry:a", "entry:b", "session:Alpha", "session:Alpha/Child"].sort(),
		);
		expect(byKey.get("entry:root")).toMatchObject({
			kind: "entry",
			key: "entry:root",
			parentKey: null,
			label: "Model: test/root",
			entryId: "root",
		});
		expect(byKey.get("entry:a")).toMatchObject({
			kind: "entry",
			key: "entry:a",
			parentKey: "entry:root",
			label: "Model: test/a",
			entryId: "a",
		});
		expect(byKey.get("entry:b")).toMatchObject({
			kind: "entry",
			key: "entry:b",
			parentKey: "entry:root",
			label: "Model: test/b",
			entryId: "b",
		});
		expect(byKey.get("session:Alpha")).toMatchObject({
			kind: "session",
			key: "session:Alpha",
			parentKey: null,
			label: "Alpha",
		});
		expect(byKey.get("session:Alpha/Child")).toMatchObject({
			kind: "session",
			key: "session:Alpha/Child",
			parentKey: "session:Alpha",
			label: "Child",
		});
	});

	test("breaks self-referencing and cyclic branch parent links", () => {
		const entries: SessionEntry[] = [
			{
				type: "model_change",
				id: "self",
				parentId: "self",
				timestamp: "2026-06-12T00:00:01.000Z",
				model: "test/self",
			},
			{
				type: "model_change",
				id: "loop-a",
				parentId: "loop-b",
				timestamp: "2026-06-12T00:00:02.000Z",
				model: "test/a",
			},
			{
				type: "model_change",
				id: "loop-b",
				parentId: "loop-a",
				timestamp: "2026-06-12T00:00:03.000Z",
				model: "test/b",
			},
		];

		const nodes = buildViewerTree(entries);
		expect(nodes.map(node => node.parentKey)).toEqual([null, null, null]);
	});

	test("skips corrupt, empty, backup, and non-jsonl files", async () => {
		await Bun.write(path.join(root, "main/Good.jsonl"), sessionJsonl("good", ["g1"]));
		await Bun.write(path.join(root, "main/corrupt.jsonl"), "{not json\n");
		await Bun.write(path.join(root, "main/empty.jsonl"), "");
		await Bun.write(path.join(root, "main/Good.jsonl.123.bak"), sessionJsonl("bak", ["x1"]));
		await Bun.write(path.join(root, "main/notes.md"), "# notes\n");

		const subs = await collectSubSessions(mainFile);

		expect(Object.keys(subs)).toEqual(["Good"]);
	});

	test("returns empty record when no subagent dir exists", async () => {
		expect(await collectSubSessions(mainFile)).toEqual({});
		expect(await collectSubSessions(path.join(root, "not-a-session"))).toEqual({});
	});
});
