import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { Schema } from "effect";
import type { RestartSpawnSpec } from "../cli/restart-session";
import type { KernelDisplayOutput } from "../eval/py/display";
import type { InteractiveHostIntent } from "../modes/interactive-host-intent";
import type { DurableQueuedInput } from "../session/durable-input-queue";
import type { SessionEntry, SessionHeader, WorkflowModeSnapshot } from "../session/session-entries";
import type { TodoPhase } from "../tools/todo";
import { InputPayloadSchema, MediaContentSchema } from "./attachment-schema";
import {
	BuildRevisionSchema,
	type BuildRevision,
	RunnerIdentitySchema,
	type RunnerIdentity,
	RunnerInstanceIdentitySchema,
	type RunnerInstanceIdentity,
	TimestampSchema,
} from "./identity-schema";
import { InvalidRunnerCommandError, RunnerRevisionConflictError } from "./errors";

export * from "./errors";
export { MediaContentSchema } from "./attachment-schema";
export {
	BuildRevisionSchema,
	type BuildRevision,
	RunnerIdentitySchema,
	type RunnerIdentity,
	RunnerInstanceIdentitySchema,
	type RunnerInstanceIdentity,
} from "./identity-schema";

export const RUNNER_SCHEMA_VERSION = 1 as const;

export const decodeBuildRevision = (input: unknown): BuildRevision =>
	Schema.decodeUnknownSync(BuildRevisionSchema)(input, { onExcessProperty: "error" });

export const decodeRunnerInstanceIdentity = (input: unknown): RunnerInstanceIdentity =>
	Schema.decodeUnknownSync(RunnerInstanceIdentitySchema)(input, { onExcessProperty: "error" });

export const decodeRunnerIdentity = (input: unknown): RunnerIdentity =>
	Schema.decodeUnknownSync(RunnerIdentitySchema)(input, { onExcessProperty: "error" });

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
		attachments: Schema.optional(Schema.Array(MediaContentSchema)),
		deliveryClass: Schema.Literals(["steer", "followUp"]),
	}),
});

const CustomContentPartSchema = Schema.Union([
	Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
	MediaContentSchema,
]);

export const SubmitCustomMessageCommandSchema = Schema.Struct({
	...CommandMetadataSchema,
	kind: Schema.Literal("submitCustomMessage"),
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	payload: Schema.Struct({
		kind: Schema.Literal("custom"),
		message: Schema.Struct({
			customType: Schema.String,
			content: Schema.Union([Schema.String, Schema.Array(CustomContentPartSchema)]),
			display: Schema.Boolean,
			details: Schema.optional(Schema.Unknown),
			attribution: Schema.Literals(["user", "agent"]),
		}),
		deliverAs: Schema.Literals(["steer", "followUp", "nextTurn"]),
		triggerTurn: Schema.Boolean,
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

export const CycleModelCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("cycleModel"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	direction: Schema.Literals(["forward", "backward"]),
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

export const RunLocalOperationCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("runLocalOperation"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	operation: Schema.Union([
		Schema.Struct({
			kind: Schema.Literal("bash"),
			command: Schema.String,
			excludeFromContext: Schema.Boolean,
			useUserShell: Schema.Literal(true),
		}),
		Schema.Struct({
			kind: Schema.Literal("python"),
			code: Schema.String,
			excludeFromContext: Schema.Boolean,
		}),
	]),
});

export const CancelLocalOperationCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("cancelLocalOperation"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	targetCommandId: Schema.String,
	targetOperationGeneration: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

export const RunEphemeralTurnCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("runEphemeralTurn"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	prompt: Schema.String,
});

export const CancelEphemeralTurnCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	kind: Schema.Literal("cancelEphemeralTurn"),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedSessionRevision: RunnerRevisionSchema,
	viewId: Schema.String,
	controllerEpoch: ControllerEpochSchema,
	targetCommandId: Schema.String,
	targetOperationGeneration: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

export const RunShakeCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("runShake"),
	expectedSessionRevision: RunnerRevisionSchema,
	mode: Schema.Literals(["elide", "media"]),
});

export const CancelShakeCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("cancelShake"),
	targetCommandId: Schema.String,
	targetOperationGeneration: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

export const RunHandoffCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("runHandoff"),
	expectedSessionRevision: RunnerRevisionSchema,
	customInstructions: Schema.optional(Schema.String),
});

