import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Context, Effect, Either, Layer, Schema, Schedule } from "effect";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChromeCookiesEffect, type CookieReadResult } from "./chrome-cookies.js";
import { makeEvent } from "./core/Observability.js";
import { type FullSearchOptions, search as geminiSearch } from "./gemini-search.js";
import { kagiSearchEffect, type SearchSuccess } from "./kagi-search.js";
import { makeSqliteEventStore } from "./observability/EventStore.js";

interface EventStoreSmokeParams {
	readonly dbPath?: string;
	readonly correlationId?: string;
}

interface WebSearchParams {
	readonly query?: string;
	readonly provider?: "auto" | "kagi" | "gemini";
	readonly numResults?: number;
	readonly recencyFilter?: "day" | "week" | "month" | "year";
	readonly domainFilter?: string[];
	readonly lens?: string;
}

interface CookiesParams {
	readonly names?: string[];
}

interface RegisterEffectToolsOptions {
	readonly includeWebSearch?: boolean;
}

interface SearchResponse extends SearchSuccess {
	readonly providerUsed?: "kagi" | "gemini";
}

interface SearchErrorDetails {
	readonly title: string;
	readonly reassurance?: string;
	readonly technicalCause: string;
	readonly nextStep: string;
	readonly escapeHatch?: string;
	readonly retryable: boolean;
	readonly provider?: "kagi" | "gemini";
}

interface WebSearchToolDetails {
	readonly error: SearchErrorDetails | null;
	readonly provider?: "kagi" | "gemini";
	readonly resultCount?: number;
	readonly queryDiagnostics?: SearchSuccess["queryDiagnostics"];
}

interface CookiesToolDetails {
	readonly error: string | null;
	readonly source?: CookieReadResult["source"];
	readonly warnings?: ReadonlyArray<string>;
}

type SearchExecutionOutcome =
	| { readonly ok: true; readonly response: SearchResponse }
	| { readonly ok: false; readonly error: SearchToolExecutionError };

type CookiesExecutionOutcome =
	| { readonly ok: true; readonly value: CookieReadResult }
	| { readonly ok: false; readonly error: CookiesToolExecutionError };

export interface EffectExtensionDeps {
	readonly search: (query: string, options?: FullSearchOptions) => Promise<SearchResponse>;
	readonly readCookies: typeof readChromeCookiesEffect;
}

class SearchProviderError extends Schema.TaggedError<SearchProviderError>()("SearchProviderError", {
	provider: Schema.Literal("kagi", "gemini"),
	reason: Schema.String,
}) {}

class SearchFallbackError extends Schema.TaggedError<SearchFallbackError>()("SearchFallbackError", {
	primaryProvider: Schema.Literal("kagi"),
	primaryReason: Schema.String,
	fallbackProvider: Schema.Literal("gemini"),
	fallbackReason: Schema.String,
}) {}

class SearchToolExecutionError extends Schema.TaggedError<SearchToolExecutionError>()(
	"SearchToolExecutionError",
	{
		title: Schema.String,
		reassurance: Schema.optional(Schema.String),
		technicalCause: Schema.String,
		nextStep: Schema.String,
		escapeHatch: Schema.optional(Schema.String),
		retryable: Schema.Boolean,
		provider: Schema.optional(Schema.Literal("kagi", "gemini")),
	},
) {}

class CookiesToolExecutionError extends Schema.TaggedError<CookiesToolExecutionError>()(
	"CookiesToolExecutionError",
	{
		reason: Schema.String,
	},
) {}

class SearchService extends Context.Tag("@pi-web-access/SearchService")<
	SearchService,
	{
		readonly search: (
			query: string,
			options?: FullSearchOptions,
		) => Effect.Effect<SearchResponse, SearchToolExecutionError>;
	}
>() {}

class CookiesService extends Context.Tag("@pi-web-access/CookiesService")<
	CookiesService,
	{
		readonly readCookies: () => Effect.Effect<CookieReadResult, CookiesToolExecutionError>;
	}
>() {}

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

