import { describe, expect, test } from "bun:test";
import {
	BrowserTabBudgetError,
	enforceTabBudget,
	normalizeTabBudgetCap,
	type BrowserTabBudgetRecord,
} from "../../src/tools/browser/tab-budget";

function record(name: string, sessionId: string, lastUsedAt: number, idle = true): BrowserTabBudgetRecord {
	return { name, sessionId, createdAt: lastUsedAt - 100, lastUsedAt, idle };
}

describe("browser tab acquisition budgets", () => {
	test("reclaims the oldest idle tab owned by the requesting session", async () => {
		let records = [
			record("old", "session-a", 10),
			record("new", "session-a", 20),
			record("other", "session-b", 30),
		];
		const reclaimed: string[] = [];

		await enforceTabBudget({
			sessionId: "session-a",
			maxTabsPerSession: 2,
			maxGlobalTabs: 4,
			records: () => records,
			reclaim: async candidate => {
				reclaimed.push(candidate.name);
				records = records.filter(current => current.name !== candidate.name);
			},
		});

		expect(reclaimed).toEqual(["old"]);
		expect(records.map(current => current.name)).toEqual(["new", "other"]);
	});

	test("refuses global admission with deterministic top-consumer attribution", async () => {
		const records = [
			record("a1", "session-a", 10),
			record("a2", "session-a", 20),
			record("b1", "session-b", 30, false),
		];

		const error = await enforceTabBudget({
			sessionId: "session-c",
			maxTabsPerSession: 4,
			maxGlobalTabs: 3,
			records: () => records,
			reclaim: async () => undefined,
		}).then(
			() => undefined,
			reason => reason,
		);

		expect(error).toBeInstanceOf(BrowserTabBudgetError);
		expect(error).toMatchObject({
			scope: "global",
			limit: 3,
			consumers: [
				{ sessionId: "session-a", count: 2 },
				{ sessionId: "session-b", count: 1 },
			],
		});
		expect((error as BrowserTabBudgetError).message).toContain('session "session-a": 2 tab(s)');
		expect((error as BrowserTabBudgetError).message).toContain('session "session-b": 1 tab(s)');
	});

	test("accepts positive integer overrides and falls back for invalid values", () => {
		expect(normalizeTabBudgetCap(7, 4)).toBe(7);
		expect(normalizeTabBudgetCap(0, 4)).toBe(4);
		expect(normalizeTabBudgetCap(1.5, 4)).toBe(4);
		expect(normalizeTabBudgetCap("7", 4)).toBe(4);
	});
});
