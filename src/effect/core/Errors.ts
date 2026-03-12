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

export class EventStoreError extends Data.TaggedError("EventStoreError")<{
	readonly reason: string;
}> {}

export type ConfigError = ConfigReadError | ConfigParseError | MissingConfigError;

export function stringifyUnknown(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}
	return String(value);
}
