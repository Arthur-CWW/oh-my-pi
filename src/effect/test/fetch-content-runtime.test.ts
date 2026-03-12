import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { API_BASE, DEFAULT_MODEL } from "../gemini-api.js";
import {
	extractContentEffect,
	extractViaHttpEffect,
	type ExtractedContent,
	type FetchContentRuntimeDeps,
} from "../fetch-content-runtime.js";

function makeLongArticleHtml(title: string): string {
	const paragraph =
		"This article paragraph contains enough readable text for markdown extraction and fallback validation. ";
	const body = Array.from({ length: 8 }, () => `<p>${paragraph.repeat(8)}</p>`).join("");
	return `<!doctype html><html><head><title>${title}</title></head><body><main><article><h1>${title}</h1>${body}</article></main></body></html>`;
}

function makeJsShellHtml(title: string): string {
	return `<!doctype html><html><head><title>${title}</title></head><body><div id="app"></div><script>window.__A__=1</script><script>window.__B__=2</script><script>window.__C__=3</script><script>window.__D__=4</script></body></html>`;
}

function unexpected(name: string): never {
	throw new Error(`unexpected ${name}`);
}

function makeDeps(
	overrides: Partial<FetchContentRuntimeDeps> = {},
): Partial<FetchContentRuntimeDeps> {
	return {
		fetch: async (_input: string | URL | Request, _init?: RequestInit) => unexpected("fetch"),
		legacyExtractContent: () => Effect.fail({ _tag: "UnexpectedLegacyExtract" as const }),
		getApiKey: () => null,
		isGeminiWebAvailable: () => Effect.succeed(null),
		queryWithCookies: () => Effect.fail({ _tag: "UnexpectedGeminiWebQuery" as const }),
		...overrides,
	};
}

