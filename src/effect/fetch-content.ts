import { Data, Effect, Schema } from "effect";
import { fetchAllContentEffect, type ExtractOptions } from "./fetch-content-runtime.js";
import {
	generateId,
	storeResult,
	type StoredSearchData,
} from "../shared/stored-results.js";
import type { ExtractedContent } from "../shared/fetch-content-contracts.js";

const MAX_INLINE_CONTENT = 30000;

const FramesSchema = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 12 })));

export const FetchContentParamsSchema = Schema.Struct({
	url: Schema.optional(Schema.String),
	urls: Schema.optional(Schema.Array(Schema.String)),
	forceClone: Schema.optional(Schema.Boolean),
	prompt: Schema.optional(Schema.String),
	timestamp: Schema.optional(Schema.String),
	frames: Schema.optional(FramesSchema),
	model: Schema.optional(Schema.String),
});

export type FetchContentParams = typeof FetchContentParamsSchema.Type;

interface FetchContentTextItem {
	readonly type: "text";
	readonly text: string;
}

interface FetchContentImageItem {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
}

export type FetchContentToolContent = FetchContentTextItem | FetchContentImageItem;

interface FetchContentBaseResponse {
	readonly content: Array<FetchContentToolContent>;
}

interface FetchContentValidationDetails {
	readonly error: "No URL provided";
}

interface FetchContentExecutionFailureDetails {
	readonly error: string;
	readonly urls: ReadonlyArray<string>;
	readonly urlCount: number;
	readonly successful: number;
	readonly responseId?: string;
	readonly prompt?: string;
	readonly timestamp?: string;
	readonly frames?: number;
}

interface FetchContentSingleSuccessDetails {
	readonly urls: ReadonlyArray<string>;
	readonly urlCount: 1;
	readonly successful: 1;
	readonly totalChars: number;
	readonly title: string;
	readonly responseId: string;
	readonly truncated: boolean;
	readonly hasImage: boolean;
	readonly imageCount: number;
	readonly prompt?: string;
	readonly timestamp?: string;
	readonly frames?: number;
	readonly duration?: number;
}

interface FetchContentMultiSuccessDetails {
	readonly urls: ReadonlyArray<string>;
	readonly urlCount: number;
	readonly successful: number;
	readonly totalChars: number;
	readonly responseId: string;
}

export type FetchContentToolResponse =
	| (FetchContentBaseResponse & { readonly details: FetchContentValidationDetails })
	| (FetchContentBaseResponse & { readonly details: FetchContentExecutionFailureDetails })
	| (FetchContentBaseResponse & { readonly details: FetchContentSingleSuccessDetails })
	| (FetchContentBaseResponse & { readonly details: FetchContentMultiSuccessDetails });

export class FetchContentExecutionError extends Data.TaggedError("FetchContentExecutionError")<{
	readonly reason: string;
}> {}

export interface FetchContentProgressUpdate {
	readonly content: Array<{ readonly type: "text"; readonly text: string }>;
	readonly details: {
		readonly phase: "fetch";
		readonly progress: number;
	};
}

export interface FetchContentExecutionOptions {
	readonly signal?: AbortSignal;
	readonly onUpdate?: (update: FetchContentProgressUpdate) => void;
	readonly persistToSession?: (data: StoredSearchData) => void;
}

export interface FetchContentDeps {
	readonly fetchContent: (
		urls: ReadonlyArray<string>,
		signal?: AbortSignal,
		options?: ExtractOptions,
	) => Effect.Effect<ReadonlyArray<ExtractedContent>, unknown>;
	readonly generateId: () => string;
	readonly storeResult: (id: string, data: StoredSearchData) => void;
}

const defaultDeps: FetchContentDeps = {
	fetchContent: (urls, signal, options) =>
		fetchAllContentEffect(urls, signal, options).pipe(
			Effect.mapError((cause) =>
				new FetchContentExecutionError({
					reason: toErrorMessage(cause),
				}),
			),
		),
	generateId,
	storeResult,
};

