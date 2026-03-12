import { execFileSync } from "node:child_process";
import type { ExtractedContent, FrameResult, VideoFrame } from "../shared/fetch-content-contracts.js";
import { readYouTubeConfig } from "./fetch-content-config.js";
import {
	extractHeadingTitle,
	formatSeconds,
	isTimeoutError,
	mapFfmpegError,
	readExecError,
	trimErrorText,
} from "./fetch-content-utils.js";
import { isGeminiApiAvailable, queryGeminiApiWithVideo } from "./gemini-api.js";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.js";

const YOUTUBE_PROMPT = `Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const YOUTUBE_REGEX =
	/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

interface StreamInfo {
	readonly streamUrl: string;
	readonly duration: number | null;
}

type StreamResult = StreamInfo | { readonly error: string };

export function isYouTubeURL(url: string): {
	readonly isYouTube: boolean;
	readonly videoId: string | null;
} {
	try {
		const parsed = new URL(url);
		if (parsed.pathname === "/playlist") {
			return { isYouTube: false, videoId: null };
		}
	} catch {
		return { isYouTube: false, videoId: null };
	}

	const match = url.match(YOUTUBE_REGEX);
	if (!match?.[1]) {
		return { isYouTube: false, videoId: null };
	}
	return { isYouTube: true, videoId: match[1] };
}

export function isYouTubeEnabled(): boolean {
	return readYouTubeConfig().enabled;
}

export async function extractYouTube(
	url: string,
	signal?: AbortSignal,
	prompt?: string,
	model?: string,
): Promise<ExtractedContent | null> {
	const config = readYouTubeConfig();
	const { videoId } = isYouTubeURL(url);
	const canonicalUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
	const effectivePrompt = prompt ?? YOUTUBE_PROMPT;
	const effectiveModel = model ?? config.preferredModel;

	const result =
		(await tryGeminiWeb(canonicalUrl, effectivePrompt, effectiveModel, signal)) ??
		(await tryGeminiApi(canonicalUrl, effectivePrompt, effectiveModel, signal));
	if (!result) {
		return null;
	}

	if (!videoId) {
		return { ...result, url };
	}
	const thumbnail = await fetchYouTubeThumbnail(videoId);
	return thumbnail ? { ...result, url, thumbnail } : { ...result, url };
}

function mapYtDlpError(error: unknown): string {
	const { code, stderr, message } = readExecError(error);
	if (code === "ENOENT") {
		return "yt-dlp is not installed. Install with: brew install yt-dlp";
	}
	if (isTimeoutError(error)) {
		return "yt-dlp timed out fetching video info";
	}
	const lower = stderr.toLowerCase();
	if (lower.includes("private")) {
		return "Video is private or unavailable";
	}
	if (lower.includes("sign in")) {
		return "Video is age-restricted and requires authentication";
	}
	if (lower.includes("not available")) {
		return "Video is unavailable in your region or has been removed";
	}
	if (lower.includes("live")) {
		return "Cannot extract frames from a live stream";
	}
	const snippet = trimErrorText(stderr || message);
	return snippet ? `yt-dlp failed: ${snippet}` : "yt-dlp failed";
}

export async function getYouTubeStreamInfo(videoId: string): Promise<StreamResult> {
	try {
		const output = execFileSync(
			"yt-dlp",
			["--print", "duration", "-g", `https://www.youtube.com/watch?v=${videoId}`],
			{ timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
		).trim();
		const lines = output.split(/\r?\n/);
		const rawDuration = lines[0]?.trim();
		const streamUrl = lines[1]?.trim();
		if (!streamUrl) {
			return { error: "yt-dlp failed: missing stream URL" };
		}
		const parsedDuration = rawDuration && rawDuration !== "NA" ? Number.parseFloat(rawDuration) : NaN;
		return {
			streamUrl,
			duration: Number.isFinite(parsedDuration) ? parsedDuration : null,
		};
	} catch (error) {
		return { error: mapYtDlpError(error) };
	}
}

async function extractFrameFromStream(streamUrl: string, seconds: number): Promise<FrameResult> {
	try {
		const buffer = execFileSync(
			"ffmpeg",
			[
				"-ss",
				String(seconds),
				"-i",
				streamUrl,
				"-frames:v",
				"1",
				"-f",
				"image2pipe",
				"-vcodec",
				"mjpeg",
				"pipe:1",
			],
			{ maxBuffer: 5 * 1024 * 1024, timeout: 30000, stdio: ["pipe", "pipe", "pipe"] },
		);
		if (buffer.length === 0) {
			return { error: "ffmpeg failed: empty output" };
		}
		return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
	} catch (error) {
		return { error: mapFfmpegError(error) };
	}
}

export async function extractYouTubeFrame(
	videoId: string,
	seconds: number,
	streamInfo?: StreamInfo,
): Promise<FrameResult> {
	const info = streamInfo ?? (await getYouTubeStreamInfo(videoId));
	if ("error" in info) {
		return info;
	}
	return extractFrameFromStream(info.streamUrl, seconds);
}

export async function extractYouTubeFrames(
	videoId: string,
	timestamps: ReadonlyArray<number>,
	streamInfo?: StreamInfo,
): Promise<{
	readonly frames: ReadonlyArray<VideoFrame>;
	readonly duration: number | null;
	readonly error: string | null;
}> {
	const info = streamInfo ?? (await getYouTubeStreamInfo(videoId));
	if ("error" in info) {
		return { frames: [], duration: null, error: info.error };
	}
	const results = await Promise.all(
		timestamps.map(async (timestamp) => {
			const frame = await extractFrameFromStream(info.streamUrl, timestamp);
			if ("error" in frame) {
				return { error: frame.error };
			}
			return { ...frame, timestamp: formatSeconds(timestamp) };
		}),
	);
	const frames = results.filter((frame): frame is VideoFrame => "data" in frame);
	const errorResult = results.find((frame): frame is { readonly error: string } => "error" in frame);
	return {
		frames,
		duration: info.duration,
		error: frames.length === 0 && errorResult ? errorResult.error : null,
	};
}

export async function fetchYouTubeThumbnail(
	videoId: string,
): Promise<{ readonly data: string; readonly mimeType: string } | null> {
	try {
		const response = await fetch(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) {
			return null;
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.length === 0) {
			return null;
		}
		return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
	} catch {
		return null;
	}
}

async function tryGeminiWeb(
	url: string,
	prompt: string,
	model: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	try {
		const cookies = await isGeminiWebAvailable();
		if (!cookies || signal?.aborted) {
			return null;
		}
		const text = await queryWithCookies(prompt, cookies, {
			youtubeUrl: url,
			model,
			signal,
			timeoutMs: 120000,
		});
		return {
			url,
			title: extractHeadingTitle(text) ?? "YouTube Video",
			content: text,
			error: null,
		};
	} catch {
		return null;
	}
}

async function tryGeminiApi(
	url: string,
	prompt: string,
	model: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	try {
		if (!isGeminiApiAvailable() || signal?.aborted) {
			return null;
		}
		const text = await queryGeminiApiWithVideo(prompt, url, {
			model,
			signal,
			timeoutMs: 120000,
		});
		return {
			url,
			title: extractHeadingTitle(text) ?? "YouTube Video",
			content: text,
			error: null,
		};
	} catch {
		return null;
	}
}
