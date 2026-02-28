import { describe, expect, it } from "bun:test";
import { buildKagiVisualizerHtml, buildVisualizerModelFromRaw } from "../packages/kagi/src/kagi-visualizer.js";

describe("kagi visualizer", () => {
	it("builds model and extracts HTML search results with published date", () => {
		const rawSse =
			'id: 0\ndata: [{"tag":"search","payload":{"content":"<div class=\\"_0_SRI search-result\\"><div class=\\"_0_TITLE __sri-title\\"><h3><a class=\\"__sri_title_link\\" href=\\"https://example.com\\">Example Result</a></h3></div><div class=\\"_0_DESC __sri-desc\\"><div><span class=\\"__sri-time\\">Jan 2, 2026</span> Example snippet text</div></div></div>"}}]\n\n';

		const model = buildVisualizerModelFromRaw({
			title: "Visualizer test",
			sourceLabel: "unit-test",
			rawSse,
			metadata: { query: "example" },
		});

		expect(model.events.length).toBe(1);
		expect(model.summaryResults).toHaveLength(1);
		expect(model.summaryResults[0]).toEqual({
			title: "Example Result",
			url: "https://example.com",
			snippet: "Jan 2, 2026 Example snippet text",
			publishedAt: "Jan 2, 2026",
		});
	});

	it("supports non-SSE JSON payload visualization", () => {
		const model = buildVisualizerModelFromRaw({
			title: "JSON payload",
			sourceLabel: "unit-test-json",
			rawSse: "",
			additionalPayload: {
				results: [
					{
						title: "JSON Result",
						url: "https://json.example",
						snippet: "from json payload",
						published_at: "2024-01-01",
					},
				],
			},
		});

		expect(model.events.length).toBe(1);
		expect(model.summaryResults).toEqual([
			{
				title: "JSON Result",
				url: "https://json.example",
				snippet: "from json payload",
				publishedAt: "2024-01-01",
			},
		]);
	});

	it("renders visualizer html with vim-style shortcuts and iframe", () => {
		const model = buildVisualizerModelFromRaw({
			title: "Visualizer HTML",
			sourceLabel: "unit-test-html",
			rawSse: "id: 0\ndata: []\n\n",
		});
		const html = buildKagiVisualizerHtml(model);

		expect(html).toContain("Vim-style shortcuts");
		expect(html).toContain("id=\"render-frame\"");
		expect(html).toContain("/ filter");
		expect(html).toContain("application/json");
	});
});