function isTaggedError(error: unknown, tag: string): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const candidate = error as { readonly _tag?: unknown };
	return candidate._tag === tag;
}

function mapSearchFailureToToolError(error: unknown): SearchToolExecutionError {
	if (error instanceof SearchProviderError || isTaggedError(error, "SearchProviderError")) {
		const provider =
			error instanceof SearchProviderError
				? error.provider
				: (error as { readonly provider: "kagi" | "gemini" }).provider;
		const reason =
			error instanceof SearchProviderError
				? error.reason
				: (error as { readonly reason: string }).reason;
		return SearchToolExecutionError.make({
			title:
				provider === "kagi"
					? "Kagi search is currently unavailable"
					: "Gemini search is currently unavailable",
			reassurance: "Your query was received, but the provider could not return results this time.",
			technicalCause: reason,
			nextStep:
				provider === "kagi"
					? "Try again, or rerun with provider: \"gemini\" while Kagi recovers."
					: "Check Gemini authentication/API key settings, then retry the same query.",
			escapeHatch: "If this keeps happening, share this error with support and include the technical cause.",
			retryable: true,
			provider,
		});
	}

	if (error instanceof SearchFallbackError || isTaggedError(error, "SearchFallbackError")) {
		const primaryReason =
			error instanceof SearchFallbackError
				? error.primaryReason
				: (error as { readonly primaryReason: string }).primaryReason;
		const fallbackReason =
			error instanceof SearchFallbackError
				? error.fallbackReason
				: (error as { readonly fallbackReason: string }).fallbackReason;
		return SearchToolExecutionError.make({
			title: "No search provider could complete this request",
			reassurance: "Your query is intact. We tried both providers before returning this error.",
			technicalCause: `Kagi: ${primaryReason}\nGemini: ${fallbackReason}`,
			nextStep: "Retry now, or run again with provider: \"gemini\" after checking your auth/config.",
			escapeHatch: "If this persists, contact support and include both provider causes.",
			retryable: true,
		});
	}

	return SearchToolExecutionError.make({
		title: "Web search failed",
		reassurance: "Your query was received, but the request did not complete.",
		technicalCause: toErrorMessage(error),
		nextStep: "Retry the search. If it repeats, switch provider or check local auth/session state.",
		escapeHatch: "If the issue keeps happening, share this message with support.",
		retryable: true,
	});
}

function formatSearchToolError(error: SearchToolExecutionError): string {
	const lines = [error.title];
	if (error.reassurance) {
		lines.push("", error.reassurance);
	}
	lines.push("", `Technical cause: ${error.technicalCause}`);
	lines.push(`Next step: ${error.nextStep}`);
	if (error.escapeHatch) {
		lines.push(`Need help: ${error.escapeHatch}`);
	}
	return lines.join("\n");
}

const SEARCH_RETRY_POLICY = Schedule.spaced("250 millis").pipe(Schedule.compose(Schedule.recurs(1)));

const runKagiSearchEffect = Effect.fn("EffectIndex.runKagiSearch")(function* (
	query: string,
	options: FullSearchOptions,
) {
	return yield* kagiSearchEffect(query, undefined, {
		lens: options.lens,
		recencyFilter: options.recencyFilter,
		domainFilter: options.domainFilter,
	}).pipe(
		Effect.map((result): SearchResponse => ({ ...result, providerUsed: "kagi" })),
		Effect.mapError((error) =>
			SearchProviderError.make({
				provider: "kagi",
				reason: error.reason,
			}),
		),
	);
});

const runGeminiSearchEffect = Effect.fn("EffectIndex.runGeminiSearch")(function* (
	query: string,
	options: FullSearchOptions,
) {
	const result = yield* Effect.tryPromise({
		try: () => geminiSearch(query, options),
		catch: (cause) =>
			SearchProviderError.make({
				provider: "gemini",
				reason: toErrorMessage(cause),
			}),
	});
	return {
		...result,
		providerUsed: "gemini" as const,
	};
});

