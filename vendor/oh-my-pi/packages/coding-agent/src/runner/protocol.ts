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
	payload: Schema.Struct({
		text: Schema.String,
	}),
});

export type SubmitInputCommand = typeof SubmitInputCommandSchema.Type;

export interface PreparedDurableInput {
	readonly inputId: string;
	readonly sequence: number;
	readonly revision: number;
	readonly replayed: boolean;
}

/**
 * Durable storage is authoritative for submitted obligations. Implementations
 * must make prepare idempotent by commandId across process restarts.
 */
export interface DurableRunnerStore {
	load(): Promise<DurableRunnerSnapshot>;
	prepare(command: SubmitInputCommand, revision: number): Promise<PreparedDurableInput>;
}

export interface RunnerState {
	readonly revision: number;
	readonly processedCommandIds: ReadonlyMap<string, RunnerCommandReceipt>;
}

export interface RunnerCommandReceipt {
	readonly commandId: string;
	readonly revision: number;
	readonly inputId: string;
	readonly sequence: number;
	readonly replayed: boolean;
}

export interface DurableRunnerSnapshot {
	readonly revision: number;
	readonly receipts: ReadonlyArray<RunnerCommandReceipt>;
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

export const emptyRunnerState = (): RunnerState => ({
	revision: 0,
	processedCommandIds: new Map(),
});

/** Pure revision allocation; durable prepare happens before this transition. */
export const transitionPreparedInput = (
	state: RunnerState,
	command: SubmitInputCommand,
	prepared: PreparedDurableInput,
): Transition => {
	const prior = state.processedCommandIds.get(command.commandId);
	if (prior) {
		return {
			state,
			receipt: { ...prior, replayed: true },
			event: undefined,
		};
	}
	if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) {
		throw new RunnerRevisionConflictError({
			expectedRevision: command.expectedRevision,
			actualRevision: state.revision,
		});
	}
	if (prepared.replayed) {
		const receipt: RunnerCommandReceipt = {
			commandId: command.commandId,
			revision: prepared.revision,
			inputId: prepared.inputId,
			sequence: prepared.sequence,
			replayed: true,
		};
		const processedCommandIds = new Map(state.processedCommandIds);
		processedCommandIds.set(command.commandId, receipt);
		return {
			state: { revision: Math.max(state.revision, prepared.revision), processedCommandIds },
			receipt,
			event: undefined,
		};
	}

	const revision = prepared.revision;
	const receipt: RunnerCommandReceipt = {
		commandId: command.commandId,
		revision,
		inputId: prepared.inputId,
		sequence: prepared.sequence,
		replayed: false,
	};
	const processedCommandIds = new Map(state.processedCommandIds);
	processedCommandIds.set(command.commandId, receipt);
	return {
		state: { revision, processedCommandIds },
		receipt,
		event: {
			schemaVersion: RUNNER_SCHEMA_VERSION,
			revision,
			eventId: `inputPrepared:${revision}`,
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
		return (() => {
			throw new InvalidRunnerCommandError({
				issue: error instanceof Error ? error.message : "Schema decoding failed",
			});
		})();
	}
};