export const CancelHandoffCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("cancelHandoff"),
	targetCommandId: Schema.String,
	targetOperationGeneration: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

export const CheckpointStateSchema = Schema.Struct({
	checkpointMessageCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
	checkpointEntryId: Schema.NullOr(Schema.String),
	startedAt: TimestampSchema,
});

export const GetCheckpointStateCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("getCheckpointState"),
});

export const SetCheckpointStateCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("setCheckpointState"),
	expectedCheckpointRevision: RunnerRevisionSchema,
	state: Schema.NullOr(CheckpointStateSchema),
});

export const ReloadSessionCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("reloadSession"),
	expectedSessionRevision: RunnerRevisionSchema,
});

const SessionLocatorSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("id"), id: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("path"), path: Schema.String }),
]);

export const InteractiveHostIntentSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("exit") }),
	Schema.Struct({ kind: Schema.Literal("newSession"), parent: Schema.optional(SessionLocatorSchema) }),
	Schema.Struct({ kind: Schema.Literal("freshSession") }),
	Schema.Struct({ kind: Schema.Literal("resume"), session: SessionLocatorSchema }),
	Schema.Struct({ kind: Schema.Literal("fork"), entryId: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("branch"), entryId: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("navigate"), targetId: Schema.String, summarize: Schema.Boolean }),
	Schema.Struct({ kind: Schema.Literal("switchSession"), session: SessionLocatorSchema }),
	Schema.Struct({ kind: Schema.Literal("moveSession"), newDir: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("restartProcess") }),
]);

export const PrepareHostTransitionCommandSchema = Schema.Struct({
	...LiveCommandMetadataSchema,
	kind: Schema.Literal("prepareHostTransition"),
	expectedSessionRevision: RunnerRevisionSchema,
	intent: InteractiveHostIntentSchema,
});

export type SubmitInputCommand = typeof SubmitInputCommandSchema.Type;
export type SubmitCustomMessageCommand = typeof SubmitCustomMessageCommandSchema.Type;
export type EditQueuedInputCommand = typeof EditQueuedInputCommandSchema.Type;
export type CancelQueuedInputCommand = typeof CancelQueuedInputCommandSchema.Type;
export type SetActiveToolsCommand = typeof SetActiveToolsCommandSchema.Type;
export type SetThinkingLevelCommand = typeof SetThinkingLevelCommandSchema.Type;
export type SetModelCommand = typeof SetModelCommandSchema.Type;
export type CycleModelCommand = typeof CycleModelCommandSchema.Type;
export type InterruptPromptCommand = typeof InterruptPromptCommandSchema.Type;
export type RunCompactionCommand = typeof RunCompactionCommandSchema.Type;
export type CancelCompactionCommand = typeof CancelCompactionCommandSchema.Type;
export type RunLocalOperationCommand = typeof RunLocalOperationCommandSchema.Type;
export type CancelLocalOperationCommand = typeof CancelLocalOperationCommandSchema.Type;
export type RunEphemeralTurnCommand = typeof RunEphemeralTurnCommandSchema.Type;
export type CancelEphemeralTurnCommand = typeof CancelEphemeralTurnCommandSchema.Type;
export type RunShakeCommand = typeof RunShakeCommandSchema.Type;
export type CancelShakeCommand = typeof CancelShakeCommandSchema.Type;
export type RunHandoffCommand = typeof RunHandoffCommandSchema.Type;
export type CancelHandoffCommand = typeof CancelHandoffCommandSchema.Type;
export type RunnerCheckpointState = typeof CheckpointStateSchema.Type;
export type GetCheckpointStateCommand = typeof GetCheckpointStateCommandSchema.Type;
export type SetCheckpointStateCommand = typeof SetCheckpointStateCommandSchema.Type;
export type ReloadSessionCommand = typeof ReloadSessionCommandSchema.Type;
export type PrepareHostTransitionCommand = typeof PrepareHostTransitionCommandSchema.Type;

