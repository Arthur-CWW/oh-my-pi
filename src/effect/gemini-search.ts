import { Args, Command, Options } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
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

export class SearchUnavailableError extends Schema.TaggedError<SearchUnavailableError>()(
	"SearchUnavailableError",
	{
		reason: Schema.String,
	},
) {}

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
			return yield* SearchUnavailableError.make({ reason: PROVIDER_UNAVAILABLE_MESSAGE });
		}

		const geminiResult =
			(yield* searchWithGeminiApiEffect(query, options, deps)) ??
			(yield* searchWithGeminiWebEffect(query, options, deps));
		if (geminiResult) {
			return geminiResult;
		}

		return yield* SearchUnavailableError.make({
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
	if (exit._tag === "Success") {
		return exit.value;
	}
	if (exit.cause._tag === "Fail") {
		throw new Error(exit.cause.error.reason);
	}
	throw new Error("Search failed");
}

function buildAbortSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function toSearchInternalError(error: unknown): SearchUnavailableError {
	const reason = error instanceof Error ? error.message : String(error);
	return SearchUnavailableError.make({ reason });
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
		Effect.catchAll(() => Effect.succeed(null)),
		Effect.catchAllDefect(() => Effect.succeed(null)),
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
		Effect.catchAll(() => Effect.succeed(null)),
		Effect.catchAllDefect(() => Effect.succeed(null)),
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
				Effect.catchAll(() => Effect.succeed(null)),
				Effect.catchAllDefect(() => Effect.succeed(null)),
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
	readonly help: boolean;
}

type SearchCliParseResult =
	| { readonly kind: "ok"; readonly value: SearchCliArgs }
	| { readonly kind: "error"; readonly message: string };

export interface SearchCliDeps {
	readonly executeSearch?: typeof search;
	readonly stdout?: (text: string) => void;
	readonly stderr?: (text: string) => void;
}

const SEARCH_CLI_USAGE = `Usage: bun src/effect/gemini-search.ts [options] [query]

Options:
  -q, --query <text>             Search query
      --provider <gemini>
      --num-results <1-20>
      --recency-filter <day|week|month|year>
      --domain <host>            Repeatable. Prefix with '-' to exclude.
      --json                     Print JSON output
  -h, --help                     Show this help
`;

type SearchCliValueResult =
	| { readonly kind: "ok"; readonly value: string }
	| { readonly kind: "error"; readonly message: string };

function parseCliValue(argv: readonly string[], index: number, flag: string): SearchCliValueResult {
	const value = argv[index + 1];
	if (!value) {
		return { kind: "error", message: `Missing value for ${flag}` };
	}
	return { kind: "ok", value };
}

export function parseSearchCliArgs(argv: readonly string[]): SearchCliParseResult {
	let query: string | null = null;
	let provider: SearchProvider | undefined;
	let numResults: number | undefined;
	let recencyFilter: SearchOptions["recencyFilter"] | undefined;
	const domainFilter: string[] = [];
	let json = false;
	let help = false;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		switch (arg) {
			case "-h":
			case "--help":
				help = true;
				break;
			case "--json":
				json = true;
				break;
			case "-q":
			case "--query": {
				const parsed = parseCliValue(argv, index, arg);
				if (parsed.kind === "error") return parsed;
				query = parsed.value;
				index += 1;
				break;
			}
			case "--provider": {
				const parsed = parseCliValue(argv, index, arg);
				if (parsed.kind === "error") return parsed;
				const decodedProvider = decodeGeminiCliProvider(parsed.value);
				if (!decodedProvider) {
					return {
						kind: "error",
						message: `Invalid provider \"${parsed.value}\"`,
					};
				}
				provider = decodedProvider;
				index += 1;
				break;
			}
			case "--num-results": {
				const parsed = parseCliValue(argv, index, arg);
				if (parsed.kind === "error") return parsed;
				const value = Number(parsed.value);
				if (!Number.isInteger(value) || value < 1 || value > 20) {
					return { kind: "error", message: "--num-results must be an integer from 1 to 20" };
				}
				numResults = value;
				index += 1;
				break;
			}
			case "--recency-filter":
			case "--recency": {
				const parsed = parseCliValue(argv, index, arg);
				if (parsed.kind === "error") return parsed;
				const decodedRecencyFilter = decodeRecencyFilter(parsed.value);
				if (!decodedRecencyFilter) {
					return {
						kind: "error",
						message: `Invalid recency filter \"${parsed.value}\"`,
					};
				}
				recencyFilter = decodedRecencyFilter;
				index += 1;
				break;
			}
			case "--domain": {
				const parsed = parseCliValue(argv, index, arg);
				if (parsed.kind === "error") return parsed;
				domainFilter.push(...parsed.value.split(",").map((item) => item.trim()).filter(Boolean));
				index += 1;
				break;
			}
			default:
				if (arg.startsWith("-")) {
					return { kind: "error", message: `Unknown flag ${arg}` };
				}
				if (query) {
					return { kind: "error", message: `Unexpected positional argument \"${arg}\"` };
				}
				query = arg;
		}
	}

	if (help) {
		return {
			kind: "ok",
			value: {
				query: query ?? "",
				options: {},
				json,
				help: true,
			},
		};
	}

	if (!query) {
		return { kind: "error", message: "Missing search query" };
	}

	const options: FullSearchOptions = {
		...(provider ? { provider } : {}),
		...(numResults !== undefined ? { numResults } : {}),
		...(recencyFilter ? { recencyFilter } : {}),
		...(domainFilter.length > 0 ? { domainFilter } : {}),
	};

	return {
		kind: "ok",
		value: {
			query,
			options,
			json,
			help: false,
		},
	};
}

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

