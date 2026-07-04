import { Schema } from "effect"

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("StorageError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
}) {}

export class ArtifactError extends Schema.TaggedErrorClass<ArtifactError>()("ArtifactError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
}) {}