export type TransitionPlanModeCommand = typeof TransitionPlanModeCommandSchema.Type;
export type TransitionGoalModeCommand = typeof TransitionGoalModeCommandSchema.Type;
export type ReplaceTodosCommand = typeof ReplaceTodosCommandSchema.Type;
export type RefreshSshToolCommand = typeof RefreshSshToolCommandSchema.Type;
export type RunnerCapability = "observer" | "controller";
export type RunnerStatus = "running" | "stopping" | "stopped";

/** Immutable prompt/turn state projected to controller clients. */
export interface RunnerTurnLifecycle {
	readonly streaming: boolean;
	readonly abortRequested: boolean;
	readonly settling: boolean;
	readonly postPromptWork: boolean;
	readonly compacting: boolean;
	readonly retrying: boolean;
	readonly handoff: boolean;
	readonly promptGeneration: number;
}

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
	/** Controller authority may only be displaced by an explicit, epoch-fenced takeover. */
	readonly takeover?: true;
	readonly expectedControllerEpoch?: number;
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

export interface LocalOperationOutputSnapshot {
	readonly text: string;
	readonly totalBytes: number;
	readonly truncated: boolean;
}

export interface ActiveLocalOperationSnapshot {
	readonly commandId: string;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly operation: RunLocalOperationCommand["operation"];
	readonly output: LocalOperationOutputSnapshot;
	readonly pendingOutputChunks: number;
	readonly pendingOutputBytes: number;
	readonly peakPendingOutputChunks: number;
	readonly peakPendingOutputBytes: number;
}

export interface RunLocalOperationReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly startedSessionRevision: number;
	readonly operationGeneration: number;
	readonly completedSessionRevision: number;
	readonly replayed: boolean;
	readonly result:
		| {
				readonly kind: "bash";
				readonly output: LocalOperationOutputSnapshot;
				readonly exitCode: number | undefined;
				readonly cancelled: boolean;
				readonly artifactId?: string;
		  }
		| {
				readonly kind: "python";
				readonly output: LocalOperationOutputSnapshot;
				readonly exitCode: number | undefined;
				readonly cancelled: boolean;
				readonly artifactId?: string;
				readonly totalLines: number;
				readonly outputLines: number;
				readonly outputBytes: number;
				readonly displayOutputs: readonly KernelDisplayOutput[];
				readonly stdinRequested: boolean;
		  };
}

export interface CancelLocalOperationReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly targetCommandId: string;
	readonly targetOperationGeneration: number;
	readonly cancellationRequested: true;
}

export interface ActiveEphemeralTurnSnapshot {
	readonly commandId: string;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
	readonly output: LocalOperationOutputSnapshot;
	readonly pendingOutputChunks: number;
	readonly pendingOutputBytes: number;
	readonly peakPendingOutputChunks: number;
	readonly peakPendingOutputBytes: number;
}

export interface RunEphemeralTurnReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly startedSessionRevision: number;
	readonly operationGeneration: number;
	readonly completedSessionRevision: number;
	readonly replayed: boolean;
	readonly output: LocalOperationOutputSnapshot;
}

export interface CancelEphemeralTurnReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly targetCommandId: string;
	readonly targetOperationGeneration: number;
	readonly cancellationRequested: true;
}

export interface ActiveSessionOperationSnapshot {
	readonly kind: "shake" | "handoff" | "reload" | "hostTransition";
	readonly commandId: string;
	readonly operationGeneration: number;
	readonly startedSessionRevision: number;
}

export interface RunShakeReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly startedSessionRevision: number;
	readonly operationGeneration: number;
	readonly completedSessionRevision: number;
	readonly replayed: boolean;
	readonly result: {
		readonly mode: "elide" | "media";
		readonly toolResultsDropped: number;
		readonly blocksDropped: number;
		readonly mediaDropped?: number;
		readonly tokensFreed: number;
		readonly artifactId?: string;
	};
}

export interface CancelShakeReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly targetCommandId: string;
	readonly targetOperationGeneration: number;
	readonly cancellationRequested: true;
}

export interface RunHandoffReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly startedSessionRevision: number;
	readonly operationGeneration: number;
	readonly completedSessionRevision: number;
	readonly replayed: boolean;
	readonly result:
		| {
				readonly document: string;
				readonly savedPath?: string;
				readonly sessionId: string;
				readonly sessionFile?: string;
		  }
		| undefined;
}

