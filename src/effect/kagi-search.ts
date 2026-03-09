import { Effect, Schema } from "effect";
import {
	SimpleRateLimiter,
	runSocketSearchWithAutoRefresh,
	type KagiSearchOptions as ClientKagiSearchOptions,
	type KagiSearchResult as ClientKagiSearchResult,
} from "../../packages/kagi/src/kagi-client.js";
import {
	applyDomainFilterToQuery,
	mergeDomainFilters,
	parseGoogleStyleQuery,
	type StructuredKagiSearchQuery,
} from "../../packages/kagi/src/kagi-query-parser.js";

type KagiSearchOptions = Pick<
	ClientKagiSearchOptions,
	"query" | "lens" | "dateRange" | "fromDate" | "toDate" | "maxResponseBytes"
>;
type KagiSearchResult = ClientKagiSearchResult;

const DEFAULT_RATE_LIMITER = new SimpleRateLimiter({ minIntervalMs: 1000, jitterMs: 500 });

async function runDefaultKagiSearch(options: KagiSearchOptions): Promise<KagiSearchResult> {
	return runSocketSearchWithAutoRefresh(options, {
		rateLimiter: DEFAULT_RATE_LIMITER,
		discoverLenses: true,
	});
}

export class KagiSearchError extends Schema.TaggedError<KagiSearchError>()(
	"KagiSearchError",
	{
		reason: Schema.String,
		status: Schema.optional(Schema.Number),
	},
) {}

export interface KagiSearchDeps {
	readonly runSearch: (options: KagiSearchOptions) => Promise<KagiSearchResult>;
}

const defaultDeps: KagiSearchDeps = {
	runSearch: runDefaultKagiSearch,
};

export interface SearchSuccess {
	readonly answer: string;
	readonly results: ReadonlyArray<{
		readonly title: string;
		readonly url: string;
		readonly snippet: string;
		readonly publishedAt?: string;
	}>;
	readonly queryDiagnostics?: {
		readonly unsupportedOperators: ReadonlyArray<string>;
		readonly unmappedDateOperators: ReadonlyArray<string>;
		readonly normalizedQuery: string;
		readonly domainFilter: ReadonlyArray<string>;
		readonly fromDate?: string;
		readonly toDate?: string;
	};
}

export interface KagiSearchEffectOptions {
	readonly lens?: string;
	readonly recencyFilter?: "day" | "week" | "month" | "year";
	readonly domainFilter?: ReadonlyArray<string>;
}

export type ParsedGoogleStyleQuery = StructuredKagiSearchQuery;

function mapRecencyFilterToDateRange(value: KagiSearchEffectOptions["recencyFilter"]): 1 | 2 | 3 | 4 | undefined {
	switch (value) {
		case "day":
			return 1;
		case "week":
			return 2;
		case "month":
			return 3;
		case "year":
			return 4;
		default:
			return undefined;
	}
}

interface TaggedPayloadRecord {
	readonly tag: string;
	readonly payload: unknown;
}

function toTaggedPayloadRecords(dataJson: unknown): ReadonlyArray<TaggedPayloadRecord> {
	if (Array.isArray(dataJson)) {
		return dataJson
			.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
			.map((entry) => ({
				tag: typeof entry.tag === "string" ? entry.tag : "",
				payload: entry.payload,
			}))
			.filter((entry) => entry.tag.length > 0);
	}
	if (dataJson && typeof dataJson === "object") {
		const data = dataJson as Record<string, unknown>;
		if (typeof data.tag === "string") {
			return [{ tag: data.tag, payload: data.payload }];
		}
	}
	return [];
}

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function stripHtml(input: string): string {
	const stripped = input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
	return decodeHtmlEntities(stripped).replace(/\s+([.,;:!?])/g, "$1");
}

