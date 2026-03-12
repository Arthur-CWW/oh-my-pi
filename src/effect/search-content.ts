import { Effect, Either, Schema } from "effect";
import { getResult } from "../old/storage.js";

const SearchResultSchema = Schema.Struct({
	title: Schema.String,
	url: Schema.String,
	snippet: Schema.String,
});

const QueryResultDataSchema = Schema.Struct({
	query: Schema.String,
	answer: Schema.String,
	results: Schema.Array(SearchResultSchema),
	error: Schema.Union(Schema.String, Schema.Null),
});

type QueryResultData = typeof QueryResultDataSchema.Type;

const VideoFrameSchema = Schema.Struct({
	data: Schema.String,
	mimeType: Schema.String,
	timestamp: Schema.String,
});

const ImageDataSchema = Schema.Struct({
	data: Schema.String,
	mimeType: Schema.String,
});

const ExtractedContentSchema = Schema.Struct({
	url: Schema.String,
	title: Schema.String,
	content: Schema.String,
	error: Schema.Union(Schema.String, Schema.Null),
	thumbnail: Schema.optional(ImageDataSchema),
	frames: Schema.optional(Schema.Array(VideoFrameSchema)),
	duration: Schema.optional(Schema.Number),
});

type ExtractedContent = typeof ExtractedContentSchema.Type;

const SearchStoredDataSchema = Schema.Struct({
	id: Schema.String,
	type: Schema.Literal("search"),
	timestamp: Schema.Number,
	queries: Schema.Array(QueryResultDataSchema),
});

const FetchStoredDataSchema = Schema.Struct({
	id: Schema.String,
	type: Schema.Literal("fetch"),
	timestamp: Schema.Number,
	urls: Schema.Array(ExtractedContentSchema),
});

const StoredSearchDataSchema = Schema.Union(SearchStoredDataSchema, FetchStoredDataSchema);
type StoredSearchData = typeof StoredSearchDataSchema.Type;

export const GetSearchContentParamsSchema = Schema.Struct({
	responseId: Schema.String,
	query: Schema.optional(Schema.String),
	queryIndex: Schema.optional(Schema.Number),
	url: Schema.optional(Schema.String),
	urlIndex: Schema.optional(Schema.Number),
});

export type GetSearchContentParams = typeof GetSearchContentParamsSchema.Type;

interface TextContent {
	readonly type: "text";
	readonly text: string;
}

interface BaseGetSearchContentResult {
	readonly content: Array<TextContent>;
}

interface NotFoundDetails {
	readonly error: "Not found";
	readonly responseId: string;
}

interface QueryNotFoundDetails {
	readonly error: "Query not found";
}

interface NoQuerySpecifiedDetails {
	readonly error: "No query specified";
}

interface UrlNotFoundDetails {
	readonly error: "URL not found";
}

interface NoUrlSpecifiedDetails {
	readonly error: "No URL specified";
}

interface IndexOutOfRangeDetails {
	readonly error: "Index out of range";
}

interface InvalidDataDetails {
	readonly error: "Invalid data";
}

interface QueryErrorDetails {
	readonly error: string;
	readonly query: string;
}

interface QueryContentDetails {
	readonly query: string;
	readonly resultCount: number;
}

interface UrlErrorDetails {
	readonly error: string;
	readonly url: string;
}

interface UrlContentDetails {
	readonly url: string;
	readonly title: string;
	readonly contentLength: number;
}

export type GetSearchContentToolResult =
	| (BaseGetSearchContentResult & { readonly details: NotFoundDetails })
	| (BaseGetSearchContentResult & { readonly details: QueryNotFoundDetails })
	| (BaseGetSearchContentResult & { readonly details: NoQuerySpecifiedDetails })
	| (BaseGetSearchContentResult & { readonly details: UrlNotFoundDetails })
	| (BaseGetSearchContentResult & { readonly details: NoUrlSpecifiedDetails })
	| (BaseGetSearchContentResult & { readonly details: IndexOutOfRangeDetails })
	| (BaseGetSearchContentResult & { readonly details: InvalidDataDetails })
	| (BaseGetSearchContentResult & { readonly details: QueryErrorDetails })
	| (BaseGetSearchContentResult & { readonly details: QueryContentDetails })
	| (BaseGetSearchContentResult & { readonly details: UrlErrorDetails })
	| (BaseGetSearchContentResult & { readonly details: UrlContentDetails });

