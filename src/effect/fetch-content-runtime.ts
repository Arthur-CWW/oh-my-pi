import { Readability } from "@mozilla/readability";
import { Data, Effect } from "effect";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type {
	ExtractedContent,
	FrameResult,
	VideoFrame,
} from "../shared/fetch-content-contracts.js";
import { API_BASE, DEFAULT_MODEL, getApiKey } from "./gemini-api.js";
import { extractGitHub, parseGitHubUrl, type GitHubUrlInfo } from "./github-extract.js";
import { extractPDFToMarkdown, isPDF } from "./pdf-extract.js";
import { extractRSCContent } from "./rsc-extract.js";
import {
	extractHeadingTitle,
	formatSeconds,
} from "./fetch-content-utils.js";
import {
	isGeminiWebAvailableEffect,
	queryWithCookiesEffect,
	type CookieMap,
	type GeminiWebOptions,
} from "./gemini-web.js";
import {
	extractVideo,
	extractVideoFrame,
	extractLocalFrames,
	getLocalVideoDuration,
	isVideoFile,
	type VideoFileInfo,
} from "./video-extract.js";
import {
	extractYouTube,
	extractYouTubeFrame,
	extractYouTubeFrames,
	getYouTubeStreamInfo,
	isYouTubeEnabled,
	isYouTubeURL,
} from "./youtube-extract.js";

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
const DEFAULT_RANGE_FRAMES = 6;
const MIN_FRAME_INTERVAL = 5;

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

interface YouTubeStreamInfo {
	readonly streamUrl: string;
	readonly duration: number | null;
}

type YouTubeStreamResult = YouTubeStreamInfo | { readonly error: string };

class FetchContentRuntimeError extends Data.TaggedError("FetchContentRuntimeError")<{
	readonly reason: string;
}> {}

