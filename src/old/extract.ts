import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import pLimit from "p-limit";
import { activityMonitor } from "./activity.js";
import { extractRSCContent } from "./rsc-extract.js";
import { extractPDFToMarkdown, isPDF } from "./pdf-extract.js";
import { extractGitHub } from "./github-extract.js";
import {
	isYouTubeURL,
	isYouTubeEnabled,
	extractYouTube,
	extractYouTubeFrame,
	extractYouTubeFrames,
	getYouTubeStreamInfo,
} from "./youtube-extract.js";
import { extractWithUrlContext, extractWithGeminiWeb } from "./gemini-url-context.js";
import {
	isVideoFile,
	extractVideo,
	extractVideoFrame,
	getLocalVideoDuration,
} from "./video-extract.js";
import { formatSeconds } from "./utils.js";

const DEFAULT_TIMEOUT_MS = 30000;
const CONCURRENT_LIMIT = 3;

const NON_RECOVERABLE_ERRORS = ["Unsupported content type", "Response too large"];
const MIN_USEFUL_CONTENT = 500;

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

const fetchLimit = pLimit(CONCURRENT_LIMIT);

export interface VideoFrame {
	data: string;
	mimeType: string;
	timestamp: string;
}

export type FrameData = { data: string; mimeType: string };
export type FrameResult = FrameData | { error: string };

export interface ExtractedContent {
	url: string;
	title: string;
	content: string;
	error: string | null;
	thumbnail?: { data: string; mimeType: string };
	frames?: VideoFrame[];
	duration?: number;
}

export interface ExtractOptions {
	timeoutMs?: number;
	forceClone?: boolean;
	prompt?: string;
	timestamp?: string;
	frames?: number;
	model?: string;
}

const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 30000;

async function extractWithJinaReader(
	url: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	const jinaUrl = JINA_READER_BASE + url;

	const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });

	try {
		const res = await fetch(jinaUrl, {
			headers: {
				Accept: "text/markdown",
				"X-No-Cache": "true",
			},
			signal: AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), ...(signal ? [signal] : [])]),
		});

		if (!res.ok) {
			activityMonitor.logComplete(activityId, res.status);
			return null;
		}

		const content = await res.text();
		activityMonitor.logComplete(activityId, res.status);

		const contentStart = content.indexOf("Markdown Content:");
		if (contentStart < 0) {
			return null;
		}

		const markdownPart = content.slice(contentStart + 17).trim(); // 17 = "Markdown Content:".length

		// Check for failed JS rendering or minimal content
		if (
			markdownPart.length < 100 ||
			markdownPart.startsWith("Loading...") ||
			markdownPart.startsWith("Please enable JavaScript")
		) {
			return null;
		}

		const title =
			extractHeadingTitle(markdownPart) ?? (new URL(url).pathname.split("/").pop() || url);
		return { url, title, content: markdownPart, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return null;
	}
}

function parseTimestamp(ts: string): number | null {
	const num = Number(ts);
	if (!isNaN(num) && num >= 0) return Math.floor(num);
	const parts = ts.split(":").map(Number);
	if (parts.some((p) => isNaN(p) || p < 0)) return null;
	if (parts.length === 3) return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
	if (parts.length === 2) return Math.floor(parts[0] * 60 + parts[1]);
	return null;
}

type TimestampSpec =
	| { type: "single"; seconds: number }
	| { type: "range"; start: number; end: number };

function parseTimestampSpec(ts: string): TimestampSpec | null {
	const dashIdx = ts.indexOf("-", 1);
	if (dashIdx > 0) {
		const start = parseTimestamp(ts.slice(0, dashIdx));
		const end = parseTimestamp(ts.slice(dashIdx + 1));
		if (start !== null && end !== null && end > start) return { type: "range", start, end };
	}
	const seconds = parseTimestamp(ts);
	return seconds !== null ? { type: "single", seconds } : null;
}

const DEFAULT_RANGE_FRAMES = 6;
const MIN_FRAME_INTERVAL = 5;

