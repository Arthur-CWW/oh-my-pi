import { NodeServices } from "@effect/platform-node";
import { Cause, Data, Effect, Exit, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { API_BASE, DEFAULT_MODEL, getApiKey } from "./gemini-api.js";
import {
	isGeminiWebAvailableEffect,
	queryWithCookiesEffect,
	type CookieMap,
	type GeminiWebOptions,
} from "./gemini-web.js";
import {
	GEMINI_CLI_PROVIDER_VALUES,
	RECENCY_FILTER_VALUES,
	decodeGeminiCliProvider,
	decodeRecencyFilter,
	type RecencyFilter,
	type SearchProvider,
} from "./search-contracts.js";

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface SearchResponse {
	answer: string;
	results: SearchResult[];
}

export interface SearchOptions {
	numResults?: number;
	recencyFilter?: RecencyFilter;
	domainFilter?: string[];
	signal?: AbortSignal;
}

export interface FullSearchOptions extends SearchOptions {
	readonly provider?: SearchProvider;
	readonly lens?: string;
}

export interface GeminiSearchDeps {
	readonly resolveConfiguredProvider: () => Effect.Effect<SearchProvider, never>;
	readonly getGeminiApiKey: () => string | null;
	readonly isGeminiWebAvailable: () => Effect.Effect<CookieMap | null, unknown>;
	readonly queryWithCookies: (
		prompt: string,
		cookieMap: CookieMap,
		options?: GeminiWebOptions,
	) => Effect.Effect<string, unknown>;
	readonly fetch: typeof fetch;
}

const defaultDeps: GeminiSearchDeps = {
	resolveConfiguredProvider: () => Effect.succeed("auto"),
	getGeminiApiKey: getApiKey,
	isGeminiWebAvailable: isGeminiWebAvailableEffect,
	queryWithCookies: queryWithCookiesEffect,
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
	"No Gemini search path is available. Either:\n" +
	"  1. Set geminiApiKey in ~/.pi/web-search.json (or GEMINI_API_KEY env var)\n" +
	"  2. Sign into gemini.google.com in Chrome";

export function searchEffect(
	query: string,
	options: FullSearchOptions = {},
	deps: GeminiSearchDeps = defaultDeps,
): Effect.Effect<SearchResponse, SearchUnavailableError> {
	return Effect.gen(function* () {
		const configuredProvider = yield* deps.resolveConfiguredProvider();
		const provider = options.provider ?? configuredProvider;
		if (provider !== "auto" && provider !== "kagi" && provider !== "gemini") {
			return yield* new SearchUnavailableError({ reason: PROVIDER_UNAVAILABLE_MESSAGE });
		}

		const geminiResult =
			(yield* searchWithGeminiApiEffect(query, options, deps)) ??
			(yield* searchWithGeminiWebEffect(query, options, deps));
		if (geminiResult) {
			return geminiResult;
		}

		return yield* new SearchUnavailableError({
			reason: provider === "gemini" ? GEMINI_UNAVAILABLE_MESSAGE : PROVIDER_UNAVAILABLE_MESSAGE,
		});
	});
}

export async function search(
	query: string,
	options: FullSearchOptions = {},
	deps: GeminiSearchDeps = defaultDeps,
): Promise<SearchResponse> {
	const exit = await Effect.runPromiseExit(searchEffect(query, options, deps));
	if (Exit.isSuccess(exit)) {
		return exit.value;
	}
	const failure = Cause.findErrorOption(exit.cause);
	if (Option.isSome(failure)) {
		throw new Error(failure.value.reason);
	}
	throw new Error(String(Cause.squash(exit.cause)));
}

function buildAbortSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function toSearchInternalError(error: unknown): SearchUnavailableError {
	const reason = error instanceof Error ? error.message : String(error);
	return new SearchUnavailableError({ reason });
}

const searchWithGeminiApiCoreEffect = Effect.fn("GeminiSearch.searchWithGeminiApiCore")(function* (
	query: string,
	options: SearchOptions,
	deps: GeminiSearchDeps,
) {
	const apiKey = deps.getGeminiApiKey();
	if (!apiKey) {
		return null;
	}

	const body = {
		contents: [{ parts: [{ text: query }] }],
		tools: [{ google_search: {} }],
	};

	const response = yield* Effect.tryPromise({
		try: () =>
			deps.fetch(`${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: buildAbortSignal(60000, options.signal),
			}),
		catch: toSearchInternalError,
	});

	if (!response.ok) {
		return null;
	}

	const data = yield* Effect.tryPromise({
		try: () => response.json() as Promise<GeminiSearchResponse>,
		catch: toSearchInternalError,
	});
	const answer =
		data.candidates?.[0]?.content?.parts
			?.map((part) => part.text)
			.filter((value): value is string => typeof value === "string" && value.length > 0)
			.join("\n") ?? "";

	const results = yield* resolveGroundingChunksEffect(
		data.candidates?.[0]?.groundingMetadata?.groundingChunks,
		options.signal,
		deps.fetch,
	);

	if (!answer && results.length === 0) {
		return null;
	}
	return { answer, results };
});

function searchWithGeminiApiEffect(
	query: string,
	options: SearchOptions,
	deps: GeminiSearchDeps,
): Effect.Effect<SearchResponse | null> {
	return searchWithGeminiApiCoreEffect(query, options, deps).pipe(
		Effect.catch(() => Effect.succeed(null)),
		Effect.catchDefect(() => Effect.succeed(null)),
	);
}

const searchWithGeminiWebCoreEffect = Effect.fn("GeminiSearch.searchWithGeminiWebCore")(function* (
	query: string,
	options: SearchOptions,
	deps: GeminiSearchDeps,
) {
	const cookies = yield* deps.isGeminiWebAvailable();
	if (!cookies) {
		return null;
	}

	const prompt = buildSearchPrompt(query, options);
	const answer = yield* deps.queryWithCookies(prompt, cookies, {
		model: "gemini-3-flash-preview",
		signal: options.signal,
		timeoutMs: 60000,
	});
	return { answer, results: extractSourceUrls(answer) };
});

function searchWithGeminiWebEffect(
	query: string,
	options: SearchOptions,
	deps: GeminiSearchDeps,
): Effect.Effect<SearchResponse | null> {
	return searchWithGeminiWebCoreEffect(query, options, deps).pipe(
		Effect.catch(() => Effect.succeed(null)),
		Effect.catchDefect(() => Effect.succeed(null)),
	);
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

const resolveGroundingChunksEffect = Effect.fn("GeminiSearch.resolveGroundingChunks")(function* (
	chunks: ReadonlyArray<GroundingChunk> | undefined,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch,
) {
	if (!chunks || chunks.length === 0) {
		return [];
	}

	const results: SearchResult[] = [];
	for (const chunk of chunks) {
		if (!chunk.web) {
			continue;
		}

		const title = chunk.web.title ?? "";
		let url = chunk.web.uri ?? "";
		if (url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
			const resolved = yield* resolveRedirectEffect(url, signal, fetchImpl).pipe(
				Effect.catch(() => Effect.succeed(null)),
				Effect.catchDefect(() => Effect.succeed(null)),
			);
			if (resolved) {
				url = resolved;
			}
		}
		if (url) {
			results.push({ title, url, snippet: "" });
		}
	}
	return results;
});

const resolveRedirectEffect = Effect.fn("GeminiSearch.resolveRedirect")(function* (
	proxyUrl: string,
	signal: AbortSignal | undefined,
	fetchImpl: typeof fetch,
) {
	const response = yield* Effect.tryPromise({
		try: () =>
			fetchImpl(proxyUrl, {
				method: "HEAD",
				redirect: "manual",
				signal: buildAbortSignal(5000, signal),
			}),
		catch: toSearchInternalError,
	});
	return response.headers.get("location") ?? null;
});

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

interface SearchCliArgs {
	readonly query: string;
	readonly options: FullSearchOptions;
	readonly json: boolean;
}

export interface SearchCliDeps {
	readonly executeSearch?: typeof search;
	readonly stdout?: (text: string) => void;
	readonly stderr?: (text: string) => void;
}

const SEARCH_CLI_USAGE = `Usage: bun scripts/gemini-search-cli.ts [options] [query]

Options:
  -q, --query <text>             Search query
      --provider <gemini>
      --num-results <1-20>
      --recency-filter <day|week|month|year>
      --domain <host>            Repeatable. Prefix with '-' to exclude.
      --json                     Print JSON output
  -h, --help                     Show this help
`;

function formatSearchCliOutput(response: SearchResponse): string {
	const lines: string[] = [];
	if (response.answer.trim().length > 0) {
		lines.push(response.answer.trim());
	}
	if (response.results.length > 0) {
		lines.push("", "Sources:");
		for (const [index, result] of response.results.entries()) {
			lines.push(`${index + 1}. ${result.title}`, `   ${result.url}`);
		}
	}
	return lines.join("\n");
}

class SearchCliParseError extends Data.TaggedError("SearchCliParseError")<{
	readonly reason: string;
}> {}

function normalizeDomainFilters(rawDomains: ReadonlyArray<string>): ReadonlyArray<string> {
	return rawDomains
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function makeSearchCliParserCommand() {
	let parsed: SearchCliArgs | null = null;

	const queryOption = Flag.optional(Flag.string("query").pipe(Flag.withAlias("q")));
	const queryArg = Argument.optional(Argument.string("query"));
	const provider = Flag.optional(Flag.choice("provider", GEMINI_CLI_PROVIDER_VALUES));
	const numResults = Flag.optional(
		Flag.integer("num-results").pipe(
			Flag.filter(
				(value) => Number.isInteger(value) && value >= 1 && value <= 20,
				() => "--num-results must be an integer from 1 to 20",
			),
		),
	);
	const recencyFilter = Flag.optional(
		Flag.choice("recency-filter", RECENCY_FILTER_VALUES).pipe(Flag.withAlias("recency")),
	);
	const domain = Flag.string("domain").pipe(Flag.between(0, 100));
	const json = Flag.boolean("json");

	const command = Command.make(
		"gemini-search",
		{ queryOption, queryArg, provider, numResults, recencyFilter, domain, json },
		Effect.fn(function* (input) {
			const query =
				(Option.getOrUndefined(input.queryOption) ?? Option.getOrUndefined(input.queryArg) ?? "").trim();
			if (!query) {
				return yield* new SearchCliParseError({ reason: "Missing search query" });
			}

			parsed = {
				query,
				options: {
					...(Option.isSome(input.provider) ? { provider: input.provider.value } : {}),
					...(Option.isSome(input.numResults) ? { numResults: input.numResults.value } : {}),
					...(Option.isSome(input.recencyFilter) ? { recencyFilter: input.recencyFilter.value } : {}),
					...(input.domain.length > 0
						? { domainFilter: [...normalizeDomainFilters(input.domain)] }
						: {}),
				},
				json: input.json,
			};
		}),
	);

	return {
		command,
		readParsed: () => parsed,
	};
}

export async function runSearchCli(
	argv: readonly string[],
	deps: SearchCliDeps = {},
): Promise<number> {
	const stdout = deps.stdout ?? ((text: string) => console.log(text));
	const stderr = deps.stderr ?? ((text: string) => console.error(text));
	if (argv.includes("--help") || argv.includes("-h")) {
		stdout(SEARCH_CLI_USAGE.trimEnd());
		return 0;
	}

	const parser = makeSearchCliParserCommand();
	const runCommand = Command.runWith(parser.command, {
		version: "0.0.0",
	});

	const parseExit = await Effect.runPromiseExit(
		runCommand(argv).pipe(Effect.provide(NodeServices.layer)),
	);
	if (Exit.isFailure(parseExit)) {
		const failure = Cause.findErrorOption(parseExit.cause);
		const reason =
			Option.isSome(failure) && failure.value instanceof SearchCliParseError
				? failure.value.reason
				: String(Cause.squash(parseExit.cause));
		stderr(`Error: ${reason}`);
		stderr(SEARCH_CLI_USAGE.trimEnd());
		return 1;
	}

	const parsed = parser.readParsed();
	if (!parsed) {
		stderr("Error: Search command failed");
		return 1;
	}

	const executeSearch = deps.executeSearch ?? search;
	try {
		const response = await executeSearch(parsed.query, parsed.options);
		if (parsed.json) {
			stdout(
				JSON.stringify(
					{
						query: parsed.query,
						options: parsed.options,
						response,
					},
					null,
					2,
				),
			);
			return 0;
		}
		stdout(formatSearchCliOutput(response));
		return 0;
	} catch (error) {
		stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

function isBunDirectRun(fileStem: string): boolean {
	if (typeof Bun === "undefined") return false;
	const scriptPath = Bun.argv[1];
	if (!scriptPath) return false;
	return (
		scriptPath.endsWith(`/${fileStem}.ts`) ||
		scriptPath.endsWith(`\\${fileStem}.ts`) ||
		scriptPath.endsWith(`/${fileStem}.js`) ||
		scriptPath.endsWith(`\\${fileStem}.js`)
	);
}

if (isBunDirectRun("gemini-search")) {
	void runSearchCli(process.argv.slice(2)).then((exitCode) => {
		process.exitCode = exitCode;
	});
}
