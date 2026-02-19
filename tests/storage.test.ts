import { describe, expect, it } from "bun:test";
import {
	clearResults,
	deleteResult,
	generateId,
	getAllResults,
	getResult,
	storeResult,
} from "../src/old/storage.ts";

describe("storage", () => {
	it("stores, gets, lists, deletes results", () => {
		clearResults();
		const id = generateId();
		storeResult(id, {
			id,
			type: "search",
			timestamp: Date.now(),
			queries: [{ query: "q", answer: "a", results: [], error: null }],
		});

		const got = getResult(id);
		expect(got?.id).toBe(id);
		expect(getAllResults().length).toBe(1);
		expect(deleteResult(id)).toBe(true);
		expect(getResult(id)).toBeNull();
	});
});
