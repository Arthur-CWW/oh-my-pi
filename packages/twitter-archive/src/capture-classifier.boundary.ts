import { Schema } from "effect";

export interface TwitterError {
  readonly code?: number | string | undefined;
  readonly message?: string | undefined;
}

export const TwitterErrorSchema = Schema.Struct({
  code: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  message: Schema.optional(Schema.String),
});

export const TwitterErrorsResponseSchema = Schema.Struct({
  errors: Schema.Array(TwitterErrorSchema),
});

const decodeTwitterErrorsResponse = Schema.decodeUnknownOption(TwitterErrorsResponseSchema);

export interface ParsedTwitterErrors {
  readonly errors: readonly TwitterError[];
}

export function parseTwitterErrors(body: string): ParsedTwitterErrors | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const option = decodeTwitterErrorsResponse(parsed);
    if (option._tag === "Some") {
      return option.value;
    }
    return { errors: [] };
  } catch {
    return null;
  }
}
