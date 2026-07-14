import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
	createUniqueRevisionLoader,
	DisposableTerminalHost,
	type DisposableTerminalHostCallbacks,
	type DisposableTerminalRevision,
	type DisposableTerminalViewFactory,
} from "../../src/modes/disposable-terminal-host";
import type { TerminalSessionController } from "../../src/modes/terminal-session-controller";
import type { SessionRunner } from "../../src/runner/session-runner";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function harness(
	loader: { load: (revision: DisposableTerminalRevision) => Promise<DisposableTerminalViewFactory> },
	resolveRevision?: () => Promise<DisposableTerminalRevision>,
) {
	let runnerStops = 0;
	let controllerEpoch = 0;
	const closedControllers: number[] = [];
	const runner = {
		stop: () =>
			Effect.sync(() => {
				runnerStops++;
			}),
	} as unknown as SessionRunner;
	const host = new DisposableTerminalHost({
		runner,
		loader,
		resolveRevision,
		createController: async () => {
			const epoch = ++controllerEpoch;
			return {
				epoch,
				viewId: `view-${epoch}`,
				prepareHostTransition: async intent => ({
					commandId: `prepare-${epoch}`,
					correlationId: `prepare-${epoch}`,
					startedSessionRevision: 0,
					operationGeneration: epoch,
					completedSessionRevision: 0,
					intent,
					target: {
						sessionId: "session-b",
						cwd: "/tmp",
					},
					...(intent.kind === "restartProcess"
						? { restartSpawn: { executable: "/bin/omp", args: ["--resume", "session-b"], cwd: "/tmp" } }
						: {}),
					cancelled: false,
					replayed: false,
				}),
				close: async () => {
					closedControllers.push(epoch);
				},
			} as TerminalSessionController;
		},
	});
	return {
		host,
		closedControllers,
		get runnerStops() {
			return runnerStops;
		},
	};
}

