import { describe, expect, it } from "bun:test";
import {
	postProcessCondensed,
	preprocessSearchResults,
	resolveCondenseConfig,
} from "../src/old/search-filter.ts";
import type { QueryResultData } from "../src/old/storage.ts";

describe("search-filter", () => {
	it("resolves condense config", () => {
		expect(resolveCondenseConfig(false)).toBeNull();
		expect(resolveCondenseConfig(true)?.model).toBeDefined();
		expect(resolveCondenseConfig({ enabled: false })).toBeNull();
		expect(resolveCondenseConfig({ model: "x", prompt: "y" })).toEqual({
			model: "x",
			prompt: "y",
		});
	});

	it("preprocesses search results", () => {
		const map = new Map<number, QueryResultData>([
			[
				0,
				{
					query: "bun runtime",
					answer: "Bun is fast",
					results: [{ title: "Bun", url: "https://bun.com/", snippet: "" }],
					error: null,
				},
			],
			[
				1,
				{
					query: "bun docs",
					answer: "Bun docs",
					results: [{ title: "Docs", url: "https://bun.com/docs", snippet: "" }],
					error: null,
				},
			],
		]);

		const out = preprocessSearchResults(map);
		expect(out.totalTokens).toBeGreaterThan(0);
		expect(typeof out.qualitySummary).toBe("string");
	});

	it("post-processes citations and appends sources", () => {
		const condensed = "Bun is a JS runtime [bun.com]";
		const out = postProcessCondensed(condensed, [
			{ title: "Bun", url: "https://bun.com/", snippet: "" },
		]);
		expect(out).toContain("## Sources");
		expect(out).toContain("https://bun.com/");
	});
});