const searchWithFallbackEffect = Effect.fn("EffectIndex.searchWithFallback")(function* (
	query: string,
	options: FullSearchOptions = {},
) {
	const preferredProvider = options.provider ?? "auto";
	if (preferredProvider === "kagi") {
		return yield* runKagiSearchEffect(query, options).pipe(Effect.retry(SEARCH_RETRY_POLICY));
	}
	if (preferredProvider === "gemini") {
		return yield* runGeminiSearchEffect(query, options).pipe(Effect.retry(SEARCH_RETRY_POLICY));
	}

	const kagiAttempt = yield* Effect.either(
		runKagiSearchEffect(query, options).pipe(Effect.retry(SEARCH_RETRY_POLICY)),
	);
	if (Either.isRight(kagiAttempt)) {
		return kagiAttempt.right;
	}

	yield* Effect.logWarning(`Kagi search failed, falling back to Gemini: ${kagiAttempt.left.reason}`);

	const geminiAttempt = yield* Effect.either(
		runGeminiSearchEffect(query, options).pipe(Effect.retry(SEARCH_RETRY_POLICY)),
	);
	if (Either.isRight(geminiAttempt)) {
		return geminiAttempt.right;
	}

	return yield* SearchFallbackError.make({
		primaryProvider: "kagi",
		primaryReason: kagiAttempt.left.reason,
		fallbackProvider: "gemini",
		fallbackReason: geminiAttempt.left.reason,
	});
});

async function searchWithFallback(
	query: string,
	options?: FullSearchOptions,
): Promise<SearchResponse> {
	return Effect.runPromise(
		searchWithFallbackEffect(query, options ?? {}).pipe(
			Effect.mapError((error) => mapSearchFailureToToolError(error)),
		),
	);
}

function makeSearchServiceLayer(deps: EffectExtensionDeps): Layer.Layer<SearchService> {
	const search = Effect.fn("SearchService.search")(function* (
		query: string,
		options?: FullSearchOptions,
	) {
		return yield* Effect.tryPromise({
			try: () => deps.search(query, options),
			catch: (cause) =>
				cause instanceof SearchToolExecutionError
					? cause
					: mapSearchFailureToToolError(cause),
		});
	});

	return Layer.succeed(
		SearchService,
		SearchService.of({
			search,
		}),
	);
}

function makeCookiesServiceLayer(deps: EffectExtensionDeps): Layer.Layer<CookiesService> {
	const readCookies = Effect.fn("CookiesService.readCookies")(function* () {
		return yield* deps.readCookies().pipe(
			Effect.mapError((error) =>
				CookiesToolExecutionError.make({
					reason: toErrorMessage(error),
				}),
			),
			Effect.catchAllDefect((defect) =>
				Effect.fail(
					CookiesToolExecutionError.make({
						reason: toErrorMessage(defect),
					}),
				),
			),
		);
	});

	return Layer.succeed(
		CookiesService,
		CookiesService.of({
			readCookies,
		}),
	);
}

const defaultDeps: EffectExtensionDeps = {
	search: searchWithFallback,
	readCookies: readChromeCookiesEffect,
};

const LEGACY_ENTRY_CANDIDATES = ["../old/index.js", "../old/index.ts"] as const;

function formatSearchSummary(
	results: ReadonlyArray<{ title: string; url: string; snippet?: string; publishedAt?: string }>,
	answer: string,
): string {
	const body = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
	return (
		body +
		results
			.map((result, index) => {
				const snippet = result.snippet?.trim() ?? "";
				const publishedAt = result.publishedAt?.trim() ?? "";
				const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
				if (publishedAt.length > 0) {
					lines.push(`   Date: ${publishedAt}`);
				}
				if (snippet.length > 0) {
					lines.push(`   ${snippet}`);
				}
				return lines.join("\n");
			})
			.join("\n\n")
	);
}

