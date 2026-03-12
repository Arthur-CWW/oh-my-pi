import { randomUUID } from "node:crypto";
import { Effect, Either, Schedule, Schema } from "effect";
import { searchEffect as geminiSearchEffect, type FullSearchOptions } from "./gemini-search.js";
import { kagiSearchEffect, type SearchSuccess } from "./kagi-search.js";
import { NoopSearchEventsService, type SearchEventsService } from "./search-events.js";

export interface SearchRuntimeOptions extends FullSearchOptions {
	readonly correlationId?: string;
	readonly sessionId?: string;
}

export interface SearchRuntimeResponse extends SearchSuccess {
	readonly providerUsed: "kagi" | "gemini";
	readonly correlationId: string;
}

export class SearchProviderError extends Schema.TaggedError<SearchProviderError>()(
	"SearchProviderError",
	{
		provider: Schema.Literal("kagi", "gemini"),
		reason: Schema.String,
	},
) {}

export class SearchFallbackError extends Schema.TaggedError<SearchFallbackError>()("SearchFallbackError", {
	primaryProvider: Schema.Literal("kagi"),
	primaryReason: Schema.String,
	fallbackProvider: Schema.Literal("gemini"),
	fallbackReason: Schema.String,
}) {}

const SEARCH_RETRY_POLICY = Schedule.spaced("250 millis").pipe(Schedule.compose(Schedule.recurs(1)));

export interface SearchRuntimeDeps {
	readonly runKagiSearch: (
		query: string,
		options: SearchRuntimeOptions,
	) => Effect.Effect<SearchSuccess, SearchProviderError>;
	readonly runGeminiSearch: (
		query: string,
		options: SearchRuntimeOptions,
	) => Effect.Effect<SearchSuccess, SearchProviderError>;
	readonly events: SearchEventsService;
	readonly generateCorrelationId: () => string;
}

function toGeminiOptions(options: SearchRuntimeOptions): FullSearchOptions {
	return {
		provider: options.provider,
		numResults: options.numResults,
		recencyFilter: options.recencyFilter,
		domainFilter: options.domainFilter,
		lens: options.lens,
	};
}

const runDefaultKagiSearch = Effect.fn("SearchRuntime.runDefaultKagiSearch")(function* (
	query: string,
	options: SearchRuntimeOptions,
) {
	return yield* kagiSearchEffect(query, undefined, {
		lens: options.lens,
		recencyFilter: options.recencyFilter,
		domainFilter: options.domainFilter,
	}).pipe(
		Effect.mapError((error) =>
			SearchProviderError.make({
				provider: "kagi",
				reason: error.reason,
			}),
		),
	);
});

const runDefaultGeminiSearch = Effect.fn("SearchRuntime.runDefaultGeminiSearch")(function* (
	query: string,
	options: SearchRuntimeOptions,
) {
	return yield* geminiSearchEffect(query, toGeminiOptions(options)).pipe(
		Effect.mapError((error) =>
			SearchProviderError.make({
				provider: "gemini",
				reason: error.reason,
			}),
		),
	);
});

const defaultSearchRuntimeDeps: SearchRuntimeDeps = {
	runKagiSearch: runDefaultKagiSearch,
	runGeminiSearch: runDefaultGeminiSearch,
	events: NoopSearchEventsService,
	generateCorrelationId: randomUUID,
};

function resolveDeps(overrides: Partial<SearchRuntimeDeps>): SearchRuntimeDeps {
	return {
		runKagiSearch: overrides.runKagiSearch ?? defaultSearchRuntimeDeps.runKagiSearch,
		runGeminiSearch: overrides.runGeminiSearch ?? defaultSearchRuntimeDeps.runGeminiSearch,
		events: overrides.events ?? defaultSearchRuntimeDeps.events,
		generateCorrelationId: overrides.generateCorrelationId ?? defaultSearchRuntimeDeps.generateCorrelationId,
	};
}

function eventContext(options: SearchRuntimeOptions, deps: SearchRuntimeDeps): {
	readonly correlationId: string;
	readonly sessionId?: string;
} {
	return {
		correlationId: options.correlationId ?? deps.generateCorrelationId(),
		sessionId: options.sessionId,
	};
}

function toSearchRuntimeResponse(
	result: SearchSuccess,
	providerUsed: "kagi" | "gemini",
	correlationId: string,
): SearchRuntimeResponse {
	return {
		...result,
		providerUsed,
		correlationId,
	};
}

const emitSearchEvent = Effect.fn("SearchRuntime.emitSearchEvent")(function* (
	deps: SearchRuntimeDeps,
	options: SearchRuntimeOptions,
	name:
		| "SearchRequested"
		| "ProviderSelected"
		| "ProviderAttempted"
		| "ProviderFailed"
		| "ProviderSucceeded"
		| "FallbackAttempted"
		| "ToolCompleted",
	payload: Record<string, unknown>,
) {
	const context = eventContext(options, deps);
	yield* deps.events.emit(name, payload, context.correlationId, context.sessionId);
});

