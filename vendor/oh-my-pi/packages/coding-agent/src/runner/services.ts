import { Context, Effect, Scope } from "effect";
import { DurableRunnerStoreError, RunnerProviderError } from "./errors.js";
import type { DurableRunnerStore, PreparedDurableInput, SubmitInputCommand } from "./protocol.js";

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


export const loadDurableRunnerSnapshot = Effect.fn("Runner.loadDurableRunnerSnapshot")(function* () {
	const store = yield* DurableRunnerStoreService;
	return yield* Effect.tryPromise({
		try: () => store.load(),
		catch: (error) =>
			new DurableRunnerStoreError({
				issue: error instanceof Error ? error.message : "Durable state loading failed",
			}),
	});
});
export const prepareDurableInput = Effect.fn("Runner.prepareDurableInput")(function* (
	command: SubmitInputCommand,
	revision: number,
) {
	const store = yield* DurableRunnerStoreService;
	return yield* Effect.tryPromise({
		try: () => store.prepare(command, revision),
		catch: (error) =>
			new DurableRunnerStoreError({
				issue: error instanceof Error ? error.message : "Durable preparation failed",
			}),
	});
});
