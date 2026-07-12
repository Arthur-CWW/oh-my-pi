import { randomUUID } from "node:crypto";
import { Effect, Exit, Scope } from "effect";
import type {
	CancelCompactionReceipt,
	CancelLocalOperationReceipt,
	InterruptPromptReceipt,
	RefreshSshToolReceipt,
	ReplaceTodosReceipt,
	RunCompactionReceipt,
	RunLocalOperationReceipt,
	RunnerCommandReceipt,
	RunnerImageContent,
	SetActiveToolsReceipt,
	SetModelReceipt,
	SetThinkingLevelReceipt,
	TransitionGoalModeReceipt,
	TransitionPlanModeReceipt,
} from "../runner/protocol";
import {
	decodeCancelCompactionCommand,
	decodeCancelLocalOperationCommand,
	decodeCancelQueuedInputCommand,
	decodeEditQueuedInputCommand,
	decodeInterruptPromptCommand,
	decodeRefreshSshToolCommand,
	decodeReplaceTodosCommand,
	decodeRunCompactionCommand,
	decodeRunLocalOperationCommand,
	decodeSetActiveToolsCommand,
	decodeSetModelCommand,
	decodeSetThinkingLevelCommand,
	decodeSubmitInputCommand,
	decodeTransitionGoalModeCommand,
	decodeTransitionPlanModeCommand,
	RunnerLocalOperationTargetError,
	RUNNER_SCHEMA_VERSION,
	RunnerCompactionTargetError,
} from "../runner/protocol";
import type { RunnerFailure, SessionRunner } from "../runner/session-runner";
import type {
	TerminalAdvisorStats,
	TerminalAsyncJobSnapshot,
	TerminalContextUsage,
	TerminalHindsightSessionState,
	TerminalSessionSnapshot,
	TerminalSessionStats,
	TerminalSessionView,
} from "../runner/terminal-session-view";
import type { AgentSessionEvent } from "../session/agent-session";
import type { ConfiguredThinkingLevel } from "../thinking";
import type { TodoPhase } from "../tools/todo";

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