function extractResultsFromSearchPayload(payload: unknown): Array<{
	title: string;
	url: string;
	snippet: string;
	publishedAt?: string;
}> {
	let html = "";
	if (typeof payload === "string") {
		html = payload;
		try {
			const parsed = JSON.parse(payload) as { content?: unknown };
			if (typeof parsed.content === "string") {
				html = parsed.content;
			}
		} catch {
			// Keep payload as-is when JSON parsing fails.
		}
	} else if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		if (typeof record.content === "string") {
			html = record.content;
		}
	}

	if (!html) {
		return [];
	}

	const titleRegex = /<a[^>]*class="[^"]*__sri_title_link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
	const descRegex = /<div class="_0_DESC __sri-desc">([\s\S]*?)<\/div>/g;
	const timeRegex = /<span class="__sri-time[^"]*">([\s\S]*?)<\/span>/g;
	const descList = Array.from(html.matchAll(descRegex)).map((match) => stripHtml(match[1] ?? ""));
	const publishedAtList = Array.from(html.matchAll(timeRegex)).map((match) => stripHtml(match[1] ?? ""));

	const results: Array<{ title: string; url: string; snippet: string; publishedAt?: string }> = [];
	let index = 0;
	for (const match of html.matchAll(titleRegex)) {
		const url = decodeHtmlEntities((match[1] ?? "").trim());
		const title = stripHtml(match[2] ?? "");
		if (!url || !title) {
			continue;
		}
		const publishedAt = (publishedAtList[index] ?? "").trim();
		results.push({
			title,
			url,
			snippet: descList[index] ?? "",
			...(publishedAt.length > 0 ? { publishedAt } : {}),
		});
		index += 1;
	}

	return results;
}

function extractAnswerFromEvents(result: KagiSearchResult): string {
	for (const event of result.parsedEvents) {
		const taggedRecords = toTaggedPayloadRecords(event.dataJson);
		for (const record of taggedRecords) {
			if (typeof record.payload !== "string") {
				continue;
			}
			if (record.tag === "top-content-unique" || record.tag === "top_content") {
				const cleaned = stripHtml(record.payload);
				if (cleaned.length > 0) {
					return cleaned;
				}
			}
			if (record.tag === "error") {
				const cleaned = stripHtml(record.payload);
				if (cleaned.length > 0) {
					return cleaned;
				}
			}
		}

		if (event.dataJson && typeof event.dataJson === "object" && !Array.isArray(event.dataJson)) {
			const data = event.dataJson as Record<string, unknown>;
			if (typeof data.top_content === "string" && data.top_content.length > 0) {
				return data.top_content;
			}
			if (typeof data.content === "string" && data.content.length > 0) {
				return data.content;
			}
			if (typeof data.answer === "string" && data.answer.length > 0) {
				return data.answer;
			}
			if (Array.isArray(data.results) && data.results.length > 0) {
				const first = data.results[0];
				if (first && typeof first === "object") {
					const firstRecord = first as Record<string, unknown>;
					if (typeof firstRecord.content === "string" && firstRecord.content.length > 0) {
						return firstRecord.content;
					}
				}
			}
		}
	}

	return result.rawSse.slice(0, 5000);
}

