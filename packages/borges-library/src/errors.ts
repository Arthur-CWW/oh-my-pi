import { Schema } from "effect"

export class FetchError extends Schema.TaggedErrorClass<FetchError>()("FetchError", {
  message: Schema.String,
}) {}

export class ParseError extends Schema.TaggedErrorClass<ParseError>()("ParseError", {
  message: Schema.String,
}) {}

export class BlockedError extends Schema.TaggedErrorClass<BlockedError>()("BlockedError", {
  message: Schema.String,
}) {}

export class DownloadError extends Schema.TaggedErrorClass<DownloadError>()("DownloadError", {
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("NotFoundError", {
  message: Schema.String,
}) {}

export type BorgesLibraryError = FetchError | ParseError | DownloadError | NotFoundError | BlockedError
