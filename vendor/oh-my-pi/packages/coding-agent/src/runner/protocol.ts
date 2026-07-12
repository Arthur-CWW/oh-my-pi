import { Schema } from "effect";
import type { DurableQueuedInput } from "../session/durable-input-queue";
import type { WorkflowModeSnapshot } from "../session/session-entries";
import type { TodoPhase } from "../tools/todo";
import { InvalidRunnerCommandError, RunnerRevisionConflictError } from "./errors";

export * from "./errors";

export const RUNNER_SCHEMA_VERSION = 1 as const;

export const RunnerRevisionSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	Schema.brand("RunnerRevision"),
);

export const ControllerEpochSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(1)),
	Schema.brand("ControllerEpoch"),
);

export const ItemRevisionSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(1)),
	Schema.brand("ItemRevision"),
);

export const ImageContentSchema = Schema.Struct({
	type: Schema.Literal("image"),
	data: Schema.String,
	mimeType: Schema.String,
});
export type RunnerImageContent = typeof ImageContentSchema.Type;

const InputPayloadSchema = Schema.Struct({
	text: Schema.String,
	images: Schema.optional(Schema.Array(ImageContentSchema)),
});

const CommandMetadataSchema = {
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedRevision: RunnerRevisionSchema,
};

export const SubmitInputCommandSchema = Schema.Struct({
	...CommandMetadataSchema,
	kind: Schema.Literal("submitInput"),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	payload: Schema.Struct({
		text: Schema.String,
		images: Schema.optional(Schema.Array(ImageContentSchema)),
		deliveryClass: Schema.Literals(["steer", "followUp"]),
	}),
});

export const EditQueuedInputCommandSchema = Schema.Struct({
	...CommandMetadataSchema,
	kind: Schema.Literal("editQueuedInput"),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	inputId: Schema.String,
	itemRevision: ItemRevisionSchema,
	payload: InputPayloadSchema,
});

export const CancelQueuedInputCommandSchema = Schema.Struct({
	...CommandMetadataSchema,
	kind: Schema.Literal("cancelQueuedInput"),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	inputId: Schema.String,
	itemRevision: ItemRevisionSchema,
});

export const SetActiveToolsCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("setActiveTools"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	expectedToolConfigurationGeneration: RunnerRevisionSchema,
	toolNames: Schema.Array(Schema.String),
});

export const TodoTaskSchema = Schema.Struct({
	content: Schema.String,
	status: Schema.Literals(["pending", "in_progress", "completed", "abandoned"]),
});

export const TodoPhaseSchema = Schema.Struct({
	name: Schema.String,
	tasks: Schema.Array(TodoTaskSchema),
});

const LiveCommandMetadataSchema = {
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
};

export const ReplaceTodosCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("replaceTodos"),
	expectedTodoGeneration: RunnerRevisionSchema,
	phases: Schema.Array(TodoPhaseSchema),
});

export const RefreshSshToolCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("refreshSshTool"),
	expectedToolConfigurationGeneration: RunnerRevisionSchema,
	activateIfAvailable: Schema.Boolean,
});

export const SetThinkingLevelCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("setThinkingLevel"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	thinkingLevel: Schema.optional(
		Schema.Literals(["inherit", "off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "auto"]),
	),
});

export const SetModelCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("setModel"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	payload: Schema.Struct({
		provider: Schema.String,
		id: Schema.String,
		role: Schema.optional(Schema.String),
	}),
});

export const TransitionPlanModeCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("transitionPlanMode"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	transition: Schema.Union([
		Schema.Struct({
			kind: Schema.Literal("enter"),
			planFilePath: Schema.String,
			workflow: Schema.Literals(["parallel", "iterative"]),
		}),
		Schema.Struct({
			kind: Schema.Literal("exit"),
			disposition: Schema.Literals(["paused", "disabled"]),
		}),
	]),
});

const NonEmptyTrimmedStringSchema = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));

