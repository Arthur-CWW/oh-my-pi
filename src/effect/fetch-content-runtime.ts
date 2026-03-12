import { Readability } from "@mozilla/readability";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { Data, Effect, Schema } from "effect";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { extractContent as legacyExtractContent } from "../../packages/legacy-web-access/src/extract.js";
import { API_BASE, DEFAULT_MODEL, getApiKey } from "./gemini-api.js";
import { extractRSCContent } from "./rsc-extract.js";
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
const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");
const YOUTUBE_REGEX =
	/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const LOCAL_VIDEO_EXTENSIONS = new Set([
	".mp4",
	".mov",
	".webm",
	".avi",
	".mpeg",
	".mpg",
	".wmv",
	".flv",
	".3gp",
	".3gpp",
]);

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
	readonly legacyExtractContent: (
		url: string,
		signal?: AbortSignal,
		options?: ExtractOptions,
	) => Effect.Effect<ExtractedContent, unknown>;
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
	legacyExtractContent: (url, signal, options) =>
		Effect.tryPromise({
			try: () => legacyExtractContent(url, signal, options),
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

function readFeatureFlag(name: "youtube", defaultValue: boolean): boolean {
	try {
		if (!existsSync(WEB_SEARCH_CONFIG_PATH)) {
			return defaultValue;
		}
		const raw = JSON.parse(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8")) as {
			readonly youtube?: { readonly enabled?: boolean };
		};
		return raw[name]?.enabled ?? defaultValue;
	} catch {
		return defaultValue;
	}
}

function isLocalVideoPath(input: string): boolean {
	if (isValidUrl(input)) {
		return false;
	}
	return LOCAL_VIDEO_EXTENSIONS.has(extname(input).toLowerCase());
}

function isYouTubeUrl(input: string): boolean {
	try {
		const parsed = new URL(input);
		if (parsed.pathname === "/playlist") {
			return false;
		}
	} catch {
		return false;
	}
	return YOUTUBE_REGEX.test(input);
}

function isGitHubUrl(input: string): boolean {
	try {
		const hostname = new URL(input).hostname.toLowerCase();
		return hostname === "github.com" || hostname === "www.github.com" || hostname === "gist.github.com";
	} catch {
		return false;
	}
}

function isPdfContent(url: string, contentType?: string): boolean {
	if (contentType?.includes("application/pdf")) {
		return true;
	}
	try {
		return new URL(url).pathname.toLowerCase().endsWith(".pdf");
	} catch {
		return false;
	}
}

function shouldUseLegacyExtract(url: string, options?: ExtractOptions): boolean {
	if (options?.frames || options?.timestamp) {
		return true;
	}
	if (isGitHubUrl(url) || isLocalVideoPath(url) || isPdfContent(url)) {
		return true;
	}
	return isYouTubeUrl(url) && readFeatureFlag("youtube", true);
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
				return null;
			}

			const content = yield* readTextResponseEffect(response);
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
			Effect.catchTag("FetchContentRuntimeError", () => Effect.succeed(null)),
			Effect.catchDefect(() => Effect.succeed(null)),
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
				return null;
			}

			const data = yield* readJsonResponseEffect<UrlContextResponse>(response);
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
			Effect.catchTag("FetchContentRuntimeError", () => Effect.succeed(null)),
			Effect.catchDefect(() => Effect.succeed(null)),
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

		const program = Effect.gen(function* () {
			const text = yield* runtimeDeps.queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
				model: "gemini-3-flash-preview",
				signal,
				timeoutMs: 60000,
			});
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
			Effect.catch(() => Effect.succeed(null)),
			Effect.catchDefect(() => Effect.succeed(null)),
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
			return makeErrorResult(url, `HTTP ${response.status}: ${response.statusText}`);
		}

		const contentLengthHeader = response.headers.get("content-length");
		const contentType = response.headers.get("content-type") || "";
		const pdfContent = isPdfContent(url, contentType);
		const maxResponseSize = pdfContent ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
		if (contentLengthHeader) {
			const contentLength = Number.parseInt(contentLengthHeader, 10);
			if (Number.isFinite(contentLength) && contentLength > maxResponseSize) {
				return makeErrorResult(
					url,
					`Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`,
				);
			}
		}

		if (pdfContent) {
			return yield* runtimeDeps.legacyExtractContent(url, signal, options).pipe(
				Effect.mapError(toFetchContentRuntimeError),
			);
		}

		if (
			contentType.includes("application/octet-stream") ||
			contentType.includes("image/") ||
			contentType.includes("audio/") ||
			contentType.includes("video/") ||
			contentType.includes("application/zip")
		) {
			return makeErrorResult(url, `Unsupported content type: ${contentType.split(";")[0]}`);
		}

		const text = yield* readTextResponseEffect(response);
		const isHtml =
			contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
		if (!isHtml) {
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
				return { url, title: rscResult.title, content: rscResult.content, error: null };
			}

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
			Effect.succeed(makeErrorResult(url, error.reason)),
		),
		Effect.catchDefect((defect) => Effect.succeed(makeErrorResult(url, toErrorMessage(defect)))),
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
