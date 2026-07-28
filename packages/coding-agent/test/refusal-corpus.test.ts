import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	digestRefusalPrompt,
	RefusalStore,
	type RefusalRetryContext,
} from "@oh-my-pi/pi-coding-agent/session/refusal-corpus";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function makePaths(): Promise<{ root: string; db: string; legacy: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-refusal-store-"));
	tempRoots.push(root);
	return { root, db: path.join(root, "host.sqlite"), legacy: path.join(root, "refusals.jsonl") };
}

function fixtureInput(attemptId = "attempt-1") {
	return {
		sessionId: "session-1",
		childId: "FixtureChild",
		turnId: "turn-1",
		attemptId,
		provider: "anthropic",
		model: "claude-fable-5",
		reasonClass: "reasoning_extraction",
		promptDigest: digestRefusalPrompt("private prompt text"),
		buildVersion: "16.0.1",
		buildDigest: "build-digest",
	};
}

describe("host refusal store", () => {
	it("records atomically and deduplicates a concurrent attempt", async () => {
		const { db } = await makePaths();
		const first = new RefusalStore({ dbPath: db, legacyPath: null });
		const second = new RefusalStore({ dbPath: db, legacyPath: null });
		const [a, b] = await Promise.all([Promise.resolve(first.record(fixtureInput())), Promise.resolve(second.record(fixtureInput()))]);
		expect(a.id).toBe(b.id);
		expect(first.stats().total).toBe(1);
		expect(first.events(a.id).map(event => event.type)).toEqual(["refusal-observed"]);
		first.close();
		second.close();
	});

	it("persists immutable recovery events and queryable review fields", async () => {
		const { db } = await makePaths();
		const store = new RefusalStore({ dbPath: db, legacyPath: null });
		const record = store.record(fixtureInput());
		store.persistRoute(record.id, "openai-codex/gpt-5.6-sol", "receipt-1");
		store.commitResume(record.id, "openai-codex/gpt-5.6-sol", "receipt-1");
		store.review(record.id, "false-positive");
		expect(store.get(record.id)).toEqual(
			expect.objectContaining({ recoveryState: "resumed", reviewStatus: "reviewed", verdict: "false-positive" }),
		);
		expect(store.events(record.id).map(event => event.type)).toEqual([
			"refusal-observed",
			"route-persisted",
			"resume-committed",
			"reviewed",
		]);
		expect(store.list({ reasonClass: "reasoning_extraction", recoveryState: "resumed" })).toHaveLength(1);
		expect(store.stats()).toEqual(expect.objectContaining({ total: 1 }));
		store.close();
	});

	it("migrates the legacy corpus idempotently without storing prompt or refusal text", async () => {
		const { db, legacy } = await makePaths();
		const prompt = "private legacy prompt that must disappear";
		const detail = "provider refusal detail that must disappear";
		await fs.writeFile(
			legacy,
			`${JSON.stringify({
				id: "legacy-1",
				timestamp: 123,
				provider: "anthropic",
				model: "claude-fable-5",
				category: "bio",
				sessionId: "old-session",
				turnId: "old-turn",
				promptExcerpt: prompt,
				refusalText: detail,
			})}\n`,
		);
		const first = new RefusalStore({ dbPath: db, legacyPath: legacy });
		expect(first.stats().total).toBe(1);
		first.close();
		const second = new RefusalStore({ dbPath: db, legacyPath: legacy });
		expect(second.stats().total).toBe(1);
		const record = second.list()[0];
		expect(record?.promptDigest).toBe(digestRefusalPrompt(prompt));
		expect(JSON.stringify(record)).not.toContain(prompt);
		expect(JSON.stringify(record)).not.toContain(detail);
		second.close();
	});

	it("passes only neutral identifiers to manual retry", async () => {
		const { db } = await makePaths();
		const store = new RefusalStore({ dbPath: db, legacyPath: null });
		const record = store.record(fixtureInput());
		let received: RefusalRetryContext | undefined;
		const retried = await store.retry(record.id, context => {
			received = context;
			return { accepted: true, receipt: "manual-receipt" };
		});
		expect(received).toEqual({
			recordId: record.id,
			sessionId: "session-1",
			childId: "FixtureChild",
			recoveryModel: null,
		});
		expect(JSON.stringify(received)).not.toContain("prompt");
		expect(JSON.stringify(received)).not.toContain("error");
		expect(retried.recoveryState).toBe("retry-requested");
		store.close();
	});
});
