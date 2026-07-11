import { Context, Effect, Scope } from "effect";
import {
	DurableRunnerStoreError,
	RunnerProviderError,
	RunnerRevisionConflictError,
} from "./errors";
import type {
	DurableDispatchState,
	DurableRunnerStore,
	PreparedDurableInput,
	SubmitInputCommand,
} from "./protocol";

export class DurableRunnerStoreService extends Context.Service<
	DurableRunnerStoreService,
	DurableRunnerStore
>()("@oh-my-pi/coding-agent/runner/DurableRunnerStore") {}

export interface RunnerProvider {
	readonly run: (input: PreparedDurableInput) => Effect.Effect<void, RunnerProviderError, Scope.Scope>;
}

export class RunnerProviderService extends Context.Service<RunnerProviderService, RunnerProvider>()(
	"@oh-my-pi/coding-agent/runner/RunnerProvider",
) {}

const storeFailure = (error: unknown): DurableRunnerStoreError | RunnerRevisionConflictError => {
	if (error instanceof RunnerRevisionConflictError) return error;
	return new DurableRunnerStoreError({
		issue: error instanceof Error ? error.message : "Durable store operation failed",
	});
};

export const loadDurableRunnerSnapshot = Effect.fn("Runner.loadDurableRunnerSnapshot")(function* () {
	const store = yield* DurableRunnerStoreService;
	return yield* Effect.tryPromise({ try: () => store.load(), catch: storeFailure });
});

export const prepareDurableInput = Effect.fn("Runner.prepareDurableInput")(function* (
	command: SubmitInputCommand,
	expectedRevision: number,
) {
	const store = yield* DurableRunnerStoreService;
	return yield* Effect.tryPromise({
		try: () => store.prepare(command, expectedRevision),
		catch: storeFailure,
	});
});

export const beginDurableDispatch = Effect.fn("Runner.beginDurableDispatch")(function* (commandId: string) {
	const store = yield* DurableRunnerStoreService;
	return yield* Effect.tryPromise({ try: () => store.beginDispatch(commandId), catch: storeFailure });
});

export const finishDurableDispatch = Effect.fn("Runner.finishDurableDispatch")(function* (
	commandId: string,
	state: Extract<DurableDispatchState, "completed" | "uncertain">,
) {
	const store = yield* DurableRunnerStoreService;
	yield* Effect.tryPromise({ try: () => store.finishDispatch(commandId, state), catch: storeFailure });
});