export interface CancelHandoffReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly targetCommandId: string;
	readonly targetOperationGeneration: number;
	readonly cancellationRequested: true;
}

export interface GetCheckpointStateReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly sessionRevision: number;
	readonly checkpointRevision: number;
	readonly state: RunnerCheckpointState | undefined;
	readonly replayed: boolean;
}

export type SetCheckpointStateReceipt = GetCheckpointStateReceipt;

export interface ReloadSessionReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly startedSessionRevision: number;
	readonly operationGeneration: number;
	readonly completedSessionRevision: number;
	readonly sessionId: string;
	readonly sessionFile?: string;
	readonly replayed: boolean;
}

export interface PreparedHostTransitionTarget {
	readonly sessionId: string;
	readonly sessionFile?: string;
	readonly cwd: string;
	readonly editorText?: string;
}

export interface PrepareHostTransitionReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly startedSessionRevision: number;
	readonly operationGeneration: number;
	readonly completedSessionRevision: number;
	readonly intent: InteractiveHostIntent;
	readonly target?: PreparedHostTransitionTarget;
	readonly restartSpawn?: RestartSpawnSpec;
	readonly cancelled: boolean;
	readonly replayed: boolean;
}

export interface CycleModelReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly sessionRevision: number;
	readonly replayed: boolean;
	readonly result:
		| {
				readonly provider: string;
				readonly id: string;
				readonly thinkingLevel: ThinkingLevel | undefined;
				readonly isScoped: boolean;
		  }
		| undefined;
}

export interface RunnerViewSnapshot {
	readonly viewId: string;
	readonly capability: RunnerCapability;
	readonly controllerEpoch: number | undefined;
	readonly attachedSequence: number;
}

export interface RunnerTranscriptSnapshot {
	readonly header: SessionHeader;
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly entryCount: number;
	readonly leafId: string | null;
	readonly lastEntryId: string | undefined;
}

export type { IrcDeliveryRecord } from "../irc/bus";

export interface SessionRunnerSnapshot {
	readonly runnerIdentity: RunnerIdentity;
	readonly revision: number;
	readonly sessionRevision: number;
	readonly sequence: number;
	readonly durableSequence: number;
	readonly items: ReadonlyArray<DurableQueuedInput>;
	readonly transcript: RunnerTranscriptSnapshot;
	readonly recentDeliveries: ReadonlyArray<import("../irc/bus").IrcDeliveryRecord>;
	readonly views: ReadonlyArray<RunnerViewSnapshot>;
	readonly controller: { readonly viewId: string; readonly epoch: number } | undefined;
	readonly activeCompaction:
		| {
				readonly commandId: string;
				readonly operationGeneration: number;
				readonly startedSessionRevision: number;
		  }
		| undefined;
	readonly activeLocalOperation: ActiveLocalOperationSnapshot | undefined;
	readonly activeEphemeralTurn: ActiveEphemeralTurnSnapshot | undefined;
	readonly activeSessionOperation: ActiveSessionOperationSnapshot | undefined;
	readonly checkpointRevision: number;
	readonly checkpointState: RunnerCheckpointState | undefined;
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
	| "localOperationOutput"
	| "localOperationCancelRequested"
	| "localOperationCompleted"
	| "ephemeralTurnOutput"
	| "ephemeralTurnCancelRequested"
	| "ephemeralTurnCompleted"
	| "shakeCancelRequested"
	| "shakeCompleted"
	| "handoffCancelRequested"
	| "handoffCompleted"
	| "checkpointChanged"
	| "sessionReloaded"
	| "hostTransitionPrepared"
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
	/** Immutable payload captured with the append notification inside the runner mailbox. */
	readonly transcriptEntry: SessionEntry | undefined;
	readonly targetGeneration: number | undefined;
	readonly targetCommandId: string | undefined;
	readonly targetOperationGeneration: number | undefined;
	readonly localOperationOutput?: {
		readonly chunk: string;
		readonly totalBytes: number;
		readonly truncated: boolean;
		readonly reset: boolean;
	};
	readonly ephemeralTurnOutput?: {
		readonly chunk: string;
		readonly totalBytes: number;
		readonly truncated: boolean;
		readonly reset: boolean;
	};
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
		return Schema.decodeUnknownSync(SubmitInputCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({ issue: error instanceof Error ? error.message : "Invalid submit command" });
	}
};