function loadLegacyRegistrar(): ((pi: ExtensionAPI) => void) | null {
	const require = createRequire(import.meta.url);
	for (const candidate of LEGACY_ENTRY_CANDIDATES) {
		try {
			const moduleRecord = require(candidate) as { default?: unknown };
			if (typeof moduleRecord.default === "function") {
				return moduleRecord.default as (pi: ExtensionAPI) => void;
			}
		} catch {
			// Try next candidate path.
		}
	}
	return null;
}

function registerEventStoreSmokeTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "effect_event_store_smoke",
		label: "Effect Event Store Smoke",
		description:
			"Dry-run tool for the Effect migration path. Appends a sample event to the Effect SQLite event store and returns a small status summary.",
		parameters: Type.Object({
			dbPath: Type.Optional(Type.String()),
			correlationId: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, rawParams) {
			const params = rawParams as EventStoreSmokeParams;
			const dbPath =
				params.dbPath ?? join(tmpdir(), `pi-web-access-effect-shadow-${Date.now()}-${randomUUID()}.sqlite`);
			const correlationId = params.correlationId ?? `effect-shadow-${randomUUID()}`;

			const program = Effect.gen(function* () {
				const store = yield* makeSqliteEventStore({ dbPath });
				yield* store.append(
					makeEvent(
						"ToolCompleted",
						{ tool: "effect_event_store_smoke", mode: "shadow" },
						correlationId,
					),
				);
				const events = yield* store.listByCorrelationId(correlationId);
				yield* store.close;
				return {
					error: null,
					dbPath,
					correlationId,
					eventCount: events.length,
					latestEventName: events[events.length - 1]?.name ?? null,
				};
			});

			const exit = await Effect.runPromiseExit(program);
			if (exit._tag === "Failure") {
				return {
					content: [{ type: "text", text: "Effect shadow event-store smoke failed." }],
					details: {
						error: "event-store-smoke-failed",
						dbPath,
						correlationId,
						eventCount: 0,
						latestEventName: null,
					},
				};
			}

			return {
				content: [
					{ type: "text", text: `Effect shadow ok. Stored ${exit.value.eventCount} event(s).` },
				],
				details: exit.value,
			};
		},
	});
}

function registerWebSearchTool(pi: ExtensionAPI, searchLayer: Layer.Layer<SearchService>): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Web search tool using Kagi (default) with Gemini fallback. Supports Kagi operators (`filetype:`, `site:`, `inurl:`, `intitle:`, quotes, boolean/grouping) plus Google-style compatibility helpers (`before:`/`after:` full-date mapping, `ext:`, `allintitle:`, `allinurl:`, `allintext:`). Unsupported operators are passed through and may be ignored by Kagi.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query (Google-style operators supported where Kagi-compatible)" }),
			provider: Type.Optional(StringEnum(["auto", "kagi", "gemini"])),
			lens: Type.Optional(Type.String()),
			numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
			recencyFilter: Type.Optional(StringEnum(["day", "week", "month", "year"])),
			domainFilter: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, rawParams) {
			const params = rawParams as WebSearchParams;
			if (!params.query?.trim()) {
				const error = SearchToolExecutionError.make({
					title: "No query was provided",
					reassurance: "The tool is ready to run once you provide a search query.",
					technicalCause: "Missing required parameter: query",
					nextStep: "Call web_search again with a non-empty query string.",
					escapeHatch: "If this came from an automated prompt, validate tool arguments before calling.",
					retryable: true,
				});
				const details: WebSearchToolDetails = {
					error: {
						title: error.title,
						reassurance: error.reassurance,
						technicalCause: error.technicalCause,
						nextStep: error.nextStep,
						escapeHatch: error.escapeHatch,
						retryable: error.retryable,
					},
				};
				return {
					content: [{ type: "text", text: formatSearchToolError(error) }],
					details,
				};
			}

			const searchProgram = Effect.gen(function* () {
				const search = yield* SearchService;
				return yield* search.search(params.query ?? "", {
					provider: params.provider,
					numResults: params.numResults,
					recencyFilter: params.recencyFilter,
					domainFilter: params.domainFilter,
					lens: params.lens,
				});
			}).pipe(Effect.provide(searchLayer));

			const outcome: SearchExecutionOutcome = await Effect.runPromise(
				searchProgram.pipe(
					Effect.match({
						onFailure: (error): SearchExecutionOutcome => ({ ok: false, error }),
						onSuccess: (response): SearchExecutionOutcome => ({ ok: true, response }),
					}),
				),
			);

			if (outcome.ok === false) {
				const details: WebSearchToolDetails = {
					error: {
						title: outcome.error.title,
						reassurance: outcome.error.reassurance,
						technicalCause: outcome.error.technicalCause,
						nextStep: outcome.error.nextStep,
						escapeHatch: outcome.error.escapeHatch,
						retryable: outcome.error.retryable,
						provider: outcome.error.provider,
					},
				};
				return {
					content: [{ type: "text", text: formatSearchToolError(outcome.error) }],
					details,
				};
			}

			const details: WebSearchToolDetails = {
				error: null,
				provider: outcome.response.providerUsed,
				resultCount: outcome.response.results.length,
				queryDiagnostics: outcome.response.queryDiagnostics,
			};
			return {
				content: [
					{ type: "text", text: formatSearchSummary(outcome.response.results, outcome.response.answer) },
				],
				details,
			};
		},
	});
}

