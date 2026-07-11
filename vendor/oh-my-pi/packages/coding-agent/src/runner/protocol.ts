import { Schema } from "effect";
import { InvalidRunnerCommandError, RunnerRevisionConflictError } from "./errors.js";

export { InvalidRunnerCommandError, RunnerRevisionConflictError } from "./errors.js";

export const RUNNER_SCHEMA_VERSION = 1 as const;

export const RunnerRevisionSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	Schema.brand("RunnerRevision"),
);

export const SubmitInputCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(RUNNER_SCHEMA_VERSION),
	commandId: Schema.String,
	correlationId: Schema.String,
	causationId: Schema.optional(Schema.String),
	expectedRevision: Schema.optional(RunnerRevisionSchema),
	kind: Schema.Literal("submitInput"),
	payload: Schema.Struct({ text: Schema.String }),
});

export type SubmitInputCommand = typeof SubmitInputCommandSchema.Type;

export interface PreparedDurableInput {
	readonly commandId: string;
	readonly inputId: string;
	readonly sequence: number;
	readonly revision: number;
	readonly replayed: boolean;
}

export interface RunnerCommandReceipt {
	readonly commandId: string;
	readonly revision: number;
	readonly inputId: string;
	readonly sequence: number;
	readonly replayed: boolean;
}

/**
 * `prepared` has not crossed the provider boundary and is safe to dispatch.
 * `dispatched` crossed that boundary but has no durable outcome yet, so a
 * reopened runner must expose it without retrying an uncertain side effect.
 */
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
 * Every mutating method is a durable transaction. `prepare` must atomically
 * compare `expectedRevision`, allocate the next revision and sequence, and
 * persist both the receipt and a prepared dispatch obligation. `beginDispatch`
 * is a prepared-to-dispatched CAS; only its winner may call the provider.
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

export interface RunnerEvent {
	readonly schemaVersion: typeof RUNNER_SCHEMA_VERSION;
	readonly revision: number;
	readonly kind: "inputPrepared";
	readonly eventId: string;
	readonly commandId: string;
	readonly correlationId: string;
	readonly causationId: string | undefined;
	readonly inputId: string;
	readonly sequence: number;
}

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
): Transition => {
	const prior = state.processedCommandIds.get(command.commandId);
	if (prior) {
		return { state, receipt: { ...prior, replayed: true }, event: undefined };
	}

	const receipt: RunnerCommandReceipt = {
		commandId: command.commandId,
		revision: prepared.revision,
		inputId: prepared.inputId,
		sequence: prepared.sequence,
		replayed: prepared.replayed,
	};
	const processedCommandIds = new Map(state.processedCommandIds);
	processedCommandIds.set(command.commandId, receipt);
	return {
		state: { revision: Math.max(state.revision, prepared.revision), processedCommandIds },
		receipt,
		event: prepared.replayed
			? undefined
			: {
					schemaVersion: RUNNER_SCHEMA_VERSION,
					revision: prepared.revision,
					eventId: `inputPrepared:${prepared.revision}`,
					kind: "inputPrepared",
					commandId: command.commandId,
					correlationId: command.correlationId,
					causationId: command.causationId,
					inputId: prepared.inputId,
					sequence: prepared.sequence,
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
