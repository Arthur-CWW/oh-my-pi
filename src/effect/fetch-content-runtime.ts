import { Readability } from "@mozilla/readability";
import { Data, Effect, Schema } from "effect";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { activityMonitor } from "../../packages/legacy-web-access/src/activity.js";
import { extractContent as legacyExtractContent } from "../../packages/legacy-web-access/src/extract.js";
import { extractGitHub } from "../../packages/legacy-web-access/src/github-extract.js";
import { extractPDFToMarkdown, type PDFExtractResult, isPDF } from "../../packages/legacy-web-access/src/pdf-extract.js";
import { extractRSCContent } from "../../packages/legacy-web-access/src/rsc-extract.js";
import { isVideoFile } from "../../packages/legacy-web-access/src/video-extract.js";
import { isYouTubeEnabled, isYouTubeURL } from "../../packages/legacy-web-access/src/youtube-extract.js";
import { API_BASE, DEFAULT_MODEL, getApiKey } from "./gemini-api.js";
import {
	isGeminiWebAvailableEffect,
	queryWithCookiesEffect,
	type CookieMap,
	type GeminiWebOptions,
} from "./gemini-web.js";

const DEFAULT_TIMEOUT_MS = 30000;
const JINA_TIMEOUT_MS = 30000;
const CONCURRENT_LIMIT = 3;
const MIN_USEFUL_CONTENT = 500;
const JINA_READER_BASE = "https://r.jina.ai/";
const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown.
Include the page title, all text content, code blocks, and tables.
Do not summarize — extract the full content.