function registerChromeCookiesTool(pi: ExtensionAPI, cookiesLayer: Layer.Layer<CookiesService>): void {
	pi.registerTool({
		name: "chrome_cookies",
		label: "Chrome Cookies (Effect)",
		description: "Read Google/Gemini cookie availability from local Chrome profile.",
		parameters: Type.Object({
			names: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, rawParams) {
			const params = rawParams as CookiesParams;
			const requested = params.names ?? ["__Secure-1PSID", "__Secure-1PSIDTS", "NID"];

			const readProgram = Effect.gen(function* () {
				const cookies = yield* CookiesService;
				return yield* cookies.readCookies();
			}).pipe(Effect.provide(cookiesLayer));

			const outcome = await Effect.runPromise(
				readProgram.pipe(
					Effect.match({
						onFailure: (error): CookiesExecutionOutcome => ({ ok: false, error }),
						onSuccess: (value): CookiesExecutionOutcome => ({ ok: true, value }),
					}),
				),
			);

			if ("error" in outcome) {
				const details: CookiesToolDetails = { error: outcome.error.reason };
				return {
					content: [{ type: "text", text: `Error: ${outcome.error.reason}` }],
					details,
				};
			}

			const present = requested.filter((name) => Boolean(outcome.value.cookies[name]));
			const warningText =
				outcome.value.warnings.length > 0 ? ` Warnings: ${outcome.value.warnings.length}.` : "";
			const details: CookiesToolDetails = {
				error: null,
				source: outcome.value.source,
				warnings: outcome.value.warnings,
			};
			return {
				content: [
					{
						type: "text",
						text: `Found ${Object.keys(outcome.value.cookies).length} Google cookie(s). Present requested: ${present.length}/${requested.length}. Source: ${outcome.value.source}.${warningText}`,
					},
				],
				details,
			};
		},
	});
}

export function registerEffectTools(
	pi: ExtensionAPI,
	deps: EffectExtensionDeps = defaultDeps,
	options: RegisterEffectToolsOptions = {},
): void {
	registerEventStoreSmokeTool(pi);
	const searchLayer = makeSearchServiceLayer(deps);
	const cookiesLayer = makeCookiesServiceLayer(deps);
	registerChromeCookiesTool(pi, cookiesLayer);
	if (options.includeWebSearch !== false) {
		registerWebSearchTool(pi, searchLayer);
	}
}

export default function (pi: ExtensionAPI) {
	const registerLegacy = loadLegacyRegistrar();
	if (registerLegacy) {
		registerLegacy(pi);
		// Register Effect web_search last so it overrides legacy web_search while
		// preserving the rest of the legacy tool surface during migration.
		registerEffectTools(pi, defaultDeps, { includeWebSearch: true });
		return;
	}

	registerEffectTools(pi, defaultDeps, { includeWebSearch: true });
}
