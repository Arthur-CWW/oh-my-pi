import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Effect } from "effect";
import { readChromeCookiesEffect } from "./chrome-cookies.js";

const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL =
	"https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
const MODEL_HEADERS: Record<string, string> = {
	"gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
	"gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
	"gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"] as const;

export type CookieMap = Record<string, string>;

export interface GeminiWebOptions {
	readonly youtubeUrl?: string;
	readonly model?: string;
	readonly files?: ReadonlyArray<string>;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

export interface GeminiWebAvailabilityDeps {
	readonly readCookies: () => Promise<{ readonly cookies: CookieMap }>;
}

const defaultGeminiWebAvailabilityDeps: GeminiWebAvailabilityDeps = {
	readCookies: async () => {
		const result = await Effect.runPromise(readChromeCookiesEffect());
		return { cookies: result.cookies };
	},
};

function hasRequiredCookies(cookieMap: CookieMap): boolean {
	return REQUIRED_COOKIES.every((name) => Boolean(cookieMap[name]));
}

export async function isGeminiWebAvailable(
	deps: GeminiWebAvailabilityDeps = defaultGeminiWebAvailabilityDeps,
): Promise<CookieMap | null> {
	const result = await deps.readCookies();
	if (!hasRequiredCookies(result.cookies)) {
		return null;
	}
	return result.cookies;
}

export async function queryWithCookies(
	prompt: string,
	cookieMap: CookieMap,
	options: GeminiWebOptions = {},
): Promise<string> {
	const model = options.model && MODEL_HEADERS[options.model] ? options.model : "gemini-2.5-flash";
	const timeoutMs = options.timeoutMs ?? 120000;

	let fullPrompt = prompt;
	if (options.youtubeUrl) {
		fullPrompt = `${fullPrompt}\n\nYouTube video: ${options.youtubeUrl}`;
	}

	const result = await runGeminiWebOnce(
		fullPrompt,
		cookieMap,
		model,
		options.files,
		timeoutMs,
		options.signal,
	);

	if (isModelUnavailable(result.errorCode) && model !== "gemini-2.5-flash") {
		const fallback = await runGeminiWebOnce(
			fullPrompt,
			cookieMap,
			"gemini-2.5-flash",
			options.files,
			timeoutMs,
			options.signal,
		);
		if (fallback.errorMessage) {
			throw new Error(fallback.errorMessage);
		}
		if (!fallback.text) {
			throw new Error("Gemini Web returned empty response (fallback model)");
		}
		return fallback.text;
	}

	if (result.errorMessage) {
		throw new Error(result.errorMessage);
	}
	if (!result.text) {
		throw new Error("Gemini Web returned empty response");
	}
	return result.text;
}

interface GeminiWebResult {
	readonly text: string;
	readonly errorCode?: number;
	readonly errorMessage?: string;
}

async function runGeminiWebOnce(
	prompt: string,
	cookieMap: CookieMap,
	model: string,
	files: ReadonlyArray<string> | undefined,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<GeminiWebResult> {
	const effectiveSignal = withTimeout(signal, timeoutMs);
	const cookieHeader = buildCookieHeader(cookieMap);
	const accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);

	const uploaded: Array<{ id: string; name: string }> = [];
	if (files) {
		for (const filePath of files) {
			uploaded.push(await uploadFile(filePath, cookieHeader, effectiveSignal));
		}
	}

	const fReq = buildFReqPayload(prompt, uploaded);
	const params = new URLSearchParams();
	params.set("at", accessToken);
	params.set("f.req", fReq);

	const response = await fetch(GEMINI_STREAM_GENERATE_URL, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded;charset=utf-8",
			host: "gemini.google.com",
			origin: "https://gemini.google.com",
			referer: "https://gemini.google.com/",
			"x-same-domain": "1",
			"user-agent": USER_AGENT,
			cookie: cookieHeader,
			[MODEL_HEADER_NAME]: MODEL_HEADERS[model],
		},
		body: params.toString(),
		signal: effectiveSignal,
	});

	const rawText = await response.text();

	if (!response.ok) {
		return { text: "", errorMessage: `Gemini request failed: ${response.status}` };
	}

	try {
		return parseStreamGenerateResponse(rawText);
	} catch (error) {
		let errorCode: number | undefined;
		try {
			const json = JSON.parse(trimJsonEnvelope(rawText));
			errorCode = extractErrorCode(json);
		} catch {
			// Keep original parse error.
		}
		return {
			text: "",
			errorCode,
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}

async function fetchAccessToken(cookieHeader: string, signal: AbortSignal): Promise<string> {
	const html = await fetchWithCookieRedirects(GEMINI_APP_URL, cookieHeader, 10, signal);

	for (const key of ["SNlM0e", "thykhd"] as const) {
		const match = html.match(new RegExp(`"${key}":"(.*?)"`));
		if (match?.[1]) {
			return match[1];
		}
	}

	throw new Error(
		"Unable to authenticate with Gemini. Make sure you're signed into gemini.google.com in Chrome.",
	);
}

async function fetchWithCookieRedirects(
	url: string,
	cookieHeader: string,
	maxRedirects: number,
	signal: AbortSignal,
): Promise<string> {
	let current = url;
	for (let index = 0; index <= maxRedirects; index++) {
		const response = await fetch(current, {
			headers: { "user-agent": USER_AGENT, cookie: cookieHeader },
			redirect: "manual",
			signal,
		});
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (location) {
				current = new URL(location, current).toString();
				continue;
			}
		}
		return response.text();
	}
	throw new Error(`Too many redirects (>${maxRedirects})`);
}

