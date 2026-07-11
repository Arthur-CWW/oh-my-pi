import type { DurableQueuedInput } from "../session/durable-input-queue";
import { Schema } from "effect";
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

export type SubmitInputCommand = typeof SubmitInputCommandSchema.Type;
export type EditQueuedInputCommand = typeof EditQueuedInputCommandSchema.Type;
export type CancelQueuedInputCommand = typeof CancelQueuedInputCommandSchema.Type;
export type SetThinkingLevelCommand = typeof SetThinkingLevelCommandSchema.Type;
export type SetModelCommand = typeof SetModelCommandSchema.Type;
export type InterruptPromptCommand = typeof InterruptPromptCommandSchema.Type;
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

export interface SetThinkingLevelReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly sessionRevision: number;
	readonly replayed: boolean;
}

export type SetModelReceipt = SetThinkingLevelReceipt;

export interface InterruptPromptReceipt {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId?: string;
	readonly targetGeneration: number;
	readonly interrupted: true;
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
	| "modelChanged"
	| "promptInterrupted"
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

export const decodeInterruptPromptCommand = (input: unknown): InterruptPromptCommand => {
	try {
		return Schema.decodeUnknownSync(InterruptPromptCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Invalid interrupt-prompt command",
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
