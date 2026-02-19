import { Data, Effect } from "effect";
import { API_BASE, DEFAULT_MODEL, getApiKey } from "../old/gemini-api.js";
import { isGeminiWebAvailable, queryWithCookies } from "../old/gemini-web.js";
import {
	isPerplexityAvailable,
	searchWithPerplexity,
	type SearchOptions,
	type SearchResponse,
	type SearchResult,
} from "../old/perplexity.js";

export type SearchProvider = "auto" | "perplexity" | "gemini";

export interface FullSearchOptions extends SearchOptions {
	readonly provider?: SearchProvider;
}

export interface GeminiSearchDeps {
	readonly resolveConfiguredProvider: () => Effect.Effect<SearchProvider, never>;
	readonly isPerplexityAvailable: () => boolean;
	readonly searchWithPerplexity: (
		query: string,
		options: SearchOptions,
	) => Promise<SearchResponse>;
	readonly getGeminiApiKey: () => string | null;
	readonly isGeminiWebAvailable: () => ReturnType<typeof isGeminiWebAvailable>;
	readonly queryWithCookies: typeof queryWithCookies;
	readonly fetch: typeof fetch;
}

const defaultDeps: GeminiSearchDeps = {
	resolveConfiguredProvider: () => Effect.succeed("auto"),
	isPerplexityAvailable,
	searchWithPerplexity,
	getGeminiApiKey: getApiKey,
	isGeminiWebAvailable,
	queryWithCookies,
	fetch,
};

export class SearchUnavailableError extends Data.TaggedError("SearchUnavailableError")<{
	readonly reason: string;
}> {}

const GEMINI_UNAVAILABLE_MESSAGE =
	"Gemini search unavailable. Either:\n" +
	"  1. Set geminiApiKey in ~/.pi/web-search.json (or GEMINI_API_KEY env var)\n" +
	"  2. Sign into gemini.google.com in Chrome";

const PROVIDER_UNAVAILABLE_MESSAGE =
	"No search provider available. Either:\n" +
	"  1. Set perplexityApiKey in ~/.pi/web-search.json (or PERPLEXITY_API_KEY env var)\n" +
	"  2. Set geminiApiKey in ~/.pi/web-search.json (or GEMINI_API_KEY env var)\n" +
	"  3. Sign into gemini.google.com in Chrome";

export function searchEffect(
	query: string,
	options: FullSearchOptions = {},
	deps: GeminiSearchDeps = defaultDeps,
): Effect.Effect<SearchResponse, SearchUnavailableError | Error> {
	return Effect.gen(function* () {
		const configuredProvider = yield* deps.resolveConfiguredProvider();
		const provider = options.provider ?? configuredProvider;

		if (provider === "perplexity") {
			return yield* Effect.tryPromise({
				try: () => deps.searchWithPerplexity(query, options),
				catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
			});
		}

		if (provider === "gemini") {
			const result =
				(yield* searchWithGeminiApiEffect(query, options, deps)) ??
				(yield* searchWithGeminiWebEffect(query, options, deps));
			if (result) return result;
			return yield* Effect.fail(new SearchUnavailableError({ reason: GEMINI_UNAVAILABLE_MESSAGE }));
		}

		if (deps.isPerplexityAvailable()) {
			return yield* Effect.tryPromise({
				try: () => deps.searchWithPerplexity(query, options),
				catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
			});
		}

		const geminiResult =
			(yield* searchWithGeminiApiEffect(query, options, deps)) ??
			(yield* searchWithGeminiWebEffect(query, options, deps));
		if (geminiResult) return geminiResult;

		return yield* Effect.fail(new SearchUnavailableError({ reason: PROVIDER_UNAVAILABLE_MESSAGE }));
	});
}

export async function search(
	query: string,
	options: FullSearchOptions = {},
	deps: GeminiSearchDeps = defaultDeps,
): Promise<SearchResponse> {
	const mapped = Effect.catchTag(searchEffect(query, options, deps), "SearchUnavailableError", (error) =>
		Effect.fail(new Error(error.reason)),
	);
	return Effect.runPromise(
		Effect.catchAll(mapped, (error) =>
			Effect.fail(error instanceof Error ? error : new Error("Search failed")),
		),
	);
}

function buildAbortSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