function resolveDeps(deps: Partial<FetchContentDeps> | undefined): FetchContentDeps {
	return {
		...defaultDeps,
		...deps,
	};
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function normalizeUrlList(params: FetchContentParams): ReadonlyArray<string> {
	return params.urls ?? (params.url ? [params.url] : []);
}

function toExtractOptions(params: FetchContentParams): ExtractOptions {
	return {
		forceClone: params.forceClone,
		prompt: params.prompt,
		timestamp: params.timestamp,
		frames: params.frames,
		model: params.model,
	};
}

function stripThumbnails(results: ReadonlyArray<ExtractedContent>): ExtractedContent[] {
	return results.map(({ thumbnail, frames, ...rest }) => rest);
}

function makeStoredFetchData(
	responseId: string,
	fetchResults: ReadonlyArray<ExtractedContent>,
): StoredSearchData {
	return {
		id: responseId,
		type: "fetch",
		timestamp: Date.now(),
		urls: stripThumbnails(fetchResults),
	};
}

function toValidationErrorResponse(
	message: string,
	details: FetchContentValidationDetails,
): FetchContentToolResponse {
	return {
		content: [{ type: "text", text: message }],
		details,
	};
}

function toExecutionFailureResponse(
	message: string,
	details: FetchContentExecutionFailureDetails,
): FetchContentToolResponse {
	return {
		content: [{ type: "text", text: message }],
		details,
	};
}

function buildSingleUrlResponse(
	result: ExtractedContent,
	urlList: ReadonlyArray<string>,
	responseId: string,
	params: FetchContentParams,
): FetchContentToolResponse {
	if (result.error) {
		return toExecutionFailureResponse(`Error: ${result.error}`, {
			error: result.error,
			urls: urlList,
			urlCount: 1,
			successful: 0,
			responseId,
			...(params.prompt ? { prompt: params.prompt } : {}),
			...(params.timestamp ? { timestamp: params.timestamp } : {}),
			...(typeof params.frames === "number" ? { frames: params.frames } : {}),
		});
	}

	const fullLength = result.content.length;
	const truncated = fullLength > MAX_INLINE_CONTENT;
	let output = truncated
		? result.content.slice(0, MAX_INLINE_CONTENT) + "\n\n[Content truncated...]"
		: result.content;

	if (truncated) {
		output +=
			`\n\n---\nShowing ${MAX_INLINE_CONTENT} of ${fullLength} chars. ` +
			`Use get_search_content({ responseId: \"${responseId}\", urlIndex: 0 }) for full content.`;
	}

	const content: Array<FetchContentToolContent> = [];
	if (result.frames?.length) {
		for (const frame of result.frames) {
			content.push({ type: "image", data: frame.data, mimeType: frame.mimeType });
			content.push({ type: "text", text: `Frame at ${frame.timestamp}` });
		}
	} else if (result.thumbnail) {
		content.push({
			type: "image",
			data: result.thumbnail.data,
			mimeType: result.thumbnail.mimeType,
		});
	}
	content.push({ type: "text", text: output });

	const imageCount = (result.frames?.length ?? 0) + (result.thumbnail ? 1 : 0);
	return {
		content,
		details: {
			urls: urlList,
			urlCount: 1,
			successful: 1,
			totalChars: fullLength,
			title: result.title,
			responseId,
			truncated,
			hasImage: imageCount > 0,
			imageCount,
			...(params.prompt ? { prompt: params.prompt } : {}),
			...(params.timestamp ? { timestamp: params.timestamp } : {}),
			...(typeof params.frames === "number" ? { frames: params.frames } : {}),
			...(typeof result.duration === "number" ? { duration: result.duration } : {}),
		},
	};
}

function buildMultiUrlResponse(
	fetchResults: ReadonlyArray<ExtractedContent>,
	urlList: ReadonlyArray<string>,
	responseId: string,
): FetchContentToolResponse {
	const successful = fetchResults.filter((result) => !result.error).length;
	const totalChars = fetchResults.reduce((sum, result) => sum + result.content.length, 0);

	let output = "## Fetched URLs\n\n";
	for (const { url, title, content, error } of fetchResults) {
		if (error) {
			output += `- ${url}: Error - ${error}\n`;
		} else {
			output += `- ${title || url} (${content.length} chars)\n`;
		}
	}
	output += `\n---\nUse get_search_content({ responseId: \"${responseId}\", urlIndex: 0 }) to retrieve full content.`;

	return {
		content: [{ type: "text", text: output }],
		details: { urls: urlList, urlCount: urlList.length, successful, totalChars, responseId },
	};
}

export const executeFetchContent = Effect.fn("FetchContent.executeFetchContent")(function* (
	params: FetchContentParams,
	options: FetchContentExecutionOptions = {},
	deps?: Partial<FetchContentDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const urlList = normalizeUrlList(params);
	if (urlList.length === 0) {
		return toValidationErrorResponse("Error: No URL provided.", {
			error: "No URL provided",
		});
	}

	yield* Effect.sync(() => {
		options.onUpdate?.({
			content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)...` }],
			details: { phase: "fetch", progress: 0 },
		});
	});

	const fetchResults = yield* runtimeDeps
		.fetchContent(urlList, options.signal, toExtractOptions(params))
		.pipe(
			Effect.mapError((cause) =>
				cause instanceof FetchContentExecutionError
					? cause
					: new FetchContentExecutionError({ reason: toErrorMessage(cause) }),
			),
		);

	const responseId = runtimeDeps.generateId();
	const data = makeStoredFetchData(responseId, fetchResults);
	yield* Effect.sync(() => {
		runtimeDeps.storeResult(responseId, data);
		options.persistToSession?.(data);
	});

	if (urlList.length === 1) {
		return buildSingleUrlResponse(fetchResults[0]!, urlList, responseId, params);
	}

	return buildMultiUrlResponse(fetchResults, urlList, responseId);
});