function extractResultsFromEvents(result: KagiSearchResult): Array<{
	title: string;
	url: string;
	snippet: string;
	publishedAt?: string;
}> {
	const results: Array<{ title: string; url: string; snippet: string; publishedAt?: string }> = [];
	const seenUrls = new Set<string>();

	for (const event of result.parsedEvents) {
		const taggedRecords = toTaggedPayloadRecords(event.dataJson);
		for (const record of taggedRecords) {
			if (record.tag !== "search") {
				continue;
			}
			for (const item of extractResultsFromSearchPayload(record.payload)) {
				if (seenUrls.has(item.url)) {
					continue;
				}
				seenUrls.add(item.url);
				results.push(item);
			}
		}

		if (event.dataJson && typeof event.dataJson === "object" && !Array.isArray(event.dataJson)) {
			const data = event.dataJson as Record<string, unknown>;
			const resultList = data.results ?? data.items ?? data.search_results;
			if (Array.isArray(resultList)) {
				for (const item of resultList) {
					if (!item || typeof item !== "object") {
						continue;
					}
					const entry = item as Record<string, unknown>;
					const title = String(entry.title ?? entry.name ?? "");
					const url = String(entry.url ?? entry.link ?? entry.href ?? "");
					const snippet = String(entry.snippet ?? entry.description ?? entry.content ?? "");
					const publishedAt = String(
						entry.publishedAt ?? entry.published_at ?? entry.updatedAt ?? entry.updated_at ?? entry.date ?? "",
					).trim();
					if (title.length > 0 && url.length > 0 && !seenUrls.has(url)) {
						seenUrls.add(url);
						results.push({
							title,
							url,
							snippet,
							...(publishedAt.length > 0 ? { publishedAt } : {}),
						});
					}
				}
			}
			if (data.title && data.url) {
				const url = String(data.url);
				if (!seenUrls.has(url)) {
					seenUrls.add(url);
					const publishedAt = String(
						data.publishedAt ?? data.published_at ?? data.updatedAt ?? data.updated_at ?? data.date ?? "",
					).trim();
					results.push({
						title: String(data.title),
						url,
						snippet: String(data.snippet ?? data.description ?? ""),
						...(publishedAt.length > 0 ? { publishedAt } : {}),
					});
				}
			}
		}
	}

	return results;
}

export function kagiSearchEffect(
	query: string,
	deps: KagiSearchDeps = defaultDeps,
	options: KagiSearchEffectOptions = {},
): Effect.Effect<SearchSuccess, KagiSearchError> {
	return Effect.gen(function* () {
		const parsedQuery = parseGoogleStyleQuery(query);
		const mergedDomainFilter = mergeDomainFilters(options.domainFilter, parsedQuery.domainFilter);
		const queryWithInlineFilters =
			parsedQuery.normalizedQuery.length > 0 ? parsedQuery.normalizedQuery : parsedQuery.baseQuery;
		const preparedQuery = applyDomainFilterToQuery(queryWithInlineFilters, mergedDomainFilter);
		const effectiveQuery = preparedQuery.length > 0 ? preparedQuery : query.trim();
		const hasExplicitDateBounds = Boolean(parsedQuery.fromDate || parsedQuery.toDate);
		const result = yield* Effect.tryPromise({
			try: () =>
				deps.runSearch({
					query: effectiveQuery,
					lens: options.lens,
					dateRange: hasExplicitDateBounds ? undefined : mapRecencyFilterToDateRange(options.recencyFilter),
					fromDate: parsedQuery.fromDate,
					toDate: parsedQuery.toDate,
					maxResponseBytes: 2_000_000,
				}),
			catch: (cause) =>
				KagiSearchError.make({
					reason: cause instanceof Error ? cause.message : String(cause),
				}),
		});

		if (!result.ok) {
			return yield* KagiSearchError.make({
				reason: `Kagi search failed with status ${result.status}`,
				status: result.status,
			});
		}

		const answer = extractAnswerFromEvents(result);
		const results = extractResultsFromEvents(result);
		return {
			answer,
			results,
			queryDiagnostics: {
				unsupportedOperators: parsedQuery.unsupportedOperators,
				unmappedDateOperators: parsedQuery.unmappedDateOperators,
				normalizedQuery: queryWithInlineFilters,
				domainFilter: mergedDomainFilter,
				...(parsedQuery.fromDate ? { fromDate: parsedQuery.fromDate } : {}),
				...(parsedQuery.toDate ? { toDate: parsedQuery.toDate } : {}),
			},
		};
	});
}

interface KagiSearchCliArgs {
	readonly query: string;
	readonly lens?: string;
	readonly json: boolean;
	readonly help: boolean;
}

