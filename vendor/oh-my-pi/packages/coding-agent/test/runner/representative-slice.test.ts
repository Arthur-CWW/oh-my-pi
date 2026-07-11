import { describe, expect, it } from "bun:test";
import { Deferred, Effect, Layer } from "effect";
import {
	InvalidRunnerCommandError,
	RunnerProviderError,
	RunnerRevisionConflictError,
} from "../../src/runner/errors.js";
import { decodeSubmitInputCommand, type DurableRunnerStore, type PreparedDurableInput, type SubmitInputCommand } from "../../src/runner/protocol.js";
import { makeRepresentativeRunner } from "../../src/runner/representative-slice.js";
import { DurableRunnerStoreService, RunnerProviderService, type RunnerProvider } from "../../src/runner/services.js";

class FileBackedRunnerStore implements DurableRunnerStore {
	#path: string;

	constructor(path: string) {
		this.#path = path;
	}

	async #readEntries(): Promise<Record<string, PreparedDurableInput>> {
		try {
			return await Bun.file(this.#path).json();
		} catch {
			return {};
		}
	}

	async load() {
		const entries = await this.#readEntries();
		const prepared = Object.entries(entries);
		return {
			revision: Math.max(0, ...prepared.map(([, input]) => input.revision)),
			receipts: prepared.map(([commandId, input]) => ({
				commandId,
				revision: input.revision,
				inputId: input.inputId,
				sequence: input.sequence,
				replayed: false,
			})),
		};
	}

	async prepare(command: SubmitInputCommand, revision: number): Promise<PreparedDurableInput> {
		const entries = await this.#readEntries();
		const existing = entries[command.commandId];
		if (existing) return { ...existing, replayed: true };
		const prepared = {
			inputId: `input:${Object.keys(entries).length + 1}`,
			sequence: Object.keys(entries).length + 1,
			revision,
			replayed: false,
		};
		entries[command.commandId] = prepared;
		await Bun.write(this.#path, JSON.stringify(entries));
		return prepared;
	}
}

class RecordingProvider implements RunnerProvider {
	readonly calls: Array<string> = [];
	readonly releases: Array<string> = [];
	readonly #gate: Deferred.Deferred<void> | undefined;
	readonly #failure: boolean;

	constructor(options: { readonly gate?: Deferred.Deferred<void>; readonly failure?: boolean } = {}) {
		this.#gate = options.gate;
		this.#failure = options.failure ?? false;
	}

	run(input: PreparedDurableInput) {
		return Effect.acquireRelease(
			Effect.sync(() => this.calls.push(input.inputId)),
			() => Effect.sync(() => this.releases.push(input.inputId)),
		).pipe(
			Effect.andThen(
				this.#failure
					? Effect.fail(new RunnerProviderError({ issue: "provider failed" }))
					: this.#gate
						? Deferred.await(this.#gate)
						: Effect.void,
			),
		);
	}
}

const command = (commandId: string, expectedRevision?: number) => ({
	schemaVersion: 1,
	commandId,
	correlationId: `correlation:${commandId}`,
	expectedRevision,
	kind: "submitInput",
	payload: { text: "hello" },
});

const layerFor = (store: DurableRunnerStore, provider: RunnerProvider) =>
	Layer.merge(
		Layer.succeed(DurableRunnerStoreService, DurableRunnerStoreService.of(store)),
		Layer.succeed(RunnerProviderService, RunnerProviderService.of(provider)),
	);

const uniqueStorePath = () => `/tmp/omp-representative-runner-${crypto.randomUUID()}.json`;

describe("representative Effect runner slice", () => {
	it("rejects malformed envelopes and stale revisions with typed failures", async () => {
		expect(() => decodeSubmitInputCommand({ kind: "submitInput" })).toThrow(InvalidRunnerCommandError);
		const store = new FileBackedRunnerStore(uniqueStorePath());
		const provider = new RecordingProvider();
		const stale = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 });
					yield* runner.submitInput(command("one"));
					return yield* Effect.flip(runner.submitInput(command("stale", 0)));
				}).pipe(Effect.provide(layerFor(store, provider))),
			),
		);
		expect(stale).toBeInstanceOf(RunnerRevisionConflictError);
	});

	it("serializes duplicate command IDs, publishes deterministic causal events, and survives reopen", async () => {
		const path = uniqueStorePath();
		const store = new FileBackedRunnerStore(path);
		const provider = new RecordingProvider();
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 8, eventCapacity: 4 });
					const subscription = yield* runner.subscribe();
					const [first, replay] = yield* Effect.all([runner.submitInput(command("same")), runner.submitInput(command("same"))], {
						concurrency: "unbounded",
					});
					const event = yield* subscription.take;
					const second = yield* runner.submitInput(command("next", 1));
					return { first, replay, second, event };
				}).pipe(Effect.provide(layerFor(store, provider))),
			),
		);
		expect(result.first.revision).toBe(1);
		expect(result.replay.replayed || result.first.replayed).toBe(true);
		expect(result.second.revision).toBe(2);
		expect(result.event).toEqual({
			kind: "event",
			event: expect.objectContaining({ eventId: "inputPrepared:1", correlationId: "correlation:same" }),
		});
		const reopenedProvider = new RecordingProvider();
		const reopened = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 8, eventCapacity: 4 });
					const retry = yield* runner.submitInput(command("next", 1));
					const fresh = yield* runner.submitInput(command("after-reopen", 2));
					return { retry, fresh };
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(path), reopenedProvider))),
			),
		);
		expect(reopened.retry).toMatchObject({ inputId: "input:2", sequence: 2, revision: 2, replayed: true });
		expect(reopened.fresh).toMatchObject({ inputId: "input:3", sequence: 3, revision: 3, replayed: false });
	});

	it("does not let scoped provider work block serialized inspection", async () => {
		const gate = await Effect.runPromise(Deferred.make<void>());
		const provider = new RecordingProvider({ gate });
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 });
					yield* runner.submitInput(command("slow"));
					return yield* runner.inspect();
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), provider))),
			),
		);
		expect(result).toEqual({ revision: 1 });
		expect(provider.releases).toEqual(["input:1"]);
	});

	it("signals resync when a bounded subscription overflows", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 8, eventCapacity: 1 });
					const subscription = yield* runner.subscribe();
					yield* runner.submitInput(command("one"));
					yield* runner.submitInput(command("two"));
					return yield* subscription.take;
				}).pipe(
					Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), new RecordingProvider())),
				),
			),
		);
		expect(result).toEqual({ kind: "resyncRequired", expectedRevision: 1, observedRevision: 2 });
	});

	it("releases provider resources after success, failure, and scope interruption", async () => {
		const success = new RecordingProvider();
		const failure = new RecordingProvider({ failure: true });
		const gate = await Effect.runPromise(Deferred.make<void>());
		const interrupted = new RecordingProvider({ gate });
		for (const [id, provider] of [
			["success", success],
			["failure", failure],
			["interrupted", interrupted],
		] as const) {
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 });
						yield* runner.submitInput(command(id));
						yield* Effect.yieldNow;
					}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), provider))),
				),
			);
		}
		expect(success.releases).toEqual(["input:1"]);
		expect(failure.releases).toEqual(["input:1"]);
		expect(interrupted.releases).toEqual(["input:1"]);
	});
});
