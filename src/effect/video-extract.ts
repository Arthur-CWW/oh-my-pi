import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
	type ExtractedContent,
	type FrameResult,
	type VideoFrame,
} from "../shared/fetch-content-contracts.js";
import { readVideoConfig } from "./fetch-content-config.js";
import {
	extractHeadingTitle,
	formatSeconds,
	mapFfmpegError,
	readExecError,
	trimErrorText,
} from "./fetch-content-utils.js";
import { API_BASE, getApiKey, queryGeminiApiWithVideo } from "./gemini-api.js";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.js";

const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";

const DEFAULT_VIDEO_PROMPT = `Extract the complete content of this video. Include:
1. Video title (infer from content if not explicit), duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const VIDEO_EXTENSIONS: Record<string, string> = {
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".avi": "video/x-msvideo",
	".mpeg": "video/mpeg",
	".mpg": "video/mpeg",
	".wmv": "video/x-ms-wmv",
	".flv": "video/x-flv",
	".3gp": "video/3gpp",
	".3gpp": "video/3gpp",
};

export interface VideoFileInfo {
	readonly absolutePath: string;
	readonly mimeType: string;
	readonly sizeBytes: number;
}

export function isVideoFile(input: string): VideoFileInfo | null {
	const config = readVideoConfig();
	if (!config.enabled) {
		return null;
	}
	const isFilePath =
		input.startsWith("/") ||
		input.startsWith("./") ||
		input.startsWith("../") ||
		input.startsWith("file://");
	if (!isFilePath) {
		return null;
	}

	const filePath = input.startsWith("file://") ? new URL(input).pathname : input;
	const mimeType = VIDEO_EXTENSIONS[extname(filePath).toLowerCase()];
	if (!mimeType) {
		return null;
	}

	const absolutePath = resolveFilePath(filePath);
	if (!absolutePath) {
		return null;
	}

	const stat = statSync(absolutePath);
	if (!stat.isFile()) {
		return null;
	}

	const maxBytes = config.maxSizeMB * 1024 * 1024;
	if (stat.size > maxBytes) {
		return null;
	}

	return { absolutePath, mimeType, sizeBytes: stat.size };
}

function resolveFilePath(filePath: string): string | null {
	const absolutePath = resolve(filePath);
	if (existsSync(absolutePath)) {
		return absolutePath;
	}

	const dir = dirname(absolutePath);
	const base = basename(absolutePath);
	if (!existsSync(dir)) {
		return null;
	}

	try {
		const normalizedBase = normalizeSpaces(base);
		const match = readdirSync(dir).find((fileName) => normalizeSpaces(fileName) === normalizedBase);
		return match ? join(dir, match) : null;
	} catch {
		return null;
	}
}

function normalizeSpaces(value: string): string {
	return value.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ");
}

export async function extractVideo(
	info: VideoFileInfo,
	signal?: AbortSignal,
	options?: {
		readonly prompt?: string;
		readonly model?: string;
	},
): Promise<ExtractedContent | null> {
	const config = readVideoConfig();
	const effectivePrompt = options?.prompt ?? DEFAULT_VIDEO_PROMPT;
	const effectiveModel = options?.model ?? config.preferredModel;
	const result =
		(await tryVideoGeminiApi(info, effectivePrompt, effectiveModel, signal)) ??
		(await tryVideoGeminiWeb(info, effectivePrompt, effectiveModel, signal));
	if (!result) {
		return null;
	}

	const thumbnail = await extractVideoFrame(info.absolutePath);
	return "error" in thumbnail ? result : { ...result, thumbnail };
}

function mapFfprobeError(error: unknown): string {
	const { code, stderr, message } = readExecError(error);
	if (code === "ENOENT") {
		return "ffprobe is not installed. Install ffmpeg which includes ffprobe";
	}
	const snippet = trimErrorText(stderr || message);
	return snippet ? `ffprobe failed: ${snippet}` : "ffprobe failed";
}

export async function extractVideoFrame(filePath: string, seconds: number = 1): Promise<FrameResult> {
	try {
		const buffer = execFileSync(
			"ffmpeg",
			[
				"-ss",
				String(seconds),
				"-i",
				filePath,
				"-frames:v",
				"1",
				"-f",
				"image2pipe",
				"-vcodec",
				"mjpeg",
				"pipe:1",
			],
			{ maxBuffer: 5 * 1024 * 1024, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
		);
		if (buffer.length === 0) {
			return { error: "ffmpeg failed: empty output" };
		}
		return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
	} catch (error) {
		return { error: mapFfmpegError(error) };
	}
}

export async function getLocalVideoDuration(filePath: string): Promise<number | { readonly error: string }> {
	try {
		const output = execFileSync(
			"ffprobe",
			["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
			{ timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
		).trim();
		const duration = Number.parseFloat(output);
		if (!Number.isFinite(duration)) {
			return { error: "ffprobe failed: invalid duration output" };
		}
		return duration;
	} catch (error) {
		return { error: mapFfprobeError(error) };
	}
}

export async function extractLocalFrames(
	filePath: string,
	timestamps: ReadonlyArray<number>,
): Promise<{ readonly frames: ReadonlyArray<VideoFrame>; readonly error: string | null }> {
	const results = await Promise.all(
		timestamps.map(async (timestamp) => {
			const frame = await extractVideoFrame(filePath, timestamp);
			if ("error" in frame) {
				return { error: frame.error };
			}
			return { ...frame, timestamp: formatSeconds(timestamp) };
		}),
	);
	const frames = results.filter((frame): frame is VideoFrame => "data" in frame);
	const firstError = results.find((frame): frame is { readonly error: string } => "error" in frame);
	return {
		frames,
		error: frames.length === 0 && firstError ? firstError.error : null,
	};
}

async function tryVideoGeminiWeb(
	info: VideoFileInfo,
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
			files: [info.absolutePath],
			model,
			signal,
			timeoutMs: 180000,
		});
		return {
			url: info.absolutePath,
			title: extractVideoTitle(text, info.absolutePath),
			content: text,
			error: null,
		};
	} catch {
		return null;
	}
}

async function tryVideoGeminiApi(
	info: VideoFileInfo,
	prompt: string,
	model: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	const apiKey = getApiKey();
	if (!apiKey || signal?.aborted) {
		return null;
	}

	let fileName: string | null = null;
	try {
		const uploaded = await uploadToFilesApi(info, apiKey, signal);
		fileName = uploaded.name;
		await pollFileState(fileName, apiKey, signal, 120000);
		const text = await queryGeminiApiWithVideo(prompt, uploaded.uri, {
			model,
			mimeType: info.mimeType,
			signal,
			timeoutMs: 120000,
		});
		return {
			url: info.absolutePath,
			title: extractVideoTitle(text, info.absolutePath),
			content: text,
			error: null,
		};
	} catch {
		return null;
	} finally {
		if (fileName) {
			deleteGeminiFile(fileName, apiKey);
		}
	}
}

async function uploadToFilesApi(
	info: VideoFileInfo,
	apiKey: string,
	signal?: AbortSignal,
): Promise<{ readonly name: string; readonly uri: string }> {
	const displayName = basename(info.absolutePath);
	const initResponse = await fetch(`${UPLOAD_BASE}/files`, {
		method: "POST",
		headers: {
			"x-goog-api-key": apiKey,
			"X-Goog-Upload-Protocol": "resumable",
			"X-Goog-Upload-Command": "start",
			"X-Goog-Upload-Header-Content-Length": String(info.sizeBytes),
			"X-Goog-Upload-Header-Content-Type": info.mimeType,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ file: { display_name: displayName } }),
		signal,
	});
	if (!initResponse.ok) {
		const text = await initResponse.text();
		throw new Error(`File upload init failed: ${initResponse.status} (${text.slice(0, 200)})`);
	}
	const uploadUrl = initResponse.headers.get("x-goog-upload-url");
	if (!uploadUrl) {
		throw new Error("No upload URL in response headers");
	}

	const fileData = await readFile(info.absolutePath);
	const uploadResponse = await fetch(uploadUrl, {
		method: "PUT",
		headers: {
			"Content-Length": String(info.sizeBytes),
			"X-Goog-Upload-Offset": "0",
			"X-Goog-Upload-Command": "upload, finalize",
		},
		body: fileData,
		signal,
	});
	if (!uploadResponse.ok) {
		const text = await uploadResponse.text();
		throw new Error(`File upload failed: ${uploadResponse.status} (${text.slice(0, 200)})`);
	}

	const result = (await uploadResponse.json()) as { readonly file: { readonly name: string; readonly uri: string } };
	return result.file;
}

async function pollFileState(
	fileName: string,
	apiKey: string,
	signal?: AbortSignal,
	timeoutMs: number = 120000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (signal?.aborted) {
			throw new Error("Aborted");
		}
		const response = await fetch(`${API_BASE}/${fileName}?key=${apiKey}`, { signal });
		if (!response.ok) {
			throw new Error(`File state check failed: ${response.status}`);
		}
		const data = (await response.json()) as { readonly state: string };
		if (data.state === "ACTIVE") {
			return;
		}
		if (data.state === "FAILED") {
			throw new Error("File processing failed");
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
	}
	throw new Error("File processing timed out");
}

function deleteGeminiFile(fileName: string, apiKey: string): void {
	fetch(`${API_BASE}/${fileName}?key=${apiKey}`, { method: "DELETE" }).catch(() => {});
}

function extractVideoTitle(text: string, filePath: string): string {
	return extractHeadingTitle(text) ?? basename(filePath, extname(filePath));
}
