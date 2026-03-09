import { Schema } from "effect";

export class ConfigReadError extends Schema.TaggedError<ConfigReadError>()(
	"ConfigReadError",
	{
		path: Schema.String,
		reason: Schema.String,
	},
) {}

export class ConfigParseError extends Schema.TaggedError<ConfigParseError>()(
	"ConfigParseError",
	{
		path: Schema.String,
		reason: Schema.String,
	},
) {}

export class MissingConfigError extends Schema.TaggedError<MissingConfigError>()(
	"MissingConfigError",
	{
		key: Schema.String,
		reason: Schema.String,
	},
) {}

export class EventStoreError extends Schema.TaggedError<EventStoreError>()(
	"EventStoreError",
	{
		reason: Schema.String,
	},
) {}

export type ConfigError = ConfigReadError | ConfigParseError | MissingConfigError;

export function stringifyUnknown(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}
	return String(value);
}
