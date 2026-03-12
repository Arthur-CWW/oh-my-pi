import { Option, Schema } from "effect";

export const SEARCH_PROVIDER_VALUES = ["auto", "kagi", "gemini"] as const;
export const SEARCH_PROVIDER_SELECTION_VALUES = ["kagi", "gemini"] as const;
export const GEMINI_CLI_PROVIDER_VALUES = ["gemini"] as const;
export const RECENCY_FILTER_VALUES = ["day", "week", "month", "year"] as const;

export const SearchProviderSchema = Schema.Union([
	Schema.Literal("auto"),
	Schema.Literal("kagi"),
	Schema.Literal("gemini"),
]);
export type SearchProvider = typeof SearchProviderSchema.Type;

export const SearchProviderSelectionSchema = Schema.Union([
	Schema.Literal("kagi"),
	Schema.Literal("gemini"),
]);
export type SearchProviderSelection = typeof SearchProviderSelectionSchema.Type;

export const GeminiCliProviderSchema = Schema.Literal("gemini");
export type GeminiCliProvider = typeof GeminiCliProviderSchema.Type;

export const RecencyFilterSchema = Schema.Union([
	Schema.Literal("day"),
	Schema.Literal("week"),
	Schema.Literal("month"),
	Schema.Literal("year"),
]);
export type RecencyFilter = typeof RecencyFilterSchema.Type;

export const DomainFilterSchema = Schema.Array(Schema.String);

export function decodeSearchProviderOrAuto(value: unknown): SearchProvider {
	const decoded = Schema.decodeUnknownOption(SearchProviderSchema)(value);
	return Option.isSome(decoded) ? decoded.value : "auto";
}

export function decodeGeminiCliProvider(value: string): GeminiCliProvider | null {
	const decoded = Schema.decodeUnknownOption(GeminiCliProviderSchema)(value);
	return Option.isSome(decoded) ? decoded.value : null;
}

export function decodeRecencyFilter(value: string): RecencyFilter | null {
	const decoded = Schema.decodeUnknownOption(RecencyFilterSchema)(value);
	return Option.isSome(decoded) ? decoded.value : null;
}
