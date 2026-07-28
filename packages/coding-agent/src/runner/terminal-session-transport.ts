import { Effect, Exit, Scope } from "effect";
import { RunnerViewNotAttachedError } from "./errors";
import { type AttachRunnerViewCommand, RUNNER_SCHEMA_VERSION } from "./protocol";
import type { RunnerFailure, SessionRunner } from "./session-runner";
import type {
	TerminalSessionControllerView,
	TerminalSessionDelivery,
	TerminalSessionSnapshot,
	TerminalSessionSubscription,
	TerminalSessionView,
} from "./terminal-session-view";

export type TerminalSessionAttachRequest = Omit<
	AttachRunnerViewCommand,
	"schemaVersion" | "kind" | "expectedRevision" | "capability"
>;

export interface TerminalSessionAttachment {
	readonly viewId: string;
	readonly epoch: number;
	readonly detach: () => Promise<void>;
}

interface TerminalSessionCommandMethodMap {
	readonly submit: TerminalSessionControllerView["submit"];
	readonly submitCustomMessage: TerminalSessionControllerView["submitCustomMessage"];
	readonly edit: TerminalSessionControllerView["edit"];
	readonly cancel: TerminalSessionControllerView["cancel"];
	readonly setActiveTools: TerminalSessionControllerView["setActiveTools"];
	readonly replaceTodos: TerminalSessionControllerView["replaceTodos"];
	readonly refreshSshTool: TerminalSessionControllerView["refreshSshTool"];
	readonly setModel: TerminalSessionControllerView["setModel"];
	readonly cycleModel: TerminalSessionControllerView["cycleModel"];
	readonly setThinkingLevel: TerminalSessionControllerView["setThinkingLevel"];
	readonly transitionPlanMode: TerminalSessionControllerView["transitionPlanMode"];
	readonly transitionGoalMode: TerminalSessionControllerView["transitionGoalMode"];
	readonly shake: TerminalSessionControllerView["shake"];
	readonly cancelShake: TerminalSessionControllerView["cancelShake"];
	readonly handoff: TerminalSessionControllerView["handoff"];
	readonly cancelHandoff: TerminalSessionControllerView["cancelHandoff"];
	readonly getCheckpointState: TerminalSessionControllerView["getCheckpointState"];
	readonly setCheckpointState: TerminalSessionControllerView["setCheckpointState"];
	readonly reload: TerminalSessionControllerView["reload"];
	readonly prepareHostTransition: TerminalSessionControllerView["prepareHostTransition"];
	readonly compact: TerminalSessionControllerView["compact"];
	readonly cancelCompaction: TerminalSessionControllerView["cancelCompaction"];
	readonly runEphemeralTurn: TerminalSessionControllerView["runEphemeralTurn"];
	readonly cancelEphemeralTurn: TerminalSessionControllerView["cancelEphemeralTurn"];
	readonly runLocalOperation: TerminalSessionControllerView["runLocalOperation"];
	readonly cancelLocalOperation: TerminalSessionControllerView["cancelLocalOperation"];
	readonly interruptPrompt: TerminalSessionControllerView["interruptPrompt"];
}

type TerminalSessionCommandMethod = TerminalSessionCommandMethodMap[keyof TerminalSessionCommandMethodMap];

type MethodArguments<Method> = Method extends (...args: infer Arguments) => unknown ? Arguments : never;
type MethodSuccess<Method> = Method extends (
	...args: infer _Arguments
) => Effect.Effect<infer Success, infer _Error, infer _Requirements>
	? Success
	: never;

/** Every durable controller command accepted by a terminal session view. */
export type TerminalSessionCommand = MethodArguments<TerminalSessionCommandMethod>[0];
export type TerminalSessionCommandResult = MethodSuccess<TerminalSessionCommandMethod>;
export type TerminalSessionCommandResultFor<Command extends TerminalSessionCommand> = {
	[Method in keyof TerminalSessionCommandMethodMap]: Command extends MethodArguments<
		TerminalSessionCommandMethodMap[Method]
	>[0]
		? MethodSuccess<TerminalSessionCommandMethodMap[Method]>
		: never;
}[keyof TerminalSessionCommandMethodMap];

