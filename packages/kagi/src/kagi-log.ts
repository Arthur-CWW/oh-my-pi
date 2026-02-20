import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { KagiSearchResult } from "./kagi-client.js";

export interface StoredRunRecord {
	runId: string;
	createdAt: string;
	query: string;
	tags: string[];
	status: number;
	requestUrl: string;
	referer: string;
	resultPath: string;
	rawSsePath: string;
	result: KagiSearchResult;
}

export interface RunFilter {
	status?: number;
	queryIncludes?: string;
	tag?: string;
}

export interface RunSummary {
	runId: string;
	createdAt: string;
	query: string;
	status: number;
	tags: string[];
	resultPath: string;
}

export function saveSearchRun(
	searchResult: KagiSearchResult,
	options: {
		query: string;
		outputDir: string;
		prefix?: string;
	},
): StoredRunRecord {
	const outputDir = resolve(options.outputDir);
	mkdirSync(outputDir, { recursive: true });

	const datePrefix = new Date().toISOString().replaceAll(":", "-");
	const runId = `${options.prefix ?? "kagi"}-${datePrefix}-${Math.random().toString(36).slice(2, 8)}`;
	const basePath = join(outputDir, runId);

	const tags = extractTags(searchResult);
	const resultPath = `${basePath}.json`;
	const rawSsePath = `${basePath}.sse.txt`;

	const record: StoredRunRecord = {
		runId,
		createdAt: new Date().toISOString(),
		query: options.query,
		tags,
		status: searchResult.status,
		requestUrl: searchResult.requestUrl,
		referer: searchResult.referer,
		resultPath,
		rawSsePath,
		result: searchResult,
	};

	writeFileSync(rawSsePath, searchResult.rawSse, "utf8");
	writeFileSync(resultPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

	return record;
}

export function listRunFiles(outputDir: string): string[] {
	const root = resolve(outputDir);
	return readdirSync(root)
		.filter((entry) => extname(entry) === ".json")
		.map((entry) => join(root, entry))
		.sort((left, right) => left.localeCompare(right));
}

export function loadRunRecord(filePath: string): StoredRunRecord {
	const raw = readFileSync(resolve(filePath), "utf8");
	return JSON.parse(raw) as StoredRunRecord;
}

export function queryRuns(outputDir: string, filter: RunFilter): RunSummary[] {
	const files = listRunFiles(outputDir);
	const summaries: RunSummary[] = [];

	for (const file of files) {
		const record = loadRunRecord(file);
		if (!isStoredRunRecord(record)) {
			continue;
		}
		if (typeof filter.status === "number" && record.status !== filter.status) {
			continue;
		}
		if (filter.queryIncludes && !record.query.toLowerCase().includes(filter.queryIncludes.toLowerCase())) {
			continue;
		}
		if (filter.tag && !record.tags.includes(filter.tag)) {
			continue;
		}
		summaries.push({
			runId: record.runId,
			createdAt: record.createdAt,
			query: record.query,
			status: record.status,
			tags: record.tags,
			resultPath: record.resultPath,
		});
	}

	return summaries;
}

export function writeJsonSnapshot(filePath: string, payload: unknown): string {
	const outputPath = resolve(filePath);
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	return outputPath;
}

function isStoredRunRecord(value: unknown): value is StoredRunRecord {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Partial<StoredRunRecord>;
	return (
		typeof record.runId === "string" &&
		typeof record.query === "string" &&
		typeof record.status === "number" &&
		Array.isArray(record.tags) &&
		typeof record.resultPath === "string"
	);
}

function extractTags(result: KagiSearchResult): string[] {
	const tagSet = new Set<string>();
	for (const event of result.parsedEvents) {
		const payload = event.dataJson;
		if (!Array.isArray(payload)) {
			continue;
		}
		for (const item of payload) {
			if (!item || typeof item !== "object") {
				continue;
			}
			const maybeTag = (item as { tag?: unknown }).tag;
			if (typeof maybeTag === "string" && maybeTag.length > 0) {
				tagSet.add(maybeTag);
			}
		}
	}
	return [...tagSet].sort((left, right) => left.localeCompare(right));
}