function computeRangeTimestamps(
	start: number,
	end: number,
	maxFrames: number = DEFAULT_RANGE_FRAMES,
): number[] {
	if (maxFrames <= 1) return [start];
	const duration = end - start;
	const idealInterval = duration / (maxFrames - 1);
	if (idealInterval < MIN_FRAME_INTERVAL) {
		const timestamps: number[] = [];
		for (let t = start; t <= end && timestamps.length < maxFrames; t += MIN_FRAME_INTERVAL) {
			timestamps.push(t);
		}
		return timestamps;
	}
	return Array.from({ length: maxFrames }, (_, i) => Math.round(start + i * idealInterval));
}

function buildFrameResult(
	url: string,
	label: string,
	requestedCount: number,
	frames: VideoFrame[],
	error: string | null,
	duration?: number,
): ExtractedContent {
	if (frames.length === 0) {
		const msg = error ?? "Frame extraction failed";
		return { url, title: `Frames ${label} (0/${requestedCount})`, content: msg, error: msg };
	}
	return {
		url,
		title: `Frames ${label} (${frames.length}/${requestedCount})`,
		content: `${frames.length} frames extracted from ${label}`,
		error: null,
		frames,
		duration,
	};
}

async function extractLocalFrames(
	filePath: string,
	timestamps: number[],
): Promise<{ frames: VideoFrame[]; error: string | null }> {
	const results = await Promise.all(
		timestamps.map(async (t) => {
			const frame = await extractVideoFrame(filePath, t);
			if ("error" in frame) return { error: frame.error };
			return { ...frame, timestamp: formatSeconds(t) };
		}),
	);
	const frames = results.filter((f): f is VideoFrame => "data" in f);
	const firstError = results.find((f): f is { error: string } => "error" in f);
	return { frames, error: frames.length === 0 && firstError ? firstError.error : null };
}

