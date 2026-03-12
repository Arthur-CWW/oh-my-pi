import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Cause, Data, Effect, Exit, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAllContentEffect, type ExtractOptions } from "./fetch-content-runtime.js";
import { readChromeCookiesEffect, type CookieReadResult } from "./chrome-cookies.js";
import { makeSearchEvent, type SearchEventName } from "./search-event.js";
import {
	executeFetchContent,
	FetchContentExecutionError,
	FetchContentParamsSchema,
	type FetchContentParams,
	type FetchContentToolResponse,
} from "./fetch-content.js";
import { renderFetchContentCall, renderFetchContentResult } from "./fetch-content-render.js";
import { type FullSearchOptions } from "./gemini-search.js";
import { type SearchSuccess } from "./kagi-search.js";
import { makeSqliteEventStore } from "./observability/EventStore.js";
import {
	SearchFallbackError,
	SearchProviderError,
	searchWithFallbackEffect,
} from "./search-runtime.js";
import {
	RECENCY_FILTER_VALUES,
	SEARCH_PROVIDER_SELECTION_VALUES,
	RecencyFilterSchema,
	SearchProviderSelectionSchema,
} from "./search-contracts.js";
import {
	executeGetSearchContent,
	GetSearchContentParamsSchema,
	type GetSearchContentParams,
} from "./search-content.js";
import { makeSearchEventsService } from "./search-events.js";
import { deleteResult, getAllResults } from "../shared/stored-results.js";
import type { ExtractedContent } from "../shared/fetch-content-contracts.js";

const EventStoreSmokeParamsSchema = Schema.Struct({
	dbPath: Schema.optional(Schema.String),
	correlationId: Schema.optional(Schema.String),
});

const WebSearchParamsSchema = Schema.Struct({
	query: Schema.String,
	provider: Schema.optional(SearchProviderSelectionSchema),
	numResults: Schema.optional(
		Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
	),
	recencyFilter: Schema.optional(RecencyFilterSchema),
	domainFilter: Schema.optional(Schema.Array(Schema.String)),
	lens: Schema.optional(Schema.String),
});

const CookiesParamsSchema = Schema.Struct({
	names: Schema.optional(Schema.Array(Schema.String)),
});

type EventStoreSmokeParams = typeof EventStoreSmokeParamsSchema.Type;
type WebSearchParams = typeof WebSearchParamsSchema.Type;
type CookiesParams = typeof CookiesParamsSchema.Type;

interface RegisterEffectToolsOptions {
	readonly includeWebSearch?: boolean;
}

interface SearchResponse extends SearchSuccess {
	readonly providerUsed?: "kagi" | "gemini";
	readonly correlationId?: string;
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
	readonly correlationId?: string;
	readonly queryDiagnostics?: SearchSuccess["queryDiagnostics"];
}

interface CookiesToolDetails {
	readonly error: string | null;
	readonly source?: CookieReadResult["source"];
	readonly warnings?: ReadonlyArray<string>;
}

interface EventStoreSmokeToolDetails {
	readonly error: string | null;
	readonly reason: string | null;
	readonly dbPath: string | null;
	readonly correlationId: string | null;
	readonly eventCount: number;
	readonly latestEventName: SearchEventName | null;
}

interface GetSearchContentToolDetails {
	readonly error?: string;
	readonly reason?: string;
	readonly responseId?: string;
	readonly query?: string;
	readonly resultCount?: number;
	readonly url?: string;
	readonly title?: string;
	readonly contentLength?: number;
}

interface GetSearchContentToolResponse {
	readonly content: Array<{ readonly type: "text"; readonly text: string }>;
	readonly details: GetSearchContentToolDetails;
}

type SearchExecutionOutcome =
	| { readonly ok: true; readonly response: SearchResponse }
	| { readonly ok: false; readonly error: SearchToolExecutionError };

type FetchContentExecutionOutcome =
	| { readonly ok: true; readonly response: FetchContentToolResponse }
	| { readonly ok: false; readonly error: FetchContentExecutionError };