async function uploadFile(
	filePath: string,
	cookieHeader: string,
	signal: AbortSignal,
): Promise<{ id: string; name: string }> {
	const data = readFileSync(filePath);
	const fileName = basename(filePath);
	const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
	const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
	const footer = `\r\n--${boundary}--\r\n`;

	const body = Buffer.concat([Buffer.from(header, "utf-8"), data, Buffer.from(footer, "utf-8")]);

	const response = await fetch(GEMINI_UPLOAD_URL, {
		method: "POST",
		headers: {
			"content-type": `multipart/form-data; boundary=${boundary}`,
			"push-id": GEMINI_UPLOAD_PUSH_ID,
			"user-agent": USER_AGENT,
			cookie: cookieHeader,
		},
		body,
		signal,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`File upload failed: ${response.status} (${text.slice(0, 200)})`);
	}

	return { id: await response.text(), name: fileName };
}

function buildFReqPayload(prompt: string, uploaded: ReadonlyArray<{ id: string; name: string }>): string {
	const promptPayload =
		uploaded.length > 0 ? [prompt, 0, null, uploaded.map((file) => [[file.id, 1]])] : [prompt];
	const innerList = [promptPayload, null, null];
	return JSON.stringify([null, JSON.stringify(innerList)]);
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function buildCookieHeader(cookieMap: CookieMap): string {
	return Object.entries(cookieMap)
		.filter(([, value]) => typeof value === "string" && value.length > 0)
		.map(([name, value]) => `${name}=${value}`)
		.join("; ");
}

function getNestedValue(value: unknown, pathParts: ReadonlyArray<number>): unknown {
	let current: unknown = value;
	for (const part of pathParts) {
		if (current == null) {
			return undefined;
		}
		if (!Array.isArray(current)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

function trimJsonEnvelope(text: string): string {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error("Gemini response did not contain a JSON payload.");
	}
	return text.slice(start, end + 1);
}

function extractErrorCode(responseJson: unknown): number | undefined {
	const code = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0]);
	return typeof code === "number" && code >= 0 ? code : undefined;
}

function isModelUnavailable(errorCode: number | undefined): boolean {
	return errorCode === 1052;
}

function parseStreamGenerateResponse(rawText: string): GeminiWebResult {
	const responseJson = JSON.parse(trimJsonEnvelope(rawText));
	const errorCode = extractErrorCode(responseJson);

	const parts = Array.isArray(responseJson) ? responseJson : [];
	let body: unknown = null;

	for (let index = 0; index < parts.length; index++) {
		const partBody = getNestedValue(parts[index], [2]);
		if (!partBody || typeof partBody !== "string") {
			continue;
		}
		try {
			const parsed = JSON.parse(partBody);
			const candidateList = getNestedValue(parsed, [4]);
			if (Array.isArray(candidateList) && candidateList.length > 0) {
				body = parsed;
				break;
			}
		} catch {
			// Ignore partial parse failures.
		}
	}

	const candidateList = getNestedValue(body, [4]);
	const firstCandidate = Array.isArray(candidateList) ? candidateList[0] : undefined;
	const textRaw = getNestedValue(firstCandidate, [1, 0]) as string | undefined;

	let text = textRaw ?? "";
	if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
		const alt = getNestedValue(firstCandidate, [22, 0]) as string | undefined;
		if (alt) {
			text = alt;
		}
	}

	return { text, errorCode };
}
