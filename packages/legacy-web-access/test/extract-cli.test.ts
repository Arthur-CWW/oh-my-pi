import { describe, expect, it } from "bun:test";
import {
	parseFetchCliArgs,
	runFetchCli,
	type ExtractedContent,
} from "../src/extract.ts";

describe("fetch CLI", () => {
	it("parses URLs + extraction flags", () => {
		const parsed = parseFetchCliArgs([
			"--url",
			"https://example.com/a",
			"--urls",
			"https://example.com/b,https://example.com/c",
			"--prompt",
			"what happened",
			"--timestamp",
			"23:41-25:00",
			"--frames",
			"4",
			"--timeout-ms",
			"15000",
			"--force-clone",
		]);
		expect(parsed.kind).toBe("ok");
		if (parsed.kind === "ok") {
			expect(parsed.value.urls).toEqual([
				"https://example.com/a",
				"https://example.com/b",
				"https://example.com/c",
			]);
			expect(parsed.value.options).toEqual({
				prompt: "what happened",
				timestamp: "23:41-25:00",
				frames: 4,
				timeoutMs: 15000,
				forceClone: true,
			});
		}
	});

	it("runs fetch CLI with injected fetcher", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const result: ExtractedContent = {
			url: "https://example.com",
			title: "Example",
			content: "Hello from extract",
			error: null,
		};
		const exitCode = await runFetchCli(["https://example.com", "--json"], {
			fetchAll: async () => [result],
			stdout: (text) => output.push(text),
			stderr: (text) => errors.push(text),
		});

		expect(exitCode).toBe(0);
		expect(errors).toEqual([]);
		expect(output[0]).toContain('"urls"');
		expect(output[0]).toContain('"https://example.com"');
		expect(output[0]).toContain('"title": "Example"');
	});
});