describe("DisposableTerminalHost", () => {
	test("keeps the runner and held provider turn alive across revision replacement", async () => {
		let finishTurn: (() => void) | undefined;
		const heldTurn = new Promise<void>(resolve => {
			finishTurn = resolve;
		});
		const lifecycle: string[] = [];
		const sessionIdentity = {};
		const observations: Array<{ name: string; identity: object; completed: boolean }> = [];
		let completed = false;
		void heldTurn.then(() => {
			completed = true;
		});
		const factories: Record<string, DisposableTerminalViewFactory> = {
			A: (_controller, callbacks) => ({
				run: async () => {
					callbacks.assertCurrentEpoch();
					observations.push({ name: "A", identity: sessionIdentity, completed });
				},
				quiesce: async () => {
					lifecycle.push("A:quiesce");
				},
				dispose: async () => {
					lifecycle.push("A:dispose");
				},
			}),
			B: (_controller, callbacks) => ({
				run: async () => {
					callbacks.assertCurrentEpoch();
					await heldTurn;
					observations.push({ name: "B", identity: sessionIdentity, completed });
				},
				quiesce: async () => {
					lifecycle.push("B:quiesce");
				},
				dispose: async () => {
					lifecycle.push("B:dispose");
				},
			}),
		};
		const state = harness({ load: async revision => factories[revision.cacheKey]! });
		await state.host.reload({ specifier: "sample", cacheKey: "A" });
		const reload = state.host.reload({ specifier: "sample", cacheKey: "B" });
		await Promise.resolve();
		finishTurn!();
		await reload;

		expect(lifecycle.slice(0, 2)).toEqual(["A:quiesce", "A:dispose"]);
		expect(state.closedControllers).toEqual([1]);
		expect(observations).toEqual([
			{ name: "A", identity: sessionIdentity, completed: false },
			{ name: "B", identity: sessionIdentity, completed: true },
		]);
		expect(state.runnerStops).toBe(0);
		await state.host.stop();
	});

	test("epoch-fails stale view callbacks after reload", async () => {
		const callbacks: DisposableTerminalHostCallbacks[] = [];
		const state = harness({
			load: async () => (_controller, hostCallbacks) => {
				callbacks.push(hostCallbacks);
				return { run: async () => {}, quiesce: async () => {}, dispose: async () => {} };
			},
		});
		await state.host.reload({ specifier: "sample", cacheKey: "A" });
		await state.host.reload({ specifier: "sample", cacheKey: "B" });
		expect(callbacks[0]!.isCurrentEpoch()).toBe(false);
		expect(() => callbacks[0]!.assertCurrentEpoch()).toThrow("Stale disposable terminal view epoch");
		expect(callbacks[1]!.isCurrentEpoch()).toBe(true);
		await state.host.stop();
	});

	test("mediates callback reloads through the resolver and serialized replacement", async () => {
		const lifecycle: string[] = [];
		const callbacks: DisposableTerminalHostCallbacks[] = [];
		let resolverCalls = 0;
		const state = harness(
			{
				load: async revision => (_controller, hostCallbacks) => {
					callbacks.push(hostCallbacks);
					return {
						run: async () => {
							lifecycle.push(`${revision.cacheKey}:run`);
						},
						quiesce: async () => {
							lifecycle.push(`${revision.cacheKey}:quiesce`);
						},
						dispose: async () => {
							lifecycle.push(`${revision.cacheKey}:dispose`);
						},
					};
				},
			},
			async () => {
				resolverCalls++;
				return { specifier: "resolved", cacheKey: "B" };
			},
		);
		await state.host.reload({ specifier: "initial", cacheKey: "A" });

		await callbacks[0]!.requestReload();

		expect(resolverCalls).toBe(1);
		expect(state.host.revision).toEqual({ specifier: "resolved", cacheKey: "B" });
		expect(lifecycle).toEqual(["A:run", "A:quiesce", "A:dispose", "B:run"]);
		expect(state.closedControllers).toEqual([1]);
		expect(callbacks[0]!.isCurrentEpoch()).toBe(false);
		expect(callbacks[1]!.isCurrentEpoch()).toBe(true);
		await state.host.stop();
	});

	test("rejects stale epoch callback requests without resolving or stopping", async () => {
		const callbacks: DisposableTerminalHostCallbacks[] = [];
		let resolverCalls = 0;
		const state = harness(
			{
				load: async () => (_controller, hostCallbacks) => {
					callbacks.push(hostCallbacks);
					return { run: async () => {}, quiesce: async () => {}, dispose: async () => {} };
				},
			},
			async () => {
				resolverCalls++;
				return { specifier: "resolved", cacheKey: "resolved" };
			},
		);
		await state.host.reload({ specifier: "sample", cacheKey: "A" });
		await state.host.reload({ specifier: "sample", cacheKey: "B" });

		await expect(callbacks[0]!.requestReload()).rejects.toThrow("Stale disposable terminal view epoch 1");
		await expect(callbacks[0]!.requestStop()).rejects.toThrow("Stale disposable terminal view epoch 1");
		expect(resolverCalls).toBe(0);
		expect(state.runnerStops).toBe(0);
		expect(state.host.revision?.cacheKey).toBe("B");
		await state.host.stop();
	});

	test("requestStop settles completion and stops the runner exactly once", async () => {
		let callbacks: DisposableTerminalHostCallbacks | undefined;
		let completionSettled = false;
		const state = harness({
			load: async () => (_controller, hostCallbacks) => {
				callbacks = hostCallbacks;
				return { run: async () => {}, quiesce: async () => {}, dispose: async () => {} };
			},
		});
		void state.host.completion.then(() => {
			completionSettled = true;
		});
		await state.host.reload({ specifier: "sample", cacheKey: "A" });

		await callbacks!.requestStop();
		await state.host.completion;

		expect(completionSettled).toBe(true);
		expect(state.runnerStops).toBe(1);
		await state.host.stop();
		expect(state.runnerStops).toBe(1);
	});

	test("retires the active view and runner before publishing a session transition", async () => {
		let callbacks: DisposableTerminalHostCallbacks | undefined;
		const lifecycle: string[] = [];
		const state = harness({
			load: async () => (_controller, hostCallbacks) => {
				callbacks = hostCallbacks;
				return {
					run: async () => {},
					quiesce: async () => {
						lifecycle.push("view:quiesce");
					},
					dispose: async () => {
						lifecycle.push("view:dispose");
					},
				};
			},
		});
		await state.host.reload({ specifier: "sample", cacheKey: "A" });

		await callbacks!.requestTransition({ kind: "switchSession", session: { kind: "id", id: "session-b" } });
		const intent = await state.host.completion;

		expect(lifecycle).toEqual(["view:quiesce", "view:dispose"]);
		expect(state.closedControllers).toEqual([1]);
		expect(state.runnerStops).toBe(1);
		expect(intent).toEqual({ kind: "switchSession", session: { kind: "id", id: "session-b" } });
		expect(state.host.preparedTransition?.intent).toEqual(intent);
	});

	test("routes external restart through the prepared host transition before stopping", async () => {
		const lifecycle: string[] = [];
		const state = harness({
			load: async () => () => ({
				run: async () => {},
				quiesce: async () => {
					lifecycle.push("view:quiesce");
				},
				dispose: async () => {
					lifecycle.push("view:dispose");
				},
			}),
		});
		await state.host.reload({ specifier: "sample", cacheKey: "A" });

		const receipt = await state.host.transition({ kind: "restartProcess" });

		expect(receipt.intent).toEqual({ kind: "restartProcess" });
		expect(receipt.restartSpawn).toEqual({
			executable: "/bin/omp",
			args: ["--resume", "session-b"],
			cwd: "/tmp",
		});
		expect(lifecycle).toEqual(["view:quiesce", "view:dispose"]);
		expect(state.closedControllers).toEqual([1]);
		expect(state.runnerStops).toBe(1);
		expect(await state.host.completion).toEqual({ kind: "restartProcess" });
	});

	test("reattaches the known-good revision when loading or initializing fails", async () => {
		const runs: string[] = [];
		let aFactoryCalls = 0;
		const a: DisposableTerminalViewFactory = () => {
			aFactoryCalls++;
			return {
				run: async () => {
					runs.push("A");
				},
				quiesce: async () => {},
				dispose: async () => {},
			};
		};
		const state = harness({
			load: async revision => {
				if (revision.cacheKey === "load-failure") throw new Error("load failed");
				if (revision.cacheKey === "init-failure")
					return () => ({
						run: async () => {
							throw new Error("init failed");
						},
						quiesce: async () => {},
						dispose: async () => {},
					});
				return a;
			},
		});
		await state.host.reload({ specifier: "sample", cacheKey: "A" });
		await expect(state.host.reload({ specifier: "sample", cacheKey: "load-failure" })).rejects.toThrow("load failed");
		expect(state.host.revision?.cacheKey).toBe("A");
		await expect(state.host.reload({ specifier: "sample", cacheKey: "init-failure" })).rejects.toThrow("init failed");
		expect(state.host.revision?.cacheKey).toBe("A");
		expect(aFactoryCalls).toBe(3);
		expect(runs).toEqual(["A", "A", "A"]);
		await state.host.stop();
	});

	test("closes the controller after run and view cleanup reject", async () => {
		const lifecycle: string[] = [];
		const state = harness({
			load: async () => () => ({
				run: async () => {
					lifecycle.push("run");
					throw new Error("run failed");
				},
				quiesce: async () => {
					lifecycle.push("quiesce");
					throw new Error("quiesce failed");
				},
				dispose: async () => {
					lifecycle.push("dispose");
					throw new Error("dispose failed");
				},
			}),
		});

		const failure = await state.host.reload({ specifier: "sample", cacheKey: "broken" }).catch(error => error);
		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors.map(error => (error as Error).message)).toEqual([
			"run failed",
			"quiesce failed",
			"dispose failed",
		]);
		expect(lifecycle).toEqual(["run", "quiesce", "dispose"]);
		expect(state.closedControllers).toEqual([1]);
		await state.host.stop();
	});

	test("attempts every stop finalizer once and shares the failed stop", async () => {
		const lifecycle: string[] = [];
		let runnerStops = 0;
		let scopeCloses = 0;
		const runner = {
			stop: () =>
				Effect.gen(function* () {
					runnerStops++;
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							scopeCloses++;
						}).pipe(Effect.andThen(Effect.die(new Error("scope close failed")))),
					);
					return yield* Effect.fail(new Error("runner stop failed"));
				}),
		} as unknown as SessionRunner;
		const host = new DisposableTerminalHost({
			runner,
			loader: {
				load: async () => () => ({
					run: async () => {},
					quiesce: async () => {
						lifecycle.push("quiesce");
						throw new Error("retire failed");
					},
					dispose: async () => {
						lifecycle.push("dispose");
					},
				}),
			},
			createController: async () =>
				({
					close: async () => {
						lifecycle.push("close");
					},
				}) as TerminalSessionController,
		});
		await host.reload({ specifier: "sample", cacheKey: "active" });

		const first = host.stop();
		const second = host.stop();
		expect(second).toBe(first);
		const failure = await first.catch(error => error);
		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors).toHaveLength(3);
		expect(lifecycle).toEqual(["quiesce", "dispose", "close"]);
		expect(runnerStops).toBe(1);
		expect(scopeCloses).toBe(1);
		await expect(host.stop()).rejects.toBe(failure);
		expect(runnerStops).toBe(1);
		expect(scopeCloses).toBe(1);
	});

	test("loads changed source under a unique revision and stops the runner exactly once", async () => {
		const directory = await mkdtemp(join(tmpdir(), "omp-disposable-view-"));
		temporaryDirectories.push(directory);
		const moduleA = join(directory, "view.hash-a.ts");
		const moduleB = join(directory, "view.hash-b.ts");
		const source = (behavior: string) =>
			`export const createDisposableTerminalView = (_controller, callbacks) => ({ run: async () => { globalThis.__ompRevisionBehavior = ${JSON.stringify(behavior)}; callbacks.assertCurrentEpoch(); }, quiesce: async () => {}, dispose: async () => {} });\n`;
		await writeFile(moduleA, source("A"));
		await writeFile(moduleB, source("B"));
		const state = harness(createUniqueRevisionLoader());
		await state.host.reload({ specifier: moduleA, cacheKey: "hash-a" });
		expect((globalThis as { __ompRevisionBehavior?: string }).__ompRevisionBehavior).toBe("A");
		await state.host.reload({ specifier: moduleB, cacheKey: "hash-b" });
		expect((globalThis as { __ompRevisionBehavior?: string }).__ompRevisionBehavior).toBe("B");
		await Promise.all([state.host.stop(), state.host.stop()]);
		expect(state.runnerStops).toBe(1);
	});
});
