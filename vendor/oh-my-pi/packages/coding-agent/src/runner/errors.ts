import { Schema } from "effect";

export class InvalidRunnerCommandError extends Schema.TaggedErrorClass<InvalidRunnerCommandError>()(
	"InvalidRunnerCommandError",
	{ issue: Schema.String },
) {}

export class RunnerRevisionConflictError extends Schema.TaggedErrorClass<RunnerRevisionConflictError>()(
	"RunnerRevisionConflictError",
	{
		expectedRevision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
		actualRevision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
	},
) {}

export class DurableRunnerStoreError extends Schema.TaggedErrorClass<DurableRunnerStoreError>()(
	"DurableRunnerStoreError",
	{ issue: Schema.String },
) {}

export class RunnerProviderError extends Schema.TaggedErrorClass<RunnerProviderError>()("RunnerProviderError", {
	issue: Schema.String,
}) {}
