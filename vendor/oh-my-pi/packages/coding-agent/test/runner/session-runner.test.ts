import { describe, expect, it } from "bun:test";
import { open, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import {
	DurableRunnerStoreError,
	InvalidRunnerCommandError,
	RunnerControllerConflictError,
	RunnerRevisionConflictError,
	StaleRunnerControllerLeaseError,
} from "../../src/runner/errors";
import {
	decodeSubmitInputCommand,
	type AttachRunnerViewCommand,
	type DurableInputRecord,
	type DurableRunnerSnapshot,
	type DurableRunnerStore,
	type PreparedDurableInput,
	type RunnerControlMetadata,
	type SubmitInputCommand,
} from "../../src/runner/protocol";
import { makeSessionRunner } from "../../src/runner/session-runner";
import { DurableRunnerStoreService, RunnerProviderService, type RunnerProvider } from "../../src/runner/services";

interface FileState {
	revision: number;
	nextSequence: number;
	records: Record<string, DurableInputRecord>;
}

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
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { revision: 0, nextSequence: 0, records: {} };
			}
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
				throw new RunnerRevisionConflictError({ expectedRevision, actualRevision: state.revision });
			}
			const revision = state.revision + 1;
			const sequence = state.nextSequence + 1;
			const receipt = {
				commandId: command.commandId,
				correlationId: command.correlationId,
				causationId: command.causationId,
				controllerEpoch: command.controllerEpoch,
				inputId: `input:${sequence}`,
				sequence,
				revision,
			};
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
	readonly #releaseGate: Deferred.Deferred<void> | undefined;
	readonly #releaseStarted: Deferred.Deferred<void> | undefined;

	constructor(
		options: {
			readonly gate?: Deferred.Deferred<void>;
			readonly called?: Deferred.Deferred<void>;
			readonly releaseGate?: Deferred.Deferred<void>;
			readonly releaseStarted?: Deferred.Deferred<void>;
		} = {},
	) {
		this.#gate = options.gate;
		this.#called = options.called;
		this.#releaseGate = options.releaseGate;
		this.#releaseStarted = options.releaseStarted;
	}

	run(input: PreparedDurableInput) {
		const releaseStarted = this.#releaseStarted;
		const releaseGate = this.#releaseGate;
		const releases = this.releases;
		return Effect.acquireRelease(
			Effect.sync(() => {
				this.calls.push(input.inputId);
				return input.inputId;
			}).pipe(Effect.tap(() => (this.#called ? Deferred.succeed(this.#called, undefined) : Effect.void))),
			(inputId) =>
				Effect.gen(function* () {
					if (releaseStarted) yield* Deferred.succeed(releaseStarted, undefined);
					if (releaseGate) yield* Deferred.await(releaseGate);
					releases.push(inputId);
				}),
		).pipe(Effect.andThen(this.#gate ? Deferred.await(this.#gate) : Effect.void));
	}
}

const uniqueStorePath = () => `/tmp/omp-session-runner-${crypto.randomUUID()}.json`;

const layerFor = (store: DurableRunnerStore, provider: RunnerProvider) =>
	Layer.merge(
		Layer.succeed(DurableRunnerStoreService, DurableRunnerStoreService.of(store)),
		Layer.succeed(RunnerProviderService, RunnerProviderService.of(provider)),
	);

const metadata = (commandId: string, expectedRevision: number): RunnerControlMetadata => ({
	schemaVersion: 1,
	commandId,
	correlationId: `correlation:${commandId}`,
	expectedRevision,
});

const attach = (
	viewId: string,
	capability: "observer" | "controller",
	expectedRevision: number,
): AttachRunnerViewCommand => ({
	...metadata(`attach:${viewId}`, expectedRevision),
	kind: "attachView",
	viewId,
	capability,
});

const submit = (viewId: string, controllerEpoch: number, commandId: string, expectedRevision: number) =>
	decodeSubmitInputCommand({
		...metadata(commandId, expectedRevision),
		kind: "submitInput",
		viewId,
		controllerEpoch,
		payload: { text: commandId },
	});

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
	if (Exit.isSuccess(exit)) return undefined;
	const failure = Cause.findErrorOption(exit.cause);
	return failure._tag === "Some" ? failure.value : undefined;
};

describe("SessionRunner view ownership", () => {
	it("supports observers, exclusive controller release/reacquire, and stale-lease fencing", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 8, eventCapacity: 16 });
					const observerA = yield* runner.attachView(attach("observer-a", "observer", 0));
					const observerB = yield* runner.attachView(attach("observer-b", "observer", 0));
					const controller = yield* runner.attachView(attach("controller", "controller", 0));
					if (observerA.capability !== "observer" || observerB.capability !== "observer") {
						throw new Error("Expected observer views");
					}
					if (controller.capability !== "controller") throw new Error("Expected controller view");
					const conflict = yield* Effect.exit(
						observerA.acquireController({
							...metadata("acquire:observer-a", 0),
							kind: "acquireController",
							viewId: observerA.viewId,
						}),
					);
					const released = yield* controller.releaseController({
						...metadata("release:controller", 0),
						kind: "releaseController",
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					const reacquired = yield* observerB.acquireController({
						...metadata("acquire:observer-b", 0),
						kind: "acquireController",
						viewId: observerB.viewId,
					});
					const stale = yield* Effect.exit(controller.submitInput(submit("controller", controller.controllerEpoch, "stale", 0)));
					return {
						conflict: firstFailure(conflict),
						stale: firstFailure(stale),
						releasedCapability: released.capability,
						reacquiredEpoch: reacquired.controllerEpoch,
						snapshot: yield* runner.snapshot(),
					};
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), new RecordingProvider()))),
			),
		);
		expect(result.conflict).toBeInstanceOf(RunnerControllerConflictError);
		expect(result.stale).toBeInstanceOf(StaleRunnerControllerLeaseError);
		expect(result.releasedCapability).toBe("observer");
		expect(result.reacquiredEpoch).toBe(2);
		expect(result.snapshot).toMatchObject({ revision: 0, durableSequence: 0, status: "running" });
		expect(result.snapshot.views).toHaveLength(3);
		expect(result.snapshot.controller).toEqual({ viewId: "observer-b", epoch: 2 });
	});

	it("keeps the runner and provider alive on view close, then stop interrupts and releases exactly once", async () => {
		const gate = await Effect.runPromise(Deferred.make<void>());
		const called = await Effect.runPromise(Deferred.make<void>());
		const provider = new RecordingProvider({ gate, called });
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 8, eventCapacity: 8 });
					const observer = yield* runner.attachView(attach("observer", "observer", 0));
					const controller = yield* runner.attachView(attach("controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("Expected controller view");
					yield* controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "slow", 0));
					yield* Deferred.await(called);
					yield* controller.close({
						...metadata("detach:controller", 1),
						kind: "detachView",
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					const beforeStop = yield* observer.snapshot();
					const releasesBeforeStop = [...provider.releases];
					yield* runner.stop();
					yield* runner.stop();
					return { beforeStop, releasesBeforeStop, afterStop: yield* runner.snapshot() };
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), provider))),
			),
		);
		expect(result.beforeStop.status).toBe("running");
		expect(result.beforeStop.views.map((view) => view.viewId)).toEqual(["observer"]);
		expect(result.releasesBeforeStop).toEqual([]);
		expect(provider.releases).toEqual(["input:1"]);
		expect(result.afterStop.status).toBe("stopped");
		expect(result.afterStop.records[0]?.dispatchState).toBe("uncertain");
	});

	it("finishes shutdown exactly once when the stopping leader is cancelled", async () => {
		const gate = await Effect.runPromise(Deferred.make<void>());
		const called = await Effect.runPromise(Deferred.make<void>());
		const releaseStarted = await Effect.runPromise(Deferred.make<void>());
		const releaseGate = await Effect.runPromise(Deferred.make<void>());
		const provider = new RecordingProvider({ gate, called, releaseStarted, releaseGate });
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 8, eventCapacity: 8 });
					const controller = yield* runner.attachView(attach("controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("Expected controller view");
					yield* controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "slow", 0));
					yield* Deferred.await(called);
					yield* runner.snapshot();

					const stopping = yield* Effect.forkScoped(runner.stop());
					yield* Deferred.await(releaseStarted);
					yield* Effect.sync(() => stopping.interruptUnsafe());
					const following = yield* Effect.forkScoped(runner.stop(), { startImmediately: true });
					yield* Deferred.succeed(releaseGate, undefined);

					const [stoppingExit, followingExit] = yield* Effect.all(
						[Fiber.await(stopping), Fiber.await(following)],
						{ concurrency: "unbounded" },
					);
					yield* runner.stop();
					return { stoppingExit, followingExit, snapshot: yield* runner.snapshot() };
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), provider))),
			),
		);
		expect(Exit.isFailure(result.stoppingExit) && Cause.hasInterruptsOnly(result.stoppingExit.cause)).toBe(true);
		expect(Exit.isSuccess(result.followingExit)).toBe(true);
		expect(provider.releases).toEqual(["input:1"]);
		expect(result.snapshot.status).toBe("stopped");
		expect(result.snapshot.records[0]?.dispatchState).toBe("uncertain");
	});

	it("serializes concurrent controller submissions into one durable CAS order", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 8, eventCapacity: 8 });
					const view = yield* runner.attachView(attach("controller", "controller", 0));
					if (view.capability !== "controller") throw new Error("Expected controller view");
					const outcomes = yield* Effect.all(
						[
							Effect.exit(view.submitInput(submit(view.viewId, view.controllerEpoch, "one", 0))),
							Effect.exit(view.submitInput(submit(view.viewId, view.controllerEpoch, "two", 0))),
						],
						{ concurrency: "unbounded" },
					);
					const next = yield* view.submitInput(submit(view.viewId, view.controllerEpoch, "three", 1));
					return { outcomes, next, snapshot: yield* runner.snapshot() };
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), new RecordingProvider()))),
			),
		);
		expect(result.outcomes.filter(Exit.isSuccess)).toHaveLength(1);
		expect(result.outcomes.map(firstFailure).filter((error) => error instanceof RunnerRevisionConflictError)).toHaveLength(1);
		expect(result.next).toMatchObject({ revision: 2, sequence: 2 });
		expect(result.snapshot.records.map((record) => record.receipt.sequence)).toEqual([1, 2]);
	});

	it("does not let a slow provider block observation or controller release", async () => {
		const gate = await Effect.runPromise(Deferred.make<void>());
		const called = await Effect.runPromise(Deferred.make<void>());
		const provider = new RecordingProvider({ gate, called });
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 8, eventCapacity: 8 });
					const observer = yield* runner.attachView(attach("observer", "observer", 0));
					const controller = yield* runner.attachView(attach("controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("Expected controller view");
					yield* controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "slow", 0));
					yield* Deferred.await(called);
					const released = yield* controller.releaseController({
						...metadata("release:controller", 1),
						kind: "releaseController",
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
					});
					const snapshot = yield* observer.snapshot();
					yield* runner.stop();
					return { released: released.capability, snapshot };
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), provider))),
			),
		);
		expect(result.released).toBe("observer");
		expect(result.snapshot.records[0]?.dispatchState).toBe("dispatched");
	});

	it("recovers prepared work and exposes already-dispatched work as uncertain without duplication", async () => {
		const preparedStore = new FileBackedRunnerStore(uniqueStorePath());
		const preparedCommand = submit("controller", 1, "prepared", 0);
		await preparedStore.prepare(preparedCommand, 0);
		const preparedProvider = new RecordingProvider();
		const preparedProof = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 4, eventCapacity: 4 });
					let snapshot = yield* runner.snapshot();
					while (snapshot.records[0]?.dispatchState !== "completed") {
						yield* Effect.yieldNow;
						snapshot = yield* runner.snapshot();
					}
					return snapshot;
				}).pipe(Effect.provide(layerFor(preparedStore, preparedProvider))),
			),
		);

		const uncertainStore = new FileBackedRunnerStore(uniqueStorePath());
		const uncertainCommand = submit("controller", 1, "uncertain", 0);
		await uncertainStore.prepare(uncertainCommand, 0);
		await uncertainStore.beginDispatch(uncertainCommand.commandId);
		const uncertainProvider = new RecordingProvider();
		const uncertainProof = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 4, eventCapacity: 4 });
					return yield* runner.snapshot();
				}).pipe(Effect.provide(layerFor(uncertainStore, uncertainProvider))),
			),
		);
		expect(preparedProvider.calls).toEqual(["input:1"]);
		expect(preparedProof.records[0]?.dispatchState).toBe("completed");
		expect(uncertainProvider.calls).toEqual([]);
		expect(uncertainProof.records[0]?.dispatchState).toBe("uncertain");
	});

	it("returns the consumed event and a current snapshot after a bounded subscription gap", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 8, eventCapacity: 1 });
					const observer = yield* runner.attachView(attach("observer", "observer", 0));
					const subscription = yield* observer.subscribe();
					const controller = yield* runner.attachView(attach("controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("Expected controller view");
					yield* controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "one", 0));
					let snapshot = yield* runner.snapshot();
					while (snapshot.records[0]?.dispatchState !== "completed") {
						yield* Effect.yieldNow;
						snapshot = yield* runner.snapshot();
					}
					return yield* subscription.take;
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(uniqueStorePath()), new RecordingProvider()))),
			),
		);
		expect(result.kind).toBe("resyncRequired");
		if (result.kind !== "resyncRequired") throw new Error("Expected resync delivery");
		expect(result.observedSequence).toBeGreaterThan(result.expectedSequence);
		expect(result.event.kind).toBe("inputCompleted");
		expect(result.snapshot.records[0]?.dispatchState).toBe("completed");
	});

	it("removes a cancelled full-mailbox offer without leaking pending operations", async () => {
		const path = uniqueStorePath();
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runner = yield* makeSessionRunner({ mailboxCapacity: 1, eventCapacity: 8 });
					const controller = yield* runner.attachView(attach("controller", "controller", 0));
					if (controller.capability !== "controller") throw new Error("Expected controller view");
					const lock = yield* Effect.promise(() => open(`${path}.lock`, "wx"));
					const first = yield* Effect.forkScoped(
						controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "first", 0)),
						{ startImmediately: true },
					);
					yield* Effect.yieldNow;
					const second = yield* Effect.forkScoped(
						controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "second", 0)),
						{ startImmediately: true },
					);
					yield* Effect.yieldNow;
					const cancelled = yield* Effect.forkScoped(
						controller.submitInput(submit(controller.viewId, controller.controllerEpoch, "cancelled", 0)),
						{ startImmediately: true },
					);
					yield* Effect.yieldNow;
					yield* Fiber.interrupt(cancelled);
					yield* Effect.promise(async () => {
						await lock.close();
						await unlink(`${path}.lock`);
					});
					yield* Fiber.await(first);
					yield* Fiber.await(second);
					return yield* runner.snapshot();
				}).pipe(Effect.provide(layerFor(new FileBackedRunnerStore(path), new RecordingProvider()))),
			),
		);
		expect(result.pendingOperations).toBe(0);
		expect(result.records).toHaveLength(1);
		expect(result.records[0]?.receipt.commandId).toBe("first");
	});

	it("fails typed on corrupt durable state and rejects malformed submit envelopes", async () => {
		expect(() => decodeSubmitInputCommand({ kind: "submitInput" })).toThrow(InvalidRunnerCommandError);
		const path = uniqueStorePath();
		await Bun.write(path, "{truncated");
		const failure = await Effect.runPromise(
			Effect.scoped(
				Effect.flip(
					makeSessionRunner({ mailboxCapacity: 4, eventCapacity: 4 }).pipe(
						Effect.provide(layerFor(new FileBackedRunnerStore(path), new RecordingProvider())),
					),
				),
			),
		);
		expect(failure).toBeInstanceOf(DurableRunnerStoreError);
	});
});