export type TerminalSessionRequestOperation =
	| "getContextUsage"
	| "getSessionStats"
	| "getAdvisorStats"
	| "getAsyncJobSnapshot"
	| "getHindsightSessionState"
	| "getAllToolNames"
	| "formatSessionAsText"
	| "formatAdvisorHistoryAsText"
	| "getModelCatalog"
	| "getToolCatalog"
	| "getSessionMetadataSnapshot"
	| "getWorkflowEligibility"
	| "getTurnLifecycle"
	| "saveDraft"
	| "consumeDraft"
	| "invokeExtensionCommand"
	| "invokePlanResolve"
	| "requestGoalContinuation";

type TerminalSessionRequestMethod<Operation extends TerminalSessionRequestOperation> =
	TerminalSessionControllerView[Operation];

export type TerminalSessionRequestArguments<Operation extends TerminalSessionRequestOperation> = MethodArguments<
	TerminalSessionRequestMethod<Operation>
>;
export type TerminalSessionRequestResult<Operation extends TerminalSessionRequestOperation> = MethodSuccess<
	TerminalSessionRequestMethod<Operation>
>;

export type TerminalSessionDeliveryListener = (delivery: TerminalSessionDelivery) => void;

/** Promise boundary shared by in-process and socket-backed terminal session clients. */
export interface TerminalSessionTransport {
	readonly attach: (request: TerminalSessionAttachRequest) => Promise<TerminalSessionAttachment>;
	readonly sendCommand: <Command extends TerminalSessionCommand>(
		command: Command,
	) => Promise<TerminalSessionCommandResultFor<Command>>;
	readonly requestSnapshot: () => Promise<TerminalSessionSnapshot>;
	readonly request: <Operation extends TerminalSessionRequestOperation>(
		operation: Operation,
		args: TerminalSessionRequestArguments<Operation>,
	) => Promise<TerminalSessionRequestResult<Operation>>;
	readonly subscribe: (listener: TerminalSessionDeliveryListener) => () => void;
}

const assertNever = (value: never): never => {
	throw new Error(`Unsupported terminal session command: ${String(value)}`);
};

/** In-process transport retaining the Effect-native view behind one owned scope. */
export class LocalTerminalSessionTransport implements TerminalSessionTransport {
	readonly #scope = Scope.makeUnsafe("sequential");
	readonly #listeners = new Set<TerminalSessionDeliveryListener>();
	readonly #runner: SessionRunner;
	readonly #capability: "controller" | "observer";
	#view: TerminalSessionView | undefined;
	#attachedViewId: string | undefined;
	#attaching = false;
	#closed = false;

	constructor(runner: SessionRunner, capability: "controller" | "observer" = "controller") {
		this.#runner = runner;
		this.#capability = capability;
	}