export const TransitionGoalModeCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("transitionGoalMode"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	transition: Schema.Union([
		Schema.Struct({
			kind: Schema.Literal("enter"),
			action: Schema.Literal("create"),
			objective: NonEmptyTrimmedStringSchema,
			tokenBudget: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
			workstream: Schema.optional(NonEmptyTrimmedStringSchema),
		}),
		Schema.Struct({
			kind: Schema.Literal("enter"),
			action: Schema.Literal("resume"),
			goalId: NonEmptyTrimmedStringSchema,
		}),
		Schema.Struct({
			kind: Schema.Literal("exit"),
			goalId: NonEmptyTrimmedStringSchema,
			disposition: Schema.Literals(["paused", "dropped", "completed"]),
		}),
	]),
});

export const InterruptPromptCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("interruptPrompt"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	targetGeneration: RunnerRevisionSchema,
});

export const RunCompactionCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("runCompaction"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	customInstructions: Schema.optional(Schema.String),
});

export const CancelCompactionCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("cancelCompaction"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	targetCommandId: Schema.String,
	targetOperationGeneration: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

export type SubmitInputCommand = typeof SubmitInputCommandSchema.Type;
export type EditQueuedInputCommand = typeof EditQueuedInputCommandSchema.Type;
export type CancelQueuedInputCommand = typeof CancelQueuedInputCommandSchema.Type;
export type SetActiveToolsCommand = typeof SetActiveToolsCommandSchema.Type;
export type SetThinkingLevelCommand = typeof SetThinkingLevelCommandSchema.Type;
export type SetModelCommand = typeof SetModelCommandSchema.Type;
export type InterruptPromptCommand = typeof InterruptPromptCommandSchema.Type;
export type RunCompactionCommand = typeof RunCompactionCommandSchema.Type;
export type CancelCompactionCommand = typeof CancelCompactionCommandSchema.Type;
export type TransitionPlanModeCommand = typeof TransitionPlanModeCommandSchema.Type;
export type TransitionGoalModeCommand = typeof TransitionGoalModeCommandSchema.Type;
export type ReplaceTodosCommand = typeof ReplaceTodosCommandSchema.Type;
export type RefreshSshToolCommand = typeof RefreshSshToolCommandSchema.Type;
export type RunnerCapability = "observer" | "controller";
export type RunnerStatus = "running" | "stopping" | "stopped";

export interface RunnerControlMetadata {
	readonly schemaVersion: typeof RUNNER_SCHEMA_VERSION;
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly expectedRevision: number;
}

export interface AttachRunnerViewCommand extends RunnerControlMetadata {
	readonly kind: "attachView";
	readonly viewId: string;
	readonly capability: RunnerCapability;
}

export interface AcquireRunnerControllerCommand extends RunnerControlMetadata {
	readonly kind: "acquireController";
	readonly viewId: string;
}

export interface ReleaseRunnerControllerCommand extends RunnerControlMetadata {
	readonly kind: "releaseController";
	readonly viewId: string;
	readonly controllerEpoch: number;
}

export interface DetachRunnerViewCommand extends RunnerControlMetadata {
	readonly kind: "detachView";
	readonly viewId: string;
	readonly controllerEpoch?: number;
}

export interface RunnerCommandReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly inputId: string;
	readonly durableSequence: number;
	readonly revision: number;
	readonly replayed: boolean;
}

export interface SetActiveToolsReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly toolConfigurationGeneration: number;
	readonly activeToolNames: ReadonlyArray<string>;
}

export interface ReplaceTodosReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly todoGeneration: number;
	readonly phases: ReadonlyArray<TodoPhase>;
}

export type RefreshSshToolReceipt = SetActiveToolsReceipt;

export interface SetThinkingLevelReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly sessionRevision: number;
	readonly replayed: boolean;
}

export type SetModelReceipt = SetThinkingLevelReceipt;
export type TransitionPlanModeReceipt = SetThinkingLevelReceipt;

