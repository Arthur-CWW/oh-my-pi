/**
 * Kagi Web Search Provider
 *
 * Browser/account-session search first; Kagi API key search remains as fallback.
 */
import type { AuthStorage, FetchImpl } from "@oh-my-pi/pi-ai";
import type { SearchResponse } from "../../../web/search/types";
import { SearchProviderError } from "../../../web/search/types";
import { hasAvailableKagiBrowserSession, KagiApiError, searchWithKagi } from "../../kagi";
import { clampNumResults } from "../utils";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";
import { classifyProviderHttpError, toSearchSources } from "./utils";

type SearchParamsWithFetch = SearchParams & { fetch?: FetchImpl };

const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 40;

type BrowserSessionAvailability = () => boolean | Promise<boolean>;

/** Execute Kagi web search. */
export async function searchKagi(params: {
	query: string;
	num_results?: number;
	recency?: SearchParams["recency"];
	signal?: AbortSignal;
	authStorage: AuthStorage;
	sessionId?: string;
	fetch?: FetchImpl;
	browserSession?: boolean;
}): Promise<SearchResponse> {
	const numResults = clampNumResults(params.num_results, DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS);

	try {
		const result = await searchWithKagi(
			params.query,
			{
				limit: numResults,
				recency: params.recency,
				sessionId: params.sessionId,
				signal: params.signal,
				fetch: params.fetch,
				browserSession: params.browserSession,
			},
			params.authStorage,
		);

		return {
			provider: "kagi",
			sources: toSearchSources(result.sources, numResults),
			relatedQuestions: result.relatedQuestions.length > 0 ? result.relatedQuestions : undefined,
			requestId: result.requestId,
			answer: result.answer,
		};
	} catch (err) {
		if (err instanceof KagiApiError) {
			if (typeof err.statusCode === "number") {
				const classified = classifyProviderHttpError("kagi", err.statusCode, err.message);
				if (classified) throw classified;
			}
			throw new SearchProviderError("kagi", err.message, err.statusCode);
		}
		throw err;
	}
}

/** Search provider for Kagi web search. */
export class KagiProvider extends SearchProvider {
	readonly id = "kagi";
	readonly label = "Kagi";

	readonly #browserSessionAvailable: BrowserSessionAvailability;

	constructor(browserSessionAvailable: BrowserSessionAvailability = hasAvailableKagiBrowserSession) {
		super();
		this.#browserSessionAvailable = browserSessionAvailable;
	}

	async isAvailable(authStorage: AuthStorage): Promise<boolean> {
		return authStorage.hasAuth("kagi") || (await this.#browserSessionAvailable());
	}

	search(params: SearchParamsWithFetch): Promise<SearchResponse> {
		const fetchImpl = params.fetch;

		return searchKagi({
			query: params.query,
			num_results: params.numSearchResults ?? params.limit,
			recency: params.recency,
			signal: params.signal,
			authStorage: params.authStorage,
			sessionId: params.sessionId,
			fetch: fetchImpl,
		});
	}
}