type KagiSearchCliParseResult =
	| { readonly kind: "ok"; readonly value: KagiSearchCliArgs }
	| { readonly kind: "error"; readonly message: string };

export function parseKagiSearchCliArgs(args: readonly string[]): KagiSearchCliParseResult {
	const queryIdx = args.indexOf("--query");
	const lensIdx = args.indexOf("--lens");
	const json = args.includes("--json");
	const help = args.includes("--help") || args.includes("-h");

	if (help) {
		return {
			kind: "ok",
			value: { query: "", json: false, help: true },
		};
	}

	let query = "";
	if (queryIdx >= 0 && args[queryIdx + 1]) {
		query = args[queryIdx + 1];
	}

	if (!query) {
		const skipIndices = new Set<number>();
		for (let i = 0; i < args.length; i++) {
			if (args[i] === "--lens" || args[i] === "--query") {
				skipIndices.add(i);
				skipIndices.add(i + 1);
			}
			if (args[i] === "--json" || args[i] === "--help" || args[i] === "-h") {
				skipIndices.add(i);
			}
		}
		const positional = args.filter((_, i) => !skipIndices.has(i) && !args[i].startsWith("-"));
		if (positional.length > 0) {
			query = positional.join(" ");
		}
	}

	if (!query.trim()) {
		return {
			kind: "error",
			message: "Missing query. Use: bun src/effect/kagi-search.ts <query> [--lens <lens>] [--json]",
		};
	}

	let lens: string | undefined;
	if (lensIdx >= 0 && args[lensIdx + 1]) {
		lens = args[lensIdx + 1];
	}

	return {
		kind: "ok",
		value: { query, lens, json, help: false },
	};
}

export function printKagiSearchHelp(): void {
	console.log(`Usage: bun src/effect/kagi-search.ts [options] <query>

Options:
  --query <text>    Search query (can also be positional)
  --lens <lens>     Search lens: academic, forums, programming, pdfs, news, small_web
  --json            Output JSON instead of markdown
  -h, --help        Show this help

Environment:
  KAGI_SESSION_PATH   Path to session.json (default: auto-detected; falls back to ~/.pi/pi-web-access/kagi-session.json)
  CHROME_DEBUG_URL    Chrome DevTools URL (default: http://localhost:9222)

Examples:
  bun src/effect/kagi-search.ts "what is Effect TS"
  bun src/effect/kagi-search.ts --lens programming "rust async await"
  bun src/effect/kagi-search.ts "quantum computing" --json

Google-style operator support (mapped to Kagi-compatible filters):
  site:, -site:, before:YYYY-MM-DD, after:YYYY-MM-DD,
  filetype:/ext:, intitle:/allintitle:, inurl:/allinurl:, intext:/allintext:

Quirks:
  - Only full dates (YYYY-MM-DD or YYYY/MM/DD) map to Kagi from_date/to_date.
  - Coarse dates like after:2025 remain inline in the query to preserve behavior.
  - Unsupported operators are passed through and may be ignored by Kagi.
`);
}

export async function runKagiSearchCli(args: readonly string[]): Promise<number> {
	const parsed = parseKagiSearchCliArgs(args);

	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		return 1;
	}

	if (parsed.value.help) {
		printKagiSearchHelp();
		return 0;
	}

	const result = await Effect.runPromiseExit(
		kagiSearchEffect(parsed.value.query, defaultDeps, {
			lens: parsed.value.lens,
		}),
	);

	if (result._tag === "Failure") {
		console.error(`Search failed: ${result.cause._tag}`);
		return 1;
	}

	if (parsed.value.json) {
		console.log(JSON.stringify(result.value, null, 2));
	} else {
		console.log(result.value.answer);
		if (result.value.results.length > 0) {
			console.log("\n---\n");
			console.log("Sources:");
			for (const [i, r] of result.value.results.entries()) {
				console.log(`${i + 1}. ${r.title}\n   ${r.url}`);
			}
		}
	}

	return 0;
}