URL: `;
const NON_RECOVERABLE_ERRORS = ["Unsupported content type", "Response too large"] as const;

const HTTP_HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
	Accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
	"Cache-Control": "no-cache",
	"Sec-Fetch-Dest": "document",
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Site": "none",
	"Sec-Fetch-User": "?1",
	"Upgrade-Insecure-Requests": "1",
} as const;

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

export interface VideoFrame {
	readonly data: string;
	readonly mimeType: string;
	readonly timestamp: string;
}

export interface ExtractedContent {
	readonly url: string;
	readonly title: string;
	readonly content: string;
	readonly error: string | null;
	readonly thumbnail?: { readonly data: string; readonly mimeType: string };
	readonly frames?: VideoFrame[];
	readonly duration?: number;
}

export interface ExtractOptions {
	readonly timeoutMs?: number;
	readonly forceClone?: boolean;
	readonly prompt?: string;
	readonly timestamp?: string;
	readonly frames?: number;
	readonly model?: string;
}

export interface UrlContextResponse {
	readonly candidates?: ReadonlyArray<{
		readonly content?: {
			readonly parts?: ReadonlyArray<{ readonly text?: string }>;
		};
		readonly url_context_metadata?: {
			readonly url_metadata?: ReadonlyArray<{
				readonly retrieved_url?: string;
				readonly url_retrieval_status?: string;
			}>;
		};
	}>;
}

class FetchContentRuntimeError extends Data.TaggedError("FetchContentRuntimeError")<{
	readonly reason: string;
}> {}

export interface FetchContentRuntimeDeps {
	readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	readonly extractGitHub: (
		url: string,
		signal?: AbortSignal,
		forceClone?: boolean,
	) => Effect.Effect<ExtractedContent | null, unknown>;
	readonly legacyExtractContent: (
		url: string,
		signal?: AbortSignal,
		options?: ExtractOptions,
	) => Effect.Effect<ExtractedContent, unknown>;
	readonly extractPdfToMarkdown: (
		buffer: ArrayBuffer,
		url: string,
	) => Effect.Effect<PDFExtractResult, unknown>;
	readonly getApiKey: () => string | null;
	readonly isGeminiWebAvailable: () => Effect.Effect<CookieMap | null, unknown>;
	readonly queryWithCookies: (
		prompt: string,
		cookieMap: CookieMap,
		options?: GeminiWebOptions,
	) => Effect.Effect<string, unknown>;
}

const defaultDeps: FetchContentRuntimeDeps = {
	fetch,
	extractGitHub: (url, signal, forceClone) =>
		Effect.tryPromise({
			try: () => extractGitHub(url, signal, forceClone),
			catch: toFetchContentRuntimeError,
		}),
	legacyExtractContent: (url, signal, options) =>
		Effect.tryPromise({
			try: () => legacyExtractContent(url, signal, options),
			catch: toFetchContentRuntimeError,
		}),
	extractPdfToMarkdown: (buffer, url) =>
		Effect.tryPromise({
			try: () => extractPDFToMarkdown(buffer, url),
			catch: toFetchContentRuntimeError,
		}),
	getApiKey,
	isGeminiWebAvailable: () => isGeminiWebAvailableEffect(),
	queryWithCookies: (prompt, cookieMap, options) =>
		queryWithCookiesEffect(prompt, cookieMap, options),
};

function resolveDeps(deps: Partial<FetchContentRuntimeDeps> | undefined): FetchContentRuntimeDeps {
	return {
		...defaultDeps,
		...deps,
	};
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === "object" && "reason" in error) {
		const reason = (error as { readonly reason: unknown }).reason;
		if (typeof reason === "string") {
			return reason;
		}
	}
	return String(error);
}

function toFetchContentRuntimeError(error: unknown): FetchContentRuntimeError {
	return new FetchContentRuntimeError({ reason: toErrorMessage(error) });
}

function isAbortLikeError(error: unknown): boolean {
	const message = toErrorMessage(error).toLowerCase();
	return message.includes("abort");
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isValidUrl(url: string): boolean {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
}

function pathTitle(url: string): string {
	return new URL(url).pathname.split("/").pop() || url;
}

function extractTextTitle(text: string, url: string): string {
	return extractHeadingTitle(text) ?? pathTitle(url);
}

function extractTitleFromContent(text: string, url: string): string {
	return extractHeadingTitle(text) ?? pathTitle(url);
}

function isLikelyJSRendered(html: string): boolean {
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (!bodyMatch) {
		return false;
	}

	const bodyHtml = bodyMatch[1];
	const textContent = bodyHtml
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const scriptCount = (html.match(/<script/gi) || []).length;
	return textContent.length < 500 && scriptCount > 3;
}

function shouldUseLegacyExtract(url: string, options?: ExtractOptions): boolean {
	if (options?.frames || options?.timestamp) {
		return true;
	}
	if (isVideoFile(url)) {
		return true;
	}
	const ytInfo = isYouTubeURL(url);
	return ytInfo.isYouTube && isYouTubeEnabled();
}

function makeErrorResult(url: string, error: string): ExtractedContent {
	return { url, title: "", content: "", error };
}

function isNonRecoverableHttpError(error: string | null): boolean {
	if (!error) {
		return false;
	}
	return NON_RECOVERABLE_ERRORS.some((prefix) => error.startsWith(prefix));
}

function fallbackGuidance(error: string): string {
	return [
		error,
		"",
		"Fallback options:",
		"  • Set geminiApiKey in ~/.pi/web-search.json (or GEMINI_API_KEY env var)",
		"  • Sign into gemini.google.com in Chrome",
		"  • Use web_search to find content about this topic",
	].join("\n");
}

function logActivityFailure(activityId: string, error: unknown, onAbortStatus = 0): void {
	if (isAbortLikeError(error)) {
		activityMonitor.logComplete(activityId, onAbortStatus);
		return;
	}
	activityMonitor.logError(activityId, toErrorMessage(error));
}

function readJsonResponseEffect<A>(response: Response): Effect.Effect<A, FetchContentRuntimeError> {
	return Effect.tryPromise({
		try: () => response.json() as Promise<A>,
		catch: toFetchContentRuntimeError,
	});
}

function readTextResponseEffect(
	response: Response,
): Effect.Effect<string, FetchContentRuntimeError> {
	return Effect.tryPromise({
		try: () => response.text(),
		catch: toFetchContentRuntimeError,
	});
}

function readBufferResponseEffect(
	response: Response,
): Effect.Effect<ArrayBuffer, FetchContentRuntimeError> {
	return Effect.tryPromise({
		try: () => response.arrayBuffer(),
		catch: toFetchContentRuntimeError,
	});
}

export function extractHeadingTitle(text: string): string | null {
	const match = text.match(/^#{1,2}\s+(.+)/m);
	if (!match) {
		return null;
	}
	const cleaned = match[1]?.replace(/\*+/g, "").trim();
	return cleaned || null;
}

export const extractWithJinaReaderEffect = Effect.fn("FetchContentRuntime.extractWithJinaReader")(
	function* (url: string, signal?: AbortSignal, deps?: Partial<FetchContentRuntimeDeps>) {
		const runtimeDeps = resolveDeps(deps);
		const jinaUrl = JINA_READER_BASE + url;
		const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });

		const program = Effect.gen(function* () {
			const response = yield* Effect.tryPromise({
				try: () =>
					runtimeDeps.fetch(jinaUrl, {
						headers: {
							Accept: "text/markdown",
							"X-No-Cache": "true",
						},
						signal: withTimeout(signal, JINA_TIMEOUT_MS),
					}),
				catch: toFetchContentRuntimeError,
			});

			if (!response.ok) {
				yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
				return null;
			}

			const content = yield* readTextResponseEffect(response);
			yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));

			const contentStart = content.indexOf("Markdown Content:");
			if (contentStart < 0) {
				return null;
			}

			const markdownPart = content.slice(contentStart + 17).trim();
			if (
				markdownPart.length < 100 ||
				markdownPart.startsWith("Loading...") ||
				markdownPart.startsWith("Please enable JavaScript")
			) {
				return null;
			}

			return {
				url,
				title: extractHeadingTitle(markdownPart) ?? pathTitle(url),
				content: markdownPart,
				error: null,
			} satisfies ExtractedContent;
		});

		return yield* program.pipe(
			Effect.catchTag("FetchContentRuntimeError", (error) =>
				Effect.sync(() => {
					logActivityFailure(activityId, error);
					return null;
				}),
			),
			Effect.catchDefect((defect) =>
				Effect.sync(() => {
					logActivityFailure(activityId, defect);
					return null;
				}),
			),
		);
	},
);

export const extractWithUrlContextEffect = Effect.fn("FetchContentRuntime.extractWithUrlContext")(
	function* (url: string, signal?: AbortSignal, deps?: Partial<FetchContentRuntimeDeps>) {
		const runtimeDeps = resolveDeps(deps);
		const apiKey = runtimeDeps.getApiKey();
		if (!apiKey) {
			return null;
		}

		const activityId = activityMonitor.logStart({ type: "api", query: `url_context: ${url}` });
		const requestBody = {
			contents: [{ parts: [{ text: EXTRACTION_PROMPT + url }] }],
			tools: [{ url_context: {} }],
		};

		const program = Effect.gen(function* () {
			const response = yield* Effect.tryPromise({
				try: () =>
					runtimeDeps.fetch(`${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(requestBody),
						signal: withTimeout(signal, 60000),
					}),
				catch: toFetchContentRuntimeError,
			});

			if (!response.ok) {
				yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
				return null;
			}

			const data = yield* readJsonResponseEffect<UrlContextResponse>(response);
			yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));

			const metadata = data.candidates?.[0]?.url_context_metadata;
			if (metadata?.url_metadata?.length) {
				const status = metadata.url_metadata[0]?.url_retrieval_status;
				if (status === "URL_RETRIEVAL_STATUS_UNSAFE" || status === "URL_RETRIEVAL_STATUS_ERROR") {
					return null;
				}
			}

			const content =
				data.candidates?.[0]?.content?.parts
					?.map((part) => part.text)
					.filter((value): value is string => typeof value === "string" && value.length > 0)
					.join("\n") ?? "";
			if (content.length < 50) {
				return null;
			}

			return {
				url,
				title: extractTitleFromContent(content, url),
				content,
				error: null,
			} satisfies ExtractedContent;
		});

		return yield* program.pipe(
			Effect.catchTag("FetchContentRuntimeError", (error) =>
				Effect.sync(() => {
					logActivityFailure(activityId, error);
					return null;
				}),
			),
			Effect.catchDefect((defect) =>
				Effect.sync(() => {
					logActivityFailure(activityId, defect);
					return null;
				}),
			),
		);
	},
);

