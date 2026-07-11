import { Schema } from "effect";

const NonNegativeInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export class InvalidRunnerCommandError extends Schema.TaggedErrorClass<InvalidRunnerCommandError>()(
	"InvalidRunnerCommandError",
	{ issue: Schema.String },
) {}

export class RunnerRevisionConflictError extends Schema.TaggedErrorClass<RunnerRevisionConflictError>()(
	"RunnerRevisionConflictError",
	{ expectedRevision: NonNegativeInt, actualRevision: NonNegativeInt },
) {}

export class RunnerItemRevisionConflictError extends Schema.TaggedErrorClass<RunnerItemRevisionConflictError>()(
	"RunnerItemRevisionConflictError",
	{ inputId: Schema.String, expectedRevision: NonNegativeInt, actualRevision: NonNegativeInt },
) {}

export class SessionRunnerRuntimeError extends Schema.TaggedErrorClass<SessionRunnerRuntimeError>()(
	"SessionRunnerRuntimeError",
	{ issue: Schema.String },
) {}

export class RunnerControllerConflictError extends Schema.TaggedErrorClass<RunnerControllerConflictError>()(
	"RunnerControllerConflictError",
	{ requestedViewId: Schema.String, activeViewId: Schema.String, controllerEpoch: NonNegativeInt },
) {}

export class StaleRunnerControllerLeaseError extends Schema.TaggedErrorClass<StaleRunnerControllerLeaseError>()(
	"StaleRunnerControllerLeaseError",
	{
		viewId: Schema.String,
		expectedControllerEpoch: NonNegativeInt,
		actualControllerEpoch: Schema.optional(NonNegativeInt),
	},
) {}

export class RunnerViewAlreadyAttachedError extends Schema.TaggedErrorClass<RunnerViewAlreadyAttachedError>()(
	"RunnerViewAlreadyAttachedError",
	{ viewId: Schema.String },
) {}

export class RunnerViewNotAttachedError extends Schema.TaggedErrorClass<RunnerViewNotAttachedError>()(
	"RunnerViewNotAttachedError",
	{ viewId: Schema.String },
) {}

export class RunnerViewCapabilityError extends Schema.TaggedErrorClass<RunnerViewCapabilityError>()(
	"RunnerViewCapabilityError",
	{ viewId: Schema.String, requiredCapability: Schema.Literal("controller") },
) {}

export class RunnerPromptOperationConflictError extends Schema.TaggedErrorClass<RunnerPromptOperationConflictError>()(
	"RunnerPromptOperationConflictError",
	{
		targetGeneration: NonNegativeInt,
		actualGeneration: NonNegativeInt,
		active: Schema.Boolean,
	},
) {}

export class RunnerCompactionCommandConflictError extends Schema.TaggedErrorClass<RunnerCompactionCommandConflictError>()(
	"RunnerCompactionCommandConflictError",
	{ commandId: Schema.String },
) {}

export class RunnerCompactionUnavailableError extends Schema.TaggedErrorClass<RunnerCompactionUnavailableError>()(
	"RunnerCompactionUnavailableError",
	{ reason: Schema.Literals(["streaming", "compacting", "retrying", "handoff", "capacity"]) },
) {}

export class RunnerCompactionTargetError extends Schema.TaggedErrorClass<RunnerCompactionTargetError>()(
	"RunnerCompactionTargetError",
	{
		targetCommandId: Schema.String,
		targetOperationGeneration: NonNegativeInt,
		activeCommandId: Schema.optional(Schema.String),
		activeOperationGeneration: Schema.optional(NonNegativeInt),
	},
) {}

export class SessionRunnerStoppedError extends Schema.TaggedErrorClass<SessionRunnerStoppedError>()(
	"SessionRunnerStoppedError",
	{},
) {}
