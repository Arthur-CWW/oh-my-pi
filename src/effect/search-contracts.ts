import { Either, Schema } from "effect";

export const SEARCH_PROVIDER_VALUES = ["auto", "kagi", "gemini"] as const;
export const SEARCH_PROVIDER_SELECTION_VALUES = ["kagi", "gemini"] as const;
export const GEMINI_CLI_PROVIDER_VALUES = ["gemini"] as const;
export const RECENCY_FILTER_VALUES = ["day", "week", "month", "year"] as const;

export const SearchProviderSchema = Schema.Literal(...SEARCH_PROVIDER_VALUES);
export type SearchProvider = typeof SearchProviderSchema.Type;

export const SearchProviderSelectionSchema = Schema.Literal(...SEARCH_PROVIDER_SELECTION_VALUES);
export type SearchProviderSelection = typeof SearchProviderSelectionSchema.Type;

export const GeminiCliProviderSchema = Schema.Literal(...GEMINI_CLI_PROVIDER_VALUES);
export type GeminiCliProvider = typeof GeminiCliProviderSchema.Type;

export const RecencyFilterSchema = Schema.Literal(...RECENCY_FILTER_VALUES);
export type RecencyFilter = typeof RecencyFilterSchema.Type;

export const DomainFilterSchema = Schema.Array(Schema.String);

export function decodeSearchProviderOrAuto(value: unknown): SearchProvider {
	const decoded = Schema.decodeUnknownEither(SearchProviderSchema)(value);
	return Either.isRight(decoded) ? decoded.right : "auto";
}

export function decodeGeminiCliProvider(value: string): GeminiCliProvider | null {
	const decoded = Schema.decodeUnknownEither(GeminiCliProviderSchema)(value);
	return Either.isRight(decoded) ? decoded.right : null;
}

export function decodeRecencyFilter(value: string): RecencyFilter | null {
	const decoded = Schema.decodeUnknownEither(RecencyFilterSchema)(value);
	return Either.isRight(decoded) ? decoded.right : null;
}