export interface EffectExtensionDeps {
	readonly search: (
		query: string,
		options?: FullSearchOptions,
	) => Effect.Effect<SearchResponse, unknown>;
	readonly fetchContent: (
		urls: ReadonlyArray<string>,
		signal?: AbortSignal,
		options?: ExtractOptions,
	) => Effect.Effect<ReadonlyArray<ExtractedContent>, unknown>;
	readonly readCookies: typeof readChromeCookiesEffect;
}

class SearchToolExecutionError extends Data.TaggedError("SearchToolExecutionError")<{
	readonly title: string;
	readonly reassurance?: string;
	readonly technicalCause: string;
	readonly nextStep: string;
	readonly escapeHatch?: string;
	readonly retryable: boolean;
	readonly provider?: "kagi" | "gemini";
}> {}

class CookiesToolExecutionError extends Data.TaggedError("CookiesToolExecutionError")<{
	readonly reason: string;
}> {}

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

function decodeToolParams<S extends Schema.Top & { readonly DecodingServices: never }>(
	schema: S,
	rawParams: unknown,
): Effect.Effect<
	{ readonly ok: true; readonly value: S["Type"] } | { readonly ok: false; readonly message: string }
> {
	return Effect.sync(() => {
		const decoded = Schema.decodeUnknownExit(schema)(rawParams);
		if (Exit.isSuccess(decoded)) {
			return { ok: true as const, value: decoded.value };
		}
		return {
			ok: false as const,
			message: String(Cause.squash(decoded.cause)),
		};
	});
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
		return new SearchToolExecutionError({
			title:
				provider === "kagi"
					? "Kagi search is currently unavailable"
					: "Gemini search is currently unavailable",
			reassurance: "Your query was received, but the provider could not return results this time.",
			technicalCause: reason,
			nextStep:
				provider === "kagi"
					? 'Try again, or rerun with provider: "gemini" while Kagi recovers.'
					: "Check Gemini authentication/API key settings, then retry the same query.",
			escapeHatch:
				"If this keeps happening, share this error with support and include the technical cause.",
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
		return new SearchToolExecutionError({
			title: "No search provider could complete this request",
			reassurance: "Your query is intact. We tried both providers before returning this error.",
			technicalCause: `Kagi: ${primaryReason}\nGemini: ${fallbackReason}`,
			nextStep: 'Retry now, or run again with provider: "gemini" after checking your auth/config.',
			escapeHatch: "If this persists, contact support and include both provider causes.",
			retryable: true,
		});
	}

	return new SearchToolExecutionError({
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

const SEARCH_EVENTS_DB_PATH = process.env.PI_WEB_ACCESS_EVENT_DB_PATH;

const defaultSearchEventsServicePromise = Effect.runPromise(
	makeSearchEventsService(SEARCH_EVENTS_DB_PATH ? { dbPath: SEARCH_EVENTS_DB_PATH } : {}),
);

const defaultSearch = Effect.fn("EffectIndex.defaultSearch")(function* (
	query: string,
	options?: FullSearchOptions,
) {
	const events = yield* Effect.tryPromise({
		try: () => defaultSearchEventsServicePromise,
		catch: (cause) =>
			new SearchToolExecutionError({
				title: "Search event service initialization failed",
				reassurance: "Search is available, but telemetry setup failed during initialization.",
				technicalCause: toErrorMessage(cause),
				nextStep: "Retry the search request. If this persists, check local filesystem permissions.",
				escapeHatch:
					"Set PI_WEB_ACCESS_EVENT_DB_PATH to a writable location or unset it to disable sqlite events.",
				retryable: true,
			}),
	});
	return yield* searchWithFallbackEffect(query, options ?? {}, { events });
});

function searchWithToolDeps(
	deps: EffectExtensionDeps,
	query: string,
	options?: FullSearchOptions,
): Effect.Effect<SearchResponse, SearchToolExecutionError> {
	return deps.search(query, options).pipe(
		Effect.mapError((cause) =>
			cause instanceof SearchToolExecutionError ? cause : mapSearchFailureToToolError(cause),
		),
		Effect.catchDefect((defect) => Effect.fail(mapSearchFailureToToolError(defect))),
	);
}

function readCookiesWithToolDeps(
	deps: EffectExtensionDeps,
): Effect.Effect<CookieReadResult, CookiesToolExecutionError> {
	return deps.readCookies().pipe(
		Effect.mapError(
			(error) =>
				new CookiesToolExecutionError({
					reason: toErrorMessage(error),
				}),
		),
		Effect.catchDefect((defect) =>
			Effect.fail(
				new CookiesToolExecutionError({
					reason: toErrorMessage(defect),
				}),
			),
		),
	);
}

const defaultDeps: EffectExtensionDeps = {
	search: defaultSearch,
	fetchContent: (urls, signal, options) =>
		fetchAllContentEffect(urls, signal, options).pipe(
			Effect.mapError((cause) =>
				new FetchContentExecutionError({
					reason: toErrorMessage(cause),
				}),
			),
		),
	readCookies: readChromeCookiesEffect,
};

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

function formatStoredResultAge(timestamp: number): string {
	const ageMinutes = Math.floor((Date.now() - timestamp) / 60000);
	return ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ago`;
}

function describeStoredResult(result: {
	readonly id: string;
	readonly type: "search" | "fetch";
	readonly timestamp: number;
	readonly queries?: ReadonlyArray<{ readonly query: string }>;
	readonly urls?: ReadonlyArray<ExtractedContent>;
}): string {
	const age = formatStoredResultAge(result.timestamp);
	if (result.type === "search" && result.queries) {
		const query = result.queries[0]?.query || "unknown";
		return `[${result.id.slice(0, 6)}] "${query}" (${result.queries.length} queries) - ${age}`;
	}
	if (result.type === "fetch" && result.urls) {
		return `[${result.id.slice(0, 6)}] ${result.urls.length} URLs fetched - ${age}`;
	}
	return `[${result.id.slice(0, 6)}] ${result.type} - ${age}`;
}

function registerSearchCommand(pi: ExtensionAPI): void {
	pi.registerCommand("search", {
		description: "Browse stored web search results",
		handler: async (_args, ctx) => {
			const results = getAllResults();
			if (results.length === 0) {
				ctx.ui.notify("No stored search results", "info");
				return;
			}

			const choice = await ctx.ui.select(
				"Stored Search Results",
				results.map((result) => describeStoredResult(result)),
			);
			if (!choice) {
				return;
			}

			const match = choice.match(/^\[([a-z0-9]+)\]/);
			if (!match?.[1]) {
				return;
			}

			const selected = results.find((result) => result.id.startsWith(match[1]));
			if (!selected) {
				return;
			}

			const action = await ctx.ui.select(`Result ${selected.id.slice(0, 6)}`, [
				"View details",
				"Delete",
			]);
			if (action === "Delete") {
				deleteResult(selected.id);
				ctx.ui.notify(`Deleted ${selected.id.slice(0, 6)}`, "info");
				return;
			}
			if (action !== "View details") {
				return;
			}

			let info = `ID: ${selected.id}\nType: ${selected.type}\nAge: ${formatStoredResultAge(selected.timestamp)}\n\n`;
			if (selected.type === "search" && selected.queries) {
				info += "Queries:\n";
				for (const query of selected.queries.slice(0, 10)) {
					info += `- "${query.query}" (${query.results.length} results)\n`;
				}
				if (selected.queries.length > 10) {
					info += `... and ${selected.queries.length - 10} more\n`;
				}
			}
			if (selected.type === "fetch" && selected.urls) {
				info += "URLs:\n";
				for (const urlResult of selected.urls.slice(0, 10)) {
					const urlDisplay =
						urlResult.url.length > 50 ? `${urlResult.url.slice(0, 47)}...` : urlResult.url;
					info += `- ${urlDisplay} (${urlResult.error || `${urlResult.content.length} chars`})\n`;
				}
				if (selected.urls.length > 10) {
					info += `... and ${selected.urls.length - 10} more\n`;
				}
			}
			ctx.ui.notify(info, "info");
		},
	});
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
			const decoded = await Effect.runPromise(
				decodeToolParams(EventStoreSmokeParamsSchema, rawParams),
			);
			if (decoded.ok === false) {
				const details: EventStoreSmokeToolDetails = {
					error: "invalid-params",
					reason: decoded.message,
					dbPath: null,
					correlationId: null,
					eventCount: 0,
					latestEventName: null,
				};
				return {
					content: [{ type: "text", text: "Invalid parameters for effect_event_store_smoke." }],
					details,
				};
			}
			const params: EventStoreSmokeParams = decoded.value;
			const dbPath =
				params.dbPath ??
				join(tmpdir(), `pi-web-access-effect-shadow-${Date.now()}-${randomUUID()}.sqlite`);
			const correlationId = params.correlationId ?? `effect-shadow-${randomUUID()}`;

			const program = Effect.gen(function* () {
				const store = yield* makeSqliteEventStore({ dbPath });
				yield* store.append(
					makeSearchEvent(
						"ToolCompleted",
						{ tool: "effect_event_store_smoke", mode: "shadow" },
						correlationId,
					),
				);
				const events = yield* store.listByCorrelationId(correlationId);
				yield* store.close;
				const details: EventStoreSmokeToolDetails = {
					error: null,
					reason: null,
					dbPath,
					correlationId,
					eventCount: events.length,
					latestEventName: events[events.length - 1]?.name ?? null,
				};
				return details;
			});

			const exit = await Effect.runPromiseExit(program);
			if (exit._tag === "Failure") {
				const details: EventStoreSmokeToolDetails = {
					error: "event-store-smoke-failed",
					reason: null,
					dbPath,
					correlationId,
					eventCount: 0,
					latestEventName: null,
				};
				return {
					content: [{ type: "text", text: "Effect shadow event-store smoke failed." }],
					details,
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

function registerWebSearchTool(pi: ExtensionAPI, deps: EffectExtensionDeps): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Web search tool using Kagi (default) with Gemini fallback. Supports Kagi operators (`filetype:`, `site:`, `inurl:`, `intitle:`, quotes, boolean/grouping) plus Google-style compatibility helpers (`before:`/`after:` full-date mapping, `ext:`, `allintitle:`, `allinurl:`, `allintext:`). Unsupported operators are passed through and may be ignored by Kagi.",
		parameters: Type.Object({
			query: Type.String({
				description: "Search query (Google-style operators supported where Kagi-compatible)",
			}),
			provider: Type.Optional(StringEnum([...SEARCH_PROVIDER_SELECTION_VALUES])),
			lens: Type.Optional(Type.String()),
			numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
			recencyFilter: Type.Optional(StringEnum([...RECENCY_FILTER_VALUES])),
			domainFilter: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, rawParams) {
			const decoded = await Effect.runPromise(decodeToolParams(WebSearchParamsSchema, rawParams));
			if (decoded.ok === false) {
				const error = new SearchToolExecutionError({
					title: "Invalid web_search parameters",
					reassurance: "The request reached the tool, but one or more arguments are invalid.",
					technicalCause: decoded.message,
					nextStep:
						"Fix the tool arguments and retry. Verify provider enum, numResults range, and list field types.",
					escapeHatch:
						"If this came from automation, validate payloads against the tool schema before calling.",
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
			const params: WebSearchParams = decoded.value;
			if (!params.query.trim()) {
				const error = new SearchToolExecutionError({
					title: "No query was provided",
					reassurance: "The tool is ready to run once you provide a search query.",
					technicalCause: "Missing required parameter: query",
					nextStep: "Call web_search again with a non-empty query string.",
					escapeHatch:
						"If this came from an automated prompt, validate tool arguments before calling.",
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

			const outcome: SearchExecutionOutcome = await Effect.runPromise(
				searchWithToolDeps(deps, params.query, {
					provider: params.provider,
					numResults: params.numResults,
					recencyFilter: params.recencyFilter,
					domainFilter: params.domainFilter ? [...params.domainFilter] : undefined,
					lens: params.lens,
				}).pipe(
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
				correlationId: outcome.response.correlationId,
				queryDiagnostics: outcome.response.queryDiagnostics,
			};
			return {
				content: [
					{
						type: "text",
						text: formatSearchSummary(outcome.response.results, outcome.response.answer),
					},
				],
				details,
			};
		},
	});
}

function registerChromeCookiesTool(pi: ExtensionAPI, deps: EffectExtensionDeps): void {
	pi.registerTool({
		name: "chrome_cookies",
		label: "Chrome Cookies (Effect)",
		description: "Read Google/Gemini cookie availability from local Chrome profile.",
		parameters: Type.Object({
			names: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, rawParams) {
			const decoded = await Effect.runPromise(decodeToolParams(CookiesParamsSchema, rawParams));
			if (decoded.ok === false) {
				const details: CookiesToolDetails = { error: decoded.message };
				return {
					content: [
						{ type: "text", text: `Invalid parameters for chrome_cookies.\n${decoded.message}` },
					],
					details,
				};
			}
			const params: CookiesParams = decoded.value;
			const requested = params.names ?? ["__Secure-1PSID", "__Secure-1PSIDTS", "NID"];

			const outcome = await Effect.runPromiseExit(readCookiesWithToolDeps(deps));

			if (Exit.isFailure(outcome)) {
				const error = Cause.squash(outcome.cause);
				const reason =
					error instanceof CookiesToolExecutionError ? error.reason : toErrorMessage(error);
				const details: CookiesToolDetails = { error: reason };
				return {
					content: [{ type: "text", text: `Error: ${reason}` }],
					details,
				};
			}

			const cookies = outcome.value;
			const present = requested.filter((name) => Boolean(cookies.cookies[name]));
			const warningText = cookies.warnings.length > 0 ? ` Warnings: ${cookies.warnings.length}.` : "";
			const details: CookiesToolDetails = {
				error: null,
				source: cookies.source,
				warnings: cookies.warnings,
			};
			return {
				content: [
					{
						type: "text",
						text: `Found ${Object.keys(cookies.cookies).length} Google cookie(s). Present requested: ${present.length}/${requested.length}. Source: ${cookies.source}.${warningText}`,
					},
				],
				details,
			};
		},
	});
}

function registerFetchContentTool(pi: ExtensionAPI, deps: EffectExtensionDeps): void {
	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description:
			"Fetch URL(s) and extract readable content as markdown. Supports YouTube video transcripts (with thumbnail), GitHub repository contents, and local video files (with frame thumbnail). Video frames can be extracted via timestamp/range or sampled across the entire video with frames alone. Falls back to Gemini for pages that block bots or fail Readability extraction. For YouTube and video files: ALWAYS pass the user's specific question via the prompt parameter — this directs the AI to focus on that aspect of the video, producing much better results than a generic extraction. Content is always stored and can be retrieved with get_search_content.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
			forceClone: Type.Optional(
				Type.Boolean({
					description: "Force cloning large GitHub repositories that exceed the size threshold",
				}),
			),
			prompt: Type.Optional(
				Type.String({
					description:
						"Question or instruction for video analysis (YouTube and video files). Pass the user's specific question here — e.g. 'describe the book shown at the advice for beginners section'. Without this, a generic transcript extraction is used which may miss what the user is asking about.",
				}),
			),
			timestamp: Type.Optional(
				Type.String({
					description:
						"Extract video frame(s) at a timestamp or time range. Single: '1:23:45', '23:45', or '85' (seconds). Range: '23:41-25:00' extracts evenly-spaced frames across that span (default 6). Use frames with ranges to control density; single+frames uses a fixed 5s interval. YouTube requires yt-dlp + ffmpeg; local videos require ffmpeg. Use a range when you know the approximate area but not the exact moment — you'll get a contact sheet to visually identify the right frame.",
				}),
			),
			frames: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 12,
					description:
						"Number of frames to extract. Use with timestamp range for custom density, with single timestamp to get N frames at 5s intervals, or alone to sample across the entire video. Requires yt-dlp + ffmpeg for YouTube, ffmpeg for local video.",
				}),
			),
			model: Type.Optional(
				Type.String({
					description:
						"Override the Gemini model for video/YouTube analysis (e.g. 'gemini-2.5-flash', 'gemini-3-flash-preview'). Defaults to config or gemini-3-flash-preview.",
				}),
			),
		}),
		async execute(_toolCallId, rawParams, signal, onUpdate) {
			const decoded = await Effect.runPromise(
				decodeToolParams(FetchContentParamsSchema, rawParams),
			);
			if (decoded.ok === false) {
				return {
					content: [
						{ type: "text", text: `Invalid parameters for fetch_content.\n${decoded.message}` },
					],
					details: {
						error: "invalid-params",
						reason: decoded.message,
					},
				};
			}

			const params: FetchContentParams = decoded.value;
			const outcome: FetchContentExecutionOutcome = await Effect.runPromise(
				executeFetchContent(
					params,
					{
						signal,
						onUpdate,
						persistToSession: (data) => {
							const api = pi as ExtensionAPI & {
								readonly appendEntry?: (customType: string, data: unknown) => void;
							};
							api.appendEntry?.("web-search-results", data);
						},
					},
					{ fetchContent: deps.fetchContent },
				).pipe(
					Effect.match({
						onFailure: (error): FetchContentExecutionOutcome => ({ ok: false, error }),
						onSuccess: (response): FetchContentExecutionOutcome => ({ ok: true, response }),
					}),
				),
			);

			if (outcome.ok === false) {
				return {
					content: [{ type: "text", text: `Error: ${outcome.error.reason}` }],
					details: {
						error: outcome.error.reason,
					},
				};
			}

			return outcome.response;
		},
		renderCall(args, theme) {
			return renderFetchContentCall(args, theme);
		},
		renderResult(result, state, theme) {
			return renderFetchContentResult(result, state, theme);
		},
	});
}

function registerGetSearchContentTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "get_search_content",
		label: "Get Search Content",
		description: "Retrieve full content from a previous web_search or fetch_content call.",
		parameters: Type.Object({
			responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
			query: Type.Optional(Type.String({ description: "Get content for this query (web_search)" })),
			queryIndex: Type.Optional(Type.Number({ description: "Get content for query at index" })),
			url: Type.Optional(Type.String({ description: "Get content for this URL" })),
			urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" })),
		}),
		async execute(_toolCallId, rawParams): Promise<GetSearchContentToolResponse> {
			const decoded = await Effect.runPromise(
				decodeToolParams(GetSearchContentParamsSchema, rawParams),
			);
			if (decoded.ok === false) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters for get_search_content.\n${decoded.message}`,
						},
					],
					details: {
						error: "invalid-params",
						reason: decoded.message,
					},
				};
			}

			const params: GetSearchContentParams = decoded.value;
			const result = await Effect.runPromise(executeGetSearchContent(params));
			return {
				content: result.content.map((item) => ({ type: item.type, text: item.text })),
				details: { ...result.details },
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
	registerChromeCookiesTool(pi, deps);
	registerFetchContentTool(pi, deps);
	registerGetSearchContentTool(pi);
	if (options.includeWebSearch !== false) {
		registerWebSearchTool(pi, deps);
	}
}

export default function (pi: ExtensionAPI) {
	registerEffectTools(pi, defaultDeps, { includeWebSearch: true });
	registerSearchCommand(pi);
}
