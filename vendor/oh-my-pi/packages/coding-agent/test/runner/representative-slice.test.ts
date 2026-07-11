import { describe, expect, it } from "bun:test";
import { open, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import {
	DurableRunnerStoreError,
	InvalidRunnerCommandError,
	RunnerProviderError,
	RunnerRevisionConflictError,
} from "../../src/runner/errors.js";
import {
	decodeSubmitInputCommand,
	type DurableInputRecord,
	type DurableRunnerSnapshot,
	type DurableRunnerStore,
	type PreparedDurableInput,
	type SubmitInputCommand,
} from "../../src/runner/protocol.js";
import { makeRepresentativeRunner } from "../../src/runner/representative-slice.js";
import { DurableRunnerStoreService, RunnerProviderService, type RunnerProvider } from "../../src/runner/services.js";

interface FileState {
	revision: number;
	nextSequence: number;
	records: Record<string, DurableInputRecord>;
}

const emptyFileState = (): FileState => ({ revision: 0, nextSequence: 0, records: {} });

class FileBackedRunnerStore implements DurableRunnerStore {
	readonly #path: string;
	readonly #lockPath: string;

	constructor(path: string) {
		this.#path = path;
		this.#lockPath = `${path}.lock`;
	}

	async #readState(): Promise<FileState> {
		let text: string;
		try {
			text = await readFile(this.#path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFileState();
			throw error;
		}
		const parsed: unknown = JSON.parse(text);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as FileState).revision !== "number" ||
			typeof (parsed as FileState).nextSequence !== "number" ||
			typeof (parsed as FileState).records !== "object" ||
			(parsed as FileState).records === null
		) {
			throw new Error("Corrupt durable runner state");
		}
		return parsed as FileState;
	}

	async #writeState(state: FileState): Promise<void> {
		const temporaryPath = `${this.#path}.${crypto.randomUUID()}.tmp`;
		const file = await open(temporaryPath, "wx");
		try {
			await file.writeFile(JSON.stringify(state), "utf8");
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporaryPath, this.#path);
		const directory = await open(dirname(this.#path), "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	}

	async #withLock<A>(transaction: () => Promise<A>): Promise<A> {
		let lock: FileHandle;
		for (;;) {
			try {
				lock = await open(this.#lockPath, "wx");
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				await yieldEventLoop();
			}
		}
		try {
			return await transaction();
		} finally {
			await lock.close();
			await unlink(this.#lockPath);
		}
	}

	async load(): Promise<DurableRunnerSnapshot> {
		const state = await this.#readState();
		return {
			revision: state.revision,
			records: Object.values(state.records).sort((left, right) => left.receipt.sequence - right.receipt.sequence),
		};
	}

	async prepare(command: SubmitInputCommand, expectedRevision: number): Promise<PreparedDurableInput> {
		return this.#withLock(async () => {
			const state = await this.#readState();
			const existing = state.records[command.commandId];
			if (existing) return { ...existing.receipt, replayed: true };
			if (state.revision !== expectedRevision) {
				throw new RunnerRevisionConflictError({
					expectedRevision,
					actualRevision: state.revision,
				});
			}
			const revision = state.revision + 1;
			const sequence = state.nextSequence + 1;
			const receipt = { commandId: command.commandId, inputId: `input:${sequence}`, sequence, revision };
			state.revision = revision;
			state.nextSequence = sequence;
			state.records[command.commandId] = { command, receipt, dispatchState: "prepared" };
			await this.#writeState(state);
			return { ...receipt, replayed: false };
		});
	}

	async beginDispatch(commandId: string): Promise<DurableInputRecord | undefined> {
		return this.#withLock(async () => {
			const state = await this.#readState();
			const record = state.records[commandId];
			if (!record || record.dispatchState !== "prepared") return undefined;
			const dispatched: DurableInputRecord = { ...record, dispatchState: "dispatched" };
			state.records[commandId] = dispatched;
			await this.#writeState(state);
			return dispatched;
		});
	}

	async finishDispatch(commandId: string, dispatchState: "completed" | "uncertain"): Promise<void> {
		await this.#withLock(async () => {
			const state = await this.#readState();
			const record = state.records[commandId];
			if (!record) throw new Error(`Unknown durable input ${commandId}`);
			if (record.dispatchState === dispatchState) return;
			if (record.dispatchState !== "dispatched") {
				throw new Error(`Cannot finish ${commandId} from ${record.dispatchState}`);
			}
			state.records[commandId] = { ...record, dispatchState };
			await this.#writeState(state);
		});
	}
}

