import { pathToFileURL } from "node:url";
import { Effect, Exit, Scope } from "effect";
import type { SessionRunner } from "../runner/session-runner";
import {
	createTerminalSessionController,
	type TerminalSessionController,
} from "./terminal-session-controller";

export interface DisposableTerminalHostCallbacks {
	readonly epoch: number;
	readonly isCurrentEpoch: () => boolean;
	readonly assertCurrentEpoch: () => void;
}

export interface DisposableTerminalView {
	/** Initialize the disposable view and perform its first render. */
	readonly run: () => Promise<void>;
	/** Stop and join input/render work. */
	readonly quiesce: () => Promise<void>;
	/** Release resources owned only by this view. */
	readonly dispose: () => Promise<void>;
}

export type DisposableTerminalViewFactory = (
	controller: TerminalSessionController,
	callbacks: DisposableTerminalHostCallbacks,
) => DisposableTerminalView | Promise<DisposableTerminalView>;

export interface DisposableTerminalRevision {
	/** Runtime-selected module path or URL. */
	readonly specifier: string;
	/** Content hash or other immutable revision identity. */
	readonly cacheKey: string;
}

export interface DisposableTerminalRevisionModule {
	readonly createDisposableTerminalView: DisposableTerminalViewFactory;
}

export interface DisposableTerminalRevisionLoader {
	readonly load: (revision: DisposableTerminalRevision) => Promise<DisposableTerminalViewFactory>;
}

/** Dev loader whose query-addressed URL prevents the ESM module cache from hiding a new revision. */
export function createUniqueRevisionLoader(): DisposableTerminalRevisionLoader {
	return {
		load: async revision => {
			const base = revision.specifier.includes(":")
				? new URL(revision.specifier)
				: pathToFileURL(revision.specifier);
			base.searchParams.set("omp-revision", revision.cacheKey);
			// This import is intentionally dynamic: the revision specifier is selected at runtime.
			const loaded: unknown = await import(base.href);
			if (
				typeof loaded !== "object" ||
				loaded === null ||
				!("createDisposableTerminalView" in loaded) ||
				typeof loaded.createDisposableTerminalView !== "function"
			) {
				throw new TypeError(`Disposable terminal revision ${revision.cacheKey} has no view factory`);
			}
			return loaded.createDisposableTerminalView as DisposableTerminalViewFactory;
		},
	};
}

export interface DisposableTerminalHostOptions {
	readonly runner: SessionRunner;
	readonly loader: DisposableTerminalRevisionLoader;
	readonly createController?: (runner: SessionRunner) => Promise<TerminalSessionController>;
}

interface ActiveRevision {
	readonly revision: DisposableTerminalRevision;
	readonly factory: DisposableTerminalViewFactory;
	readonly controller: TerminalSessionController;
	readonly view: DisposableTerminalView;
	readonly epoch: number;
}

export class DisposableTerminalHost {
	readonly #runner: SessionRunner;
	readonly #loader: DisposableTerminalRevisionLoader;
	readonly #createController: (runner: SessionRunner) => Promise<TerminalSessionController>;
	readonly #runnerScope = Scope.makeUnsafe("sequential");
	#active: ActiveRevision | undefined;
	#serial: Promise<void> = Promise.resolve();
	#epoch = 0;
	#stopped = false;
	#stopPromise: Promise<void> | undefined;

	constructor(options: DisposableTerminalHostOptions) {
		this.#runner = options.runner;
		this.#loader = options.loader;
		this.#createController = options.createController ?? createTerminalSessionController;
	}

	get revision(): DisposableTerminalRevision | undefined {
		return this.#active?.revision;
	}

	get controller(): TerminalSessionController | undefined {
		return this.#active?.controller;
	}

	reload(revision: DisposableTerminalRevision): Promise<void> {
		return this.#serialize(async () => {
			if (this.#stopped) throw new Error("Disposable terminal host is stopped");
			const previous = this.#active;
			this.#active = undefined;
			if (previous) await this.#retire(previous);

			try {
				const factory = await this.#loader.load(revision);
				this.#active = await this.#activate(revision, factory);
			} catch (error) {
				if (previous) {
					try {
						this.#active = await this.#activate(previous.revision, previous.factory);
					} catch (fallbackError) {
						throw new AggregateError([error, fallbackError], "Revision load failed and fallback could not reattach");
					}
				}
				throw error;
			}
		});
	}

	stop(): Promise<void> {
		if (this.#stopPromise) return this.#stopPromise;
		this.#stopped = true;
		this.#stopPromise = this.#serialize(async () => {
			const errors: unknown[] = [];
			const active = this.#active;
			this.#active = undefined;
			if (active) {
				try {
					await this.#retire(active);
				} catch (error) {
					errors.push(error);
				}
			}
			try {
				await Effect.runPromise(Scope.provide(this.#runnerScope)(this.#runner.stop()));
			} catch (error) {
				errors.push(error);
			}
			try {
				await Effect.runPromise(Scope.close(this.#runnerScope, Exit.void));
			} catch (error) {
				errors.push(error);
			}
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, "Disposable terminal host stop failed");
		});
		return this.#stopPromise;
	}

	#serialize(operation: () => Promise<void>): Promise<void> {
		const result = this.#serial.then(operation, operation);
		this.#serial = result.catch(() => undefined);
		return result;
	}

	async #activate(
		revision: DisposableTerminalRevision,
		factory: DisposableTerminalViewFactory,
	): Promise<ActiveRevision> {
		const controller = await this.#createController(this.#runner);
		const epoch = ++this.#epoch;
		const callbacks: DisposableTerminalHostCallbacks = {
			epoch,
			isCurrentEpoch: () => this.#active?.epoch === epoch && !this.#stopped,
			assertCurrentEpoch: () => {
				if (this.#active?.epoch !== epoch || this.#stopped) {
					throw new Error(`Stale disposable terminal view epoch ${epoch}`);
				}
			},
		};
		let view: DisposableTerminalView | undefined;
		try {
			view = await factory(controller, callbacks);
			const active = { revision, factory, controller, view, epoch };
			this.#active = active;
			await view.run();
			return active;
		} catch (error) {
			this.#active = undefined;
			const errors: unknown[] = [error];
			if (view) {
				try {
					await view.quiesce();
				} catch (cleanupError) {
					errors.push(cleanupError);
				}
				try {
					await view.dispose();
				} catch (cleanupError) {
					errors.push(cleanupError);
				}
			}
			try {
				await controller.close();
			} catch (cleanupError) {
				errors.push(cleanupError);
			}
			if (errors.length === 1) throw error;
			throw new AggregateError(errors, "Disposable terminal view activation failed");
		}
	}

	async #retire(active: ActiveRevision): Promise<void> {
		try {
			await active.view.quiesce();
		} finally {
			try {
				await active.view.dispose();
			} finally {
				await active.controller.close();
			}
		}
	}
}