export const extractWithGeminiWebEffect = Effect.fn("FetchContentRuntime.extractWithGeminiWeb")(
	function* (url: string, signal?: AbortSignal, deps?: Partial<FetchContentRuntimeDeps>) {
		const runtimeDeps = resolveDeps(deps);
		const cookies = yield* runtimeDeps.isGeminiWebAvailable().pipe(
			Effect.catch(() => Effect.succeed<CookieMap | null>(null)),
			Effect.catchDefect(() => Effect.succeed<CookieMap | null>(null)),
		);
		if (!cookies) {
			return null;
		}

		const activityId = activityMonitor.logStart({ type: "api", query: `gemini_web: ${url}` });
		const program = Effect.gen(function* () {
			const text = yield* runtimeDeps.queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
				model: "gemini-3-flash-preview",
				signal,
				timeoutMs: 60000,
			});
			yield* Effect.sync(() => activityMonitor.logComplete(activityId, 200));
			if (text.length < 50) {
				return null;
			}

			return {
				url,
				title: extractTitleFromContent(text, url),
				content: text,
				error: null,
			} satisfies ExtractedContent;
		});

		return yield* program.pipe(
			Effect.catch((error) =>
				Effect.sync(() => {
					logActivityFailure(activityId, error);
					return null;
				}),
			),
			Effect.catchDefect((defect) =>
				Effect.sync(() => {
					logActivityFailure(activityId, defect);
					return null;
				}),
			),
		);
	},
);