export async function extractContent(
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent> {
	if (signal?.aborted) {
		return { url, title: "", content: "", error: "Aborted" };
	}

	if (options?.frames && !options.timestamp) {
		const frameCount = options.frames;
		const ytInfo = isYouTubeURL(url);
		if (ytInfo.isYouTube && ytInfo.videoId) {
			const streamInfo = await getYouTubeStreamInfo(ytInfo.videoId);
			if ("error" in streamInfo) {
				return { url, title: "Frames", content: streamInfo.error, error: streamInfo.error };
			}
			if (streamInfo.duration === null) {
				const error = "Cannot determine video duration. Use a timestamp range instead.";
				return { url, title: "Frames", content: error, error };
			}
			const dur = Math.floor(streamInfo.duration);
			const timestamps = computeRangeTimestamps(0, dur, frameCount);
			const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
			const label = `${formatSeconds(0)}-${formatSeconds(dur)}`;
			return buildFrameResult(
				url,
				label,
				timestamps.length,
				result.frames,
				result.error,
				streamInfo.duration,
			);
		}

		const videoInfo = isVideoFile(url);
		if (videoInfo) {
			const durationResult = await getLocalVideoDuration(videoInfo.absolutePath);
			if (typeof durationResult !== "number") {
				return { url, title: "Frames", content: durationResult.error, error: durationResult.error };
			}
			const dur = Math.floor(durationResult);
			const timestamps = computeRangeTimestamps(0, dur, frameCount);
			const result = await extractLocalFrames(videoInfo.absolutePath, timestamps);
			const label = `${formatSeconds(0)}-${formatSeconds(dur)}`;
			return buildFrameResult(
				url,
				label,
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
	}

	if (options?.timestamp) {
		const spec = parseTimestampSpec(options.timestamp);
		if (spec) {
			const frameCount = options.frames;
			const ytInfo = isYouTubeURL(url);
			if (ytInfo.isYouTube && ytInfo.videoId) {
				const streamInfo = await getYouTubeStreamInfo(ytInfo.videoId);
				if ("error" in streamInfo) {
					if (spec.type === "range") {
						const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
						return {
							url,
							title: `Frames ${label}`,
							content: streamInfo.error,
							error: streamInfo.error,
						};
					}
					if (frameCount) {
						const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
						const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
						return {
							url,
							title: `Frames ${label}`,
							content: streamInfo.error,
							error: streamInfo.error,
						};
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
					const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
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
					const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
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
				const frame = await extractYouTubeFrame(ytInfo.videoId, spec.seconds, streamInfo);
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

			const videoInfo = isVideoFile(url);
			if (videoInfo) {
				if (spec.type === "range") {
					const timestamps = frameCount
						? computeRangeTimestamps(spec.start, spec.end, frameCount)
						: computeRangeTimestamps(spec.start, spec.end);
					const result = await extractLocalFrames(videoInfo.absolutePath, timestamps);
					const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
					return buildFrameResult(url, label, timestamps.length, result.frames, result.error);
				}

				if (frameCount) {
					const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
					const timestamps = computeRangeTimestamps(spec.seconds, end, frameCount);
					const result = await extractLocalFrames(videoInfo.absolutePath, timestamps);
					const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
					return buildFrameResult(url, label, timestamps.length, result.frames, result.error);
				}

				const frame = await extractVideoFrame(videoInfo.absolutePath, spec.seconds);
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
		}
	}

	const videoInfo = isVideoFile(url);
	if (videoInfo) {
		const result = await extractVideo(videoInfo, signal, options);
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

	try {
		new URL(url);
	} catch {
		return { url, title: "", content: "", error: "Invalid URL" };
	}

	try {
		const ghResult = await extractGitHub(url, signal, options?.forceClone);
		if (ghResult) return ghResult;
	} catch {}

	const ytInfo = isYouTubeURL(url);
	if (ytInfo.isYouTube && isYouTubeEnabled()) {
		try {
			const ytResult = await extractYouTube(url, signal, options?.prompt, options?.model);
			if (ytResult) return ytResult;
		} catch {}
		return {
			url,
			title: "",
			content: "",
			error:
				"Could not extract YouTube video content. Sign into Google in Chrome for automatic access, or set GEMINI_API_KEY.",
		};
	}

	const httpResult = await extractViaHttp(url, signal, options);

	if (!httpResult.error || signal?.aborted) return httpResult;
	if (NON_RECOVERABLE_ERRORS.some((prefix) => httpResult.error!.startsWith(prefix)))
		return httpResult;

	const jinaResult = await extractWithJinaReader(url, signal);
	if (jinaResult) return jinaResult;

	const geminiResult =
		(await extractWithUrlContext(url, signal)) ?? (await extractWithGeminiWeb(url, signal));

	if (geminiResult) return geminiResult;

	const guidance = [
		httpResult.error,
		"",
		"Fallback options:",
		"  \u2022 Set geminiApiKey in ~/.pi/web-search.json (or GEMINI_API_KEY env var)",
		"  \u2022 Sign into gemini.google.com in Chrome",
		"  \u2022 Use web_search to find content about this topic",
	].join("\n");
	return { ...httpResult, error: guidance };
}

function isLikelyJSRendered(html: string): boolean {
	// Extract body content
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (!bodyMatch) return false;

	const bodyHtml = bodyMatch[1];

	// Strip tags to get text content
	const textContent = bodyHtml
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();

	// Count scripts
	const scriptCount = (html.match(/<script/gi) || []).length;

	// Heuristic: little text content but many scripts suggests JS rendering
	return textContent.length < 500 && scriptCount > 3;
}

async function extractViaHttp(
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const activityId = activityMonitor.logStart({ type: "fetch", url });

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
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
			},
		});

		if (!response.ok) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: "",
				content: "",
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const contentLengthHeader = response.headers.get("content-length");
		const contentType = response.headers.get("content-type") || "";
		const isPDFContent = isPDF(url, contentType);
		const maxResponseSize = isPDFContent ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
		if (contentLengthHeader) {
			const contentLength = parseInt(contentLengthHeader, 10);
			if (contentLength > maxResponseSize) {
				activityMonitor.logComplete(activityId, response.status);
				return {
					url,
					title: "",
					content: "",
					error: `Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`,
				};
			}
		}

		if (isPDFContent) {
			try {
				const buffer = await response.arrayBuffer();
				const result = await extractPDFToMarkdown(buffer, url);
				activityMonitor.logComplete(activityId, response.status);
				return {
					url,
					title: result.title,
					content: `PDF extracted and saved to: ${result.outputPath}\n\nPages: ${result.pages}\nCharacters: ${result.chars}`,
					error: null,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				activityMonitor.logError(activityId, message);
				return { url, title: "", content: "", error: `PDF extraction failed: ${message}` };
			}
		}

		if (
			contentType.includes("application/octet-stream") ||
			contentType.includes("image/") ||
			contentType.includes("audio/") ||
			contentType.includes("video/") ||
			contentType.includes("application/zip")
		) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: "",
				content: "",
				error: `Unsupported content type: ${contentType.split(";")[0]}`,
			};
		}

		const text = await response.text();
		const isHTML =
			contentType.includes("text/html") || contentType.includes("application/xhtml+xml");

		if (!isHTML) {
			activityMonitor.logComplete(activityId, response.status);
			const title = extractTextTitle(text, url);
			return { url, title, content: text, error: null };
		}

		const { document } = parseHTML(text);
		const reader = new Readability(document as unknown as Document);
		const article = reader.parse();

		if (!article) {
			const rscResult = extractRSCContent(text);
			if (rscResult) {
				activityMonitor.logComplete(activityId, response.status);
				return { url, title: rscResult.title, content: rscResult.content, error: null };
			}

			activityMonitor.logComplete(activityId, response.status);

			// Provide more specific error message
			const jsRendered = isLikelyJSRendered(text);
			const errorMsg = jsRendered
				? "Page appears to be JavaScript-rendered (content loads dynamically)"
				: "Could not extract readable content from HTML structure";

			return {
				url,
				title: "",
				content: "",
				error: errorMsg,
			};
		}

		const markdown = turndown.turndown(article.content);
		activityMonitor.logComplete(activityId, response.status);

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

		return { url, title: article.title || "", content: markdown, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return { url, title: "", content: "", error: message };
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", onAbort);
	}
}

export function extractHeadingTitle(text: string): string | null {
	const match = text.match(/^#{1,2}\s+(.+)/m);
	if (!match) return null;
	const cleaned = match[1].replace(/\*+/g, "").trim();
	return cleaned || null;
}

function extractTextTitle(text: string, url: string): string {
	return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}

export async function fetchAllContent(
	urls: string[],
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent[]> {
	return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}

interface FetchCliArgs {
	readonly urls: ReadonlyArray<string>;
	readonly options: ExtractOptions;
	readonly json: boolean;
	readonly help: boolean;
}

type FetchCliParseResult =
	| { readonly kind: "ok"; readonly value: FetchCliArgs }
	| { readonly kind: "error"; readonly message: string };

export interface FetchCliDeps {
	readonly fetchAll?: typeof fetchAllContent;
	readonly stdout?: (text: string) => void;
	readonly stderr?: (text: string) => void;
}

const FETCH_CLI_USAGE = `Usage: bun src/old/extract.ts [options] <url...>

Options:
  --url <url>                  Add a URL (repeatable)
  --urls <urlA,urlB>           Comma-separated URLs
  --prompt <text>              Video analysis prompt
  --timestamp <spec>           Timestamp or range (e.g. 23:41-25:00)
  --frames <1-12>              Number of frames to extract
  --model <model>              Override Gemini model for video flows
  --timeout-ms <ms>            Request timeout in milliseconds
  --force-clone                Force clone large GitHub repositories
  --json                       Print JSON output
  -h, --help                   Show this help
`;

function parseCliValue(argv: readonly string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (!value) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
}

function parseInteger(value: string, flag: string, minimum: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum) {
		throw new Error(`${flag} must be an integer >= ${minimum}`);
	}
	return parsed;
}

export function parseFetchCliArgs(argv: readonly string[]): FetchCliParseResult {
	const urls: string[] = [];
	const options: ExtractOptions = {};
	let json = false;
	let help = false;

	try {
		for (let index = 0; index < argv.length; index++) {
			const arg = argv[index];
			switch (arg) {
				case "-h":
				case "--help":
					help = true;
					break;
				case "--json":
					json = true;
					break;
				case "--force-clone":
					options.forceClone = true;
					break;
				case "--url": {
					const value = parseCliValue(argv, index, arg);
					urls.push(value);
					index += 1;
					break;
				}
				case "--urls": {
					const value = parseCliValue(argv, index, arg);
					urls.push(...value.split(",").map((part) => part.trim()).filter(Boolean));
					index += 1;
					break;
				}
				case "--prompt":
					options.prompt = parseCliValue(argv, index, arg);
					index += 1;
					break;
				case "--timestamp":
					options.timestamp = parseCliValue(argv, index, arg);
					index += 1;
					break;
				case "--frames": {
					const value = parseCliValue(argv, index, arg);
					const frames = parseInteger(value, "--frames", 1);
					if (frames > 12) {
						throw new Error("--frames must be <= 12");
					}
					options.frames = frames;
					index += 1;
					break;
				}
				case "--model":
					options.model = parseCliValue(argv, index, arg);
					index += 1;
					break;
				case "--timeout-ms": {
					const value = parseCliValue(argv, index, arg);
					options.timeoutMs = parseInteger(value, "--timeout-ms", 1);
					index += 1;
					break;
				}
				default:
					if (arg.startsWith("-")) {
						return { kind: "error", message: `Unknown flag ${arg}` };
					}
					urls.push(arg);
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { kind: "error", message };
	}

	if (!help && urls.length === 0) {
		return { kind: "error", message: "At least one URL is required" };
	}

	return {
		kind: "ok",
		value: {
			urls,
			options,
			json,
			help,
		},
	};
}

interface ExtractedContentSummary {
	readonly url: string;
	readonly title: string;
	readonly content: string;
	readonly error: string | null;
	readonly duration?: number;
	readonly thumbnail?: {
		readonly mimeType: string;
		readonly bytes: number;
	};
	readonly frames?: ReadonlyArray<{
		readonly timestamp: string;
		readonly mimeType: string;
		readonly bytes: number;
	}>;
}

function summarizeExtractedContent(result: ExtractedContent): ExtractedContentSummary {
	return {
		url: result.url,
		title: result.title,
		content: result.content,
		error: result.error,
		duration: result.duration,
		thumbnail: result.thumbnail
			? {
					mimeType: result.thumbnail.mimeType,
					bytes: result.thumbnail.data.length,
				}
			: undefined,
		frames: result.frames?.map((frame) => ({
			timestamp: frame.timestamp,
			mimeType: frame.mimeType,
			bytes: frame.data.length,
		})),
	};
}

function formatFetchCliOutput(results: ReadonlyArray<ExtractedContent>): string {
	const successful = results.filter((result) => !result.error).length;
	const lines = [`Fetched ${results.length} URL(s). ${successful}/${results.length} succeeded.`];
	for (const [index, result] of results.entries()) {
		lines.push("", `## [${index + 1}] ${result.title || result.url}`, `URL: ${result.url}`);
		if (result.error) {
			lines.push(`Error: ${result.error}`);
			continue;
		}
		if (result.duration !== undefined) {
			lines.push(`Duration: ${formatSeconds(Math.floor(result.duration))}`);
		}
		if (result.frames?.length) {
			lines.push(`Frames: ${result.frames.length}`);
		}
		lines.push(result.content);
	}
	return lines.join("\n");
}

export async function runFetchCli(
	argv: readonly string[],
	deps: FetchCliDeps = {},
): Promise<number> {
	const parsed = parseFetchCliArgs(argv);
	const stdout = deps.stdout ?? ((text: string) => console.log(text));
	const stderr = deps.stderr ?? ((text: string) => console.error(text));
	if (parsed.kind === "error") {
		stderr(`Error: ${parsed.message}`);
		stderr(FETCH_CLI_USAGE.trimEnd());
		return 1;
	}

	if (parsed.value.help) {
		stdout(FETCH_CLI_USAGE.trimEnd());
		return 0;
	}

	const fetchAll = deps.fetchAll ?? fetchAllContent;
	try {
		const results = await fetchAll([...parsed.value.urls], undefined, parsed.value.options);
		if (parsed.value.json) {
			stdout(
				JSON.stringify(
					{
						urls: parsed.value.urls,
						options: parsed.value.options,
						results: results.map(summarizeExtractedContent),
					},
					null,
					2,
				),
			);
			return 0;
		}

		stdout(formatFetchCliOutput(results));
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr(`Error: ${message}`);
		return 1;
	}
}

function isBunDirectRun(fileStem: string): boolean {
	if (typeof Bun === "undefined") return false;
	const scriptPath = Bun.argv[1];
	if (!scriptPath) return false;
	return (
		scriptPath.endsWith(`/${fileStem}.ts`) ||
		scriptPath.endsWith(`\\${fileStem}.ts`) ||
		scriptPath.endsWith(`/${fileStem}.js`) ||
		scriptPath.endsWith(`\\${fileStem}.js`)
	);
}

if (isBunDirectRun("extract")) {
	void runFetchCli(process.argv.slice(2)).then((exitCode) => {
		process.exitCode = exitCode;
	});
}