export interface TransitionGoalModeReceipt extends SetThinkingLevelReceipt {
	readonly workflow: WorkflowModeSnapshot;
}

export interface InterruptPromptReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly targetGeneration: number;
	readonly interrupted: true;
}

export interface RunCompactionReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly startedSessionRevision: number;
	readonly operationGeneration: number;
	readonly completedSessionRevision: number;
	readonly replayed: boolean;
	readonly result: {
		readonly summary: string;
		readonly shortSummary?: string;
		readonly firstKeptEntryId: string;
		readonly tokensBefore: number;
	};
}

export interface CancelCompactionReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly targetCommandId: string;
	readonly targetOperationGeneration: number;
	readonly cancellationRequested: true;
}

export interface RunnerViewSnapshot {
	readonly viewId: string;
	readonly capability: RunnerCapability;
	readonly controllerEpoch: number | undefined;
	readonly attachedSequence: number;
}

export interface RunnerTranscriptSnapshot {
	readonly entryCount: number;
	readonly leafId: string | null;
	readonly lastEntryId: string | undefined;
}

export interface SessionRunnerSnapshot {
	readonly revision: number;
	readonly sessionRevision: number;
	readonly sequence: number;
	readonly durableSequence: number;
	readonly items: ReadonlyArray<DurableQueuedInput>;
	readonly transcript: RunnerTranscriptSnapshot;
	readonly views: ReadonlyArray<RunnerViewSnapshot>;
	readonly controller: { readonly viewId: string; readonly epoch: number } | undefined;
	readonly activeCompaction:
		| {
				readonly commandId: string;
				readonly operationGeneration: number;
				readonly startedSessionRevision: number;
		  }
		| undefined;
	readonly workflow: WorkflowModeSnapshot;
	readonly toolConfigurationGeneration: number;
	readonly activeToolNames: ReadonlyArray<string>;
	readonly todoGeneration: number;
	readonly status: RunnerStatus;
	readonly pendingOperations: number;
}

export type RunnerEventKind =
	| "observerAttached"
	| "controllerAcquired"
	| "controllerReleased"
	| "viewDetached"
	| "inputPrepared"
	| "inputEdited"
	| "inputCancelled"
	| "thinkingLevelChanged"
	| "toolsChanged"
	| "todosReplaced"
	| "sshToolRefreshed"
	| "modelChanged"
	| "planModeChanged"
	| "goalModeChanged"
	| "promptInterrupted"
	| "compactionCancelRequested"
	| "compactionCompleted"
	| "transcriptEntryAppended";

/** Every event is a closed causal envelope in the runner's single total order. */
export interface RunnerEvent {
	readonly schemaVersion: typeof RUNNER_SCHEMA_VERSION;
	readonly kind: RunnerEventKind;
	readonly eventId: string;
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId: string | undefined;
	readonly revision: number;
	readonly sequence: number;
	readonly sessionRevision: number | undefined;
	readonly controllerEpoch: number;
	readonly viewId: string | undefined;
	readonly inputId: string | undefined;
	readonly durableSequence: number | undefined;
	readonly transcriptEntryId: string | undefined;
	readonly transcriptLeafId: string | null | undefined;
	readonly transcriptPosition: number | undefined;
	readonly targetGeneration: number | undefined;
	readonly targetCommandId: string | undefined;
	readonly targetOperationGeneration: number | undefined;
}

export type RunnerEventDelivery =
	| { readonly kind: "event"; readonly event: RunnerEvent }
	| {
			readonly kind: "resyncRequired";
			readonly expectedSequence: number;
			readonly observedSequence: number;
			readonly event: RunnerEvent;
			readonly snapshot: SessionRunnerSnapshot;
	  };

