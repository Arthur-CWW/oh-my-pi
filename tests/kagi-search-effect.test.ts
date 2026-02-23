import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
	kagiSearchEffect,
	KagiSearchError,
	parseKagiSearchCliArgs,
	runKagiSearchCli,
	type KagiSearchDeps,
} from "../src/effect/kagi-search.js";

describe("kagi search effect", () => {
	it("returns search results on success", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: async () => ({
				capturedAt: new Date().toISOString(),
				requestUrl: "https://kagi.com/socket/search?q=test",
				referer: "https://kagi.com/search",
				status: 200,
				ok: true,
				headersSent: {},
				responseHeaders: {},
				rawSse: 'id: 1\ndata: {"content": "Test answer"}',
				parsedEvents: [
					{ id: "1", dataRaw: '{"content": "Test answer"}', dataJson: { content: "Test answer" } },
				],
			}),
		};

		const result = await Effect.runPromise(kagiSearchEffect("test query", mockDeps));
		expect(result.answer).toBe("Test answer");
		expect(result.results).toEqual([]);
	});

	it("extracts results from parsed events", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: async () => ({
				capturedAt: new Date().toISOString(),
				requestUrl: "https://kagi.com/socket/search?q=test",
				referer: "https://kagi.com/search",
				status: 200,
				ok: true,
				headersSent: {},
				responseHeaders: {},
				rawSse: 'id: 1\ndata: {"results": [{"title": "Test", "url": "https://example.com", "snippet": "Description"}]}',
				parsedEvents: [
					{
						id: "1",
						dataRaw: '{"results": [{"title": "Test", "url": "https://example.com", "snippet": "Description"}]}',
						dataJson: {
							results: [{ title: "Test", url: "https://example.com", snippet: "Description" }],
						},
					},
				],
			}),
		};

		const result = await Effect.runPromise(kagiSearchEffect("test", mockDeps));
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toEqual({
			title: "Test",
			url: "https://example.com",
			snippet: "Description",
		});
	});

	it("returns error for failed search", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: async () => ({
				capturedAt: new Date().toISOString(),
				requestUrl: "https://kagi.com/socket/search?q=test",
				referer: "https://kagi.com/search",
				status: 401,
				ok: false,
				headersSent: {},
				responseHeaders: {},
				rawSse: "",
				parsedEvents: [],
			}),
		};

		const exit = await Effect.runPromiseExit(kagiSearchEffect("test", mockDeps));
		expect(exit._tag).toBe("Failure");
	});

	it("parses CLI args with positional query", () => {
		const parsed = parseKagiSearchCliArgs(["what", "is", "Effect", "TS"]);
		expect(parsed.kind).toBe("ok");
		if (parsed.kind === "ok") {
			expect(parsed.value.query).toBe("what is Effect TS");
			expect(parsed.value.json).toBe(false);
			expect(parsed.value.help).toBe(false);
		}
	});

	it("parses CLI args with --query flag", () => {
		const parsed = parseKagiSearchCliArgs(["--query", "rust programming", "--json"]);
		expect(parsed.kind).toBe("ok");
		if (parsed.kind === "ok") {
			expect(parsed.value.query).toBe("rust programming");
			expect(parsed.value.json).toBe(true);
		}
	});

	it("parses CLI args with --lens", () => {
		const parsed = parseKagiSearchCliArgs(["--lens", "programming", "async rust"]);
		expect(parsed.kind).toBe("ok");
		if (parsed.kind === "ok") {
			expect(parsed.value.lens).toBe("programming");
			expect(parsed.value.query).toBe("async rust");
		}
	});

	it("returns error for missing query", () => {
		const parsed = parseKagiSearchCliArgs(["--json"]);
		expect(parsed.kind).toBe("error");
	});

	it("parses help flag", () => {
		const parsed = parseKagiSearchCliArgs(["--help"]);
		expect(parsed.kind).toBe("ok");
		if (parsed.kind === "ok") {
			expect(parsed.value.help).toBe(true);
		}
	});

	it("runs search with injected deps", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: async () => ({
				capturedAt: new Date().toISOString(),
				requestUrl: "https://kagi.com/socket/search?q=test",
				referer: "https://kagi.com/search",
				status: 200,
				ok: true,
				headersSent: {},
				responseHeaders: {},
				rawSse: 'id: 1\ndata: {"content": "Answer text"}',
				parsedEvents: [
					{ id: "1", dataRaw: '{"content": "Answer text"}', dataJson: { content: "Answer text" } },
				],
			}),
		};

		// Test the full effect with injected deps
		const result = await Effect.runPromise(kagiSearchEffect("test query", mockDeps));
		expect(result.answer).toBe("Answer text");
		expect(result.results).toEqual([]);
	});
});