export const extractViaHttpEffect = Effect.fn("FetchContentRuntime.extractViaHttp")(function* (
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
	deps?: Partial<FetchContentRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const activityId = activityMonitor.logStart({ type: "fetch", url });

	const program = Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () =>
				runtimeDeps.fetch(url, {
					signal: withTimeout(signal, timeoutMs),
					headers: HTTP_HEADERS,
				}),
			catch: toFetchContentRuntimeError,
		});

		if (!response.ok) {
			yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
			return makeErrorResult(url, `HTTP ${response.status}: ${response.statusText}`);
		}

		const contentLengthHeader = response.headers.get("content-length");
		const contentType = response.headers.get("content-type") || "";
		const isPdfContent = isPDF(url, contentType);
		const maxResponseSize = isPdfContent ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
		if (contentLengthHeader) {
			const contentLength = Number.parseInt(contentLengthHeader, 10);
			if (Number.isFinite(contentLength) && contentLength > maxResponseSize) {
				yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
				return makeErrorResult(
					url,
					`Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`,
				);
			}
		}

		if (isPdfContent) {
			const buffer = yield* readBufferResponseEffect(response);
			const result = yield* runtimeDeps
				.extractPdfToMarkdown(buffer, url)
				.pipe(Effect.mapError(toFetchContentRuntimeError));
			yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
			return {
				url,
				title: result.title,
				content: `PDF extracted and saved to: ${result.outputPath}\n\nPages: ${result.pages}\nCharacters: ${result.chars}`,
				error: null,
			} satisfies ExtractedContent;
		}

		if (
			contentType.includes("application/octet-stream") ||
			contentType.includes("image/") ||
			contentType.includes("audio/") ||
			contentType.includes("video/") ||
			contentType.includes("application/zip")
		) {
			yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
			return makeErrorResult(url, `Unsupported content type: ${contentType.split(";")[0]}`);
		}

		const text = yield* readTextResponseEffect(response);
		const isHtml =
			contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
		if (!isHtml) {
			yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
			return { url, title: extractTextTitle(text, url), content: text, error: null };
		}

		const { document } = yield* Effect.try({
			try: () => parseHTML(text),
			catch: toFetchContentRuntimeError,
		});
		const article = yield* Effect.try({
			try: () => new Readability(document as unknown as Document).parse(),
			catch: toFetchContentRuntimeError,
		});

		if (!article) {
			const rscResult = extractRSCContent(text);
			if (rscResult) {
				yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
				return { url, title: rscResult.title, content: rscResult.content, error: null };
			}

			yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
			return makeErrorResult(
				url,
				isLikelyJSRendered(text)
					? "Page appears to be JavaScript-rendered (content loads dynamically)"
					: "Could not extract readable content from HTML structure",
			);
		}

		const markdown = yield* Effect.try({
			try: () => turndown.turndown(article.content),
			catch: toFetchContentRuntimeError,
		});
		yield* Effect.sync(() => activityMonitor.logComplete(activityId, response.status));
		if (markdown.length < MIN_USEFUL_CONTENT) {
			return {
				url,
				title: article.title || "",
				content: markdown,
				error: isLikelyJSRendered(text)
					? "Page appears to be JavaScript-rendered (content loads dynamically)"
					: "Extracted content appears incomplete",
			};
		}

		return {
			url,
			title: article.title || "",
			content: markdown,
			error: null,
		} satisfies ExtractedContent;
	});

	return yield* program.pipe(
		Effect.catchTag("FetchContentRuntimeError", (error) =>
			Effect.sync(() => {
				logActivityFailure(activityId, error);
				return makeErrorResult(url, error.reason);
			}),
		),
		Effect.catchDefect((defect) =>
			Effect.sync(() => {
				const message = toErrorMessage(defect);
				logActivityFailure(activityId, message);
				return makeErrorResult(url, message);
			}),
		),
	);
});