export interface FetchContentRuntimeDeps {
	readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	readonly extractGitHub: (
		url: string,
		signal?: AbortSignal,
		forceClone?: boolean,
	) => Promise<ExtractedContent | null>;
	readonly extractPDFToMarkdown: (
		buffer: ArrayBuffer,
		url: string,
	) => Promise<{ readonly title: string; readonly pages: number; readonly chars: number; readonly outputPath: string }>;
	readonly extractYouTube: (
		url: string,
		signal?: AbortSignal,
		prompt?: string,
		model?: string,
	) => Promise<ExtractedContent | null>;
	readonly getYouTubeStreamInfo: (videoId: string) => Promise<YouTubeStreamResult>;
	readonly extractYouTubeFrame: (
		videoId: string,
		seconds: number,
		streamInfo?: YouTubeStreamInfo,
	) => Promise<FrameResult>;
	readonly extractYouTubeFrames: (
		videoId: string,
		timestamps: ReadonlyArray<number>,
		streamInfo?: YouTubeStreamInfo,
	) => Promise<{
			readonly frames: ReadonlyArray<VideoFrame>;
			readonly duration: number | null;
			readonly error: string | null;
		}>;
	readonly isYouTubeEnabled: () => boolean;
	readonly isVideoFile: (input: string) => VideoFileInfo | null;
	readonly extractVideo: (
		info: VideoFileInfo,
		signal?: AbortSignal,
		options?: { readonly prompt?: string; readonly model?: string },
	) => Promise<ExtractedContent | null>;
	readonly extractVideoFrame: (filePath: string, seconds?: number) => Promise<FrameResult>;
	readonly getLocalVideoDuration: (
		filePath: string,
	) => Promise<number | { readonly error: string }>;
	readonly extractLocalFrames: (
		filePath: string,
		timestamps: ReadonlyArray<number>,
	) => Promise<{ readonly frames: ReadonlyArray<VideoFrame>; readonly error: string | null }>;
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
	extractGitHub,
	extractPDFToMarkdown,
	extractYouTube,
	getYouTubeStreamInfo: (videoId) => getYouTubeStreamInfo(videoId),
	extractYouTubeFrame,
	extractYouTubeFrames,
	isYouTubeEnabled,
	isVideoFile,
	extractVideo,
	extractVideoFrame,
	getLocalVideoDuration,
	extractLocalFrames,
	getApiKey,
	isGeminiWebAvailable: () => isGeminiWebAvailableEffect(),
	queryWithCookies: (prompt, cookieMap, options) => queryWithCookiesEffect(prompt, cookieMap, options),
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

function isGitHubUrl(input: string): boolean {
	return parseGitHubUrl(input) !== null;
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

function readTextResponseEffect(response: Response): Effect.Effect<string, FetchContentRuntimeError> {
	return Effect.tryPromise({
		try: () => response.text(),
		catch: toFetchContentRuntimeError,
	});
}

function parseTimestamp(timestamp: string): number | null {
	const numeric = Number(timestamp);
	if (!Number.isNaN(numeric) && numeric >= 0) {
		return Math.floor(numeric);
	}
	const parts = timestamp.split(":").map(Number);
	if (parts.some((part) => Number.isNaN(part) || part < 0)) {
		return null;
	}
	if (parts.length === 3) {
		return Math.floor((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0));
	}
	if (parts.length === 2) {
		return Math.floor((parts[0] ?? 0) * 60 + (parts[1] ?? 0));
	}
	return null;
}

type TimestampSpec =
	| { readonly type: "single"; readonly seconds: number }
	| { readonly type: "range"; readonly start: number; readonly end: number };

function parseTimestampSpec(timestamp: string): TimestampSpec | null {
	const dashIndex = timestamp.indexOf("-", 1);
	if (dashIndex > 0) {
		const start = parseTimestamp(timestamp.slice(0, dashIndex));
		const end = parseTimestamp(timestamp.slice(dashIndex + 1));
		if (start !== null && end !== null && end > start) {
			return { type: "range", start, end };
		}
	}
	const seconds = parseTimestamp(timestamp);
	return seconds !== null ? { type: "single", seconds } : null;
}

function computeRangeTimestamps(
	start: number,
	end: number,
	maxFrames: number = DEFAULT_RANGE_FRAMES,
): ReadonlyArray<number> {
	if (maxFrames <= 1) {
		return [start];
	}
	const duration = end - start;
	const idealInterval = duration / (maxFrames - 1);
	if (idealInterval < MIN_FRAME_INTERVAL) {
		const timestamps: number[] = [];
		for (let timestamp = start; timestamp <= end && timestamps.length < maxFrames; timestamp += MIN_FRAME_INTERVAL) {
			timestamps.push(timestamp);
		}
		return timestamps;
	}
	return Array.from({ length: maxFrames }, (_, index) => Math.round(start + index * idealInterval));
}

function buildFrameResult(
	url: string,
	label: string,
	requestedCount: number,
	frames: ReadonlyArray<VideoFrame>,
	error: string | null,
	duration?: number,
): ExtractedContent {
	if (frames.length === 0) {
		const message = error ?? "Frame extraction failed";
		return { url, title: `Frames ${label} (0/${requestedCount})`, content: message, error: message };
	}
	return {
		url,
		title: `Frames ${label} (${frames.length}/${requestedCount})`,
		content: `${frames.length} frames extracted from ${label}`,
		error: null,
		frames: [...frames],
		...(typeof duration === "number" ? { duration } : {}),
	};
}

function extractYouTubeVideoId(url: string): string | null {
	const parsed = isYouTubeURL(url);
	return parsed.isYouTube ? parsed.videoId : null;
}

const extractWithJinaReaderEffect = Effect.fn("FetchContentRuntime.extractWithJinaReader")(
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

const extractWithUrlContextEffect = Effect.fn("FetchContentRuntime.extractWithUrlContext")(
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

const extractWithGeminiWebEffect = Effect.fn("FetchContentRuntime.extractWithGeminiWeb")(
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

const extractViaHttpEffect = Effect.fn("FetchContentRuntime.extractViaHttp")(
	function* (
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
			const pdfContent = isPDF(url, contentType);
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
				const buffer = yield* Effect.tryPromise({
					try: () => response.arrayBuffer(),
					catch: toFetchContentRuntimeError,
				});
				const pdf = yield* Effect.tryPromise({
					try: () => runtimeDeps.extractPDFToMarkdown(buffer, url),
					catch: toFetchContentRuntimeError,
				});
				return {
					url,
					title: pdf.title,
					content: `PDF extracted and saved to: ${pdf.outputPath}\n\nPages: ${pdf.pages}\nCharacters: ${pdf.chars}`,
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
	},
);

const extractFramesEffect = Effect.fn("FetchContentRuntime.extractFrames")(
	function* (
		url: string,
		signal: AbortSignal | undefined,
		options: ExtractOptions,
		deps?: Partial<FetchContentRuntimeDeps>,
	) {
		const runtimeDeps = resolveDeps(deps);
		const frameCount = options.frames;
		if (!frameCount) {
			return null;
		}

		const videoId = extractYouTubeVideoId(url);
		if (videoId) {
			const streamInfo = yield* Effect.tryPromise({
				try: () => runtimeDeps.getYouTubeStreamInfo(videoId),
				catch: toFetchContentRuntimeError,
			});
			if ("error" in streamInfo) {
				return { url, title: "Frames", content: streamInfo.error, error: streamInfo.error };
			}
			if (streamInfo.duration === null) {
				const error = "Cannot determine video duration. Use a timestamp range instead.";
				return { url, title: "Frames", content: error, error };
			}
			const duration = Math.floor(streamInfo.duration);
			const timestamps = computeRangeTimestamps(0, duration, frameCount);
			const result = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractYouTubeFrames(videoId, timestamps, streamInfo),
				catch: toFetchContentRuntimeError,
			});
			return buildFrameResult(
				url,
				`${formatSeconds(0)}-${formatSeconds(duration)}`,
				timestamps.length,
				result.frames,
				result.error,
				streamInfo.duration ?? undefined,
			);
		}

		const videoInfo = runtimeDeps.isVideoFile(url);
		if (videoInfo) {
			const durationResult = yield* Effect.tryPromise({
				try: () => runtimeDeps.getLocalVideoDuration(videoInfo.absolutePath),
				catch: toFetchContentRuntimeError,
			});
			if (typeof durationResult !== "number") {
				return { url, title: "Frames", content: durationResult.error, error: durationResult.error };
			}
			const duration = Math.floor(durationResult);
			const timestamps = computeRangeTimestamps(0, duration, frameCount);
			const result = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractLocalFrames(videoInfo.absolutePath, timestamps),
				catch: toFetchContentRuntimeError,
			});
			return buildFrameResult(
				url,
				`${formatSeconds(0)}-${formatSeconds(duration)}`,
				timestamps.length,
				result.frames,
				result.error,
				durationResult,
			);
		}

		return {
			url,
			title: "",
			content: "",
			error: "Frame extraction only works with YouTube and local video files",
		};
	},
);

const extractTimestampEffect = Effect.fn("FetchContentRuntime.extractTimestamp")(
	function* (
		url: string,
		signal: AbortSignal | undefined,
		options: ExtractOptions,
		deps?: Partial<FetchContentRuntimeDeps>,
	) {
		const runtimeDeps = resolveDeps(deps);
		if (!options.timestamp) {
			return null;
		}
		const spec = parseTimestampSpec(options.timestamp);
		if (!spec) {
			return null;
		}

		const frameCount = options.frames;
		const videoId = extractYouTubeVideoId(url);
		if (videoId) {
			const streamInfo = yield* Effect.tryPromise({
				try: () => runtimeDeps.getYouTubeStreamInfo(videoId),
				catch: toFetchContentRuntimeError,
			});
			if ("error" in streamInfo) {
				if (spec.type === "range") {
					const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
					return { url, title: `Frames ${label}`, content: streamInfo.error, error: streamInfo.error };
				}
				if (frameCount) {
					const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
					const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
					return { url, title: `Frames ${label}`, content: streamInfo.error, error: streamInfo.error };
				}
				return {
					url,
					title: `Frame at ${options.timestamp}`,
					content: streamInfo.error,
					error: streamInfo.error,
				};
			}

			if (spec.type === "range") {
				const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
				if (streamInfo.duration !== null && spec.end > streamInfo.duration) {
					const error = `Timestamp ${formatSeconds(spec.end)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
					return { url, title: `Frames ${label}`, content: error, error };
				}
				const timestamps = frameCount
					? computeRangeTimestamps(spec.start, spec.end, frameCount)
					: computeRangeTimestamps(spec.start, spec.end);
				const result = yield* Effect.tryPromise({
					try: () => runtimeDeps.extractYouTubeFrames(videoId, timestamps, streamInfo),
					catch: toFetchContentRuntimeError,
				});
				return buildFrameResult(
					url,
					label,
					timestamps.length,
					result.frames,
					result.error,
					result.duration ?? undefined,
				);
			}

			if (frameCount) {
				const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
				const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
				if (streamInfo.duration !== null && end > streamInfo.duration) {
					const error = `Timestamp ${formatSeconds(end)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
					return { url, title: `Frames ${label}`, content: error, error };
				}
				const timestamps = computeRangeTimestamps(spec.seconds, end, frameCount);
				const result = yield* Effect.tryPromise({
					try: () => runtimeDeps.extractYouTubeFrames(videoId, timestamps, streamInfo),
					catch: toFetchContentRuntimeError,
				});
				return buildFrameResult(
					url,
					label,
					timestamps.length,
					result.frames,
					result.error,
					result.duration ?? undefined,
				);
			}

			if (streamInfo.duration !== null && spec.seconds > streamInfo.duration) {
				const error = `Timestamp ${formatSeconds(spec.seconds)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
				return { url, title: `Frame at ${options.timestamp}`, content: error, error };
			}
			const frame = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractYouTubeFrame(videoId, spec.seconds, streamInfo),
				catch: toFetchContentRuntimeError,
			});
			if ("error" in frame) {
				return {
					url,
					title: `Frame at ${options.timestamp}`,
					content: frame.error,
					error: frame.error,
				};
			}
			return {
				url,
				title: `Frame at ${options.timestamp}`,
				content: `Video frame at ${options.timestamp}`,
				error: null,
				thumbnail: frame,
			};
		}

		const videoInfo = runtimeDeps.isVideoFile(url);
		if (!videoInfo) {
			return null;
		}

		if (spec.type === "range") {
			const timestamps = frameCount
				? computeRangeTimestamps(spec.start, spec.end, frameCount)
				: computeRangeTimestamps(spec.start, spec.end);
			const result = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractLocalFrames(videoInfo.absolutePath, timestamps),
				catch: toFetchContentRuntimeError,
			});
			return buildFrameResult(
				url,
				`${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`,
				timestamps.length,
				result.frames,
				result.error,
			);
		}

		if (frameCount) {
			const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
			const timestamps = computeRangeTimestamps(spec.seconds, end, frameCount);
			const result = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractLocalFrames(videoInfo.absolutePath, timestamps),
				catch: toFetchContentRuntimeError,
			});
			return buildFrameResult(
				url,
				`${formatSeconds(spec.seconds)}-${formatSeconds(end)}`,
				timestamps.length,
				result.frames,
				result.error,
			);
		}

		const frame = yield* Effect.tryPromise({
			try: () => runtimeDeps.extractVideoFrame(videoInfo.absolutePath, spec.seconds),
			catch: toFetchContentRuntimeError,
		});
		if ("error" in frame) {
			return {
				url,
				title: `Frame at ${options.timestamp}`,
				content: frame.error,
				error: frame.error,
			};
		}
		return {
			url,
			title: `Frame at ${options.timestamp}`,
			content: `Video frame at ${options.timestamp}`,
			error: null,
			thumbnail: frame,
		};
	},
);

const extractContentEffect = Effect.fn("FetchContentRuntime.extractContent")(
	function* (
		url: string,
		signal?: AbortSignal,
		options?: ExtractOptions,
		deps?: Partial<FetchContentRuntimeDeps>,
	) {
		const runtimeDeps = resolveDeps(deps);
		if (signal?.aborted) {
			return makeErrorResult(url, "Aborted");
		}

		if (options?.frames && !options.timestamp) {
			return yield* extractFramesEffect(url, signal, options, runtimeDeps);
		}

		if (options?.timestamp) {
			const timestampResult = yield* extractTimestampEffect(url, signal, options, runtimeDeps);
			if (timestampResult) {
				return timestampResult;
			}
		}

		const videoInfo = runtimeDeps.isVideoFile(url);
		if (videoInfo) {
			const result = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractVideo(videoInfo, signal, { prompt: options?.prompt, model: options?.model }),
				catch: toFetchContentRuntimeError,
			}).pipe(
				Effect.catchTag("FetchContentRuntimeError", () => Effect.succeed<ExtractedContent | null>(null)),
			);
			return (
				result ?? {
					url,
					title: "",
					content: "",
					error:
						"Video analysis requires Gemini access. Either:\n  1. Sign into gemini.google.com in Chrome (free, uses cookies)\n  2. Set geminiApiKey in ~/.pi/web-search.json (or GEMINI_API_KEY env var)",
				}
			);
		}

		if (isGitHubUrl(url)) {
			const result = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractGitHub(url, signal, options?.forceClone),
				catch: toFetchContentRuntimeError,
			}).pipe(
				Effect.catchTag("FetchContentRuntimeError", () => Effect.succeed<ExtractedContent | null>(null)),
			);
			if (result) {
				return result;
			}
		}

		if (!isValidUrl(url)) {
			return makeErrorResult(url, "Invalid URL");
		}

		const youtubeInfo = isYouTubeURL(url);
		if (youtubeInfo.isYouTube && runtimeDeps.isYouTubeEnabled()) {
			const result = yield* Effect.tryPromise({
				try: () => runtimeDeps.extractYouTube(url, signal, options?.prompt, options?.model),
				catch: toFetchContentRuntimeError,
			}).pipe(
				Effect.catchTag("FetchContentRuntimeError", () => Effect.succeed<ExtractedContent | null>(null)),
			);
			if (result) {
				return result;
			}
			return {
				url,
				title: "",
				content: "",
				error:
					"Could not extract YouTube video content. Sign into Google in Chrome for automatic access, or set GEMINI_API_KEY.",
			};
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
	},
);

const fetchAllContentEffect = Effect.fn("FetchContentRuntime.fetchAllContent")(
	function* (
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
	},
);

export {
	extractContentEffect,
	extractFramesEffect,
	extractTimestampEffect,
	extractViaHttpEffect,
	extractWithGeminiWebEffect,
	extractWithJinaReaderEffect,
	extractWithUrlContextEffect,
	fetchAllContentEffect,
	extractHeadingTitle,
};