const isJsonValue = (value: unknown): boolean => {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (typeof value !== "object") return false;
	return Object.values(value as Record<string, unknown>).every(isJsonValue);
};

export const decodeSubmitCustomMessageCommand = (input: unknown): SubmitCustomMessageCommand => {
	try {
		const command = Schema.decodeUnknownSync(SubmitCustomMessageCommandSchema)(input, {
			onExcessProperty: "error",
		});
		if (command.payload.message.details !== undefined && !isJsonValue(command.payload.message.details)) {
			throw new Error("Custom message details must be JSON");
		}
		return command;
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid custom message command",
		});
	}
};

export const decodeEditQueuedInputCommand = (input: unknown): EditQueuedInputCommand => {
	try {
		return Schema.decodeUnknownSync(EditQueuedInputCommandSchema)(input, { onExcessProperty: "error" });
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

export const decodeCycleModelCommand = (input: unknown): CycleModelCommand => {
	try {
		return Schema.decodeUnknownSync(CycleModelCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid cycle-model command",
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
export const decodeRunEphemeralTurnCommand = (input: unknown): RunEphemeralTurnCommand => {
	try {
		const command = Schema.decodeUnknownSync(RunEphemeralTurnCommandSchema)(input, { onExcessProperty: "error" });
		if (command.prompt.trim().length === 0) throw new Error("Ephemeral turn prompt must not be empty");
		return command;
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid ephemeral-turn command",
		});
	}
};

export const decodeCancelEphemeralTurnCommand = (input: unknown): CancelEphemeralTurnCommand => {
	try {
		return Schema.decodeUnknownSync(CancelEphemeralTurnCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid cancel-ephemeral-turn command",
		});
	}
};

export const decodeRunLocalOperationCommand = (input: unknown): RunLocalOperationCommand => {
	try {
		return Schema.decodeUnknownSync(RunLocalOperationCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid local-operation command",
		});
	}
};

export const decodeCancelLocalOperationCommand = (input: unknown): CancelLocalOperationCommand => {
	try {
		return Schema.decodeUnknownSync(CancelLocalOperationCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid cancel-local-operation command",
		});
	}
};

export const decodeRunShakeCommand = (input: unknown): RunShakeCommand => {
	try {
		return Schema.decodeUnknownSync(RunShakeCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid shake command",
		});
	}
};

export const decodeCancelShakeCommand = (input: unknown): CancelShakeCommand => {
	try {
		return Schema.decodeUnknownSync(CancelShakeCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid cancel-shake command",
		});
	}
};

export const decodeRunHandoffCommand = (input: unknown): RunHandoffCommand => {
	try {
		return Schema.decodeUnknownSync(RunHandoffCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid handoff command",
		});
	}
};

export const decodeCancelHandoffCommand = (input: unknown): CancelHandoffCommand => {
	try {
		return Schema.decodeUnknownSync(CancelHandoffCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid cancel-handoff command",
		});
	}
};

export const decodeGetCheckpointStateCommand = (input: unknown): GetCheckpointStateCommand => {
	try {
		return Schema.decodeUnknownSync(GetCheckpointStateCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid get-checkpoint-state command",
		});
	}
};

export const decodeSetCheckpointStateCommand = (input: unknown): SetCheckpointStateCommand => {
	try {
		return Schema.decodeUnknownSync(SetCheckpointStateCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid set-checkpoint-state command",
		});
	}
};

export const decodeReloadSessionCommand = (input: unknown): ReloadSessionCommand => {
	try {
		return Schema.decodeUnknownSync(ReloadSessionCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid reload-session command",
		});
	}
};

export const decodePrepareHostTransitionCommand = (input: unknown): PrepareHostTransitionCommand => {
	try {
		return Schema.decodeUnknownSync(PrepareHostTransitionCommandSchema)(input, { onExcessProperty: "error" });
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid prepare-host-transition command",
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
