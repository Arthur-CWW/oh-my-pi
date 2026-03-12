import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { KagiSearchRuntimeError } from "../../../packages/kagi/src/kagi-search-effect.js";
import { kagiSearchEffect, runKagiSearchCli, type KagiSearchDeps } from "../kagi-search.js";

describe("kagi search effect", () => {
	it("returns search results on success", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: () =>
				Effect.succeed({
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
			runSearch: () =>
				Effect.succeed({
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

	it("extracts answer and results from Kagi tagged SSE payload arrays", async () => {
		const mockSearchPayload = JSON.stringify({
			content:
				'<div class="_0_SRI search-result"><div class="_0_TITLE __sri-title"><h3><a class="__sri_title_link" href="https://bun.com/">Bun Runtime</a></h3></div><div class="_0_DESC __sri-desc">Fast JavaScript runtime.</div></div>',
		});
		const mockDeps: KagiSearchDeps = {
			runSearch: () =>
				Effect.succeed({
					capturedAt: new Date().toISOString(),
					requestUrl: "https://kagi.com/socket/search?q=bun+runtime",
					referer: "https://kagi.com/search?q=bun+runtime",
					status: 200,
					ok: true,
					headersSent: {},
					responseHeaders: {},
					rawSse: "hi",
					parsedEvents: [
						{
							id: "0",
							dataRaw: "[]",
							dataJson: [{ tag: "top-content-unique", payload: "<i>24</i> relevant results in <i>1.55s</i>." }],
						},
						{
							id: "1",
							dataRaw: "[]",
							dataJson: [{ tag: "search", payload: mockSearchPayload }],
						},
					],
				}),
		};

		const result = await Effect.runPromise(kagiSearchEffect("bun runtime", mockDeps));
		expect(result.answer).toBe("24 relevant results in 1.55s.");
		expect(result.results).toEqual([
			{
				title: "Bun Runtime",
				url: "https://bun.com/",
				snippet: "Fast JavaScript runtime.",
			},
		]);
	});

	it("extracts results when search payload is already parsed object", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: () =>
				Effect.succeed({
					capturedAt: new Date().toISOString(),
					requestUrl: "https://kagi.com/socket/search?q=test",
					referer: "https://kagi.com/search",
					status: 200,
					ok: true,
					headersSent: {},
					responseHeaders: {},
					rawSse: "",
					parsedEvents: [
						{
							id: "1",
							dataRaw: "",
							dataJson: [
								{
									tag: "search",
									payload: {
										content:
											'<div class="_0_SRI search-result"><div class="_0_TITLE __sri-title"><h3><a class="__sri_title_link" href="https://example.com">Example</a></h3></div><div class="_0_DESC __sri-desc"><div><span class="__sri-time">Feb 23, 2025</span> Snippet text</div></div></div>',
									},
								},
							],
						},
					],
				}),
		};

		const result = await Effect.runPromise(kagiSearchEffect("example", mockDeps));
		expect(result.results).toEqual([
			{
				title: "Example",
				url: "https://example.com",
				snippet: "Feb 23, 2025 Snippet text",
				publishedAt: "Feb 23, 2025",
			},
		]);
	});

	it("maps lens/recency/domain options into Kagi search options", async () => {
		let capturedQuery = "";
		let capturedLens: string | undefined;
		let capturedDateRange: number | undefined;
		const mockDeps: KagiSearchDeps = {
			runSearch: (options) =>
				Effect.sync(() => {
					capturedQuery = options.query;
					capturedLens = options.lens;
					capturedDateRange = options.dateRange;
					return {
						capturedAt: new Date().toISOString(),
						requestUrl: "https://kagi.com/socket/search?q=test",
						referer: "https://kagi.com/search",
						status: 200,
						ok: true,
						headersSent: {},
						responseHeaders: {},
						rawSse: 'id: 1\ndata: {"content": "ok"}',
						parsedEvents: [{ id: "1", dataRaw: "", dataJson: { content: "ok" } }],
					};
				}),
		};

		await Effect.runPromise(
			kagiSearchEffect("effect ts", mockDeps, {
				lens: "programming",
				recencyFilter: "month",
				domainFilter: ["bun.com", "effect.website"],
			}),
		);

		expect(capturedLens).toBe("programming");
		expect(capturedDateRange).toBe(3);
		expect(capturedQuery).toBe("effect ts (site:bun.com OR site:effect.website)");
	});

	it("maps Google-style query operators into Kagi API params", async () => {
		let capturedQuery = "";
		let capturedDateRange: number | undefined;
		let capturedFromDate: string | undefined;
		let capturedToDate: string | undefined;
		const mockDeps: KagiSearchDeps = {
			runSearch: (options) =>
				Effect.sync(() => {
					capturedQuery = options.query;
					capturedDateRange = options.dateRange;
					capturedFromDate = options.fromDate;
					capturedToDate = options.toDate;
					return {
						capturedAt: new Date().toISOString(),
						requestUrl: "https://kagi.com/socket/search?q=test",
						referer: "https://kagi.com/search",
						status: 200,
						ok: true,
						headersSent: {},
						responseHeaders: {},
						rawSse: 'id: 1\ndata: {"content": "ok"}',
						parsedEvents: [{ id: "1", dataRaw: "", dataJson: { content: "ok" } }],
					};
				}),
		};

		await Effect.runPromise(
			kagiSearchEffect(
				"effect ts site:bun.com -site:example.com before:2025-01-31 after:2024-01-01 OR",
				mockDeps,
				{
					recencyFilter: "month",
					domainFilter: ["effect.website"],
				},
			),
		);

		expect(capturedDateRange).toBeUndefined();
		expect(capturedFromDate).toBe("2024-01-01");
		expect(capturedToDate).toBe("2025-01-31");
		expect(capturedQuery).toBe("effect ts (site:effect.website OR site:bun.com) -site:example.com");
	});

	it("keeps coarse year-based date operators inline instead of forcing Kagi date bounds", async () => {
		let capturedQuery = "";
		let capturedDateRange: number | undefined;
		let capturedFromDate: string | undefined;
		let capturedToDate: string | undefined;
		const mockDeps: KagiSearchDeps = {
			runSearch: (options) =>
				Effect.sync(() => {
					capturedQuery = options.query;
					capturedDateRange = options.dateRange;
					capturedFromDate = options.fromDate;
					capturedToDate = options.toDate;
					return {
						capturedAt: new Date().toISOString(),
						requestUrl: "https://kagi.com/socket/search?q=test",
						referer: "https://kagi.com/search",
						status: 200,
						ok: true,
						headersSent: {},
						responseHeaders: {},
						rawSse: 'id: 1\ndata: {"content": "ok"}',
						parsedEvents: [{ id: "1", dataRaw: "", dataJson: { content: "ok" } }],
					};
				}),
		};

		const result = await Effect.runPromise(
			kagiSearchEffect("effect ts after:2025", mockDeps, {
				recencyFilter: "month",
			}),
		);

		expect(capturedDateRange).toBe(3);
		expect(capturedFromDate).toBeUndefined();
		expect(capturedToDate).toBeUndefined();
		expect(capturedQuery).toBe("effect ts after:2025");
		expect(result.queryDiagnostics?.unmappedDateOperators).toEqual(["after:2025"]);
	});

	it("returns error for failed search", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: () =>
				Effect.fail(
					new KagiSearchRuntimeError({
						code: "unauthorized",
						reason: "Kagi session is unauthorized. Refresh your Kagi session and retry.",
						status: 401,
						requestUrl: "https://kagi.com/socket/search?q=test",
					}),
				),
		};

		const exit = await Effect.runPromiseExit(kagiSearchEffect("test", mockDeps));
		expect(exit._tag).toBe("Failure");
	});

	it("returns CLI error for missing query", async () => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const log = console.log;
		const err = console.error;
		console.log = (value?: unknown) => stdout.push(String(value ?? ""));
		console.error = (value?: unknown) => stderr.push(String(value ?? ""));
		try {
			const exitCode = await runKagiSearchCli(["--json"]);
			expect(exitCode).toBe(1);
			expect(stdout).toEqual([]);
			expect(stderr.join("\n")).toContain("Missing query");
		} finally {
			console.log = log;
			console.error = err;
		}
	});

	it("runs search with injected deps", async () => {
		const mockDeps: KagiSearchDeps = {
			runSearch: () =>
				Effect.succeed({
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

		const result = await Effect.runPromise(kagiSearchEffect("test query", mockDeps));
		expect(result.answer).toBe("Answer text");
		expect(result.results).toEqual([]);
	});
});
