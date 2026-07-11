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
	payload: Schema.Struct({ text: Schema.String }),
});

export type SubmitInputCommand = typeof SubmitInputCommandSchema.Type;
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

export interface PreparedDurableInput {
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId: string | undefined;
	readonly controllerEpoch: number;
	readonly inputId: string;
	readonly sequence: number;
	readonly revision: number;
	readonly replayed: boolean;
}

export interface RunnerCommandReceipt extends PreparedDurableInput {}

/** A dispatched record is uncertain after reopen and is never automatically retried. */
export type DurableDispatchState = "prepared" | "dispatched" | "completed" | "uncertain";

export interface DurableInputRecord {
	readonly command: SubmitInputCommand;
	readonly receipt: Omit<RunnerCommandReceipt, "replayed">;
	readonly dispatchState: DurableDispatchState;
}

export interface DurableRunnerSnapshot {
	readonly revision: number;
	readonly records: ReadonlyArray<DurableInputRecord>;
}

/**
 * `prepare` atomically performs the revision CAS, allocates durable input sequence,
 * and records the dispatch obligation. `beginDispatch` is a prepared-to-dispatched
 * CAS; only its winner may invoke the provider.
 */
export interface DurableRunnerStore {
	load(): Promise<DurableRunnerSnapshot>;
	prepare(command: SubmitInputCommand, expectedRevision: number): Promise<PreparedDurableInput>;
	beginDispatch(commandId: string): Promise<DurableInputRecord | undefined>;
	finishDispatch(commandId: string, state: "completed" | "uncertain"): Promise<void>;
}

export interface RunnerState {
	readonly revision: number;
	readonly processedCommandIds: ReadonlyMap<string, RunnerCommandReceipt>;
}

export interface RunnerViewSnapshot {
	readonly viewId: string;
	readonly capability: RunnerCapability;
	readonly controllerEpoch: number | undefined;
	readonly attachedSequence: number;
}

export interface SessionRunnerSnapshot {
	readonly revision: number;
	readonly sequence: number;
	readonly durableSequence: number;
	readonly records: ReadonlyArray<DurableInputRecord>;
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
	| "inputCompleted"
	| "inputUncertain";

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
	readonly controllerEpoch: number;
	readonly viewId: string | undefined;
	readonly inputId: string | undefined;
	readonly durableSequence: number | undefined;
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

export interface Transition {
	readonly state: RunnerState;
	readonly receipt: RunnerCommandReceipt;
	readonly event: RunnerEvent | undefined;
}

export const stateFromSnapshot = (snapshot: DurableRunnerSnapshot): RunnerState => ({
	revision: snapshot.revision,
	processedCommandIds: new Map(
		snapshot.records.map((record) => [record.receipt.commandId, { ...record.receipt, replayed: false }]),
	),
});

export const transitionPreparedInput = (
	state: RunnerState,
	command: SubmitInputCommand,
	prepared: PreparedDurableInput,
	eventSequence: number,
): Transition => {
	const prior = state.processedCommandIds.get(command.commandId);
	if (prior) return { state, receipt: { ...prior, replayed: true }, event: undefined };

	const receipt: RunnerCommandReceipt = { ...prepared };
	const processedCommandIds = new Map(state.processedCommandIds);
	processedCommandIds.set(command.commandId, receipt);
	return {
		state: { revision: Math.max(state.revision, prepared.revision), processedCommandIds },
		receipt,
		event: prepared.replayed
			? undefined
			: {
					schemaVersion: RUNNER_SCHEMA_VERSION,
					kind: "inputPrepared",
					eventId: `inputPrepared:${eventSequence}`,
					commandId: command.commandId,
					correlationId: command.correlationId,
					causationId: command.causationId,
					revision: prepared.revision,
					sequence: eventSequence,
					controllerEpoch: command.controllerEpoch,
					viewId: command.viewId,
					inputId: prepared.inputId,
					durableSequence: prepared.sequence,
				},
	};
};

export const decodeSubmitInputCommand = (input: unknown): SubmitInputCommand => {
	try {
		return Schema.decodeUnknownSync(SubmitInputCommandSchema)(input);
	} catch (error) {
		throw new InvalidRunnerCommandError({
			issue: error instanceof Error ? error.message : "Schema decoding failed",
		});
	}
};

export const assertRunnerRevision = (expectedRevision: number, actualRevision: number): void => {
	if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
		throw new InvalidRunnerCommandError({ issue: "expectedRevision must be a non-negative safe integer" });
	}
	if (expectedRevision !== actualRevision) {
		throw new RunnerRevisionConflictError({ expectedRevision, actualRevision });
	}
};