const runProviderAttempt = Effect.fn("SearchRuntime.runProviderAttempt")(function* (
	deps: SearchRuntimeDeps,
	provider: "kagi" | "gemini",
	query: string,
	options: SearchRuntimeOptions,
) {
	yield* emitSearchEvent(deps, options, "ProviderAttempted", {
		provider,
		query,
	});

	const runProvider = provider === "kagi" ? deps.runKagiSearch : deps.runGeminiSearch;
	const outcome = yield* Effect.either(runProvider(query, options).pipe(Effect.retry(SEARCH_RETRY_POLICY)));

	if (Either.isRight(outcome)) {
		yield* emitSearchEvent(deps, options, "ProviderSucceeded", {
			provider,
			resultCount: outcome.right.results.length,
		});
	} else {
		yield* emitSearchEvent(deps, options, "ProviderFailed", {
			provider,
			reason: outcome.left.reason,
		});
	}

	return outcome;
});

export const searchWithFallbackEffect = Effect.fn("SearchRuntime.searchWithFallback")(function* (
	query: string,
	options: SearchRuntimeOptions = {},
	overrides: Partial<SearchRuntimeDeps> = {},
) {
	const deps = resolveDeps(overrides);
	const trimmedQuery = query.trim();
	const context = eventContext(options, deps);
	const provider = options.provider ?? "auto";

	yield* emitSearchEvent(deps, { ...options, correlationId: context.correlationId }, "SearchRequested", {
		query: trimmedQuery,
		provider,
		numResults: options.numResults ?? null,
		recencyFilter: options.recencyFilter ?? null,
		domainFilter: options.domainFilter ?? [],
		lens: options.lens ?? null,
	});

	if (provider === "kagi") {
		yield* emitSearchEvent(deps, { ...options, correlationId: context.correlationId }, "ProviderSelected", {
			provider: "kagi",
			mode: "explicit",
		});

		const kagiOutcome = yield* runProviderAttempt(
			deps,
			"kagi",
			trimmedQuery,
			{
				...options,
				correlationId: context.correlationId,
			},
		);

		if (Either.isRight(kagiOutcome)) {
			yield* emitSearchEvent(
				deps,
				{ ...options, correlationId: context.correlationId },
				"ToolCompleted",
				{
					status: "success",
					provider: "kagi",
					resultCount: kagiOutcome.right.results.length,
				},
			);
			return toSearchRuntimeResponse(kagiOutcome.right, "kagi", context.correlationId);
		}

		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "failed",
				provider: "kagi",
				reason: kagiOutcome.left.reason,
			},
		);
		return yield* kagiOutcome.left;
	}

	if (provider === "gemini") {
		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ProviderSelected",
			{
				provider: "gemini",
				mode: "explicit",
			},
		);

		const geminiOutcome = yield* runProviderAttempt(
			deps,
			"gemini",
			trimmedQuery,
			{
				...options,
				correlationId: context.correlationId,
			},
		);

		if (Either.isRight(geminiOutcome)) {
			yield* emitSearchEvent(
				deps,
				{ ...options, correlationId: context.correlationId },
				"ToolCompleted",
				{
					status: "success",
					provider: "gemini",
					resultCount: geminiOutcome.right.results.length,
				},
			);
			return toSearchRuntimeResponse(geminiOutcome.right, "gemini", context.correlationId);
		}

		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "failed",
				provider: "gemini",
				reason: geminiOutcome.left.reason,
			},
		);
		return yield* geminiOutcome.left;
	}

	yield* emitSearchEvent(deps, { ...options, correlationId: context.correlationId }, "ProviderSelected", {
		provider: "kagi",
		mode: "auto-primary",
	});

	const kagiOutcome = yield* runProviderAttempt(
		deps,
		"kagi",
		trimmedQuery,
		{
			...options,
			correlationId: context.correlationId,
		},
	);
	if (Either.isRight(kagiOutcome)) {
		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "success",
				provider: "kagi",
				resultCount: kagiOutcome.right.results.length,
			},
		);
		return toSearchRuntimeResponse(kagiOutcome.right, "kagi", context.correlationId);
	}

	yield* emitSearchEvent(
		deps,
		{ ...options, correlationId: context.correlationId },
		"FallbackAttempted",
		{
			fromProvider: "kagi",
			toProvider: "gemini",
			reason: kagiOutcome.left.reason,
		},
	);
	yield* emitSearchEvent(deps, { ...options, correlationId: context.correlationId }, "ProviderSelected", {
		provider: "gemini",
		mode: "auto-fallback",
	});

	const geminiOutcome = yield* runProviderAttempt(
		deps,
		"gemini",
		trimmedQuery,
		{
			...options,
			correlationId: context.correlationId,
		},
	);
	if (Either.isRight(geminiOutcome)) {
		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "success",
				provider: "gemini",
				resultCount: geminiOutcome.right.results.length,
			},
		);
		return toSearchRuntimeResponse(geminiOutcome.right, "gemini", context.correlationId);
	}

	yield* emitSearchEvent(
		deps,
		{ ...options, correlationId: context.correlationId },
		"ToolCompleted",
		{
			status: "failed",
			primaryProvider: "kagi",
			primaryReason: kagiOutcome.left.reason,
			fallbackProvider: "gemini",
			fallbackReason: geminiOutcome.left.reason,
		},
	);
	return yield* SearchFallbackError.make({
		primaryProvider: "kagi",
		primaryReason: kagiOutcome.left.reason,
		fallbackProvider: "gemini",
		fallbackReason: geminiOutcome.left.reason,
	});
});

export async function searchWithFallback(
	query: string,
	options: SearchRuntimeOptions = {},
	overrides: Partial<SearchRuntimeDeps> = {},
): Promise<SearchRuntimeResponse> {
	return Effect.runPromise(searchWithFallbackEffect(query, options, overrides));
}
