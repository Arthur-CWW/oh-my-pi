import { randomUUID } from "node:crypto";
import { Data, Effect, Result, Schedule } from "effect";
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

export class SearchProviderError extends Data.TaggedError("SearchProviderError")<{
	readonly provider: "kagi" | "gemini";
	readonly reason: string;
}> {}

export class SearchFallbackError extends Data.TaggedError("SearchFallbackError")<{
	readonly primaryProvider: "kagi";
	readonly primaryReason: string;
	readonly fallbackProvider: "gemini";
	readonly fallbackReason: string;
}> {}

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
			new SearchProviderError({
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
			new SearchProviderError({
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
	const outcome = yield* Effect.result(runProvider(query, options).pipe(Effect.retry(SEARCH_RETRY_POLICY)));

	if (Result.isSuccess(outcome)) {
		yield* emitSearchEvent(deps, options, "ProviderSucceeded", {
			provider,
			resultCount: outcome.success.results.length,
		});
	} else {
		yield* emitSearchEvent(deps, options, "ProviderFailed", {
			provider,
			reason: outcome.failure.reason,
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

		if (Result.isSuccess(kagiOutcome)) {
			yield* emitSearchEvent(
				deps,
				{ ...options, correlationId: context.correlationId },
				"ToolCompleted",
				{
					status: "success",
					provider: "kagi",
					resultCount: kagiOutcome.success.results.length,
				},
			);
			return toSearchRuntimeResponse(kagiOutcome.success, "kagi", context.correlationId);
		}

		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "failed",
				provider: "kagi",
				reason: kagiOutcome.failure.reason,
			},
		);
		return yield* kagiOutcome.failure;
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

		if (Result.isSuccess(geminiOutcome)) {
			yield* emitSearchEvent(
				deps,
				{ ...options, correlationId: context.correlationId },
				"ToolCompleted",
				{
					status: "success",
					provider: "gemini",
					resultCount: geminiOutcome.success.results.length,
				},
			);
			return toSearchRuntimeResponse(geminiOutcome.success, "gemini", context.correlationId);
		}

		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "failed",
				provider: "gemini",
				reason: geminiOutcome.failure.reason,
			},
		);
		return yield* geminiOutcome.failure;
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
	if (Result.isSuccess(kagiOutcome)) {
		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "success",
				provider: "kagi",
				resultCount: kagiOutcome.success.results.length,
			},
		);
		return toSearchRuntimeResponse(kagiOutcome.success, "kagi", context.correlationId);
	}

	yield* emitSearchEvent(
		deps,
		{ ...options, correlationId: context.correlationId },
		"FallbackAttempted",
		{
			fromProvider: "kagi",
			toProvider: "gemini",
			reason: kagiOutcome.failure.reason,
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
	if (Result.isSuccess(geminiOutcome)) {
		yield* emitSearchEvent(
			deps,
			{ ...options, correlationId: context.correlationId },
			"ToolCompleted",
			{
				status: "success",
				provider: "gemini",
				resultCount: geminiOutcome.success.results.length,
			},
		);
		return toSearchRuntimeResponse(geminiOutcome.success, "gemini", context.correlationId);
	}

	yield* emitSearchEvent(
		deps,
		{ ...options, correlationId: context.correlationId },
		"ToolCompleted",
		{
			status: "failed",
			primaryProvider: "kagi",
			primaryReason: kagiOutcome.failure.reason,
			fallbackProvider: "gemini",
			fallbackReason: geminiOutcome.failure.reason,
		},
	);
	return yield* new SearchFallbackError({
		primaryProvider: "kagi",
		primaryReason: kagiOutcome.failure.reason,
		fallbackProvider: "gemini",
		fallbackReason: geminiOutcome.failure.reason,
	});
});

export async function searchWithFallback(
	query: string,
	options: SearchRuntimeOptions = {},
	overrides: Partial<SearchRuntimeDeps> = {},
): Promise<SearchRuntimeResponse> {
	return Effect.runPromise(searchWithFallbackEffect(query, options, overrides));
}
