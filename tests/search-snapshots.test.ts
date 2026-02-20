import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
	postProcessCondensed,
	preprocessSearchResults,
	type PreprocessedData,
} from "../src/old/search-filter.js";
import type { SearchResult } from "../src/old/perplexity.js";
import type { QueryResultData } from "../src/old/storage.js";

const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

function assertSnapshot(path: string, value: string): void {
	if (UPDATE || !existsSync(path)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${value}\n`);
	}
	const expected = readFileSync(path, "utf-8");
	expect(`${value}\n`).toBe(expected);
}

function makeResultsMap(): Map<number, QueryResultData> {
	return new Map<number, QueryResultData>([
		[
			1,
			{
				query: "bun runtime performance",
				answer:
					"Bun is fast for startup and http benchmarks. Bun uses JavaScriptCore and bundles tooling.",
				results: [
					{ title: "Bun Runtime", url: "https://bun.com/docs/runtime", snippet: "" },
					{ title: "Bun Install", url: "https://bun.com/docs/installation", snippet: "" },
					{ title: "HN Thread", url: "https://news.ycombinator.com/item?id=123", snippet: "" },
				],
				error: null,
			},
		],
		[
			2,
			{
				query: "node vs bun benchmarks",
				answer:
					"Benchmarks compare Bun and Node. Bun startup is faster and tooling is integrated for dev workflows.",
				results: [
					{ title: "Bun Runtime", url: "https://www.bun.com/docs/runtime", snippet: "" },
					{ title: "Node Docs", url: "https://nodejs.org/docs/latest/api/", snippet: "" },
					{ title: "StackOverflow", url: "https://stackoverflow.com/questions/123", snippet: "" },
				],
				error: null,
			},
		],
	]);
}

function normalizePreprocessed(data: PreprocessedData): string {
	return JSON.stringify(data, null, 2);
}

function makeSources(): SearchResult[] {
	return [
		{ title: "Bun Runtime", url: "https://bun.com/docs/runtime", snippet: "" },
		{ title: "Node Docs", url: "https://nodejs.org/docs/latest/api/", snippet: "" },
		{ title: "StackOverflow Thread", url: "https://stackoverflow.com/questions/123", snippet: "" },
	];
}

describe("search snapshots", () => {
	it("snapshot: preprocess search normalization output", () => {
		const preprocessed = preprocessSearchResults(makeResultsMap());
		assertSnapshot(
			join(process.cwd(), "tests", "snapshots", "search-preprocess.snapshot.json"),
			normalizePreprocessed(preprocessed),
		);
	});

	it("snapshot: condensed post-process output", () => {
		const condensed = [
			"Bun startup is commonly reported faster than Node [bun.com, nodejs.org].",
			"Community comparisons also discuss workflow ergonomics [stackoverflow.com].",
		].join("\n\n");
		const output = postProcessCondensed(condensed, makeSources());
		assertSnapshot(
			join(process.cwd(), "tests", "snapshots", "search-condensed.snapshot.md"),
			output,
		);
	});
});