export const decodeSubmitInputCommand = (input: unknown): SubmitInputCommand => {
	try {
		return Schema.decodeUnknownSync(SubmitInputCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({ issue: error instanceof Error ? error.message : "Invalid submit command" });
	}
};

export const decodeEditQueuedInputCommand = (input: unknown): EditQueuedInputCommand => {
	try {
		return Schema.decodeUnknownSync(EditQueuedInputCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({ issue: error instanceof Error ? error.message : "Invalid edit command" });
	}
};

export const decodeCancelQueuedInputCommand = (input: unknown): CancelQueuedInputCommand => {
	try {
		return Schema.decodeUnknownSync(CancelQueuedInputCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({ issue: error instanceof Error ? error.message : "Invalid cancel command" });
	}
};

export const decodeSetActiveToolsCommand = (input: unknown): SetActiveToolsCommand => {
	try {
		const command = Schema.decodeUnknownSync(SetActiveToolsCommandSchema)(input);
		const seen = new Set<string>();
		for (const name of command.toolNames) {
			if (name.length === 0 || name !== name.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(name)) {
				throw new Error(`Invalid tool identifier: ${JSON.stringify(name)}`);
			}
			if (seen.has(name)) throw new Error(`Duplicate tool identifier: ${name}`);
			seen.add(name);
		}
		return command;
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid set-active-tools command",
		});
	}
};

export const decodeReplaceTodosCommand = (input: unknown): ReplaceTodosCommand => {
	try {
		const command = Schema.decodeUnknownSync(ReplaceTodosCommandSchema)(input, { onExcessProperty: "error" });
		const phaseNames = new Set<string>();
		for (const phase of command.phases) {
			if (phaseNames.has(phase.name)) throw new Error(`Duplicate todo phase: ${phase.name}`);
			phaseNames.add(phase.name);
		}
		return command;
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid replace-todos command",
		});
	}
};

export const decodeRefreshSshToolCommand = (input: unknown): RefreshSshToolCommand => {
	try {
		return Schema.decodeUnknownSync(RefreshSshToolCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid refresh-ssh-tool command",
		});
	}
};

export const decodeSetThinkingLevelCommand = (input: unknown): SetThinkingLevelCommand => {
	try {
		return Schema.decodeUnknownSync(SetThinkingLevelCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid set-thinking command",
		});
	}
};

export const decodeSetModelCommand = (input: unknown): SetModelCommand => {
	try {
		return Schema.decodeUnknownSync(SetModelCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid set-model command",
		});
	}
};

export const decodeTransitionPlanModeCommand = (input: unknown): TransitionPlanModeCommand => {
	try {
		return Schema.decodeUnknownSync(TransitionPlanModeCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid plan-mode transition command",
		});
	}
};

export const decodeTransitionGoalModeCommand = (input: unknown): TransitionGoalModeCommand => {
	try {
		return Schema.decodeUnknownSync(TransitionGoalModeCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid goal-mode transition command",
		});
	}
};

export const decodeInterruptPromptCommand = (input: unknown): InterruptPromptCommand => {
	try {
		return Schema.decodeUnknownSync(InterruptPromptCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid interrupt-prompt command",
		});
	}
};

export const decodeCancelCompactionCommand = (input: unknown): CancelCompactionCommand => {
	try {
		return Schema.decodeUnknownSync(CancelCompactionCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid cancel-compaction command",
		});
	}
};

export const decodeRunCompactionCommand = (input: unknown): RunCompactionCommand => {
	try {
		return Schema.decodeUnknownSync(RunCompactionCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid compaction command",
		});
	}
};

export const assertRunnerRevision = (expectedRevision: number, actualRevision: number): void => {
	if (expectedRevision !== actualRevision) {
		throw new RunnerRevisionConflictError({ expectedRevision, actualRevision });
	}
};

export type {
	TerminalModelSnapshot,
	TerminalSessionDelivery,
	TerminalSessionSnapshot,
	TerminalSessionStateSnapshot,
	TerminalSessionSubscription,
	TerminalSessionView,
} from "./terminal-session-view";
