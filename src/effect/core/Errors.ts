import { Data } from "effect";

export class ConfigReadError extends Data.TaggedError("ConfigReadError")<{
	readonly path: string;
	readonly reason: string;
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
	readonly path: string;
	readonly reason: string;
}> {}

export class MissingConfigError extends Data.TaggedError("MissingConfigError")<{
	readonly key: string;
	readonly reason: string;
}> {}

export class HttpRequestError extends Data.TaggedError("HttpRequestError")<{
	readonly url: string;
	readonly reason: string;
}> {}

export class HttpTimeoutError extends Data.TaggedError("HttpTimeoutError")<{
	readonly url: string;
	readonly timeoutMs: number;
}> {}

export class HttpStatusError extends Data.TaggedError("HttpStatusError")<{
	readonly url: string;
	readonly status: number;
	readonly bodySnippet: string;
}> {}

export class EventStoreError extends Data.TaggedError("EventStoreError")<{
	readonly reason: string;
}> {}

export type ConfigError = ConfigReadError | ConfigParseError | MissingConfigError;

export type HttpError = HttpRequestError | HttpTimeoutError | HttpStatusError;

export function stringifyUnknown(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}
	return String(value);
}