async function searchWithGeminiApi(
	query: string,
	options: SearchOptions,
	deps: GeminiSearchDeps,
): Promise<SearchResponse | null> {
	const apiKey = deps.getGeminiApiKey();
	if (!apiKey) return null;

	try {
		const body = {
			contents: [{ parts: [{ text: query }] }],
			tools: [{ google_search: {} }],
		};

		const response = await deps.fetch(`${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: buildAbortSignal(60000, options.signal),
		});

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as GeminiSearchResponse;
		const answer =
			data.candidates?.[0]?.content?.parts
				?.map((part) => part.text)
				.filter((value): value is string => typeof value === "string" && value.length > 0)
				.join("\n") ?? "";

		const results = await resolveGroundingChunks(
			data.candidates?.[0]?.groundingMetadata?.groundingChunks,
			options.signal,
			deps.fetch,
		);

		if (!answer && results.length === 0) return null;
		return { answer, results };
	} catch {
		return null;
	}
}

function searchWithGeminiApiEffect(
	query: string,
	options: SearchOptions,
	deps: GeminiSearchDeps,
): Effect.Effect<SearchResponse | null> {
	return Effect.promise(() => searchWithGeminiApi(query, options, deps));
}

function searchWithGeminiWebEffect(
	query: string,
	options: SearchOptions,
	deps: GeminiSearchDeps,
): Effect.Effect<SearchResponse | null> {
	return Effect.promise(async () => {
		try {
			const cookies = await deps.isGeminiWebAvailable();
			if (!cookies) return null;

			const prompt = buildSearchPrompt(query, options);
			const answer = await deps.queryWithCookies(prompt, cookies, {
				model: "gemini-3-flash-preview",
				signal: options.signal,
				timeoutMs: 60000,
			});
			return { answer, results: extractSourceUrls(answer) };
		} catch {
			return null;
		}
	});
}

export function buildSearchPrompt(query: string, options: SearchOptions): string {
	let prompt =
		"Search the web and answer the following question. Include source URLs for your claims.\n" +
		"Format your response as:\n" +
		"1. A direct answer to the question\n" +
		"2. Cited sources as markdown links\n\n" +
		`Question: ${query}`;

	if (options.recencyFilter) {
		const labels: Record<SearchOptions["recencyFilter"], string> = {
			day: "past 24 hours",
			week: "past week",
			month: "past month",
			year: "past year",
		};
		prompt += `\n\nOnly include results from the ${labels[options.recencyFilter]}.`;
	}

	if (options.domainFilter?.length) {
		const includes = options.domainFilter.filter((domain) => !domain.startsWith("-"));
		const excludes = options.domainFilter
			.filter((domain) => domain.startsWith("-"))
			.map((domain) => domain.slice(1));
		if (includes.length > 0) prompt += `\n\nOnly cite sources from: ${includes.join(", ")}`;
		if (excludes.length > 0) prompt += `\n\nDo not cite sources from: ${excludes.join(", ")}`;
	}

	return prompt;
}

export function extractSourceUrls(markdown: string): SearchResult[] {
	const seen = new Set<string>();
	const results: SearchResult[] = [];
	const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
	for (const match of markdown.matchAll(linkRegex)) {
		const title = match[1];
		const url = match[2];
		if (!title || !url || seen.has(url)) continue;
		seen.add(url);
		results.push({ title, url, snippet: "" });
	}
	return results;
}

async function resolveGroundingChunks(
	chunks: ReadonlyArray<GroundingChunk> | undefined,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch,
): Promise<SearchResult[]> {
	if (!chunks || chunks.length === 0) return [];

	const results: SearchResult[] = [];
	for (const chunk of chunks) {
		if (!chunk.web) continue;

		const title = chunk.web.title ?? "";
		let url = chunk.web.uri ?? "";
		if (url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
			const resolved = await resolveRedirect(url, signal, fetchImpl);
			if (resolved) url = resolved;
		}
		if (url) results.push({ title, url, snippet: "" });
	}
	return results;
}

async function resolveRedirect(
	proxyUrl: string,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch,
): Promise<string | null> {
	try {
		const response = await fetchImpl(proxyUrl, {
			method: "HEAD",
			redirect: "manual",
			signal: buildAbortSignal(5000, signal),
		});
		return response.headers.get("location") ?? null;
	} catch {
		return null;
	}
}

interface GeminiSearchResponse {
	readonly candidates?: ReadonlyArray<{
		readonly content?: {
			readonly parts?: ReadonlyArray<{ readonly text?: string }>;
		};
		readonly groundingMetadata?: {
			readonly groundingChunks?: ReadonlyArray<GroundingChunk>;
		};
	}>;
}

interface GroundingChunk {
	readonly web?: {
		readonly uri?: string;
		readonly title?: string;
	};
}