class SearchCliParseError extends Schema.TaggedError<SearchCliParseError>()("SearchCliParseError", {
	reason: Schema.String,
}) {}

function normalizeDomainFilters(rawDomains: ReadonlyArray<string>): ReadonlyArray<string> {
	return rawDomains
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function makeSearchCliParserCommand() {
	let parsed: SearchCliArgs | null = null;

	const queryOption = Options.text("query").pipe(Options.withAlias("q"), Options.optional);
	const queryArg = Args.text({ name: "query" }).pipe(Args.optional);
	const provider = Options.choice("provider", [...GEMINI_CLI_PROVIDER_VALUES]).pipe(Options.optional);
	const numResults = Options.integer("num-results").pipe(Options.optional);
	const recencyFilter = Options.choice("recency-filter", [...RECENCY_FILTER_VALUES]).pipe(Options.optional);
	const domain = Options.text("domain").pipe(Options.repeated);
	const json = Options.boolean("json");

	const command = Command.make(
		"gemini-search",
		{ queryOption, queryArg, provider, numResults, recencyFilter, domain, json },
		(options) =>
			Effect.gen(function* () {
				const query =
					(Option.getOrUndefined(options.queryOption) ?? Option.getOrUndefined(options.queryArg) ?? "").trim();
				if (!query) {
					return yield* SearchCliParseError.make({ reason: "Missing search query" });
				}

				const domainFilter = normalizeDomainFilters(options.domain);
				yield* Effect.sync(() => {
					parsed = {
						query,
						options: {
							...(Option.isSome(options.provider) ? { provider: options.provider.value } : {}),
							...(Option.isSome(options.numResults) ? { numResults: options.numResults.value } : {}),
							...(Option.isSome(options.recencyFilter)
								? { recencyFilter: options.recencyFilter.value }
								: {}),
							...(domainFilter.length > 0 ? { domainFilter: [...domainFilter] } : {}),
						},
						json: options.json,
						help: false,
					};
				});
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
	const cli = Command.run(parser.command, {
		name: "gemini-search",
		version: "0.0.0",
	});

	const parseExit = await Effect.runPromiseExit(
		cli(["node", "gemini-search", ...argv]).pipe(Effect.provide(NodeContext.layer)),
	);
	if (parseExit._tag === "Failure") {
		const fallbackParse = parseSearchCliArgs(argv);
		if (fallbackParse.kind === "error") {
			stderr(`Error: ${fallbackParse.message}`);
			stderr(SEARCH_CLI_USAGE.trimEnd());
			return 1;
		}
		stderr("Error: Search command failed");
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
		const message = error instanceof Error ? error.message : String(error);
		stderr(`Error: ${message}`);
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
