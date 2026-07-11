import { randomUUID } from "node:crypto";
import { Effect, Exit, Scope } from "effect";
import type {
	RunnerCommandReceipt,
	InterruptPromptReceipt,
	RunnerImageContent,
	SetModelReceipt,
	SetThinkingLevelReceipt,
} from "../runner/protocol";
import {
	decodeCancelQueuedInputCommand,
	decodeEditQueuedInputCommand,
	decodeInterruptPromptCommand,
	decodeSubmitInputCommand,
	decodeSetModelCommand,
	decodeSetThinkingLevelCommand,
	RUNNER_SCHEMA_VERSION,
} from "../runner/protocol";
import type { AgentSessionEvent } from "../session/agent-session";
import type { RunnerFailure, SessionRunner } from "../runner/session-runner";
import type { TerminalSessionSnapshot, TerminalSessionView } from "../runner/terminal-session-view";
import type { ConfiguredThinkingLevel } from "../thinking";

export interface TerminalSubmitIntent {
	readonly text: string;
	readonly images?: ReadonlyArray<RunnerImageContent>;
	readonly deliveryClass: "steer" | "followUp";
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalEditIntent {
	readonly inputId: string;
	readonly itemRevision: number;
	readonly text: string;
	readonly images?: ReadonlyArray<RunnerImageContent>;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCancelIntent {
	readonly inputId: string;
	readonly itemRevision: number;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSetModelIntent {
	readonly provider: string;
	readonly id: string;
	readonly role?: string;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSetThinkingLevelIntent {
	readonly thinkingLevel: ConfiguredThinkingLevel | undefined;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalInterruptPromptIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSessionControllerOptions {
	readonly viewId?: string;
	readonly commandId?: string;
	readonly correlationId?: string;
}

export interface TerminalSessionController {
	readonly viewId: string;
	readonly epoch: number;
	readonly snapshot: () => TerminalSessionSnapshot;
	readonly subscribeAgentEvents: (listener: (event: AgentSessionEvent) => void) => () => void;
	readonly refresh: () => Promise<TerminalSessionSnapshot>;
	readonly submit: (intent: TerminalSubmitIntent) => Promise<RunnerCommandReceipt>;
	readonly edit: (intent: TerminalEditIntent) => Promise<RunnerCommandReceipt>;
	readonly cancel: (intent: TerminalCancelIntent) => Promise<RunnerCommandReceipt>;
	readonly setModel: (intent: TerminalSetModelIntent) => Promise<SetModelReceipt>;
	readonly setThinkingLevel: (intent: TerminalSetThinkingLevelIntent) => Promise<SetThinkingLevelReceipt>;
	readonly interruptPrompt: (intent?: TerminalInterruptPromptIntent) => Promise<InterruptPromptReceipt>;
	readonly close: () => Promise<void>;
}

const metadata = (intent: { readonly commandId?: string; readonly correlationId?: string }) => {
	const commandId = intent.commandId ?? randomUUID();
	return { commandId, correlationId: intent.correlationId ?? commandId };
};

/** Promise boundary for terminal code; all authority remains in the Effect-native view. */
export async function createTerminalSessionController(
	runner: SessionRunner,
	options: TerminalSessionControllerOptions = {},
): Promise<TerminalSessionController> {
	const scope = Scope.makeUnsafe("sequential");
	const run = <A>(effect: Effect.Effect<A, RunnerFailure, Scope.Scope>): Promise<A> =>
		Effect.runPromise(Scope.provide(scope)(effect));
	const runnerSnapshot = await run(runner.snapshot());
	const viewId = options.viewId ?? `terminal:${randomUUID()}`;
	const attachCommandId = options.commandId ?? randomUUID();
	let view: TerminalSessionView | undefined;
	let closed = false;
	try {
		view = await run(
			runner.attachTerminalView({
				schemaVersion: RUNNER_SCHEMA_VERSION,
				kind: "attachView",
				commandId: attachCommandId,
				correlationId: options.correlationId ?? attachCommandId,
				expectedRevision: runnerSnapshot.revision,
				viewId,
				capability: "controller",
			}),
		);
		const subscription = await run(view.subscribe());
		let latest = await run(view.snapshot());
		const listeners = new Set<(event: AgentSessionEvent) => void>();
		const refresh = async (): Promise<TerminalSessionSnapshot> => {
			latest = await run(view!.snapshot());
			return latest;
		};
		const pump = Effect.forever(
			subscription.take.pipe(
				Effect.flatMap((delivery) =>
					Effect.tryPromise({
						try: async () => {
							if (delivery.kind === "resyncRequired") {
								latest = delivery.snapshot;
								return;
							}
							if (delivery.kind === "runnerEvent") {
								await refresh();
								return;
							}
							for (const listener of listeners) listener(delivery.event);
						},
						catch: () => undefined,
					}),
				),
			),
		);
		await Effect.runPromise(Scope.provide(scope)(Effect.forkScoped(pump)));
		const fenced = async (
			operation: (snapshot: TerminalSessionSnapshot) => Promise<RunnerCommandReceipt>,
		): Promise<RunnerCommandReceipt> => {
			try {
				const receipt = await operation(latest);
				latest = { ...latest, runner: { ...latest.runner, revision: receipt.revision } };
				return receipt;
			} catch (error) {
				await refresh();
				throw error;
			}
		};
		return {
			viewId,
			epoch: view.epoch,
			snapshot: () => latest,
			subscribeAgentEvents: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			refresh,
			submit: (intent) =>
				fenced(async (current) => {
					const ids = metadata(intent);
					return run(
						view!.submit(
							decodeSubmitInputCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "submitInput",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedRevision: current.runner.revision,
							viewId,
							controllerEpoch: view!.epoch,
							payload: {
								text: intent.text,
								...(intent.images === undefined ? {} : { images: [...intent.images] }),
								deliveryClass: intent.deliveryClass,
							},
							}),
						),
					);
				}),
			edit: (intent) =>
				fenced(async (current) => {
					const ids = metadata(intent);
					return run(
						view!.edit(
							decodeEditQueuedInputCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "editQueuedInput",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedRevision: current.runner.revision,
							viewId,
							controllerEpoch: view!.epoch,
							inputId: intent.inputId,
							itemRevision: intent.itemRevision,
							payload: {
								text: intent.text,
								...(intent.images === undefined ? {} : { images: [...intent.images] }),
							},
							}),
						),
					);
				}),
			cancel: (intent) =>
				fenced(async (current) => {
					const ids = metadata(intent);
					return run(
						view!.cancel(
							decodeCancelQueuedInputCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelQueuedInput",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedRevision: current.runner.revision,
							viewId,
							controllerEpoch: view!.epoch,
							inputId: intent.inputId,
							itemRevision: intent.itemRevision,
							}),
						),
					);
				}),
			setModel: async (intent) => {
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.setModel(
							decodeSetModelCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "setModel",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: latest.runner.sessionRevision,
								viewId,
								controllerEpoch: view!.epoch,
								payload: {
									provider: intent.provider,
									id: intent.id,
									...(intent.role === undefined ? {} : { role: intent.role }),
								},
							}),
						),
					);
					latest = await run(view!.snapshot());
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			setThinkingLevel: async (intent) => {
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.setThinkingLevel(
							decodeSetThinkingLevelCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "setThinkingLevel",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: latest.runner.sessionRevision,
								viewId,
								controllerEpoch: view!.epoch,
								...(intent.thinkingLevel === undefined
									? {}
									: { thinkingLevel: intent.thinkingLevel }),
							}),
						),
					);
					latest = {
						...latest,
						runner: {
							...latest.runner,
							sessionRevision: Math.max(latest.runner.sessionRevision, receipt.sessionRevision),
						},
					};
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			interruptPrompt: async (intent = {}) => {
				try {
					const ids = metadata(intent);
					const targetGeneration = latest.session.promptOperation.generation;
					const receipt = await run(
						view!.interruptPrompt(
							decodeInterruptPromptCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "interruptPrompt",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: view!.epoch,
								targetGeneration,
							}),
						),
					);
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			close: async () => {
				if (closed) return;
				closed = true;
				try {
					await run(view!.detach());
				} finally {
					listeners.clear();
					await Effect.runPromise(Scope.close(scope, Exit.void));
				}
			},
		};
	} catch (error) {
		await Effect.runPromise(Scope.close(scope, Exit.void));
		throw error;
	}
}