describe("effect fetch-content runtime", () => {

	it("extracts general HTML pages through the Effect-owned HTTP pipeline", async () => {
		const html = makeLongArticleHtml("Example Article");
		const result = await Effect.runPromise(
			extractViaHttpEffect(
				"https://example.com/article",
				undefined,
				undefined,
				makeDeps({
					fetch: async () =>
						new Response(html, {
							status: 200,
							headers: { "content-type": "text/html; charset=utf-8" },
						}),
				}),
			),
		);

		expect(result.error).toBeNull();
		expect(result.title).toBe("Example Article");
		expect(result.content).toContain("readable text for markdown extraction");
		expect(result.content.length).toBeGreaterThan(500);
	});

	it("falls back to Jina when HTTP extraction fails recoverably", async () => {
		const url = "https://example.com/protected";
		const result = await Effect.runPromise(
			extractContentEffect(
				url,
				undefined,
				undefined,
				makeDeps({
					fetch: async (input: string | URL | Request) => {
						if (input === url) {
							return new Response("Forbidden", {
								status: 403,
								statusText: "Forbidden",
								headers: { "content-type": "text/plain" },
							});
						}
						if (input === `https://r.jina.ai/${url}`) {
							return new Response(
								`Title: Example\n\nMarkdown Content:\n# Jina Title\n\n${"Jina extracted content ".repeat(12)}`,
								{ status: 200, headers: { "content-type": "text/plain" } },
							);
						}
						throw new Error(`unexpected fetch url: ${String(input)}`);
					},
				}),
			),
		);

		expect(result).toEqual({
			url,
			title: "Jina Title",
			content: expect.stringContaining("Jina extracted content"),
			error: null,
		});
	});

	it("falls back to Gemini URL context after HTTP and Jina fail", async () => {
		const url = "https://example.com/app";
		const geminiResponse = {
			candidates: [
				{
					content: {
						parts: [{ text: `# Gemini Title\n\n${"Gemini recovered page body. ".repeat(6)}` }],
					},
					url_context_metadata: {
						url_metadata: [{ url_retrieval_status: "URL_RETRIEVAL_STATUS_SUCCESS" }],
					},
				},
			],
		};

		const result = await Effect.runPromise(
			extractContentEffect(
				url,
				undefined,
				undefined,
				makeDeps({
					fetch: async (input: string | URL | Request) => {
						if (input === url) {
							return new Response(makeJsShellHtml("App Shell"), {
								status: 200,
								headers: { "content-type": "text/html; charset=utf-8" },
							});
						}
						if (input === `https://r.jina.ai/${url}`) {
							return new Response("Markdown Content:\nLoading...", {
								status: 200,
								headers: { "content-type": "text/plain" },
							});
						}
						if (
							String(input).startsWith(
								`${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=test-key`,
							)
						) {
							return new Response(JSON.stringify(geminiResponse), {
								status: 200,
								headers: { "content-type": "application/json" },
							});
						}
						throw new Error(`unexpected fetch url: ${String(input)}`);
					},
					getApiKey: () => "test-key",
				}),
			),
		);

		expect(result).toEqual({
			url,
			title: "Gemini Title",
			content: expect.stringContaining("Gemini recovered page body."),
			error: null,
		});
	});

	it("falls back to Gemini web when URL context is unavailable", async () => {
		const url = "https://example.com/client-only";
		const result = await Effect.runPromise(
			extractContentEffect(
				url,
				undefined,
				undefined,
				makeDeps({
					fetch: async (input: string | URL | Request) => {
						if (input === url) {
							return new Response(makeJsShellHtml("Client Only"), {
								status: 200,
								headers: { "content-type": "text/html; charset=utf-8" },
							});
						}
						if (input === `https://r.jina.ai/${url}`) {
							return new Response("Markdown Content:\nPlease enable JavaScript", {
								status: 200,
								headers: { "content-type": "text/plain" },
							});
						}
						throw new Error(`unexpected fetch url: ${String(input)}`);
					},
					isGeminiWebAvailable: () =>
						Effect.succeed({
							"__Secure-1PSID": "cookie-a",
							"__Secure-1PSIDTS": "cookie-b",
						}),
					queryWithCookies: () =>
						Effect.succeed(`# Gemini Web Title\n\n${"Gemini web page body. ".repeat(6)}`),
				}),
			),
		);

		expect(result).toEqual({
			url,
			title: "Gemini Web Title",
			content: expect.stringContaining("Gemini web page body."),
			error: null,
		});
	});

	it("preserves non-recoverable HTTP errors without invoking fallbacks", async () => {
		const url = "https://example.com/logo.png";
		const result = await Effect.runPromise(
			extractContentEffect(
				url,
				undefined,
				undefined,
				makeDeps({
					fetch: async (input: string | URL | Request) => {
						if (input === url) {
							return new Response("binary", {
								status: 200,
								headers: { "content-type": "image/png" },
							});
						}
						throw new Error(`unexpected fallback fetch: ${String(input)}`);
					},
					getApiKey: () => "test-key",
					isGeminiWebAvailable: () =>
						Effect.succeed({
							"__Secure-1PSID": "cookie-a",
							"__Secure-1PSIDTS": "cookie-b",
						}),
					queryWithCookies: () => Effect.fail({ _tag: "UnexpectedFallbackQuery" as const }),
				}),
			),
		);

		expect(result).toEqual<ExtractedContent>({
			url,
			title: "",
			content: "",
			error: "Unsupported content type: image/png",
		});
	});

	it("keeps later-pass timestamp and video flows delegated to the legacy extractor", async () => {
		const legacyResult: ExtractedContent = {
			url: "https://example.com/not-a-video",
			title: "Frame at 00:10",
			content: "legacy delegated result",
			error: null,
		};

		const result = await Effect.runPromise(
			extractContentEffect(
				legacyResult.url,
				undefined,
				{ timestamp: "00:10" },
				makeDeps({
					legacyExtractContent: () => Effect.succeed(legacyResult),
				}),
			),
		);

		expect(result).toEqual(legacyResult);
	});

	it("delegates github and pdf flows to the legacy extractor", async () => {
		const githubResult: ExtractedContent = {
			url: "https://github.com/example/repo",
			title: "repo",
			content: "legacy github result",
			error: null,
		};
		const pdfResult: ExtractedContent = {
			url: "https://example.com/doc.pdf",
			title: "doc",
			content: "legacy pdf result",
			error: null,
		};
		const delegatedUrls: string[] = [];

		const github = await Effect.runPromise(
			extractContentEffect(
				githubResult.url,
				undefined,
				undefined,
				makeDeps({
					legacyExtractContent: (url) => {
						delegatedUrls.push(url);
						return Effect.succeed(url === githubResult.url ? githubResult : pdfResult);
					},
				}),
			),
		);
		const pdf = await Effect.runPromise(
			extractContentEffect(
				pdfResult.url,
				undefined,
				undefined,
				makeDeps({
					legacyExtractContent: (url) => {
						delegatedUrls.push(url);
						return Effect.succeed(url === githubResult.url ? githubResult : pdfResult);
					},
				}),
			),
		);

		expect(github).toEqual(githubResult);
		expect(pdf).toEqual(pdfResult);
		expect(delegatedUrls).toEqual([githubResult.url, pdfResult.url]);
	});

	it("returns guidance when all general-page fallbacks are exhausted", async () => {
		const url = "https://example.com/blocked";
		const result = await Effect.runPromise(
			extractContentEffect(
				url,
				undefined,
				undefined,
				makeDeps({
					fetch: async (input: string | URL | Request) => {
						if (input === url) {
							return new Response("Forbidden", {
								status: 403,
								statusText: "Forbidden",
								headers: { "content-type": "text/plain" },
							});
						}
						if (input === `https://r.jina.ai/${url}`) {
							return new Response("Markdown Content:\nLoading...", {
								status: 200,
								headers: { "content-type": "text/plain" },
							});
						}
						throw new Error(`unexpected fetch url: ${String(input)}`);
					},
				}),
			),
		);

		expect(result.error).toContain("HTTP 403: Forbidden");
		expect(result.error).toContain("Fallback options:");
		expect(result.error).toContain("Use web_search to find content about this topic");
	});
});
