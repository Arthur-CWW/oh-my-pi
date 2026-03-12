import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { clearResults, isValidStoredData, storeResult } from "../../../src/shared/stored-results.js";

export {
	clearResults,
	deleteResult,
	generateId,
	getAllResults,
	getResult,
	storeResult,
	type QueryResultData,
	type StoredFetchContent,
	type StoredImageData,
	type StoredSearchData,
	type StoredSearchResult,
	type StoredVideoFrame,
} from "../../../src/shared/stored-results.js";

const CACHE_TTL_MS = 60 * 60 * 1000;

export function restoreFromSession(ctx: ExtensionContext): void {
	clearResults();
	const now = Date.now();

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === "web-search-results") {
			const data = entry.data;
			if (isValidStoredData(data) && now - data.timestamp < CACHE_TTL_MS) {
				storeResult(data.id, data);
			}
		}
	}
}
