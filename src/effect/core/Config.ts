import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ConfigParseError, ConfigReadError, MissingConfigError } from "./Errors.js";

export const DEFAULT_WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

export type SearchProvider = "auto" | "perplexity" | "gemini";

export interface AutoFilterConfig {
	readonly enabled: boolean;
	readonly model?: string;
	readonly prompt?: string;
}

export interface ShortcutConfig {
	readonly curate: string;
	readonly activity: string;
}

export interface WebSearchConfig {
	readonly provider: SearchProvider;
	readonly curateWindow?: number;
	readonly autoFilter?: AutoFilterConfig;
	readonly shortcuts?: ShortcutConfig;
}

const DEFAULT_SHORTCUTS: ShortcutConfig = {
	curate: "ctrl+shift+s",
	activity: "ctrl+shift+w",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseProvider(value: unknown): SearchProvider {
	if (value === "auto" || value === "perplexity" || value === "gemini") return value;
	return "auto";
}

function parseAutoFilter(value: unknown): AutoFilterConfig | undefined {
	if (typeof value === "boolean") {
		return { enabled: value };
	}
	if (!isRecord(value)) return undefined;
	const enabled = value.enabled;
	if (typeof enabled !== "boolean") return undefined;
	const model = typeof value.model === "string" ? value.model : undefined;
	const prompt = typeof value.prompt === "string" ? value.prompt : undefined;
	return { enabled, model, prompt };
}

function parseShortcuts(value: unknown): ShortcutConfig | undefined {
	if (!isRecord(value)) return undefined;
	const curate = typeof value.curate === "string" ? value.curate : DEFAULT_SHORTCUTS.curate;
	const activity =
		typeof value.activity === "string" ? value.activity : DEFAULT_SHORTCUTS.activity;
	return { curate, activity };
}

export function decodeWebSearchConfig(
	raw: unknown,
	path: string = DEFAULT_WEB_SEARCH_CONFIG_PATH,
): Effect.Effect<WebSearchConfig, ConfigParseError> {
	return Effect.try({
		try: () => {
			if (!isRecord(raw)) {
				throw new Error("Config must be an object");
			}
			const provider = parseProvider(raw.searchProvider ?? raw.provider);
			const curateWindow =
				typeof raw.curateWindow === "number" ? Math.max(0, Math.floor(raw.curateWindow)) : undefined;
			const autoFilter = parseAutoFilter(raw.autoFilter);
			const shortcuts = parseShortcuts(raw.shortcuts);
			return { provider, curateWindow, autoFilter, shortcuts };
		},
		catch: (cause) =>
			new ConfigParseError({
				path,
				reason: cause instanceof Error ? cause.message : String(cause),
			}),
	});
}

export function loadWebSearchConfig(
	path: string = DEFAULT_WEB_SEARCH_CONFIG_PATH,
): Effect.Effect<WebSearchConfig, ConfigReadError | ConfigParseError> {
	return Effect.gen(function* () {
		const rawText = yield* Effect.try({
			try: () => {
				if (!existsSync(path)) return "{}";
				return readFileSync(path, "utf-8");
			},
			catch: (cause) =>
				new ConfigReadError({
					path,
					reason: cause instanceof Error ? cause.message : String(cause),
				}),
		});

		const parsed = yield* Effect.try({
			try: () => JSON.parse(rawText) as unknown,
			catch: (cause) =>
				new ConfigParseError({
					path,
					reason: cause instanceof Error ? cause.message : String(cause),
				}),
		});

		return yield* decodeWebSearchConfig(parsed, path);
	});
}

export function requireEnv(name: string): Effect.Effect<string, MissingConfigError> {
	return Effect.try({
		try: () => {
			const value = process.env[name];
			if (!value) {
				throw new Error(`Missing required environment variable: ${name}`);
			}
			return value;
		},
		catch: (cause) =>
			new MissingConfigError({
				key: name,
				reason: cause instanceof Error ? cause.message : String(cause),
			}),
	});
}
