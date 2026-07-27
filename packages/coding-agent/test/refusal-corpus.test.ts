import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	REFUSAL_PROMPT_EXCERPT_MAX,
	RefusalCorpus,
	type RefusalReplayRecord,
} from "@oh-my-pi/pi-coding-agent/session/refusal-corpus";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function makeCorpus(): Promise<{ corpus: RefusalCorpus; file: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-refusal-corpus-"));
	tempRoots.push(root);
	const file = path.join(root, "refusals.jsonl");
	return { corpus: new RefusalCorpus({ path: file }), file };
}

function baseCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		prompt: "Please update the local parser tests.",
		model: "claude-sonnet",
		modelVersion: "2026-07-13",
		category: "coding",
		action: "edit",
		contextSources: ["/private/project/AGENTS.md", "/private/project/src/index.ts"],
		requiresTools: false,
		...overrides,
	};
}

describe("refusal corpus", () => {
	it("appends to and reopens an append-only JSONL corpus", async () => {
		const { corpus, file } = await makeCorpus();
		const first = await corpus.appendCase(baseCase({ prompt: "first" }));
		const second = await corpus.appendCase(baseCase({ prompt: "second", action: "write" }));
		expect((await fs.readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);

		const reopened = new RefusalCorpus({ path: file });
		expect(reopened.list().map(item => item.id)).toEqual([first.id, second.id]);
		expect(reopened.get(first.id)?.safeExcerpt).toBe("first");
	});

	it("redacts secrets, caps prompt excerpts, and keeps only context basenames", async () => {
		const { corpus } = await makeCorpus();
		const prompt = `token=sk-test-1234567890 and bearer abcdefghijklmnop ${"x".repeat(REFUSAL_PROMPT_EXCERPT_MAX + 100)}`;
		const item = await corpus.appendCase(
			baseCase({ prompt, contextSources: ["/Users/alice/project/AGENTS.md", "/tmp/private/.env"] }),
		);
		expect(item.safeExcerpt.length).toBeLessThanOrEqual(REFUSAL_PROMPT_EXCERPT_MAX);
		expect(item.safeExcerpt).not.toContain("sk-test-1234567890");
		expect(item.safeExcerpt).not.toContain("bearer abcdefghijklmnop");
		expect(item.contextSources).toEqual(["AGENTS.md", ".env"]);
	});

	it("groups list and stats by model version, category, action, source, and verdict", async () => {
		const { corpus } = await makeCorpus();
		const a = await corpus.appendCase(baseCase({ verdict: "pending" }));
		const b = await corpus.appendCase(
			baseCase({
				model: "gpt",
				modelVersion: "5.1",
				category: "safety",
				action: "explain",
				contextSources: ["/tmp/README.md"],
				verdict: "false-positive",
			}),
		);
		await corpus.mark(a.id, { verdict: "confirmed", note: "reproduced" });
		const filtered = corpus.list({
			modelVersion: "5.1",
			category: "safety",
			action: "explain",
			contextSource: "README.md",
			verdict: "false-positive",
		});
		expect(filtered.map(item => item.id)).toEqual([b.id]);
		const stats = corpus.stats();
		const serialized = JSON.stringify(stats);
		for (const key of ["modelVersion", "category", "action", "contextSource", "verdict"]) {
			expect(serialized).toContain(key);
		}
	});

	it("persists verdict marks across reopen", async () => {
		const { corpus, file } = await makeCorpus();
		const item = await corpus.appendCase(baseCase());
		await corpus.mark(item.id, { verdict: "false-positive", note: "safe local request" });
		const reopened = new RefusalCorpus({ path: file });
		expect(reopened.get(item.id)).toEqual(
			expect.objectContaining({ verdict: "false-positive", note: "safe local request" }),
		);
	});

	it("replays no-tools cases through an injected completion and records history", async () => {
		const { corpus } = await makeCorpus();
		const item = await corpus.appendCase(baseCase({ prompt: "Do the harmless local edit." }));
		let received: unknown;
		const replay = await corpus.replay(item.id, {
			completion: async (envelope: unknown) => {
				received = envelope;
				return { refused: false, model: "replay-model", textExcerpt: "completed" };
			},
		});
		expect(received).toBeDefined();
		expect(replay).toEqual(expect.objectContaining({ caseId: item.id, refused: false }));
		expect(corpus.get(item.id)?.replayHistory).toEqual(
			expect.arrayContaining([expect.objectContaining({ caseId: item.id })]),
		);
	});

	it("refuses replay when the case requires tools", async () => {
		const { corpus } = await makeCorpus();
		const item = await corpus.appendCase(baseCase({ requiresTools: true }));
		await expect(corpus.replay(item.id, { completion: async () => ({ refused: false }) })).rejects.toThrow(/tool/i);
	});

	it("selects false positives for replay when the public batch API is available", async () => {
		const { corpus } = await makeCorpus();
		const falsePositive = await corpus.appendCase(baseCase({ verdict: "false-positive" }));
		await corpus.appendCase(baseCase({ verdict: "confirmed" }));
		if (typeof corpus.replayFalsePositives !== "function") return;
		const records = await corpus.replayFalsePositives({
			completion: async () => ({ refused: false }),
		});
		expect(records).toHaveLength(1);
		expect((records as RefusalReplayRecord[])[0]?.caseId).toBe(falsePositive.id);
	});
});