export const extractContentEffect = Effect.fn("FetchContentRuntime.extractContent")(function* (
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
	deps?: Partial<FetchContentRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	if (signal?.aborted) {
		return makeErrorResult(url, "Aborted");
	}

	if (shouldUseLegacyExtract(url, options)) {
		return yield* runtimeDeps.legacyExtractContent(url, signal, options);
	}

	if (!isValidUrl(url)) {
		return makeErrorResult(url, "Invalid URL");
	}

	const githubResult = yield* runtimeDeps.extractGitHub(url, signal, options?.forceClone).pipe(
		Effect.catch(() => Effect.succeed<ExtractedContent | null>(null)),
		Effect.catchDefect(() => Effect.succeed<ExtractedContent | null>(null)),
	);
	if (githubResult) {
		return githubResult;
	}

	const httpResult = yield* extractViaHttpEffect(url, signal, options, runtimeDeps);
	if (!httpResult.error || signal?.aborted) {
		return httpResult;
	}
	if (isNonRecoverableHttpError(httpResult.error)) {
		return httpResult;
	}

	const jinaResult = yield* extractWithJinaReaderEffect(url, signal, runtimeDeps);
	if (jinaResult) {
		return jinaResult;
	}

	const geminiUrlResult = yield* extractWithUrlContextEffect(url, signal, runtimeDeps);
	if (geminiUrlResult) {
		return geminiUrlResult;
	}

	const geminiWebResult = yield* extractWithGeminiWebEffect(url, signal, runtimeDeps);
	if (geminiWebResult) {
		return geminiWebResult;
	}

	return {
		...httpResult,
		error: fallbackGuidance(httpResult.error),
	};
});

export const fetchAllContentEffect = Effect.fn("FetchContentRuntime.fetchAllContent")(function* (
	urls: ReadonlyArray<string>,
	signal?: AbortSignal,
	options?: ExtractOptions,
	deps?: Partial<FetchContentRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	return yield* Effect.forEach(
		urls,
		(url) => extractContentEffect(url, signal, options, runtimeDeps),
		{ concurrency: CONCURRENT_LIMIT },
	);
});
