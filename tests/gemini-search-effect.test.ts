import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { search as legacySearch } from "../src/old/gemini-search.js";
import {
	buildSearchPrompt,
	extractSourceUrls,
	search as effectSearch,
	type GeminiSearchDeps,
} from "../src/effect/gemini-search.js";

describe("effect gemini-search", () => {
	it("matches legacy gemini unavailable error for aborted requests", async () => {
		const controller = new AbortController();
		controller.abort();
		const options = { provider: "gemini" as const, signal: controller.signal };

		const [legacyResult, effectResult] = await Promise.allSettled([
			legacySearch("what is bun runtime", options),
			effectSearch("what is bun runtime", options),
		]);

		expect(legacyResult.status).toBe("rejected");
		expect(effectResult.status).toBe("rejected");
		if (legacyResult.status === "rejected" && effectResult.status === "rejected") {
			const legacyMessage =
				legacyResult.reason instanceof Error
					? legacyResult.reason.message
					: String(legacyResult.reason);
			const effectMessage =
				effectResult.reason instanceof Error
					? effectResult.reason.message
					: String(effectResult.reason);
			expect(effectMessage).toBe(legacyMessage);
		}
	});

	it("builds search prompt with recency + domain filters", () => {
		const prompt = buildSearchPrompt("effect ts", {
			recencyFilter: "week",
			domainFilter: ["effect.website", "-example.com"],
		});
		expect(prompt).toContain("Question: effect ts");
		expect(prompt).toContain("Only include results from the past week.");
		expect(prompt).toContain("Only cite sources from: effect.website");
		expect(prompt).toContain("Do not cite sources from: example.com");
	});

	it("extracts unique source urls from markdown links", () => {
		const sources = extractSourceUrls(
			"Use [Bun](https://bun.com/) and [Docs](https://bun.com/docs). Duplicate [Bun](https://bun.com/)",
		);
		expect(sources).toEqual([
			{ title: "Bun", url: "https://bun.com/", snippet: "" },
			{ title: "Docs", url: "https://bun.com/docs", snippet: "" },
		]);
	});

	it("uses effect deps to preserve provider fallback behavior", async () => {
		const deps: GeminiSearchDeps = {
			resolveConfiguredProvider: () => Effect.succeed("auto"),
			isPerplexityAvailable: () => false,
			searchWithPerplexity: async () => ({ answer: "p", results: [] }),
			getGeminiApiKey: () => null,
			isGeminiWebAvailable: async () => null,
			queryWithCookies: async () => "",
			fetch,
		};

		await expect(effectSearch("fallback", {}, deps)).rejects.toThrow(
			"No search provider available. Either:",
		);
	});
});
