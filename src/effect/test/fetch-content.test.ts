import { beforeEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { clearResults, getResult } from "../../shared/stored-results.js";
import { executeFetchContent } from "../fetch-content.js";

describe("effect fetch-content", () => {
	beforeEach(() => {
		clearResults();
	});

	it("returns single-url content, emits progress, and stores stripped fetch results", async () => {
		const updates: Array<string> = [];
		const result = await Effect.runPromise(
			executeFetchContent(
				{ url: "https://example.com/article" },
				{
					onUpdate: (update) => updates.push(update.content[0]?.text ?? ""),
				},
				{
					fetchContent: (urls) =>
						Effect.succeed(
							urls.map((url) => ({
								url,
								title: "Example Article",
								content: `Extracted body for ${url}`,
								error: null,
								thumbnail: { data: "image-data", mimeType: "image/png" },
							})),
						),
					generateId: () => "fetch-effect-1",
				},
			),
		);

		expect(updates).toEqual(["Fetching 1 URL(s)..."]);
		expect(result.content).toEqual([
			{ type: "image", data: "image-data", mimeType: "image/png" },
			{ type: "text", text: "Extracted body for https://example.com/article" },
		]);
		expect(result.details).toEqual({
			urls: ["https://example.com/article"],
			urlCount: 1,
			successful: 1,
			totalChars: "Extracted body for https://example.com/article".length,
			title: "Example Article",
			responseId: "fetch-effect-1",
			truncated: false,
			hasImage: true,
			imageCount: 1,
		});

		expect(getResult("fetch-effect-1")).toEqual({
			id: "fetch-effect-1",
			type: "fetch",
			timestamp: expect.any(Number),
			urls: [
				{
					url: "https://example.com/article",
					title: "Example Article",
					content: "Extracted body for https://example.com/article",
					error: null,
				},
			],
		});
	});

	it("returns multi-url summary with response id", async () => {
		const result = await Effect.runPromise(
			executeFetchContent(
				{ urls: ["https://a.test", "https://b.test"] },
				{},
				{
					fetchContent: (urls) =>
						Effect.succeed([
							{
								url: urls[0] ?? "",
								title: "Alpha",
								content: "Alpha body",
								error: null,
							},
							{
								url: urls[1] ?? "",
								title: "",
								content: "",
								error: "HTTP 403: Forbidden",
							},
						]),
					generateId: () => "fetch-effect-2",
				},
			),
		);

		const summary = result.content[0];
		if (!summary || summary.type !== "text") {
			throw new Error("expected text summary");
		}
		expect(summary.text).toBe(
			"## Fetched URLs\n\n- Alpha (10 chars)\n- https://b.test: Error - HTTP 403: Forbidden\n\n---\nUse get_search_content({ responseId: \"fetch-effect-2\", urlIndex: 0 }) to retrieve full content.",
		);
		expect(result.details).toEqual({
			urls: ["https://a.test", "https://b.test"],
			urlCount: 2,
			successful: 1,
			totalChars: 10,
			responseId: "fetch-effect-2",
		});
	});

	it("returns validation guidance when no url is provided", async () => {
		const result = await Effect.runPromise(executeFetchContent({}));
		expect(result).toEqual({
			content: [{ type: "text", text: "Error: No URL provided." }],
			details: { error: "No URL provided" },
		});
	});
});
