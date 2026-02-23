import { Data, Effect } from "effect";
import { runSocketSearchWithAutoRefresh, type KagiSearchOptions, type KagiSearchResult, SimpleRateLimiter } from "../../packages/kagi/src/kagi-client.js";

export class KagiSearchError extends Data.TaggedError("KagiSearchError")<{
	readonly reason: string;
	readonly status?: number;
}> {}

export interface KagiSearchDeps {
	readonly runSearch: (options: KagiSearchOptions) => Promise<KagiSearchResult>;
}

const DEFAULT_RATE_LIMITER = new SimpleRateLimiter({ minIntervalMs: 1000, jitterMs: 500 });

const defaultDeps: KagiSearchDeps = {
	runSearch: (options) =>
		runSocketSearchWithAutoRefresh(options, {
			rateLimiter: DEFAULT_RATE_LIMITER,
			discoverLenses: true,
		}),
};

export interface SearchSuccess {
	readonly answer: string;
	readonly results: ReadonlyArray<{
		readonly title: string;
		readonly url: string;
		readonly snippet: string;
	}>;
}

function extractAnswerFromEvents(result: KagiSearchResult): string {
	const events = result.parsedEvents;
	
	// Look for search results in the SSE events
	for (const event of events) {
		if (event.dataJson && typeof event.dataJson === "object") {
			const data = event.dataJson as Record<string, unknown>;
			
			// Check for top_content or search result blocks
			if (data.top_content && typeof data.top_content === "string") {
				return data.top_content;
			}
			if (data.content && typeof data.content === "string") {
				return data.content;
			}
			if (data.answer && typeof data.answer === "string") {
				return data.answer;
			}
			
			// Check for array of results
			if (Array.isArray(data.results) && data.results.length > 0) {
				const first = data.results[0] as Record<string, unknown>;
				if (first.content && typeof first.content === "string") {
					return first.content;
				}
			}
		}
	}
	
	// Fallback: return raw SSE for manual inspection
	return result.rawSse.slice(0, 5000);
}

function extractResultsFromEvents(result: KagiSearchResult): Array<{ title: string; url: string; snippet: string }> {
	const events = result.parsedEvents;
	const results: Array<{ title: string; url: string; snippet: string }> = [];
	
	for (const event of events) {
		if (event.dataJson && typeof event.dataJson === "object") {
			const data = event.dataJson as Record<string, unknown>;
			
			// Look for result arrays
			const resultList = data.results ?? data.items ?? data.search_results;
			if (Array.isArray(resultList)) {
				for (const item of resultList) {
					if (item && typeof item === "object") {
						const entry = item as Record<string, unknown>;
						const title = String(entry.title ?? entry.name ?? "");
						const url = String(entry.url ?? entry.link ?? entry.href ?? "");
						const snippet = String(entry.snippet ?? entry.description ?? entry.content ?? "");
						if (title && url) {
							results.push({ title, url, snippet });
						}
					}
				}
			}
			
			// Also check for single result
			if (data.title && data.url) {
				results.push({
					title: String(data.title),
					url: String(data.url),
					snippet: String(data.snippet ?? data.description ?? ""),
				});
			}
		}
	}
	
	return results;
}

export function kagiSearchEffect(
	query: string,
	deps: KagiSearchDeps = defaultDeps,
): Effect.Effect<SearchSuccess, KagiSearchError> {
	return Effect.gen(function* () {
		const result = yield* Effect.tryPromise({
			try: () =>
				deps.runSearch({
					query,
					maxResponseBytes: 2_000_000,
				}),
			catch: (cause) =>
				new KagiSearchError({
					reason: cause instanceof Error ? cause.message : String(cause),
				}),
		});
		
		if (!result.ok) {
			return yield* new KagiSearchError({
				reason: `Kagi search failed with status ${result.status}`,
				status: result.status,
			});
		}
		
		const answer = extractAnswerFromEvents(result);
		const results = extractResultsFromEvents(result);
		
		return { answer, results };
	});
}

// CLI argument parsing for direct run
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

	// Support positional query argument (exclude flags and their values)
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
		return { kind: "error", message: "Missing query. Use: bun src/effect/kagi-search.ts <query> [--lens <lens>] [--json]" };
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
  KAGI_SESSION_PATH   Path to session.json (default: packages/kagi/storage/session.json)
  CHROME_DEBUG_URL    Chrome DevTools URL (default: http://localhost:9222)

Examples:
  bun src/effect/kagi-search.ts "what is Effect TS"
  bun src/effect/kagi-search.ts --lens programming "rust async await"
  bun src/effect/kagi-search.ts "quantum computing" --json
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
	
	const deps: KagiSearchDeps = {
		runSearch: (options) =>
			runSocketSearchWithAutoRefresh(options, {
				rateLimiter: DEFAULT_RATE_LIMITER,
				discoverLenses: true,
			}),
	};
	
	const result = await Effect.runPromiseExit(kagiSearchEffect(parsed.value.query, deps));
	
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

// Direct run support
if (import.meta.main) {
	runKagiSearchCli(process.argv.slice(2)).then((code) => process.exit(code));
}