export interface TerminalSetActiveToolsIntent {
	readonly toolNames: ReadonlyArray<string>;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalReplaceTodosIntent {
	readonly phases: ReadonlyArray<TodoPhase>;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalRefreshSshToolIntent {
	readonly activateIfAvailable: boolean;
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

export interface TerminalTransitionPlanModeIntent {
	readonly transition:
		| {
				readonly kind: "enter";
				readonly planFilePath: string;
				readonly workflow: "parallel" | "iterative";
		  }
		| { readonly kind: "exit"; readonly disposition: "paused" | "disabled" };
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalTransitionGoalModeIntent {
	readonly transition:
		| {
				readonly kind: "enter";
				readonly action: "create";
				readonly objective: string;
				readonly tokenBudget?: number;
				readonly workstream?: string;
		  }
		| { readonly kind: "enter"; readonly action: "resume"; readonly goalId: string }
		| {
				readonly kind: "exit";
				readonly goalId: string;
				readonly disposition: "paused" | "dropped" | "completed";
		  };
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalInterruptPromptIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCompactionIntent {
	readonly customInstructions?: string;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCancelCompactionIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export type TerminalLocalOperationIntent = {
	readonly excludeFromContext: boolean;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
} & (
	| { readonly kind: "bash"; readonly command: string }
	| { readonly kind: "python"; readonly code: string }
);

export interface TerminalCancelLocalOperationIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalLocalOperationOutput {
	readonly commandId: string;
	readonly operationGeneration: number;
	readonly chunk: string;
	readonly totalBytes: number;
	readonly truncated: boolean;
	readonly reset: boolean;
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
	readonly subscribeLocalOperationOutput: (
		listener: (output: TerminalLocalOperationOutput) => void,
	) => () => void;
	readonly refresh: () => Promise<TerminalSessionSnapshot>;
	readonly getContextUsage: (options?: {
		readonly contextWindow?: number;
	}) => Promise<TerminalContextUsage | undefined>;
	readonly getSessionStats: () => Promise<TerminalSessionStats>;
	readonly getAdvisorStats: () => Promise<TerminalAdvisorStats>;
	readonly getAsyncJobSnapshot: (options?: {
		readonly recentLimit?: number;
	}) => Promise<TerminalAsyncJobSnapshot | null>;
	readonly getHindsightSessionState: () => Promise<TerminalHindsightSessionState | undefined>;
	readonly getAllToolNames: () => Promise<ReadonlyArray<string>>;
	readonly formatSessionAsText: (options?: { readonly compact?: boolean }) => Promise<string>;
	readonly formatAdvisorHistoryAsText: (options?: { readonly compact?: boolean }) => Promise<string | null>;
	readonly submit: (intent: TerminalSubmitIntent) => Promise<RunnerCommandReceipt>;
	readonly edit: (intent: TerminalEditIntent) => Promise<RunnerCommandReceipt>;
	readonly cancel: (intent: TerminalCancelIntent) => Promise<RunnerCommandReceipt>;
	readonly setActiveTools: (intent: TerminalSetActiveToolsIntent) => Promise<SetActiveToolsReceipt>;
	readonly replaceTodos: (intent: TerminalReplaceTodosIntent) => Promise<ReplaceTodosReceipt>;
	readonly refreshSshTool: (intent: TerminalRefreshSshToolIntent) => Promise<RefreshSshToolReceipt>;
	readonly setModel: (intent: TerminalSetModelIntent) => Promise<SetModelReceipt>;
	readonly setThinkingLevel: (intent: TerminalSetThinkingLevelIntent) => Promise<SetThinkingLevelReceipt>;
	readonly transitionPlanMode: (intent: TerminalTransitionPlanModeIntent) => Promise<TransitionPlanModeReceipt>;
	readonly transitionGoalMode: (intent: TerminalTransitionGoalModeIntent) => Promise<TransitionGoalModeReceipt>;
	readonly compact: (intent?: TerminalCompactionIntent) => Promise<RunCompactionReceipt>;
	readonly cancelCompaction: (intent?: TerminalCancelCompactionIntent) => Promise<CancelCompactionReceipt>;
	readonly runLocalOperation: (intent: TerminalLocalOperationIntent) => Promise<RunLocalOperationReceipt>;
	readonly cancelLocalOperation: (
		intent?: TerminalCancelLocalOperationIntent,
	) => Promise<CancelLocalOperationReceipt>;
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
		const localOperationOutputListeners = new Set<(output: TerminalLocalOperationOutput) => void>();
		const refresh = async (): Promise<TerminalSessionSnapshot> => {
			latest = await run(view!.snapshot());
			return latest;
		};
		const pump = Effect.forever(
			subscription.take.pipe(
				Effect.flatMap(delivery =>
					Effect.tryPromise({
						try: async () => {
							if (delivery.kind === "resyncRequired") {
								latest = delivery.snapshot;
								return;
							}
							if (delivery.kind === "runnerEvent") {
								const output = delivery.event.localOperationOutput;
								const operationGeneration = delivery.event.targetOperationGeneration;
								if (output !== undefined && operationGeneration !== undefined) {
									const projected = {
										commandId: delivery.event.commandId,
										operationGeneration,
										...output,
									} satisfies TerminalLocalOperationOutput;
									for (const listener of localOperationOutputListeners) listener(projected);
								}
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
			subscribeAgentEvents: listener => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			subscribeLocalOperationOutput: listener => {
				localOperationOutputListeners.add(listener);
				return () => localOperationOutputListeners.delete(listener);
			},
			refresh,
			getContextUsage: queryOptions => run(view!.getContextUsage(queryOptions)),
			getSessionStats: () => run(view!.getSessionStats()),
			getAdvisorStats: () => run(view!.getAdvisorStats()),
			getAsyncJobSnapshot: queryOptions => run(view!.getAsyncJobSnapshot(queryOptions)),
			getHindsightSessionState: () => run(view!.getHindsightSessionState()),
			getAllToolNames: () => run(view!.getAllToolNames()),
			formatSessionAsText: queryOptions => run(view!.formatSessionAsText(queryOptions)),
			formatAdvisorHistoryAsText: queryOptions => run(view!.formatAdvisorHistoryAsText(queryOptions)),
			submit: intent =>
				fenced(async current => {
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
			edit: intent =>
				fenced(async current => {
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
			cancel: intent =>
				fenced(async current => {
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
			setActiveTools: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.setActiveTools(
							decodeSetActiveToolsCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "setActiveTools",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: view!.epoch,
								expectedToolConfigurationGeneration: current.runner.toolConfigurationGeneration,
								toolNames: [...intent.toolNames],
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
			replaceTodos: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.replaceTodos(
							decodeReplaceTodosCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "replaceTodos",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: view!.epoch,
								expectedTodoGeneration: current.runner.todoGeneration,
								phases: intent.phases.map(phase => ({
									name: phase.name,
									tasks: phase.tasks.map(task => ({ content: task.content, status: task.status })),
								})),
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
			refreshSshTool: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.refreshSshTool(
							decodeRefreshSshToolCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "refreshSshTool",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: view!.epoch,
								expectedToolConfigurationGeneration: current.runner.toolConfigurationGeneration,
								activateIfAvailable: intent.activateIfAvailable,
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
			setModel: async intent => {
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
			setThinkingLevel: async intent => {
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
								...(intent.thinkingLevel === undefined ? {} : { thinkingLevel: intent.thinkingLevel }),
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
			transitionPlanMode: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.transitionPlanMode(
							decodeTransitionPlanModeCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "transitionPlanMode",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: view!.epoch,
								transition: intent.transition,
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
			transitionGoalMode: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.transitionGoalMode(
							decodeTransitionGoalModeCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "transitionGoalMode",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: view!.epoch,
								transition: intent.transition,
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
			compact: async (intent = {}) => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.compact(
							decodeRunCompactionCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "runCompaction",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: view!.epoch,
								...(intent.customInstructions === undefined
									? {}
									: { customInstructions: intent.customInstructions }),
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
			cancelCompaction: async (intent = {}) => {
				const current = await refresh();
				const activeCompaction = current.runner.activeCompaction;
				if (activeCompaction === undefined) {
					throw new RunnerCompactionTargetError({
						targetCommandId: "",
						targetOperationGeneration: 0,
					});
				}
				const ids = metadata(intent);
				const receipt = await run(
					view!.cancelCompaction(
						decodeCancelCompactionCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelCompaction",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							viewId,
							controllerEpoch: view!.epoch,
							targetCommandId: activeCompaction.commandId,
							targetOperationGeneration: activeCompaction.operationGeneration,
						}),
					),
				);
				await refresh();
				return receipt;
			},
			runLocalOperation: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await run(
						view!.runLocalOperation(
							decodeRunLocalOperationCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "runLocalOperation",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: view!.epoch,
								operation:
									intent.kind === "bash"
										? {
												kind: "bash",
												command: intent.command,
												excludeFromContext: intent.excludeFromContext,
												useUserShell: true,
											}
										: {
												kind: "python",
												code: intent.code,
												excludeFromContext: intent.excludeFromContext,
											},
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
			cancelLocalOperation: async (intent = {}) => {
				const current = await refresh();
				const active = current.runner.activeLocalOperation;
				if (active === undefined) {
					throw new RunnerLocalOperationTargetError({
						targetCommandId: "",
						targetOperationGeneration: 0,
					});
				}
				const ids = metadata(intent);
				const receipt = await run(
					view!.cancelLocalOperation(
						decodeCancelLocalOperationCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelLocalOperation",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedSessionRevision: current.runner.sessionRevision,
							viewId,
							controllerEpoch: view!.epoch,
							targetCommandId: active.commandId,
							targetOperationGeneration: active.operationGeneration,
						}),
					),
				);
				await refresh();
				return receipt;
			},
			interruptPrompt: async (intent = {}) => {
				try {
					const ids = metadata(intent);
					const targetGeneration = (await refresh()).session.promptOperation.generation;
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
					localOperationOutputListeners.clear();
					await Effect.runPromise(Scope.close(scope, Exit.void));
				}
			},
		};
	} catch (error) {
		await Effect.runPromise(Scope.close(scope, Exit.void));
		throw error;
	}
}
