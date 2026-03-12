import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Config, ConfigProvider, Effect, Option } from "effect";
import { decodeSearchProviderOrAuto, type SearchProvider } from "../search-contracts.js";
import { ConfigParseError, ConfigReadError, MissingConfigError } from "./Errors.js";

export const DEFAULT_WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

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

function toParseError(path: string, cause: unknown): ConfigParseError {
	return new ConfigParseError({
		path,
		reason: cause instanceof Error ? cause.message : String(cause),
	});
}

function optionalConfig<A>(config: Config.Config<A>): Effect.Effect<A | undefined> {
	return Effect.gen(function* () {
		const value = yield* Config.option(config);
		return Option.isSome(value) ? value.value : undefined;
	}).pipe(Effect.catch(() => Effect.succeed(undefined)));
}

function decodeWithConfigProvider(
	raw: Record<string, unknown>,
	path: string,
): Effect.Effect<WebSearchConfig, ConfigParseError> {
	const hasShortcutsRecord = isRecord(raw.shortcuts);
	const provider = ConfigProvider.fromUnknown(raw);

	const program = Effect.gen(function* () {
		const providerValue = yield* Config.string("provider").pipe(
			Config.orElse(() => Config.string("searchProvider")),
			Config.orElse(() => Config.succeed("auto")),
		);
		const resolvedProvider = decodeSearchProviderOrAuto(providerValue);

		const curateWindowRaw = yield* optionalConfig(Config.number("curateWindow"));
		const curateWindow =
			typeof curateWindowRaw === "number" && Number.isFinite(curateWindowRaw)
				? Math.max(0, Math.floor(curateWindowRaw))
				: undefined;

		const autoFilterEnabled = yield* optionalConfig(
			Config.boolean("enabled").pipe(Config.nested("autoFilter")),
		);
		const autoFilterModel = yield* optionalConfig(
			Config.string("model").pipe(Config.nested("autoFilter")),
		);
		const autoFilterPrompt = yield* optionalConfig(
			Config.string("prompt").pipe(Config.nested("autoFilter")),
		);
		const autoFilterBoolean = yield* optionalConfig(Config.boolean("autoFilter"));

		const autoFilter =
			typeof autoFilterEnabled === "boolean"
				? {
						enabled: autoFilterEnabled,
						...(typeof autoFilterModel === "string" ? { model: autoFilterModel } : {}),
						...(typeof autoFilterPrompt === "string" ? { prompt: autoFilterPrompt } : {}),
					}
				: typeof autoFilterBoolean === "boolean"
					? { enabled: autoFilterBoolean }
					: undefined;

		const shortcutsCurate = yield* optionalConfig(
			Config.string("curate").pipe(Config.nested("shortcuts")),
		);
		const shortcutsActivity = yield* optionalConfig(
			Config.string("activity").pipe(Config.nested("shortcuts")),
		);
		const shortcuts = hasShortcutsRecord
			? {
					curate: shortcutsCurate ?? DEFAULT_SHORTCUTS.curate,
					activity: shortcutsActivity ?? DEFAULT_SHORTCUTS.activity,
				}
			: undefined;

		return {
			provider: resolvedProvider,
			...(curateWindow !== undefined ? { curateWindow } : {}),
			...(autoFilter ? { autoFilter } : {}),
			...(shortcuts ? { shortcuts } : {}),
		};
	});

	return program.pipe(
		Effect.provide(ConfigProvider.layer(provider)),
		Effect.mapError((cause) => (cause instanceof ConfigParseError ? cause : toParseError(path, cause))),
	);
}

export function decodeWebSearchConfig(
	raw: unknown,
	path: string = DEFAULT_WEB_SEARCH_CONFIG_PATH,
): Effect.Effect<WebSearchConfig, ConfigParseError> {
	if (!isRecord(raw)) {
		return Effect.fail(toParseError(path, new Error("Config must be an object")));
	}
	return decodeWithConfigProvider(raw, path);
}

export function loadWebSearchConfig(
	path: string = DEFAULT_WEB_SEARCH_CONFIG_PATH,
): Effect.Effect<WebSearchConfig, ConfigReadError | ConfigParseError> {
	return Effect.gen(function* () {
		const rawText = yield* Effect.try({
			try: () => {
				if (!existsSync(path)) {
					return "{}";
				}
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
			catch: (cause) => toParseError(path, cause),
		});

		return yield* decodeWebSearchConfig(parsed, path);
	});
}

export function requireEnv(name: string): Effect.Effect<string, MissingConfigError> {
	return Effect.gen(function* () {
		return yield* Config.string(name);
	}).pipe(
		Effect.mapError(
			(cause) =>
				new MissingConfigError({
					key: name,
					reason: cause instanceof Error ? cause.message : String(cause),
				}),
		),
	);
}