class RecordingProvider implements RunnerProvider {
	readonly calls: Array<string> = [];
	readonly releases: Array<string> = [];
	readonly #gate: Deferred.Deferred<void> | undefined;
	readonly #called: Deferred.Deferred<void> | undefined;
	readonly #released: Deferred.Deferred<void> | undefined;
	readonly #failure: boolean;

	constructor(
		options: {
			readonly gate?: Deferred.Deferred<void>;
			readonly called?: Deferred.Deferred<void>;
			readonly released?: Deferred.Deferred<void>;
			readonly failure?: boolean;
		} = {},
	) {
		this.#gate = options.gate;
		this.#called = options.called;
		this.#released = options.released;
		this.#failure = options.failure ?? false;
	}

	run(input: PreparedDurableInput) {
		const acquire = Effect.sync(() => this.calls.push(input.inputId)).pipe(
			Effect.andThen(this.#called ? Deferred.succeed(this.#called, undefined) : Effect.void),
			Effect.as(input.inputId),
		);
		return Effect.acquireRelease(acquire, (inputId) =>
			Effect.sync(() => this.releases.push(inputId)).pipe(
				Effect.andThen(this.#released ? Deferred.succeed(this.#released, undefined) : Effect.void),
			),
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

const command = (commandId: string, expectedRevision?: number): SubmitInputCommand =>
	decodeSubmitInputCommand({
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
		const stale = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 });
					yield* runner.submitInput(command("one"));
					return yield* Effect.flip(runner.submitInput(command("stale", 0)));
				}).pipe(
					Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), new RecordingProvider())),
				),
			),
		);
		expect(stale).toBeInstanceOf(RunnerRevisionConflictError);
	});

	it("is idempotent, emits causal events, and atomically preserves receipts across reopen", async () => {
		const path = uniqueStorePath();
		const firstRun = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 8, eventCapacity: 4 });
					const subscription = yield* runner.subscribe();
					const [first, replay] = yield* Effect.all(
						[runner.submitInput(command("same")), runner.submitInput(command("same"))],
						{ concurrency: "unbounded" },
					);
					return { first, replay, event: yield* subscription.take };
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(path), new RecordingProvider()))),
			),
		);
		expect(firstRun.first.revision).toBe(1);
		expect(firstRun.replay.replayed || firstRun.first.replayed).toBe(true);
		expect(firstRun.event).toEqual({
			kind: "event",
			event: expect.objectContaining({ eventId: "inputPrepared:1", correlationId: "correlation:same" }),
		});

		const reopened = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 8, eventCapacity: 4 });
					const retry = yield* runner.submitInput(command("same", 1));
					const fresh = yield* runner.submitInput(command("after-reopen", 1));
					return { retry, fresh, inspection: yield* runner.inspect() };
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(path), new RecordingProvider()))),
			),
		);
		expect(reopened.retry).toMatchObject({ inputId: "input:1", sequence: 1, revision: 1, replayed: true });
		expect(reopened.fresh).toMatchObject({ inputId: "input:2", sequence: 2, revision: 2, replayed: false });
		expect(reopened.inspection.records.map((record) => record.receipt.commandId)).toEqual(["same", "after-reopen"]);
	});

	it("reconciles a crash after durable prepare without replay suppressing dispatch", async () => {
		const store = new FileBackedRunnerStore(uniqueStorePath());
		await store.prepare(command("crashed"), 0);
		const called = await Effect.runPromise(Deferred.make<void>());
		const released = await Effect.runPromise(Deferred.make<void>());
		const provider = new RecordingProvider({ called, released });
		const proof = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 });
					yield* Deferred.await(called);
					yield* Deferred.await(released);
					const replay = yield* runner.submitInput(command("crashed"));
					let inspection = yield* runner.inspect();
					while (inspection.records[0]?.dispatchState !== "completed") {
						yield* Effect.yieldNow;
						inspection = yield* runner.inspect();
					}
					return { replay, inspection, releasesBeforeClose: [...provider.releases] };
				}).pipe(Effect.provide(layerFor(store, provider))),
			),
		);
		expect(provider.calls).toEqual(["input:1"]);
		expect(proof.replay.replayed).toBe(true);
		expect(proof.releasesBeforeClose).toEqual(["input:1"]);
		expect(proof.inspection.records[0]?.dispatchState).toBe("completed");
	});

	it("closes each provider call scope before the runner closes on success and failure", async () => {
		const successReleased = await Effect.runPromise(Deferred.make<void>());
		const failureReleased = await Effect.runPromise(Deferred.make<void>());
		const success = new RecordingProvider({ released: successReleased });
		const failure = new RecordingProvider({ released: failureReleased, failure: true });
		const beforeRunnerClose = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const successRunner = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 }).pipe(
						Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), success)),
					);
					const failureRunner = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 }).pipe(
						Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), failure)),
					);
					yield* successRunner.submitInput(command("success"));
					yield* failureRunner.submitInput(command("failure"));
					yield* Deferred.await(successReleased);
					yield* Deferred.await(failureReleased);
					return { success: [...success.releases], failure: [...failure.releases] };
				}),
			),
		);
		expect(beforeRunnerClose).toEqual({ success: ["input:1"], failure: ["input:1"] });
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
				}).pipe(
					Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), provider)),
				),
			),
		);
		expect(result.revision).toBe(1);
		expect(result.records[0]?.dispatchState).toBe("dispatched");
		expect(provider.releases).toEqual(["input:1"]);
	});

	it("returns the consumed event when a bounded subscription requires resync", async () => {
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
		expect(result).toEqual({
			kind: "resyncRequired",
			expectedRevision: 1,
			observedRevision: 2,
			event: expect.objectContaining({ commandId: "two", sequence: 2, revision: 2 }),
		});
	});

	it("fences two runner authorities so only one commits a raced next revision", async () => {
		const path = uniqueStorePath();
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const provider = new RecordingProvider();
					const runnerA = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 }).pipe(
						Effect.provide(layerFor(new FileBackedRunnerStore(path), provider)),
					);
					const runnerB = yield* makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 }).pipe(
						Effect.provide(layerFor(new FileBackedRunnerStore(path), provider)),
					);
					const outcomes = yield* Effect.all(
						[
							runnerA.submitInput(command("authority-a")).pipe(Effect.exit),
							runnerB.submitInput(command("authority-b")).pipe(Effect.exit),
						],
						{ concurrency: "unbounded" },
					);
					return { outcomes, inspection: yield* runnerA.inspect() };
				}),
			),
		);
		expect(result.outcomes.filter(Exit.isSuccess)).toHaveLength(1);
		const failure = result.outcomes.find(Exit.isFailure);
		expect(failure && failure.cause.reasons.some((reason) => reason._tag === "Fail" && reason.error instanceof RunnerRevisionConflictError)).toBe(true);
		expect(result.inspection).toMatchObject({ revision: 1 });
		expect(result.inspection.records).toHaveLength(1);
		expect(result.inspection.records[0]?.receipt.sequence).toBe(1);
	});

	it("removes an interrupted full-mailbox offer from the pending table", async () => {
		const path = uniqueStorePath();
		const store = new FileBackedRunnerStore(path);
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeRepresentativeRunner({ mailboxCapacity: 1, eventCapacity: 4 });
					const lock = yield* Effect.promise(() => open(`${path}.lock`, "wx"));
					const first = yield* Effect.forkScoped(runner.submitInput(command("first")), { startImmediately: true });
					yield* Effect.yieldNow;
					const second = yield* Effect.forkScoped(runner.submitInput(command("second")), { startImmediately: true });
					yield* Effect.yieldNow;
					const interrupted = yield* Effect.forkScoped(runner.submitInput(command("interrupted")), {
						startImmediately: true,
					});
					yield* Effect.yieldNow;
					yield* Fiber.interrupt(interrupted);
					yield* Effect.promise(async () => {
						await lock.close();
						await unlink(`${path}.lock`);
					});
					yield* Fiber.join(first);
					yield* Fiber.join(second);
					return yield* runner.inspect();
				}).pipe(Effect.provide(layerFor(store, new RecordingProvider()))),
			),
		);
		expect(result.pendingOperations).toBe(0);
		expect(result.records.map((record) => record.receipt.commandId)).toEqual(["first", "second"]);
	});

	it("fails typed on corrupt durable state instead of resetting it", async () => {
		const path = uniqueStorePath();
		await Bun.write(path, "{truncated");
		const failure = await Effect.runPromise(
			Effect.scoped(
				makeRepresentativeRunner({ mailboxCapacity: 4, eventCapacity: 4 }).pipe(
					Effect.provide(layerFor(new FileBackedRunnerStore(path), new RecordingProvider())),
					Effect.flip,
				),
			),
		);
		expect(failure).toBeInstanceOf(DurableRunnerStoreError);
	});
});