function toTextResult<TDetails>(text: string, details: TDetails): BaseGetSearchContentResult & { readonly details: TDetails } {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function decodeStoredSearchData(raw: unknown): StoredSearchData | null {
	const decoded = Schema.decodeUnknownEither(StoredSearchDataSchema)(raw);
	return Either.isRight(decoded) ? decoded.right : null;
}

function formatFullResults(queryData: QueryResultData): string {
	let output = `## Results for: "${queryData.query}"\n\n`;
	if (queryData.answer) {
		output += `${queryData.answer}\n\n---\n\n`;
	}
	for (const result of queryData.results) {
		output += `### ${result.title}\n${result.url}\n\n`;
	}
	return output;
}

function handleSearchData(
	data: Extract<StoredSearchData, { readonly type: "search" }>,
	params: GetSearchContentParams,
): GetSearchContentToolResult {
	let queryData: QueryResultData | undefined;

	if (params.query !== undefined) {
		queryData = data.queries.find((query) => query.query === params.query);
		if (!queryData) {
			const available = data.queries.map((query) => `"${query.query}"`).join(", ");
			return toTextResult(`Query "${params.query}" not found. Available: ${available}`, {
				error: "Query not found",
			});
		}
	} else if (params.queryIndex !== undefined) {
		queryData = data.queries[params.queryIndex];
		if (!queryData) {
			return toTextResult(
				`Index ${params.queryIndex} out of range (0-${data.queries.length - 1})`,
				{ error: "Index out of range" },
			);
		}
	} else {
		const available = data.queries.map((query, index) => `${index}: "${query.query}"`).join(", ");
		return toTextResult(`Specify query or queryIndex. Available: ${available}`, {
			error: "No query specified",
		});
	}

	if (queryData.error) {
		return toTextResult(`Error for "${queryData.query}": ${queryData.error}`, {
			error: queryData.error,
			query: queryData.query,
		});
	}

	return toTextResult(formatFullResults(queryData), {
		query: queryData.query,
		resultCount: queryData.results.length,
	});
}

function handleFetchData(
	data: Extract<StoredSearchData, { readonly type: "fetch" }>,
	params: GetSearchContentParams,
): GetSearchContentToolResult {
	let urlData: ExtractedContent | undefined;

	if (params.url !== undefined) {
		urlData = data.urls.find((entry) => entry.url === params.url);
		if (!urlData) {
			const available = data.urls.map((entry) => entry.url).join("\n  ");
			return toTextResult(`URL not found. Available:\n  ${available}`, {
				error: "URL not found",
			});
		}
	} else if (params.urlIndex !== undefined) {
		urlData = data.urls[params.urlIndex];
		if (!urlData) {
			return toTextResult(`Index ${params.urlIndex} out of range (0-${data.urls.length - 1})`, {
				error: "Index out of range",
			});
		}
	} else {
		const available = data.urls.map((entry, index) => `${index}: ${entry.url}`).join("\n  ");
		return toTextResult(`Specify url or urlIndex. Available:\n  ${available}`, {
			error: "No URL specified",
		});
	}

	if (urlData.error) {
		return toTextResult(`Error for ${urlData.url}: ${urlData.error}`, {
			error: urlData.error,
			url: urlData.url,
		});
	}

	return toTextResult(`# ${urlData.title}\n\n${urlData.content}`, {
		url: urlData.url,
		title: urlData.title,
		contentLength: urlData.content.length,
	});
}

export const executeGetSearchContent = Effect.fn("SearchContent.executeGetSearchContent")(function* (
	params: GetSearchContentParams,
) {
	const rawData = yield* Effect.sync(() => getResult(params.responseId));
	if (!rawData) {
		return toTextResult(`Error: No stored results for "${params.responseId}"`, {
			error: "Not found",
			responseId: params.responseId,
		});
	}

	const data = decodeStoredSearchData(rawData);
	if (!data) {
		return toTextResult("Invalid stored data format", {
			error: "Invalid data",
		});
	}

	if (data.type === "search") {
		return handleSearchData(data, params);
	}

	if (data.type === "fetch") {
		return handleFetchData(data, params);
	}

	return toTextResult("Invalid stored data format", {
		error: "Invalid data",
	});
});
