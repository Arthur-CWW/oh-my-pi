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

export class RunnerToolConfigurationConflictError extends Schema.TaggedErrorClass<RunnerToolConfigurationConflictError>()(
	"RunnerToolConfigurationConflictError",
	{ expectedGeneration: NonNegativeInt, actualGeneration: NonNegativeInt },
) {}

export class RunnerSshToolUnavailableError extends Schema.TaggedErrorClass<RunnerSshToolUnavailableError>()(
	"RunnerSshToolUnavailableError",
	{ reason: Schema.Literal("reload-not-configured") },
) {}

export class RunnerTodoConflictError extends Schema.TaggedErrorClass<RunnerTodoConflictError>()(
	"RunnerTodoConflictError",
	{ expectedGeneration: NonNegativeInt, actualGeneration: NonNegativeInt },
) {}

export class RunnerItemRevisionConflictError extends Schema.TaggedErrorClass<RunnerItemRevisionConflictError>()(
	"RunnerItemRevisionConflictError",
	{ inputId: Schema.String, expectedRevision: NonNegativeInt, actualRevision: NonNegativeInt },
) {}

export class SessionRunnerRuntimeError extends Schema.TaggedErrorClass<SessionRunnerRuntimeError>()(
	"SessionRunnerRuntimeError",
	{ issue: Schema.String },
) {}

export class RunnerSessionReloadCancelledError extends Schema.TaggedErrorClass<RunnerSessionReloadCancelledError>()(
	"RunnerSessionReloadCancelledError",
	{ reason: Schema.Literal("session-before-switch") },
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

export class RunnerLocalOperationCommandConflictError extends Schema.TaggedErrorClass<RunnerLocalOperationCommandConflictError>()(
	"RunnerLocalOperationCommandConflictError",
	{ commandId: Schema.String },
) {}

export class RunnerLocalOperationUnavailableError extends Schema.TaggedErrorClass<RunnerLocalOperationUnavailableError>()(
	"RunnerLocalOperationUnavailableError",
	{ reason: Schema.Literals(["active", "capacity"]) },
) {}

export class RunnerLocalOperationTargetError extends Schema.TaggedErrorClass<RunnerLocalOperationTargetError>()(
	"RunnerLocalOperationTargetError",
	{ targetCommandId: Schema.String, targetOperationGeneration: NonNegativeInt },
) {}

export class RunnerEphemeralTurnCommandConflictError extends Schema.TaggedErrorClass<RunnerEphemeralTurnCommandConflictError>()(
	"RunnerEphemeralTurnCommandConflictError",
	{ commandId: Schema.String },
) {}

export class RunnerEphemeralTurnUnavailableError extends Schema.TaggedErrorClass<RunnerEphemeralTurnUnavailableError>()(
	"RunnerEphemeralTurnUnavailableError",
	{ reason: Schema.Literals(["active", "capacity"]) },
) {}

export class RunnerEphemeralTurnTargetError extends Schema.TaggedErrorClass<RunnerEphemeralTurnTargetError>()(
	"RunnerEphemeralTurnTargetError",
	{ targetCommandId: Schema.String, targetOperationGeneration: NonNegativeInt },
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
