import type { InteractiveHostIntent } from "./interactive-host-intent";

export interface ActiveInteractiveHost<Runner, Session> {
	readonly epoch: number;
	readonly runner: Runner;
	readonly session: Session;
	readonly buildIdentity: string;
	/** Resolves only after the runner is stopped and its writable lease has been released. */
	readonly stop: () => Promise<void>;
}

export interface PreparedInteractiveTransition<Target, Handoff> {
	readonly target?: Target;
	readonly handoff?: Handoff;
}

export interface AcquiredInteractiveTarget<Runner, Session> {
	readonly createHost: () => Promise<ActiveInteractiveHost<Runner, Session>>;
	/** Releases any manager/runner/ownership acquired before host creation. Must be idempotent. */
	readonly cleanup: () => Promise<void>;
}

export interface SessionTransitionDependencies<Runner, Session, Target, Handoff> {
	/** Read-only resolution/readiness validation. It must not acquire session ownership. */
	readonly prepare: (
		intent: InteractiveHostIntent,
		current: ActiveInteractiveHost<Runner, Session>,
	) => Promise<PreparedInteractiveTransition<Target, Handoff>>;
	readonly confirmReleased: (current: ActiveInteractiveHost<Runner, Session>) => Promise<boolean>;
	/** Constructs the manager and acquires ownership; host construction remains separately fallible. */
	readonly acquire: (
		target: Target,
		epoch: number,
		intent: InteractiveHostIntent,
	) => Promise<AcquiredInteractiveTarget<Runner, Session>>;
}

export type SessionTransitionFailurePhase = "prepare" | "stop" | "release" | "start";

export type SessionTransitionResult<Runner, Session, Handoff> =
	| { readonly status: "started"; readonly host: ActiveInteractiveHost<Runner, Session> }
	| { readonly status: "stopped"; readonly intent: InteractiveHostIntent }
	| { readonly status: "handoff"; readonly descriptor: Handoff }
	| {
			readonly status: "failed";
			readonly phase: SessionTransitionFailurePhase;
			readonly error: unknown;
			readonly current?: ActiveInteractiveHost<Runner, Session>;
			readonly recoveryIntent?: InteractiveHostIntent;
	  };

/** Serializes all cutovers and enforces stop-release-acquire ordering. */
export class SessionTransitionCoordinator<Runner, Session, Target, Handoff> {
	#tail: Promise<void> = Promise.resolve();
	#current: ActiveInteractiveHost<Runner, Session>;

	constructor(
		current: ActiveInteractiveHost<Runner, Session>,
		private readonly dependencies: SessionTransitionDependencies<Runner, Session, Target, Handoff>,
	) {
		this.#current = current;
	}

	transition(intent: InteractiveHostIntent): Promise<SessionTransitionResult<Runner, Session, Handoff>> {
		const result = this.#tail.then(() => this.#transition(intent));
		this.#tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async #transition(intent: InteractiveHostIntent): Promise<SessionTransitionResult<Runner, Session, Handoff>> {
		const current = this.#current;
		let prepared: PreparedInteractiveTransition<Target, Handoff>;
		try {
			prepared = await this.dependencies.prepare(intent, current);
		} catch (error) {
			return { status: "failed", phase: "prepare", error, current };
		}

		try {
			await current.stop();
		} catch (error) {
			return { status: "failed", phase: "stop", error, current };
		}

		try {
			if (!(await this.dependencies.confirmReleased(current))) {
				throw new Error("Session ownership lease remains held after host stop");
			}
		} catch (error) {
			return { status: "failed", phase: "release", error, recoveryIntent: intent };
		}

		if (intent.kind === "restartProcess") {
			if (prepared.handoff === undefined) {
				return {
					status: "failed",
					phase: "prepare",
					error: new Error("Restart transition did not produce a handoff descriptor"),
					recoveryIntent: intent,
				};
			}
			return { status: "handoff", descriptor: prepared.handoff };
		}
		if (intent.kind === "exit") return { status: "stopped", intent };
		if (prepared.target === undefined) {
			return {
				status: "failed",
				phase: "prepare",
				error: new Error("Session transition did not produce a target"),
				recoveryIntent: intent,
			};
		}

		let acquired: AcquiredInteractiveTarget<Runner, Session> | undefined;
		try {
			acquired = await this.dependencies.acquire(prepared.target, current.epoch + 1, intent);
			const host = await acquired.createHost();
			this.#current = host;
			return { status: "started", host };
		} catch (error) {
			try {
				await acquired?.cleanup();
			} catch (cleanupError) {
				return {
					status: "failed",
					phase: "start",
					error: new AggregateError([error, cleanupError]),
					recoveryIntent: intent,
				};
			}
			return { status: "failed", phase: "start", error, recoveryIntent: intent };
		}
	}
}
