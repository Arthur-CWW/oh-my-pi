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
      --provider <auto|perplexity|gemini>
      --num-results <1-20>
      --recency-filter <day|week|month|year>
      --domain <host>            Repeatable. Prefix with '-' to exclude.
      --json                     Print JSON output
  -h, --help                     Show this help
`;

const RECENCY_FILTERS = new Set<NonNullable<SearchOptions["recencyFilter"]>>([
	"day",
	"week",
	"month",
	"year",
]);

const SEARCH_PROVIDERS = new Set<SearchProvider>(["auto", "perplexity", "gemini"]);

function isSearchProvider(value: string): value is SearchProvider {
	return SEARCH_PROVIDERS.has(value as SearchProvider);
}

function isRecencyFilter(
	value: string,
): value is NonNullable<SearchOptions["recencyFilter"]> {
	return RECENCY_FILTERS.has(value as NonNullable<SearchOptions["recencyFilter"]>);
}

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
				if (!isSearchProvider(parsed.value)) {
					return {
						kind: "error",
						message: `Invalid provider \"${parsed.value}\"`,
					};
				}
				provider = parsed.value;
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
				if (!isRecencyFilter(parsed.value)) {
					return {
						kind: "error",
						message: `Invalid recency filter \"${parsed.value}\"`,
					};
				}
				recencyFilter = parsed.value;
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

export async function runSearchCli(
	argv: readonly string[],
	deps: SearchCliDeps = {},
): Promise<number> {
	const parsed = parseSearchCliArgs(argv);
	const stdout = deps.stdout ?? ((text: string) => console.log(text));
	const stderr = deps.stderr ?? ((text: string) => console.error(text));
	if (parsed.kind === "error") {
		stderr(`Error: ${parsed.message}`);
		stderr(SEARCH_CLI_USAGE.trimEnd());
		return 1;
	}

	if (parsed.value.help) {
		stdout(SEARCH_CLI_USAGE.trimEnd());
		return 0;
	}

	const executeSearch = deps.executeSearch ?? search;
	try {
		const response = await executeSearch(parsed.value.query, parsed.value.options);
		if (parsed.value.json) {
			stdout(
				JSON.stringify(
					{
						query: parsed.value.query,
						options: parsed.value.options,
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
