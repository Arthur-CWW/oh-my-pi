import type {
	ExtractedContent as StoredFetchContent,
	ImageData as StoredImageData,
	VideoFrame as StoredVideoFrame,
} from "./fetch-content-contracts.js";

export type { StoredFetchContent, StoredImageData, StoredVideoFrame };

export interface StoredSearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface QueryResultData {
	query: string;
	answer: string;
	results: StoredSearchResult[];
	error: string | null;
}

export interface StoredSearchData {
	id: string;
	type: "search" | "fetch";
	timestamp: number;
	queries?: QueryResultData[];
	urls?: StoredFetchContent[];
}

const storedResults = new Map<string, StoredSearchData>();

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function storeResult(id: string, data: StoredSearchData): void {
	storedResults.set(id, data);
}

export function getResult(id: string): StoredSearchData | null {
	return storedResults.get(id) ?? null;
}

export function getAllResults(): StoredSearchData[] {
	return Array.from(storedResults.values());
}

export function deleteResult(id: string): boolean {
	return storedResults.delete(id);
}

export function clearResults(): void {
	storedResults.clear();
}

export function isValidStoredData(data: unknown): data is StoredSearchData {
	if (!data || typeof data !== "object") return false;
	const candidate = data as Record<string, unknown>;
	if (typeof candidate.id !== "string" || !candidate.id) return false;
	if (candidate.type !== "search" && candidate.type !== "fetch") return false;
	if (typeof candidate.timestamp !== "number") return false;
	if (candidate.type === "search" && !Array.isArray(candidate.queries)) return false;
	if (candidate.type === "fetch" && !Array.isArray(candidate.urls)) return false;
	return true;
}