	readonly #run = <Success>(effect: Effect.Effect<Success, RunnerFailure, Scope.Scope>): Promise<Success> =>
		Effect.runPromise(Scope.provide(this.#scope)(effect));

	readonly attach = async (request: TerminalSessionAttachRequest): Promise<TerminalSessionAttachment> => {
		if (this.#closed) throw new Error("Terminal session transport is closed");
		if (this.#attaching || this.#view !== undefined)
			throw new Error("Terminal session transport is already attached");
		this.#attaching = true;
		let view: TerminalSessionView | undefined;
		try {
			const runnerSnapshot = await this.#run(this.#runner.snapshot());
			const attachRequest = {
				...request,
				schemaVersion: RUNNER_SCHEMA_VERSION,
				kind: "attachView" as const,
				expectedRevision: runnerSnapshot.revision,
			};
			view =
				this.#capability === "controller"
					? await this.#run(this.#runner.attachTerminalView({ ...attachRequest, capability: "controller" }))
					: await this.#run(this.#runner.attachTerminalObserverView({ ...attachRequest, capability: "observer" }));
			const subscription = await this.#run(view.subscribe());
			this.#view = view;
			this.#attachedViewId = view.viewId;
			await this.#run(Effect.forkScoped(this.#deliveryPump(subscription)));
			const attachedView = view;

			let detached = false;
			return {
				viewId: attachedView.viewId,
				epoch: attachedView.epoch,
				detach: async () => {
					if (detached) return;
					detached = true;
					await this.#detach(attachedView);
				},
			};
		} catch (error) {
			this.#closed = true;
			this.#view = undefined;
			try {
				if (view !== undefined) await this.#run(view.detach());
			} finally {
				this.#listeners.clear();
				await Effect.runPromise(Scope.close(this.#scope, Exit.void));
			}
			throw error;
		} finally {
			this.#attaching = false;
		}
	};

	readonly sendCommand = async <Command extends TerminalSessionCommand>(
		command: Command,
	): Promise<TerminalSessionCommandResultFor<Command>> =>
		(await this.#sendCommand(command)) as TerminalSessionCommandResultFor<Command>;

	readonly #sendCommand = async (command: TerminalSessionCommand): Promise<TerminalSessionCommandResult> => {
		const view = this.#requireControllerView();
		switch (command.kind) {
			case "submitInput":
				return this.#run(view.submit(command));
			case "submitCustomMessage":
				return this.#run(view.submitCustomMessage(command));
			case "editQueuedInput":
				return this.#run(view.edit(command));
			case "cancelQueuedInput":
				return this.#run(view.cancel(command));
			case "setActiveTools":
				return this.#run(view.setActiveTools(command));
			case "replaceTodos":
				return this.#run(view.replaceTodos(command));
			case "refreshSshTool":
				return this.#run(view.refreshSshTool(command));
			case "setModel":
				return this.#run(view.setModel(command));
			case "cycleModel":
				return this.#run(view.cycleModel(command));
			case "setThinkingLevel":
				return this.#run(view.setThinkingLevel(command));
			case "transitionPlanMode":
				return this.#run(view.transitionPlanMode(command));
			case "transitionGoalMode":
				return this.#run(view.transitionGoalMode(command));
			case "runShake":
				return this.#run(view.shake(command));
			case "cancelShake":
				return this.#run(view.cancelShake(command));
			case "runHandoff":
				return this.#run(view.handoff(command));
			case "cancelHandoff":
				return this.#run(view.cancelHandoff(command));
			case "getCheckpointState":
				return this.#run(view.getCheckpointState(command));
			case "setCheckpointState":
				return this.#run(view.setCheckpointState(command));
			case "reloadSession":
				return this.#run(view.reload(command));
			case "prepareHostTransition":
				return this.#run(view.prepareHostTransition(command));
			case "runCompaction":
				return this.#run(view.compact(command));
			case "cancelCompaction":
				return this.#run(view.cancelCompaction(command));
			case "runEphemeralTurn":
				return this.#run(view.runEphemeralTurn(command));
			case "cancelEphemeralTurn":
				return this.#run(view.cancelEphemeralTurn(command));
			case "runLocalOperation":
				return this.#run(view.runLocalOperation(command));
			case "cancelLocalOperation":
				return this.#run(view.cancelLocalOperation(command));
			case "interruptPrompt":
				return this.#run(view.interruptPrompt(command));
			default:
				return assertNever(command);
		}
	};

	readonly requestSnapshot = (): Promise<TerminalSessionSnapshot> => this.#run(this.#requireView().snapshot());

	readonly request = async <Operation extends TerminalSessionRequestOperation>(
		operation: Operation,
		args: TerminalSessionRequestArguments<Operation>,
	): Promise<TerminalSessionRequestResult<Operation>> => {
		const result = await this.#request(operation, args);
		return result as TerminalSessionRequestResult<Operation>;
	};

	readonly subscribe = (listener: TerminalSessionDeliveryListener): (() => void) => {
		if (this.#closed) throw new Error("Terminal session transport is closed");
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	};

	readonly #request = async (
		operation: TerminalSessionRequestOperation,
		args: MethodArguments<TerminalSessionRequestMethod<TerminalSessionRequestOperation>>,
	): Promise<TerminalSessionRequestResult<TerminalSessionRequestOperation>> => {
		const view = this.#requireControllerView();
		switch (operation) {
			case "getContextUsage":
				return this.#run(
					view.getContextUsage(...(args as Parameters<TerminalSessionControllerView["getContextUsage"]>)),
				);
			case "getSessionStats":
				return this.#run(view.getSessionStats());
			case "getAdvisorStats":
				return this.#run(view.getAdvisorStats());
			case "getAsyncJobSnapshot":
				return this.#run(
					view.getAsyncJobSnapshot(...(args as Parameters<TerminalSessionControllerView["getAsyncJobSnapshot"]>)),
				);
			case "getHindsightSessionState":
				return this.#run(view.getHindsightSessionState());
			case "getAllToolNames":
				return this.#run(view.getAllToolNames());
			case "formatSessionAsText":
				return this.#run(
					view.formatSessionAsText(...(args as Parameters<TerminalSessionControllerView["formatSessionAsText"]>)),
				);
			case "formatAdvisorHistoryAsText":
				return this.#run(
					view.formatAdvisorHistoryAsText(
						...(args as Parameters<TerminalSessionControllerView["formatAdvisorHistoryAsText"]>),
					),
				);
			case "getModelCatalog":
				return this.#run(view.getModelCatalog());
			case "getToolCatalog":
				return this.#run(view.getToolCatalog());
			case "getSessionMetadataSnapshot":
				return this.#run(view.getSessionMetadataSnapshot());
			case "getWorkflowEligibility":
				return this.#run(view.getWorkflowEligibility());
			case "getTurnLifecycle":
				return this.#run(view.getTurnLifecycle());
			case "saveDraft":
				return this.#run(view.saveDraft(...(args as Parameters<TerminalSessionControllerView["saveDraft"]>)));
			case "consumeDraft":
				return this.#run(view.consumeDraft());
			case "invokeExtensionCommand":
				return this.#run(
					view.invokeExtensionCommand(
						...(args as Parameters<TerminalSessionControllerView["invokeExtensionCommand"]>),
					),
				);
			case "invokePlanResolve":
				return this.#run(
					view.invokePlanResolve(...(args as Parameters<TerminalSessionControllerView["invokePlanResolve"]>)),
				);
			case "requestGoalContinuation":
				return this.#run(view.requestGoalContinuation());
			default:
				return assertNever(operation);
		}
	};

	readonly #deliveryPump = (
		subscription: TerminalSessionSubscription,
	): Effect.Effect<never, RunnerFailure, Scope.Scope> =>
		Effect.forever(
			subscription.take.pipe(
				Effect.tap(delivery =>
					Effect.sync(() => {
						for (const listener of this.#listeners) {
							try {
								listener(delivery);
							} catch {}
						}
					}),
				),
			),
		);

	async #detach(view: TerminalSessionView): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		try {
			if (this.#view === view) await this.#run(view.detach());
		} finally {
			this.#view = undefined;
			this.#listeners.clear();
			await Effect.runPromise(Scope.close(this.#scope, Exit.void));
		}
	}

	#requireView(): TerminalSessionView {
		const view = this.#view;
		if (view !== undefined && !this.#closed) return view;
		if (this.#attachedViewId !== undefined) {
			throw new RunnerViewNotAttachedError({ viewId: this.#attachedViewId });
		}
		throw new Error(
			this.#closed ? "Terminal session transport is closed" : "Terminal session transport is not attached",
		);
	}

	#requireControllerView(): TerminalSessionControllerView {
		const view = this.#requireView();
		if (view.capability === "controller") return view;
		throw new Error("Terminal session transport requires controller capability");
	}
}
