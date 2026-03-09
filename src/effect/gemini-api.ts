import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");
export const DEFAULT_MODEL = "gemini-3-flash-preview";

interface GeminiApiConfig {
	readonly geminiApiKey?: string;
	readonly GEMINI_API_KEY?: string;
}

let cachedConfig: GeminiApiConfig | null = null;

function loadConfig(): GeminiApiConfig {
	if (cachedConfig) {
		return cachedConfig;
	}
	if (existsSync(CONFIG_PATH)) {
		try {
			cachedConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as GeminiApiConfig;
			return cachedConfig;
		} catch {
			// Fall back to empty config.
		}
	}
	cachedConfig = {};
	return cachedConfig;
}

export function getApiKey(): string | null {
	const envKey = process.env.GEMINI_API_KEY;
	if (envKey) {
		return envKey;
	}
	const config = loadConfig();
	return config.geminiApiKey ?? config.GEMINI_API_KEY ?? null;
}

export function isGeminiApiAvailable(): boolean {
	return getApiKey() !== null;
}

export interface GeminiApiOptions {
	readonly model?: string;
	readonly mimeType?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function queryGeminiApiWithVideo(
	prompt: string,
	videoUri: string,
	options: GeminiApiOptions = {},
): Promise<string> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("GEMINI_API_KEY not configured");
	}

	const model = options.model ?? DEFAULT_MODEL;
	const signal = withTimeout(options.signal, options.timeoutMs ?? 120000);
	const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

	const fileData: Record<string, string> = { fileUri: videoUri };
	if (options.mimeType) {
		fileData.mimeType = options.mimeType;
	}

	const body = {
		contents: [
			{
				parts: [{ fileData }, { text: prompt }],
			},
		],
	};

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error ${response.status}: ${errorText.slice(0, 300)}`);
	}

	const data = (await response.json()) as GenerateContentResponse;
	const text = data.candidates?.[0]?.content?.parts
		?.map((part) => part.text)
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.join("\n");

	if (!text || text.length === 0) {
		throw new Error("Gemini API returned empty response");
	}
	return text;
}

interface GenerateContentResponse {
	readonly candidates?: ReadonlyArray<{
		readonly content?: {
			readonly parts?: ReadonlyArray<{ readonly text?: string }>;
		};
	}>;
}
